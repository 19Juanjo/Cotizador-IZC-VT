# -*- coding: utf-8 -*-
"""Restaura el historial de cotizaciones: merge local+prod y sube fusionando (nunca borra)."""
from __future__ import annotations

import json
import shutil
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

SERVER = Path(r"C:\IZC Server")
FIBRA = Path(r"C:\IZC FIBRA OPT")
WAMPS = [Path(r"Q:\wamp64\www\IZC"), Path(r"C:\wamp64\www\IZC")]
OUT = SERVER / "data" / "cotizaciones.json"
ADMIN_NIT = "03166122778"
PROD = "http://pqr.izc.com.co:8183/IZC/api/auth.php"


def load_list(path: Path) -> list:
    if not path.is_file():
        print("missing", path)
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
            if "id" in data or "items" in data:
                data = [data]
            else:
                return []
    if not isinstance(data, list):
        return []
    return [q for q in data if isinstance(q, dict)]


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
    emp = 1 if str(q.get("empresa") or tot.get("empresa") or "").strip() else 0
    nombre = str(q.get("nombre") or "").strip()
    nit = str(q.get("nit") or "").strip()
    named = 1 if nombre and nombre != nit else 0
    deal = 1 if str(q.get("bitrix_deal_id") or "").strip() else 0
    return (skus, priced, has_tot, named, emp, deal, len(items), len(json.dumps(q, ensure_ascii=False)))


def key_of(q: dict) -> str:
    qid = str(q.get("id") or "").strip()
    if qid:
        return "id:" + qid
    did = str(q.get("bitrix_deal_id") or "").strip()
    if did.isdigit():
        return "deal:" + did
    return "row:" + "|".join(
        [
            str(q.get("created_at") or ""),
            str(q.get("nit") or ""),
            str(q.get("seller_codigo") or ""),
            str(q.get("nombre") or ""),
        ]
    )


def merge_sources(sources: list[Path]) -> list:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for src in sources:
        if not src:
            continue
        rows = load_list(src)
        print(f"source {src} rows={len(rows)}")
        for q in rows:
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


def post(action: str, extra: dict | None = None, timeout: int = 180) -> dict:
    body = {"action": action, "admin_nit": ADMIN_NIT}
    if extra:
        body.update(extra)
    raw_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        PROD,
        data=raw_body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        return json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except Exception:
            data = {"ok": False, "error": raw[:400], "http": e.code}
        data.setdefault("ok", False)
        return data


def export_prod(dest: Path) -> list:
    print("exporting prod...")
    data = post("export_admin_data", timeout=180)
    if not data.get("ok"):
        print("export fail", data.get("error") or data)
        return []
    raw = (data.get("files_raw") or {}).get("cotizaciones.json")
    if not isinstance(raw, str) or not raw.strip():
        print("export empty")
        return []
    dest.write_text(raw, encoding="utf-8")
    qs = json.loads(raw)
    print("prod export", len(qs) if isinstance(qs, list) else type(qs))
    return qs if isinstance(qs, list) else []


def copy_to_wamp(quotes: list) -> None:
    payload = json.dumps(quotes, ensure_ascii=False, indent=2) + "\n"
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(OUT)
    print("saved local", len(quotes), OUT)
    for root in [FIBRA] + WAMPS:
        dest = root / "data" / "cotizaciones.json"
        if not dest.parent.is_dir():
            continue
        try:
            shutil.copy2(OUT, dest)
            print("copied", dest)
        except Exception as exc:
            print("copy skip", dest, exc)
        api_src = SERVER / "api" / "auth.php"
        api_dst = root / "api" / "auth.php"
        if api_src.is_file() and api_dst.parent.is_dir():
            try:
                shutil.copy2(api_src, api_dst)
                print("copied auth.php", api_dst)
            except Exception as exc:
                print("auth copy skip", exc)


def push_chunks(quotes: list, size: int = 180) -> bool:
    ok_any = False
    total = len(quotes)
    for i in range(0, total, size):
        chunk = quotes[i : i + size]
        print(f"push chunk {i+1}-{i+len(chunk)} / {total}")
        data = post("import_admin_data", {"cotizaciones": chunk}, timeout=180)
        print("  ", data.get("ok"), data.get("count"), data.get("message") or data.get("error"))
        if data.get("ok"):
            ok_any = True
        else:
            print("chunk failed")
            return False
    return ok_any


def main() -> None:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak = SERVER / "data" / f"_backup_before_restore_{stamp}"
    bak.mkdir(parents=True, exist_ok=True)
    if OUT.is_file():
        shutil.copy2(OUT, bak / "cotizaciones.json")
        print("backup", bak)

    prod_export = SERVER / "data" / "_prod_cotizaciones_export.json"
    export_prod(prod_export)

    sources = [
        SERVER / "data" / "cotizaciones.backup-before-empty-clean.json",
        SERVER / "data" / "cotizaciones.backup-before-remap-20260922.json",
        SERVER / "data" / "_backup_before_pull_20260922_114858" / "cotizaciones.json",
        SERVER / "data" / "_last_good_cotizaciones.json",
        FIBRA / "data" / "cotizaciones.json",
        Path(r"Q:\wamp64\www\IZC\data\cotizaciones.json"),
        Path(r"C:\wamp64\www\IZC\data\cotizaciones.json"),
        Path(r"Q:\wamp64\www\IZC\data\_last_good_cotizaciones.json"),
        Path(r"C:\wamp64\www\IZC\data\_last_good_cotizaciones.json"),
        prod_export,
        OUT,
    ]
    quotes = merge_sources(sources)
    print("MERGED", len(quotes))
    copy_to_wamp(quotes)

    print("=== prod restore_quotes_historial ===")
    print(post("restore_quotes_historial", timeout=120))

    print("=== prod import ===")
    ok = push_chunks(quotes)
    print("=== verify ===")
    v = post("list_quotes", {"sync_bitrix": 0}, timeout=120)
    print("list_quotes count", v.get("count"), "ok", v.get("ok"), "err", v.get("error"))
    if not ok:
        print("Sube api/auth.php al servidor y vuelve a abrir Admin → Historial.")


if __name__ == "__main__":
    main()
