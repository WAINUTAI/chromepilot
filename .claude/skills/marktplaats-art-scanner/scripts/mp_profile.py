#!/usr/bin/env python3
"""
mp_profile.py — Check a Marktplaats seller's profile to tag them as
informed-dealer / occasional / clueless-private.

This is the single strongest filter in the workflow. A "clean-sounding"
seller name (Sven, Karel, Bevers) tells you nothing — the profile does.

Usage:
  python3 mp_profile.py --name sven --id 38509572
  python3 mp_profile.py --batch candidates.json --target antiek-en-kunst

Tagging rules (default thresholds):
  INFORMED-DEALER : >=30 reviews OR (>=10 visible listings AND >=60% in target_cat)
  OCCASIONAL      : 5-29 reviews OR 3-10 listings
  CLUELESS-PRIVATE: <5 reviews AND <=2 visible listings AND no category dominance
"""
import argparse, json, re, sys, urllib.request
from collections import Counter

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def fetch_profile(name, sid, timeout=30):
    url = f"https://www.marktplaats.nl/u/{name.lower()}/{sid}/"
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "nl-NL,nl;q=0.9"})
    return urllib.request.urlopen(req, timeout=timeout).read().decode("utf-8", "replace")


def analyse(html, target_cat=None):
    reviews = int(m.group(1)) if (m := re.search(r'"numberOfReviews":(\d+)', html)) else 0
    rating  = float(m.group(1)) if (m := re.search(r'"rating":([\d.]+)', html)) else 0.0
    items   = set(re.findall(r'/(m[0-9]{8,12})-', html))
    cats    = re.findall(r'/v/([a-z][a-z-]+)/[a-z-]+/m[0-9]', html)
    cat_counter = Counter(cats)
    target_share = (cat_counter[target_cat] / sum(cat_counter.values())
                    if target_cat and cat_counter else 0.0)
    return {
        "reviews": reviews, "rating": rating,
        "visible_listings": len(items),
        "cat_top": cat_counter.most_common(3),
        "target_cat": target_cat, "target_share": round(target_share, 2),
    }


def tag(info):
    r, n = info["reviews"], info["visible_listings"]
    share = info["target_share"]
    # Informed: high review count OR specialised in target category
    if (r >= 30
            or (r >= 15 and share >= 0.80)         # specialist
            or (n >= 10 and share >= 0.60)):       # high-volume target
        return "INFORMED-DEALER"
    if r >= 5 or n >= 3 or share >= 0.40:
        return "OCCASIONAL"
    return "CLUELESS-PRIVATE"


def check(name, sid, target_cat=None):
    try:
        html = fetch_profile(name, sid)
    except Exception as e:
        return {"name": name, "id": sid, "error": str(e), "tag": "ERR"}
    info = analyse(html, target_cat)
    info.update({"name": name, "id": sid, "tag": tag(info)})
    return info


def main():
    ap = argparse.ArgumentParser(description="Marktplaats seller profile-history check")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--name", help="seller name (lowercased in URL)")
    g.add_argument("--batch", help="JSON file with [{name, id, ...}] entries")
    ap.add_argument("--id", help="seller id (numeric)")
    ap.add_argument("--target", default="antiek-en-kunst",
                    help="category prefix to compute share of (default antiek-en-kunst)")
    args = ap.parse_args()

    if args.name:
        if not args.id:
            print("--id required with --name", file=sys.stderr); sys.exit(2)
        out = [check(args.name, args.id, args.target)]
    else:
        with open(args.batch) as f:
            entries = json.load(f)
        out = [check(e["name"], e["id"], args.target) for e in entries]

    for r in out:
        if r.get("error"):
            print(f"{r['tag']:<18} {r['name']:<20} id={r['id']} ERR {r['error']}")
        else:
            print(f"{r['tag']:<18} {r['name']:<20} id={r['id']} "
                  f"reviews={r['reviews']} listings={r['visible_listings']} "
                  f"target={r['target_cat']} share={r['target_share']}")
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
