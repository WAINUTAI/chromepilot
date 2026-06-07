# Install (on any device)

This is a Claude Code **skill**. To reuse it on another machine:

## 1. Drop the folder into your skills directory
- **Personal (all projects):** `~/.claude/skills/marktplaats-art-scanner/`
- **Project-local:** `<your-repo>/.claude/skills/marktplaats-art-scanner/`

The folder must contain `SKILL.md` at its root (it does). Restart / reopen Claude Code so it picks up the skill. Then just ask Claude to "scan marktplaats for undervalued paintings" and it will load this skill.

```
~/.claude/skills/marktplaats-art-scanner/
├── SKILL.md
├── INSTALL.md
├── requirements.txt
├── reference/
│   └── methodology.md
└── scripts/
    ├── mp_scan.py
    ├── mp_detail.py
    ├── mp_images.py
    └── mp_profile.py
```

## 2. Python deps
```bash
pip install Pillow      # only needed for mp_images.py (sheets / signature crops / boards)
```
`mp_scan.py` and `mp_detail.py` use the standard library only.

## 3. Browser backend (recommended)
The scripts default to plain HTTP, which works when Marktplaats serves the page without a
bot/consent wall. For reliability use the **chromepilot** server (`--backend chromepilot`,
listens on `127.0.0.1:9223`):
- Install chromepilot and run its `start-chromepilot.sh` (or the chromepilot skill).
- In headless containers: install a real Chromium (`npx playwright install chromium`) and
  launch Chrome with `--ignore-certificate-errors` if the network does TLS inspection.

## 4. Run
```bash
cd ~/.claude/skills/marktplaats-art-scanner
python3 scripts/mp_scan.py \
  --base "https://www.marktplaats.nl/l/antiek-en-kunst/kunst-schilderijen-klassiek/" \
  --pages 1-25 --backend chromepilot --out candidates.json
```
See `SKILL.md` for the full 6-step workflow and `reference/methodology.md` for the judgement rules.

## Note
Standalone use (without Claude) works too — the three scripts are ordinary CLIs. But the
skill is designed to be driven by Claude, which supplies the art-historical judgement,
image reading, value lookups and the reverse-image twin-composition check.
