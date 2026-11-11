param(
    [string]$TargetDir = "$HOME\companion-module-dev\companion-module-digico-astral-orchestrator"
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path "$PSScriptRoot\.."

Push-Location $RepoRoot
try {
    Write-Host "Building companion-module-digico-astral-orchestrator..." -ForegroundColor Cyan
    npm run build

    $ParentDir = Split-Path -Parent $TargetDir
    if (-not (Test-Path $ParentDir)) {
        New-Item -ItemType Directory -Path $ParentDir -Force | Out-Null
    }

    if (Test-Path $TargetDir) {
        Remove-Item -Path $TargetDir -Recurse -Force
    }

    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Copy-Item -Path "$RepoRoot\companion" -Destination "$TargetDir\companion" -Recurse -Force
    Copy-Item -Path "$RepoRoot\dist" -Destination "$TargetDir\dist" -Recurse -Force
    Copy-Item -Path "$RepoRoot\node_modules" -Destination "$TargetDir\node_modules" -Recurse -Force
    Copy-Item -Path "$RepoRoot\package.json" -Destination "$TargetDir\package.json" -Force

    Write-Host "[OK] Installed module to $TargetDir" -ForegroundColor Green
} finally {
    Pop-Location
}
