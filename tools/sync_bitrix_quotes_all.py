#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sincroniza negociaciones Bitrix con data/cotizaciones.json.

Por defecto SOLO mapea (bitrix_deal_id + estado + fecha_cierre) sobre cotizaciones
existentes — mismo set que el servidor. Usa --import-new para crear filas nuevas.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BITRIX_FILE = DATA / "bitrix.json"
ASESORES_FILE = DATA / "asesores.json"
VEND_FILE = DATA / "bitrix_vendedores.json"
INDEX_FILE = DATA / "asesor_clientes_index.json"
QUOTES_FILE = DATA / "cotizaciones.json"
SYNC_DIR = DATA / "asesor_bitrix_quotes_sync"
FLAG_FILE = DATA / ".bitrix_quotes_sync_at"
SINCE = "2026-08-20 00:00:00"
MAX_IMPORT_PER_ASESOR = 80
ESTADO_PRIORITY = {
    "nueva": 0,
    "cotizado": 1,
    "pendiente": 2,
    "seguimiento": 3,
    "vendido": 4,
    "perdida": 4,
    "cerrado_modificado": 4,
}


def load_json(path: Path, default):
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    last_err = None
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, path)
            return
        except OSError as e:
            last_err = e
            time.sleep(0.25 * (attempt + 1))
    if last_err:
        raise last_err


def normalize_asesor_codigo(raw: str) -> str:
    c = re.sub(r"[\s.]", "", str(raw or "").strip().upper())
    m = re.match(r"^V(\d{1,4})$", c)
    if m:
        return f"V{int(m.group(1))}"
    if re.match(r"^[A-Z]{2,6}\d{0,4}$", c):
        return c
    return ""


def bitrix_rest(webhook: str, method: str, payload: dict | None = None):
    base = webhook.rstrip("/") + "/"
    url = base + method.lstrip("/")
    body = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8")
    last = None
    for attempt in range(5):
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="replace"))
        except urllib.error.HTTPError as e:
            try:
                data = json.loads(e.read().decode("utf-8", errors="replace"))
            except Exception:
                data = {"error": str(e)}
        except Exception as e:
            data = {"error": str(e)}
        last = data if isinstance(data, dict) else {"error": "bad_response"}
        err = str(last.get("error") or "")
        if err and ("LIMIT" in err.upper() or "QUERY" in err.upper() or "timed out" in err.lower()):
            time.sleep(1.5 * (attempt + 1))
            continue
        return last
    return last or {"error": "bitrix_rest failed"}


def seller_map() -> dict[str, str]:
    raw = load_json(VEND_FILE, {})
    out = {}
    if isinstance(raw, dict):
        for k, v in raw.items():
            out[str(k)] = str(v)
    return out


def codigo_from_label(label: str) -> str:
    m = re.search(r"\b(V\d{1,4})\b", str(label or ""), re.I)
    return normalize_asesor_codigo(m.group(1) if m else "")


def asesor_bitrix_ids(codigo: str, smap: dict[str, str]) -> list[str]:
    code = normalize_asesor_codigo(codigo)
    ids: list[str] = []
    idx = load_json(INDEX_FILE, {})
    by = idx.get("by_codigo") if isinstance(idx, dict) else None
    if isinstance(by, dict) and isinstance(by.get(code), dict):
        for x in by[code].get("bitrix_ids") or []:
            s = str(x).strip()
            if s and s not in ids:
                ids.append(s)
    for uid, label in smap.items():
        if codigo_from_label(label) == code and str(uid) not in ids:
            ids.append(str(uid))
    return ids


def list_asesor_codigos() -> list[str]:
    codes: list[str] = []
    asesores = load_json(ASESORES_FILE, [])
    if isinstance(asesores, list):
        for a in asesores:
            if not isinstance(a, dict):
                continue
            c = normalize_asesor_codigo(a.get("codigo") or a.get("nit") or "")
            if c and c not in codes:
                codes.append(c)
    smap = seller_map()
    for label in smap.values():
        c = codigo_from_label(label)
        if c and c not in codes:
            codes.append(c)
    return codes


