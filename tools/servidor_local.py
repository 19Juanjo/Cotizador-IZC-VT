#!/usr/bin/env python3
"""Servidor local IZC: archivos estáticos + API auth (data/usuarios.json)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import sys
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
USERS_FILE = ROOT / "data" / "usuarios.json"
QUOTES_FILE = ROOT / "data" / "cotizaciones.json"
TRM_FILE = ROOT / "data" / "trm.json"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
NIT_RE = re.compile(r"^\d{6,15}$")
ADMIN_NITS = {"Admin IZC", "AdminIZC", "ADMINIZC", "03166122778", "3166122778"}
ZKTECO_PRODUCTS_FILE = ROOT / "data" / "productos_zkteco.json"
ZKTECO_PRODUCTS_PUBLIC = ROOT / "assets" / "files" / "productos_zkteco.json"
CREATED_PRODUCTS_FILE = ROOT / "data" / "productos_creados_asesor.json"


def is_zkteco_login(raw: str) -> bool:
    s = re.sub(r"[\s.]", "", (raw or "").strip()).upper()
    return s == "ZKTECO"


def normalize_nit(nit: str) -> str:
    s = re.sub(r"[\s.]", "", (nit or "").strip())
    # Quitar dígito de verificación: 900639921-7 -> 900639921
    return re.sub(r"-\d$", "", s)


def read_users() -> list:
    if not USERS_FILE.is_file():
        return []
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def write_users(users: list) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(
        json.dumps(users, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_quotes() -> list:
    if not QUOTES_FILE.is_file():
        return []
    try:
        data = json.loads(QUOTES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def write_quotes(quotes: list) -> None:
    QUOTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    QUOTES_FILE.write_text(
        json.dumps(quotes, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def read_trm() -> dict:
    if not TRM_FILE.is_file():
        return {"value": 3204, "updated_at": "", "updated_by_nit": "", "updated_by_nombre": ""}
    try:
        data = json.loads(TRM_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"value": 3204}
    except (OSError, json.JSONDecodeError):
        return {"value": 3204, "updated_at": "", "updated_by_nit": "", "updated_by_nombre": ""}


def write_trm(value: float, admin_nit: str, admin_nombre: str) -> dict:
    entry = {
        "value": value,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "updated_by_nit": admin_nit,
        "updated_by_nombre": admin_nombre,
    }
    TRM_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRM_FILE.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return entry


def find_user(users: list, nit: str):
    target = normalize_nit(nit)
    target_up = target.upper()
    for i, u in enumerate(users):
        got = normalize_nit(str(u.get("nit", "")))
        if got == target or got.upper() == target_up:
            return i, u
    return None, None


def hash_password(password: str) -> str:
    iterations = 100000
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations, dklen=32
    )
    return (
        f"pbkdf2${iterations}$"
        f"{base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"
    )


def verify_password(password: str, user: dict) -> bool:
    stored = str(user.get("password_hash") or "")
    if stored.startswith("pbkdf2$"):
        parts = stored.split("$")
        if len(parts) != 4:
            return False
        try:
            iterations = int(parts[1])
            salt = base64.b64decode(parts[2])
            expected = base64.b64decode(parts[3])
        except (ValueError, TypeError):
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, iterations, dklen=len(expected)
        )
        if hmac.compare_digest(expected, actual):
            return True

    legacy = str(user.get("password") or "")
    return legacy != "" and hmac.compare_digest(
        legacy.encode("utf-8"), password.encode("utf-8")
    )


def public_user(nit: str, password_hash: str, created_at: str, nombre: str = "") -> dict:
    return {
        "nit": nit,
        "nombre": (nombre or "").strip(),
        "password_hash": password_hash,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
    }


def is_admin(nit: str) -> bool:
    token = re.sub(r"[\s._-]", "", (nit or "").strip()).upper()
    if token in {"ADMINIZC", "ADMIN", "IZCADMIN"}:
        return True
    n = normalize_nit(nit)
    if n in ADMIN_NITS:
        return True
    core = n.lstrip("0")
    return core.isdigit() and core == "3166122778"


def zkteco_actor_ok(body: dict) -> bool:
    if not isinstance(body, dict):
        return False
    for k in ("zkteco_user", "nit", "admin_nit", "asesor_codigo", "nit_asesor"):
        if is_zkteco_login(str(body.get(k) or "")):
            return True
    return False


def read_json_file(path: Path, fallback):
    if not path.is_file():
        return fallback
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data
    except (OSError, json.JSONDecodeError):
        return fallback


def write_json_file(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_productos_zkteco(data: dict) -> None:
    write_json_file(ZKTECO_PRODUCTS_FILE, data)
    try:
        write_json_file(ZKTECO_PRODUCTS_PUBLIC, data)
    except OSError:
        pass


def read_productos_zkteco() -> dict:
    data = read_json_file(ZKTECO_PRODUCTS_FILE, {"products": []})
    if not isinstance(data, dict):
        return {"products": []}
    if not isinstance(data.get("products"), list):
        data["products"] = []
    return data


def normalize_zkteco_row(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    sku = str(row.get("sku") or row.get("codigo") or "").strip().upper()
    name = str(row.get("name") or row.get("nombre") or "").strip()
    if not sku and not name:
        return None
    try:
        usd = float(row.get("unitario_usd") or row.get("unitarioUsd") or row.get("usd") or 0)
    except (TypeError, ValueError):
        usd = 0.0
    try:
        cop = float(row.get("unitario_cop") or row.get("unitarioCop") or row.get("cop") or 0)
    except (TypeError, ValueError):
        cop = 0.0
    pid = str(row.get("id") or "").strip()
    if not pid:
        pid = hashlib.sha1(f"{sku}|{name}|{datetime.now().timestamp()}".encode()).hexdigest()[:16]
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": pid,
        "sku": sku or pid,
        "name": name or f"Producto {sku or pid}",
        "referencia": str(row.get("referencia") or "").strip(),
        "category": str(row.get("category") or row.get("categoria") or "").strip().lower(),
        "source": str(row.get("source") or "").strip().lower(),
        "unitario_usd": usd if usd > 0 else 0,
        "unitario_cop": cop if cop > 0 else 0,
        "created_at": str(row.get("created_at") or now),
        "updated_at": str(row.get("updated_at") or now),
        "created_by": str(row.get("created_by") or "ZKTECO").strip() or "ZKTECO",
    }


def quote_has_priced_deal(quote: dict) -> bool:
    if not isinstance(quote, dict):
        return False
    tot = quote.get("totals") if isinstance(quote.get("totals"), dict) else {}
    for k in ("usdIva", "copIva", "totalConFlete", "usd", "cop", "totalUsdIva", "totalCopIva"):
        try:
            if float(tot.get(k) or 0) > 0:
                return True
        except (TypeError, ValueError):
            pass
    items = quote.get("items") if isinstance(quote.get("items"), list) else []
    for line in items:
        if not isinstance(line, dict):
            continue
        for k in ("usdIva", "copIva", "totalUsdIva", "totalCopIva", "usd", "cop", "unitario_usd", "unitario_cop", "price", "PRICE"):
            try:
                if float(line.get(k) or 0) > 0:
                    return True
            except (TypeError, ValueError):
                pass
    return False


def quote_is_made_by_zkteco(quote: dict) -> bool:
    if not isinstance(quote, dict):
        return False
    src = str(quote.get("quote_source") or "").strip().lower()
    if src in ("zkteco", "zebra"):
        return True
    for k in ("seller_codigo", "asesor_cotizado_by", "zkteco_user", "finished_by"):
        if is_zkteco_login(str(quote.get(k) or "")):
            return True
    return False


_ZK_SKU_SET = None


def zkteco_sku_key(sku: str) -> str:
    return re.sub(r"[\s.\-]", "", str(sku or "")).upper()


def zkteco_sku_set() -> set:
    global _ZK_SKU_SET
    if _ZK_SKU_SET is not None:
        return _ZK_SKU_SET
    skus = set()
    for path in (ZKTECO_PRODUCTS_FILE, ZKTECO_PRODUCTS_PUBLIC):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        products = data.get("products") if isinstance(data, dict) else data
        if not isinstance(products, list):
            continue
        for p in products:
            if not isinstance(p, dict):
                continue
            key = zkteco_sku_key(str(p.get("sku") or p.get("codigo") or ""))
            if key:
                skus.add(key)
    _ZK_SKU_SET = skus
    return skus


def quote_item_looks_zkteco(item, sku_set) -> bool:
    if not isinstance(item, dict):
        return False
    sku = zkteco_sku_key(str(item.get("sku") or item.get("codigo") or ""))
    if sku and sku in sku_set:
        return True
    blob = " ".join(
        [
            str(item.get("brand") or ""),
            str(item.get("brandName") or ""),
            str(item.get("marca") or ""),
            str(item.get("name") or ""),
            str(item.get("nombre") or ""),
        ]
    ).lower()
    return "zkteco" in blob


def quote_is_asesor_zkteco(quote: dict) -> bool:
    if not isinstance(quote, dict) or quote_is_made_by_zkteco(quote):
        return False
    src = str(quote.get("quote_source") or "").strip().lower()
    if src in ("cliente", "portal"):
        return False
    seller = str(quote.get("seller_codigo") or "").strip().upper()
    by = str(quote.get("asesor_cotizado_by") or quote.get("finished_by") or "").strip().upper()
    has_asesor = (seller and seller != "ZKTECO") or (by and by != "ZKTECO") or src == "asesor"
    if not has_asesor:
        return False
    sku_set = zkteco_sku_set()
    items = quote.get("items") if isinstance(quote.get("items"), list) else []
    return any(quote_item_looks_zkteco(it, sku_set) for it in items)


def find_quote_by_id(quotes, quote_id: str):
    quote_id = str(quote_id or "").strip()
    if not quote_id:
        return None
    found_deal = None
    for q in quotes:
        if not isinstance(q, dict):
            continue
        if str(q.get("id") or "").strip() == quote_id:
            return q
        if str(q.get("bitrix_deal_id") or "").strip() == quote_id:
            found_deal = q
    return found_deal


def quote_to_safe_row(q: dict, list_only: bool = False) -> dict:
    items = q.get("items") if isinstance(q.get("items"), list) else []
    tot = q.get("totals") if isinstance(q.get("totals"), dict) else {}
    usd = tot.get("usdIva") if tot.get("usdIva") is not None else tot.get("usd")
    cop = tot.get("copIva") if tot.get("copIva") is not None else tot.get("cop")
    try:
        usd_n = float(usd or 0)
    except (TypeError, ValueError):
        usd_n = 0.0
    try:
        cop_n = float(cop or 0)
    except (TypeError, ValueError):
        cop_n = 0.0
    parts = []
    if usd_n > 0:
        parts.append("$ " + format(usd_n, ",.2f"))
    if cop_n > 0:
        parts.append("$ " + format(int(round(cop_n)), ",") + " COP")
    row = {
        "id": str(q.get("id") or ""),
        "nit": str(q.get("nit") or ""),
        "nombre": str(q.get("nombre") or ""),
        "created_at": str(q.get("created_at") or ""),
        "trm": q.get("trm"),
        "empresa": str(q.get("empresa") or tot.get("empresa") or ""),
        "bitrix_deal_id": str(q.get("bitrix_deal_id") or ""),
        "seller_codigo": str(q.get("seller_codigo") or ""),
        "seller_name": str(q.get("seller_name") or ""),
        "asesor_estado": str(q.get("asesor_estado") or "cotizado"),
        "asesor_comentario": str(q.get("asesor_comentario") or ""),
        "product_count": len(items),
        "items_count": len(items),
        "total_usd": usd_n if usd_n > 0 else None,
        "total_cop": cop_n if cop_n > 0 else None,
        "total_display": " · ".join(parts),
        "quote_source": str(q.get("quote_source") or ""),
        "totals": tot,
    }
    if not list_only:
        row["items"] = items
    return row


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        path = urlparse(self.path).path
        if path in ("/api/auth", "/api/auth.php"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/auth", "/api/auth.php"):
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            body = {}

        action = (body.get("action") or "").strip().lower()
        handlers = {
            "register": self._register,
            "login": self._login,
            "update_zkteco_nombre": self._update_zkteco_nombre,
            "set_zkteco_nombre": self._update_zkteco_nombre,
            "list": self._list,
            "delete": self._delete,
            "upsert": self._upsert,
            "save_quote": self._save_quote,
            "list_quotes": self._list_quotes,
            "list_quotes_zkteco": self._list_quotes_zkteco,
            "list_quotes_zkteco_asesores": self._list_quotes_zkteco_asesores,
            "get_quote_zkteco": self._get_quote_zkteco,
            "get_quote_asesor": self._get_quote_asesor,
            "finish_quote_asesor": self._finish_quote_asesor,
            "get_trm": self._get_trm,
            "set_trm": self._set_trm,
            "list_productos_creados": self._list_productos_creados,
            "list_created_products": self._list_productos_creados,
            "get_productos_creados": self._list_productos_creados,
            "search_clientes_nombre": self._search_clientes_nombre,
            "adopt_producto_creado_asesor": self._adopt_producto_creado_asesor,
            "list_productos_zkteco": self._list_productos_zkteco,
            "save_producto_zkteco": self._save_producto_zkteco,
            "delete_producto_zkteco": self._delete_producto_zkteco,
            "list_productos_zebra": self._list_productos_zkteco,
            "save_producto_zebra": self._save_producto_zkteco,
            "delete_producto_zebra": self._delete_producto_zkteco,
        }
        handler = handlers.get(action)
        if not handler:
            self._json(
                {
                    "ok": False,
                    "error": "Acción no válida.",
                },
                400,
            )
            return
        try:
            handler(body)
        except Exception:
            self._json({"ok": False, "error": "Error interno de autenticación."}, 500)

    def _register(self, body: dict):
        nit = normalize_nit(str(body.get("nit", "")))
        password = str(body.get("password", ""))
        nombre = str(body.get("nombre") or body.get("name") or "").strip()

        if not nombre or len(nombre) < 2:
            self._json(
                {"ok": False, "error": "Ingresa un nombre válido (mínimo 2 caracteres)."},
                400,
            )
            return
        if not nit or not NIT_RE.match(nit):
            self._json(
                {
                    "ok": False,
                    "error": "NIT inválido. Usa solo números (sin dígito de verificación).",
                },
                400,
            )
            return
        if len(password) < 4:
            self._json(
                {"ok": False, "error": "La contraseña debe tener al menos 4 caracteres."},
                400,
            )
            return

        users = read_users()
        _, existing = find_user(users, nit)
        if existing:
            self._json({"ok": False, "error": "Este NIT ya está registrado."}, 409)
            return

        users.append(public_user(nit, hash_password(password), datetime.now(timezone.utc).isoformat(), nombre))
        try:
            write_users(users)
        except OSError:
            self._json({"ok": False, "error": "No se pudo guardar el usuario en el archivo."}, 500)
            return

        self._json({"ok": True, "nit": nit, "nombre": nombre, "message": "Registro exitoso."})

    def _login(self, body: dict):
        raw = str(body.get("nit", ""))
        password = str(body.get("password", ""))

        if not raw or not password:
            self._json({"ok": False, "error": "Ingresa usuario y contraseña."}, 400)
            return

        if is_zkteco_login(raw):
            users = read_users()
            idx, user = find_user(users, "ZKTECO")
            if not user:
                user = {
                    "nit": "ZKTECO",
                    "nombre": "ZKTeco",
                    "role": "zkteco",
                    "password_hash": hash_password(password),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                users.append(user)
                write_users(users)
                idx = len(users) - 1
            if not verify_password(password, user):
                self._json({"ok": False, "error": "Usuario o contraseña incorrectos."}, 401)
                return
            if str(user.get("password") or "") and not str(user.get("password_hash") or "").startswith("pbkdf2$"):
                users[idx]["password_hash"] = hash_password(password)
                write_users(users)
            self._json(
                {
                    "ok": True,
                    "nit": "ZKTECO",
                    "nombre": str(user.get("nombre") or "ZKTeco").strip() or "ZKTeco",
                    "role": "zkteco",
                    "message": "Sesión iniciada.",
                }
            )
            return

        nit = normalize_nit(raw)
        if not nit:
            self._json({"ok": False, "error": "Ingresa NIT y contraseña."}, 400)
            return

        users = read_users()
        idx, user = find_user(users, nit)
        if not user or not verify_password(password, user):
            self._json({"ok": False, "error": "NIT o contraseña incorrectos."}, 401)
            return

        if not user.get("password_hash"):
            users[idx] = public_user(
                user["nit"],
                hash_password(password),
                str(user.get("created_at") or datetime.now(timezone.utc).isoformat()),
                str(user.get("nombre") or ""),
            )
            write_users(users)
            user = users[idx]

        role = "admin" if is_admin(str(user.get("nit") or nit)) else "cliente"
        self._json(
            {
                "ok": True,
                "nit": user["nit"],
                "nombre": str(user.get("nombre") or ""),
                "role": role,
                "message": "Sesión iniciada.",
            }
        )

    def _update_zkteco_nombre(self, body: dict):
        if not zkteco_actor_ok(body) and not is_admin(str(body.get("admin_nit") or "")):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        nombre = str(body.get("nombre") or body.get("name") or "").strip()
        if len(nombre) < 2:
            self._json({"ok": False, "error": "Ingresa un nombre válido (mínimo 2 caracteres)."}, 400)
            return
        if len(nombre) > 80:
            self._json({"ok": False, "error": "El nombre es demasiado largo (máx. 80)."}, 400)
            return
        users = read_users()
        idx, user = find_user(users, "ZKTECO")
        if not user:
            for i, u in enumerate(users):
                if isinstance(u, dict) and is_zkteco_login(str(u.get("nit") or "")):
                    idx, user = i, u
                    break
        if not user or idx is None:
            self._json({"ok": False, "error": "Usuario ZKTeco no encontrado."}, 404)
            return
        users[idx]["nombre"] = nombre
        users[idx]["nombre_updated_at"] = datetime.now(timezone.utc).isoformat()
        if not str(users[idx].get("role") or ""):
            users[idx]["role"] = "zkteco"
        write_users(users)
        self._json({"ok": True, "nit": "ZKTECO", "nombre": nombre, "message": "Nombre actualizado."})

    def _list(self, body: dict):
        admin_nit = normalize_nit(str(body.get("admin_nit", "")))
        if not is_admin(admin_nit):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return

        users = read_users()
        safe = []
        for u in users:
            nit = str(u.get("nit") or "")
            role = str(u.get("role") or "").strip().lower()
            if is_zkteco_login(nit) or is_admin(nit):
                continue
            if role in ("zkteco", "zebra", "admin", "asesor"):
                continue
            safe.append(
                {
                    "nit": nit,
                    "nombre": str(u.get("nombre") or "").strip(),
                    "created_at": str(u.get("created_at") or ""),
                    "origen": "portal",
                }
            )
        self._json({"ok": True, "users": safe, "count": len(safe)})

    def _delete(self, body: dict):
        admin_nit = normalize_nit(str(body.get("admin_nit", "")))
        if not is_admin(admin_nit):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return

        nit = normalize_nit(str(body.get("nit", "")))
        if not nit or not NIT_RE.match(nit):
            self._json({"ok": False, "error": "NIT inválido."}, 400)
            return
        if nit == admin_nit:
            self._json(
                {"ok": False, "error": "No puedes eliminar tu propia cuenta de administrador."},
                400,
            )
            return

        users = read_users()
        next_users = [u for u in users if normalize_nit(str(u.get("nit", ""))) != nit]
        if len(next_users) == len(users):
            self._json({"ok": False, "error": "Usuario no encontrado."}, 404)
            return

        try:
            write_users(next_users)
        except OSError:
            self._json({"ok": False, "error": "No se pudo guardar el archivo."}, 500)
            return

        self._json({"ok": True, "nit": nit, "message": "Usuario eliminado."})

    def _upsert(self, body: dict):
        admin_nit = normalize_nit(str(body.get("admin_nit", "")))
        if not is_admin(admin_nit):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return

        nit = normalize_nit(str(body.get("nit", "")))
        nombre = str(body.get("nombre") or "").strip()
        password_hash = str(body.get("password_hash") or "")
        created_at = str(body.get("created_at") or datetime.now(timezone.utc).isoformat())

        if not nit or not NIT_RE.match(nit):
            self._json({"ok": False, "error": "NIT inválido."}, 400)
            return
        if not password_hash.startswith("pbkdf2$"):
            self._json({"ok": False, "error": "Hash de contraseña inválido."}, 400)
            return

        users = read_users()
        idx, _ = find_user(users, nit)
        entry = public_user(nit, password_hash, created_at, nombre)
        if idx is None:
            users.append(entry)
        else:
            users[idx] = entry

        try:
            write_users(users)
        except OSError:
            self._json({"ok": False, "error": "No se pudo guardar el archivo."}, 500)
            return

        self._json({"ok": True, "nit": nit, "nombre": nombre, "message": "Usuario guardado en usuarios.json."})

    def _save_quote(self, body: dict):
        nit = normalize_nit(str(body.get("nit", "")))
        nombre = str(body.get("nombre") or "").strip()
        if not nit or not NIT_RE.match(nit):
            self._json({"ok": False, "error": "NIT inválido."}, 400)
            return

        users = read_users()
        _, user = find_user(users, nit)
        if not user:
            self._json({"ok": False, "error": "Usuario no registrado."}, 403)
            return
        if not nombre:
            nombre = str(user.get("nombre") or "")

        items = body.get("items")
        if not isinstance(items, list) or not items:
            self._json({"ok": False, "error": "La cotización no tiene productos."}, 400)
            return

        quote = {
            "id": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f") + "-" + nit,
            "nit": nit,
            "nombre": nombre,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "trm": body.get("trm"),
            "items": items,
            "totals": body.get("totals") if isinstance(body.get("totals"), dict) else {},
        }
        quotes = read_quotes()
        quotes.append(quote)
        try:
            write_quotes(quotes)
        except OSError:
            self._json({"ok": False, "error": "No se pudo guardar la cotización."}, 500)
            return

        self._json({"ok": True, "id": quote["id"], "message": "Cotización guardada."})

    def _list_quotes(self, body: dict):
        admin_nit = normalize_nit(str(body.get("admin_nit", "")))
        if not is_admin(admin_nit):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return

        quotes = read_quotes()
        quotes.sort(key=lambda q: str(q.get("created_at") or ""), reverse=True)
        safe = []
        for q in quotes:
            if not isinstance(q, dict):
                continue
            if not quote_has_priced_deal(q):
                continue
            safe.append(
                {
                    "id": str(q.get("id") or ""),
                    "nit": str(q.get("nit") or ""),
                    "nombre": str(q.get("nombre") or ""),
                    "created_at": str(q.get("created_at") or ""),
                    "trm": q.get("trm"),
                    "items": q.get("items") if isinstance(q.get("items"), list) else [],
                    "totals": q.get("totals") if isinstance(q.get("totals"), dict) else {},
                }
            )
        self._json({"ok": True, "quotes": safe, "count": len(safe)})

    def _list_quotes_zkteco(self, body: dict):
        if not zkteco_actor_ok(body) and not is_admin(str(body.get("admin_nit") or "")):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        quotes = read_quotes()
        quotes.sort(key=lambda q: str(q.get("created_at") or ""), reverse=True)
        safe = []
        for q in quotes:
            if not isinstance(q, dict) or not quote_is_made_by_zkteco(q):
                continue
            if q.get("asesor_eliminada"):
                continue
            if not quote_has_priced_deal(q):
                continue
            items = q.get("items") if isinstance(q.get("items"), list) else []
            tot = q.get("totals") if isinstance(q.get("totals"), dict) else {}
            usd = tot.get("usdIva") if tot.get("usdIva") is not None else tot.get("usd")
            cop = tot.get("copIva") if tot.get("copIva") is not None else tot.get("cop")
            try:
                usd_n = float(usd or 0)
            except (TypeError, ValueError):
                usd_n = 0.0
            try:
                cop_n = float(cop or 0)
            except (TypeError, ValueError):
                cop_n = 0.0
            parts = []
            if usd_n > 0:
                parts.append("$ " + format(usd_n, ",.2f"))
            if cop_n > 0:
                parts.append("$ " + format(int(round(cop_n)), ",") + " COP")
            safe.append(
                {
                    "id": str(q.get("id") or ""),
                    "nit": str(q.get("nit") or ""),
                    "nombre": str(q.get("nombre") or ""),
                    "created_at": str(q.get("created_at") or ""),
                    "empresa": str(q.get("empresa") or ""),
                    "product_count": len(items),
                    "items_count": len(items),
                    "total_usd": usd_n if usd_n > 0 else None,
                    "total_cop": cop_n if cop_n > 0 else None,
                    "total_display": " · ".join(parts),
                    "quote_source": str(q.get("quote_source") or "zkteco"),
                    "seller_codigo": "ZKTECO",
                    "items": items,
                    "totals": tot,
                }
            )
        self._json(
            {
                "ok": True,
                "quotes": safe,
                "count": len(safe),
                "count_historial": len(safe),
                "role": "zkteco",
                "codigo": "ZKTECO",
            }
        )

    def _list_quotes_zkteco_asesores(self, body: dict):
        if not zkteco_actor_ok(body) and not is_admin(str(body.get("admin_nit") or "")):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        list_only = bool(body.get("fast") or body.get("list_only"))
        quotes = read_quotes()
        quotes.sort(key=lambda q: str(q.get("created_at") or ""), reverse=True)
        safe = []
        for q in quotes:
            if not isinstance(q, dict) or not quote_is_asesor_zkteco(q):
                continue
            if q.get("asesor_eliminada"):
                continue
            if not quote_has_priced_deal(q):
                continue
            safe.append(quote_to_safe_row(q, list_only=list_only))
        self._json(
            {
                "ok": True,
                "quotes": safe,
                "count": len(safe),
                "count_historial": len(safe),
                "role": "zkteco",
                "codigo": "ZKTECO",
                "scope": "asesores",
            }
        )

    def _get_quote_zkteco(self, body: dict):
        if not zkteco_actor_ok(body) and not is_admin(str(body.get("admin_nit") or "")):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        quote_id = str(body.get("quote_id") or body.get("id") or "").strip()
        if not quote_id:
            self._json({"ok": False, "error": "Falta el id de la cotización."}, 400)
            return
        found = find_quote_by_id(read_quotes(), quote_id)
        if not found:
            self._json({"ok": False, "error": "Cotización no encontrada."}, 404)
            return
        self._json({"ok": True, "quote": quote_to_safe_row(found, list_only=False)})

    def _get_quote_asesor(self, body: dict):
        quote_id = str(body.get("quote_id") or body.get("id") or "").strip()
        if not quote_id:
            self._json({"ok": False, "error": "Falta el id de la cotización."}, 400)
            return
        found = find_quote_by_id(read_quotes(), quote_id)
        if not found:
            self._json({"ok": False, "error": "Cotización no encontrada."}, 404)
            return
        seller = str(found.get("seller_codigo") or "").strip().upper()
        asked = str(body.get("asesor_codigo") or body.get("nit_asesor") or "").strip().upper()
        if not zkteco_actor_ok(body) and asked and seller and asked != seller:
            self._json({"ok": False, "error": "Cotización no encontrada para este asesor."}, 404)
            return
        self._json({"ok": True, "quote": quote_to_safe_row(found, list_only=False)})

    def _finish_quote_asesor(self, body: dict):
        if not zkteco_actor_ok(body) and not is_zkteco_login(str(body.get("asesor_codigo") or "")):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        items = body.get("items")
        if not isinstance(items, list) or not items:
            self._json({"ok": False, "error": "La cotización no tiene productos."}, 400)
            return
        now = datetime.now(timezone.utc)
        quote_id = str(body.get("quote_id") or "").strip()
        if not quote_id:
            quote_id = now.strftime("%Y%m%d%H%M%S%f") + "-ZKTECO"
        quote = {
            "id": quote_id,
            "nit": "",
            "nombre": "",
            "created_at": now.isoformat(),
            "trm": body.get("trm"),
            "empresa": str(body.get("empresa") or "IZC MAYORISTA S.A.S."),
            "items": items,
            "totals": body.get("totals") if isinstance(body.get("totals"), dict) else {},
            "seller_codigo": "ZKTECO",
            "seller_name": "ZKTeco",
            "asesor_estado": "cotizado",
            "asesor_cotizado_at": now.isoformat(),
            "asesor_cotizado_by": "ZKTECO",
            "quote_source": "zkteco",
            "finished_at": now.isoformat(),
            "zkteco_user": "ZKTECO",
        }
        fecha = str(body.get("fecha_cierre") or body.get("fechaCierre") or "").strip()
        if fecha:
            quote["fecha_cierre"] = fecha
        quotes = read_quotes()
        replaced = False
        for i, q in enumerate(quotes):
            if isinstance(q, dict) and str(q.get("id") or "") == quote_id:
                quote["created_at"] = q.get("created_at") or quote["created_at"]
                quotes[i] = quote
                replaced = True
                break
        if not replaced:
            quotes.append(quote)
        try:
            write_quotes(quotes)
        except OSError:
            self._json({"ok": False, "error": "No se pudo guardar la cotización."}, 500)
            return
        self._json(
            {
                "ok": True,
                "id": quote_id,
                "quote_id": quote_id,
                "bitrix_deal_id": "",
                "message": "Cotización guardada.",
            }
        )

    def _get_trm(self, body: dict):
        entry = read_trm()
        value = entry.get("value")
        try:
            value = float(value)
        except (TypeError, ValueError):
            value = 3204.0
        if value <= 0:
            value = 3204.0
        self._json(
            {
                "ok": True,
                "value": value,
                "updated_at": str(entry.get("updated_at") or ""),
                "updated_by_nit": str(entry.get("updated_by_nit") or ""),
                "updated_by_nombre": str(entry.get("updated_by_nombre") or ""),
            }
        )

    def _set_trm(self, body: dict):
        admin_nit = normalize_nit(str(body.get("admin_nit", "")))
        if not is_admin(admin_nit):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return

        try:
            value = float(body.get("value"))
        except (TypeError, ValueError):
            self._json({"ok": False, "error": "TRM inválida."}, 400)
            return
        if value <= 0:
            self._json({"ok": False, "error": "La TRM debe ser mayor que cero."}, 400)
            return

        admin_nombre = str(body.get("admin_nombre") or "").strip()
        entry = write_trm(value, admin_nit, admin_nombre)
        self._json(
            {
                "ok": True,
                "value": entry["value"],
                "updated_at": entry["updated_at"],
                "message": "TRM actualizada para el cotizador.",
            }
        )

    def _search_clientes_nombre(self, body: dict):
        codigo = str(body.get("asesor_codigo") or body.get("nit_asesor") or body.get("nit") or "").strip()
        if not zkteco_actor_ok(body) and not is_zkteco_login(codigo) and not codigo:
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        q = str(body.get("q") or body.get("nombre") or body.get("query") or "").strip()
        try:
            limit = int(body.get("limit") or 12)
        except (TypeError, ValueError):
            limit = 12
        if limit < 1 or limit > 20:
            limit = 12

        def fold(s: str) -> str:
            t = (s or "").strip().lower()
            for a, b in (
                ("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u"),
                ("ü", "u"), ("ñ", "n"), ("à", "a"), ("è", "e"),
            ):
                t = t.replace(a, b)
            return t

        needle = fold(q)
        if len(needle) < 2:
            self._json({"ok": True, "clientes": [], "count": 0})
            return

        data = read_json_file(ROOT / "data" / "nit_nombres.json", [])
        rows = []
        if isinstance(data, list):
            rows = data
        elif isinstance(data, dict):
            rows = [{"nit": k, "nombre": v} for k, v in data.items()]

        scored = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            nit = normalize_nit(str(row.get("nit") or ""))
            nombre = str(row.get("nombre") or "").strip()
            if not nit or not nombre or is_zkteco_login(nit):
                continue
            hay = fold(nombre)
            pos = hay.find(needle)
            if pos < 0:
                continue
            scored.append((0 if pos == 0 else 1, len(hay), nit, nombre))
        scored.sort()
        clientes = [{"nit": n, "nombre": nm, "telefono": ""} for _, __, n, nm in scored[:limit]]
        self._json({"ok": True, "clientes": clientes, "count": len(clientes)})

    def _list_productos_creados(self, body: dict):
        asesor = str(body.get("asesor_codigo") or body.get("nit_asesor") or "").strip()
        if not is_admin(str(body.get("admin_nit") or "")) and not zkteco_actor_ok(body) and not asesor:
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        data = read_json_file(CREATED_PRODUCTS_FILE, {"products": []})
        products = data.get("products") if isinstance(data, dict) else []
        if not isinstance(products, list):
            products = []
        adopted = set()
        for sku in data.get("adopted_skus") or []:
            s = str(sku or "").strip().upper()
            if s:
                adopted.add(s)
        visible = []
        for p in products:
            if not isinstance(p, dict):
                continue
            sku = str(p.get("sku") or "").strip().upper()
            if sku in adopted:
                continue
            if str(p.get("adopted_at") or p.get("adopted_by") or "").strip():
                continue
            if zkteco_actor_ok(body):
                blob = " ".join(
                    [
                        str(p.get("brand") or ""),
                        str(p.get("marca") or ""),
                        str(p.get("name") or ""),
                        str(p.get("nombre") or ""),
                        str(p.get("referencia") or ""),
                        str(p.get("sku") or ""),
                    ]
                ).lower()
                sku_key = re.sub(r"[\s.\-]", "", str(p.get("sku") or "")).upper()
                is_zk = (
                    "zkteco" in blob
                    or re.search(r"\bzkt\b", blob) is not None
                    or sku_key.startswith("ZK")
                )
                if not is_zk:
                    continue
            visible.append(p)
        self._json({"ok": True, "products": visible, "count": len(visible)})

    def _adopt_producto_creado_asesor(self, body: dict):
        if not is_admin(str(body.get("admin_nit") or "")) and not zkteco_actor_ok(body):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        want_id = str(body.get("id") or "").strip()
        want_sku = str(body.get("sku") or "").strip().upper()
        if not want_id and not want_sku:
            self._json({"ok": False, "error": "Falta el producto a adoptar."}, 400)
            return
        data = read_json_file(CREATED_PRODUCTS_FILE, {"products": []})
        products = data.get("products") if isinstance(data, dict) else []
        if not isinstance(products, list):
            products = []
        now = datetime.now(timezone.utc).isoformat()
        marked = 0
        adopted = set()
        for sku in data.get("adopted_skus") or []:
            s = str(sku or "").strip().upper()
            if s:
                adopted.add(s)
        for p in products:
            if not isinstance(p, dict):
                continue
            pid = str(p.get("id") or "")
            psku = str(p.get("sku") or "").strip().upper()
            if (want_id and pid == want_id) or (want_sku and psku == want_sku):
                p["adopted_at"] = now
                p["adopted_by"] = "ZKTECO"
                marked += 1
                if psku:
                    adopted.add(psku)
        if want_sku:
            adopted.add(want_sku)
        if not marked and not want_sku:
            self._json({"ok": False, "error": "No se encontró ese producto de asesor."}, 404)
            return
        data["products"] = products
        data["adopted_skus"] = sorted(adopted)
        data["updated_at"] = now
        write_json_file(CREATED_PRODUCTS_FILE, data)
        self._json({"ok": True, "message": "Producto movido a ZKTeco.", "count": marked})

    def _list_productos_zkteco(self, body: dict):
        if not is_admin(str(body.get("admin_nit") or "")) and not zkteco_actor_ok(body):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        data = read_productos_zkteco()
        products = [p for p in (normalize_zkteco_row(x) for x in data["products"]) if p]
        products.sort(key=lambda p: str(p.get("updated_at") or p.get("created_at") or ""), reverse=True)
        self._json({"ok": True, "products": products, "count": len(products)})

    def _save_producto_zkteco(self, body: dict):
        if not is_admin(str(body.get("admin_nit") or "")) and not zkteco_actor_ok(body):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        src = body.get("product") if isinstance(body.get("product"), dict) else body
        row = normalize_zkteco_row(src if isinstance(src, dict) else {})
        if not row:
            self._json({"ok": False, "error": "Indica SKU o nombre del producto."}, 400)
            return
        data = read_productos_zkteco()
        found = False
        want_id = str(body.get("id") or row["id"])
        now = datetime.now(timezone.utc).isoformat()
        for i, p in enumerate(data["products"]):
            if not isinstance(p, dict):
                continue
            pid = str(p.get("id") or "")
            psku = str(p.get("sku") or "").strip().upper()
            if (want_id and pid == want_id) or (row["sku"] and psku == row["sku"] and pid):
                row["id"] = pid or row["id"]
                row["created_at"] = str(p.get("created_at") or row["created_at"])
                row["updated_at"] = now
                try:
                    prev_usd = float(p.get("unitario_usd") or 0)
                except (TypeError, ValueError):
                    prev_usd = 0.0
                try:
                    prev_cop = float(p.get("unitario_cop") or 0)
                except (TypeError, ValueError):
                    prev_cop = 0.0
                if (row.get("unitario_usd") or 0) <= 0 and prev_usd > 0:
                    row["unitario_usd"] = prev_usd
                if (row.get("unitario_cop") or 0) <= 0 and prev_cop > 0:
                    row["unitario_cop"] = prev_cop
                data["products"][i] = row
                found = True
                break
        if not found:
            row["created_at"] = now
            row["updated_at"] = now
            data["products"].append(row)
        write_productos_zkteco(data)
        self._json(
            {
                "ok": True,
                "product": row,
                "message": "Producto ZKTeco actualizado." if found else "Producto ZKTeco creado.",
            }
        )

    def _delete_producto_zkteco(self, body: dict):
        if not is_admin(str(body.get("admin_nit") or "")) and not zkteco_actor_ok(body):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return
        want_id = str(body.get("id") or "").strip()
        want_sku = str(body.get("sku") or "").strip().upper()
        if not want_id and not want_sku:
            self._json({"ok": False, "error": "Falta el producto a eliminar."}, 400)
            return
        data = read_productos_zkteco()
        kept = []
        removed = False
        for p in data["products"]:
            if not isinstance(p, dict):
                continue
            pid = str(p.get("id") or "")
            psku = str(p.get("sku") or "").strip().upper()
            if (want_id and pid == want_id) or (want_sku and psku == want_sku):
                removed = True
                continue
            kept.append(p)
        if not removed:
            self._json({"ok": False, "error": "No se encontró ese producto ZKTeco."}, 404)
            return
        data["products"] = kept
        write_productos_zkteco(data)
        self._json({"ok": True, "message": "Producto ZKTeco eliminado."})

    def _json(self, payload: dict, code: int = 200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))


def main():
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    if not USERS_FILE.is_file():
        write_users([])
    if not QUOTES_FILE.is_file():
        write_quotes([])
    if not TRM_FILE.is_file():
        write_trm(3204.0, "", "")

    class IZCServer(ThreadingHTTPServer):
        allow_reuse_address = False

    server = IZCServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/marcas.html"
    print(f"IZC local en {url}", flush=True)
    print(f"Usuarios: {USERS_FILE}", flush=True)
    print(f"Cotizaciones: {QUOTES_FILE}", flush=True)
    print(f"TRM: {TRM_FILE}", flush=True)
    print("Ctrl+C para detener.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.", flush=True)


if __name__ == "__main__":
    main()
