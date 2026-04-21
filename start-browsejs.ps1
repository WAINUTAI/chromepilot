# Idempotent launcher for the full browser-js stack:
#   - Chrome with CDP on port 9222 (via launch-chrome.ps1 - auto-detects Chrome)
#   - HTTP server on port 9223 (node server.js)
# Safe to run multiple times. Safe to run at Windows login.

$ErrorActionPreference = "SilentlyContinue"

$root     = $PSScriptRoot
$serverJs = Join-Path $root "server.js"
$logFile  = Join-Path $root "server.log"

function Test-Http($port, $path) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$port$path" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop | Out-Null
        return $true
    } catch { return $false }
}

# ── 1. Chrome on 9222 (delegated to launch-chrome.ps1, which is itself idempotent) ───
if (Test-Http 9222 "/json/version") {
    Write-Host "[chrome]  9222 already live - skipping launch"
} else {
    Write-Host "[chrome]  launching debug Chrome via launch-chrome.ps1"
    & (Join-Path $root "launch-chrome.ps1")
}

# ── 2. HTTP server on 9223 ──────────────────────────────────────────────────
if (Test-Http 9223 "/health") {
    Write-Host "[server]  9223 already live - skipping launch"
} else {
    Write-Host "[server]  launching node server.js (log: $logFile)"
    Start-Process -FilePath "node" `
        -ArgumentList "`"$serverJs`"" `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -RedirectStandardOutput $logFile `
        -RedirectStandardError  "$logFile.err"
    Start-Sleep -Seconds 2
}

# ── 3. Verify ───────────────────────────────────────────────────────────────
$chromeOk = Test-Http 9222 "/json/version"
$serverOk = Test-Http 9223 "/health"
Write-Host ""
Write-Host "Chrome (9222): $(if ($chromeOk) {'OK'} else {'DOWN'})"
Write-Host "Server (9223): $(if ($serverOk) {'OK'} else {'DOWN'})"
if ($chromeOk -and $serverOk) { exit 0 } else { exit 1 }
