"""Extrae precios desde lista-precios-izc.xlsb (hoja Lp Asesores).

También fusiona lista-precios-zebra.xlsb (hoja LP) para productos ZEBRA:
  - LP Web, Interna y Volumen (USD)
  - Productos nuevos en productos / referencias / catálogo
  - Sin inventario en IZC → stock 0 (agotado en cotizador)

Clientes / admin / catálogo:
  - COP y USD CLIENTES = promedio entre LP WEB e INTERNA
    ((WEB - INTERNA) / 2) + INTERNA
  - Si falta WEB o INTERNA en una fila, usa BJ/BK del Excel
  → assets/files/precios.json

Cotizador del asesor (11 LP del Cotizador IZC - Valtech):
  - Web, Interna, Volumen, Drm, Franquicia, Master, UPS, PV,
    etiquetado, contadoras, LP promos
  → assets/files/precios_lp_asesor.json

Uso:
  python src/extraer_precios.py
"""
from __future__ import annotations

import json
import math
import unicodedata
import zipfile
from pathlib import Path
from typing import Any

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
RUTA_EXCEL = BASE_DIR / "assets" / "files" / "lista-precios-izc.xlsb"
RUTA_EXCEL_ZEBRA = BASE_DIR / "assets" / "files" / "lista-precios-zebra.xlsb"
RUTA_JSON = BASE_DIR / "assets" / "files" / "precios.json"
RUTA_DATA_JS = BASE_DIR / "assets" / "files" / "precios.data.js"
RUTA_LP_JSON = BASE_DIR / "assets" / "files" / "precios_lp_asesor.json"
RUTA_LP_DATA_JS = BASE_DIR / "assets" / "files" / "precios_lp_asesor.data.js"
JSON_KEY = "assets/files/precios.json"
JSON_LP_KEY = "assets/files/precios_lp_asesor.json"

SHEET_NAME = "Lp Asesores"
ZEBRA_SHEET_NAME = "LP"
ZEBRA_START_ROW = 1
ZEBRA_STONE_COL = 0
ZEBRA_MATERIAL_COL = 1
ZEBRA_NOMBRE_COL = 3
ZEBRA_LP_COLS: dict[str, int] = {
    "web": 12,
    "interna": 14,
    "volumen": 16,
}
ZEBRA_LP_IDS = ("web", "interna", "volumen")
STONE_COL = 0
NOMBRE_COL = 2  # Columna C
REFERENCIA_COL = 3  # Columna D
PESOS_COL = 61  # BJ CLIENTES / COP
USD_COL = 62  # BK CLIENTES / USD
START_ROW = 3

RUTA_REF_JSON = BASE_DIR / "assets" / "files" / "referencias.json"
RUTA_REF_DATA_JS = BASE_DIR / "assets" / "files" / "referencias.data.js"
JSON_REF_KEY = "assets/files/referencias.json"

RUTA_PROD_JSON = BASE_DIR / "assets" / "files" / "productos.json"
RUTA_PROD_DATA_JS = BASE_DIR / "assets" / "files" / "productos.data.js"
JSON_PROD_KEY = "assets/files/productos.json"

RUTA_INV_JSON = BASE_DIR / "assets" / "files" / "inventario.json"
RUTA_INV_DATA_JS = BASE_DIR / "assets" / "files" / "inventario.data.js"
JSON_INV_KEY = "assets/files/inventario.json"

RUTA_CATALOGO_JSON = BASE_DIR / "assets" / "files" / "catalogo.json"
RUTA_CATALOGO_DATA_JS = BASE_DIR / "assets" / "files" / "catalogo.data.js"
JSON_CATALOGO_KEY = "assets/files/catalogo.json"

INV_BODEGAS = ("AR", "CT", "UN", "RC")
# Códigos Siigo → bodega (fila 2 Lp Asesores). IZC y VALTECH usan numeración distinta.
INV_BODEGA_WH_IZC = {"AR": 15, "CT": 10, "UN": 16, "RC": 18}
INV_BODEGA_WH_VALTECH = {"AR": 10, "CT": 15, "UN": 16, "RC": 20}
# Bloques en Lp Asesores (fila 0 / fila 2 = código bodega).
INV_IZC_DISP_START = 4
INV_IZC_DISP_END = 25
INV_VALTECH_START = 48
INV_VALTECH_END = 53
INV_HEADER_ROW = 2
INV_DATA_START = 3

# Bloques en Lp Asesores (fila 0 = nombre LP, fila 2 = PESOS/USD).
# Fallback si no se detectan cabeceras. Orden: (id, label, pesos_col, usd_col)
# WEB 63–64 | INTERNA 65–66 | VOLUMEN 67–68 | DRM 69–70 | FRANQUICIAS 71–72 | MASTER 73–74
# Etiquetado 77–78 | PV 79–80 | UPS 81–82 | Contadoras 95–96 | Promos 99–100
LP_LISTAS: list[tuple[str, str, int, int]] = [
    ("web", "Web", 63, 64),
    ("interna", "Interna", 65, 66),
    ("volumen", "Volumen", 67, 68),
    ("drm", "Drm", 69, 70),
    ("franquicia", "Franquicia", 71, 72),
    ("master", "Master", 73, 74),
    ("ups", "UPS", 81, 82),
    ("pv", "PV", 79, 80),
    ("etiquetado", "Etiquetado", 77, 78),
    ("contadoras", "Contadoras", 95, 96),
    ("lp_promos", "LP Promos", 99, 100),
]

# Cabeceras fila 0 → id de LP (evitar cruces Interna/Volumen).
LP_HEADER_MATCH: list[tuple[str, str, tuple[str, ...]]] = [
    ("web", "Web", ("web",)),
    ("interna", "Interna", ("interna",)),
    ("volumen", "Volumen", ("volumen",)),
    ("drm", "Drm", ("drm",)),
    ("franquicia", "Franquicia", ("franquicia", "franquicias")),
    ("master", "Master", ("master",)),
    ("etiquetado", "Etiquetado", ("etiquetado", "marcacion", "marcacion y etiquetado")),
    ("pv", "PV", ("pv",)),
    ("ups", "UPS", ("ups", "clientes ups")),
    ("contadoras", "Contadoras", ("contadoras", "esp contadoras")),
    ("lp_promos", "LP Promos", ("lista promos", "promos", "lp promos")),
]

PriceEntry = float | dict[str, Any]


def normalizar_texto(valor: str) -> str:
    texto = unicodedata.normalize("NFKD", valor)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    return texto.lower()


