# Control del servidor local IZC (inicio, reinicio y comprobacion de API).
# Mantiene API + archivos en :8080 y :5500 (misma carpeta / mismos JSON).
param(
  [ValidateSet('ensure', 'restart', 'stop', 'health')]
  [string]$Action = 'ensure'
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $ScriptDir '..')).Path

# En WAMP (pqr :8183) no se debe levantar el servidor Python :8080.
if ($Root -match '(?i)\\wamp64\\www\\') {
  Write-Host "IZC en WAMP: usa http://pqr.izc.com.co:8183/IZC/  (no el puerto 8080)"
  exit 0
}

$ServerScript = Join-Path $ScriptDir 'servidor_local.ps1'
$SigFile = Join-Path $ScriptDir '.servidor_local.sig'
$Ports = @(8080, 5500)

function Get-ServerSignature {
  if (-not (Test-Path $ServerScript)) { return '' }
  $file = Get-Item $ServerScript
  return ($file.LastWriteTimeUtc.Ticks.ToString() + ':' + $file.Length.ToString())
}

function Save-ServerSignature {
  $sig = Get-ServerSignature
  [System.IO.File]::WriteAllText($SigFile, $sig, [System.Text.UTF8Encoding]::new($false))
}

function Test-PortListening([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    if ($ok -and $client.Connected) {
      $client.EndConnect($iar) | Out-Null
      $client.Close()
      return $true
    }
    try { $client.Close() } catch {}
    return $false
  } catch {
    return $false
  }
}

function Get-PortOwnerPids([int]$Port) {
  # Evitar Get-NetTCPConnection: en varios PCs se cuelga varios segundos/minutos.
  $pids = New-Object System.Collections.Generic.List[int]
  try {
    $out = & netstat.exe -ano -p tcp 2>$null
    $needle = (':{0} ' -f $Port)
    foreach ($line in $out) {
      $s = [string]$line
      if ($s -notmatch 'LISTENING') { continue }
      if ($s.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
      if ($s -match '\s(\d+)\s*$') {
        $id = [int]$Matches[1]
        if ($id -gt 0 -and -not $pids.Contains($id)) { [void]$pids.Add($id) }
      }
    }
  } catch {}
  return , @($pids)
}

function Test-PortIsIzcApi([int]$Port) {
  try {
    $body = '{"action":"get_trm"}'
    $response = Invoke-WebRequest -UseBasicParsing `
      -Uri "http://127.0.0.1:$Port/api/auth" `
      -Method POST `
      -ContentType 'application/json' `
      -Body $body `
      -TimeoutSec 3
    if ($response.StatusCode -ne 200) { return $false }
    $json = $response.Content | ConvertFrom-Json
    return ($json.ok -eq $true)
  } catch {
    # Fallback: si sirve HTML del cotizador, el listener IZC esta vivo.
    try {
      $html = Invoke-WebRequest -UseBasicParsing `
        -Uri "http://127.0.0.1:$Port/marcas.html" `
        -Method GET `
        -TimeoutSec 2
      return ($html.StatusCode -eq 200)
    } catch {
      return $false
    }
  }
}