def stage_to_estado(stage_id: str, cfg: dict) -> str:
    s = str(stage_id or "").strip()
    smap = cfg.get("stage_map") if isinstance(cfg.get("stage_map"), dict) else {}
    if s in smap:
        e = str(smap[s]).strip().lower()
        if e:
            return e
    pairs = [
        (cfg.get("stage_cotizado") or cfg.get("stage_id"), "cotizado"),
        (cfg.get("stage_pendiente"), "pendiente"),
        (cfg.get("stage_seguimiento"), "seguimiento"),
        (cfg.get("stage_vendido"), "vendido"),
        (cfg.get("stage_perdida"), "perdida"),
        (cfg.get("stage_cerrado_modificado"), "cerrado_modificado"),
    ]
    for sid, est in pairs:
        if sid and str(sid).strip() == s:
            return est
    defaults = {
        "C3:FINAL_INVOICE": "cotizado",
        "C3:UC_G99HUH": "pendiente",
        "C3:NEW": "seguimiento",
        "C3:PREPARATION": "seguimiento",
        "C3:PREPAYMENT_INVOICE": "seguimiento",
        "C3:EXECUTING": "vendido",
        "C3:WON": "vendido",
        "C3:UC_S78RLD": "perdida",
        "C3:LOSE": "perdida",
        "C3:UC_MGTF3H": "cerrado_modificado",
    }
    return defaults.get(s, "cotizado")


def estado_priority(estado: str) -> int:
    return ESTADO_PRIORITY.get(str(estado or "").strip().lower(), 0)


def quote_estado_locked(q: dict) -> bool:
    return bool(q.get("asesor_estado_locked") or q.get("estado_locked"))


NAME_PRIMARY = "UF_CRM_1746192481"
NAME_FALLBACK = "UF_CRM_1746192546"


def bitrix_clean_nit(title: str) -> str:
    t = str(title or "").strip()
    m = re.match(r"^(\d{6,15})(-\d)?\b", t)
    if m:
        return m.group(1)
    digits = re.sub(r"\D+", "", t)
    return digits if 6 <= len(digits) <= 15 else ""


def company_display_name(co: dict, nit: str) -> str:
    cands = []
    for field in (NAME_PRIMARY, NAME_FALLBACK, "TITLE"):
        v = str(co.get(field) or "").strip()
        if v:
            cands.append(v)
    best = ""
    best_score = -1
    for cand in cands:
        n = cand
        for key in filter(None, [nit, re.sub(r"\D+", "", nit or "")]):
            n = re.sub(r"^" + re.escape(key) + r"\s*[-–:\/]\s*", "", n, flags=re.I).strip()
        if not n or n == nit:
            continue
        digits = len(re.findall(r"\d", n))
        score = len(n) - digits * 2
        if score > best_score:
            best_score = score
            best = n
    return best or nit or ""


def company_nit_nombre(webhook: str, company_id, cache: dict, cfg: dict):
    cid = str(company_id or "").strip()
    if not cid or not cid.isdigit():
        return "", ""
    if cid in cache:
        return cache[cid]
    resp = bitrix_rest(webhook, "crm.company.get.json", {"id": int(cid)})
    co = resp.get("result") if isinstance(resp, dict) else None
    nit, nombre = "", ""
    if isinstance(co, dict):
        title = str(co.get("TITLE") or "").strip()
        nit = bitrix_clean_nit(title)
        field = str(cfg.get("company_razon_field") or NAME_FALLBACK)
        # Razón social: campo principal Bitrix, fallback config, luego TITLE sin NIT.
        nombre = company_display_name(
            {
                NAME_PRIMARY: co.get(NAME_PRIMARY),
                NAME_FALLBACK: co.get(field) or co.get(NAME_FALLBACK),
                "TITLE": title,
            },
            nit,
        )
    cache[cid] = (nit, nombre)
    return cache[cid]


