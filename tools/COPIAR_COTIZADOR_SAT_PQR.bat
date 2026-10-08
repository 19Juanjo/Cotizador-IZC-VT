@echo off
chcp 65001 >nul
echo Copia el cotizador SAT (asesor/admin) al WAMP de pqr.
set SRC=%~dp0..
set DST=C:\wamp64\www\IZC
if exist "Q:\wamp64\www\IZC\cotizador-asesor.html" set DST=Q:\wamp64\www\IZC

if not exist "%DST%" (
  echo No encuentro %DST%
  echo Ejecuta este BAT en el PC del servidor pqr.izc.com.co
  pause
  exit /b 1
)

if not exist "%DST%\assets\js" mkdir "%DST%\assets\js"
if not exist "%DST%\api" mkdir "%DST%\api"

copy /Y "%SRC%\api\nit_lookup.php" "%DST%\api\nit_lookup.php"
copy /Y "%SRC%\assets\js\cotizador-asesor.js" "%DST%\assets\js\cotizador-asesor.js"
copy /Y "%SRC%\assets\js\cotizador-asesor.sat183.js" "%DST%\assets\js\cotizador-asesor.sat183.js"
copy /Y "%SRC%\assets\js\cotizador.js" "%DST%\assets\js\cotizador.js"
copy /Y "%SRC%\cotizador-asesor.html" "%DST%\cotizador-asesor.html"
copy /Y "%SRC%\cotizador-sat.html" "%DST%\cotizador-sat.html"
copy /Y "%SRC%\api\auth.php" "%DST%\api\auth.php"

echo.
echo Destino: %DST%
echo Listo. El asesor debe abrir de nuevo:
echo http://pqr.izc.com.co:8183/IZC/cotizador-asesor.html
pause