def es_etiqueta(nombre: str) -> bool:
    """Solo rollos/etiquetas (no ribbons ni equipos). Precio siempre en COP."""
    n = normalizar_texto(nombre)
    if not n or n == "nan":
        return False
    if any(
        x in n
        for x in (
            "impresora",
            "printer",
            "aio",
            "verificador",
            "lector",
            "scanner",
            "escaner",
            "aplicador",
            "dispensador",
            "software",
            "reloj",
            "demo ",
        )
    ):
        return False
    return "etiqueta" in n


def es_etiqueta_o_cinta_ribbon(nombre: str) -> bool:
    """Rollos/etiquetas, ribbons, papel térmico y consumibles en COP."""
    n = normalizar_texto(nombre)
    if not n or n == "nan":
        return False

    # Impresoras / equipos (aunque el kit incluya etiquetas o ribbon).
    if any(
        x in n
        for x in (
            "impresora",
            "printer",
            "aio",
            "verificador",
            "lector",
            "scanner",
            "escaner",
        )
    ):
        return False

    if "ribbon" in n:
        exclusiones = (
            "rodamiento",
            "tensor",
            "pinon",
            "eje",
            "soporte",
            "guia",
            "sensor",
        )
        return not any(x in n for x in exclusiones)

    if "cinta" in n and any(
        x in n for x in ("cera", "resina", "wax", "ribbon", "transferencia")
    ):
        return True

    if es_etiqueta(nombre):
        return True

    # Rollos de nylon, térmico, químico, etiquetas, etc.
    if "rollo" in n:
        exclusiones = (
            "impresora",
            "printer",
            "soporte",
            "motor",
            "eje",
            "sensor",
            "rodillo",
        )
        return not any(x in n for x in exclusiones)

    if "papel" in n:
        exclusiones = ("impresora", "soporte", "bandeja", "rodillo", "motor")
        return not any(x in n for x in exclusiones)

    return False


def limpiar_sku(valor) -> str | None:
    if pd.isna(valor):
        return None
    sku = str(valor).strip()
    if sku.endswith(".0"):
        sku = sku[:-2]
    return sku or None


def limpiar_precio(valor) -> float | None:
    if pd.isna(valor):
        return None
    if isinstance(valor, (int, float)):
        return float(valor) if valor > 0 else None
    try:
        texto = str(valor).replace("$", "").replace(" ", "").strip()
        if "," in texto and "." in texto:
            if texto.rfind(",") > texto.rfind("."):
                texto = texto.replace(".", "").replace(",", ".")
            else:
                texto = texto.replace(",", "")
        elif "," in texto:
            texto = texto.replace(",", ".")
        numero = float(texto)
    except ValueError:
        return None
    return numero if numero > 0 else None


def entry_cop(amount: float) -> dict[str, Any]:
    return {"amount": amount, "currency": "COP"}


def entry_usd(amount: float, pesos: float | None = None) -> PriceEntry:
    """USD de lista; si hay columna PESOS, se guarda para COP exacto (no USD×TRM)."""
    if pesos is not None and pesos > 0:
        return {"amount": float(amount), "currency": "USD", "pesos": float(pesos)}
    return float(amount)


# En Excel a veces dejan 0 / 0.10 en USD como bandera; el precio real está en PESOS.
USD_FLAG_MAX = 0.10
RUTA_TRM = BASE_DIR / "data" / "trm.json"


def leer_trm(default: float = 3101.0) -> float:
    try:
        raw = json.loads(RUTA_TRM.read_text(encoding="utf-8"))
        val = float(raw.get("value") if isinstance(raw, dict) else raw)
        if val > 0:
            return val
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass
    return float(default)


def usd_desde_cop(pesos: float, trm: float | None = None) -> float:
    rate = float(trm if trm is not None else leer_trm())
    if rate <= 0:
        return 0.0
    # Misma lógica que IZCMoney.roundUsd (ROUNDDOWN 2 decimales).
    return math.floor((float(pesos) / rate) * 100) / 100


def sanitizar_precios_usd_desde_cop(
    mapa: dict[str, PriceEntry], *, trm: float | None = None
) -> int:
    """Si USD es 0/0.10 (o falta) y hay PESOS, publica USD = COP/TRM.

    No toca entradas currency=COP (etiquetas / ribbons / papel): esas se muestran en COP.
    """
    rate = float(trm if trm is not None else leer_trm())
    if rate <= 0 or not mapa:
        return 0
    fixed = 0
    for sku, entry in list(mapa.items()):
        if isinstance(entry, (int, float)):
            continue
        if not isinstance(entry, dict):
            continue
        currency = str(entry.get("currency") or "USD").upper()
        # Etiquetas / ribbons / consumibles en COP: no convertir a USD.
        if currency == "COP":
            continue
        try:
            amount = float(entry.get("amount", entry.get("v")))
        except (TypeError, ValueError):
            amount = 0.0
        try:
            pesos = float(entry["pesos"]) if entry.get("pesos") is not None else None
        except (TypeError, ValueError):
            pesos = None

        if currency == "USD" and pesos is not None and pesos > 0:
            if amount <= 0 or amount <= USD_FLAG_MAX:
                usd = usd_desde_cop(pesos, rate)
                if usd > 0:
                    mapa[sku] = entry_usd(usd, pesos)
                    fixed += 1
    return fixed


def guardar_en_mapa(mapa: dict[str, PriceEntry], sku: str, entry: PriceEntry) -> None:
    mapa[sku] = entry
    sku_sin_ceros = sku.lstrip("0")
    if sku_sin_ceros and sku_sin_ceros != sku:
        mapa[sku_sin_ceros] = entry


def guardar_clave(
    mapa: dict[Any, Any], clave: str, valor: Any, *, alias_ceros: bool = True
) -> None:
    mapa[clave] = valor
    if alias_ceros:
        sin = clave.lstrip("0")
        if sin and sin != clave:
            mapa[sin] = valor


def es_stone_izc(valor) -> bool:
    sku = limpiar_sku(valor)
    if not sku:
        return False
    if "no identificado" in sku.lower():
        return False
    try:
        float(sku.replace(",", "."))
    except ValueError:
        return False
    return True


def clave_producto_zebra(stone_val, material: str) -> str | None:
    if es_stone_izc(stone_val):
        return limpiar_sku(stone_val)
    mat = str(material or "").strip()
    if not mat or mat.lower() == "nan":
        return None
    return mat


