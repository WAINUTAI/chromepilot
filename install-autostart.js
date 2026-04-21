#!/usr/bin/env node
// Cross-platform dispatcher: install browser-js as a login auto-start.
// Delegates to install-autostart.ps1 (Windows) or install-autostart.sh (Linux/macOS).
const { spawnSync } = require("child_process");
const { join } = require("path");

const isWin = process.platform === "win32";
const here  = __dirname;

const result = isWin
  ? spawnSync("powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(here, "install-autostart.ps1")],
      { stdio: "inherit" })
  : spawnSync("bash",
      [join(here, "install-autostart.sh")],
      { stdio: "inherit" });

process.exit(result.status ?? 1);
