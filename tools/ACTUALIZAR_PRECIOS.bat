@echo off
REM Actualiza precios desde lista-precios-izc.xlsb (hoja Lp Asesores):
REM  - clientes BJ/BK -> precios.json
REM  - 11 LP asesores -> precios_lp_asesor.json
cd /d "%~dp0.."
title IZC - Actualizar precios

call "%~dp0_find_python.bat"
if errorlevel 1 (
  echo.
  echo Quieres intentar instalar Python ahora? [S/N]
  choice /C SN /N /M "S=Si  N=No"
  if errorlevel 2 (
    pause
    exit /b 1
  )
  call "%~dp0INSTALAR_PYTHON.bat"
  if errorlevel 1 (
    pause
    exit /b 1
  )
  call "%~dp0_find_python.bat"
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Usando: %PYEXE%
"%PYEXE%" src\extraer_precios.py
if errorlevel 1 (
  echo.
  echo ERROR: no se pudo actualizar.
  echo Si falta una libreria, ejecuta:
  echo   "%PYEXE%" -m pip install pandas pyxlsb
  echo O: tools\INSTALAR_PYTHON.bat
  pause
  exit /b 1
)
echo.
echo Listo. Recarga la pagina en el navegador.
pause
