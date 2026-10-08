# -*- coding: utf-8 -*-
"""Fusiona backups + copias locales de cotizaciones.json sin borrar filas."""
from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

SERVER = Path(r"C:\IZC Server")
FIBRA = Path(r"C:\IZC FIBRA OPT")
OUT = SERVER / "data" / "cotizaciones.json"

SOURCES = [
    SERVER / "data" / "cotizaciones.json",
    FIBRA / "data" / "cotizaciones.json",
    SERVER / "data" / "_backup_before_pull_20260917_143848" / "cotizaciones.json",
    SERVER / "data" / "_backup_before_pull_20260917_140934" / "cotizaciones.json",
    SERVER / "data" / "_backup_before_pull_20260917_135015" / "cotizaciones.json",
    SERVER / "data" / "cotizaciones.backup-antes-borrar50.json",
    FIBRA / "data" / "cotizaciones.backup-antes-borrar50.json",
]


def load_list(path: Path) -> list:
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print("skip", path, e)
        return []
    return data if isinstance(data, list) else []


def score(q: dict) -> tuple:
    items = q.get("items") if isinstance(q.get("items"), list) else []
    skus = 0
    for it in items:
        if isinstance(it, dict) and str(it.get("sku") or "").strip():
            skus += 1
    real = 0 if q.get("imported_from_bitrix") else 1
    deal = 1 if str(q.get("bitrix_deal_id") or "").strip() else 0
    return (skus, real, len(items), deal, len(json.dumps(q, ensure_ascii=False)))


def key_of(q: dict) -> str:
    did = str(q.get("bitrix_deal_id") or "").strip()
    if did:
        return "deal:" + did
    qid = str(q.get("id") or "").strip()
    if qid:
        return "id:" + qid
    return "row:" + "|".join(
        [
            str(q.get("created_at") or ""),
            str(q.get("nit") or ""),
            str(q.get("seller_codigo") or ""),
            str(q.get("nombre") or ""),
        ]
    )


def main() -> None:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = SERVER / "data" / f"_backup_before_merge_{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    if OUT.is_file():
        shutil.copy2(OUT, backup_dir / "cotizaciones.json")
        print("backed up current to", backup_dir)

    merged: dict[str, dict] = {}
    order: list[str] = []
    for src in SOURCES:
        rows = load_list(src)
        print(f"source {src} rows={len(rows)}")
        for q in rows:
            if not isinstance(q, dict):
                continue
            k = key_of(q)
            if k not in merged:
                merged[k] = q
                order.append(k)
                continue
            if score(q) > score(merged[k]):
                # Conservar deal_id / estado si el ganador no los tiene.
                old = merged[k]
                if not str(q.get("bitrix_deal_id") or "").strip() and old.get("bitrix_deal_id"):
                    q = dict(q)
                    q["bitrix_deal_id"] = old.get("bitrix_deal_id")
                if not str(q.get("fecha_cierre") or "").strip() and old.get("fecha_cierre"):
                    q = dict(q)
                    q["fecha_cierre"] = old.get("fecha_cierre")
                merged[k] = q

    out_list = [merged[k] for k in order]
    payload = json.dumps(out_list, ensure_ascii=False, indent=2) + "\n"
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(OUT)
    print("wrote", OUT, "rows", len(out_list))

    fibra_out = FIBRA / "data" / "cotizaciones.json"
    fibra_bak = FIBRA / "data" / f"cotizaciones.backup-before-merge-{stamp}.json"
    if fibra_out.is_file():
        shutil.copy2(fibra_out, fibra_bak)
    shutil.copy2(OUT, fibra_out)
    print("copied to", fibra_out)


if __name__ == "__main__":
    main()
