---
name: marktplaats-art-scanner
description: Hunt undervalued or misattributed paintings ("diamonds") on Marktplaats. Use when the user wants to scan Marktplaats art categories (e.g. kunst-schilderijen-klassiek) for underpriced or wrongly-labelled paintings, skip promoted "dagtopper" and Catawiki ads, analyse listing images and signatures, detect informed-reseller lots, estimate value gaps versus auction comps, and rank opportunities. Drives the chromepilot browser-automation server when available and falls back to direct HTTP.
---

# Marktplaats Art Scanner

A repeatable workflow for finding **undervalued paintings** on Marktplaats: quality work that a clueless seller has priced as decoration, or a genuinely listed artist dumped cheap / at no-reserve auction. The goal is a large **value gap** (estimated worth minus asking price).

The hard-won lessons that make this work are in `reference/methodology.md` — read it before judging any listing. The scripts automate the mechanical parts; **you** (the agent) supply the art judgement and the value lookups.

## What "a diamond" means
- **Real diamond:** €1,000+ gap. A genuinely listed artist (auction market €1k+) priced cheap or no-reserve by someone who doesn't know, with no informed-seller markers.
- **Worth a look:** €100–1,000 gap.
- **Skip:** sub-€100 gaps, decorative/print/reproduction work.

## Prerequisites
- Python 3 with `requests`-free stdlib is fine for scanning; **Pillow** is needed for image work: `pip install Pillow`.
- **chromepilot** (recommended backend). Marktplaats is a server-rendered Next.js site; the listing data lives in a `__NEXT_DATA__` script tag. Direct HTTP often works, but a real browser via chromepilot is the robust path when there's a bot/consent wall or TLS interception. Start it with the chromepilot skill / `start-chromepilot.sh`, then the scanner's `--backend chromepilot` talks to `http://127.0.0.1:9223`.
  - Headless-container note: launch Chrome with `--ignore-certificate-errors` if the network does TLS inspection, and install a real Chromium (e.g. `npx playwright install chromium`) if none is present.

## The workflow

1. **Sweep a category** (triage — cheap, do it wide):
   ```bash
   python3 scripts/mp_scan.py \
     --base "https://www.marktplaats.nl/l/antiek-en-kunst/kunst-schilderijen-klassiek/" \
     --pages 1-25 --backend chromepilot --out candidates.json
   ```
   This pulls every listing from `__NEXT_DATA__`, **drops promoted "DAGTOPPER" and Catawiki "ADMARKT" ads**, and prints a ranked shortlist (no-reserve + named-artist + non-print scored highest). Promoted listings are excluded on purpose: those sellers already researched their value.

2. **Profile-check the seller** (single strongest filter — do this before imaging).
   ```bash
   python3 scripts/mp_profile.py --name sven --id 38509572
   ```
   Returns one of `INFORMED-DEALER` / `OCCASIONAL` / `CLUELESS-PRIVATE`. A clean-sounding seller name is meaningless on its own; the profile (review count + category specialisation + listing volume) reveals whether they know what they have. Drop `INFORMED-DEALER` candidates immediately — the margin is already priced out. See methodology v2 §1 for thresholds and case studies.

3. **Triage the shortlist by eye.** For the top candidates, pull the description + main image:
   ```bash
   python3 scripts/mp_detail.py --id m2402070059 --backend chromepilot
   ```
   Kill anything whose **description** contains a *medium flag* (zeefdruk, litho, ets, print, poster, reproductie, giclée, kopie, "naar", "in de stijl van", "afbeelding") or an *informed-seller marker* (getaxeerd, geschat, "gekocht veilinghuis", Christie's, echtheidscertificaat, richtprijs, Bénézit). Also check whether the detail page shows a hidden **vraagprijs** even when the listing array says `FAST_BID €0` — that flips a "no-reserve diamond" into a fixed-price commodity. See methodology for why.

4. **Look at the images** — titles lie, images don't:
   ```bash
   python3 scripts/mp_images.py --id m2402070059 --backend chromepilot --sheet
   python3 scripts/mp_images.py --file downloads/m2402070059_1.jpg --sig br   # zoom a signature corner
   ```
   Read the saved PNGs. Judge quality (museum-grade vs decorative), then hunt the signature. Note: Marktplaats caps photos at ~768–1200px, so a signature on a large canvas is often **unreadable** — flag that the buyer must request a macro from the seller (but only *after* the price is agreed; see methodology v2 §3 — asking before bidding raises the seller's anchor).

5. **Verify the artist's market.** Web-search realized prices: `kunstveiling.nl`, `simonis-buunk`, `invaluable`, `mutualart`, `barnebys`, Catawiki realized lots. Establish low/median/high. The gap = your value estimate − asking price.

6. **Reverse-image / twin-composition check.** Before trusting any "find", Google-image the painting (or compare to the seller's other lots). **If the same composition appears under another listing/seller, it's decorative production work — kill it.** A unique master's work is, by definition, not repeated for the décor market.

7. **Rank and report** by risk-adjusted gap. State the authentication risk for each (forgery-prone artists: Ronner-Knip, the Maris brothers, Mesdag, Corneille, Steinlen, etc.). For approach the seller: stealth DM with a clean low offer, no compliments, no questions — see methodology v2 §3–4.

## Output
Present a ranked table: rank, painting (artist/subject), asking price, estimated market value, gap, risk note, link. Optionally build a numbered contact-sheet board with `mp_images.py --board`.

## Key facts the scripts encode
- Listings JSON path: `props.pageProps.searchRequestAndResponse.listings`.
- Per-listing fields: `itemId, title, priceInfo{priceCents,priceType}, priorityProduct, traits, imageUrls[], sellerInformation.sellerName, location.cityName, vipUrl`.
- **Promoted = `priorityProduct=="DAGTOPPER"`; Catawiki/dealer ads = `traits` contains `ADMARKT_CONSOLE`.** Both excluded.
- **No-reserve auction** (clueless signal): `priceType=="FAST_BID"` and `priceCents==0` (shows as "Bieden").
- Image URL: `https://images.marktplaats.com/api/v1/hz-mp-pro-listing/images/{UUID}?rule=ecg_mp_eps$_87.jpg` (`$_82`=thumb, `$_86/$_87`=max ~768–1200px). The detail page's `og:image` includes a 2-char subfolder prefix (`/ab/{uuid}`) — strip it for the listing-array URLs.
- Pagination: append `/p/N/` to the category URL.
- **Cross-contamination:** scraping all image UUIDs off a detail page also grabs the seller's *other* lots. Trust the search-array `imageUrls[0]` and the `og:image` as the true main; treat extra gallery UUIDs with suspicion.

See `reference/methodology.md` for the full heuristics, scoring, value tiers and gotchas.
