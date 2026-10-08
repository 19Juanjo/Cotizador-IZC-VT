@echo off
REM Instala Python 3 + pandas/pyxlsb sin depender de winget.
cd /d "%~dp0.."
title IZC - Instalar Python

echo Buscando Python...
call "%~dp0_find_python.bat"
if not errorlevel 1 (
  echo.
  echo Ya hay Python: %PYEXE%
  goto :deps
)

echo.
echo No hay Python. Descargando instalador oficial...

set "PYVER=3.12.7"
set "PYURL=https://www.python.org/ftp/python/%PYVER%/python-%PYVER%-amd64.exe"
set "PYSETUP=%TEMP%\izc-python-%PYVER%-amd64.exe"

if exist "%PYSETUP%" del /f /q "%PYSETUP%" >nul 2>&1

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference='SilentlyContinue';" ^
  "try {" ^
  "  Invoke-WebRequest -Uri '%PYURL%' -OutFile '%PYSETUP%' -UseBasicParsing;" ^
  "  if (-not (Test-Path '%PYSETUP%')) { exit 1 };" ^
  "  if ((Get-Item '%PYSETUP%').Length -lt 1000000) { exit 2 };" ^
  "  exit 0" ^
  "} catch { Write-Host $_.Exception.Message; exit 3 }"

if errorlevel 1 (
  echo.
  echo No se pudo descargar Python automaticamente.
  echo Abre este enlace en el navegador del SERVIDOR, descarga e instala:
  echo   %PYURL%
  echo.
  echo En el instalador marca:
  echo   [x] Add python.exe to PATH
  echo   [x] Install for all users  ^(si puedes^)
  echo Luego vuelve a ejecutar este archivo.
  start "" "%PYURL%"
  pause
  exit /b 1
)

echo.
echo Instalando Python %PYVER% (puede pedir permisos de administrador)...
"%PYSETUP%" /quiet InstallAllUsers=1 PrependPath=1 Include_pip=1 Include_test=0 SimpleInstall=1
if errorlevel 1 (
  echo Reintentando instalacion solo para este usuario...
  "%PYSETUP%" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1 Include_test=0 SimpleInstall=1
)
if errorlevel 1 (
  echo.
  echo La instalacion silenciosa fallo. Abriendo instalador visual...
  start /wait "" "%PYSETUP%"
)

echo.
echo Esperando a que Windows registre Python...
set /a _n=0
:wait_py
set /a _n+=1
call "%~dp0_find_python.bat"
if not errorlevel 1 goto :deps
if %_n% GEQ 40 goto :still_missing
timeout /t 2 /nobreak >nul
goto :wait_py

:still_missing
echo.
echo Python pudo instalarse pero esta ventana aun no lo ve.
echo Cierra TODOS los cmd, abre uno NUEVO y ejecuta:
echo   tools\ACTUALIZAR_PRECIOS.bat
echo.
echo Si sigue fallando, reinicia sesion en el servidor e intenta de nuevo.
pause
exit /b 1

:deps
echo.
echo Instalando dependencias pandas pyxlsb...
"%PYEXE%" -m ensurepip --upgrade >nul 2>&1
"%PYEXE%" -m pip install --upgrade pip
"%PYEXE%" -m pip install pandas pyxlsb
if errorlevel 1 (
  echo.
  echo ERROR al instalar dependencias.
  echo Prueba manualmente:
  echo   "%PYEXE%" -m pip install pandas pyxlsb
  pause
  exit /b 1
)

echo.
echo Listo. Ya puedes ejecutar tools\ACTUALIZAR_PRECIOS.bat
pause
exit /b 0
