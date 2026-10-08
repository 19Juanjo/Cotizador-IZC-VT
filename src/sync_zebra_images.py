#!/usr/bin/env python3
"""Sincroniza imágenes Zebra desde izc.com.co/es (búsqueda SSR) hacia catalogo.json."""
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
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-CO,es;q=0.9",
}
BASE = "https://izc.com.co"

# Consultas que suelen listar productos Zebra en Magento IZC.
SEARCH_QUERIES = [
    "zebra",
    "tc22",
    "tc27",
    "tc15",
    "tc21",
    "tc26",
    "tc8000",
    "tc8x",
    "mc3300",
    "mc3400",
    "ls1203",
    "ds2208",
    "ds3608",
    "zd220",
    "zd230",
    "zd411",
    "zd421",
    "zd620",
    "zt411",
    "zt421",
    "zq320",
    "zq630",
    "zc100",
    "zc300",
    "sharecradle",
    "onecare",
    "ribbon zebra",
    "adaptador zebra",
    "base de carga zebra",
    "bateria zebra",
    "powerprecision",
    "powerwall zebra",
    "carnet zebra",
]


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
    if "imgmarcas" in u:
        return True
    if "iconoizc" in u:
        return True
    if "placeholder" in u:
        return True
    if "zebra_distributor" in u or "distributor.webp" in u or "distributor.jpg" in u:
        return True
    if "logo" in u and "catalog/product" not in u:
        return True
    if u.endswith("zebra.png") or u.endswith("/zebra.png") or "/zebra.png" in u:
        return True
    if "catalog/product" not in u and "webp_image/catalog" not in u:
        return True
    return False


def parse_search_page(html: str) -> list[dict]:
    """Extrae productos de una página de búsqueda Magento/Codazon."""
    out: list[dict] = []
    # Cada tarjeta suele tener product-image-photo + Sku: NNN
    # Recorremos por menciones de Sku y miramos hacia atrás.
    for m in re.finditer(r"Sku:\s*([0-9]{3,8}(?:-[0-9]{3,8})*)", html, re.I):
        sku = m.group(1).strip()
        # Si es rango configurable tipo 10280-11526, tomar el primero
        sku_main = sku.split("-")[0] if "-" in sku and len(sku.split("-")[0]) >= 3 else sku
        start = max(0, m.start() - 3500)
        chunk = html[start : m.end() + 400]
        imgs = re.findall(
            r'(?:src|data-src)="((?:https://izc\.com\.co)?/pub/media/(?:catalog/product|webp_image/catalog)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
            chunk,
            re.I,
        )
        imgs = [abs_url(u) for u in imgs if "placeholder" not in u.lower() and "/og_image/" not in u.lower() and "distributor" not in u.lower()]
        hrefs = re.findall(
            r'href="((?:https://izc\.com\.co)?/es/[^"]+\.html)"',
            chunk,
            re.I,
        )
        href = ""
        for h in hrefs:
            h = abs_url(h)
            if "catalogsearch" in h or "customer" in h:
                continue
            href = h
            break
        alt = re.search(r'alt="([^"]{8,200})"', chunk)
        name = (alt.group(1).strip() if alt else "")
        if not imgs:
            continue
        # Preferir imagen principal (no hover -1)
        img = imgs[0]
        for cand in imgs:
            if not re.search(r"-\d+\.(jpg|jpeg|png|webp)", cand, re.I):
                img = cand
                break
        out.append(
            {
                "sku": sku_main,
                "sku_raw": sku,
                "img": img,
                "url": href,
                "name": name,
            }
        )
    return out


def harvest_sku_page(sku: str) -> dict | None:
    """Busca un SKU concreto en Magento IZC."""
    q = urllib.parse.quote(str(sku).strip())
    url = f"{BASE}/es/catalogsearch/result/?q={q}"
    try:
        html = fetch(url)
    except Exception as exc:
        print(f"  FAIL sku={sku}: {exc}", flush=True)
        return None
    rows = parse_search_page(html)
    exact = [r for r in rows if r.get("sku") == str(sku) or str(sku) in str(r.get("sku_raw") or "")]
    pick = exact[0] if exact else (rows[0] if rows else None)
    if pick and pick.get("img") and not is_placeholder(pick["img"]):
        return pick
    # Fallback: primera imagen de producto en la página si el SKU aparece.
    if re.search(rf"Sku:\s*{re.escape(str(sku))}\b", html, re.I):
        imgs = re.findall(
            r'(?:src|data-src)="((?:https://izc\.com\.co)?/pub/media/(?:catalog/product|webp_image/catalog)[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
            html,
            re.I,
        )
        imgs = [abs_url(u) for u in imgs if "placeholder" not in u.lower() and "distributor" not in u.lower()]
        if imgs:
            return {"sku": str(sku), "sku_raw": str(sku), "img": imgs[0], "url": "", "name": ""}
    return None

def max_page(html: str) -> int:
    pages = [int(p) for p in re.findall(r"[?&]p=(\d+)", html)]
    return max(pages) if pages else 1


def harvest_query(query: str, by_sku: dict[str, dict]) -> int:
    added = 0
    q = urllib.parse.quote(query)
    first_url = f"{BASE}/es/catalogsearch/result/?q={q}"
    try:
        html = fetch(first_url)
    except Exception as exc:
        print(f"  FAIL query={query!r}: {exc}", flush=True)
        return 0
    pages = min(max_page(html), 12)
    print(f"  query={query!r} pages~{pages}", flush=True)
    for page in range(1, pages + 1):
        if page > 1:
            url = f"{BASE}/es/catalogsearch/result/?q={q}&p={page}"
            try:
                html = fetch(url)
            except Exception as exc:
                print(f"    page {page} ERR {exc}", flush=True)
                break
            time.sleep(0.25)
        rows = parse_search_page(html)
        print(f"    p={page} products={len(rows)}", flush=True)
        if not rows and page > 1:
            break
        for row in rows:
            sku = row["sku"]
            if sku not in by_sku:
                by_sku[sku] = row
                added += 1
            elif is_placeholder(by_sku[sku].get("img", "")) and row.get("img"):
                by_sku[sku] = row
    return added


