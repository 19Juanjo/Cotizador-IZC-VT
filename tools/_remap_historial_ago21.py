# -*- coding: utf-8 -*-
"""Re-mapea cotizaciones: fechas Bogotá, sin Deal, historial 21-ago-2026 → hoy."""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo

SERVER = Path(r"C:\IZC Server")
OUT = SERVER / "data" / "cotizaciones.json"
BOG = ZoneInfo("America/Bogota")
SINCE = date(2026, 8, 21)
DEAL_RE = re.compile(r"^Deal\b", re.I)
ID_TS_RE = re.compile(r"^(20\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})")
DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def today_bogota() -> date:
    return datetime.now(BOG).date()


def load_list(path: Path) -> list:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        print("skip", path, exc)
        return []
    if isinstance(data, dict):
        for k in ("quotes", "cotizaciones", "data"):
            if isinstance(data.get(k), list):
                data = data[k]
                break
        else:
            return [data] if isinstance(data, dict) and ("id" in data or "items" in data) else []
    if not isinstance(data, list):
        return []
    return [q for q in data if isinstance(q, dict)]


def is_deal(q: dict) -> bool:
    nombre = str(q.get("nombre") or "").strip()
    if DEAL_RE.match(nombre):
        return True
    nit = re.sub(r"\D+", "", str(q.get("nit") or ""))
    qid = str(q.get("id") or "")
    isbx = bool(re.match(r"^bx[-_]", qid, re.I) or q.get("synced_from_bitrix"))
    if isbx and nit in ("", "0"):
        return True
    return False


def id_datetime(qid: str):
    m = ID_TS_RE.match(str(qid or ""))
    if not m:
        return None
    try:
        return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                        int(m.group(4)), int(m.group(5)), int(m.group(6)), tzinfo=BOG)
    except Exception:
        return None


def created_date(q: dict) -> date | None:
    raw = str(q.get("created_at") or q.get("finished_at") or "").strip()
    m = DATE_RE.match(raw)
    if m:
        try:
            return date.fromisoformat(m.group(1))
        except Exception:
            pass
    dt = id_datetime(str(q.get("id") or ""))
    return dt.date() if dt else None


def normalize_created_at(q: dict) -> dict:
    q = dict(q)
    dt = id_datetime(str(q.get("id") or ""))
    raw = str(q.get("created_at") or "").strip()
    created = None
    m = DATE_RE.match(raw)
    if m:
        try:
            created = date.fromisoformat(m.group(1))
        except Exception:
            created = None
    if dt and (created is None or abs((created - dt.date()).days) > 1):
        q["created_at"] = dt.isoformat()
    elif raw and not raw.endswith(("Z", "00")) and "T" in raw and "+" not in raw[10:] and raw.count("-") >= 2:
        if not re.search(r"[+-]\d{2}:\d{2}$", raw) and not raw.endswith("Z"):
            if re.match(r"^\d{4}-\d{2}-\d{2}T", raw):
                q["created_at"] = raw.replace(" ", "T").split("+")[0].split("Z")[0]
                if not re.search(r"-05:00$", q["created_at"]):
                    base = q["created_at"]
                    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$", base):
                        base += ":00"
                    if re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", base):
                        q["created_at"] = re.sub(r"[+-]\d{2}:\d{2}$", "", base) + "-05:00"
    return q


def score(q: dict) -> tuple:
    items = q.get("items") if isinstance(q.get("items"), list) else []
    skus = priced = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        if str(it.get("sku") or "").strip():
            skus += 1
        for k in ("usdIva", "copIva", "totalUsdIva", "totalCopIva", "usd", "cop"):
            try:
                if float(it.get(k) or 0) > 0:
                    priced += 1
                    break
            except Exception:
                pass
    tot = q.get("totals") if isinstance(q.get("totals"), dict) else {}
    has_tot = 0
    for k in ("usdIva", "copIva", "totalConFlete", "usd", "cop"):
        try:
            if float(tot.get(k) or 0) > 0:
                has_tot = 1
                break
        except Exception:
            pass
    named = 1 if str(q.get("nombre") or "").strip() and not DEAL_RE.match(str(q.get("nombre") or "")) else 0
    deal = 1 if str(q.get("bitrix_deal_id") or "").strip() else 0
    real = 0 if q.get("imported_from_bitrix") or q.get("synced_from_bitrix") else 1
    return (0 if is_deal(q) else 1, real, skus, priced, has_tot, named, deal, len(items))


def key_of(q: dict) -> str:
    qid = str(q.get("id") or "").strip()
    if qid:
        return "id:" + qid
    did = str(q.get("bitrix_deal_id") or "").strip()
    if did.isdigit():
        return "deal:" + did
    return "row:" + "|".join(
        [str(q.get("created_at") or ""), str(q.get("nit") or ""), str(q.get("seller_codigo") or "")]
    )


def merge(sources: list[Path]) -> list:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for src in sources:
        rows = load_list(src)
        print(f"source {src.name if src.name else src} rows={len(rows)}")
        for q in rows:
            q = normalize_created_at(q)
            k = key_of(q)
            if k not in merged:
                merged[k] = q
                order.append(k)
                continue
            if score(q) > score(merged[k]):
                old = merged[k]
                q = dict(q)
                if not str(q.get("bitrix_deal_id") or "").strip() and old.get("bitrix_deal_id"):
                    q["bitrix_deal_id"] = old.get("bitrix_deal_id")
                if not str(q.get("empresa") or "").strip() and old.get("empresa"):
                    q["empresa"] = old.get("empresa")
                merged[k] = q
    return [merged[k] for k in order]


def in_admin_window(q: dict) -> bool:
    if is_deal(q):
        return False
    d = created_date(q)
    if d is None:
        return False
    return SINCE <= d <= today_bogota()


def main() -> None:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = SERVER / "data" / f"_backup_before_remap_window_{stamp}"
    bak.mkdir(parents=True, exist_ok=True)
    if OUT.is_file():
        shutil.copy2(OUT, bak / "cotizaciones.json")
        print("backup", bak)

    sources = [
        SERVER / "data" / "cotizaciones.backup-before-remap-20260922.json",
        SERVER / "data" / "_backup_before_pull_20260922_114858" / "cotizaciones.json",
        SERVER / "data" / "_prod_cotizaciones_export.json",
        Path(r"C:\wamp64\www\IZC\data\cotizaciones.json"),
        OUT,
        SERVER / "data" / "_last_good_cotizaciones.json",
    ]
    quotes = merge(sources)
    until = today_bogota()
    visible = [q for q in quotes if in_admin_window(q)]
    print("merged", len(quotes), "admin_window", len(visible), "since", SINCE, "until", until)
    payload = json.dumps(quotes, ensure_ascii=False, indent=2) + "\n"
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(OUT)
    shutil.copy2(OUT, SERVER / "data" / "_last_good_cotizaciones.json")
    print("saved", OUT)


if __name__ == "__main__":
    main()
