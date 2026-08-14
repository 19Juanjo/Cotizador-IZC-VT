@echo off
REM Vigila cambios en el archivo de precios y regenera JSON.
REM Inicia el vigilante automático de precios (consola visible).
cd /d "%~dp0.."
title IZC - Vigilancia de precios
echo Actualizacion automatica de precios (sin XAMPP)
echo.
python src\vigilar_precios.py
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo ejecutar Python.
  echo Instala Python y las dependencias: pip install pandas pyxlsb
  pause
)
