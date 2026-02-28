#!/usr/bin/env bash
set -euo pipefail

# Cross-platform launcher with Ubuntu/Linux focus.
# Starts Chrome/Chromium with CDP enabled for browser.js.

DEBUG_PORT="${DEBUG_PORT:-9222}"
DEBUG_PROFILE="${DEBUG_PROFILE:-/tmp/browser-js-chrome-profile}"
CHROME_PATH="${CHROME_PATH:-}"
LOG_FILE="${LOG_FILE:-/tmp/browser-js-chrome.log}"

is_cdp_live() {
  curl -fsS "http://127.0.0.1:${DEBUG_PORT}/json/version" >/dev/null 2>&1
}

if is_cdp_live; then
  echo "CDP already live on port ${DEBUG_PORT}."
  exit 0
fi

if [[ -z "$CHROME_PATH" ]]; then
  for candidate in \
    google-chrome-stable \
    google-chrome \
    chromium \
    chromium-browser \
    "/snap/bin/chromium" \
    "/usr/bin/google-chrome"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      CHROME_PATH="$(command -v "$candidate")"
      break
    elif [[ -x "$candidate" ]]; then
      CHROME_PATH="$candidate"
      break
    fi
  done
fi

if [[ -z "$CHROME_PATH" ]]; then
  echo "No Chrome/Chromium executable found."
  echo "Ubuntu install examples:"
  echo "  sudo apt update && sudo apt install -y chromium"
  echo "  # or install Google Chrome .deb"
  exit 1
fi

mkdir -p "$DEBUG_PROFILE"

flags=(
  "--remote-debugging-port=${DEBUG_PORT}"
  "--remote-debugging-address=127.0.0.1"
  "--user-data-dir=${DEBUG_PROFILE}"
  "--no-first-run"
  "--no-default-browser-check"
)

# Root-safe mode for many Ubuntu servers/containers.
if [[ "$(id -u)" -eq 0 ]]; then
  flags+=("--no-sandbox" "--disable-dev-shm-usage")
fi

# If no desktop session is available, run headless.
if [[ -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]; then
  flags+=("--headless=new" "--disable-gpu")
fi

echo "Launching: $CHROME_PATH"
echo "CDP port: $DEBUG_PORT"
echo "Profile : $DEBUG_PROFILE"
echo "Log     : $LOG_FILE"

nohup "$CHROME_PATH" "${flags[@]}" >"$LOG_FILE" 2>&1 &

for _ in {1..30}; do
  if is_cdp_live; then
    echo "CDP is live: http://127.0.0.1:${DEBUG_PORT}/json/version"
    exit 0
  fi
  sleep 1
done

echo "Chrome launched but CDP did not come up in time."
echo "Check log: $LOG_FILE"
echo "Last log lines:"
tail -n 20 "$LOG_FILE" || true

if [[ "$CHROME_PATH" == *"chromium-browser"* || "$CHROME_PATH" == *"/snap/bin/chromium"* ]]; then
  echo "Hint: this may be a snap wrapper. On locked-down servers, snap Chromium can fail."
  echo "Set CHROME_PATH to a non-snap binary if available (google-chrome/chromium)."
fi

exit 1
