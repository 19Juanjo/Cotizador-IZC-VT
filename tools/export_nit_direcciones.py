#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export nit -> direccion from Bitrix company UF address fields."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BITRIX_CFG = DATA / "bitrix.json"
OUT = DATA / "nit_direcciones.json"

# Campos custom de dirección en Compañías (Bitrix IZC)
UF_STREET = "UF_CRM_1746192760"
UF_CITY = "UF_CRM_1746192736"
UF_ZONE = "UF_CRM_1746192792"


def clean_nit(title: str) -> str:
    t = (title or "").strip()
    if not t:
        return ""
    m = re.match(r"^(\d{6,15})(-\d)?\b", t)
    if m:
        return m.group(1)
    digits = re.sub(r"\D", "", t)
    return digits if 6 <= len(digits) <= 15 else ""


def format_dir(street: str, city: str, zone: str) -> str:
    parts = []
    for p in (street, city, zone):
        p = str(p or "").strip()
        if p and p not in parts:
            parts.append(p)
    return ", ".join(parts)


def bitrix_post(base: str, method: str, payload: dict):
    url = base.rstrip("/") + "/" + method.lstrip("/")
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    cfg = json.loads(BITRIX_CFG.read_text(encoding="utf-8"))
    base = str(cfg.get("webhook_base") or "").strip()
    if not base:
        raise SystemExit("Falta webhook_base en data/bitrix.json")

    select = ["ID", "TITLE", UF_STREET, UF_CITY, UF_ZONE]
    best = {}
    start = 0
    fetched = 0
    while start >= 0:
        resp = bitrix_post(
            base,
            "crm.company.list.json",
            {"select": select, "order": {"ID": "ASC"}, "start": start},
        )
        rows = resp.get("result") or []
        if not isinstance(rows, list):
            break
        fetched += len(rows)
        for co in rows:
            nit = clean_nit(co.get("TITLE"))
            if not nit:
                continue
            direccion = format_dir(co.get(UF_STREET), co.get(UF_CITY), co.get(UF_ZONE))
            if not direccion:
                continue
            prev = best.get(nit)
            # Prefer longer / more complete address
            if not prev or len(direccion) > len(prev):
                best[nit] = direccion
        nxt = resp.get("next")
        start = int(nxt) if nxt is not None else -1
        print(f"fetched={fetched} with_dir={len(best)} next={start}", flush=True)

    rows_out = [{"nit": k, "direccion": v} for k, v in sorted(best.items())]
    OUT.write_text(json.dumps(rows_out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK {len(rows_out)} direcciones -> {OUT} @ {datetime.now().isoformat()}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        raise SystemExit(f"Error Bitrix: {e}") from e
