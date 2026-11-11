$ErrorActionPreference = 'Stop'

Write-Host "=== Lynx Network: Environment Validation ===" -ForegroundColor Cyan

$nodeVersion = & node -v 2>$null
$npmVersion = & npm -v 2>$null

if (-not $nodeVersion) {
    Write-Error "Node.js is not installed or not on PATH."
}

Write-Host "[OK] Node.js : $nodeVersion" -ForegroundColor Green
Write-Host "[OK] npm     : $npmVersion" -ForegroundColor Green

if (Test-Path "$PSScriptRoot\..\dist\main.js") {
    Write-Host "[OK] Compiled dist/main.js present" -ForegroundColor Green
} else {
    Write-Host "[INFO] dist/main.js not found yet. Running npm run build..." -ForegroundColor Yellow
    Push-Location "$PSScriptRoot\.."
    try {
        npm run build
        Write-Host "[OK] Build succeeded" -ForegroundColor Green
    } finally {
        Pop-Location
    }
}

