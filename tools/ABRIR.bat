@echo off
REM Abre el sitio:
REM - En WAMP (C:\wamp64 o Q:\wamp64): pqr :8183
REM - En el PC de desarrollo (C:\IZC Server): PowerShell :8080 y :5500
cd /d "%~dp0.."

echo %CD% | find /I "\wamp64\www\" >nul
if %ERRORLEVEL%==0 goto :wamp

if exist "%~dp0INICIAR_VIGILANCIA.vbs" (
  wscript //nologo "%~dp0INICIAR_VIGILANCIA.vbs"
)

echo Iniciando servidor local IZC en http://127.0.0.1:8080 ...
REM ensure primero (rapido si ya esta vivo); si no, restart forzado
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action ensure
if %ERRORLEVEL%==0 goto :health_ok

echo ensure no dejo el puerto listo; reiniciando...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action restart

:health_ok
set /a _n=0
:wait
set /a _n+=1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action health >nul 2>&1
if %ERRORLEVEL%==0 goto :open
if %_n% GEQ 40 goto :fail
echo   esperando API... (%_n%/40)
timeout /t 1 /nobreak >nul
goto :wait

:open
echo Servidor listo. Abriendo navegador...
REM Puerto principal del cotizador/panel: 8080 (5500 es espejo opcional).
start "" "http://127.0.0.1:8080/marcas.html"
start "" "http://127.0.0.1:8080/cotizador.html"
goto :eof

:fail
echo.
echo FALLO: el servidor no arranco en http://127.0.0.1:8080
echo Revisa antivirus/firewall o ejecuta:
echo   powershell -ExecutionPolicy Bypass -File tools\servidor_control.ps1 -Action restart
echo.
echo Si el antivirus bloquea PowerShell, agrega excepcion a la carpeta tools\
pause
goto :eof

:wamp
echo IZC esta en WAMP. El enlace de produccion es el puerto 8183, no 8080.
call "%~dp0APUNTAR_WAMP_A_Q.bat" /silent

REM Si Apache/WAMP no escucha :8183, avisar (no abrir URL muerta).
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $c = New-Object Net.Sockets.TcpClient; $iar = $c.BeginConnect('127.0.0.1',8183,$null,$null); $ok = $iar.AsyncWaitHandle.WaitOne(800); if ($ok -and $c.Connected) { $c.EndConnect($iar)|Out-Null; $c.Close(); exit 0 }; try{$c.Close()}catch{}; exit 1 } catch { exit 1 }"
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo WAMP no esta escuchando en el puerto 8183.
  echo Abre el icono WAMP / wampmanager.exe y elige Restart All Services.
  echo Luego vuelve a ejecutar ABRIR.bat
  echo.
  echo Si tienes la copia de trabajo en C:\IZC Server, abre ese ABRIR.bat
  echo ^(usa el puerto 8080 con PowerShell^).
  pause
  goto :eof
)

start "" "http://127.0.0.1:8183/IZC/"
start "" "http://pqr.izc.com.co:8183/IZC/"
echo.
echo Si la pagina no carga: icono WAMP -^> Restart All Services
echo Luego abre: http://pqr.izc.com.co:8183/IZC/
pause