def normalize_empresa(raw: str, seller_name: str = "") -> str:
    blob = f"{raw or ''} {seller_name or ''}".upper()
    if "VALTECH" in blob:
        return "VALTECH MAYORISTA S.A.S."
    if "IZC" in blob:
        return "IZC MAYORISTA S.A.S."
    return "IZC MAYORISTA S.A.S."


def parse_empresa_from_comments(comments: str) -> str:
    m = re.search(r"Empresa:\s*(.+)$", str(comments or ""), re.I | re.M)
    return str(m.group(1)).strip() if m else ""


def clean_bitrix_comments(raw: str) -> str:
    s = str(raw or "")
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("\xa0", " ").replace("&nbsp;", " ")
    return s


def parse_cliente_from_comments(comments: str) -> str:
    m = re.search(r"^Cliente:\s*(.+)$", clean_bitrix_comments(comments), re.I | re.M)
    if not m:
        return ""
    name = str(m.group(1)).strip()
    if not name or re.fullmatch(r"\d{6,15}", re.sub(r"[\s.-]", "", name) or ""):
        return ""
    nitish = re.sub(r"\D+", "", name)
    if nitish and name == nitish:
        return ""
    return name


def parse_trm_from_comments(comments: str) -> float:
    m = re.search(r"TRM:\s*([\d.,]+)", clean_bitrix_comments(comments), re.I)
    if not m:
        return 0.0
    raw = m.group(1).strip()
    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    else:
        raw = raw.replace(",", ".")
    try:
        v = float(raw)
    except Exception:
        return 0.0
    return v if v > 0 else 0.0


def _parse_money(raw: str) -> float:
    s = str(raw or "").strip()
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return 0.0


def parse_products_from_comments(comments: str) -> list:
    items = []
    for line in clean_bitrix_comments(comments).splitlines():
        line = line.strip()
        m = re.match(
            r"^-\s*\[([^\]]*)\]\s*(.+?)\s+x([\d.,]+)\s*=\s*([\d.,]+)\s*(USD|COP)",
            line,
            re.I,
        )
        sku = ""
        if m:
            sku, name, qty_s, tot_s, cur = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
        else:
            m = re.match(
                r"^-\s*(.+?)\s+x([\d.,]+)\s*=\s*([\d.,]+)\s*(USD|COP)",
                line,
                re.I,
            )
            if not m:
                continue
            name, qty_s, tot_s, cur = m.group(1), m.group(2), m.group(3), m.group(4)
        name = str(name).strip()
        sku = str(sku).strip()
        qty = _parse_money(qty_s) or 1.0
        total = _parse_money(tot_s)
        cur = "USD" if str(cur).upper() == "USD" else "COP"
        item = {
            "sku": sku,
            "name": name or sku or "Producto",
            "referencia": name or sku,
            "qty": qty,
            "currency": cur,
        }
        if cur == "USD":
            item["totalUsdIva"] = total
            item["usdIva"] = (total / qty) if qty else total
        else:
            item["totalCopIva"] = total
            item["copIva"] = (total / qty) if qty else total
        items.append(item)
    return items


def fetch_deal(webhook: str, deal_id: str) -> dict:
    if not str(deal_id).isdigit():
        return {}
    resp = bitrix_rest(webhook, "crm.deal.get.json", {"id": int(deal_id)})
    deal = resp.get("result") if isinstance(resp, dict) else None
    get_deal = deal if isinstance(deal, dict) else {}
    comments = str(get_deal.get("COMMENTS") or "")
    if parse_products_from_comments(comments) or parse_cliente_from_comments(comments):
        return get_deal
    resp = bitrix_rest(
        webhook,
        "crm.deal.list.json",
        {
            "filter": {"ID": int(deal_id)},
            "select": [
                "ID",
                "TITLE",
                "COMMENTS",
                "COMPANY_ID",
                "CONTACT_ID",
                "OPPORTUNITY",
                "CURRENCY_ID",
                "ASSIGNED_BY_ID",
                "ORIGIN_ID",
            ],
        },
    )
    rows = resp.get("result") if isinstance(resp, dict) else None
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        listed = rows[0]
        if str(listed.get("COMMENTS") or "").strip() or not get_deal:
            return listed
    return get_deal


