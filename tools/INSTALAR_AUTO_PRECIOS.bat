@echo off
REM Instala tarea automatica de actualizacion de precios.
REM Instala el autoarranque del vigilante de precios al iniciar Windows.
cd /d "%~dp0.."
echo Instalando vigilancia automatica de precios al iniciar Windows...
wscript //nologo "%~dp0INICIAR_VIGILANCIA.vbs"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /Y "%~dp0INICIAR_VIGILANCIA.vbs" "%STARTUP%\IZC_Precios.vbs" >nul
if errorlevel 1 (
  echo ERROR: no se pudo copiar al inicio de Windows.
  pause
  exit /b 1
)
echo Listo.
echo - Vigilante activo ahora en segundo plano
echo - Se iniciara solo al encender el PC / iniciar sesion
echo.
echo Solo cambia assets\files\lista-precios-izc.xlsb
echo La web actualiza sola en unos segundos (clientes + LP asesor + referencias).
echo Si hace falta, recarga la pagina.
pause
