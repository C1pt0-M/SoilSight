[CmdletBinding()]
param(
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Action = "start",
    [string]$BackendHost = $(if ($env:BACKEND_HOST) { $env:BACKEND_HOST } else { "127.0.0.1" }),
    [int]$BackendPort = $(if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8010 }),
    [string]$FrontendHost = $(if ($env:FRONTEND_HOST) { $env:FRONTEND_HOST } else { "127.0.0.1" }),
    [int]$FrontendPort = $(if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 5173 }),
    [string]$RegionId = $(if ($env:REGION_ID) { $env:REGION_ID } else { "xinjiang" }),
    [ValidateSet("cotton", "sugarbeet", "maize")]
    [string]$ScoreProfile = $(if ($env:SCORE_PROFILE) { $env:SCORE_PROFILE } else { $null }),
    [string]$PythonExe = $(if ($env:SOILSIGHT_PYTHON) { $env:SOILSIGHT_PYTHON } else { "python" }),
    [string]$NpmExe = $(if ($env:SOILSIGHT_NPM) { $env:SOILSIGHT_NPM } else { "npm.cmd" })
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $RootDir "tmp\dev_stack"
$BackendPidFile = Join-Path $RuntimeDir "backend.pid"
$FrontendPidFile = Join-Path $RuntimeDir "frontend.pid"
$BackendStdoutLog = Join-Path $RuntimeDir "backend.stdout.log"
$BackendStderrLog = Join-Path $RuntimeDir "backend.stderr.log"
$FrontendStdoutLog = Join-Path $RuntimeDir "frontend.stdout.log"
$FrontendStderrLog = Join-Path $RuntimeDir "frontend.stderr.log"

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Resolve-ProjectPython {
    param([string]$RequestedPython)

    $candidate = if ([string]::IsNullOrWhiteSpace($RequestedPython)) { "python" } else { $RequestedPython.Trim() }
    if ($candidate -ine "python") {
        return $candidate
    }

    $preferred = @()
    $activePython = $null

    if (-not [string]::IsNullOrWhiteSpace($env:CONDA_PREFIX)) {
        $activePython = Join-Path $env:CONDA_PREFIX "python.exe"
        $activeEnvName = Split-Path -Leaf $env:CONDA_PREFIX
        if ($activeEnvName -ieq "soilsight" -and (Test-Path $activePython)) {
            return $activePython
        }

        $preferred += Join-Path $env:CONDA_PREFIX "envs\soilsight\python.exe"
        $prefixParent = Split-Path -Parent $env:CONDA_PREFIX
        if (-not [string]::IsNullOrWhiteSpace($prefixParent)) {
            $preferred += Join-Path $prefixParent "soilsight\python.exe"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:CONDA_EXE)) {
        $condaScriptsDir = Split-Path -Parent $env:CONDA_EXE
        $condaRoot = Split-Path -Parent $condaScriptsDir
        if (-not [string]::IsNullOrWhiteSpace($condaRoot)) {
            $preferred += Join-Path $condaRoot "envs\soilsight\python.exe"
        }
    }

    foreach ($path in $preferred | Select-Object -Unique) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path $path)) {
            return $path
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($activePython) -and (Test-Path $activePython)) {
        return $activePython
    }

    return $candidate
}

function Resolve-Executable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,
        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if ([System.IO.Path]::IsPathRooted($Executable)) {
        if (!(Test-Path $Executable)) {
            throw "$Label not found: $Executable"
        }
        return $Executable
    }

    $command = Get-Command $Executable -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "$Label not found in PATH: $Executable"
    }
    return $command.Source
}

function Read-Pid {
    param([string]$Path)

    if (!(Test-Path $Path)) {
        return $null
    }

    $raw = (Get-Content -Raw -Path $Path).Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }

    try {
        return [int]$raw
    } catch {
        return $null
    }
}

function Test-Running {
    param($ProcessId)

    if ($null -eq $ProcessId) {
        return $false
    }

    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Show-LogTail {
    param(
        [string]$Label,
        [string]$Path,
        [int]$MaxLines = 40
    )

    if (!(Test-Path $Path)) {
        return
    }

    Write-Host $Label
    Get-Content -Path $Path -Tail $MaxLines | ForEach-Object { Write-Host $_ }
}

function Wait-ForHttp {
    param(
        [string]$Url,
        [int]$MaxAttempts = 40,
        [int]$DelaySeconds = 1,
        [int]$ProcessId = 0,
        [string]$ServiceName = "service",
        [string]$PidFile,
        [string]$StdoutLog,
        [string]$StderrLog
    )

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        if ($ProcessId -gt 0 -and !(Test-Running $ProcessId)) {
            if (-not [string]::IsNullOrWhiteSpace($PidFile)) {
                Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
            }
            Write-Host "$ServiceName process exited before health check passed"
            Show-LogTail -Label "$ServiceName stderr tail:" -Path $StderrLog
            Show-LogTail -Label "$ServiceName stdout tail:" -Path $StdoutLog
            return $false
        }

        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
        }
        Start-Sleep -Seconds $DelaySeconds
    }

    if ($ProcessId -gt 0) {
        Write-Host "$ServiceName health check timed out"
        Show-LogTail -Label "$ServiceName stderr tail:" -Path $StderrLog
        Show-LogTail -Label "$ServiceName stdout tail:" -Path $StdoutLog
    }

    return $false
}

