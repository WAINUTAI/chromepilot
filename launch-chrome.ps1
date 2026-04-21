# PowerShell script to launch Chrome with remote debugging enabled
# Uses a dedicated profile so it runs alongside your normal Chrome without conflict.
# Auto-detects Chrome across common install locations; honors CHROME_PATH env override.

$ErrorActionPreference = "Stop"

$debugPort    = if ($env:DEBUG_PORT)    { [int]$env:DEBUG_PORT } else { 9222 }
$debugProfile = if ($env:DEBUG_PROFILE) { $env:DEBUG_PROFILE }   else { Join-Path $PSScriptRoot "chrome-debug-profile" }

function Test-CdpLive {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$debugPort/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
        return $true
    } catch { return $false }
}

# If CDP is already up, reuse it instead of launching a second debug Chrome
if (Test-CdpLive) {
    Write-Host "CDP already live on port $debugPort - reusing existing debug Chrome."
    exit 0
}

# Find a Chrome/Chromium executable
$chromePath = $env:CHROME_PATH
if (-not $chromePath) {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome SxS\Application\chrome.exe",      # Canary
        "$env:ProgramFiles\Google\Chrome Beta\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome Dev\Application\chrome.exe",
        "$env:ProgramFiles\Chromium\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Chromium\Application\chrome.exe",
        "$env:LOCALAPPDATA\Chromium\Application\chrome.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { $chromePath = $c; break }
    }
}

if (-not $chromePath -or -not (Test-Path $chromePath)) {
    Write-Host "No Chrome/Chromium executable found."
    Write-Host "Tried:"
    foreach ($c in $candidates) { Write-Host "  - $c" }
    Write-Host ""
    Write-Host "Install Google Chrome: https://www.google.com/chrome/"
    Write-Host "Or set CHROME_PATH to your chrome.exe and re-run."
    exit 1
}

Write-Host "Launching: $chromePath"
Write-Host "CDP port : $debugPort"
Write-Host "Profile  : $debugProfile"

Start-Process $chromePath -ArgumentList `
    "--remote-debugging-port=$debugPort", `
    "--remote-debugging-address=127.0.0.1", `
    "--user-data-dir=$debugProfile", `
    "--no-first-run", `
    "--no-default-browser-check"

for ($i = 0; $i -lt 30; $i++) {
    if (Test-CdpLive) {
        Write-Host "CDP is live: http://127.0.0.1:$debugPort/json/version"
        exit 0
    }
    Start-Sleep -Seconds 1
}

Write-Host "Chrome launched but CDP did not come up in time."
exit 1