def product_rows_to_items(rows, currency: str) -> list:
    currency = "USD" if str(currency or "").upper() == "USD" else "COP"
    items = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        product_name = str(row.get("PRODUCT_NAME") or "").strip()
        sku, name = "", product_name
        m = re.match(r"^([^\-]+)-(.+)$", product_name)
        if m:
            sku, name = m.group(1).strip(), m.group(2).strip()
        qty = float(row.get("QUANTITY") or 1) or 1.0
        price = float(row.get("PRICE") or 0)
        item = {
            "sku": sku,
            "name": name or sku or "Producto",
            "referencia": name or sku,
            "qty": qty,
            "currency": currency,
        }
        if currency == "USD":
            item["usdIva"] = price
            item["totalUsdIva"] = price * qty
        else:
            item["copIva"] = price
            item["totalCopIva"] = price * qty
        items.append(item)
    return items


def fetch_product_rows(webhook: str, deal_id: str) -> list:
    if not str(deal_id).isdigit():
        return []
    resp = bitrix_rest(webhook, "crm.deal.productrows.get.json", {"id": int(deal_id)})
    rows = resp.get("result") if isinstance(resp, dict) else None
    return rows if isinstance(rows, list) else []


def deal_to_quote(deal: dict, webhook: str, cfg: dict, codigo: str, smap: dict, company_cache: dict) -> dict | None:
    deal_id = str(deal.get("ID") or "").strip()
    if not deal_id:
        return None
    nit, nombre = company_nit_nombre(webhook, deal.get("COMPANY_ID"), company_cache, cfg)
    assigned = str(deal.get("ASSIGNED_BY_ID") or "").strip()
    seller_name = smap.get(assigned) or codigo
    comments = str(deal.get("COMMENTS") or "")
    cliente = parse_cliente_from_comments(comments)
    if cliente and (not nombre or nombre == nit):
        nombre = cliente
    currency = str(deal.get("CURRENCY_ID") or cfg.get("currency_id") or "COP").upper()
    if currency not in ("USD", "COP"):
        currency = "COP"
    opp = float(deal.get("OPPORTUNITY") or 0)
    items = product_rows_to_items(fetch_product_rows(webhook, deal_id), currency)
    if not items or not any(str(it.get("sku") or "").strip() for it in items):
        parsed = parse_products_from_comments(comments)
        if parsed:
            items = parsed
    if not items and opp > 0:
        line = {
            "sku": "",
            "name": str(deal.get("TITLE") or f"Negociación #{deal_id}"),
            "qty": 1,
            "currency": currency,
        }
        if currency == "USD":
            line["usdIva"] = opp
            line["totalUsdIva"] = opp
        else:
            line["copIva"] = opp
            line["totalCopIva"] = opp
        items.append(line)
    if items and opp <= 0:
        if currency == "USD":
            opp = sum(float(it.get("totalUsdIva") or it.get("usdIva") or 0) for it in items)
        else:
            opp = sum(float(it.get("totalCopIva") or it.get("copIva") or 0) for it in items)
    created = str(deal.get("DATE_CREATE") or "")
    if "T" in created:
        created = created.replace(" ", "T")
    else:
        created = datetime.now(timezone.utc).isoformat()
    estado = stage_to_estado(str(deal.get("STAGE_ID") or ""), cfg)
    close = str(deal.get("CLOSEDATE") or "")
    fecha_cierre = ""
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", close)
    if m:
        fecha_cierre = m.group(1)
    qid = f"bx-{deal_id}"
    origin = str(deal.get("ORIGIN_ID") or "").strip()
    if origin:
        qid = origin
    empresa = normalize_empresa(parse_empresa_from_comments(str(deal.get("COMMENTS") or "")), seller_name)
    totals = {
        "qty": len(items) if items else 0,
        "usdIva": opp if currency == "USD" else 0,
        "copIva": opp if currency == "COP" else 0,
        "hasUsd": currency == "USD",
        "hasCop": currency != "USD",
        "empresa": empresa,
    }
    qty_sum = 0
    for it in items:
        try:
            qty_sum += max(1, int(float(it.get("qty") or 1)))
        except Exception:
            qty_sum += 1
    if qty_sum:
        totals["qty"] = qty_sum
    return {
        "id": qid,
        "bitrix_deal_id": deal_id,
        "quote_source": "asesor",
        "nit": nit or "0",
        "nombre": nombre or nit or f"Deal {deal_id}",
        "empresa": empresa,
        "seller_codigo": codigo,
        "seller_name": seller_name,
        "assigned_by_id": assigned,
        "asesor_estado": estado if estado != "nueva" else "cotizado",
        "created_at": created,
        "finished_at": created,
        "fecha_cierre": fecha_cierre,
        "items": items,
        "totals": totals,
        "imported_from_bitrix": True,
        "synced_from_bitrix": True,
        "imported_at": datetime.now(timezone.utc).isoformat(),
    }


