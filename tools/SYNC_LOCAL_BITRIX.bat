@echo off
REM Sincroniza clientes y cotizaciones desde Bitrix al data/ local.
cd /d "%~dp0.."

echo === Sync Bitrix cotizaciones (todos los asesores) ===
call "%~dp0_find_python.bat"
if errorlevel 1 (
  pause
  exit /b 1
)
"%PYEXE%" -u tools\sync_bitrix_quotes_all.py
if errorlevel 1 (
  echo Fallo el sync de cotizaciones. Revisa data\bitrix.json (webhook entrante).
  pause
  exit /b 1
)

echo.
echo Reiniciando servidor local para aplicar datos...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action restart
if errorlevel 1 (
  echo Servidor no reinicio, pero los JSON ya se actualizaron.
) else (
  echo Servidor listo en http://127.0.0.1:8080
)

echo.
echo Listo. Abre Admin - Bitrix - "Sincronizar local" para clientes+cotizaciones,
echo o recarga el panel del asesor con Ctrl+F5.
pause
exit /b 0
