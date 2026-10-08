"""Vigila lista-precios-izc.xlsb y lista-precios-zebra.xlsb; regenera precios.

Se ejecuta en segundo plano (pythonw) al iniciar Windows o al abrir el sitio
(vía tools/ABRIR.bat → INICIAR_VIGILANCIA.vbs).

Al detectar un cambio en cualquier Excel regenera:
  - precios.json / precios.data.js          (clientes)
  - precios_lp_asesor.json / .data.js       (cotizador asesor)
  - referencias.json / .data.js
  - inventario.json / .data.js              (bodegas IZC / VALTECH)
"""
from __future__ import annotations

import atexit
import os
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR / "src"))

from extraer_precios import (  # noqa: E402
    RUTA_DATA_JS,
    RUTA_EXCEL,
    RUTA_EXCEL_ZEBRA,
    RUTA_INV_DATA_JS,
    RUTA_INV_JSON,
    RUTA_JSON,
    RUTA_LP_DATA_JS,
    RUTA_LP_JSON,
    RUTA_REF_DATA_JS,
    RUTA_REF_JSON,
    sincronizar_todo,
)

EXCEL_FILES = (RUTA_EXCEL, RUTA_EXCEL_ZEBRA)

POLL_SECONDS = 2.0
LOCK_FILE = BASE_DIR / "assets" / "files" / ".precios-watch.lock"
LOG_FILE = BASE_DIR / "assets" / "files" / "precios-watch.log"

OUTPUT_FILES = (
    RUTA_JSON,
    RUTA_DATA_JS,
    RUTA_LP_JSON,
    RUTA_LP_DATA_JS,
    RUTA_REF_JSON,
    RUTA_REF_DATA_JS,
    RUTA_INV_JSON,
    RUTA_INV_DATA_JS,
)


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass
    try:
        print(line, flush=True)
    except OSError:
        pass


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION, False, pid
            )
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                return True
            return False
        except Exception:
            return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def acquire_lock() -> bool:
    """Una sola instancia: mutex de Windows + archivo PID de respaldo."""
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)

    if os.name == "nt":
        import ctypes

        ERROR_ALREADY_EXISTS = 183
        handle = ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\IZC_PreciosWatcher")
        if not handle:
            log("No se pudo crear el mutex de instancia única.")
            return False
        if ctypes.windll.kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
            log("Ya hay un vigilante activo. Saliendo.")
            ctypes.windll.kernel32.CloseHandle(handle)
            return False
        globals()["_IZC_MUTEX_HANDLE"] = handle
    else:
        if LOCK_FILE.exists():
            try:
                old_pid = int(LOCK_FILE.read_text(encoding="utf-8").strip() or "0")
            except ValueError:
                old_pid = 0
            if old_pid and pid_alive(old_pid) and old_pid != os.getpid():
                log(f"Ya hay un vigilante activo (PID {old_pid}). Saliendo.")
                return False

    LOCK_FILE.write_text(str(os.getpid()), encoding="utf-8")

    def _cleanup() -> None:
        try:
            if LOCK_FILE.exists() and LOCK_FILE.read_text(encoding="utf-8").strip() == str(
                os.getpid()
            ):
                LOCK_FILE.unlink()
        except OSError:
            pass

    atexit.register(_cleanup)
    return True


def signature(path: Path) -> tuple[float, int] | None:
    if not path.exists():
        return None
    st = path.stat()
    return (st.st_mtime, st.st_size)


def excel_signatures() -> tuple[tuple[float, int] | None, ...]:
    return tuple(signature(path) for path in EXCEL_FILES)


def needs_update(excel_sigs: tuple[tuple[float, int] | None, ...]) -> bool:
    if not excel_sigs[0]:
        return False
    mtimes: list[float] = []
    for path in OUTPUT_FILES:
        if not path.exists():
            return True
        mtimes.append(path.stat().st_mtime)
    oldest = min(mtimes) if mtimes else 0.0
    for sig in excel_sigs:
        if sig and sig[0] > oldest:
            return True
    return False


def wait_until_stable(path: Path, rounds: int = 4, delay: float = 0.5) -> tuple[float, int] | None:
    """Espera a que tamaño/mtime dejen de cambiar (Excel terminó de guardar)."""
    prev = signature(path)
    for _ in range(rounds):
        time.sleep(delay)
        cur = signature(path)
        if cur is None:
            return None
        if cur == prev:
            return cur
        prev = cur
    return signature(path)


def sync_now(reason: str) -> None:
    log(reason)
    stats = sincronizar_todo(verbose=False)
    log(
        f"OK: clientes={stats['precios']} LPs={stats['lp_lists']} "
        f"refs={stats['referencias']} inv={stats.get('inventario', 0)} "
        f"zebra={stats.get('zebra_skus', 0)} "
        f"-> {RUTA_JSON.name}, {RUTA_LP_JSON.name}, {RUTA_REF_JSON.name}, {RUTA_INV_JSON.name}"
    )


def main() -> None:
    if not acquire_lock():
        return

    log("Vigilante de precios iniciado (sin XAMPP)")
    log(f"Excel IZC: {RUTA_EXCEL}")
    log(f"Excel ZEBRA: {RUTA_EXCEL_ZEBRA}")

    last_sigs = excel_signatures()
    if last_sigs[0] is None:
        log("Esperando a que exista lista-precios-izc.xlsb...")
    elif needs_update(last_sigs):
        try:
            sync_now("Excel más nuevo que precios → actualizando")
        except Exception as exc:
            log(f"Error al actualizar: {exc}")

    while True:
        try:
            time.sleep(POLL_SECONDS)
            sigs = excel_signatures()
            if sigs[0] is None:
                if last_sigs[0] is not None:
                    log("Excel IZC no encontrado")
                last_sigs = sigs
                continue
            if sigs != last_sigs:
                if sigs[0]:
                    wait_until_stable(RUTA_EXCEL)
                if RUTA_EXCEL_ZEBRA.exists():
                    wait_until_stable(RUTA_EXCEL_ZEBRA)
                last_sigs = excel_signatures()
                if last_sigs[0] is None:
                    continue
                try:
                    sync_now("Cambio detectado en lista de precios → actualizando")
                except Exception as exc:
                    log(f"Error al actualizar (¿Excel abierto/bloqueado?): {exc}")
        except KeyboardInterrupt:
            log("Vigilancia detenida")
            return


if __name__ == "__main__":
    main()
