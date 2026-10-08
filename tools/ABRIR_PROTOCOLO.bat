@echo off
REM Protocolo izc: — inicia el servidor y abre la pagina pedida.
REM Ejemplos:
REM   izc:ensure
REM   izc:asesor.html
REM   izc:open/cotizador.html?x=1
REM   izc://login.html
cd /d "%~dp0"

set "ARG=%~1"
if "%ARG%"=="" set "ARG=izc:marcas.html"

REM Solo despertar servidor (sin navegador)
echo.%ARG%| findstr /I "ensure" >nul
if %ERRORLEVEL%==0 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action ensure >nul 2>&1
  if errorlevel 1 powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action restart >nul 2>&1
  exit /b 0
)

REM Extraer ruta relativa: quitar izc: / izc:// / open/
set "PAGE=%ARG%"
set "PAGE=%PAGE:izc:=%"
set "PAGE=%PAGE://=%"
if /I "%PAGE:~0,5%"=="open/" set "PAGE=%PAGE:~5%"
if /I "%PAGE:~0,5%"=="open\" set "PAGE=%PAGE:~5%"
if "%PAGE%"=="" set "PAGE=marcas.html"
if /I "%PAGE%"=="/" set "PAGE=marcas.html"

REM Si estamos dentro de WAMP y Apache vive en 8183, abrir ahi.
echo %CD% | find /I "\wamp64\www\" >nul
if %ERRORLEVEL%==0 (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c=New-Object Net.Sockets.TcpClient; $iar=$c.BeginConnect('127.0.0.1',8183,$null,$null); $ok=$iar.AsyncWaitHandle.WaitOne(600); if($ok -and $c.Connected){$c.EndConnect($iar)|Out-Null;$c.Close();exit 0}; try{$c.Close()}catch{}; exit 1 } catch { exit 1 }"
  if %ERRORLEVEL%==0 (
    start "" "http://127.0.0.1:8183/IZC/%PAGE%"
    exit /b 0
  )
)

REM Asegurar servidor local :8080 y abrir la pagina concreta
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action ensure >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action restart >nul 2>&1
)

set /a _n=0
:wait
set /a _n+=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action health >nul 2>&1
if %ERRORLEVEL%==0 goto :open
if %_n% GEQ 40 goto :fail
timeout /t 1 /nobreak >nul
goto :wait

:open
start "" "http://127.0.0.1:8080/%PAGE%"
exit /b 0

:fail
echo No se pudo iniciar el servidor en http://127.0.0.1:8080
echo Ejecuta: C:\IZC Server\ABRIR.bat
pause
exit /b 1
