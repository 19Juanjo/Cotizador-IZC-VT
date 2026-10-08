# -*- coding: utf-8 -*-
from __future__ import annotations
import json
import urllib.request
from pathlib import Path

ADMIN_NIT = "03166122778"
PROD = "http://pqr.izc.com.co:8183/IZC/api/auth.php"
ROOT = Path(r"C:\IZC Server")
DATA = ROOT / "data"


def count_file(p: Path) -> int:
    if not p.is_file():
        return -1
    try:
        data = json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        print("parse fail", p, exc)
        return -1
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        for k in ("quotes", "cotizaciones", "data"):
            if isinstance(data.get(k), list):
                return len(data[k])
        return len(data)
    return -1


def post(action: str, extra: dict | None = None, timeout: int = 90) -> dict:
    body = {"action": action, "admin_nit": ADMIN_NIT}
    if extra:
        body.update(extra)
    req = urllib.request.Request(
        PROD,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


print("=== local files ===")
for p in sorted(DATA.glob("*cotiz*")):
    print(f"{p.name:50} {p.stat().st_size:10} {count_file(p):6}")
for sub in sorted(DATA.glob("_backup*")):
    q = sub / "cotizaciones.json" if sub.is_dir() else sub
    if q.is_file() and "cotiz" in q.name.lower():
        print(f"{q.relative_to(DATA)} {q.stat().st_size:10} {count_file(q):6}")

print("=== prod list_quotes ===")
try:
    data = post("list_quotes", {"sync_bitrix": 0}, timeout=120)
    qs = data.get("quotes") or []
    print("ok", data.get("ok"), "count", data.get("count"), "len", len(qs), "err", data.get("error"))
    print("bitrix_sync", data.get("bitrix_sync"))
except Exception as e:
    print("list_quotes ERR", e)

print("=== prod export counts only via list? try dump_status ===")
try:
    data = post("export_admin_data", timeout=180)
    counts = data.get("counts") or {}
    print("export ok", data.get("ok"), "counts", counts.get("cotizaciones.json"))
    raw = (data.get("files_raw") or {}).get("cotizaciones.json")
    if isinstance(raw, str) and raw.strip():
        parsed = json.loads(raw)
        print("files_raw list len", len(parsed) if isinstance(parsed, list) else type(parsed))
except Exception as e:
    print("export ERR", e)
