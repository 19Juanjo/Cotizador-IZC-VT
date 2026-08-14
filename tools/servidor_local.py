#!/usr/bin/env python3
"""Servidor local IZC: archivos estáticos + API auth (data/usuarios.json)."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import webbrowser
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
USERS_FILE = ROOT / "data" / "usuarios.json"
QUOTES_FILE = ROOT / "data" / "cotizaciones.json"
TRM_FILE = ROOT / "data" / "trm.json"
PORT = 8080
NIT_RE = re.compile(r"^\d{6,15}(-\d)?$")
ADMIN_NITS = {"03166122778"}


def normalize_nit(nit: str) -> str:
    return re.sub(r"[\s.]", "", (nit or "").strip())


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
    for i, u in enumerate(users):
        if normalize_nit(str(u.get("nit", ""))) == nit:
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
        return hashlib.compare_digest(expected, actual)

    legacy = str(user.get("password") or "")
    return legacy != "" and legacy == password


def public_user(nit: str, password_hash: str, created_at: str, nombre: str = "") -> dict:
    return {
        "nit": nit,
        "nombre": (nombre or "").strip(),
        "password_hash": password_hash,
        "created_at": created_at or datetime.now(timezone.utc).isoformat(),
    }


def is_admin(nit: str) -> bool:
    return normalize_nit(nit) in ADMIN_NITS


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
            "list": self._list,
            "delete": self._delete,
            "upsert": self._upsert,
            "save_quote": self._save_quote,
            "list_quotes": self._list_quotes,
            "get_trm": self._get_trm,
            "set_trm": self._set_trm,
        }
        handler = handlers.get(action)
        if handler:
            handler(body)
        else:
            self._json(
                {
                    "ok": False,
                    "error": "Acción no válida.",
                },
                400,
            )

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
                    "error": "NIT inválido. Usa solo números (opcional dígito de verificación).",
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
        nit = normalize_nit(str(body.get("nit", "")))
        password = str(body.get("password", ""))

        if not nit or not password:
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

        self._json(
            {
                "ok": True,
                "nit": user["nit"],
                "nombre": str(user.get("nombre") or ""),
                "message": "Sesión iniciada.",
            }
        )

    def _list(self, body: dict):
        admin_nit = normalize_nit(str(body.get("admin_nit", "")))
        if not is_admin(admin_nit):
            self._json({"ok": False, "error": "No autorizado."}, 403)
            return

        users = read_users()
        safe = [
            {
                "nit": str(u.get("nit") or ""),
                "nombre": str(u.get("nombre") or "").strip(),
                "created_at": str(u.get("created_at") or ""),
            }
            for u in users
        ]
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

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/marcas.html"
    print(f"IZC local en {url}")
    print(f"Usuarios: {USERS_FILE}")
    print(f"Cotizaciones: {QUOTES_FILE}")
    print(f"TRM: {TRM_FILE}")
    print("Ctrl+C para detener.")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
