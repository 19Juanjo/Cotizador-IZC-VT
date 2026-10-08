@echo off
:: Mueve WAMP de C: a Q: y corrige paths. Ejecutar como Administrador EN EL SERVIDOR.
net session >nul 2>&1
if errorlevel 1 (
  echo Ejecuta este .bat como Administrador.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0MOVE_WAMP_C_A_Q.ps1"
echo.
pause