def excel_engine(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as zf:
            names = set(zf.namelist())
        if "xl/workbook.bin" in names:
            return "pyxlsb"
        if "xl/workbook.xml" in names:
            return "openpyxl"
    except (OSError, zipfile.BadZipFile):
        pass
    with path.open("rb") as fh:
        sig = fh.read(4)
    return "openpyxl" if sig == b"PK\x03\x04" else "pyxlsb"


def leer_hoja(
    ruta_excel: Path | None = None,
    usecols: list[int] | None = None,
    *,
    sheet_name: str | None = None,
    nrows: int | None = None,
) -> pd.DataFrame:
    ruta = ruta_excel or RUTA_EXCEL
    sheet = sheet_name or SHEET_NAME
    if not ruta.exists():
        raise FileNotFoundError(f"No se encontro el Excel en {ruta}")
    engine = excel_engine(ruta)
    if engine == "openpyxl":
        try:
            import openpyxl  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "Instala openpyxl: py -3 -m pip install openpyxl"
            ) from exc
    elif engine == "pyxlsb":
        try:
            import pyxlsb  # noqa: F401
        except ImportError as exc:
            raise ImportError(
                "Instala pyxlsb: py -3 -m pip install pyxlsb"
            ) from exc
    kwargs: dict[str, Any] = {
        "io": ruta,
        "sheet_name": sheet,
        "engine": engine,
        "header": None,
    }
    if usecols is not None:
        kwargs["usecols"] = usecols
    if nrows is not None:
        kwargs["nrows"] = nrows
    return pd.read_excel(**kwargs)


def precio_usd_es_cop_copiado(precio_usd: float | None, precio_pesos: float | None) -> bool:
    """True si la columna USD trae el mismo valor COP (bug frecuente en Ruijie, etc.).

    En productos bien cargados: PESOS ≈ USD × TRM (miles/millones) y USD es pequeño.
    Cuando fallan la fórmula: USD ≈ PESOS (ambos ~30.000–300.000).
    """
    if precio_usd is None or precio_usd <= 0:
        return False
    if precio_pesos is not None and precio_pesos > 0:
        mayor = max(precio_usd, precio_pesos)
        menor = min(precio_usd, precio_pesos)
        # Casi idénticos y con magnitud de pesos (no de dólares).
        if mayor >= 1000 and (mayor - menor) / mayor <= 0.05:
            return True
        # USD absurdo (> 5000) pero PESOS es el típico COP (USD×TRM ≈ PESOS).
        if precio_usd >= 5000 and precio_pesos >= precio_usd * 50:
            return False  # USD real caro + PESOS convertido
    # Sin PESOS comparable: valores > 5000 casi nunca son USD unitarios en esta lista.
    if precio_pesos is None and precio_usd >= 5000:
        return True
    if precio_pesos is not None and precio_pesos > 0 and precio_usd >= 5000:
        # Si PESOS no es ~TRM×USD, el "USD" es COP.
        if precio_pesos < precio_usd * 20:
            return True
    return False


def extraer_mapa_desde_df(
    df: pd.DataFrame,
    pesos_col: int,
    usd_col: int,
    *,
    solo_usd: bool = False,
) -> dict[str, PriceEntry]:
    """USD por defecto; adjunta PESOS de lista cuando existe.

    Clientes (solo_usd=False): etiquetas/ribbons usan columna PESOS como COP.
    Cotizador asesor (solo_usd=True): columna USD + PESOS de la LP; si el Excel
    copió COP en la columna USD (p.ej. Ruijie), se guarda como COP.
    Etiquetas: siempre COP (columna PESOS), también en LP asesor.
    """
    mapa_precios: dict[str, PriceEntry] = {}
    cop_count = 0
    cop_from_usd_col = 0
    work = df.iloc[START_ROW:]
    work = work.loc[work[STONE_COL].notna()]

    for _, fila in work.iterrows():
        sku = limpiar_sku(fila[STONE_COL])
        if not sku:
            continue

        nombre = str(fila[NOMBRE_COL]) if pd.notna(fila[NOMBRE_COL]) else ""
        precio_pesos = limpiar_precio(fila[pesos_col]) if pesos_col in fila.index else None
        precio_usd = limpiar_precio(fila[usd_col]) if usd_col in fila.index else None

        # Etiquetas: precio en COP (PESOS), nunca USD×TRM — en todas las LP.
        if es_etiqueta(nombre):
            if precio_pesos is None:
                continue
            guardar_en_mapa(mapa_precios, sku, entry_cop(precio_pesos))
            cop_count += 1
            continue

        if (not solo_usd) and es_etiqueta_o_cinta_ribbon(nombre):
            if precio_pesos is None:
                continue
            guardar_en_mapa(mapa_precios, sku, entry_cop(precio_pesos))
            cop_count += 1
            continue

        if precio_usd_es_cop_copiado(precio_usd, precio_pesos):
            cop_val = precio_pesos if (precio_pesos is not None and precio_pesos > 0) else precio_usd
            if cop_val is None:
                continue
            guardar_en_mapa(mapa_precios, sku, entry_cop(cop_val))
            cop_from_usd_col += 1
            continue

        if precio_usd is None:
            if precio_pesos is not None and precio_pesos > 0:
                # Sin USD: consumibles/etiquetas ya salieron arriba; resto → USD desde COP.
                usd = usd_desde_cop(precio_pesos)
                if usd > 0:
                    guardar_en_mapa(mapa_precios, sku, entry_usd(usd, precio_pesos))
                else:
                    guardar_en_mapa(mapa_precios, sku, entry_cop(precio_pesos))
                cop_count += 1
            continue

        # Bandera 0.10 en USD: si es etiqueta/ribbon ya se manejó arriba.
        # Para el resto, USD desde PESOS.
        if precio_usd <= USD_FLAG_MAX and precio_pesos is not None and precio_pesos > 0:
            usd = usd_desde_cop(precio_pesos)
            if usd > 0:
                guardar_en_mapa(mapa_precios, sku, entry_usd(usd, precio_pesos))
                continue

        # USD + PESOS de lista: el cotizador usa PESOS para COP (no USD×TRM).
        guardar_en_mapa(mapa_precios, sku, entry_usd(precio_usd, precio_pesos))

    if cop_count:
        print(f"  COP (etiquetas/ribbons/solo PESOS): {cop_count} SKUs")
    if cop_from_usd_col:
        print(f"  COP (columna USD con valor PESOS): {cop_from_usd_col} SKUs")
    return mapa_precios


def promedio_web_interna(web: float | None, interna: float | None) -> float | None:
    """Misma fórmula del Excel clientes: ((WEB - INTERNA) / 2) + INTERNA."""
    if web is not None and web > 0 and interna is not None and interna > 0:
        return ((float(web) - float(interna)) / 2.0) + float(interna)
    if web is not None and web > 0:
        return float(web)
    if interna is not None and interna > 0:
        return float(interna)
    return None


def _lp_cols_by_id(lp_listas: list[tuple[str, str, int, int]]) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    for lp_id, _label, pesos, usd in lp_listas:
        out[lp_id] = (int(pesos), int(usd))
    return out