def quote_is_priced(q: dict) -> bool:
    if not isinstance(q, dict):
        return False
    tot = q.get("totals") if isinstance(q.get("totals"), dict) else {}
    for k in ("usdIva", "copIva", "totalConFlete", "usd", "cop", "totalUsdIva", "totalCopIva"):
        try:
            if float(tot.get(k) or 0) > 0:
                return True
        except Exception:
            pass
    for it in q.get("items") or []:
        if not isinstance(it, dict):
            continue
        for k in ("usdIva", "copIva", "totalUsdIva", "totalCopIva", "usd", "cop", "price", "PRICE"):
            try:
                if float(it.get(k) or 0) > 0:
                    return True
            except Exception:
                pass
    return False


def fetch_deals(webhook: str, assigned_id: str, cfg: dict, since: str = SINCE) -> dict[str, dict]:
    deals: dict[str, dict] = {}
    start = 0
    while True:
        filt = {
            "ASSIGNED_BY_ID": int(assigned_id),
        }
        if str(since or "").strip():
            filt[">=DATE_CREATE"] = str(since).strip()
        cat = str(cfg.get("category_id") or "").strip()
        if cat:
            filt["CATEGORY_ID"] = int(cat) if cat.isdigit() else cat
        resp = bitrix_rest(
            webhook,
            "crm.deal.list.json",
            {
                "filter": filt,
                "select": [
                    "ID",
                    "TITLE",
                    "DATE_CREATE",
                    "CLOSEDATE",
                    "ASSIGNED_BY_ID",
                    "COMPANY_ID",
                    "COMMENTS",
                    "ORIGIN_ID",
                    "STAGE_ID",
                    "OPPORTUNITY",
                    "CURRENCY_ID",
                ],
                "order": {"DATE_CREATE": "DESC"},
                "start": start,
            },
        )
        rows = resp.get("result") if isinstance(resp, dict) else None
        if not isinstance(rows, list) or not rows:
            if start == 0 and isinstance(resp, dict) and resp.get("error"):
                print(f"    bitrix error assigned={assigned_id}: {resp.get('error')} {resp.get('error_description','')}")
            break
        for d in rows:
            if isinstance(d, dict) and d.get("ID"):
                deals[str(d["ID"])] = d
        nxt = resp.get("next")
        if nxt is None:
            break
        start = int(nxt)
        time.sleep(0.15)
    return deals


def apply_deal_map(q: dict, deal_id: str, estado: str, fecha_cierre: str) -> tuple[bool, bool]:
    """Returns (linked_new_deal_id, changed)."""
    linked = False
    changed = False
    if not str(q.get("bitrix_deal_id") or "").strip():
        q["bitrix_deal_id"] = deal_id
        linked = True
        changed = True
    if not quote_estado_locked(q) and estado:
        cur = str(q.get("asesor_estado") or "").strip().lower() or "nueva"
        if estado != cur and estado_priority(estado) >= estado_priority(cur):
            q["asesor_estado"] = estado
            changed = True
    if fecha_cierre and not str(q.get("fecha_cierre") or "").strip():
        q["fecha_cierre"] = fecha_cierre
        changed = True
    if not q.get("synced_from_bitrix"):
        q["synced_from_bitrix"] = True
        changed = True
    return linked, changed


