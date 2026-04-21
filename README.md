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
- **Dedicated debug profile** to avoid conflicts with your regular browser: `/tmp/browser-js-chrome-profile` on Linux/macOS, `<repo>/chrome-debug-profile` on Windows
- **CDP health check**: Verifies the debug endpoint is live before running commands

### Scripting
- **Chain commands**: Run multiple commands in sequence with `then`
- **JSON output**: Machine-readable output for agent parsing
- **Custom port**: Override CDP port (default: 9222)

### HTTP server (persistent agent mode)
- **`node server.js`** (or `npm run serve`) runs a long-lived HTTP API on `127.0.0.1:9223`
- 14 endpoints for agents: `/recon`, `/click`, `/fill`, `/read`, `/dismiss`, `/navigate`, `/eval`, `/scroll`, `/type`, `/dispatch`, `/captcha`, `/focus`, `/tabs`, `/health`
- Chrome and the server stay open; agents come and go over plain HTTP
- Structured `/recon` page snapshot with overlay + captcha detection built in
- **Notification prompts auto-blocked**: `Notification.requestPermission`, `PushManager.subscribe`, and `navigator.permissions.query({name:"notifications"})` are all overridden to return `denied` on every tab the server touches — site-level "allow notifications" popups never appear
- **Shadow-DOM + cross-origin iframe aware** `/dismiss`: walks cookie/consent iframes (Sourcepoint, OneTrust, Didomi, Cookiebot, etc.) and shadow roots to reach banners most selectors miss
- **Unicode-safe typing**: ASCII chars go through CDP keyboard events (so React/autocomplete handlers fire); em-dashes, smart quotes, accented chars, CJK, and emoji use `Input.insertText` so they land intact
- **Platform-agnostic input clearing**: no `Ctrl+A` keystroke — clears via native value setter, so `/fill` works the same on Windows, Linux, and macOS

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
node server.js                           # start the persistent HTTP API (see below)
```

Full CLI reference with all commands and flags:

```bash
node browser.js help
```

### Chain commands

```bash
node browser.js open https://news.ycombinator.com then content
```

### JSON mode

```bash
node browser.js --json list
```

## Server mode (HTTP API)

Start the long-running HTTP server so agents can drive Chrome over HTTP without re-launching Node on every step:

```bash
# Start Chrome first (once), then:
node server.js
# or
npm run serve
# Bind to a different port:
PORT=9300 node server.js
```

The server binds to `127.0.0.1:9223` by default and stays up until you kill it. Chrome must be reachable on `127.0.0.1:9222` (the standard launch script handles this).

Env overrides: `PORT`, `CDP_HOST`, `CDP_PORT`, `BIND_HOST`.

> The older `node browser.js serve` entry point still works (`npm run serve:legacy`) and is functionally identical — both paths call the same `startServer()`.

## Persistent background mode (auto-start on login)

If you want Chrome (9222) **and** the HTTP server (9223) to come up every time you log in — so agents never have to bootstrap the stack — use the combined launcher and wire it into your OS session.

### One-shot bring-up (any platform)

```bash
npm run start:all
```

This dispatches to the platform-specific launcher (`start-browsejs.sh` on Linux/macOS, `start-browsejs.ps1` on Windows). You can also call them directly:

```bash
# Linux/macOS
bash ./start-browsejs.sh

# Windows (PowerShell)
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-browsejs.ps1
```

The launcher is idempotent:
- If 9222 is already live → skips Chrome
- If 9223 is already live → skips the server
- Uses a **separate Chrome user-data-dir**, so it does not kill or hijack your normal Chrome session

### Auto-start on Windows login

A small shortcut in the Startup folder runs the launcher silently on each login:

```powershell
# One-time install: create the Startup shortcut
$startup = [Environment]::GetFolderPath('Startup')
$lnk     = Join-Path $startup 'browser-js.lnk'
$ws      = New-Object -ComObject WScript.Shell
$sc      = $ws.CreateShortcut($lnk)
$sc.TargetPath       = 'wscript.exe'
$sc.Arguments        = "`"$PWD\start-browsejs-hidden.vbs`""
$sc.WorkingDirectory = "$PWD"
$sc.Save()
```

`start-browsejs-hidden.vbs` wraps the PowerShell launcher with a hidden console window. To disable: delete `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\browser-js.lnk`.

### Auto-start on Linux (systemd user unit, optional)

Create `~/.config/systemd/user/browser-js.service`:

```ini
[Unit]
Description=browser-js CDP + HTTP server
After=graphical-session.target

[Service]
Type=simple
WorkingDirectory=%h/Browser-js
ExecStart=/usr/bin/env bash %h/Browser-js/start-browsejs.sh
Restart=on-failure

[Install]
WantedBy=default.target
```

Then: `systemctl --user enable --now browser-js`.

### Auto-start on macOS (launchd, optional)

Use `launchctl` with a `LaunchAgent` plist in `~/Library/LaunchAgents/` that runs `bash /path/to/Browser-js/start-browsejs.sh` with `RunAtLoad=true`. See Apple's `launchd.plist(5)` for the exact format.

### Caveats

- Auto-start fires on **login**, not boot — the stack comes up when you sign in, not while the login screen is showing.
- The launcher does not supervise the server. If `node server.js` crashes it stays down until the next login or manual launch. For always-on use, run it under systemd / launchd / a Windows Scheduled Task with restart-on-failure.