def aplicar_clientes_promedio_web_interna(
    df: pd.DataFrame,
    *,
    web_pesos_col: int,
    web_usd_col: int,
    interna_pesos_col: int,
    interna_usd_col: int,
) -> int:
    """Rellena BJ/BK (CLIENTES) con el promedio WEB/INTERNA cuando hay datos.

    Devuelve cuántas filas de datos se recalcularon.
    """
    if df is None or df.empty or len(df.index) < START_ROW + 1:
        return 0

    needed = (
        PESOS_COL,
        USD_COL,
        web_pesos_col,
        web_usd_col,
        interna_pesos_col,
        interna_usd_col,
    )
    for col in needed:
        if col not in df.columns:
            print(
                f"  Aviso: falta columna {col} para promedio CLIENTES; se usan BJ/BK del Excel.",
                flush=True,
            )
            return 0

    updated = 0
    work_idx = df.index[START_ROW:]
    for idx in work_idx:
        fila = df.loc[idx]
        if pd.isna(fila.get(STONE_COL)):
            continue
        web_pesos = limpiar_precio(fila.get(web_pesos_col))
        web_usd = limpiar_precio(fila.get(web_usd_col))
        int_pesos = limpiar_precio(fila.get(interna_pesos_col))
        int_usd = limpiar_precio(fila.get(interna_usd_col))
        mid_pesos = promedio_web_interna(web_pesos, int_pesos)
        mid_usd = promedio_web_interna(web_usd, int_usd)
        changed = False
        if mid_pesos is not None:
            df.at[idx, PESOS_COL] = mid_pesos
            changed = True
        if mid_usd is not None:
            df.at[idx, USD_COL] = mid_usd
            changed = True
        if changed:
            updated += 1
    if updated:
        print(
            f"  CLIENTES = promedio WEB/INTERNA en {updated} filas "
            f"(WEB PESOS/USD={web_pesos_col + 1}/{web_usd_col + 1}, "
            f"INTERNA={interna_pesos_col + 1}/{interna_usd_col + 1})",
            flush=True,
        )
    return updated


def leer_lista_precios(ruta_excel: Path) -> tuple[pd.DataFrame, dict[str, tuple[int, int]]]:
    """Clientes: BJ/BK + WEB + INTERNA (para calcular el promedio)."""
    df_headers = leer_hoja(ruta_excel, list(range(0, 101)), nrows=6)
    lp_cols = _lp_cols_by_id(detectar_lp_listas(df_headers))
    web_p, web_u = lp_cols.get("web", (63, 64))
    int_p, int_u = lp_cols.get("interna", (65, 66))
    cols = [STONE_COL, NOMBRE_COL, PESOS_COL, USD_COL, web_p, web_u, int_p, int_u]
    seen: set[int] = set()
    usecols: list[int] = []
    for c in cols:
        if c not in seen and c >= 0:
            seen.add(c)
            usecols.append(c)
    return leer_hoja(ruta_excel, usecols), lp_cols


def extraer_desde_df(
    df: pd.DataFrame,
    *,
    web_pesos_col: int = 63,
    web_usd_col: int = 64,
    interna_pesos_col: int = 65,
    interna_usd_col: int = 66,
) -> dict[str, PriceEntry]:
    aplicar_clientes_promedio_web_interna(
        df,
        web_pesos_col=web_pesos_col,
        web_usd_col=web_usd_col,
        interna_pesos_col=interna_pesos_col,
        interna_usd_col=interna_usd_col,
    )
    return extraer_mapa_desde_df(df, PESOS_COL, USD_COL, solo_usd=False)


def extraer_precios_stone_usd() -> dict[str, PriceEntry]:
    df, lp_cols = leer_lista_precios(RUTA_EXCEL)
    web_p, web_u = lp_cols.get("web", (63, 64))
    int_p, int_u = lp_cols.get("interna", (65, 66))
    return extraer_desde_df(
        df,
        web_pesos_col=web_p,
        web_usd_col=web_u,
        interna_pesos_col=int_p,
        interna_usd_col=int_u,
    )


def detectar_lp_listas(df: pd.DataFrame) -> list[tuple[str, str, int, int]]:
    """Detecta columnas PESOS/USD de cada LP por cabeceras (fila 0 y fila 2).

    Evita cruces tipo Interna↔Volumen si el Excel mueve columnas.
    """
    if df is None or df.empty or len(df.index) < 3:
        return list(LP_LISTAS)

    found: dict[str, tuple[str, str, int, int]] = {}
    ncols = int(df.shape[1])

    for c in range(ncols):
        raw = df.iloc[0, c] if c < ncols else None
        if pd.isna(raw):
            continue
        header = normalizar_texto(str(raw)).strip()
        if not header:
            continue
        matched_id = ""
        matched_label = ""
        for lp_id, label, aliases in LP_HEADER_MATCH:
            ok = False
            for alias in aliases:
                if header == alias or header.startswith(alias + " ") or (" " + alias + " ") in (" " + header + " "):
                    ok = True
                    break
                # Cabeceras compuestas: "marcacion y etiquetado", "clientes ups", "lista promos"
                if alias in header and len(alias) >= 3:
                    ok = True
                    break
            if not ok:
                continue
            # Desambiguar cabeceras parecidas.
            if lp_id == "master" and ("w master" in header or "partner" in header):
                continue
            if lp_id == "pv" and ("promos" in header or "ups" in header):
                continue
            if lp_id == "web" and header not in ("web",) and not header.startswith("web"):
                continue
            matched_id = lp_id
            matched_label = label
            break
        if not matched_id:
            continue

        pesos_col = c
        usd_col = c + 1 if (c + 1) < ncols else -1
        # Confirmar PESOS/USD en fila 2 si existe.
        r2 = normalizar_texto(str(df.iloc[2, c])) if pd.notna(df.iloc[2, c]) else ""
        if r2 and "usd" in r2 and "peso" not in r2:
            # Cabecera cayó sobre la columna USD: PESOS es la anterior.
            pesos_col = c - 1 if c > 0 else c
            usd_col = c
        elif usd_col >= 0:
            r2u = (
                normalizar_texto(str(df.iloc[2, usd_col]))
                if pd.notna(df.iloc[2, usd_col])
                else ""
            )
            if r2u and "peso" in r2u and "usd" not in r2u:
                # Par invertido raro
                pesos_col, usd_col = usd_col, pesos_col

        if pesos_col < 0 or usd_col < 0 or usd_col >= ncols:
            continue
        found[matched_id] = (matched_id, matched_label, pesos_col, usd_col)

    if not found:
        print("  Aviso: no se detectaron cabeceras LP; uso columnas fijas.", flush=True)
        return list(LP_LISTAS)

    out: list[tuple[str, str, int, int]] = []
    for lp_id, label, _p, _u in LP_LISTAS:
        if lp_id in found:
            out.append(found[lp_id])
        else:
            # Mantener fallback fijo si una LP no apareció en cabeceras.
            out.append((lp_id, label, _p, _u))
            print(f"  Aviso: LP {label} no detectada en cabeceras; uso cols {_p}/{_u}.", flush=True)

    for lp_id, label, pesos, usd in out:
        print(f"  Detectada LP {label}: PESOS={pesos + 1} USD={usd + 1}", flush=True)
    return out


