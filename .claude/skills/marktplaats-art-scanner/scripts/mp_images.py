#!/usr/bin/env python3
"""
mp_images.py - Download Marktplaats listing photos at max resolution, build contact
sheets, and zoom signature corners. Requires Pillow (pip install Pillow).

Examples:
  # download every gallery photo for a listing (via chromepilot) + contact sheet
  python3 mp_images.py --id m2402070059 --backend chromepilot --sheet

  # download specific image UUIDs
  python3 mp_images.py --uuids e4e4ce85-... 5a2b2661-... --sheet

  # zoom a signature corner of a downloaded file (br/bl/tr/tl)
  python3 mp_images.py --file downloads/m2402070059_1.jpg --sig br

  # numbered board from a list of files
  python3 mp_images.py --board img1.jpg img2.jpg img3.jpg --labels "Hoppenbrouwers EUR0" "Ronner EUR0" ...
"""
import argparse, json, os, re, ssl, sys, urllib.request

CHROMEPILOT = "http://127.0.0.1:9223"
IMG = "https://images.marktplaats.com/api/v1/hz-mp-pro-listing/images/{uuid}?rule=ecg_mp_eps$_87.jpg"
OUT = "downloads"
# Marktplaats CDN may sit behind a TLS-inspecting proxy in some sandboxes:
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def _post(path, body, timeout=60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(CHROMEPILOT + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def gallery_uuids_via_chromepilot(item_id, wait=2000):
    """Resolve a listing's VIP url then scrape its carousel image UUIDs.
    NOTE: marktplaats mixes the seller's OTHER lots into the page; the FIRST
    uuid (og:image) is the true main image, later ones may be cross-contamination."""
    # find vipUrl by hitting the search for this id is unreliable; instead try the
    # canonical short path which 301s to the slug:
    _post("/navigate", {"url": f"https://www.marktplaats.nl/v/a/a/{item_id}", "waitMs": wait})
    expr = (r"""(function(){
      var og=document.querySelector('meta[property="og:image"]');
      og=og?(og.content.split('/images/')[1]||'').split('?')[0].replace(/^..\//,''):'';
      var c=[].slice.call(document.querySelectorAll('figure img,[class*=Gallery] img,[class*=Carousel] img,[class*=Thumbnail] img'))
        .map(function(i){return i.src;}).filter(function(s){return s.indexOf('/images/')>-1;})
        .map(function(s){return s.split('/images/')[1].split('?')[0].replace(/^..\//,'');});
      var seen={},out=[]; if(og){seen[og]=1;out.push(og);}
      c.forEach(function(u){if(!seen[u]){seen[u]=1;out.push(u);}});
      return JSON.stringify(out);
    })()""")
    res = _post("/eval", {"expression": expr})
    return json.loads(res.get("result") or "[]")


def download(uuid, dest):
    url = IMG.format(uuid=uuid)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
        data = r.read()
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def contact_sheet(files, out_path, cols=3, th=300):
    from PIL import Image, ImageDraw, ImageFont
    def fit(im): s = th / im.height; return im.resize((int(im.width * s), th))
    ims = [(f, fit(Image.open(f).convert("RGB"))) for f in files]
    rows = (len(ims) + cols - 1) // cols; pad = 8; lh = 18
    cw = max(i.width for _, i in ims)
    sheet = Image.new("RGB", (cols * cw + pad * (cols + 1), rows * (th + lh) + pad), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    try: fo = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
    except Exception: fo = ImageFont.load_default()
    for idx, (f, im) in enumerate(ims):
        r = idx // cols; c = idx % cols
        x = pad + c * (cw + pad) + (cw - im.width) // 2; y = pad + r * (th + lh)
        sheet.paste(im, (x, y)); d.text((pad + c * (cw + pad), y + th + 2), os.path.basename(f)[:34], fill=(240, 220, 120), font=fo)
    sheet.save(out_path); print("sheet ->", out_path)


def sig_crop(path, corner, out_path):
    from PIL import Image, ImageEnhance
    im = Image.open(path).convert("RGB"); W, H = im.size
    boxes = {
        "br": (0.62, 0.66, 0.95, 0.80), "bl": (0.04, 0.66, 0.40, 0.80),
        "tr": (0.62, 0.04, 0.95, 0.20), "tl": (0.04, 0.04, 0.40, 0.20),
    }
    b = boxes[corner]
    c = im.crop((int(W * b[0]), int(H * b[1]), int(W * b[2]), int(H * b[3])))
    c = c.resize((c.width * 6, c.height * 6), Image.LANCZOS)
    c = ImageEnhance.Contrast(c).enhance(1.5)
    c = ImageEnhance.Sharpness(c).enhance(2.0)
    c.save(out_path); print("signature crop ->", out_path, "(read it; <=768px source may be unreadable)")


def board(files, labels, out_path, cols=4, TW=300, TH=230):
    from PIL import Image, ImageDraw, ImageFont
    labels = (labels or []) + [""] * (len(files) - len(labels or []))
    rows = (len(files) + cols - 1) // cols; pad = 8; capH = 40
    cellW, cellH = TW + pad, TH + capH + pad
    sheet = Image.new("RGB", (cols * cellW + pad, rows * cellH + pad), (16, 16, 18))
    d = ImageDraw.Draw(sheet)
    try:
        fnum = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
        fcap = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 13)
    except Exception:
        fnum = fcap = ImageFont.load_default()
    for idx, f in enumerate(files):
        r = idx // cols; c = idx % cols
        x0 = pad + c * cellW; y0 = pad + r * cellH
        try: im = Image.open(f).convert("RGB")
        except Exception: im = Image.new("RGB", (TW, TH), (60, 60, 60))
        s = min(TW / im.width, TH / im.height); im = im.resize((int(im.width * s), int(im.height * s)))
        sheet.paste(im, (x0 + (TW - im.width) // 2, y0 + (TH - im.height) // 2))
        d.rectangle([x0, y0, x0 + 34, y0 + 30], fill=(200, 40, 40))
        d.text((x0 + 6, y0 + 2), str(idx + 1), fill=(255, 255, 255), font=fnum)
        d.multiline_text((x0 + 2, y0 + TH + 2), labels[idx][:60], fill=(240, 222, 120), font=fcap, spacing=2)
    sheet.save(out_path); print("board ->", out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", help="listing id (resolve gallery via chromepilot)")
    ap.add_argument("--uuids", nargs="*", help="image UUIDs to download")
    ap.add_argument("--backend", choices=["http", "chromepilot"], default="chromepilot")
    ap.add_argument("--sheet", action="store_true", help="build a contact sheet of downloads")
    ap.add_argument("--file", help="zoom a signature corner of this existing file")
    ap.add_argument("--sig", choices=["br", "bl", "tr", "tl"], help="which corner")
    ap.add_argument("--board", nargs="*", help="files to lay out as a numbered board")
    ap.add_argument("--labels", nargs="*", help="captions for --board")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    if args.file and args.sig:
        sig_crop(args.file, args.sig, os.path.splitext(args.file)[0] + f"_sig_{args.sig}.png")
        return
    if args.board:
        board(args.board, args.labels, os.path.join(args.out, "board.png"))
        return

    uuids = list(args.uuids or [])
    if args.id and args.backend == "chromepilot":
        uuids = gallery_uuids_via_chromepilot(args.id) or uuids
        print(f"resolved {len(uuids)} gallery uuids (first = true main; rest may be other lots)")
    if not uuids:
        print("nothing to download (give --uuids or --id with chromepilot)", file=sys.stderr); return

    files = []
    tag = args.id or "img"
    for i, u in enumerate(uuids, 1):
        dest = os.path.join(args.out, f"{tag}_{i}.jpg")
        try:
            n = download(u, dest); files.append(dest)
            print(f"  {dest}  ({n} bytes)")
        except Exception as e:
            print(f"  FAILED {u}: {e}", file=sys.stderr)
    if args.sheet and files:
        contact_sheet(files, os.path.join(args.out, f"{tag}_sheet.png"))


if __name__ == "__main__":
    main()