### Endpoints

All POST bodies are JSON. The `tab` field accepts a numeric index (`"0"`, `"1"`) **or** a substring matched against tab URL/title. Omit `tab` to target tab 0.

`/fill` `value` semantics per input type:
- Text / textarea / contenteditable — typed character-by-character
- `type=date` / `time` / `datetime-local` / `month` / `week` / `color` / `range` — set via native setter (ISO strings for dates: `"2026-05-15"`, `"14:30"`, `"2026-05-15T14:30"`)
- `type=checkbox` / `radio` — `true` / `"true"` / `"on"` / `"1"` check it, anything else unchecks
- `<select>` — value matches `<option value="...">`

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET  | `/health`   | — | Server + CDP status |
| GET  | `/tabs`     | — | List open tabs |
| POST | `/recon`    | `{url?, tab?, waitMs?, keepTab?}` | Full page snapshot: elements, forms, overlays, captchas, meta, landmarks |
| POST | `/navigate` | `{tab?, url?, back?, forward?, waitMs?}` | Navigate, go back/forward |
| POST | `/click`    | `{tab?, selector?, text?, index?, waitAfter?}` | Click by selector, fuzzy text, or index |
| POST | `/fill`     | `{tab?, fields:[{selector,value}], submit?}` | Fill text / date / time / checkbox / radio / select / contenteditable. `submit`: `"enter"` \| `"form"` \| `"auto"` \| CSS selector. Unicode-safe. |
| POST | `/read`     | `{tab?, selector?}` | Structured sections (headings/tables/lists/code) + plaintext |
| POST | `/dismiss`  | `{tab?}` | Close cookie banners / modals — multi-language patterns, walks shadow DOM + cross-origin consent iframes (Sourcepoint, OneTrust, Didomi, Cookiebot, …) |
| POST | `/scroll`   | `{tab?, direction, amount?}` | Scroll + returns `{scrollY, scrollHeight, viewportHeight, atBottom, contentPreview}` |
| POST | `/type`     | `{tab?, keys, submit?}` | Raw CDP key input (no focus/clear). `submit`: `"enter"` \| `"tab"` |
| POST | `/dispatch` | `{tab?, selector, event, eventInit?, reactDebug?}` | Fire native DOM events. `reactDebug:true` returns `__reactProps` handler chain for inspection |
| POST | `/captcha`  | `{tab?, action}` | `detect`/`read`/`next`/`prev`/`submit`/`audio`/`restart`. Works on reCAPTCHA (id-based) and Arkose/hCaptcha (aria-label-based); walks cross-origin captcha iframes |
| POST | `/focus`    | `{tab?}` | Bring tab to front |
| POST | `/eval`     | `{tab?, expression}` | Run JS in page context |

### Examples

```bash
curl http://127.0.0.1:9223/health
curl http://127.0.0.1:9223/tabs

curl -X POST http://127.0.0.1:9223/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

curl -X POST http://127.0.0.1:9223/recon \
  -H "Content-Type: application/json" \
  -d '{"tab":"0"}'

curl -X POST http://127.0.0.1:9223/click \
  -H "Content-Type: application/json" \
  -d '{"text":"Sign in"}'

curl -X POST http://127.0.0.1:9223/fill \
  -H "Content-Type: application/json" \
  -d '{"fields":[{"selector":"input[name=q]","value":"hello"}],"submit":"enter"}'

curl -X POST http://127.0.0.1:9223/dismiss \
  -H "Content-Type: application/json" -d '{}'

curl -X POST http://127.0.0.1:9223/captcha \
  -H "Content-Type: application/json" \
  -d '{"action":"detect"}'

curl -X POST http://127.0.0.1:9223/scroll \
  -H "Content-Type: application/json" \
  -d '{"direction":"down","amount":1200}'
```

### Troubleshooting

- **`Cannot connect to Chrome` / `ECONNREFUSED 127.0.0.1:9222`** — Chrome's debug endpoint isn't running. Launch it first with `bash ./launch-chrome.sh` (Linux/macOS) or `.\launch-chrome.ps1` (Windows).
- **`Port 9223 is already in use`** — another `serve` process is running. Either kill it (Ctrl+C in its terminal) or pass `--http-port <N>` to pick a different port.
- **`Tab [N] not found`** — fewer tabs are open than the index you asked for. Call `GET /tabs` to see what's actually there.
- **`/dismiss` returned `count: 0` but the banner is still visible** — the banner is likely rendered by a consent framework whose iframe URL doesn't match the built-in pattern list (Sourcepoint, OneTrust, Didomi, Cookiebot, Usercentrics, TrustArc, Iubenda, Quantcast, Evidon). Inspect with `/recon` and add a matching pattern to `CONSENT_IFRAME_RE` in `server.js` if needed.

### Attribution

The HTTP server in `server.js` adapts several injected page-script techniques
(reconnaissance enumeration, overlay/cookie dismissal patterns, captcha
iframe detection, date-input native setter, and React handler inspection)
from MIT-licensed work by AllAboutAI-YT. See [`NOTICE`](NOTICE) for the
copyright notice and full MIT license text.

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
