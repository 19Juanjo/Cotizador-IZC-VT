#!/usr/bin/env python3
"""Completa ADV en producción: extras V6/V28 + mapa Bitrix + sync clientes.

Requiere que api/auth.php NUEVO ya esté en el servidor (update_asesor / save_bitrix_vendedores).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URI = "http://pqr.izc.com.co:8183/IZC/api/auth.php"
ADMIN = "03166122778"

VENDEDORES = {
    "27": "ADV Mariana Lopez",
    "69": "IZC V6 Mariana Lopez",
    "1842": "IZC V28 Mariana Lopez",
}


def post(payload: dict, timeout: int = 180) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        URI,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict):
                data.setdefault("http", 200)
            return data
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except Exception:
            data = {"ok": False, "error": raw[:400]}
        if isinstance(data, dict):
            data["http"] = e.code
        return data


def main() -> None:
    probe = post({"action": "update_asesor", "admin_nit": ADMIN, "codigo": "ADV"})
    err = str(probe.get("error") or "")
    if probe.get("http") == 400 and ("no válida" in err.lower() or "no valida" in err.lower()):
        raise SystemExit(
            "El servidor aún tiene auth.php viejo.\n"
            "Copia C:\\IZC Server\\api\\auth.php a pqr (WAMP\\www\\IZC\\api\\auth.php) y reintenta:\n"
            "  python tools\\_finish_adv_setup.py"
        )

    r1 = post(
        {
            "action": "update_asesor",
            "admin_nit": ADMIN,
            "codigo": "ADV",
            "nombre": "Mariana Lopez",
            "password": "marilopz628",
            "codigos_extra": ["V6", "V28"],
        }
    )
    print("update_asesor:", r1)

    local_map = json.loads((ROOT / "data" / "bitrix_vendedores.json").read_text(encoding="utf-8"))
    r2 = post(
        {
            "action": "save_bitrix_vendedores",
            "admin_nit": ADMIN,
            "vendedores": local_map,
            "replace": True,
        }
    )
    print("save_bitrix_vendedores:", r2)

    r3 = post(
        {
            "action": "list_clientes_asesor",
            "asesor_codigo": "ADV",
            "nit": "ADV",
            "refresh_bitrix": 1,
            "force": 1,
        },
        timeout=300,
    )
    print(
        "clientes ADV:",
        {
            "ok": r3.get("ok"),
            "count": r3.get("count"),
            "bitrix_count": r3.get("bitrix_count"),
            "error": r3.get("bitrix_error") or r3.get("error"),
        },
    )

    exp = post({"action": "export_admin_data", "admin_nit": ADMIN})
    files = exp.get("files_raw") or {}
    asesores = files.get("asesores.json")
    if isinstance(asesores, str):
        asesores = json.loads(asesores)
    adv = [a for a in (asesores or []) if str(a.get("codigo", "")).upper() == "ADV"]
    print("ADV persistido:", adv)

    login = post({"action": "login", "nit": "ADV", "password": "marilopz628"})
    print("login:", {k: login.get(k) for k in ("ok", "nit", "nombre", "codigos_extra", "role")})


if __name__ == "__main__":
    main()
