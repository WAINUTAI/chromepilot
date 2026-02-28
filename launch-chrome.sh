#!/bin/bash
# Shell script to launch Chrome with remote debugging enabled
# Port 9222 is the standard CDP debugging port

# Detect OS and set Chrome path
if [[ "$OSTYPE" == "darwin"* ]]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    CHROME_PATH="/usr/bin/google-chrome"
else
    CHROME_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
fi

# Check if port is already in use
if lsof -i :9222 >/dev/null 2>&1 || ss -tlnp 2>/dev/null | grep -q 9222; then
    echo "Chrome is already running with debugging port 9222"
    exit 0
fi

echo "Launching Chrome with remote debugging on port 9222..."
"$CHROME_PATH" --remote-debugging-port=9222 &
echo "Chrome launched. You can now use browser.js commands."