function Stop-One {
    param(
        [string]$Name,
        [string]$PidFile
    )

    $processId = Read-Pid $PidFile
    if (!(Test-Running $processId)) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        Write-Host "$Name is not running"
        return
    }

    Write-Host "Stopping $Name (PID=$processId)"
    Stop-Process -Id $processId -ErrorAction SilentlyContinue
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (!(Test-Running $processId)) {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
            Write-Host "$Name stopped"
            return
        }
        Start-Sleep -Milliseconds 500
    }

    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "$Name force-stopped"
}

function Show-Status {
    $backendProcessId = Read-Pid $BackendPidFile
    $frontendProcessId = Read-Pid $FrontendPidFile

    if (Test-Running $backendProcessId) {
        Write-Host "backend: running (PID=$backendProcessId) http://$($BackendHost):$($BackendPort)"
    } else {
        Write-Host "backend: stopped"
    }

    if (Test-Running $frontendProcessId) {
        Write-Host "frontend: running (PID=$frontendProcessId) http://$($FrontendHost):$($FrontendPort)"
    } else {
        Write-Host "frontend: stopped"
    }

    Write-Host "backend stdout:  $BackendStdoutLog"
    Write-Host "backend stderr:  $BackendStderrLog"
    Write-Host "frontend stdout: $FrontendStdoutLog"
    Write-Host "frontend stderr: $FrontendStderrLog"
}

function Assert-FrontendReady {
    $existingProcessId = Read-Pid $FrontendPidFile
    if (Test-Running $existingProcessId) {
        return
    }

    $viteCmd = Join-Path $RootDir "frontend\node_modules\vite\bin\vite.js"
    if (!(Test-Path $viteCmd)) {
        throw "Missing frontend/node_modules/vite/bin/vite.js. Reinstall dependencies on the current OS: cd frontend; npm install"
    }
}

$ResolvedPython = Resolve-Executable -Executable (Resolve-ProjectPython -RequestedPython $PythonExe) -Label "Python"
$ResolvedNpm = Resolve-Executable -Executable $NpmExe -Label "npm"

function Start-Backend {
    $existingProcessId = Read-Pid $BackendPidFile
    if (Test-Running $existingProcessId) {
        Write-Host "backend already running (PID=$existingProcessId)"
        return
    }

    Write-Host "Starting backend..."
    Write-Host "Using Python: $ResolvedPython"
    $backendArgs = @(
        "backend/soilsight_server.py",
        "--host", $BackendHost,
        "--port", "$BackendPort",
        "--region_id", $RegionId
    )
    if (-not [string]::IsNullOrWhiteSpace($ScoreProfile)) {
        Write-Host "Default score profile override: $ScoreProfile"
        $backendArgs += @("--score_profile", $ScoreProfile)
    } else {
        Write-Host "Default score profile: auto (frontend can switch profiles at runtime)"
    }
    $proc = Start-Process `
        -FilePath $ResolvedPython `
        -ArgumentList $backendArgs `
        -WorkingDirectory $RootDir `
        -PassThru `
        -RedirectStandardOutput $BackendStdoutLog `
        -RedirectStandardError $BackendStderrLog

    Set-Content -Path $BackendPidFile -Value $proc.Id -Encoding ascii

    if (!(Wait-ForHttp -Url "http://$($BackendHost):$($BackendPort)/health" -ProcessId $proc.Id -ServiceName "backend" -PidFile $BackendPidFile -StdoutLog $BackendStdoutLog -StderrLog $BackendStderrLog)) {
        throw "Backend process exited before health check passed"
    }

    Write-Host "backend ready: http://$($BackendHost):$($BackendPort)"
}

function Start-Frontend {
    $existingProcessId = Read-Pid $FrontendPidFile
    if (Test-Running $existingProcessId) {
        Write-Host "frontend already running (PID=$existingProcessId)"
        return
    }

    Assert-FrontendReady

    Write-Host "Starting frontend..."
    Write-Host "Using npm: $ResolvedNpm"
    $proc = Start-Process `
        -FilePath $ResolvedNpm `
        -ArgumentList @("run", "dev", "--", "--host", $FrontendHost, "--port", "$FrontendPort") `
        -WorkingDirectory (Join-Path $RootDir "frontend") `
        -PassThru `
        -RedirectStandardOutput $FrontendStdoutLog `
        -RedirectStandardError $FrontendStderrLog

    Set-Content -Path $FrontendPidFile -Value $proc.Id -Encoding ascii

    if (!(Wait-ForHttp -Url "http://$($FrontendHost):$($FrontendPort)" -ProcessId $proc.Id -ServiceName "frontend" -PidFile $FrontendPidFile -StdoutLog $FrontendStdoutLog -StderrLog $FrontendStderrLog)) {
        throw "Frontend process exited before availability check passed"
    }

    Write-Host "frontend ready: http://$($FrontendHost):$($FrontendPort)"
}

switch ($Action) {
    "start" {
        Assert-FrontendReady
        Start-Backend
        Start-Frontend
        Show-Status
    }
    "stop" {
        Stop-One -Name "frontend" -PidFile $FrontendPidFile
        Stop-One -Name "backend" -PidFile $BackendPidFile
    }
    "restart" {
        Stop-One -Name "frontend" -PidFile $FrontendPidFile
        Stop-One -Name "backend" -PidFile $BackendPidFile
        Assert-FrontendReady
        Start-Backend
        Start-Frontend
        Show-Status
    }
    "status" {
        Show-Status
    }
}
