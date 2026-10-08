@echo off
REM Localiza python.exe y deja la ruta en PYEXE.
REM Uso: call "%~dp0_find_python.bat"
setlocal EnableExtensions
set "PYEXE="

REM 1) Rutas tipicas del usuario actual
call :try "%LocalAppData%\Python\bin\python.exe"
call :try "%LocalAppData%\Python\pythoncore-3.14-64\python.exe"
call :try "%LocalAppData%\Python\pythoncore-3.13-64\python.exe"
call :try "%LocalAppData%\Python\pythoncore-3.12-64\python.exe"
call :try "%LocalAppData%\Programs\Python\Python314\python.exe"
call :try "%LocalAppData%\Programs\Python\Python313\python.exe"
call :try "%LocalAppData%\Programs\Python\Python312\python.exe"
call :try "%LocalAppData%\Programs\Python\Python311\python.exe"

REM 2) Instalacion para todos los usuarios
call :try "%ProgramFiles%\Python314\python.exe"
call :try "%ProgramFiles%\Python313\python.exe"
call :try "%ProgramFiles%\Python312\python.exe"
call :try "%ProgramFiles%\Python311\python.exe"
call :try "C:\Python314\python.exe"
call :try "C:\Python313\python.exe"
call :try "C:\Python312\python.exe"
call :try "C:\Program Files\Python312\python.exe"
call :try "C:\Program Files\Python313\python.exe"

REM 3) Otros perfiles de usuario en esta maquina (servidor compartido)
for /d %%U in ("C:\Users\*") do (
  call :try "%%~U\AppData\Local\Python\bin\python.exe"
  call :try "%%~U\AppData\Local\Python\pythoncore-3.14-64\python.exe"
  call :try "%%~U\AppData\Local\Python\pythoncore-3.13-64\python.exe"
  call :try "%%~U\AppData\Local\Python\pythoncore-3.12-64\python.exe"
  call :try "%%~U\AppData\Local\Programs\Python\Python314\python.exe"
  call :try "%%~U\AppData\Local\Programs\Python\Python313\python.exe"
  call :try "%%~U\AppData\Local\Programs\Python\Python312\python.exe"
)

REM 4) py launcher
if not defined PYEXE (
  where py >nul 2>&1
  if not errorlevel 1 (
    for /f "delims=" %%P in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do call :try "%%P"
  )
)

REM 5) where python (salta stub WindowsApps de 0 bytes)
if not defined PYEXE (
  for /f "delims=" %%P in ('where python 2^>nul') do (
    if exist "%%~P" if %%~zP GTR 0 (
      echo %%~P| find /I "\WindowsApps\" >nul
      if errorlevel 1 call :try "%%~P"
    )
  )
)

if not defined PYEXE (
  echo ERROR: Python no encontrado en este PC/usuario.
  echo.
  echo En el SERVIDOR hay que instalarlo una vez:
  echo   1^) Ejecuta tools\INSTALAR_PYTHON.bat
  echo   2^) Luego tools\ACTUALIZAR_PRECIOS.bat
  echo.
  echo O instala manualmente desde https://www.python.org/downloads/
  echo marcando "Add python.exe to PATH".
  endlocal & set "PYEXE=" & exit /b 1
)

REM Exportar al caller (endlocal pierde vars; truco con set)
endlocal & set "PYEXE=%PYEXE%"
exit /b 0

:try
if defined PYEXE goto :eof
if exist "%~1" set "PYEXE=%~1"
goto :eof
