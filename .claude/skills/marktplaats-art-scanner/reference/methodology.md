# Methodology — finding undervalued paintings on Marktplaats

This is the judgement layer. The scripts do the mechanical filtering; this file is how you read what comes back.

---

## v2 — Field-calibration lessons (this is where the real edge is)

After several full sweeps the v1 heuristics below were necessary but not sufficient. These v2 rules are what actually distinguish a real diamond from "yet another informed-seller lot dressed up as clueless." Read these *first*.

### 1. The seller-profile check overrides everything else
A clean-sounding name ("Sven", "Karel", "Bevers") tells you nothing. The profile does. Always run `mp_profile.py --name X --id Y` on any short-listed candidate before bidding.

The tag returned (`INFORMED-DEALER` / `OCCASIONAL` / `CLUELESS-PRIVATE`) is based on:
- **Review count** — >=30 reviews ⇒ established seller, knows what they sell
- **Category specialisation** — >=80% of visible listings in the target category ⇒ specialist
- **Listing volume** — >=10 visible listings ⇒ active flipper

Concrete from one session:
- "Sven" (€2.000 Vaillant) — 25 reviews, 100% in art ⇒ INFORMED specialist, not a clueless heir.
- "Bevers" (€225 Theuns) — 190 reviews, 63% art ⇒ INFORMED brocante operator.
- "Karel" (no-reserve "Schilderij met portret") — 83 reviews, 83% art ⇒ INFORMED art dealer using a deliberately vague title for search traffic.

If the tag is `INFORMED-DEALER`, the margin is already priced out. Don't lose tool-energy on imaging the lot. A real diamond comes from a `CLUELESS-PRIVATE` profile.

### 2. "Bieden / FAST_BID €0" is NOT the same as no-reserve
On Marktplaats a seller can list as "Bieden" (auction-style start at €0) while keeping an unstated **vraagprijs**. That vraagprijs only renders in the detail page, not the listing-array JSON. So `mp_scan.py`'s no-reserve flag (`priceType=="FAST_BID" and priceCents==0`) is *necessary but not sufficient*.

Before treating something as no-reserve, fetch the detail page and look for the vraagprijs/"asking price" field in the page header. The Vaillant case in v2 had `FAST_BID €0` in the JSON and `€2.000,00` shown on the detail page — completely changing what the lot was worth chasing.

### 3. Don't ask the seller for back-of-canvas/macros *before* the price is agreed
Every information request signals "I think this might be valuable" and raises the seller's anchor. The right sequence is:
1. Stealth-DM with a clean low offer (no compliments, no questions)
2. Negotiate price
3. **At pickup**: inspect back, signature, condition in person. Renegotiate or walk if something's off.

Asking for caseback/back-of-canvas before money was on the table reliably blew price targets up by 2–5× in this session's tests.

### 4. DM offer > public bid on "Bieden" lots
Public bids in the auction sidebar are visible to other watchers and trigger them. A direct DM with an offer is private — the seller can accept and close the listing without alerting competitors. Sample (kept laconic, no enthusiasm, no questions):
> *"Hoi, interesse in je schilderij. Wat denk je van €75? Kan deze week ophalen."*