function Get-IzcServerPids([int]$Port) {
  $pids = New-Object System.Collections.Generic.List[int]
  foreach ($procId in (Get-PortOwnerPids $Port)) {
    if ($procId -and $procId -gt 8) { [void]$pids.Add([int]$procId) }
  }
  try {
    $needle = 'servidor_local.ps1'
    $portNeedle = "-Port $Port"
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $cmd = [string]$_.CommandLine
        $cmd -and ($cmd -like "*$needle*") -and ($cmd -like "*$portNeedle*" -or $cmd -like "*-Port `"$Port`"*")
      } |
      ForEach-Object {
        $id = [int]$_.ProcessId
        if ($id -gt 8 -and -not $pids.Contains($id)) { [void]$pids.Add($id) }
      }
  } catch {}
  return , @($pids)
}

function Stop-PortProcess([int]$Port) {
  foreach ($procId in (Get-IzcServerPids $Port)) {
    if ($procId -le 8) { continue }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.ProcessName -match '^(powershell|pwsh)$') {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $cmd = [string]$_.CommandLine
        $cmd -and ($cmd -like '*servidor_local.ps1*') -and ($cmd -like "*-Port $Port*")
      } |
      ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  } catch {}
}

function Start-ServerOnPort([int]$Port) {
  # Arranque via WScript (mas fiable que Start-Process Hidden: antivirus a veces niega Acceso).
  $launcher = Join-Path $env:TEMP ("izc_servidor_port_{0}.vbs" -f $Port)
  $ps1 = $ServerScript.Replace('\', '\\').Replace('"', '""')
  $vbs = @(
    'Set sh = CreateObject("WScript.Shell")',
    ('sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""{0}"" -Port {1} -NoBrowser", 0, False' -f $ps1, $Port)
  ) -join "`r`n"
  [System.IO.File]::WriteAllText($launcher, $vbs, [System.Text.UTF8Encoding]::new($false))
  $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
  if (-not (Test-Path $wscript)) { $wscript = 'wscript.exe' }
  Start-Process -FilePath $wscript -ArgumentList @('//nologo', $launcher) -WindowStyle Hidden | Out-Null

  # Fallback si VBS no despacho el proceso
  Start-Sleep -Milliseconds 400
  if (-not (Get-IzcServerPids $Port).Count) {
    try {
      Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', $ServerScript,
        '-Port', "$Port",
        '-NoBrowser'
      ) -WindowStyle Hidden -ErrorAction Stop | Out-Null
    } catch {
      # Ultimo recurso: cmd start /min
      $cmdArgs = '/c start "IZC-$Port" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $ServerScript + '" -Port ' + $Port + ' -NoBrowser'
      Start-Process -FilePath 'cmd.exe' -ArgumentList $cmdArgs -WindowStyle Hidden | Out-Null
    }
  }
}

function Wait-PortReady([int]$Port, [int]$MaxAttempts = 25) {
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    if ((Test-PortListening $Port) -and (Test-PortIsIzcApi $Port)) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Test-PortUpToDate([int]$Port) {
  if (-not (Test-PortListening $Port)) { return $false }
  if (-not (Test-PortIsIzcApi $Port)) { return $false }
  $current = Get-ServerSignature
  if (-not (Test-Path $SigFile)) { return $true }
  $saved = (Get-Content $SigFile -Raw -Encoding UTF8).Trim()
  if (-not $saved) { return $true }
  return ($saved -eq $current)
}

function Ensure-Port([int]$Port) {
  if (Test-PortUpToDate $Port) { return $true }

  if (Test-PortListening $Port) {
    if (Test-PortIsIzcApi $Port) {
      # API viva pero firma vieja: reiniciar solo procesos PowerShell IZC
      Stop-PortProcess $Port
      Start-Sleep -Seconds 2
    } else {
      # Puerto ocupado por otra app (p.ej. Live Server de VS Code): no lo matamos
      Write-Host "Puerto $Port ocupado por otra aplicacion; se omite el servidor IZC ahi."
      return $false
    }
  }

  if ((Test-PortListening $Port) -and (Test-PortIsIzcApi $Port)) {
    Stop-PortProcess $Port
    Start-Sleep -Seconds 2
  }

  if ((Test-PortListening $Port) -and -not (Test-PortIsIzcApi $Port)) {
    Write-Host "Puerto $Port ocupado por otra aplicacion; se omite el servidor IZC ahi."
    return $false
  }

  Start-ServerOnPort $Port
  return (Wait-PortReady $Port)
}

function Ensure-AllPorts {
  $ok8080 = Ensure-Port 8080
  $null = Ensure-Port 5500
  if ($ok8080) { Save-ServerSignature }
  return $ok8080
}

function Stop-AllIzcPorts {
  foreach ($port in $Ports) {
    Stop-PortProcess $port
  }
  try {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe' OR Name = 'pwsh.exe'" -ErrorAction SilentlyContinue |
      Where-Object { ([string]$_.CommandLine) -like '*servidor_local.ps1*' } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}
}

function Restart-AllPorts {
  Stop-AllIzcPorts
  Start-Sleep -Seconds 2
  $ok8080 = $false
  foreach ($port in $Ports) {
    if (Test-PortListening $port) {
      if (Test-PortIsIzcApi $port) {
        Stop-PortProcess $port
        Start-Sleep -Seconds 2
      } else {
        Write-Host "Puerto $port ocupado por otra aplicacion; se omite."
        continue
      }
    }
    if (-not (Test-PortListening $port)) {
      Start-ServerOnPort $port
      if (Wait-PortReady $port) {
        if ($port -eq 8080) { $ok8080 = $true }
      }
    } elseif (Test-PortIsIzcApi $port) {
      if ($port -eq 8080) { $ok8080 = $true }
    }
  }
  if ($ok8080) { Save-ServerSignature }
  return $ok8080
}

switch ($Action) {
  'stop' {
    Stop-AllIzcPorts
    exit 0
  }
  'health' {
    # ABRIR.bat solo necesita API viva; la firma se valida en ensure/restart.
    if ((Test-PortListening 8080) -and (Test-PortIsIzcApi 8080)) { exit 0 } else { exit 1 }
  }
  'restart' {
    if (Restart-AllPorts) { exit 0 } else { exit 1 }
  }
  'ensure' {
    if (Ensure-AllPorts) { exit 0 } else { exit 1 }
  }
}
