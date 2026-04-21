---
name: browsejs
description: Browser automation via CDP through a persistent HTTP server on 127.0.0.1:9223. Use this skill when the user wants to drive Chrome from an agent — navigate pages, click/fill forms, read content, handle cookie banners, take structured page snapshots (/recon), or solve captchas. Also use when debugging anything on a live web page from the terminal. Requires the browser-js repo's HTTP server to be running; the skill includes the commands to bring it up if it's down.
---

# BrowseJS - Browser Automation via CDP (HTTP server)

Control Chrome via the browser-js HTTP API on `127.0.0.1:9223`. This is the **preferred** method — the server is persistent, endpoints are structured, and one HTTP call is cheaper than spinning up a new Node process for every step.

> This skill assumes Claude Code is running from the root of the `Browser-js` repo. All script paths are relative to the repo root. If you are running Claude from elsewhere, either `cd` into the repo first or use absolute paths.

## Architecture (two ports)

| Port | Who listens | What it does |
|---|---|---|
| `9222` | Chrome itself | CDP debug endpoint — Chrome launched with `--remote-debugging-port=9222` |
| `9223` | `node server.js` | HTTP API the agent talks to — connects to Chrome on 9222 under the hood |

Tool locations (relative to repo root):
- **Combined launcher (preferred)**: `./start-browsejs.sh` (Linux/macOS) or `./start-browsejs.ps1` (Windows) — idempotent, starts Chrome + server, does NOT kill your normal Chrome
- **HTTP server**: `./server.js`
- **CLI (fallback only)**: `./browser.js`
- **Auto-start**: see README "Persistent background mode" — if set up, both ports are live from login onward

## Prerequisites

### Health check (always do this first)

```bash
curl -s http://127.0.0.1:9223/health
```

Expected: `{"status":"ok","cdpConnected":true,"tabCount":N}` — you're ready.

### If health fails, run the combined launcher

One call brings up whatever is missing (Chrome on 9222, server on 9223, or both):

```bash
# Linux/macOS
bash ./start-browsejs.sh

# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File .\start-browsejs.ps1
```

This is the **preferred** recovery path. The launcher does NOT kill your normal Chrome — it uses a separate `--user-data-dir` so the debug Chrome runs alongside it. Server output goes to `server.log` in the repo folder for debugging.

### Fallback: start pieces individually

```bash
# Chrome only
bash ./launch-chrome.sh           # Linux/macOS
powershell -File ./launch-chrome.ps1   # Windows

# Server only — use run_in_background:true in the Bash tool
node ./server.js
```

## HTTP Endpoints (preferred — use these)

All POST bodies are JSON. `tab` accepts a numeric index (`"0"`) **or** a substring matched against tab URL/title. Omit `tab` to target tab 0.

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET  | `/health`   | — | Server + CDP status |
| GET  | `/tabs`     | — | List open tabs |
| POST | `/focus`    | `{tab?}` | Bring tab to front |
| POST | `/navigate` | `{tab?, url?, back?, forward?, waitMs?}` | Navigate, go back/forward |
| POST | `/recon`    | `{url?, tab?, waitMs?, keepTab?}` | Full page snapshot — elements, forms, overlays, captchas, landmarks, meta. **Your default "what's on this page" call.** |
| POST | `/read`     | `{tab?, selector?}` | Structured sections (headings, tables, lists, code) + plaintext fallback. Use when you need content, not just element inventory. |
| POST | `/click`    | `{tab?, selector?, text?, index?, waitAfter?}` | Click by CSS selector, fuzzy text, or interactive-element index |
| POST | `/fill`     | `{tab?, fields:[{selector,value}], submit?}` | Fill text / date / time / checkbox / radio / select / contenteditable. `submit`: `"enter"` \| `"form"` \| `"auto"` \| CSS selector. Unicode-safe. |
| POST | `/type`     | `{tab?, keys, submit?}` | Raw CDP key input (no focus/clear). `submit`: `"enter"` \| `"tab"` |
| POST | `/scroll`   | `{tab?, direction, amount?}` | Scroll + returns `{scrollY, scrollHeight, atBottom, contentPreview}` |
| POST | `/dismiss`  | `{tab?}` | Close cookie banners / modals — multi-language, walks shadow DOM + consent iframes |
| POST | `/eval`     | `{tab?, expression}` | Run JS in page context |
| POST | `/dispatch` | `{tab?, selector, event, eventInit?, reactDebug?}` | Fire native DOM events. `reactDebug:true` returns React handler chain |
| POST | `/captcha`  | `{tab?, action}` | `detect`/`read`/`next`/`prev`/`submit`/`audio`/`restart` — reCAPTCHA/Arkose/hCaptcha aware |

### `/fill` value semantics

- **Text / textarea / contenteditable** — typed character-by-character (React/autocomplete handlers fire)
- **`type=date` / `time` / `datetime-local` / `month` / `week` / `color` / `range`** — ISO strings: `"2026-05-15"`, `"14:30"`, `"2026-05-15T14:30"`
- **`type=checkbox` / `radio`** — `true` / `"true"` / `"on"` / `"1"` check it; anything else unchecks
- **`<select>`** — value matches `<option value="...">`

