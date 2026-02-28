# PowerShell script to launch Chrome with remote debugging enabled
# Uses a dedicated profile so it doesn't conflict with your normal Chrome

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$debugProfile = "$PSScriptRoot\chrome-debug-profile"

# Kill any existing Chrome instances
Write-Host "Closing existing Chrome instances..."
Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Launching Chrome with remote debugging on port 9222..."
Start-Process $chromePath -ArgumentList "--remote-debugging-port=9222", "--user-data-dir=$debugProfile"
Start-Sleep -Seconds 3

# Verify connection
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:9222/json/version" -UseBasicParsing -ErrorAction Stop
    Write-Host "Connected! CDP is live."
    Write-Host $response.Content
} catch {
    Write-Host "Warning: Could not verify CDP connection yet. Give it a few more seconds."
}
