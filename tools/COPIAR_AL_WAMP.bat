@echo off
chcp 65001 >nul
echo Copia SOLO codigo IZC Server -^> WAMP
echo (no copia Excel, videos, .git, data, ni backups)
echo Destino: Q:\wamp64\www\IZC  (Apache sigue leyendo C:\wamp64\www\IZC via enlace)
echo.
set SRC=%~dp0..
set DST=Q:\wamp64\www\IZC
if not exist "%DST%" set DST=C:\wamp64\www\IZC
if not exist "%DST%" (
  echo No existe %DST%
  pause
  exit /b 1
)

robocopy "%SRC%\api" "%DST%\api" *.php /XO /R:1 /W:1
robocopy "%SRC%\assets\js" "%DST%\assets\js" *.js /XO /R:1 /W:1
robocopy "%SRC%\assets\css" "%DST%\assets\css" *.css /XO /R:1 /W:1
robocopy "%SRC%" "%DST%" *.html *.php .htaccess /XO /R:1 /W:1
robocopy "%SRC%\assets\files" "%DST%\assets\files" estelar_flete.json estelar_flete.data.js /XO /R:1 /W:1

echo.
echo Comprueba tamanos (NO deben ser 0 KB):
dir "%DST%\assets\js\admin.js"
dir "%DST%\api\auth.php"
dir "%DST%\assets\js\auth.js"
dir "%DST%\admin.html"
echo.
pause
