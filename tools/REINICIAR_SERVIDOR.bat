@echo off
REM Reinicia el servidor local (mata proceso y vuelve a abrir).
REM Reinicia el servidor IZC en http://127.0.0.1:8080
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor_control.ps1" -Action restart
if errorlevel 1 (
  echo No se pudo reiniciar el servidor. Revisa que el puerto 8080 este libre.
  pause
  exit /b 1
)

echo Servidor listo en http://127.0.0.1:8080
exit /b 0
