@echo off
REM Agrega/actualiza Admin SAT SIN borrar el resto de clientes de data\usuarios.json
cd /d "%~dp0.."
title IZC - Agregar Admin SAT (merge seguro)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0AGREGAR_ADMIN_SAT.ps1"
if errorlevel 1 (
  echo ERROR al fusionar Admin SAT.
  pause
  exit /b 1
)
echo.
pause
