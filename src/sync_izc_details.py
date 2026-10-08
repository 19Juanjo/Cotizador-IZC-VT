#!/usr/bin/env python3
"""Scrapea imágenes y ficha técnica desde https://izc.com.co/es/ por SKU."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / "assets" / "files"
CATALOG = FILES / "catalogo.json"
DETAILS = FILES / "product_details.json"
CACHE = FILES / "_izc_url_cache.json"
PRODUCTOS = FILES / "productos.json"
UA = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-CO,es;q=0.9",
}
BASE = "https://izc.com.co"

# Páginas configurables conocidas (serie → URL). Las variantes heredan imagen/ficha.
KNOWN_SERIES_URLS = {
    "n140": f"{BASE}/es/equipo-todo-en-uno-pos-sat-serie-n140.html",
    "n150": f"{BASE}/es/equipo-todo-en-uno-pos-sat-serie-n150.html",
}

# Accesorios que no deben heredar la foto del equipo AIO/POS.
INHERIT_EXCLUDE_RE = re.compile(
    r"(^|\b)(soporte|adaptador|etiqueta|carton\d*|fuente\s+de\s+poder|"
    r"monitor\s+posterior|panel\s+tactil|pantalla\s+lcd|caj[oó]n\s+monedero|"
    r"ribbon|consumible)",
    re.I,
)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp.read().decode("utf-8", "replace")


def abs_url(url: str) -> str:
    href = unescape((url or "").strip()).replace("\\/", "/")
    if not href:
        return ""
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return BASE + href
    if href.startswith("http"):
        return href
    return BASE + "/" + href.lstrip("./")


def strip_tags(html: str) -> str:
    text = re.sub(r"<script[^>]*>.*?</script>", " ", html or "", flags=re.I | re.S)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return unescape(re.sub(r"\s+", " ", text)).strip()


def page_has_sku(html: str, sku: str) -> bool:
    patterns = [
        rf'itemprop="sku">\s*{re.escape(sku)}\s*<',
        rf"Sku:\s*{re.escape(sku)}\b",
        rf'data-product-sku="{re.escape(sku)}"',
        rf'"sku"\s*:\s*"{re.escape(sku)}"',
    ]
    return any(re.search(p, html, re.I) for p in patterns)


def series_token_from_text(text: str) -> str | None:
    m = re.search(r"\b(n1[4-9]0)\b", text or "", re.I)
    return m.group(1).lower() if m else None


def can_inherit_series(name: str, series: str) -> bool:
    blob = name or ""
    if series.lower() not in blob.lower():
        return False
    if INHERIT_EXCLUDE_RE.search(blob):
        return False
    return bool(
        re.search(
            r"\b(pos|aio|todo\s*en\s*uno|all\s*in\s*one|serie\s*" + re.escape(series) + r")\b",
            blob,
            re.I,
        )
    )


def find_product_url(sku: str, name: str, cache: dict[str, str]) -> str | None:
    if sku in cache:
        return cache[sku] or None

    # Atajo: si el nombre es de una serie conocida, usar la ficha configurable
    series = series_token_from_text(f"{sku} {name}")
    if series and series in KNOWN_SERIES_URLS and can_inherit_series(name, series):
        href = KNOWN_SERIES_URLS[series]
        cache[sku] = href
        return href

    queries = [sku]
    tokens = re.findall(r"\b([A-Z]{1,5}\d{2,}[A-Z0-9\-]*)\b", name or "", flags=re.I)
    for t in tokens[:3]:
        if t.upper() not in {q.upper() for q in queries}:
            queries.append(t)
    if series:
        queries.append(series)
        queries.append(f"serie {series}")

    sku_in_card = [
        re.compile(rf'itemprop="sku">\s*{re.escape(sku)}\s*<', re.I),
        re.compile(rf"Sku:\s*{re.escape(sku)}\b", re.I),
        re.compile(rf'data-product-sku="{re.escape(sku)}"', re.I),
        # Configurable/parent: Sku: 10280-11526-11528
        re.compile(rf"Sku:\s*[0-9\-]*{re.escape(sku)}[0-9\-]*", re.I),
    ]

    for q in queries:
        url = f"{BASE}/es/catalogsearch/result/?q=" + urllib.parse.quote(q)
        try:
            html = fetch(url)
        except Exception:
            continue
        blocks = re.split(r'<li[^>]*class="[^"]*product-item[^"]*"', html, flags=re.I)
        preferred: str | None = None
        fallback: str | None = None
        for block in blocks[1:]:
            if not any(p.search(block) for p in sku_in_card):
                # También aceptar tarjeta de serie si el query es la serie
                if series and series in q.lower() and f"serie {series}" in block.lower():
                    pass
                elif series and series in q.lower() and f"serie-{series}" in block.lower():
                    pass
                else:
                    continue
            href_m = re.search(r'href="(https://izc\.com\.co[^"]+\.html)"', block, re.I)
            if not href_m:
                href_m = re.search(r'href="(/es/[^"]+\.html)"', block, re.I)
            if not href_m:
                continue
            href = abs_url(href_m.group(1))
            if "catalogsearch" in href:
                continue
            if series and f"serie-{series}" in href.lower():
                preferred = href
                break
            if not fallback:
                fallback = href
        hit = preferred or fallback
        if hit:
            cache[sku] = hit
            return hit
        time.sleep(0.1)

    cache[sku] = ""
    return None


def parse_images(html: str) -> list[dict]:
    images: list[dict] = []
    seen: set[str] = set()

    def add(full_u: str, img_u: str = "", thumb_u: str = "") -> None:
        key = full_u or img_u
        if not key or key in seen:
            return
        low = key.lower()
        if not any(x in low for x in [".jpg", ".jpeg", ".png", ".webp", ".gif"]):
            return
        if "placeholder" in low or "/og_image/" in low or "logo" in low and "catalog/product" not in low:
            return
        seen.add(key)
        images.append(
            {
                "full": full_u or img_u,
                "img": img_u or full_u,
                "thumb": thumb_u or img_u or full_u,
            }
        )

    for full, img, thumb in re.findall(
        r'"full"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"img"\s*:\s*"((?:\\.|[^"\\])*)"\s*,\s*"thumb"\s*:\s*"((?:\\.|[^"\\])*)"',
        html,
    ):
        add(
            abs_url(full.replace("\\/", "/").replace("\\u0026", "&")),
            abs_url(img.replace("\\/", "/").replace("\\u0026", "&")),
            abs_url(thumb.replace("\\/", "/").replace("\\u0026", "&")),
        )

    if not images:
        for src in re.findall(
            r'<img[^>]+(?:data-src|src)="([^"]+(?:catalog/product|webp_image/catalog)[^"]+)"',
            html,
            re.I,
        ):
            add(abs_url(src))

    if not images:
        for src in re.findall(
            r'https?://[^"\s<>]+(?:webp_image/)?catalog/product/[^"\s<>]+\.(?:jpg|jpeg|png|webp)',
            html,
            re.I,
        ):
            add(abs_url(src))

    if not images:
        for src in re.findall(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"', html, re.I):
            u = abs_url(src)
            if "/og_image/" in u.lower():
                continue
            add(u)

    return images


def best_catalog_img(detail: dict) -> str:
    for img in detail.get("images") or []:
        u = str(img.get("img") or img.get("full") or "")
        low = u.lower()
        if not u:
            continue
        if "/og_image/" in low or "placeholder" in low:
            continue
        if "catalog/product" in low or any(x in low for x in (".jpg", ".jpeg", ".png", ".webp")):
            return u
    return ""


def update_catalog_images(details: dict) -> int:
    if not CATALOG.exists():
        return 0
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    changed = 0
    for p in catalog.get("products") or []:
        sku = str(p.get("sku") or "")
        detail = details.get(sku)
        if not detail:
            continue
        img = best_catalog_img(detail)
        if not img:
            continue
        # Solo reemplazar placeholder o vacío
        if not is_placeholder_img(str(p.get("img") or "")):
            continue
        p["img"] = img
        if detail.get("url"):
            p["productUrl"] = detail["url"]
        changed += 1
    if changed:
        CATALOG.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return changed


def inherit_parent_details(details: dict, parent_sku: str, child_skus: list[str]) -> int:
    parent = details.get(parent_sku)
    if not parent:
        return 0
    n = 0
    for sku in child_skus:
        sku = str(sku)
        if not sku or sku == parent_sku:
            continue
        existing = details.get(sku)
        if existing and (existing.get("images") or existing.get("ficha") or existing.get("attributes")):
            # Rellenar solo campos vacíos
            changed = False
            if not existing.get("images") and parent.get("images"):
                existing["images"] = parent["images"]
                changed = True
            if not existing.get("ficha") and parent.get("ficha"):
                existing["ficha"] = parent["ficha"]
                changed = True
            if not existing.get("descriptionHtml") and parent.get("descriptionHtml"):
                existing["descriptionHtml"] = parent["descriptionHtml"]
                changed = True
            if not existing.get("attributes") and parent.get("attributes"):
                existing["attributes"] = parent["attributes"]
                changed = True
            if changed:
                details[sku] = existing
                n += 1
            continue
        copy = dict(parent)
        copy["sku"] = sku
        details[sku] = copy
        n += 1
    return n


def is_placeholder_img(url: str) -> bool:
    u = (url or "").lower().strip()
    if not u:
        return True
    if "imgmarcas" in u:
        return True
    if "iconoizc" in u:
        return True
    if "placeholder" in u:
        return True
    if "logo" in u and "catalog/product" not in u:
        return True
    if u.endswith("zebra.png") or "/zebra.png" in u:
        return True
    return False


def parse_resumen(html: str) -> tuple[str, str]:
    m = re.search(r'id="short_description_content"[^>]*>(.*?)</div>', html, re.I | re.S)
    if not m:
        m = re.search(r'itemprop="description"[^>]*>(.*?)</div>', html, re.I | re.S)
    if not m:
        return "", ""
    raw = re.sub(r"<style[^>]*>.*?</style>", "", m.group(1), flags=re.I | re.S)
    raw = re.sub(r"<script[^>]*>.*?</script>", "", raw, flags=re.I | re.S)
    parts = re.findall(r"<p\b[^>]*>.*?</p>", raw, flags=re.I | re.S)
    keep: list[str] = []
    for p in parts:
        text = strip_tags(p)
        if len(text) < 5:
            continue
        keep.append(f"<p>{text}</p>")
        if len(keep) >= 5:
            break
    if not keep:
        text = strip_tags(raw)
        if not text:
            return "", ""
        return f"<p>{text}</p>", text
    html_out = "\n".join(keep)
    return html_out, strip_tags(html_out)


def parse_description(html: str) -> str:
    m = re.search(
        r'class="product attribute description"\s*>\s*<div class="value"[^>]*>(.*?)</div>\s*</div>',
        html,
        re.I | re.S,
    )
    if not m:
        return ""
    block = re.sub(r"<style[^>]*>.*?</style>", "", m.group(1), flags=re.I | re.S)
    return block.strip()


def parse_attributes(html: str) -> list[dict]:
    m = re.search(r'id="product-attribute-specs-table"(.*?)</table>', html, re.I | re.S)
    if not m:
        return []
    rows = []
    for lab, val in re.findall(r"<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>", m.group(1), re.I | re.S):
        label = strip_tags(lab)
        value = strip_tags(val)
        if label and value:
            rows.append({"label": label, "value": value})
    return rows


def classify_doc(url: str, label: str) -> str:
    blob = f"{url} {label}".lower()
    if "ficha" in blob:
        return "Ficha Técnica"
    if "manual" in blob:
        return "Manual"
    if "driver" in blob:
        return "Driver"
    if label.strip():
        return label.strip()[:80]
    return "Descarga"


def parse_ficha(html: str, product_name: str) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()
    for href, anchor in re.findall(
        r'<a[^>]+href="([^"]+\.(?:pdf|zip|rar)[^"]*)"[^>]*>(.*?)</a>',
        html,
        re.I | re.S,
    ):
        url = abs_url(href)
        if not url or url in seen:
            continue
        if not any(x in url.lower() for x in ("ficha", "descarga", "manual", "media", "pdf")):
            continue
        seen.add(url)
        rows.append(
            {
                "tipo": classify_doc(url, strip_tags(anchor)),
                "modelo": product_name,
                "fichaUrl": url,
            }
        )
    return rows


def parse_product(html: str, url: str, sku: str, fallback_name: str) -> dict:
    name_m = re.search(r"<h1[^>]*>(.*?)</h1>", html, re.I | re.S)
    name = strip_tags(name_m.group(1)) if name_m else fallback_name

    if re.search(r"SIN STOCK|OUT OF STOCK", html, re.I):
        in_stock, label = False, "SIN STOCK"
    elif re.search(r"EN STOCK|IN STOCK", html, re.I):
        in_stock, label = True, "EN STOCK"
    else:
        in_stock, label = False, "SIN STOCK"

    resumen_html, resumen_text = parse_resumen(html)
    return {
        "sku": sku,
        "name": name,
        "url": url,
        "images": parse_images(html),
        "stock": {"inStock": in_stock, "label": label},
        "resumenHtml": resumen_html,
        "resumenText": resumen_text,
        "descriptionHtml": parse_description(html),
        "attributes": parse_attributes(html),
        "ficha": parse_ficha(html, name),
        "source": "izc.com.co",
    }


def collect_target_skus(query: str | None, explicit: list[str]) -> list[tuple[str, str]]:
    """Return list of (sku, name)."""
    out: list[tuple[str, str]] = []
    seen: set[str] = set()

    def add(sku: str, name: str = "") -> None:
        sku = str(sku or "").strip()
        if not sku or sku in seen:
            return
        seen.add(sku)
        out.append((sku, name))

    for sku in explicit:
        add(sku)

    catalog = json.loads(CATALOG.read_text(encoding="utf-8")) if CATALOG.exists() else {}
    products = catalog.get("products") or []
    names = json.loads(PRODUCTOS.read_text(encoding="utf-8")) if PRODUCTOS.exists() else {}

    q = (query or "").strip().lower()
    if q:
        for p in products:
            sku = str(p.get("sku") or "")
            name = str(p.get("name") or "")
            blob = f"{sku} {name} {p.get('referencia') or ''}".lower()
            if q in blob:
                add(sku, name)
        for sku, name in names.items():
            if q in str(name).lower() or q in str(sku).lower():
                add(sku, str(name))

    if not out and not q and not explicit:
        for p in products:
            if is_placeholder_img(str(p.get("img") or "")):
                add(str(p.get("sku") or ""), str(p.get("name") or ""))

    return out


def main() -> None:
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    args = [a for a in sys.argv[1:] if a]
    query = None
    explicit: list[str] = []
    i = 0
    while i < len(args):
        a = args[i]
        if a.startswith("--q="):
            query = a[4:]
        elif a == "--q" and i + 1 < len(args):
            query = args[i + 1]
            i += 1
        elif re.fullmatch(r"\d+", a):
            explicit.append(a)
        i += 1

    if query is None and not explicit:
        query = "n150"

    targets = collect_target_skus(query, explicit)
    details = json.loads(DETAILS.read_text(encoding="utf-8")) if DETAILS.exists() else {}
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    names = json.loads(PRODUCTOS.read_text(encoding="utf-8")) if PRODUCTOS.exists() else {}

    print(f"IZC sync targets: {len(targets)} (query={query!r})", flush=True)
    ok = fail = skip = 0
    parent_hits: dict[str, list[str]] = {}

    for i, (sku, name) in enumerate(targets, 1):
        name = name or str(names.get(sku) or "")
        existing = details.get(sku)
        has_good = (
            existing
            and best_catalog_img(existing)
            and (
                existing.get("attributes")
                or existing.get("descriptionHtml")
                or existing.get("ficha")
                or existing.get("resumenText")
            )
        )
        if has_good and existing.get("source") in ("izc.com.co", "satpcs.com"):
            skip += 1
            print(f"[{i}/{len(targets)}] SKIP {sku} (ya tiene detalle)", flush=True)
            continue

        try:
            url = find_product_url(sku, name, cache)
            if not url:
                fail += 1
                print(f"[{i}/{len(targets)}] FAIL no url {sku} {name[:60]}", flush=True)
                continue
            html = fetch(url)
            detail = parse_product(html, url, sku, name)
            if not detail["images"] and existing and existing.get("images"):
                detail["images"] = existing["images"]
            if not detail["ficha"] and existing and existing.get("ficha"):
                detail["ficha"] = existing["ficha"]
            if not detail["attributes"] and existing and existing.get("attributes"):
                detail["attributes"] = existing["attributes"]
            if not detail["descriptionHtml"] and existing and existing.get("descriptionHtml"):
                detail["descriptionHtml"] = existing["descriptionHtml"]
            details[sku] = detail
            parent_hits.setdefault(url, []).append(sku)
            ok += 1
            print(
                f"[{i}/{len(targets)}] OK {sku} imgs={len(detail['images'])} "
                f"attrs={len(detail['attributes'])} ficha={len(detail['ficha'])} "
                f"url={url}",
                flush=True,
            )
        except Exception as exc:
            fail += 1
            print(f"[{i}/{len(targets)}] ERR {sku}: {exc}", flush=True)

        if i % 5 == 0:
            DETAILS.write_text(
                json.dumps(details, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
        time.sleep(0.2)

    # Variantes del mismo URL configurable heredan ficha/imagen del padre
    inherited = 0
    for url, skus in parent_hits.items():
        if len(skus) < 1:
            continue
        # Preferir el SKU cuya URL es la página "serie-*"
        parent = skus[0]
        for s in skus:
            d = details.get(s) or {}
            if "serie-" in str(d.get("url") or "").lower() and best_catalog_img(d):
                parent = s
                break
        inherited += inherit_parent_details(details, parent, [x for x in skus if x != parent])

    # Heredar series N140/N150/... a variantes POS/AIO de la query
    series_list: list[str] = []
    if query:
        tok = series_token_from_text(query)
        if tok:
            series_list.append(tok)
    for series in series_list or list(KNOWN_SERIES_URLS):
        parent_sku = None
        # 1) detalle con URL serie-*
        for sku, detail in details.items():
            url = str(detail.get("url") or "").lower()
            if f"serie-{series}" in url and best_catalog_img(detail):
                parent_sku = sku
                break
        # 2) si no, scrapear URL conocida y guardar bajo sku sintético
        if not parent_sku and series in KNOWN_SERIES_URLS:
            series_url = KNOWN_SERIES_URLS[series]
            syn = f"serie-{series}"
            try:
                html = fetch(series_url)
                detail = parse_product(html, series_url, syn, f"POS SAT Serie {series.upper()}")
                if best_catalog_img(detail):
                    details[syn] = detail
                    parent_sku = syn
                    print(
                        f"SEED serie {series}: imgs={len(detail['images'])} "
                        f"ficha={len(detail['ficha'])} url={series_url}",
                        flush=True,
                    )
            except Exception as exc:
                print(f"SEED serie {series} ERR: {exc}", flush=True)
        if not parent_sku:
            continue
        childs = []
        for s, n in targets:
            if can_inherit_series(n or str(names.get(s) or ""), series):
                childs.append(s)
        inherited += inherit_parent_details(details, parent_sku, childs)

    DETAILS.write_text(json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")
    cat_upd = update_catalog_images(details)
    print(
        f"Done. ok={ok} fail={fail} skip={skip} inherited={inherited} "
        f"catalog_img_updates={cat_upd} details_total={len(details)}",
        flush=True,
    )


if __name__ == "__main__":
    main()
