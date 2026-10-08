# -*- coding: utf-8 -*-
"""Completa empresa (IZC/VALTECH), razón social y precios en stubs Bitrix."""
from __future__ import annotations

import json
import re
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(r"C:\IZC Server")
FIBRA = Path(r"C:\IZC FIBRA OPT")
sys.path.insert(0, str(ROOT / "tools"))

from sync_bitrix_quotes_all import (  # noqa: E402
    BITRIX_FILE,
    QUOTES_FILE,
    company_nit_nombre,
    fetch_deal,
    fetch_product_rows,
    load_json,
    normalize_empresa,
    parse_cliente_from_comments,
    parse_empresa_from_comments,
    parse_products_from_comments,
    parse_trm_from_comments,
    product_rows_to_items,
    save_json,
    seller_map,
)


def fnum(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def quote_has_price(q: dict) -> bool:
    t = q.get("totals") if isinstance(q.get("totals"), dict) else {}
    if any(fnum(t.get(k)) > 0 for k in ("usdIva", "copIva", "totalConFlete", "usd", "cop")):
        return True
    for it in q.get("items") or []:
        if not isinstance(it, dict):
            continue
        if any(
            fnum(it.get(k)) > 0
            for k in ("usdIva", "copIva", "totalUsdIva", "totalCopIva", "usd", "cop", "totalUsd", "totalCop")
        ):
            return True
    return False


def items_have_sku(q: dict) -> bool:
    for it in q.get("items") or []:
        if isinstance(it, dict) and str(it.get("sku") or "").strip():
            return True
    return False


def nombre_is_nit(q: dict) -> bool:
    nombre = str(q.get("nombre") or "").strip()
    nit = re.sub(r"\D+", "", str(q.get("nit") or ""))
    if not nombre:
        return True
    if nit and nombre == nit:
        return True
    return bool(re.fullmatch(r"\d{6,15}", nombre))


def stored_empresa(q: dict) -> str:
    t = q.get("totals") if isinstance(q.get("totals"), dict) else {}
    return str(q.get("empresa") or t.get("empresa") or "").strip()


def apply_empresa(q: dict, empresa: str) -> bool:
    empresa = normalize_empresa(empresa, q.get("seller_name") or "")
    if not empresa:
        return False
    changed = False
    if str(q.get("empresa") or "").strip() != empresa:
        q["empresa"] = empresa
        changed = True
    if not isinstance(q.get("totals"), dict):
        q["totals"] = {}
    if str((q.get("totals") or {}).get("empresa") or "").strip() != empresa:
        q["totals"]["empresa"] = empresa
        changed = True
    return changed


def qty_of(items: list) -> int:
    n = 0
    for it in items or []:
        if not isinstance(it, dict):
            continue
        try:
            n += max(1, int(float(it.get("qty") or 1)))
        except Exception:
            n += 1
    return n


def main() -> int:
    cfg = load_json(BITRIX_FILE, {})
    webhook = str((cfg or {}).get("webhook_base") or "").strip()
    if not webhook:
        print("Sin webhook Bitrix")
        return 1
    smap = seller_map()
    quotes = load_json(QUOTES_FILE, [])
    if not isinstance(quotes, list):
        print("cotizaciones.json inválido")
        return 1

    bak = QUOTES_FILE.with_name("cotizaciones.backup-before-enrich2.json")
    shutil.copy2(QUOTES_FILE, bak)
    print("backup", bak)

    nit_names: dict[str, str] = {}
    for q0 in quotes:
        if not isinstance(q0, dict) or nombre_is_nit(q0):
            continue
        nit0 = re.sub(r"\D+", "", str(q0.get("nit") or ""))
        nom0 = str(q0.get("nombre") or "").strip()
        if nit0 and nom0:
            nit_names[nit0] = nom0

    company_cache: dict = {}
    n_emp = n_name = n_price = n_fetch = 0
    for q in quotes:
        if not isinstance(q, dict):
            continue
        seller = str(q.get("seller_name") or smap.get(str(q.get("assigned_by_id") or ""), "") or "")
        if seller and not q.get("seller_name"):
            q["seller_name"] = seller

        emp = stored_empresa(q)
        if not emp and not str(q.get("empresa_editado_at") or "").strip():
            if apply_empresa(q, seller):
                n_emp += 1

        if nombre_is_nit(q):
            mapped = nit_names.get(re.sub(r"\D+", "", str(q.get("nit") or "")))
            if mapped:
                q["nombre"] = mapped
                n_name += 1

        need_name = nombre_is_nit(q)
        need_price = not quote_has_price(q)
        placeholder = not items_have_sku(q)
        deal_id = str(q.get("bitrix_deal_id") or "").strip()
        if not deal_id or not deal_id.isdigit() or not (need_name or need_price or (placeholder and q.get("imported_from_bitrix"))):
            continue

        n_fetch += 1
        deal = fetch_deal(webhook, deal_id)
        if not deal:
            time.sleep(0.08)
            continue

        comments = str(deal.get("COMMENTS") or "")
        emp_c = parse_empresa_from_comments(comments)
        if emp_c:
            apply_empresa(q, emp_c)
        elif not stored_empresa(q):
            apply_empresa(q, seller or smap.get(str(deal.get("ASSIGNED_BY_ID") or ""), ""))

        cliente = parse_cliente_from_comments(comments)
        if cliente and nombre_is_nit(q):
            q["nombre"] = cliente
            n_name += 1
            nit_key = re.sub(r"\D+", "", str(q.get("nit") or ""))
            if nit_key:
                nit_names[nit_key] = cliente
        elif need_name:
            nit, nombre = company_nit_nombre(webhook, deal.get("COMPANY_ID"), company_cache, cfg)
            if nit and (not str(q.get("nit") or "").strip() or str(q.get("nit")) in ("0", nit)):
                q["nit"] = nit
            if nombre and nombre != nit:
                q["nombre"] = nombre
                n_name += 1

        trm = parse_trm_from_comments(comments)
        if trm > 0 and fnum(q.get("trm")) <= 0:
            q["trm"] = trm

        if placeholder:
            currency = str(deal.get("CURRENCY_ID") or cfg.get("currency_id") or "COP").upper()
            if currency not in ("USD", "COP"):
                currency = "COP"
            opp = fnum(deal.get("OPPORTUNITY"))
            items = product_rows_to_items(fetch_product_rows(webhook, deal_id), currency)
            parsed = parse_products_from_comments(comments)
            if parsed:
                items = parsed
            if items:
                q["items"] = items
                if not isinstance(q.get("totals"), dict):
                    q["totals"] = {}
                q["totals"]["qty"] = qty_of(items)
                usd = sum(fnum(it.get("totalUsdIva") or it.get("usdIva")) for it in items if str(it.get("currency") or currency).upper() == "USD")
                cop = sum(fnum(it.get("totalCopIva") or it.get("copIva")) for it in items if str(it.get("currency") or currency).upper() != "USD")
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
                if quote_has_price(q):
                    n_price += 1
        time.sleep(0.08)

    save_json(QUOTES_FILE, quotes)
    fibra_out = FIBRA / "data" / "cotizaciones.json"
    if fibra_out.parent.is_dir():
        shutil.copy2(QUOTES_FILE, fibra_out)
        print("copied", fibra_out)

    miss_emp = sum(1 for q in quotes if isinstance(q, dict) and not stored_empresa(q))
    still_nit = sum(1 for q in quotes if isinstance(q, dict) and nombre_is_nit(q))
    still_price = sum(1 for q in quotes if isinstance(q, dict) and not quote_has_price(q))
    print(
        f"OK quotes={len(quotes)} empresa_filled={n_emp} names={n_name} prices={n_price} "
        f"fetched={n_fetch} remain_empresa={miss_emp} remain_nitname={still_nit} remain_noprice={still_price}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
