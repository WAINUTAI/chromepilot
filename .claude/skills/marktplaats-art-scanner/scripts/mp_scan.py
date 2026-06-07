#!/usr/bin/env python3
"""
mp_scan.py - Sweep a Marktplaats art category, extract private listings, rank candidates.

Drops promoted ("DAGTOPPER") and Catawiki/dealer ("ADMARKT_CONSOLE") ads.
Scores remaining private listings by diamond-likelihood (title-only triage).

Backends:
  --backend http         plain HTTP (default; works when there's no bot/consent wall)
  --backend chromepilot  drive the chromepilot server on 127.0.0.1:9223 (robust)

Examples:
  python3 mp_scan.py --base "https://www.marktplaats.nl/l/antiek-en-kunst/kunst-schilderijen-klassiek/" --pages 1-25
  python3 mp_scan.py --base "<url>" --pages 1-50 --backend chromepilot --out candidates.json --min-score 3
"""
import argparse, json, re, sys, time, urllib.request

CHROMEPILOT = "http://127.0.0.1:9223"

MEDIUM_FLAGS = re.compile(
    r"\b(zeefdruk|litho|lithografie|ets|gravure|print|poster|reproductie|repro|gicl[ée]e?|"
    r"kopie|naar |in de stijl van|stijl |nageschilderd|afbeelding|canvas\s?print)\b", re.I)
VAGUE_TITLE = re.compile(
    r"^(schilderij(tje)?|oud(e)? schilderij(tje)?|antiek(e)? schilderij(tje)?|"
    r".*schilderij op (doek|paneel|canvas)|olieverf(schilderij)?|aquarel)$", re.I)
LIFE_DATES = re.compile(r"\b1[6-9]\d\d\b")
NAME_INITIALS = re.compile(r"\b[A-Z]\.\s?[A-Z][a-z]+")
NAME_TWOWORD = re.compile(r"\b[A-Z][a-z]{2,}\s[A-Z][a-z]{3,}")


def _post(path, body, timeout=60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(CHROMEPILOT + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def fetch_next_data(url, backend, wait=1500):
    """Return the parsed __NEXT_DATA__ dict for a Marktplaats page."""
    if backend == "chromepilot":
        _post("/navigate", {"url": url, "waitMs": wait})
        res = _post("/eval", {"expression":
            "document.getElementById('__NEXT_DATA__')?"
            "document.getElementById('__NEXT_DATA__').textContent:''"})
        txt = res.get("result", "") or ""
        if not txt.strip():
            raise RuntimeError("chromepilot returned no __NEXT_DATA__ (page not loaded?)")
        return json.loads(txt)
    # http
    req = urllib.request.Request(url, headers={
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError("no __NEXT_DATA__ in HTML (bot/consent wall). Try --backend chromepilot")
    return json.loads(m.group(1))


def listings_of(data):
    return data["props"]["pageProps"]["searchRequestAndResponse"]["listings"]


def is_private(x):
    return (x.get("priorityProduct") == "NONE"
            and "ADMARKT_CONSOLE" not in (x.get("traits") or []))


def score(x):
    t = x.get("title", "")
    pi = x.get("priceInfo") or {}
    eur = (pi.get("priceCents") or 0) / 100
    ptype = pi.get("priceType")
    no_reserve = (ptype == "FAST_BID" and (pi.get("priceCents") or 0) == 0)
    s, why = 0, []
    if MEDIUM_FLAGS.search(t):
        s -= 5; why.append("print/copy")
    if no_reserve:
        s += 3; why.append("no-reserve")
    if LIFE_DATES.search(t):
        s += 2; why.append("life-dates")
    if NAME_INITIALS.search(t) or NAME_TWOWORD.search(t):
        s += 1; why.append("named")
    if VAGUE_TITLE.match(t.strip()):
        s += 1; why.append("vague-title")
    if no_reserve or eur <= 100:
        s += 1; why.append("low-price")
    return s, eur, ptype, why


def parse_pages(spec):
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-"); out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def main():
    ap = argparse.ArgumentParser(description="Marktplaats art scanner")
    ap.add_argument("--base", required=True, help="Category URL ending in /")
    ap.add_argument("--pages", default="1-10", help="e.g. 1-25 or 1,2,5")
    ap.add_argument("--backend", choices=["http", "chromepilot"], default="http")
    ap.add_argument("--out", help="write full candidate JSON here")
    ap.add_argument("--min-score", type=int, default=2)
    ap.add_argument("--wait", type=int, default=1500, help="chromepilot waitMs")
    ap.add_argument("--sleep", type=float, default=0.5, help="seconds between pages (http)")
    args = ap.parse_args()

    base = args.base if args.base.endswith("/") else args.base + "/"
    seen = {}
    for p in parse_pages(args.pages):
        url = f"{base}p/{p}/"
        try:
            data = fetch_next_data(url, args.backend, args.wait)
            ls = listings_of(data)
        except Exception as e:
            print(f"[p{p}] ERROR: {e}", file=sys.stderr)
            continue
        priv = [x for x in ls if is_private(x)]
        for x in priv:
            x["_page"] = p
            seen[x["itemId"]] = x
        print(f"[p{p}] {len(ls)} listings, {len(priv)} private", file=sys.stderr)
        if args.backend == "http":
            time.sleep(args.sleep)

    rows = []
    for x in seen.values():
        s, eur, ptype, why = score(x)
        rows.append({
            "score": s, "eur": eur, "priceType": ptype,
            "id": x["itemId"], "title": x.get("title", ""),
            "seller": (x.get("sellerInformation") or {}).get("sellerName"),
            "city": (x.get("location") or {}).get("cityName"),
            "page": x["_page"], "why": ",".join(why),
            "url": "https://www.marktplaats.nl" + x.get("vipUrl", ""),
            "img": ((x.get("imageUrls") or [None])[0] or "").split("/images/")[-1].split("?")[0],
        })
    rows.sort(key=lambda r: (-r["score"], r["eur"]))

    shown = [r for r in rows if r["score"] >= args.min_score]
    print(f"\n=== {len(seen)} private listings | {len(shown)} candidates (score>={args.min_score}) ===")
    for r in shown:
        print(f"  [{r['score']:+d}] EUR{r['eur']:>6.0f} {r['priceType'] or '':<13} "
              f"{r['title'][:60]:<60} | {r['id']} p{r['page']} ({r['why']})")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=2, ensure_ascii=False)
        print(f"\nwrote {len(rows)} rows -> {args.out}")


if __name__ == "__main__":
    main()
