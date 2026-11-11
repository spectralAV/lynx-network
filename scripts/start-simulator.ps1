param(
    [switch]$Demo
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path "$PSScriptRoot\.."

Push-Location $RepoRoot
try {
    if ($Demo) {
        node mock-hardware-stage.js --demo
    } else {
        node mock-hardware-stage.js
    }
} finally {
    Pop-Location
}

