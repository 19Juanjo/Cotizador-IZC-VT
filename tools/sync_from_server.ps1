# Trae datos del servidor remoto al PC local.
# SOLO LECTURA en el servidor: no sube ni sobrescribe nada alla.
# Escribe solo en data\ local tras backup.
param(
  [string]$ServerBase = 'http://pqr.izc.com.co:8183/IZC',
  [string]$AdminNit = '03166122778'
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Data = Join-Path $Root 'data'
$BackupRoot = Join-Path $Data ('_backup_before_pull_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))

Write-Host "=== PULL servidor -> local (servidor SOLO LECTURA) ==="
Write-Host "Servidor: $ServerBase"
Write-Host "Local:    $Data"
Write-Host ""

$uriCandidates = @(
  ($ServerBase.TrimEnd('/') + '/api/auth.php'),
  ($ServerBase.TrimEnd('/') + '/api/auth')
)

$bodyJson = (@{ action = 'export_admin_data'; admin_nit = $AdminNit } | ConvertTo-Json -Compress)
$rawText = $null
$lastErr = ''
foreach ($uri in $uriCandidates) {
  try {
    Write-Host "Consultando $uri ..."
    $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -Body $bodyJson -ContentType 'application/json; charset=utf-8' -TimeoutSec 300
    $rawText = [string]$r.Content
    if ($rawText -match '"ok"\s*:\s*true') { break }
    $lastErr = $rawText.Substring(0, [Math]::Min(300, $rawText.Length))
    $rawText = $null
  } catch {
    $lastErr = [string]$_.Exception.Message
  }
}

if (-not $rawText) {
  Write-Host "ERROR: no se pudo exportar del servidor."
  Write-Host $lastErr
  Write-Host ""
  Write-Host "1) Sube api/auth.php al servidor (incluye export_admin_data)."
  Write-Host "2) Vuelve a ejecutar este script."
  Write-Host "El servidor NO fue modificado."
  pause
  exit 1
}

$resp = $rawText | ConvertFrom-Json
if (-not $resp.ok) {
  Write-Host ("ERROR: " + [string]$resp.error)
  Write-Host "El servidor NO fue modificado."
  pause
  exit 1
}
if (-not $resp.read_only) {
  Write-Host "AVISO: la respuesta no marca read_only. Abortando por seguridad."
  pause
  exit 1
}

Write-Host "Export OK. El servidor no se modifico."
if ($resp.counts) {
  $resp.counts.PSObject.Properties | ForEach-Object {
    $c = $_.Value
    $n = if ($null -ne $c.count) { $c.count } elseif ($null -ne $c.bytes) { "$($c.bytes) bytes" } else { '?' }
    Write-Host ("  {0}: {1}" -f $_.Name, $n)
  }
}

$filesRaw = $resp.files_raw
if (-not $filesRaw) {
  Write-Host "Sin files_raw en la respuesta. Sube api/auth.php actualizado."
  pause
  exit 1
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
Write-Host "Backup local en: $BackupRoot"

$names = @(
  'cotizaciones.json',
  'usuarios.json',
  'asesores.json',
  'trm.json',
  'asesor_clientes_manual.json',
  'asesor_clientes_index.json',
  'productos_creados_asesor.json',
  'bitrix_vendedores.json',
  'nit_nombres.json',
  'nit_telefonos.json',
  'nit_direcciones.json'
)

foreach ($name in $names) {
  $prop = $filesRaw.PSObject.Properties[$name]
  if (-not $prop -or $null -eq $prop.Value -or [string]$prop.Value -eq '') {
    Write-Host "  omitido: $name"
    continue
  }
  $dest = Join-Path $Data $name
  if (Test-Path $dest) {
    Copy-Item -LiteralPath $dest -Destination (Join-Path $BackupRoot $name) -Force
  }
  $content = [string]$prop.Value
  if (-not $content.EndsWith("`n")) { $content = $content + "`n" }
  [System.IO.File]::WriteAllText($dest, $content, [System.Text.UTF8Encoding]::new($false))
  Write-Host "  escrito local: $name"
}

Write-Host ""
Write-Host "Listo. Local = copia del servidor."
Write-Host "bitrix.json local NO se toco (tu webhook local se conserva)."
Write-Host "Reinicia ABRIR.bat y Ctrl+F5."
Write-Host "El servidor permanece intacto."
pause