def extraer_precios_lp_asesor() -> dict[str, Any]:
    """11 listas del filtro LP del Cotizador IZC - Valtech.

    Usa la columna USD de cada LP (mismo VLOOKUP que el Excel del asesor).
    """
    print(f"Leyendo LP asesores ({SHEET_NAME})...", flush=True)
    # Cabeceras: la hoja tiene 101 columnas (0..100).
    df_headers = leer_hoja(RUTA_EXCEL, list(range(0, 101)), nrows=6)
    lp_listas = detectar_lp_listas(df_headers)

    cols = [STONE_COL, NOMBRE_COL]
    for _id, _label, pesos, usd in lp_listas:
        cols.extend([pesos, usd])
    seen: set[int] = set()
    usecols: list[int] = []
    max_col = max(int(df_headers.shape[1]) - 1, 0)
    for c in cols:
        if c not in seen and 0 <= c <= max_col:
            seen.add(c)
            usecols.append(c)

    df = leer_hoja(RUTA_EXCEL, usecols)
    lists_meta = []
    by_list: dict[str, dict[str, PriceEntry]] = {}

    for lp_id, label, pesos_col, usd_col in lp_listas:
        print(f"  LP {label} (USD col {usd_col + 1})...", flush=True)
        by_list[lp_id] = extraer_mapa_desde_df(
            df, pesos_col, usd_col, solo_usd=True
        )
        lists_meta.append({"id": lp_id, "label": label})

    return {"lists": lists_meta, "by_list": by_list}


def _precio_entry_amount(entry: PriceEntry | None) -> float | None:
    if entry is None:
        return None
    if isinstance(entry, (int, float)):
        return float(entry) if float(entry) > 0 else None
    if isinstance(entry, dict):
        raw = entry.get("amount", entry.get("v"))
        try:
            n = float(raw)
            return n if n > 0 else None
        except (TypeError, ValueError):
            return None
    return None


def sanitizar_lp_promos_banderas(lp_payload: dict[str, Any]) -> int:
    """LISTA PROMOS en Excel suele traer banderas 0/0.1/1, no el precio de venta.

    El cotizador Excel apunta LP Promos → col 99 y deja Interna (65) como referencia.
    Si el valor parece bandera (<= 2) y hay precio Interna/Volumen real, usamos ese.
    """
    by_list = lp_payload.setdefault("by_list", {})
    promo = by_list.get("lp_promos") or {}
    if not isinstance(promo, dict) or not promo:
        return 0
    interna = by_list.get("interna") or {}
    volumen = by_list.get("volumen") or {}
    web = by_list.get("web") or {}
    cleaned: dict[str, PriceEntry] = {}
    replaced = 0
    for sku, entry in promo.items():
        amt = _precio_entry_amount(entry)
        if amt is not None and amt <= 2.0:
            fallback = interna.get(sku) or volumen.get(sku) or web.get(sku)
            fb_amt = _precio_entry_amount(fallback)
            if fb_amt is not None and fb_amt > 2.0:
                cleaned[sku] = fallback
                replaced += 1
                continue
            # Sin precio real: no publicar $1 falso.
            replaced += 1
            continue
        cleaned[sku] = entry
    by_list["lp_promos"] = cleaned
    if replaced:
        print(f"  LP Promos: {replaced} banderas corregidas/omitidas (fallback Interna).", flush=True)
    return replaced


def extraer_zebra_lp() -> dict[str, dict[str, Any]]:
    """Lee lista-precios-zebra.xlsb (hoja LP): todos los productos ZEBRA.

    Clave = Stone (si existe) o Material (sin SKU IZC).
    """
    if not RUTA_EXCEL_ZEBRA.exists():
        return {}

    usecols = [ZEBRA_STONE_COL, ZEBRA_MATERIAL_COL, ZEBRA_NOMBRE_COL]
    usecols.extend(ZEBRA_LP_COLS.values())
    seen: set[int] = set()
    cols: list[int] = []
    for c in usecols:
        if c not in seen:
            seen.add(c)
            cols.append(c)

    print(f"Leyendo ZEBRA ({ZEBRA_SHEET_NAME})...", flush=True)
    df = leer_hoja(RUTA_EXCEL_ZEBRA, cols, sheet_name=ZEBRA_SHEET_NAME)
    rows: dict[str, dict[str, Any]] = {}
    work = df.iloc[ZEBRA_START_ROW:]
    work = work.loc[work[ZEBRA_MATERIAL_COL].notna()]

    con_stone = 0
    solo_material = 0

    for _, fila in work.iterrows():
        material = (
            str(fila[ZEBRA_MATERIAL_COL]).strip()
            if pd.notna(fila[ZEBRA_MATERIAL_COL])
            else ""
        )
        if not material or material.lower() == "nan":
            continue

        prices: dict[str, float] = {}
        for lp_id, col in ZEBRA_LP_COLS.items():
            precio = limpiar_precio(fila[col])
            if precio is not None:
                prices[lp_id] = precio
        if not prices.get("web"):
            continue

        clave = clave_producto_zebra(fila[ZEBRA_STONE_COL], material)
        if not clave:
            continue

        nombre = (
            str(fila[ZEBRA_NOMBRE_COL]).strip()
            if pd.notna(fila[ZEBRA_NOMBRE_COL])
            else ""
        )
        if nombre.lower() == "nan":
            nombre = ""
        if not nombre:
            nombre = material

        has_stone = es_stone_izc(fila[ZEBRA_STONE_COL])
        if has_stone:
            con_stone += 1
        else:
            solo_material += 1

        rows[clave] = {
            "material": material,
            "nombre": nombre,
            "prices": prices,
            "has_stone": has_stone,
        }

    print(
        f"  ZEBRA LP: {len(rows)} productos "
        f"({con_stone} con Stone, {solo_material} solo Material)",
        flush=True,
    )
    return rows


def extraer_skus_izc() -> set[str]:
    df = leer_hoja(RUTA_EXCEL, [STONE_COL])
    skus: set[str] = set()
    work = df.iloc[START_ROW:]
    work = work.loc[work[STONE_COL].notna()]
    for _, fila in work.iterrows():
        sku = limpiar_sku(fila[STONE_COL])
        if not sku:
            continue
        skus.add(sku)
        sku_sin = sku.lstrip("0")
        if sku_sin:
            skus.add(sku_sin)
    return skus