### 5. Watches are a categorically harder hunt than paintings
Don't translate the painting playbook to watches without these adjustments:
- **Brand is on the dial** ⇒ no information asymmetry — every seller of an Omega/Rolex knows it is one. The painting equivalent (an unidentified hand) doesn't exist for watches.
- **"Big brand at near-zero price" = replica/scam**, almost always. "Nieuwe Rolex Datejust voor €0 no-reserve" with a clean-named seller is the textbook drop-shipping replica pattern. Skip.
- **Dial says "Automatic" + description admits "quartz" inside** ⇒ instant fake or franken-watch tell.
- **The watch asymmetry that does exist** is in references/calibres (a seller knowing "Seiko" but not "6105-8110"), or in correctly-priced vintage in the wrong sub-category (men's vintage in `horloges-dames`).
- For pocket watches: silver-content stamp gives a floor; informed sellers will name it (e.g. "0.800 Zwitsers"). Vague title + visible solid silver = the cleanest play.

### 6. The "Old Master signature" trap
A signature reading like `R. Ruysdael` on a 20th-century Indonesian portrait does *not* mean you've found a Ruysdael — it's a decorative faux-master signature or a later-added attribution attempt. Same for `F. Hals`, `Rembrandt`, etc. on works that aren't stylistically/temporally consistent. These signatures are a **liability**, not an asset: an experienced buyer at resale will discount precisely because they look "added".

### 7. Dealer-name regex is necessary but not sufficient
Profile-check supersedes the regex. But still apply it as an early-stage cheap filter, and keep growing the list. Patterns caught in v2:
- Direct keywords: `kunst|gallery|galer|atelier|antiek|antique|vintage|brocante|curiosa|schilderij|veiling|dealer|trade|shop|winkel|estate`
- Subtle: `voordeel`, `bijou`, `elegant`, `timeless`, `object`, `outlet`, `boutiq`, `abito`, `capri`, `emporio`
- Watch-specific: `rolex|horloge|watch|uurwerk|tijd|klok|swiss|tudor|omega|breitling|cartier|tag|panerai|seiko|chrono|estate`
- A seller literally called **"Rolex"** in the Cartier-vintage horloge category — caught by the regex but only because we expanded it.

### 8. Frequency-based flipper detection
In-snapshot count of >=4 listings by the same seller in a fresh sweep = flipper. Drop them, regardless of name. This catches the "DvdV", "Antique Boutiquen", "Voordeelsieraden" patterns.

### 9. Templated CAPSLOCK titles
Strings like `PRACHTIGE 925 ZILVEREN OORKNOPPEN MET BLAUWTOPAAS EDELSTENEN` are flipper-template signatures (consistent caps + Pinterest-keyword stuffing). Pattern: `^[A-Z]{4,}\s+[A-Z]{4,}`. Drop.

### 10. The "named master" trap
Sellers who name a famous artist (Hoppenbrouwers, Ronner-Knip, etc.) in the title and stand firm on €1.500–2.000 are *informed*, not lucky-clueless. The Hoppenbrouwers and Vaillant case studies in this session both showed: at €2.000 ask, even if genuine, the realistic resale margin after auction commission was €0–200. Walk away unless you're buying for yourself.

The truly clueless equivalent does exist but looks like:
- Title: `Antiek 17e/18e Eeuws Portret` (vague era range)
- No artist name
- No-reserve OR very low fixed
- **And the profile-check returns CLUELESS-PRIVATE**

All four conditions must hold. The Vaillant case had the first three but failed on the fourth.

### Worked case studies from v2

| Case | Listing title | Profile | What happened |
|---|---|---|---|
| **Hoppenbrouwers** (paint) | `J.F. Hoppenbrouwers — Maroufle doek op paneel, 1850` | INFORMED | Seller asked €2.000 after bid. Margin too thin after auction commission. Walk away. |
| **Vaillant** (paint) | `Antiek 17e/18e Eeuws Portret Schilderij` (frame label "VAILLANT 1623-1677") | INFORMED (25 reviews, 100% kunst) | Listing JSON said `FAST_BID €0`; detail page said vraagprijs €2.000. Hidden vraagprijs trap + informed seller. |
| **Theuns** (paint) | `Oud schilderij gesigneerd Johannes Jan Theuns` (Breda's Rembrandt) | INFORMED (190 reviews, 63% kunst) | Floor at €225 ophalen. Workable as a small flip (~€100-200 EV), not a diamond. |
| **Roelandt** (paint) | `groot oud schilderij landschap schemerlicht gesigneerd` (DUSK) | (untagged) | Signature read after macro: minor 20th-c. Belgian/Dutch (Casimir Roelandt or J.C. Roelandse). Décor tier €30-250. Signature reading saved a €100+ misbet. |
| **Poggenbeek** (paint) | `Aquarel Geo Poggenbeek` (no-reserve) | OCCASIONAL | Real Hague School, but aquarel realisations modest (€400-495). Worth a small bid, not a diamond. |
| **"Horloge" €60** (watch) | Just `Horloge` (clean private name jeroenjdmx) | CLUELESS-PRIVATE | Dial said `Frederique Constant Geneve Automatic`. *But* description admitted "loopt als een automaat, bevat quartz uurwerk" — the FC dial + quartz movement = textbook replica. Wiped out the €60 thesis. |
| **"Cartier vintage"** (watch) | `Cartier vintage horloge` (no-reserve) | INFORMED | Seller literally named **Rolex**. Dealer pattern caught by name regex. |

---

## The core thesis
A painting is undervalued when **what it is** is worth far more than **what it's listed for**. That gap appears when the seller doesn't know what they have. So you are hunting for a mismatch between *quality/attribution* and *price/description*.

Two ways the gap appears:
1. **Clueless seller, anonymous quality work** — generic title ("oud schilderij", "schilderijtje op doek", just "schilderij"), priced as decoration, but the image shows a genuinely accomplished painting, often signed.
2. **Clueless/indifferent seller, named listed artist** — the title names an artist with a real auction market, but it's at no-reserve "Bieden" (€0 FAST_BID) or a low fixed price, with no sign the seller researched the value.

## What to skip (and why)
- **DAGTOPPER (promoted) listings** — the seller paid to promote it, so they've already researched value. Auto-excluded by the scanner.
- **Catawiki / ADMARKT ads** — professional dealer lots, priced at market. Auto-excluded.
- **Informed-seller lots** — the description gives them away. If you see any of these *reseller markers*, the gap is already gone:
  - `getaxeerd`, `geschat`, `taxatie`, `richtprijs`, `richtprijzen`
  - `gekocht veilinghuis`, `Christie's`, `Sotheby's`, auction-house name on the back
  - `echtheidscertificaat`, `certificaat`
  - `vermeld in BENEZIT / PIRON / Scheen`, "afgebeeld in catalogus", "staat in boek"
  These sellers price at or above market — fair-market resale, not a diamond.
- **Not-an-original (medium flags)** — if title OR description contains:
  - `zeefdruk` (silkscreen), `litho`/`lithografie`, `ets` (etching), `gravure`, `print`, `poster`, `reproductie`, `repro`, `giclée`/`giclee`, `canvas print`
  - `kopie` (copy), `naar ...` (after ...), `in de stijl van` / `stijl ...` (in the manner of), `nageschilderd`
  - `afbeelding` (image/picture — usually a reproduction)
  These are decorative multiples or copies. A "signed numbered zeefdruk" by a famous name (Corneille, Rob Scholte) is a print worth €100–600, not a painting.

## The strongest positive signals
- `priceType=="FAST_BID"` and `priceCents==0` → **no-reserve "Bieden"**. Can close for very little.
- **Life-dates in the title** (`(1873-1944)`) → seller is quoting a *listed* artist. Combined with no-reserve and no reseller markers = investigate hard.
- **Vague/generic title** + visibly quality painting in the image = classic clueless seller.
- **A period dealer/gallery label or auction sticker on the back** = genuine provenance through the art trade (raises authenticity odds). (But an auction sticker can also mean the seller bought it there — read the description.)

## Triage scoring (what `mp_scan.py` does, title-only)
Per listing: start at 0.
- no-reserve (FAST_BID & €0): **+3**
- life-dates in title: **+2**
- name-like (e.g. `A.J. Surname`, or `Firstname Surname`): **+1**
- vague/generic art title ("schilderij", "oud schilderij", "antiek ... op paneel", "schilderijtje"): **+1**
- low price (≤ €100 or no-reserve): **+1**
- medium flag in title (print/litho/zeefdruk/repro/kopie/poster/ets/giclée/afbeelding): **−5**

Sort by score desc, then price asc. This is only triage — the real decision needs the image, the description, and a value lookup.

## Judging the image
- **Quality tier:** is it competent/academic/period (good), or flat/clumsy/hobbyist/decorative (skip)?
- **Medium:** real oil/canvas weave & impasto vs. flat printed surface (look for halftone dots / uniform sheen = print).
- **Age cues:** craquelure, darkened varnish, old stretcher/panel, period frame, foxing on works on paper.
- **Signature:** zoom the corners. Marktplaats photos cap ~768–1200px, so a signature on a big canvas may be ~30px and unreadable — then the buyer must ask the seller for a macro before committing real money.
- **Cross-contamination:** the per-detail-page scrape can pull the seller's *other* items (carpets, furniture, other paintings). Trust the search-array main image and `og:image`.

## Value verification (always do this for €1k claims)
Search realized prices, not asking prices:
- `kunstveiling.nl` (NL auctions, has "veilingresultaten"), `simonis-buunk` (quality HagueSchool dealer, retail), `invaluable.com`, `mutualart.com`, `barnebys.com`, Catawiki *realized* lots, `lot-art.com`.
- Note size and medium: oils >> works on paper >> prints. A master's small oil sketch can still be €2k+; a large decorative canvas by an unknown is €100–300.

## Authentication risk (forgery-prone names)
Treat famous, cheaply-listed names with heavy skepticism — they are the most copied/faked:
- Henriëtte Ronner-Knip, the Maris brothers (Jacob/Matthijs/Willem), H.W. Mesdag, Anton Mauve, Jozef Israëls, Breitner, Corneille, Steinlen, Utrillo, and any "Old Master".
- A €395 "J. Maris" or €70 "Mesdag" is almost always a copy or a bears-the-signature work. Possible huge payoff, low probability — treat as a lottery ticket, never overpay, and demand provenance.

## The twin-composition test (the killer filter)
Before believing a find: reverse-image-search it, and scan the seller's other ads.
- **Same physical photo on two listings** → relisting, stolen photo, or scam.
- **Same composition, two different actual paintings** → **decorative production work**. From ~1890–1950 there was a large industry of repeated cozy genre scenes ("moeder in de keuken" interiors after Bernard de Hoog, etc.), signed with minor or invented names and copied many times. Repetition = not rare = not valuable. Kill it.

## Where the freshest diamonds hide
Beyond the first ~20 pages of a popular category, listings skew to informed resellers. Better hunting grounds:
- Estate / `nalatenschap` / `boedel` lots.
- General `Antiek | Schilderijen` and regional/garage-sale categories where sellers don't art-research at all.
- Newest-first sorting (fresh mistakes get sniped fast).