def sync_asesor(
    codigo: str,
    webhook: str,
    cfg: dict,
    quotes: list,
    smap: dict,
    import_new: bool,
    max_import: int = MAX_IMPORT_PER_ASESOR,
    since: str = SINCE,
) -> tuple[int, int, int, int]:
    ids = asesor_bitrix_ids(codigo, smap)
    if not ids:
        print(f"  sin Bitrix ID para {codigo}")
        return 0, 0, 0, 0
    print(f"  bitrix_ids={ids}")
    deals: dict[str, dict] = {}
    for uid in ids:
        deals.update(fetch_deals(webhook, uid, cfg, since))
    by_deal: dict[str, int] = {}
    by_id: dict[str, int] = {}
    for i, q in enumerate(quotes):
        if not isinstance(q, dict):
            continue
        did = str(q.get("bitrix_deal_id") or "").strip()
        if did:
            by_deal[did] = i
        qid = str(q.get("id") or "").strip()
        if qid:
            by_id[qid] = i
    imported = linked = updated = 0
    company_cache: dict = {}
    for deal_id, deal in deals.items():
        estado = stage_to_estado(str(deal.get("STAGE_ID") or ""), cfg)
        close = str(deal.get("CLOSEDATE") or "")
        fecha_cierre = ""
        m = re.match(r"^(\d{4}-\d{2}-\d{2})", close)
        if m:
            fecha_cierre = m.group(1)

        if deal_id in by_deal:
            idx = by_deal[deal_id]
            was_linked, changed = apply_deal_map(quotes[idx], deal_id, estado, fecha_cierre)
            if was_linked:
                linked += 1
            if changed:
                updated += 1
            continue

        origin = str(deal.get("ORIGIN_ID") or "").strip()
        if origin and origin in by_id:
            idx = by_id[origin]
            was_linked, changed = apply_deal_map(quotes[idx], deal_id, estado, fecha_cierre)
            by_deal[deal_id] = idx
            if was_linked:
                linked += 1
            if changed:
                updated += 1
            continue

        # Heurística NIT + ventana de fechas (solo para mapear, no crear).
        deal_nit, _ = company_nit_nombre(webhook, deal.get("COMPANY_ID"), company_cache, cfg)
        if deal_nit and deal_nit != "0":
            deal_ts = 0
            try:
                deal_ts = int(datetime.fromisoformat(str(deal.get("DATE_CREATE") or "").replace(" ", "T")[:19]).timestamp())
            except Exception:
                deal_ts = 0
            matched = False
            for qi, existing in enumerate(quotes):
                if not isinstance(existing, dict):
                    continue
                if normalize_asesor_codigo(str(existing.get("seller_codigo") or "")) != codigo:
                    continue
                enit = re.sub(r"\D+", "", str(existing.get("nit") or ""))
                if enit != deal_nit:
                    continue
                items = existing.get("items")
                if not isinstance(items, list) or not items:
                    continue
                quote_ts = 0
                try:
                    quote_ts = int(
                        datetime.fromisoformat(str(existing.get("created_at") or "").replace(" ", "T")[:19]).timestamp()
                    )
                except Exception:
                    quote_ts = 0
                if deal_ts and quote_ts and abs(deal_ts - quote_ts) > 14 * 86400:
                    continue
                was_linked, changed = apply_deal_map(existing, deal_id, estado, fecha_cierre)
                by_deal[deal_id] = qi
                if was_linked:
                    linked += 1
                if changed:
                    updated += 1
                matched = True
                break
            if matched:
                continue

        if not import_new or imported >= max_import:
            continue
        q = deal_to_quote(deal, webhook, cfg, codigo, smap, company_cache)
        if not q:
            continue
        items = q.get("items") if isinstance(q.get("items"), list) else []
        tot = q.get("totals") if isinstance(q.get("totals"), dict) else {}
        priced = False
        for k in ("usdIva", "copIva", "usd", "cop"):
            try:
                if float(tot.get(k) or 0) > 0:
                    priced = True
                    break
            except Exception:
                pass
        if not priced:
            continue
        qid = str(q.get("id") or "")
        if qid in by_id:
            idx = by_id[qid]
            was_linked, changed = apply_deal_map(quotes[idx], deal_id, estado, fecha_cierre)
            by_deal[deal_id] = idx
            if was_linked:
                linked += 1
            if changed:
                updated += 1
            continue
        quotes.append(q)
        by_id[qid] = len(quotes) - 1
        by_deal[deal_id] = len(quotes) - 1
        imported += 1

    SYNC_DIR.mkdir(parents=True, exist_ok=True)
    save_json(
        SYNC_DIR / f"{codigo}.json",
        {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "imported": imported,
            "linked": linked,
            "updated": updated,
            "deals_found": len(deals),
            "import_new": import_new,
        },
    )
    return imported, linked, updated, len(deals)


