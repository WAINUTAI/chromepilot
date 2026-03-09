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

## Code style

- JavaScript/TypeScript
- Follow the patterns in existing files
- Keep commands focused and modular

## Questions?

Open an issue at [github.com/WAINUTAI/Browser-js/issues](https://github.com/WAINUTAI/Browser-js/issues).
