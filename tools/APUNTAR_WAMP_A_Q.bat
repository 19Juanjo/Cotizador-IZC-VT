@echo off
setlocal
chcp 65001 >nul
REM Deja Apache (C:\wamp64\www\IZC) leyendo la carpeta en Q:\wamp64\www\IZC
set SRC=Q:\wamp64\www\IZC
set LINK=C:\wamp64\www\IZC
set SILENT=0
if /I "%~1"=="/silent" set SILENT=1

if not exist "%SRC%\admin.html" (
  echo No encuentro %SRC%\admin.html
  if "%SILENT%"=="0" pause
  exit /b 1
)

if not exist "C:\wamp64\www" (
  echo No existe C:\wamp64\www
  echo WAMP debe seguir instalado en C:\wamp64
  echo Abre el icono WAMP o Q:\wamp64\wampmanager.exe
  if "%SILENT%"=="0" pause
  exit /b 1
)

if exist "%LINK%\admin.html" (
  fsutil reparsepoint query "%LINK%" >nul 2>&1
  if %ERRORLEVEL%==0 (
    echo OK: Apache ya apunta a Q:\wamp64\www\IZC
    goto :done
  )
  echo C:\wamp64\www\IZC existe como carpeta real ^(no es enlace^).
  echo Renombrala a IZC_C_old y vuelve a correr este bat.
  if "%SILENT%"=="0" explorer "C:\wamp64\www"
  if "%SILENT%"=="0" pause
  exit /b 1
)

if exist "%LINK%" (
  rd "%LINK%" 2>nul
)

mklink /J "%LINK%" "%SRC%"
if errorlevel 1 (
  echo No se pudo crear el enlace. Ejecuta CMD como Administrador.
  if "%SILENT%"=="0" pause
  exit /b 1
)
echo Enlace creado: C:\wamp64\www\IZC -^> Q:\wamp64\www\IZC

:done
if "%SILENT%"=="0" (
  echo.
  echo Abre: http://pqr.izc.com.co:8183/IZC/
  echo Si no carga: icono WAMP -^> Restart All Services
  pause
)
exit /b 0