def aplicar_zebra_a_lp(lp_payload: dict[str, Any], zebra: dict[str, dict[str, Any]]) -> int:
    """Aplica precios Zebra solo donde IZC no trae ya el SKU.

    La xlsb Zebra suele cachear fórmulas incorrectas (p.ej. Volumen 2109 en vez
    de ~297). No debe pisar Web/Interna/Volumen ya extraídos de Lp Asesores IZC
    para productos con Stone.
    """
    by_list = lp_payload.setdefault("by_list", {})
    touched = 0
    skipped = 0
    for lp_id in ZEBRA_LP_IDS:
        target = by_list.setdefault(lp_id, {})
        for clave, row in zebra.items():
            price = row.get("prices", {}).get(lp_id)
            if price is None:
                continue
            clave_s = str(clave or "").strip()
            clave_nz = clave_s.lstrip("0") or clave_s
            already = clave_s in target or (clave_nz and clave_nz in target)
            # Con Stone IZC: preservar precio de Lp Asesores.
            if already and row.get("has_stone"):
                skipped += 1
                continue
            # Si IZC ya tiene objeto USD+PESOS, no degradar a número suelto.
            existing = target.get(clave_s) or (target.get(clave_nz) if clave_nz else None)
            if isinstance(existing, dict) and existing.get("pesos") and existing.get("amount"):
                skipped += 1
                continue
            guardar_clave(target, clave, price, alias_ceros=bool(row.get("has_stone")))
            touched += 1
    if skipped:
        print(f"  ZEBRA LP: {skipped} precios IZC preservados (no sobrescritos).", flush=True)
    return touched


def aplicar_zebra_a_precios(
    precios: dict[str, PriceEntry], zebra: dict[str, dict[str, Any]]
) -> int:
    """Igual que LP: no pisar precios clientes IZC de SKUs con Stone."""
    count = 0
    skipped = 0
    for clave, row in zebra.items():
        web = row.get("prices", {}).get("web")
        if web is None:
            continue
        clave_s = str(clave or "").strip()
        clave_nz = clave_s.lstrip("0") or clave_s
        already = clave_s in precios or (clave_nz and clave_nz in precios)
        if already and row.get("has_stone"):
            skipped += 1
            continue
        existing = precios.get(clave_s) or (precios.get(clave_nz) if clave_nz else None)
        if isinstance(existing, dict) and existing.get("pesos") and existing.get("amount"):
            skipped += 1
            continue
        guardar_clave(precios, clave, web, alias_ceros=bool(row.get("has_stone")))
        count += 1
    if skipped:
        print(f"  ZEBRA clientes: {skipped} precios IZC preservados.", flush=True)
    return count


def aplicar_zebra_a_productos(
    productos: dict[str, str], zebra: dict[str, dict[str, Any]]
) -> int:
    """Sin Stone: nombre columna Español (búsqueda por texto).

    Con Stone: conservar nombre IZC; solo rellenar si el SKU no existe aún.
    """
    nuevos = 0
    for clave, row in zebra.items():
        nombre = str(row.get("nombre") or "").strip()
        if not nombre:
            continue
        if row.get("has_stone"):
            if clave in productos and str(productos[clave] or "").strip():
                continue
        if clave not in productos:
            nuevos += 1
        productos[clave] = nombre
    return nuevos


def aplicar_zebra_a_referencias(
    refs: dict[str, str], zebra: dict[str, dict[str, Any]]
) -> int:
    """Sin Stone: referencia = Material. Con Stone: conservar referencia IZC."""
    nuevos = 0
    for clave, row in zebra.items():
        if row.get("has_stone"):
            continue
        material = str(row.get("material") or "").strip()
        if not material:
            continue
        if clave not in refs:
            nuevos += 1
        refs[clave] = material
    return nuevos


def aplicar_zebra_a_inventario(
    inv: dict[str, Any],
    zebra: dict[str, dict[str, Any]],
    izc_skus: set[str],
) -> int:
    by_sku = inv.setdefault("by_sku", {})
    vacio = {
        "izc": {b: 0 for b in INV_BODEGAS},
        "valtech": {b: 0 for b in INV_BODEGAS},
        "total": 0,
    }
    nuevos = 0
    for clave, row in zebra.items():
        if clave in by_sku:
            continue
        alias = clave.lstrip("0")
        if row.get("has_stone"):
            if alias and alias in by_sku:
                continue
            if clave in izc_skus or (alias and alias in izc_skus):
                continue
            by_sku[clave] = dict(vacio)
            if alias and alias != clave:
                by_sku[alias] = dict(vacio)
        else:
            by_sku[clave] = dict(vacio)
        nuevos += 1
    return nuevos


