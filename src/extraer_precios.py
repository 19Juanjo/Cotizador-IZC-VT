"""Extrae precios por SKU (columna Stone / A) desde lista-precios-izc.xlsb.

- Productos normales: USD (columna BK, bloque CLIENTES)
- Etiquetas y cintas ribbon: COP (columna BJ, bloque CLIENTES)

Guarda assets/files/precios.json (+ precios.data.js).

Sin XAMPP (abrir HTML con doble clic / file://):
  1) Reemplaza assets/files/lista-precios-izc.xlsb
  2) Ejecuta: python src/extraer_precios.py
  3) Recarga la página en el navegador

Con XAMPP (localhost):
  precios.php puede regenerar el JSON solo si el Excel es más nuevo.
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Any

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
RUTA_EXCEL = BASE_DIR / "assets" / "files" / "lista-precios-izc.xlsb"
RUTA_JSON = BASE_DIR / "assets" / "files" / "precios.json"
RUTA_DATA_JS = BASE_DIR / "assets" / "files" / "precios.data.js"
JSON_KEY = "assets/files/precios.json"

STONE_COL = 0
NOMBRE_COL = 2  # Columna C
PESOS_COL = 61  # Columna BJ (CLIENTES / COP)
USD_COL = 62  # Columna BK (CLIENTES / USD)
START_ROW = 3

PriceEntry = float | dict[str, Any]


def normalizar_texto(valor: str) -> str:
    texto = unicodedata.normalize("NFKD", valor)
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    return texto.lower()


def es_etiqueta_o_cinta_ribbon(nombre: str) -> bool:
    """Solo rollos/etiquetas y ribbons (cintas ribbon), no impresoras ni repuestos."""
    n = normalizar_texto(nombre)
    if not n or n == "nan":
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

    # Cintas de transferencia térmica (cera/resina), no cintas protectoras/repuestos
    if "cinta" in n and any(
        x in n for x in ("cera", "resina", "wax", "ribbon", "transferencia")
    ):
        return True

    if "etiqueta" in n:
        exclusiones = (
            "impresora",
            "demo ",
            "aplicador",
            "dispensador",
            "software",
            "reloj",
        )
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
            # 3.132,42 -> 3132.42  OR  28658.00 style
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


def guardar_en_mapa(mapa: dict[str, PriceEntry], sku: str, entry: PriceEntry) -> None:
    mapa[sku] = entry
    sku_sin_ceros = sku.lstrip("0")
    if sku_sin_ceros:
        mapa[sku_sin_ceros] = entry


def extraer_precios_stone_usd() -> dict[str, PriceEntry]:
    """Nombre histórico; ahora también incluye COP para etiquetas/ribbons."""
    if not RUTA_EXCEL.exists():
        raise FileNotFoundError(f"No se encontro el Excel en {RUTA_EXCEL}")

    df = pd.read_excel(RUTA_EXCEL, engine="pyxlsb", header=None)
    mapa_precios: dict[str, PriceEntry] = {}
    cop_count = 0

    for i in range(START_ROW, len(df)):
        fila = df.iloc[i]
        sku = limpiar_sku(fila[STONE_COL])
        if not sku:
            continue

        nombre = str(fila[NOMBRE_COL]) if len(fila) > NOMBRE_COL else ""
        if es_etiqueta_o_cinta_ribbon(nombre):
            precio_cop = (
                limpiar_precio(fila[PESOS_COL]) if len(fila) > PESOS_COL else None
            )
            if precio_cop is None:
                continue
            guardar_en_mapa(mapa_precios, sku, entry_cop(precio_cop))
            cop_count += 1
            continue

        precio_usd = limpiar_precio(fila[USD_COL]) if len(fila) > USD_COL else None
        if precio_usd is None:
            continue
        guardar_en_mapa(mapa_precios, sku, precio_usd)

    print(f"  COP (etiquetas/ribbons): {cop_count} SKUs")
    return mapa_precios


def excel_stamp() -> str:
    if not RUTA_EXCEL.exists():
        return "missing"
    st = RUTA_EXCEL.stat()
    return f"{st.st_mtime_ns}:{st.st_size}"


def guardar_precios(mapa: dict[str, PriceEntry]) -> None:
    RUTA_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(mapa, ensure_ascii=False, indent=2) + "\n"
    RUTA_JSON.write_text(payload, encoding="utf-8")
    compact = json.dumps(mapa, ensure_ascii=False)
    stamp = excel_stamp()
    RUTA_DATA_JS.write_text(
        "/* Precios por SKU: número = USD; {amount,currency:'COP'} = pesos. */\n"
        "window.__IZC_DATA__=window.__IZC_DATA__||{};\n"
        f"window.__IZC_PRICES_STAMP__={json.dumps(stamp)};\n"
        f"window.__IZC_DATA__[{json.dumps(JSON_KEY)}]={compact};\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    print(f"Leyendo Excel: {RUTA_EXCEL}")
    precios = extraer_precios_stone_usd()
    guardar_precios(precios)
    print(f"Listo: {len(precios)} claves -> {RUTA_JSON}")
    print(f"También: {RUTA_DATA_JS.name}")

    # Muestras
    samples = ["4031", "6513", "13", "1596", "2204"]
    for sku in samples:
        if sku not in precios:
            continue
        val = precios[sku]
        if isinstance(val, dict):
            print(f"  {sku}: $ {val['amount']:,.0f} {val['currency']}")
        else:
            print(f"  {sku}: $ {val:.2f} USD")
