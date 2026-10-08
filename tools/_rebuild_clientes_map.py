# -*- coding: utf-8 -*-
"""Rebuild asesor_clientes_index from Bitrix companies (live) + bitrix_vendedores.json."""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from collections import OrderedDict, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BITRIX_CFG = DATA / "bitrix.json"
VENDEDORES = DATA / "bitrix_vendedores.json"
INDEX_OUT = DATA / "asesor_clientes_index.json"
NOMBRES_OUT = DATA / "nit_nombres.json"
TELEFONOS_OUT = DATA / "nit_telefonos.json"
DIRECCIONES_OUT = DATA / "nit_direcciones.json"
COMPANIAS_OUT = DATA / "bitrix_companias.json"

PRIMARY = "UF_CRM_1746192481"
FALLBACK = "UF_CRM_1746192546"
UF_STREET = "UF_CRM_1746192760"
UF_CITY = "UF_CRM_1746192736"
UF_ZONE = "UF_CRM_1746192792"


def asesor_code(name: str) -> str:
    s = str(name or "").upper()
    m = re.search(r"(?<![A-Z0-9])V(\d{1,4})(?![0-9])", s)
    if m:
        return f"V{int(m.group(1))}"
    m = re.search(r"(?<![A-Z0-9])(ADV)(?![A-Z0-9])", s)
    if m:
        return m.group(1)
    return ""


def clean_nit(title: str) -> str:
    t = (title or "").strip()
    if not t:
        return ""
    m = re.match(r"^(\d{6,15})(-\d)?\b", t)
    if m:
        return m.group(1)
    digits = re.sub(r"\D", "", t)
    return digits if 6 <= len(digits) <= 15 else ""


def strip_nit_prefix(nit: str, name: str) -> str:
    n = (name or "").strip()
    if not n:
        return ""
    for key in filter(None, [nit, re.sub(r"\D", "", nit)]):
        n = re.sub(r"^" + re.escape(key) + r"\s*[-–:/]\s*", "", n, flags=re.I).strip()
    return n


def score_name(nit: str, name: str):
    n = strip_nit_prefix(nit, name)
    if not n or n == nit:
        return (-1, "")
    digits = sum(ch.isdigit() for ch in n)
    return (len(n) - digits * 2, n)


def extract_phones(phone_field):
    vals = []
    seen = set()
    if not phone_field:
        return vals
    items = phone_field if isinstance(phone_field, list) else [phone_field]
    for it in items:
        v = str((it.get("VALUE") if isinstance(it, dict) else it) or "").strip()
        v = re.sub(r"[\s\-]", "", v)
        if v.startswith("+57"):
            v = v[3:]
        elif v.startswith("0057"):
            v = v[4:]
        elif re.match(r"^57\d{7,10}$", v):
            v = v[2:]
        if not v:
            continue
        key = re.sub(r"\D", "", v)
        if not key or key in seen:
            continue
        seen.add(key)
        vals.append(v)
    return vals


def format_direccion(street, city, zone) -> str:
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


def fetch_companies(base: str):
    select = [
        "ID",
        "TITLE",
        "ASSIGNED_BY_ID",
        "PHONE",
        PRIMARY,
        FALLBACK,
        UF_STREET,
        UF_CITY,
        UF_ZONE,
    ]
    all_rows = []
    start = 0
    while start >= 0:
        resp = bitrix_post(
            base,
            "crm.company.list.json",
            {
                "select": select,
                "order": {"ID": "ASC"},
                "start": start,
            },
        )
        rows = resp.get("result") or []
        if not isinstance(rows, list):
            break
        all_rows.extend(rows)
        nxt = resp.get("next")
        start = int(nxt) if nxt is not None else -1
        print(f"fetched={len(all_rows)} next={start}", flush=True)
    return all_rows


