# Contributing

Thanks for your interest in Browser-js! This guide covers everything you need to get started.

## Prerequisites

- **Node.js >= 18** (LTS recommended)
- npm (comes with Node)
- Git
- Chrome/Chromium installed on your system

## Setup

```bash
git clone https://github.com/WAINUTAI/Browser-js.git
cd Browser-js
npm install
```

## Development workflow

1. **Fork** the repo and create a feature branch from `main`
2. Make your changes
3. Test locally with `npm run launch` and browser commands
4. Commit with a clear message describing *what* and *why*
5. Open a PR against `main`

## Testing

```bash
# Launch Chrome with CDP
npm run launch

# List open tabs
npm run list

# Run a command
node browser.js open https://example.com
node browser.js content

# Stop Chrome when done
npm run stop
```

### Testing the HTTP server stack

```bash
# Bring up Chrome (9222) + server (9223) in one go (idempotent)
npm run start:all

# Verify
curl -s http://127.0.0.1:9223/health
```

If you edit `server.js` or `start-browsejs.{ps1,sh}`, restart with:

```bash
# Stop the server (pick whichever is running)
lsof -ti :9223 | xargs kill -9        # Linux/macOS
# or in PowerShell:
# Get-NetTCPConnection -LocalPort 9223 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

npm run start:all
```

## Claude Code skill

`.claude/skills/browsejs/SKILL.md` is a project-scoped skill for [Claude Code](https://claude.com/claude-code). Anyone who clones the repo and opens it with Claude Code gets the `browsejs` skill out of the box — it documents the HTTP API and tells the agent how to bring the stack up if health checks fail. Keep it in sync when you add/rename endpoints in `server.js`.

## Code style

- JavaScript/TypeScript
- Follow the patterns in existing files
- Keep commands focused and modular

## Questions?

Open an issue at [github.com/WAINUTAI/Browser-js/issues](https://github.com/WAINUTAI/Browser-js/issues).
