# Browser-js

CLI tool to control Chrome/Chromium via CDP (Chrome DevTools Protocol).

This repo now supports **Ubuntu/Linux** out of the box.

## What changed for Ubuntu

- `launch-chrome.sh` now auto-detects:
  - `google-chrome-stable`
  - `google-chrome`
  - `chromium-browser`
  - `chromium`
  - `/snap/bin/chromium`
- Uses a dedicated debug profile (`/tmp/browser-js-chrome-profile` by default)
- Verifies CDP endpoint is live (`http://127.0.0.1:9222/json/version`)
- Better Gmail draft compatibility:
  - Works with Gmail `u/0`, `u/1`, etc.
  - Handles EN/NL labels for compose fields

## Install

```bash
npm install
```

## Quick start (Ubuntu)

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

PRs are welcome — bug fixes, new source connectors, or improvements to existing ones.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, workflow, and a step-by-step guide for adding a new source connector.

## License

This project is licensed under the [Apache License 2.0](LICENSE). See NOTICE for required attribution.

WAINUT and NL-GOV-MCP are trademarks of WAINUT B.V. The Apache License 2.0 does not grant permission to use these names, trademarks, or branding to imply endorsement of derivative works. Forks and derivative works must retain the NOTICE file as required by the license.

## About WAINUT

WAINUT is your one-stop AI shop in the Netherlands. We help organizations adopt AI and build an AI-enabled workforce — from recruiting the right talent, to implementing the right tools, to training teams that actually use them.

Exploring AI for your organization? → [wainut.ai](https://wainut.ai) — Unleash Your Potential.
