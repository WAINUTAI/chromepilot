# Stop Browser-js Chrome/Chromium instance to free memory (Windows/PowerShell)

$DEBUG_PORT = if ($env:DEBUG_PORT) { $env:DEBUG_PORT } else { "9222" }
$DEBUG_PROFILE = if ($env:DEBUG_PROFILE) { $env:DEBUG_PROFILE } else { "$env:TEMP\browser-js-chrome-profile" }

# Find Chrome processes with our debug port or profile
$chromeProcesses = Get-Process -Name "chrome" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "--remote-debugging-port=$DEBUG_PORT" -or
    $_.CommandLine -match "--user-data-dir=.*browser-js-chrome-profile"
}

if (-not $chromeProcesses) {
    Write-Host "No Browser-js Chrome process found."
    exit 0
}

$processIds = $chromeProcesses | Select-Object -ExpandProperty Id
Write-Host "Stopping Browser-js Chrome process(es): $processIds"

# Graceful stop first
$chromeProcesses | Stop-Process -Force -ErrorAction SilentlyContinue

# Wait a moment
Start-Sleep -Milliseconds 500

# Check if still running
$remaining = Get-Process -Id $processIds -ErrorAction SilentlyContinue
if ($remaining) {
    Write-Host "Force-killing remaining process(es)"
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Verify CDP is down
try {
    $response = Invoke-RestMethod "http://127.0.0.1:$DEBUG_PORT/json/version" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "Warning: CDP endpoint still responding on port $DEBUG_PORT."
    exit 1
} catch {
    Write-Host "Browser-js Chrome stopped. Memory freed."
    exit 0
}