def aplicar_zebra_a_catalogo(
    zebra: dict[str, dict[str, Any]], izc_skus: set[str]
) -> tuple[dict[str, Any] | None, int]:
    if not RUTA_CATALOGO_JSON.exists():
        return None, 0
    try:
        catalogo = json.loads(RUTA_CATALOGO_JSON.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None, 0
    if not isinstance(catalogo, dict):
        return None, 0

    products = catalogo.setdefault("products", [])
    if not isinstance(products, list):
        return None, 0

    existing: set[str] = set()
    for p in products:
        if isinstance(p, dict):
            sku = str(p.get("sku") or "").strip()
            if sku:
                existing.add(sku)
                existing.add(sku.lstrip("0") or sku)

    nuevos = 0
    for clave, row in zebra.items():
        if not row.get("has_stone"):
            continue
        if clave in existing or (clave.lstrip("0") in existing):
            continue
        if clave in izc_skus or (clave.lstrip("0") in izc_skus):
            continue
        nombre = str(row.get("nombre") or row.get("material") or f"ZEBRA {clave}").strip()
        products.append(
            {
                "sku": clave,
                "name": nombre,
                "brand": "zebra",
                "brandName": "Zebra",
                "brandLogo": "Zebra.png",
                "brandPage": "zebra.html",
                "img": "",
                "category": "otros",
                "type": "otros",
                "subtype": "otros",
                "subtypes": ["otros"],
                "productUrl": "",
            }
        )
        existing.add(clave)
        nuevos += 1
    return catalogo, nuevos


def guardar_catalogo(catalogo: dict[str, Any]) -> None:
    RUTA_CATALOGO_JSON.parent.mkdir(parents=True, exist_ok=True)
    stamp = excel_stamp()
    out = dict(catalogo)
    out["stamp"] = stamp
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    RUTA_CATALOGO_JSON.write_text(text, encoding="utf-8")
    compact = json.dumps(out, ensure_ascii=False)
    RUTA_CATALOGO_DATA_JS.write_text(
        "/* Catalogo de productos por marca. */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_CATALOGO_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_CATALOGO_KEY)}]={compact};\n",
        encoding="utf-8",
    )


def excel_stamp() -> str:
    parts: list[str] = []
    for path in (RUTA_EXCEL, RUTA_EXCEL_ZEBRA):
        if not path.exists():
            parts.append(f"{path.name}:missing")
            continue
        st = path.stat()
        parts.append(f"{path.name}:{st.st_mtime_ns}:{st.st_size}")
    return "|".join(parts) if parts else "missing"


def guardar_precios(mapa: dict[str, PriceEntry]) -> None:
    RUTA_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(mapa, ensure_ascii=False, indent=2) + "\n"
    RUTA_JSON.write_text(payload, encoding="utf-8")
    compact = json.dumps(mapa, ensure_ascii=False)
    stamp = excel_stamp()
    RUTA_DATA_JS.write_text(
        "/* Precios clientes por SKU: numero = USD; {amount,currency:'COP'} = pesos. */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_PRICES_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_KEY)}]={compact};\n",
        encoding="utf-8",
    )


def guardar_precios_lp(payload: dict[str, Any]) -> None:
    RUTA_LP_JSON.parent.mkdir(parents=True, exist_ok=True)
    stamp = excel_stamp()
    out = dict(payload)
    out["stamp"] = stamp
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    RUTA_LP_JSON.write_text(text, encoding="utf-8")
    compact = json.dumps(out, ensure_ascii=False)
    RUTA_LP_DATA_JS.write_text(
        "/* Precios por LP para cotizador del asesor. */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_PRICES_LP_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_LP_KEY)}]={compact};\n",
        encoding="utf-8",
    )


def extraer_referencias() -> dict[str, str]:
    df = leer_hoja(RUTA_EXCEL, [STONE_COL, REFERENCIA_COL])
    mapa: dict[str, str] = {}
    work = df.iloc[START_ROW:]
    work = work.loc[work[STONE_COL].notna()]
    for _, fila in work.iterrows():
        sku = limpiar_sku(fila[STONE_COL])
        if not sku:
            continue
        ref = fila[REFERENCIA_COL]
        if pd.isna(ref):
            continue
        texto = str(ref).strip()
        if not texto or texto.lower() == "nan":
            continue
        mapa[sku] = texto
        sku_sin = sku.lstrip("0")
        if sku_sin:
            mapa[sku_sin] = texto
    return mapa


def guardar_referencias(mapa: dict[str, str]) -> None:
    RUTA_REF_JSON.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(mapa, ensure_ascii=False, indent=2) + "\n"
    RUTA_REF_JSON.write_text(text, encoding="utf-8")
    compact = json.dumps(mapa, ensure_ascii=False)
    stamp = excel_stamp()
    RUTA_REF_DATA_JS.write_text(
        "/* Referencias por SKU (columna D Lp Asesores). */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_REF_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_REF_KEY)}]={compact};\n",
        encoding="utf-8",
    )


def extraer_productos() -> dict[str, str]:
    """Nombres comerciales por SKU (columna C Lp Asesores). Solo lista IZC."""
    mapa: dict[str, str] = {}
    df = leer_hoja(RUTA_EXCEL, [STONE_COL, NOMBRE_COL])
    work = df.iloc[START_ROW:]
    work = work.loc[work[STONE_COL].notna()]
    for _, fila in work.iterrows():
        sku = limpiar_sku(fila[STONE_COL])
        if not sku:
            continue
        nombre = str(fila[NOMBRE_COL]).strip() if pd.notna(fila[NOMBRE_COL]) else ""
        if not nombre or nombre.lower() == "nan":
            continue
        prev = mapa.get(sku, "")
        if not prev or len(nombre) > len(prev):
            mapa[sku] = nombre
    return mapa


def guardar_productos(mapa: dict[str, str]) -> None:
    RUTA_PROD_JSON.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(mapa, ensure_ascii=False, indent=2) + "\n"
    RUTA_PROD_JSON.write_text(text, encoding="utf-8")
    compact = json.dumps(mapa, ensure_ascii=False)
    stamp = excel_stamp()
    RUTA_PROD_DATA_JS.write_text(
        "/* Nombres comerciales por SKU (columna C Lp Asesores). */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_PRODUCTOS_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_PROD_KEY)}]={compact};\n",
        encoding="utf-8",
    )


def _wh_code(valor) -> int | None:
    if pd.isna(valor):
        return None
    try:
        return int(round(float(valor)))
    except (TypeError, ValueError):
        return None


def limpiar_stock(valor) -> int:
    if pd.isna(valor):
        return 0
    if isinstance(valor, bool):
        return 0
    if isinstance(valor, (int, float)):
        n = int(round(float(valor)))
        return n if n > 0 else 0
    try:
        texto = str(valor).replace(" ", "").replace(",", ".").strip()
        n = int(round(float(texto)))
    except ValueError:
        return 0
    return n if n > 0 else 0


def _map_bodega_cols(
    df: pd.DataFrame, start: int, end: int, wh_map: dict[str, int]
) -> dict[str, int]:
    """Mapea AR/CT/UN/RC -> índice de columna según códigos Siigo en la fila de encabezado."""
    out: dict[str, int] = {}
    if INV_HEADER_ROW >= len(df):
        return out
    wh_to_bodega = {code: name for name, code in wh_map.items()}
    for c in range(start, min(end + 1, df.shape[1])):
        code = _wh_code(df.iat[INV_HEADER_ROW, c])
        if code is None or code not in wh_to_bodega:
            continue
        bodega = wh_to_bodega[code]
        if bodega not in out:
            out[bodega] = c
    return out


def extraer_inventario() -> dict[str, Any]:
    """Inventario por SKU desde Lp Asesores.

    IZC  = bloque INVENTARIO DISPONIBLE (Siigo 10→CT, 15→AR, 16→UN, 18→RC)
    VALTECH = bloque INVENTARIO VALTECH (Siigo 10→AR, 15→CT, 16→UN, 20→RC)
    """
    usecols = list(range(0, INV_VALTECH_END + 1))
    df = leer_hoja(RUTA_EXCEL, usecols)
    izc_cols = _map_bodega_cols(
        df, INV_IZC_DISP_START, INV_IZC_DISP_END, INV_BODEGA_WH_IZC
    )
    val_cols = _map_bodega_cols(
        df, INV_VALTECH_START, INV_VALTECH_END, INV_BODEGA_WH_VALTECH
    )

    # Fallback fijo si el encabezado no trae los códigos esperados.
    if len(izc_cols) < 4:
        izc_cols = {"AR": 5, "CT": 4, "UN": 6, "RC": 8}
    if len(val_cols) < 4:
        val_cols = {"AR": 48, "CT": 49, "UN": 50, "RC": 51}

    by_sku: dict[str, Any] = {}
    work = df.iloc[INV_DATA_START:]
    work = work.loc[work[STONE_COL].notna()]
    for _, fila in work.iterrows():
        sku = limpiar_sku(fila[STONE_COL])
        if not sku:
            continue
        izc = {
            b: limpiar_stock(fila[izc_cols[b]]) if b in izc_cols else 0
            for b in INV_BODEGAS
        }
        valtech = {
            b: limpiar_stock(fila[val_cols[b]]) if b in val_cols else 0
            for b in INV_BODEGAS
        }
        total = sum(izc.values()) + sum(valtech.values())
        row = {"izc": izc, "valtech": valtech, "total": total}
        by_sku[sku] = row
        sku_sin = sku.lstrip("0")
        if sku_sin and sku_sin != sku:
            by_sku[sku_sin] = row
    return {
        "bodegas": {"izc": list(INV_BODEGAS), "valtech": list(INV_BODEGAS)},
        "wh_codes": {"izc": dict(INV_BODEGA_WH_IZC), "valtech": dict(INV_BODEGA_WH_VALTECH)},
        "by_sku": by_sku,
    }


def guardar_inventario(payload: dict[str, Any]) -> None:
    RUTA_INV_JSON.parent.mkdir(parents=True, exist_ok=True)
    stamp = excel_stamp()
    out = dict(payload)
    out["stamp"] = stamp
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    RUTA_INV_JSON.write_text(text, encoding="utf-8")
    compact = json.dumps(out, ensure_ascii=False)
    RUTA_INV_DATA_JS.write_text(
        "/* Inventario por SKU (bodegas IZC / VALTECH). */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_INV_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_INV_KEY)}]={compact};\n",
        encoding="utf-8",
    )


def _print_sample(mapa: dict[str, PriceEntry], sku: str, prefix: str = "") -> None:
    if sku not in mapa:
        return
    val = mapa[sku]
    if isinstance(val, dict):
        pesos = val.get("pesos")
        extra = f" / PESOS {pesos:,.0f}" if isinstance(pesos, (int, float)) and pesos > 0 else ""
        print(f"  {prefix}{sku}: $ {val['amount']:,.2f} {val['currency']}{extra}")
    else:
        print(f"  {prefix}{sku}: $ {val:.2f} USD")


def sincronizar_todo(*, verbose: bool = True) -> dict[str, int]:
    """Lee lista-precios-izc.xlsb (+ ZEBRA) y regenera JSON/JS del cotizador."""
    if verbose:
        print(f"Excel: {RUTA_EXCEL} / hoja {SHEET_NAME}", flush=True)
        print("\n== Clientes (promedio WEB/INTERNA → BJ/BK) ==", flush=True)
    precios = extraer_precios_stone_usd()
    zebra = extraer_zebra_lp()
    izc_skus = extraer_skus_izc()
    zebra_precios = aplicar_zebra_a_precios(precios, zebra) if zebra else 0
    fixed_cop = sanitizar_precios_usd_desde_cop(precios)
    guardar_precios(precios)
    if verbose:
        print(f"Listo: {len(precios)} claves -> {RUTA_JSON}", flush=True)
        if fixed_cop:
            print(f"  USD desde COP/TRM (banderas 0/0.10): {fixed_cop} claves", flush=True)
        if zebra_precios:
            print(f"  ZEBRA LP web aplicada a {zebra_precios} claves", flush=True)
        for sku in ("4031", "6513", "13", "1596"):
            _print_sample(precios, sku)
        print("\n== LP asesores (11 listas) ==", flush=True)
    lp_payload = extraer_precios_lp_asesor()
    zebra_lp = aplicar_zebra_a_lp(lp_payload, zebra) if zebra else 0
    sanitizar_lp_promos_banderas(lp_payload)
    guardar_precios_lp(lp_payload)
    if verbose:
        print(f"Listo -> {RUTA_LP_JSON}", flush=True)
        if zebra_lp:
            print(f"  ZEBRA web/interna/volumen: {zebra_lp} entradas", flush=True)
        for meta in lp_payload["lists"]:
            m = lp_payload["by_list"][meta["id"]]
            print(f"  {meta['label']}: {len(m)} claves", flush=True)
            _print_sample(m, "13", prefix=f"{meta['id']}/")
        print("\n== Referencias ==", flush=True)
    refs = extraer_referencias()
    zebra_refs = aplicar_zebra_a_referencias(refs, zebra) if zebra else 0
    guardar_referencias(refs)
    if verbose:
        print(f"Listo: {len(refs)} claves -> {RUTA_REF_JSON}", flush=True)
        if zebra_refs:
            print(f"  ZEBRA nuevas referencias: {zebra_refs}", flush=True)
        for sku in ("13", "16", "4031"):
            if sku in refs:
                print(f"  {sku}: {refs[sku]}", flush=True)
        print("\n== Productos (nombres) ==", flush=True)
    productos = extraer_productos()
    zebra_prod = aplicar_zebra_a_productos(productos, zebra) if zebra else 0
    guardar_productos(productos)
    if verbose:
        print(f"Listo: {len(productos)} claves -> {RUTA_PROD_JSON}", flush=True)
        if zebra_prod:
            print(f"  ZEBRA productos nuevos: {zebra_prod}", flush=True)
        for sku in ("16720", "16721", "836", "4031"):
            if sku in productos:
                print(f"  {sku}: {productos[sku][:80]}", flush=True)
        print("\n== Inventario bodegas ==", flush=True)
    inv = extraer_inventario()
    zebra_inv = aplicar_zebra_a_inventario(inv, zebra, izc_skus) if zebra else 0
    guardar_inventario(inv)
    if verbose:
        print(f"Listo: {len(inv.get('by_sku') or {})} claves -> {RUTA_INV_JSON}", flush=True)
        if zebra_inv:
            print(f"  ZEBRA sin stock (agotado): {zebra_inv}", flush=True)
        if zebra:
            print("\n== Catalogo ZEBRA ==", flush=True)
    catalogo_nuevos = 0
    if zebra:
        catalogo, catalogo_nuevos = aplicar_zebra_a_catalogo(zebra, izc_skus)
        if catalogo is not None and catalogo_nuevos:
            guardar_catalogo(catalogo)
            if verbose:
                print(f"  Catalogo: +{catalogo_nuevos} productos ZEBRA", flush=True)
    return {
        "precios": len(precios),
        "lp_lists": len(lp_payload.get("lists") or []),
        "referencias": len(refs),
        "productos": len(productos),
        "inventario": len(inv.get("by_sku") or {}),
        "zebra_skus": len(zebra),
        "catalogo_nuevos": catalogo_nuevos,
    }


if __name__ == "__main__":
    sincronizar_todo(verbose=True)
