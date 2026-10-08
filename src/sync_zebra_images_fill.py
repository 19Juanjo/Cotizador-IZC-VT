#!/usr/bin/env python3
"""Completa imagenes Zebra faltantes: brand pages + MPN + herencia por modelo."""
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
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-CO,es;q=0.9",
}
BASE = "https://izc.com.co"

MODEL_RE = re.compile(
    r"\b(TC\d{2,4}[A-Z0-9\-]*|MC\d{3,4}[A-Z0-9\-]*|LS\d{3,4}|DS\d{3,4}[A-Z0-9\-]*|"
    r"ZD\d{2,4}[A-Z0-9\-]*|ZT\d{2,4}[A-Z0-9\-]*|ZQ\d{2,4}[A-Z0-9\-]*|"
    r"ZC\d{2,4}|ZXP\d|FX\d{4}|TC8X|TC8\d{2,3})\b",
    re.I,
)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read().decode("utf-8", "replace")


def abs_url(url: str) -> str:
    href = (url or "").strip()
    if not href:
        return ""
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return BASE + href
    return href


def is_placeholder(url: str) -> bool:
    u = (url or "").lower().strip()
    if not u:
        return True
    if "imgmarcas" in u or "iconoizc" in u or "placeholder" in u:
        return True
    if "zebra_distributor" in u or "distributor.webp" in u or "distributor.jpg" in u:
        return True
    if "logo" in u and "catalog/product" not in u:
        return True
    if u.endswith("zebra.png") or "/zebra.png" in u:
        return True
    if "catalog/product" not in u and "webp_image/catalog" not in u:
        return True
    return False


def parse_search_page(html: str) -> list[dict]:
    out: list[dict] = []
    for m in re.finditer(r"Sku:\s*([0-9]{3,8}(?:-[0-9]{3,8})*)", html, re.I):
        sku = m.group(1).strip()
        sku_main = sku.split("-")[0]
        start = max(0, m.start() - 4000)
        chunk = html[start : m.end() + 500]
        imgs = re.findall(
            r'(?:src|data-src)="((?:https://izc\.com\.co)?/pub/media/(?:catalog/product|webp_image/catalog)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
            chunk,
            re.I,
        )
        imgs = [
            abs_url(u)
            for u in imgs
            if "placeholder" not in u.lower() and "distributor" not in u.lower() and "/og_image/" not in u.lower()
        ]
        if not imgs:
            continue
        hrefs = re.findall(r'href="((?:https://izc\.com\.co)?/es/[^"]+\.html)"', chunk, re.I)
        href = ""
        for h in hrefs:
            h = abs_url(h)
            if "catalogsearch" in h or "customer" in h:
                continue
            href = h
            break
        alt = re.search(r'alt="([^"]{8,200})"', chunk)
        name = alt.group(1).strip() if alt else ""
        img = imgs[0]
        for cand in imgs:
            if not re.search(r"-\d+\.(jpg|jpeg|png|webp)", cand, re.I):
                img = cand
                break
        out.append({"sku": sku_main, "sku_raw": sku, "img": img, "url": href, "name": name})
    return out


def harvest_url(url: str, by_sku: dict[str, dict]) -> int:
    try:
        html = fetch(url)
    except Exception as exc:
        print(f"  FAIL {url}: {exc}", flush=True)
        return 0
    added = 0
    for row in parse_search_page(html):
        sku = row["sku"]
        if sku not in by_sku:
            by_sku[sku] = row
            added += 1
        elif is_placeholder(by_sku[sku].get("img", "")) and row.get("img"):
            by_sku[sku] = row
    return added


def harvest_brand(by_sku: dict[str, dict]) -> None:
    first = f"{BASE}/es/brand/zebra"
    html = fetch(first)
    pages = [int(p) for p in re.findall(r"[?&]p=(\d+)", html)]
    maxp = max(pages) if pages else 1
    maxp = min(maxp, 20)
    print(f"brand zebra pages~{maxp}", flush=True)
    for page in range(1, maxp + 1):
        url = first if page == 1 else f"{first}?p={page}"
        if page > 1:
            time.sleep(0.2)
        n = harvest_url(url, by_sku)
        print(f"  brand p={page} +{n} total={len(by_sku)}", flush=True)


def harvest_query(query: str, by_sku: dict[str, dict]) -> None:
    q = urllib.parse.quote(query)
    url = f"{BASE}/es/catalogsearch/result/?q={q}"
    try:
        html = fetch(url)
    except Exception as exc:
        print(f"  FAIL query={query!r}: {exc}", flush=True)
        return
    pages = [int(p) for p in re.findall(r"[?&]p=(\d+)", html)]
    maxp = min(max(pages) if pages else 1, 8)
    for page in range(1, maxp + 1):
        if page > 1:
            url = f"{BASE}/es/catalogsearch/result/?q={q}&p={page}"
            try:
                html = fetch(url)
            except Exception:
                break
            time.sleep(0.2)
        n = 0
        before = len(by_sku)
        for row in parse_search_page(html):
            sku = row["sku"]
            if sku not in by_sku:
                by_sku[sku] = row
                n += 1
            elif is_placeholder(by_sku[sku].get("img", "")) and row.get("img"):
                by_sku[sku] = row
        print(f"  q={query!r} p={page} +{n} total={len(by_sku)}", flush=True)
        if len(by_sku) == before and page > 1:
            break


