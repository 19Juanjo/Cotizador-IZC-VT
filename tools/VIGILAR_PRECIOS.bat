@echo off
REM Vigila cambios en el archivo de precios y regenera JSON.
REM Inicia el vigilante automático de precios (consola visible).
cd /d "%~dp0.."
title IZC - Vigilancia de precios

call "%~dp0_find_python.bat"
if errorlevel 1 (
  pause
  exit /b 1
)

echo Actualizacion automatica de precios (sin XAMPP)
echo Usando: %PYEXE%
echo.
"%PYEXE%" src\vigilar_precios.py
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo ejecutar el vigilante.
  echo Prueba:  "%PYEXE%" -m pip install pandas pyxlsb
  pause
)
