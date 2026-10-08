# -*- coding: utf-8 -*-
"""Relee Bitrix en filas vacías: completa si hay productos; si no, quita reservas pending."""
from __future__ import annotations

import json
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\IZC Server")
FIBRA = Path(r"C:\IZC FIBRA OPT")
sys.path.insert(0, str(ROOT / "tools"))

from _enrich_bitrix_quotes import (  # noqa: E402
    apply_empresa,
    fnum,
    items_have_sku,
    quote_has_price,
    qty_of,
)
from sync_bitrix_quotes_all import (  # noqa: E402
    BITRIX_FILE,
    QUOTES_FILE,
    fetch_deal,
    fetch_product_rows,
    load_json,
    parse_cliente_from_comments,
    parse_empresa_from_comments,
    parse_products_from_comments,
    parse_trm_from_comments,
    product_rows_to_items,
    save_json,
)


def main() -> int:
    cfg = load_json(BITRIX_FILE, {})
    webhook = str((cfg or {}).get("webhook_base") or "").strip()
    quotes = load_json(QUOTES_FILE, [])
    if not isinstance(quotes, list):
        return 1
    bak = QUOTES_FILE.with_name("cotizaciones.backup-before-empty-clean.json")
    shutil.copy2(QUOTES_FILE, bak)
    print("backup", bak)

    kept = []
    filled = 0
    removed = 0
    for q in quotes:
        if not isinstance(q, dict):
            continue
        if quote_has_price(q) or items_have_sku(q) or (q.get("items") or []):
            kept.append(q)
            continue
        deal_id = str(q.get("bitrix_deal_id") or "").strip()
        if deal_id.isdigit() and webhook:
            deal = fetch_deal(webhook, deal_id)
            comments = str((deal or {}).get("COMMENTS") or "")
            currency = str((deal or {}).get("CURRENCY_ID") or cfg.get("currency_id") or "COP").upper()
            if currency not in ("USD", "COP"):
                currency = "COP"
            opp = fnum((deal or {}).get("OPPORTUNITY"))
            items = product_rows_to_items(fetch_product_rows(webhook, deal_id), currency)
            parsed = parse_products_from_comments(comments)
            if parsed:
                items = parsed
            cliente = parse_cliente_from_comments(comments)
            if cliente:
                q["nombre"] = cliente
            emp = parse_empresa_from_comments(comments)
            if emp:
                apply_empresa(q, emp)
            trm = parse_trm_from_comments(comments)
            if trm > 0:
                q["trm"] = trm
            if items:
                q["items"] = items
                if not isinstance(q.get("totals"), dict):
                    q["totals"] = {}
                q["totals"]["qty"] = qty_of(items)
                usd = sum(
                    fnum(it.get("totalUsdIva") or it.get("usdIva"))
                    for it in items
                    if str(it.get("currency") or currency).upper() == "USD"
                )
                cop = sum(
                    fnum(it.get("totalCopIva") or it.get("copIva"))
                    for it in items
                    if str(it.get("currency") or currency).upper() != "USD"
                )
                if usd > 0:
                    q["totals"]["usdIva"] = usd
                    q["totals"]["hasUsd"] = True
                elif currency == "USD" and opp > 0:
                    q["totals"]["usdIva"] = opp
                    q["totals"]["hasUsd"] = True
                if cop > 0:
                    q["totals"]["copIva"] = cop
                    q["totals"]["hasCop"] = True
                elif currency != "USD" and opp > 0:
                    q["totals"]["copIva"] = opp
                    q["totals"]["hasCop"] = True
            time.sleep(0.08)
        if quote_has_price(q) or items_have_sku(q) or (q.get("items") or []):
            kept.append(q)
            filled += 1
        else:
            removed += 1
            print("remove", q.get("id"), q.get("nombre"), "deal", q.get("bitrix_deal_id"))
    save_json(QUOTES_FILE, kept)
    fibra = FIBRA / "data" / "cotizaciones.json"
    if fibra.parent.is_dir():
        shutil.copy2(QUOTES_FILE, fibra)
        print("copied fibra")
    print("kept", len(kept), "filled", filled, "removed", removed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
