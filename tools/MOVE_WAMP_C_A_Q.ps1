# Mueve WAMP de C:\wamp64 a Q:\wamp64 y actualiza todos los paths.
# NO pisa Q:\wamp64\www\IZC (el cotizador que ya copiaste).
# Ejecutar en el servidor, CMD/PowerShell como Administrador.

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$Old = 'C:\wamp64'
$New = 'Q:\wamp64'

function Write-Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

if (-not (Test-Path "$Old\wampmanager.exe")) {
  throw "No encuentro $Old\wampmanager.exe. WAMP no esta en C:."
}

Write-Step "1) Cerrar WAMP en C:"
Get-Process wampmanager, httpd, mysqld, mariadbd -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
foreach ($svc in @('wampapache64','wampapache','wampmysqld64','wampmysqld','wampmariadb64','wampmariadb')) {
  if (Get-Service $svc -ErrorAction SilentlyContinue) {
    Stop-Service $svc -Force -ErrorAction SilentlyContinue
  }
}
Start-Sleep -Seconds 2

Write-Step "2) Copiar WAMP a Q: (sin pisar www\IZC)"
New-Item -ItemType Directory -Force -Path $New | Out-Null
# /XD IZC: no toca el cotizador que ya esta en Q:
& robocopy $Old $New /E /COPY:DAT /R:1 /W:1 /XD IZC IZC_C_old .git /NFL /NDL /NJH
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy fallo con codigo $rc" }
if (-not (Test-Path "$New\wampmanager.exe")) {
  throw "No se copio wampmanager.exe a Q:."
}
if (-not (Test-Path "$New\www\IZC\admin.html")) {
  Write-Host "AVISO: no esta Q:\wamp64\www\IZC\admin.html. Copia IZC a Q:\wamp64\www\IZC antes de seguir." -ForegroundColor Yellow
}

Write-Step "3) Cambiar C:\wamp64 -> Q:\wamp64 en configs"
$ext = '*.conf','*.ini','*.config','*.bat','*.cmd','*.ps1','*.txt','*.xml','*.tpl'
$skipDir = '(?i)\\www\\IZC\\|\\www\\IZC_C_old\\|\\.git\\|\\logs\\|\\tmp\\'
$files = Get-ChildItem $New -Recurse -File -Include $ext -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch $skipDir -and $_.Length -lt 5MB }
$n = 0
foreach ($f in $files) {
  $raw = [System.IO.File]::ReadAllText($f.FullName)
  $upd = $raw
  $upd = $upd.Replace('C:\wamp64', 'Q:\wamp64').Replace('c:\wamp64', 'Q:\wamp64')
  $upd = $upd.Replace('C:/wamp64', 'Q:/wamp64').Replace('c:/wamp64', 'Q:/wamp64')
  if ($upd -ne $raw) {
    [System.IO.File]::WriteAllText($f.FullName, $upd)
    $n++
  }
}
Write-Host "Archivos actualizados: $n"

Write-Step "4) Reinstalar servicios Windows (Apache / MySQL)"
$apacheDir = Get-ChildItem "$New\bin\apache" -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'bin\httpd.exe') } |
  Select-Object -First 1
if (-not $apacheDir) { throw "No encuentro httpd.exe en $New\bin\apache" }
$httpd = Join-Path $apacheDir.FullName 'bin\httpd.exe'
Write-Host "Apache: $httpd"

foreach ($name in @('wampapache64','wampapache')) {
  & $httpd -k uninstall -n $name 2>$null
  sc.exe delete $name 2>$null | Out-Null
}
& $httpd -k install -n wampapache64
if ($LASTEXITCODE -ne 0) { Write-Host "AVISO: install Apache codigo $LASTEXITCODE" -ForegroundColor Yellow }

$dbExe = $null
$dbSvc = 'wampmysqld64'
foreach ($kind in @('mysql','mariadb')) {
  $d = Get-ChildItem "$New\bin\$kind" -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($d) {
    $cand = Join-Path $d.FullName 'bin\mysqld.exe'
    if (-not (Test-Path $cand)) { $cand = Join-Path $d.FullName 'bin\mariadbd.exe' }
    if (Test-Path $cand) {
      $dbExe = $cand
      $ini = Join-Path $d.FullName 'my.ini'
      if ($kind -eq 'mariadb') { $dbSvc = 'wampmariadb64' }
      break
    }
  }
}
if ($dbExe) {
  Write-Host "DB: $dbExe"
  foreach ($name in @('wampmysqld64','wampmysqld','wampmariadb64','wampmariadb')) {
    sc.exe delete $name 2>$null | Out-Null
  }
  if (Test-Path $ini) {
    & $dbExe --install $dbSvc --defaults-file="$ini"
  } else {
    & $dbExe --install $dbSvc
  }
} else {
  Write-Host "No encontre MySQL/MariaDB. WAMP lo reinstala al abrir wampmanager." -ForegroundColor Yellow
}

Write-Step "5) Arrancar WAMP desde Q:"
Start-Service wampapache64 -ErrorAction SilentlyContinue
if ($dbSvc -and (Get-Service $dbSvc -ErrorAction SilentlyContinue)) {
  Start-Service $dbSvc -ErrorAction SilentlyContinue
}
Start-Process -FilePath "$New\wampmanager.exe"
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Listo. Desde ahora usa SOLO Q:\wamp64\wampmanager.exe" -ForegroundColor Green
Write-Host "Enlace: http://pqr.izc.com.co:8183/IZC/"
Write-Host "Local:  http://127.0.0.1:8183/IZC/"
Write-Host ""
Write-Host "Cuando el sitio funcione, NO borres C:\wamp64 todavia."
Write-Host "Renombralo:  ren C:\wamp64 C:\wamp64_OLD"
Write-Host "Si todo sigue bien un dia, ahi si lo borras."
Write-Host ""
Write-Host "NO abras C:\wamp64\wampmanager.exe"
