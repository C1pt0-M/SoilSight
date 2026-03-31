param(
    [string]$PythonExe = 'python',
    [Alias('Host')]
    [string]$BackendHost = '127.0.0.1',
    [int]$Port = 8010,
    [string]$RegionId = 'xinjiang',
    [ValidateSet('cotton', 'sugarbeet', 'maize')]
    [string]$ScoreProfile
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

function Resolve-ProjectPython {
    param([string]$RequestedPython)

    $candidate = if ([string]::IsNullOrWhiteSpace($RequestedPython)) { 'python' } else { $RequestedPython.Trim() }
    if ($candidate -ine 'python') {
        return $candidate
    }

    $preferred = @()
    $activePython = $null

    if (-not [string]::IsNullOrWhiteSpace($env:CONDA_PREFIX)) {
        $activePython = Join-Path $env:CONDA_PREFIX 'python.exe'
        $activeEnvName = Split-Path -Leaf $env:CONDA_PREFIX
        if ($activeEnvName -ieq 'soilsight' -and (Test-Path $activePython)) {
            return $activePython
        }

        $preferred += Join-Path $env:CONDA_PREFIX 'envs\soilsight\python.exe'
        $prefixParent = Split-Path -Parent $env:CONDA_PREFIX
        if (-not [string]::IsNullOrWhiteSpace($prefixParent)) {
            $preferred += Join-Path $prefixParent 'soilsight\python.exe'
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:CONDA_EXE)) {
        $condaScriptsDir = Split-Path -Parent $env:CONDA_EXE
        $condaRoot = Split-Path -Parent $condaScriptsDir
        if (-not [string]::IsNullOrWhiteSpace($condaRoot)) {
            $preferred += Join-Path $condaRoot 'envs\soilsight\python.exe'
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

$ResolvedPython = Resolve-Executable -Executable (Resolve-ProjectPython -RequestedPython $PythonExe) -Label 'Python'
Write-Host "Using Python: $ResolvedPython"
$backendArgs = @(
    'backend/soilsight_server.py',
    '--host', $BackendHost,
    '--port', $Port,
    '--region_id', $RegionId
)
if (-not [string]::IsNullOrWhiteSpace($ScoreProfile)) {
    Write-Host "Default score profile override: $ScoreProfile"
    $backendArgs += @('--score_profile', $ScoreProfile)
} else {
    Write-Host 'Default score profile: auto (all detected profiles still load automatically)'
}
& $ResolvedPython @backendArgs
