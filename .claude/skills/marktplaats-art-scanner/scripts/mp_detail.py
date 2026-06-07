#!/usr/bin/env python3
"""
mp_detail.py - Fetch a listing's description + main image, and auto-flag it.

Flags MEDIUM (print/copy -> not an original) and RESELLER (informed seller -> no gap).
These two checks kill most false positives before you waste time on images.

Examples:
  python3 mp_detail.py --url "https://www.marktplaats.nl/v/.../m2402070059-..." --backend chromepilot
  python3 mp_detail.py --id m2402070059 --backend chromepilot
"""
import argparse, json, re, sys, urllib.request

CHROMEPILOT = "http://127.0.0.1:9223"

MEDIUM = re.compile(
    r"\b(zeefdruk|litho|lithografie|ets\b|gravure|print|poster|reproductie|repro\b|gicl[ée]e?|"
    r"kopie|naar |in de stijl van|stijl |nageschilderd|afbeelding|canvas\s?print)\b", re.I)
RESELLER = re.compile(
    r"\b(getaxeerd|taxatie|geschat|richtprijs|richtprijzen|gekocht veilinghuis|christie'?s|"
    r"sotheby'?s|echtheidscertificaat|certificaat|b[ée]n[ée]zit|piron|scheen|afgebeeld in)\b", re.I)
PROVENANCE = re.compile(r"\b(kunsthandel|galerie|veilinghuis|nalatenschap|erfenis|label|stempel)\b", re.I)


def normalize(s):
    """Marktplaats jams description fields together ('GenummerdZeefdrukAfmeting').
    Insert spaces at camelCase / letter-digit boundaries so \\b regexes work."""
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", s)
    s = re.sub(r"(?<=\d)(?=[A-Za-z])", " ", s)
    return s


def _post(path, body, timeout=60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(CHROMEPILOT + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


EXPR = (r"""(function(){
  var d=document.querySelector("[class*=Description]");
  var desc=d?d.textContent:"";
  var og=document.querySelector('meta[property="og:image"]');
  og=og?og.content:"";
  return JSON.stringify({
    title:document.title,
    desc:desc.replace(/\s+/g," ").replace("Beschrijving","").trim(),
    img:(og.split("/images/")[1]||"").split("?")[0].replace(/^..\//,"")
  });
})()""")


def fetch_detail(url, backend, wait=2000):
    if backend == "chromepilot":
        _post("/navigate", {"url": url, "waitMs": wait})
        res = _post("/eval", {"expression": EXPR})
        return json.loads(res.get("result") or "{}")
    req = urllib.request.Request(url, headers={
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
        "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        html = r.read().decode("utf-8", "replace")
    title = (re.search(r"<title>(.*?)</title>", html, re.S) or [None, ""])[1].strip()
    og = (re.search(r'property="og:image" content="([^"]+)"', html) or [None, ""])[1]
    # description from JSON-LD or meta as a fallback
    desc = (re.search(r'"description":"(.*?)"', html) or [None, ""])[1][:1500]
    img = (og.split("/images/")[-1].split("?")[0]).split("/")[-1]
    return {"title": title, "desc": desc, "img": img}


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--url")
    g.add_argument("--id", help="listing id; needs chromepilot to resolve, or pass --url")
    ap.add_argument("--backend", choices=["http", "chromepilot"], default="chromepilot")
    ap.add_argument("--wait", type=int, default=2000)
    args = ap.parse_args()

    url = args.url
    if not url and args.id:
        # best-effort: a plain /q search redirect isn't reliable; require chromepilot search
        print("Tip: pass --url for reliability. Trying generic VIP path...", file=sys.stderr)
        url = f"https://www.marktplaats.nl/v/a/a/{args.id}"

    d = fetch_detail(url, args.backend, args.wait)
    desc = normalize(d.get("desc", ""))
    print("TITLE:", d.get("title", "")[:90])
    print("IMG  :", d.get("img", ""))
    print("DESC :", desc[:700])
    print()
    med = MEDIUM.findall(desc)
    res = RESELLER.findall(desc)
    prov = PROVENANCE.findall(desc)
    verdict = []
    if med:
        verdict.append(f"!! MEDIUM FLAG ({','.join(set(m.strip() for m in med))}) -> probably NOT an original painting")
    if res:
        verdict.append(f"!! RESELLER MARKER ({','.join(set(r.lower() for r in res))}) -> informed seller, gap likely gone")
    if prov:
        verdict.append(f".. provenance words ({','.join(set(p.lower() for p in prov))}) -> check if dealer label (good) or 'bought there' (priced)")
    if not verdict:
        verdict.append("OK: no medium/reseller flags in description -> worth imaging + value lookup")
    print("VERDICT:")
    for v in verdict:
        print("  " + v)


if __name__ == "__main__":
    main()
