@echo off
setlocal
chcp 65001 >nul
echo ============================================
echo  Liberar C: en el servidor WAMP
echo  NO borra cotizaciones, usuarios ni asesores.
echo ============================================
echo.
echo Espacio en C: ahora:
wmic logicaldisk where "DeviceID='C:'" get FreeSpace,Size
echo.

set IZC=C:\wamp64\www\IZC

echo [1] Logs y temporales de WAMP...
del /q /f "C:\wamp64\logs\*.log" 2>nul
del /q /f "C:\wamp64\tmp\*.*" 2>nul
for /d %%A in ("C:\wamp64\bin\apache\apache*") do (
  del /q /f "%%A\logs\*.log" 2>nul
)
for /d %%P in ("C:\wamp64\bin\php\php*") do (
  del /q /f "%%P\*.log" 2>nul
)

echo [2] Excel y cache que el cotizador NO usa en el servidor...
del /q /f "%IZC%\data\bitrix_companias.json" 2>nul
del /q /f "%IZC%\assets\files\*.xlsx" 2>nul
del /q /f "%IZC%\assets\files\*.xlsb" 2>nul
del /q /f "%IZC%\assets\files\SAT*.xlsx" 2>nul
del /q /f "%IZC%\assets\files\precios-watch.log" 2>nul
del /q /f "%IZC%\assets\files\_sat_details*.txt" 2>nul

echo [3] Backups y git (no hacen falta en WAMP)...
del /q /f "%IZC%\data\*.tmp" 2>nul
del /q /f "%IZC%\data\_last_good_*.json" 2>nul
del /q /f "%IZC%\data\_blocked_shrink_*.json" 2>nul
del /q /f "%IZC%\data\cotizaciones.backup*.json" 2>nul
del /q /f "%IZC%\data\_prod_cotizaciones_export.json" 2>nul
for /d %%D in ("%IZC%\data\_backup*") do rd /s /q "%%D" 2>nul
if exist "%IZC%\data\asesor_bitrix_quotes_sync" rd /s /q "%IZC%\data\asesor_bitrix_quotes_sync" 2>nul
if exist "%IZC%\data\asesor_bitrix_clientes_cache" rd /s /q "%IZC%\data\asesor_bitrix_clientes_cache" 2>nul
if exist "%IZC%\.git" rd /s /q "%IZC%\.git" 2>nul
if exist "%IZC%\src" rd /s /q "%IZC%\src" 2>nul
if exist "%IZC%\scripts" rd /s /q "%IZC%\scripts" 2>nul

echo [4] Papelera y TEMP de Windows...
rd /s /q "%systemdrive%\$Recycle.Bin" 2>nul
del /q /f /s "%TEMP%\*.*" 2>nul
del /q /f /s "C:\Windows\Temp\*.*" 2>nul

echo.
echo Espacio en C: despues:
wmic logicaldisk where "DeviceID='C:'" get FreeSpace,Size
echo.
echo Listo. Ahora copia SOLO:
echo   api\auth.php
echo   assets\js\admin.js
echo   assets\js\auth.js
echo   admin.html
echo NO copies la carpeta IZC entera, ni videos, ni Excel, ni .git, ni data\.
echo.
pause
