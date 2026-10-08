#!/usr/bin/env python3
"""Busca imagenes en zebra.com / izc por modelos sin foto en catalogo."""
from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / "assets" / "files"
CATALOG = FILES / "catalogo.json"
DETAILS = FILES / "product_details.json"
REFS = FILES / "referencias.json"
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
}

def is_placeholder(url: str) -> bool:
    u = (url or "").lower().strip()
    if not u:
        return True
    if "imgmarcas" in u or "distributor" in u or "placeholder" in u or "logo" in u:
        return True
    if "catalog/product" not in u and "zebra.com" not in u and "webp_image/catalog" not in u:
        return True
    return False

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")

def first_zebra_img(html: str) -> str:
    # Prefer product DAM images
    pats = [
        r'https://www\.zebra\.com/content/dam/[^"\s>]+\.(?:jpg|jpeg|png|webp)',
        r'https://[^"\s>]*zebra[^"\s>]*\.(?:jpg|jpeg|png|webp)',
        r'//www\.zebra\.com/content/dam/[^"\s>]+\.(?:jpg|jpeg|png|webp)',
    ]
    for pat in pats:
        for u in re.findall(pat, html, re.I):
            if u.startswith("//"):
                u = "https:" + u
            ul = u.lower()
            if any(x in ul for x in ("logo", "icon", "sprite", "favicon", "placeholder", "banner")):
                continue
            if "/content/dam/" in ul or "product" in ul:
                return u.split("?")[0]
    return ""

def search_zebra(query: str) -> str:
    url = "https://www.zebra.com/us/en/search.html?q=" + urllib.parse.quote(query)
    try:
        html = fetch(url)
    except Exception as e:
        print("  zebra search ERR", query, e, flush=True)
        return ""
    img = first_zebra_img(html)
    if img:
        return img
    # Follow first product link
    links = re.findall(r'href="(https://www\.zebra\.com/us/en/products/[^"]+)"', html, re.I)
    for link in links[:3]:
        try:
            ph = fetch(link)
            img = first_zebra_img(ph)
            if img:
                return img
        except Exception:
            continue
        time.sleep(0.2)
    return ""

def search_izc(query: str) -> str:
    url = "https://izc.com.co/es/catalogsearch/result/?q=" + urllib.parse.quote(query)
    try:
        html = fetch(url)
    except Exception as e:
        print("  izc ERR", query, e, flush=True)
        return ""
    imgs = re.findall(
        r'(?:src|data-src)="((?:https://izc\.com\.co)?/pub/media/(?:catalog/product|webp_image/catalog)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
        html,
        re.I,
    )
    for u in imgs:
        if "placeholder" in u.lower() or "distributor" in u.lower():
            continue
        if u.startswith("/"):
            u = "https://izc.com.co" + u
        return u
    return ""

def main() -> None:
    try:
        import sys
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    details = json.loads(DETAILS.read_text(encoding="utf-8")) if DETAILS.exists() else {}
    refs = json.loads(REFS.read_text(encoding="utf-8")) if REFS.exists() else {}
    products = catalog.get("products") or []
    zebra = [p for p in products if str(p.get("brand") or "").lower() == "zebra"]
    missing = [p for p in zebra if is_placeholder(str(p.get("img") or ""))]
    print("missing", len(missing), flush=True)

    # Queries priorizadas por familia
    family_queries = {
        "MC3300": "MC3300 zebra",
        "MC3400": "MC3400 zebra",
        "MC34": "MC3400 zebra",
        "TC8000": "TC8000 zebra",
        "TC8300": "TC8300 zebra",
        "TC8X": "TC8000 zebra",
        "DS3678": "DS3678 zebra",
        "FX9600": "FX9600 zebra",
        "ZQ220": "ZQ220 zebra",
        "ZD621": "ZD621 zebra",
        "ET40": "ET40 zebra",
        "ET401": "ET40 zebra tablet",
        "ZXP": "ZXP zebra card",
        "OneCare": "zebra onecare",
    }

    family_img: dict[str, str] = {}
    for key, q in family_queries.items():
        img = search_izc(q) or search_zebra(q)
        print(f"family {key}: {'OK' if img else '—'} {img[:90]}", flush=True)
        if img:
            family_img[key] = img
        time.sleep(0.25)

    updated = 0
    for p in missing:
        sku = str(p.get("sku") or "")
        name = str(p.get("name") or "")
        blob = (name + " " + str(refs.get(sku) or "")).upper()
        img = ""
        for key, fim in family_img.items():
            if key.upper() in blob.replace(" ", ""):
                img = fim
                break
            if key.upper() in blob:
                img = fim
                break
        # Extra heuristics
        if not img:
            if "ONECARE" in blob:
                img = family_img.get("OneCare") or family_img.get("TC8000") or ""
            elif "CINTA" in blob or "RIBBON" in blob or "ENCERADA" in blob or "RESINA" in blob:
                img = search_izc("ribbon zebra")
            elif "ETIQUETA" in blob or "Z-PERFORM" in blob:
                img = search_izc("etiqueta zebra")
            elif "PULSERA" in blob or "WRIST" in blob:
                img = search_izc("pulsera zebra") or search_izc("wristband zebra")
            elif "TARJETA" in blob or "PVC" in blob or "STK-CARD" in blob:
                img = search_izc("tarjeta zebra pvc")
            elif "ADAPTADOR" in blob or "FUENTE" in blob or "POWERWALL" in blob or "ALIMENT" in blob:
                img = search_izc("adaptador zebra") or search_izc("fuente zebra")
            elif "CORREA" in blob or "HANDSTRAP" in blob:
                img = search_izc("correa zebra") or family_img.get("TC8000") or ""
            elif re.search(r"\bMC33", blob):
                img = family_img.get("MC3300") or ""
            elif "TC8" in blob:
                img = family_img.get("TC8000") or family_img.get("TC8X") or ""
        if not img:
            mpn = str(refs.get(sku) or "").strip()
            if mpn:
                img = search_izc(mpn) or search_zebra(mpn)
                time.sleep(0.2)
        if not img or is_placeholder(img):
            print(f"  {sku} still missing", flush=True)
            continue
        p["img"] = img
        d = details.get(sku) if isinstance(details.get(sku), dict) else {}
        if not isinstance(d, dict):
            d = {}
        d.setdefault("sku", sku)
        d.setdefault("name", name)
        d["source"] = "family-fill"
        d["images"] = [{"full": img, "img": img, "thumb": img}]
        details[sku] = d
        updated += 1
        print(f"  {sku} OK", flush=True)

    # Re-run simple inherit for leftovers that now have family donors
    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DETAILS.write_text(json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    missing_after = sum(
        1
        for p in products
        if str(p.get("brand") or "").lower() == "zebra" and is_placeholder(str(p.get("img") or ""))
    )
    print(f"OK updated={updated} missing_after={missing_after}", flush=True)


if __name__ == "__main__":
    main()
