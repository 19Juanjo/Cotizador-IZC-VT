# -*- coding: utf-8 -*-
"""Une local enriquecido + producción y lo intenta subir a pqr.izc.com.co."""
from __future__ import annotations

import json
import shutil
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

SERVER = Path(r"C:\IZC Server")
FIBRA = Path(r"C:\IZC FIBRA OPT")
LOCAL = SERVER / "data" / "cotizaciones.json"
PROD_EXPORT = SERVER / "data" / "_prod_cotizaciones_export.json"
OUT = LOCAL
ADMIN_NIT = "03166122778"
PROD_URLS = [
    "http://pqr.izc.com.co:8183/IZC/api/auth.php",
    "http://pqr.izc.com.co:8183/IZC/api/auth",
]


def load_list(path: Path) -> list:
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def score(q: dict) -> tuple:
    items = q.get("items") if isinstance(q.get("items"), list) else []
    skus = 0
    priced = 0
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
    emp = 1 if str(q.get("empresa") or (q.get("totals") or {}).get("empresa") or "").strip() else 0
    nombre = str(q.get("nombre") or "").strip()
    nit = str(q.get("nit") or "").strip()
    named = 1 if nombre and nombre != nit else 0
    real = 0 if q.get("imported_from_bitrix") else 1
    return (skus, priced, named, emp, real, len(items), len(json.dumps(q, ensure_ascii=False)))


def key_of(q: dict) -> str:
    did = str(q.get("bitrix_deal_id") or "").strip()
    if did:
        return "deal:" + did
    qid = str(q.get("id") or "").strip()
    if qid:
        return "id:" + qid
    return "row:" + "|".join(
        [str(q.get("created_at") or ""), str(q.get("nit") or ""), str(q.get("seller_codigo") or "")]
    )


def merge() -> list:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = SERVER / "data" / f"_backup_before_prod_merge_{stamp}"
    bak.mkdir(parents=True, exist_ok=True)
    shutil.copy2(LOCAL, bak / "cotizaciones.json")
    print("backup", bak)

    merged: dict[str, dict] = {}
    order: list[str] = []
    for src in (PROD_EXPORT, LOCAL):
        rows = load_list(src)
        print("source", src.name, "rows", len(rows))
        for q in rows:
            if not isinstance(q, dict):
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
    out = [merged[k] for k in order]
    payload = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(OUT)
    fibra = FIBRA / "data" / "cotizaciones.json"
    if fibra.parent.is_dir():
        shutil.copy2(OUT, fibra)
        print("copied fibra")
    print("merged", len(out))
    return out


def push(quotes: list) -> None:
    body = json.dumps(
        {"action": "import_admin_data", "admin_nit": ADMIN_NIT, "cotizaciones": quotes},
        ensure_ascii=False,
    ).encode("utf-8")
    last = ""
    for url in PROD_URLS:
        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
            print("push", url, data.get("ok"), data.get("count"), data.get("message") or data.get("error"))
            if data.get("ok"):
                return
            last = str(data.get("error") or raw[:300])
        except urllib.error.HTTPError as e:
            last = e.read().decode("utf-8", errors="replace")[:400]
            print("push HTTP", e.code, last[:200])
        except Exception as e:
            last = str(e)
            print("push ERR", url, e)
    print("PUSH_FAILED", last)


if __name__ == "__main__":
    quotes = merge()
    push(quotes)
