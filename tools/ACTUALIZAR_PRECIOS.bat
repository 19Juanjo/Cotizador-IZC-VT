@echo off
REM Actualiza la lista de precios desde el Excel/fuente configurada.
REM Ejecuta la extracción de precios desde el Excel de lista de precios.
cd /d "%~dp0.."
title IZC - Actualizar precios ahora
python src\extraer_precios.py
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo actualizar.
  echo pip install pandas pyxlsb
  pause
  exit /b 1
)
echo.
echo Listo. Recarga la pagina en el navegador.
pause