## Workflow patterns

### Start every session with a health check

```bash
curl -s http://127.0.0.1:9223/health
```

If this fails → run the combined launcher (above).

### Read a page

```bash
curl -s -X POST http://127.0.0.1:9223/recon \
  -H "Content-Type: application/json" \
  -d '{"tab":"0"}'
```

`/recon` returns headings, forms (with field selectors + labels), clickable elements (with selectors), overlays, and a content summary — prefer this over `/read` when deciding what to do next.

Use `/read` when you want the text content (article body, notification messages, structured data).

### Navigate

```bash
curl -s -X POST http://127.0.0.1:9223/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","waitMs":2000}'
```

### Click

Prefer selector from `/recon` output. Fall back to text:

```bash
curl -s -X POST http://127.0.0.1:9223/click \
  -H "Content-Type: application/json" \
  -d '{"selector":"button[data-testid=submit]"}'

curl -s -X POST http://127.0.0.1:9223/click \
  -H "Content-Type: application/json" \
  -d '{"text":"Next","waitAfter":1500}'
```

### Fill a form

```bash
curl -s -X POST http://127.0.0.1:9223/fill \
  -H "Content-Type: application/json" \
  -d '{
    "fields":[
      {"selector":"input[name=email]","value":"user@example.com"},
      {"selector":"input[name=password]","value":"hunter2"}
    ],
    "submit":"auto"
  }'
```

### Handle cookie banners

```bash
curl -s -X POST http://127.0.0.1:9223/dismiss -H "Content-Type: application/json" -d '{}'
```

`/dismiss` walks shadow DOM and cross-origin consent iframes (Sourcepoint, OneTrust, Didomi, Cookiebot, Usercentrics, TrustArc, Iubenda, Quantcast) — usually one call handles it.

### Scroll

```bash
curl -s -X POST http://127.0.0.1:9223/scroll \
  -H "Content-Type: application/json" \
  -d '{"direction":"down","amount":1200}'
```

The response includes `atBottom` and a `contentPreview` so you can loop until the end of an infinite-scroll page.

## Instructions

When the user invokes this skill, follow these steps:

### 1. Verify both ports are alive

```bash
curl -s http://127.0.0.1:9223/health
```

- If `cdpConnected:true` → ready, proceed.
- Anything else → run the combined launcher (fixes Chrome + server in one go):
  - Linux/macOS: `bash ./start-browsejs.sh`
  - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-browsejs.ps1`

### 2. Prefer `/recon` over screenshots

`/recon` gives you a structured snapshot — the `elements[]` array already has `selector`, `text`, `role`, `tag`, and coordinates for everything interactive. Use it to decide the next action. Screenshots are a last resort for canvas-heavy pages.

### 3. Prefer selectors from `/recon` over text matching

The selectors returned by `/recon` (built via `buildSelector`) are id-aware, aria-label-aware, and testid-aware. They're stable. Text matching is a good fallback but can be ambiguous.

### 4. Batch form fills in a single `/fill` call

One HTTP call with a `fields[]` array is cheaper and more atomic than N single-field calls. Include `submit` in the same call when the form should be submitted immediately.

### 5. After clicking something that navigates or mutates the DOM, re-run `/recon`

Don't assume the page is the same after a click — the SPA may have swapped routes. A fresh `/recon` gives you the new state.

### 6. Iterate and recover

- `/click` by text failed → call `/recon`, find the selector, retry with `/click` by selector.
- `/fill` reports `success:false` for one field → the selector is wrong; re-recon and pick a better one.
- Page didn't load after `/navigate` → raise `waitMs` (e.g. 5000) or call `/recon` to see what's actually there.
- `/dismiss` returned `count:0` but a banner is still visible → the consent-manager iframe URL isn't in the built-in pattern list. Use `/recon` to find the button and `/click` it directly.

### 7. Be concise with results

Summarize what you found, don't dump raw JSON. When reporting navigation outcomes, include the URL and title from the response.

## CLI fallback (legacy — only when HTTP server is unavailable)

If the HTTP server refuses to start and you need something done immediately, you can still drive the CLI directly:

```bash
node ./browser.js list
node ./browser.js open https://example.com then content
```

The CLI spins up a fresh CDP connection for every command, which is slower and loses structured output. Use only as a fallback.

## Troubleshooting

- **`ECONNREFUSED 127.0.0.1:9222`** — Chrome's debug endpoint isn't running. Run the combined launcher.
- **`ECONNREFUSED 127.0.0.1:9223`** — The HTTP server isn't running. Run the combined launcher; it starts the server if needed.
- **`Port 9223 is already in use`** — An earlier server process is still alive. Either use it (it's probably fine) or kill it (`lsof -i :9223` / `Get-NetTCPConnection -LocalPort 9223`) and restart.
- **`Tab [N] not found`** — Fewer tabs open than the index you asked for. Call `GET /tabs` first.
- **`/dismiss` returned `count:0` but the banner is still visible** — The consent framework's iframe URL doesn't match the built-in pattern list. `/recon` it, grab the button selector, `/click` directly.
