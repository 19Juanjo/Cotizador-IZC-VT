@echo off
chcp 65001 >nul
echo Restaura cotizaciones.json + API en el WAMP de pqr (NO borra: fusiona en el servidor al abrir Admin).
echo.
set SRC=%~dp0..
set DST=C:\wamp64\www\IZC
if exist "Q:\wamp64\www\IZC\api\auth.php" set DST=Q:\wamp64\www\IZC
if exist "Q:\wamp64\www\IZC\admin.html" set DST=Q:\wamp64\www\IZC

if not exist "%DST%" (
  echo No encuentro %DST%
  echo Ejecuta este BAT en el PC del servidor pqr.izc.com.co
  pause
  exit /b 1
)

if not exist "%DST%\data" mkdir "%DST%\data"
if not exist "%DST%\api" mkdir "%DST%\api"

echo Destino: %DST%
copy /Y "%SRC%\api\auth.php" "%DST%\api\auth.php"
copy /Y "%SRC%\api\restore_cotizaciones.php" "%DST%\api\restore_cotizaciones.php"
copy /Y "%SRC%\data\cotizaciones.json" "%DST%\data\cotizaciones.json"
copy /Y "%SRC%\data\_last_good_cotizaciones.json" "%DST%\data\_last_good_cotizaciones.json"

echo.
echo Listo. Abre Admin IZC - Historial de Cotizaciones y recarga (Ctrl+F5).
echo URL: http://pqr.izc.com.co:8183/IZC/admin.html
pause