def main() -> int:
    parser = argparse.ArgumentParser(description="Mapear/sincronizar cotizaciones con Bitrix")
    parser.add_argument(
        "--import-new",
        action="store_true",
        help="También crear cotizaciones nuevas desde deals (puede sumar filas vs servidor)",
    )
    parser.add_argument(
        "--link-only",
        action="store_true",
        default=True,
        help="Solo mapear deal_id/estado (default)",
    )
    parser.add_argument(
        "--max-import",
        type=int,
        default=MAX_IMPORT_PER_ASESOR,
        help="Tope de deals nuevos por asesor (con --import-new)",
    )
    parser.add_argument(
        "--since",
        default=SINCE,
        help="Fecha mínima DATE_CREATE en Bitrix (vacío = todas)",
    )
    parser.add_argument(
        "--drop-zero-price",
        action="store_true",
        help="Quitar del JSON las cotizaciones sin monto > 0",
    )
    args = parser.parse_args()
    import_new = bool(args.import_new)
    max_import = max(1, int(args.max_import or MAX_IMPORT_PER_ASESOR))
    since = str(args.since or "").strip()
    if import_new:
        args.link_only = False

    cfg = load_json(BITRIX_FILE, {})
    if not isinstance(cfg, dict) or not cfg.get("enabled") or not cfg.get("webhook_base"):
        print("Bitrix desactivado o sin webhook.")
        return 1
    webhook = str(cfg["webhook_base"]).strip()
    smap = seller_map()
    quotes = load_json(QUOTES_FILE, [])
    if not isinstance(quotes, list):
        quotes = []
    total_imp = total_link = total_upd = total_deals = 0
    mode = "IMPORT+MAP" if import_new else "MAP-ONLY"
    print(f"Mode={mode} quotes_before={len(quotes)}")
    for code in list_asesor_codigos():
        print(f"Sync {code}...")
        try:
            imp, link, upd, found = sync_asesor(
                code, webhook, cfg, quotes, smap, import_new, max_import, since
            )
            total_imp += imp
            total_link += link
            total_upd += upd
            total_deals += found
            print(f"  deals={found} imported={imp} linked={link} updated={upd}")
        except Exception as e:
            print(f"  ERROR {code}: {e}")
    if args.drop_zero_price:
        before = len(quotes)
        quotes = [q for q in quotes if isinstance(q, dict) and quote_is_priced(q)]
        print(f"drop_zero_price removed={before - len(quotes)} kept={len(quotes)}")
    save_json(QUOTES_FILE, quotes)
    FLAG_FILE.write_text(datetime.now(timezone.utc).isoformat() + "\n", encoding="utf-8")
    print(
        f"OK mode={mode} imported={total_imp} linked={total_link} updated={total_upd} "
        f"deals_seen={total_deals} quotes={len(quotes)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
