#!/usr/bin/env python3
"""Hereda imagenes Zebra por familia de modelo (sin scrapear web)."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = ROOT / "assets" / "files"
CATALOG = FILES / "catalogo.json"
DETAILS = FILES / "product_details.json"

MODEL_RE = re.compile(
    r"\b(TC\d{2,4}[A-Z0-9\-]*|MC\d{3,4}[A-Z0-9\-]*|LS\d{3,4}|DS\d{3,4}[A-Z0-9\-]*|"
    r"ZD\d{2,4}[A-Z0-9\-]*|ZT\d{2,4}[A-Z0-9\-]*|ZQ\d{2,4}[A-Z0-9\-]*|"
    r"ZC\d{2,4}|ZXP\d|FX\d{4}|TC8X|TC8\d{2,3}|QL\d{2,3}|RW\d{2,3})\b",
    re.I,
)


def is_placeholder(url: str) -> bool:
    u = (url or "").lower().strip()
    if not u:
        return True
    if "imgmarcas" in u or "distributor" in u or "placeholder" in u:
        return True
    if "catalog/product" not in u and "webp_image/catalog" not in u:
        return True
    return False


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
            extras.add("TC83")
    return found | extras


def score_donor(name: str) -> int:
    """Preferir equipos principales sobre cables/ribbons."""
    n = (name or "").lower()
    score = 10
    if re.search(r"\b(terminal|impresora|lector|handheld|movil|móvil)\b", n):
        score += 20
    if re.search(r"\b(ribbon|cinta|etiqueta|cable|cbl:|pulsera|tarjeta pvc)\b", n):
        score -= 15
    if "catalog/product" in n:
        score += 5
    return score


def main() -> None:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    details = json.loads(DETAILS.read_text(encoding="utf-8")) if DETAILS.exists() else {}
    products = catalog.get("products") or []
    zebra = [p for p in products if str(p.get("brand") or "").lower() == "zebra"]

    by_model: dict[str, list[tuple[int, dict]]] = {}
    for p in zebra:
        img = str(p.get("img") or "")
        if is_placeholder(img):
            continue
        sc = score_donor(str(p.get("name") or ""))
        for m in models_of(str(p.get("name") or "")):
            by_model.setdefault(m, []).append((sc, p))

    for m in by_model:
        by_model[m].sort(key=lambda t: t[0], reverse=True)

    missing_before = sum(1 for p in zebra if is_placeholder(str(p.get("img") or "")))
    updated = 0
    for p in zebra:
        if not is_placeholder(str(p.get("img") or "")):
            continue
        ms = models_of(str(p.get("name") or ""))
        donor = None
        best = -999
        for m in ms:
            rows = by_model.get(m) or []
            if not rows:
                continue
            sc, cand = rows[0]
            if sc > best:
                best = sc
                donor = cand
        if not donor:
            continue
        img = str(donor.get("img") or "")
        if is_placeholder(img):
            continue
        p["img"] = img
        sku = str(p.get("sku") or "")
        d = details.get(sku) if isinstance(details.get(sku), dict) else {}
        if not isinstance(d, dict):
            d = {}
        d.setdefault("sku", sku)
        d.setdefault("name", p.get("name") or "")
        d["source"] = "inherited-model"
        d["images"] = [{"full": img, "img": img, "thumb": img}]
        details[sku] = d
        updated += 1
        print(f"  {sku} <- {donor.get('sku')} ({','.join(sorted(ms))})", flush=True)

    CATALOG.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    DETAILS.write_text(json.dumps(details, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    missing_after = sum(1 for p in zebra if is_placeholder(str(p.get("img") or "")))
    print(f"OK inherited={updated} missing_before={missing_before} missing_after={missing_after}", flush=True)


if __name__ == "__main__":
    main()
