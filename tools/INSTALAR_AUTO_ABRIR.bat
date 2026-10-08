@echo off
REM Instala apertura automatica del sitio al iniciar.
REM Instala el autoarranque de IZC al iniciar Windows + protocolo izc: para despertar el servidor.
cd /d "%~dp0"

echo Instalando auto-inicio de IZC...
echo - Servidores en http://127.0.0.1:8080 y http://127.0.0.1:5500
echo - Se abre al iniciar sesion en Windows
echo - Si :5500 ya lo usa Live Server de VS Code, se respeta y no se pisa
echo.

wscript //nologo "%~dp0ABRIR.vbs"

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /Y "%~dp0ABRIR.vbs" "%STARTUP%\IZC_ABRIR.vbs" >nul
if errorlevel 1 (
  echo ERROR: no se pudo copiar al inicio de Windows.
  pause
  exit /b 1
)

if exist "%STARTUP%\IZC_Servidor.vbs" (
  del "%STARTUP%\IZC_Servidor.vbs" >nul
  echo Se reemplazo el auto-inicio anterior del solo-servidor.
)

set "PROTO=%~dp0ABRIR_PROTOCOLO.bat"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%~dp0ABRIR_PROTOCOLO.bat';" ^
  "New-Item -Path 'HKCU:\Software\Classes\izc' -Force | Out-Null;" ^
  "Set-ItemProperty -Path 'HKCU:\Software\Classes\izc' -Name '(default)' -Value 'URL:IZC Protocol';" ^
  "New-ItemProperty -Path 'HKCU:\Software\Classes\izc' -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null;" ^
  "New-Item -Path 'HKCU:\Software\Classes\izc\DefaultIcon' -Force | Out-Null;" ^
  "Set-ItemProperty -Path 'HKCU:\Software\Classes\izc\DefaultIcon' -Name '(default)' -Value 'shell32.dll,13';" ^
  "New-Item -Path 'HKCU:\Software\Classes\izc\shell\open\command' -Force | Out-Null;" ^
  "Set-ItemProperty -Path 'HKCU:\Software\Classes\izc\shell\open\command' -Name '(default)' -Value ('\"'+$p+'\" \"%1\"');"
if errorlevel 1 (
  echo AVISO: no se pudo registrar el protocolo izc: ^(el autoarranque si quedo instalado^).
) else (
  echo Protocolo izc: registrado -^> %PROTO%
)

echo.
echo Listo.
echo - IZC se abrira solo al encender el PC / iniciar sesion
echo - Tambien: tools\ABRIR.bat  ^(enciende :8080 y :5500^)
echo - Al abrir cualquier .html por doble clic, despierta el servidor y abre esa pagina
echo - Si Live Server ya ocupa :5500, IZC solo asegura :8080
echo.
if /I not "%~1"=="/silent" pause