MODEL_RE = re.compile(
    r"\b(TC\d{2,4}[A-Z0-9\-]*|MC\d{3,4}[A-Z0-9\-]*|LS\d{3,4}|DS\d{3,4}[A-Z0-9\-]*|"
    r"ZD\d{2,4}[A-Z0-9\-]*|ZT\d{2,4}[A-Z0-9\-]*|ZQ\d{2,4}[A-Z0-9\-]*|"
    r"ZC\d{2,4}|ZXP\d|MP\d{4}|CS\d{4})\b",
    re.I,
)


def models_of(text: str) -> set[str]:
    found = {m.upper() for m in MODEL_RE.findall(text or "")}
    extras: set[str] = set()
    for m in list(found):
        base = re.match(r"^([A-Z]+)(\d{2,4})", m)
        if base:
            extras.add(base.group(1) + base.group(2))
        if m.startswith("TC8"):
            extras.add("TC8X")
            extras.add("TC8000")
    return found | extras


def main() -> None:
    try:
        import sys

        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    details = json.loads(DETAILS.read_text(encoding="utf-8")) if DETAILS.exists() else {}
    products = catalog.get("products") or []
    zebra = [p for p in products if str(p.get("brand") or "").lower() == "zebra"]
    missing_before = sum(1 for p in zebra if is_placeholder(str(p.get("img") or "")))
    print(f"Zebra en catalogo: {len(zebra)} | sin imagen: {missing_before}", flush=True)

    by_sku: dict[str, dict] = {}
    for q in SEARCH_QUERIES:
        harvest_query(q, by_sku)
        time.sleep(0.2)
    print(f"Cosechados desde IZC: {len(by_sku)} SKUs con imagen", flush=True)

    # Pasada extra: SKUs Zebra que siguen faltando → búsqueda directa por SKU.
    missing_skus = [
        str(p.get("sku") or "").strip()
        for p in zebra
        if str(p.get("sku") or "").strip()
        and is_placeholder(str(p.get("img") or ""))
        and str(p.get("sku") or "").strip() not in by_sku
    ]
    print(f"Busqueda directa por SKU faltantes: {len(missing_skus)}", flush=True)
    for i, sku in enumerate(missing_skus, 1):
        hit = harvest_sku_page(sku)
        if hit and hit.get("img"):
            by_sku[sku] = hit
            print(f"  [{i}/{len(missing_skus)}] {sku} OK", flush=True)
        else:
            print(f"  [{i}/{len(missing_skus)}] {sku} —", flush=True)
        time.sleep(0.2)

    # Indexar cosecha también por modelos
    by_model: dict[str, list[dict]] = {}
    for row in by_sku.values():
        for m in models_of(f"{row.get('name','')} {row.get('url','')}"):
            by_model.setdefault(m, []).append(row)

    updated = 0
    inherited = 0
    for p in products:
        if str(p.get("brand") or "").lower() != "zebra":
            continue
        sku = str(p.get("sku") or "").strip()
        if not sku:
            continue
        cur = str(p.get("img") or "")
        if not is_placeholder(cur):
            continue

        hit = by_sku.get(sku)
        if hit and hit.get("img"):
            p["img"] = hit["img"]
            updated += 1
            # Detalle mínimo
            d = details.get(sku) if isinstance(details.get(sku), dict) else {}
            if not d:
                d = {}
            d.setdefault("sku", sku)
            d.setdefault("name", p.get("name") or hit.get("name") or "")
            if hit.get("url"):
                d["url"] = hit["url"]
            d["source"] = "izc.com.co"
            d["images"] = [{"full": hit["img"], "img": hit["img"], "thumb": hit["img"]}]
            details[sku] = d
            continue

        # Heredar por modelo (accesorios TC22/TC27/etc.)
        ms = models_of(str(p.get("name") or ""))
        donor = None
        for m in ms:
            # Preferir producto principal ya en catalogo con imagen, luego cosecha
            for other in zebra:
                if other is p:
                    continue
                if m not in models_of(str(other.get("name") or "")):
                    continue
                img = str(other.get("img") or "")
                if not is_placeholder(img) and "catalog/product" in img:
                    # Preferir el equipo (no ribbon/cinta) si el nombre del missing no es ribbon
                    donor = other
                    break
            if donor:
                break
            rows = by_model.get(m) or []
            if rows:
                donor = rows[0]
                break
        if donor:
            img = donor.get("img") if isinstance(donor, dict) else None
            if img and not is_placeholder(str(img)):
                p["img"] = img
                inherited += 1
                updated += 1
                d = details.get(sku) if isinstance(details.get(sku), dict) else {}
                if not isinstance(d, dict):
                    d = {}
                d.setdefault("sku", sku)
                d.setdefault("name", p.get("name") or "")
                d["source"] = "izc.com.co-inherited"
                d["images"] = [{"full": img, "img": img, "thumb": img}]
                details[sku] = d

    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DETAILS.write_text(json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    zebra_after = [p for p in products if str(p.get("brand") or "").lower() == "zebra"]
    missing_after = sum(1 for p in zebra_after if is_placeholder(str(p.get("img") or "")))
    print(
        f"OK updated={updated} inherited~{inherited} "
        f"missing_before={missing_before} missing_after={missing_after}",
        flush=True,
    )


if __name__ == "__main__":
    main()
