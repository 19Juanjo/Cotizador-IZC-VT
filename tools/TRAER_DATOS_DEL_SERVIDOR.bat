@echo off
REM Copia datos del SERVIDOR al PC local. NO modifica el servidor.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync_from_server.ps1" %*
exit /b %ERRORLEVEL%
