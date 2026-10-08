# -*- coding: utf-8 -*-
"""Trae cotizaciones del servidor, fusiona, mapea Bitrix y deja el JSON listo."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

SERVER = Path(r"C:\IZC Server")
FIBRA = Path(r"C:\IZC FIBRA OPT")
LOCAL = SERVER / "data" / "cotizaciones.json"
PROD_EXPORT = SERVER / "data" / "_prod_cotizaciones_export.json"
ADMIN_NIT = "03166122778"
PROD_URL = "http://pqr.izc.com.co:8183/IZC/api/auth.php"
sys.path.insert(0, str(SERVER / "tools"))
from _push_cotizaciones_prod import key_of, score  # noqa: E402


def fnum(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0


def is_empty_stub(q: dict) -> bool:
    items = q.get("items") if isinstance(q.get("items"), list) else []
    if items:
        return False
    t = q.get("totals") if isinstance(q.get("totals"), dict) else {}
    return not any(fnum(t.get(k)) > 0 for k in ("usdIva", "copIva", "totalConFlete", "usd", "cop"))


def load_list(path: Path) -> list:
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def export_prod() -> list:
    body = json.dumps({"action": "export_admin_data", "admin_nit": ADMIN_NIT}).encode("utf-8")
    req = urllib.request.Request(
        PROD_URL,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8", errors="replace"))
    if not data.get("ok"):
        raise RuntimeError(data.get("error") or "export failed")
    raw = (data.get("files_raw") or {}).get("cotizaciones.json")
    if not raw:
        raise RuntimeError("sin cotizaciones en export")
    PROD_EXPORT.write_text(raw if isinstance(raw, str) else json.dumps(raw), encoding="utf-8")
    qs = json.loads(raw) if isinstance(raw, str) else raw
    print("prod_export", len(qs) if isinstance(qs, list) else type(qs))
    return qs if isinstance(qs, list) else []


def merge(prod: list, local: list) -> list:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for rows, label in ((prod, "prod"), (local, "local")):
        print("merge", label, len(rows))
        for q in rows:
            if not isinstance(q, dict) or is_empty_stub(q):
                continue
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


def save_quotes(quotes: list) -> None:
    payload = json.dumps(quotes, ensure_ascii=False, indent=2) + "\n"
    tmp = LOCAL.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(LOCAL)
    fibra = FIBRA / "data" / "cotizaciones.json"
    if fibra.parent.is_dir():
        shutil.copy2(LOCAL, fibra)
        print("copied fibra")


def main() -> int:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = SERVER / "data" / f"_backup_before_remap_{stamp}"
    bak.mkdir(parents=True, exist_ok=True)
    if LOCAL.is_file():
        shutil.copy2(LOCAL, bak / "cotizaciones.json")
        print("backup", bak)

    prod = export_prod()
    local = load_list(LOCAL)
    merged = merge(prod, local)
    save_quotes(merged)
    print("merged_before_bitrix", len(merged))

    cmd = [
        sys.executable,
        str(SERVER / "tools" / "sync_bitrix_quotes_all.py"),
        "--import-new",
        "--max-import",
        "5000",
    ]
    print("bitrix", " ".join(cmd))
    rc = subprocess.call(cmd)
    if rc != 0:
        print("bitrix_exit", rc)
        return rc

    quotes = load_list(LOCAL)
    empty = sum(1 for q in quotes if isinstance(q, dict) and is_empty_stub(q))
    print("after_bitrix", len(quotes), "empty", empty)
    save_quotes(quotes)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