def main():
    base = ""
    if BITRIX_CFG.is_file():
        cfg = json.loads(BITRIX_CFG.read_text(encoding="utf-8"))
        base = str(cfg.get("webhook_base") or "").strip()
    if not base:
        # Fallback: pedir webhook al servidor IZC (solo lectura de config).
        try:
            req = urllib.request.Request(
                "http://pqr.izc.com.co:8183/IZC/api/auth.php",
                data=json.dumps({"action": "get_bitrix", "admin_nit": "03166122778"}).encode("utf-8"),
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("ok") and data.get("webhook_base"):
                base = str(data["webhook_base"]).strip()
        except Exception as e:
            raise SystemExit(f"Falta webhook_base en data/bitrix.json ({e})") from e
    if not base:
        raise SystemExit("Falta webhook_base en data/bitrix.json")

    print("Exportando companias desde Bitrix...", flush=True)
    companies = fetch_companies(base)
    COMPANIAS_OUT.write_text(
        json.dumps(
            {
                "exported_at": datetime.now().astimezone().isoformat(),
                "source": "crm.company.list (rebuild map)",
                "total_companies": len(companies),
                "companies": companies,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"companies={len(companies)} -> {COMPANIAS_OUT.name}", flush=True)

    vendedores = json.loads(VENDEDORES.read_text(encoding="utf-8"))

    best = {}
    for co in companies:
        nit = clean_nit(co.get("TITLE"))
        if not nit:
            continue
        for cand in filter(
            None,
            [
                str(co.get(PRIMARY) or "").strip(),
                str(co.get(FALLBACK) or "").strip(),
                str(co.get("TITLE") or "").strip(),
            ],
        ):
            sc, cleaned = score_name(nit, cand)
            if sc < 0:
                continue
            prev = best.get(nit)
            if not prev or sc > prev[0]:
                best[nit] = (sc, cleaned)
    nombres = {nit: val for nit, (_, val) in best.items()}
    rows = [{"nit": k, "nombre": v} for k, v in sorted(nombres.items())]
    NOMBRES_OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    phones_by_nit = {}
    for co in companies:
        nit = clean_nit(co.get("TITLE"))
        if not nit:
            continue
        for p in extract_phones(co.get("PHONE")):
            phones_by_nit.setdefault(nit, [])
            seen = set(re.sub(r"\D", "", x) for x in phones_by_nit[nit])
            k = re.sub(r"\D", "", p)
            if k not in seen:
                phones_by_nit[nit].append(p)
    phone_rows = [{"nit": k, "telefono": " / ".join(v)} for k, v in sorted(phones_by_nit.items())]
    TELEFONOS_OUT.write_text(json.dumps(phone_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    dirs_by_nit = {}
    for co in companies:
        nit = clean_nit(co.get("TITLE"))
        if not nit:
            continue
        direccion = format_direccion(co.get(UF_STREET), co.get(UF_CITY), co.get(UF_ZONE))
        if not direccion:
            continue
        prev = dirs_by_nit.get(nit)
        if not prev or len(direccion) > len(prev):
            dirs_by_nit[nit] = direccion
    dir_rows = [{"nit": k, "direccion": v} for k, v in sorted(dirs_by_nit.items())]
    DIRECCIONES_OUT.write_text(json.dumps(dir_rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    code_to_ids = defaultdict(list)
    id_to_code = {}
    for bid, name in vendedores.items():
        code = asesor_code(name)
        if not code:
            continue
        bid = str(bid)
        if bid not in code_to_ids[code]:
            code_to_ids[code].append(bid)
        id_to_code[bid] = code

    by = {code: {"bitrix_ids": ids, "clientes": [], "seen": set()} for code, ids in code_to_ids.items()}
    for co in companies:
        assigned = str(co.get("ASSIGNED_BY_ID") or "")
        code = id_to_code.get(assigned)
        if not code:
            continue
        nit = clean_nit(co.get("TITLE"))
        if not nit or nit in by[code]["seen"]:
            continue
        by[code]["seen"].add(nit)
        by[code]["clientes"].append(
            {
                "nit": nit,
                "nombre": nombres.get(nit) or nit,
                "telefono": " / ".join(phones_by_nit.get(nit) or []),
            }
        )

    by_codigo = OrderedDict()
    def code_sort_key(c: str):
        m = re.match(r"^V(\d+)$", c, re.I)
        if m:
            return (0, int(m.group(1)), c)
        return (1, 0, c)

    for code in sorted(by, key=code_sort_key):
        clientes = sorted(by[code]["clientes"], key=lambda c: (c["nombre"].lower(), c["nit"]))
        by_codigo[code] = {
            "bitrix_ids": [int(x) if str(x).isdigit() else x for x in by[code]["bitrix_ids"]],
            "count": len(clientes),
            "clientes": clientes,
        }

    idx = {
        "by_codigo": by_codigo,
        "built_at": datetime.now().astimezone().isoformat(),
        "source": "bitrix live companies + bitrix_vendedores.json",
        "name_fields": [PRIMARY, FALLBACK],
        "nombres_file": "nit_nombres.json",
        "telefonos_file": "nit_telefonos.json",
        "direcciones_file": "nit_direcciones.json",
    }
    INDEX_OUT.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total = sum(v["count"] for v in by_codigo.values())
    named = sum(1 for v in by_codigo.values() for c in v["clientes"] if c["nombre"] != c["nit"])
    print(f"OK asesores={len(by_codigo)} clientes={total} con_nombre={named}", flush=True)
    for code, e in by_codigo.items():
        print(f"  {code}: {e['count']} clientes (ids={e['bitrix_ids']})", flush=True)


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        raise SystemExit(f"Error Bitrix: {e}") from e
