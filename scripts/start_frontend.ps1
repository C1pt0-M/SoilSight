param(
    [string]$NpmExe = 'npm.cmd',
    [Alias('Host')]
    [string]$FrontendHost = '127.0.0.1',
    [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

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

$ResolvedNpm = Resolve-Executable -Executable $NpmExe -Label 'npm'
Write-Host "Using npm: $ResolvedNpm"
Set-Location frontend
& $ResolvedNpm 'run' 'dev' '--' '--host' $FrontendHost '--port' $Port
