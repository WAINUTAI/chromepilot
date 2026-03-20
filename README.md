# Browser-js

CLI tool to control Chrome/Chromium via CDP (Chrome DevTools Protocol). Works on Linux/Ubuntu and macOS/Windows.

## Features

### Browser Automation
- **Tab management**: List, open, select, close, search, close-all tabs
- **Navigation**: Open URLs with load wait
- **Element interaction**: Click by index/text/selector, type, fill inputs
- **Content extraction**: Get page text, HTML, screenshots
- **JavaScript execution**: Run custom JS in page context
- **Scrolling**: Scroll up/down with pixel control
- **Waiting**: Wait for elements to appear

### Chrome Integration
- **Auto-detect Chrome**: `google-chrome-stable`, `google-chrome`, `chromium-browser`, `chromium`, or `/snap/bin/chromium`
- **Dedicated debug profile**: Uses `/tmp/browser-js-chrome-profile` to avoid conflicts with your regular browser
- **CDP health check**: Verifies the debug endpoint is live before running commands

### Gmail Support
- Works with Gmail's various UI versions (`u/0`, `u/1`, etc.)
- Handles EN/NL labels for compose fields

### Scripting
- **Chain commands**: Run multiple commands in sequence with `then`
- **JSON output**: Machine-readable output for agent parsing
- **Custom port**: Override CDP port (default: 9222)

## Install

```bash
npm install
```

## Quick start

### Ubuntu / Linux

```bash
npm run launch
npm run list
# run your browser.js task(s)
npm run stop
```

Or manually:

```bash
bash ./launch-chrome.sh
node browser.js list
# run your task(s)
bash ./stop-chrome.sh
```

### Windows

```powershell
# PowerShell
.\launch-chrome.ps1
node browser.js list
# run your task(s)
.\stop-chrome.ps1
```

## Commands

```bash
node browser.js list
node browser.js open https://news.ycombinator.com
node browser.js elements
node browser.js click 0
node browser.js click-text "Sign in"
node browser.js click-selector "button[type='submit']"
node browser.js content
node browser.js screenshot page.png
node browser.js fill "input[name='q']" "WAINUT"
node browser.js evaluate "document.title"
node browser.js search "github"          # search across all tabs
node browser.js close-all                # close all open tabs
```

### Chain commands

```bash
node browser.js open https://news.ycombinator.com then content
```

### JSON mode

```bash
node browser.js --json list
```

## Gmail draft helper

```bash
node compose-draft.js "name@example.com" "Subject" "Line 1\nLine 2"
```

## Cleanup (important)

When your browsing task is complete, stop the headless/debug browser to free memory:

```bash
npm run stop
# or
bash ./stop-chrome.sh
```

## Notes

- Default CDP host/port: `127.0.0.1:9222`
- Override launch vars if needed:
  - `DEBUG_PORT`
  - `DEBUG_PROFILE`
  - `CHROME_PATH`

Example:

```bash
DEBUG_PORT=9333 CHROME_PATH=/usr/bin/google-chrome-stable bash ./launch-chrome.sh
```

## Contributing

PRs are welcome — bug fixes, new commands, or improvements to existing functionality.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and testing guide.

## License

This project is licensed under the [Apache License 2.0](LICENSE). See NOTICE for required attribution.

WAINUT and Browser-js are trademarks of WAINUT B.V. The Apache License 2.0 does not grant permission to use these names, trademarks, or branding to imply endorsement of derivative works. Forks and derivative works must retain the NOTICE file as required by the license.

## About WAINUT

WAINUT is your one-stop AI shop in the Netherlands. We help organizations adopt AI and build an AI-enabled workforce — from recruiting the right talent, to implementing the right tools, to training teams that actually use them.

Exploring AI for your organization? → [wainut.ai](https://wainut.ai) — Unleash Your Potential.
