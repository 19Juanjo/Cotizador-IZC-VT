#!/usr/bin/env python3
"""Registra asesores en data/asesores.json (mismo hash pbkdf2 que auth.php)."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "data" / "asesores.json"

# Lista del usuario (V48 duplicado → una sola vez)
VENDORS = [
    ("ADV", "marilopz628", "Mariana Lopez"),
    ("V46", "braguav46", "Brahian Guarin"),
    ("V47", "omarosv47", "Omar Rosas"),
    ("V44", "estgrav44", "Estiven Graciano"),
    ("V50", "rubtabv50", "Ruben Tabares"),
    ("V31", "edgcaiv31", "Edgar Caicedo"),
    ("V49", "bailopv49", "Bairon Lopez"),
    ("V1", "jonramv1", "Jonathan Ramos"),
    ("V4", "edwcelv4", "Edward Celis"),
    ("V45", "anadonv45", "Ana Donado"),
    ("V2", "yaqcorv2", "Yaqueline Corzo"),
    ("V3", "maumorv3", "Mauricio Morales"),
    ("V41", "nelcuev41", "Nelson Cuevas"),
    ("V27", "yaqcorv27", "Yaqueline Corzo"),
    ("V43", "juacubv43", "Juan Cubillos"),
    ("V5", "kelalcv5", "Kelly Alcaraz"),
    ("V48", "danpeñv48", "Daniel Peña"),
    ("V7", "brapinv7", "Brayan Pinilla"),
    ("V29", "brapinv29", "Brayan Pinilla"),
]

# Asesores especiales: un login con varios V# de Bitrix
EXTRAS = {
    "ADV": ["V6", "V28"],
}


def hash_password(password: str, iterations: int = 100000) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=32
    )
    return (
        "pbkdf2$"
        + str(iterations)
        + "$"
        + base64.b64encode(salt).decode("ascii")
        + "$"
        + base64.b64encode(digest).decode("ascii")
    )


def sort_key(code: str):
    m = re.match(r"V(\d+)$", code, re.I)
    if m:
        return (0, int(m.group(1)), code.upper())
    return (1, 0, code.upper())


def main() -> None:
    existing: list = []
    if PATH.exists():
        try:
            existing = json.loads(PATH.read_text(encoding="utf-8")) or []
        except Exception:
            existing = []

    by: dict[str, dict] = {}
    for a in existing:
        code = str(a.get("codigo") or "").strip().upper()
        if code:
            by[code] = a

    tz = timezone(timedelta(hours=-5))
    now = datetime.now(tz).isoformat()
    added: list[str] = []
    updated: list[str] = []

    for code, pwd, nombre in VENDORS:
        code = code.upper()
        prev = by.get(code) or {}
        row = {
            "codigo": code,
            "nombre": nombre,
            "password_hash": hash_password(pwd),
            "created_at": prev.get("created_at") or now,
        }
        extras = EXTRAS.get(code) or prev.get("codigos_extra")
        if extras:
            row["codigos_extra"] = list(extras)
        if code in by:
            updated.append(code)
        else:
            added.append(code)
        by[code] = row

    out = [by[c] for c in sorted(by.keys(), key=sort_key)]
    PATH.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"total={len(out)} added={added} updated={updated}")
    print("nota: V48 estaba duplicado en la tabla; se registro una sola vez (18 unicos).")


if __name__ == "__main__":
    main()