def models_of(text: str) -> set[str]:
    found = {m.upper() for m in MODEL_RE.findall(text or "")}
    # También base corta: TC21BK -> TC21, MC3300x -> MC3300
    extras: set[str] = set()
    for m in list(found):
        base = re.match(r"^([A-Z]+)(\d{2,4})", m)
        if base:
            extras.add(base.group(1) + base.group(2))
        # TC8X familia
        if m.startswith("TC8"):
            extras.add("TC8X")
            extras.add("TC8000")
    return found | extras


def apply_hit(p: dict, hit: dict, details: dict, source: str) -> None:
    sku = str(p.get("sku") or "")
    img = hit.get("img") or ""
    if not img or is_placeholder(img):
        return
    p["img"] = img
    d = details.get(sku) if isinstance(details.get(sku), dict) else {}
    if not isinstance(d, dict):
        d = {}
    d.setdefault("sku", sku)
    d.setdefault("name", p.get("name") or hit.get("name") or "")
    if hit.get("url"):
        d["url"] = hit["url"]
    d["source"] = source
    d["images"] = [{"full": img, "img": img, "thumb": img}]
    details[sku] = d


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
    missing_before = sum(1 for p in zebra if is_placeholder(str(p.get("img") or "")))
    print(f"Zebra en catalogo: {len(zebra)} | sin imagen: {missing_before}", flush=True)

    by_sku: dict[str, dict] = {}
    harvest_brand(by_sku)

    queries = [
        "zebra",
        "sharecradle",
        "onecare zebra",
        "adaptador zebra",
        "base de carga zebra",
        "bateria zebra",
        "powerprecision",
        "tc21",
        "tc22",
        "tc26",
        "tc27",
        "tc8000",
        "tc8300",
        "mc3300",
        "mc3400",
        "ds3678",
        "fx9600",
        "zd421",
        "zd621",
        "ribbon zebra",
        "pulsera zebra",
        "tarjeta zebra pvc",
    ]
    for q in queries:
        harvest_query(q, by_sku)
        time.sleep(0.15)

    # MPN / referencia fabricante
    missing_now = [
        p
        for p in zebra
        if is_placeholder(str(p.get("img") or "")) and str(p.get("sku") or "").strip()
    ]
    print(f"Busqueda por MPN para {len(missing_now)} faltantes", flush=True)
    for i, p in enumerate(missing_now, 1):
        sku = str(p.get("sku") or "").strip()
        if sku in by_sku and not is_placeholder(by_sku[sku].get("img", "")):
            continue
        mpn = str(refs.get(sku) or "").strip()
        if not mpn:
            continue
        q = urllib.parse.quote(mpn)
        url = f"{BASE}/es/catalogsearch/result/?q={q}"
        try:
            html = fetch(url)
        except Exception as exc:
            print(f"  [{i}] {sku} MPN={mpn} ERR {exc}", flush=True)
            continue
        rows = parse_search_page(html)
        exact = [r for r in rows if r.get("sku") == sku]
        pick = exact[0] if exact else None
        if not pick and rows:
            # Si la busqueda por MPN devolvio 1 producto claro, usarlo.
            if len(rows) == 1:
                pick = rows[0]
            else:
                # Preferir mismo modelo
                ms = models_of(str(p.get("name") or ""))
                for r in rows:
                    if models_of(f"{r.get('name','')} {r.get('url','')}") & ms:
                        pick = r
                        break
        if pick and pick.get("img"):
            by_sku[sku] = {**pick, "sku": sku}
            print(f"  [{i}] {sku} MPN OK", flush=True)
        else:
            print(f"  [{i}] {sku} MPN —", flush=True)
        time.sleep(0.2)

    by_model: dict[str, list[dict]] = {}
    for row in by_sku.values():
        for m in models_of(f"{row.get('name','')} {row.get('url','')}"):
            by_model.setdefault(m, []).append(row)
    for p in zebra:
        img = str(p.get("img") or "")
        if is_placeholder(img):
            continue
        for m in models_of(str(p.get("name") or "")):
            by_model.setdefault(m, []).append({"sku": p.get("sku"), "img": img, "name": p.get("name"), "url": ""})

    updated = 0
    inherited = 0
    for p in products:
        if str(p.get("brand") or "").lower() != "zebra":
            continue
        sku = str(p.get("sku") or "").strip()
        if not sku or not is_placeholder(str(p.get("img") or "")):
            continue
        hit = by_sku.get(sku)
        if hit and hit.get("img") and not is_placeholder(hit["img"]):
            apply_hit(p, hit, details, "izc.com.co")
            updated += 1
            continue
        # Herencia por modelo
        ms = models_of(str(p.get("name") or ""))
        donor = None
        for m in ms:
            for row in by_model.get(m) or []:
                img = str(row.get("img") or "")
                if img and not is_placeholder(img):
                    donor = row
                    break
            if donor:
                break
        if donor:
            apply_hit(p, donor, details, "izc.com.co-inherited")
            inherited += 1
            updated += 1

    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DETAILS.write_text(json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    zebra_after = [p for p in products if str(p.get("brand") or "").lower() == "zebra"]
    missing_after = sum(1 for p in zebra_after if is_placeholder(str(p.get("img") or "")))
    print(
        f"OK updated={updated} inherited={inherited} "
        f"missing_before={missing_before} missing_after={missing_after}",
        flush=True,
    )


if __name__ == "__main__":
    main()
