# Servidor HTTP local (API auth, cotizaciones, Bitrix, archivos estaticos).
# Servidor local IZC: archivos estaticos + API registro/login -> data\usuarios.json
param(
  [int]$Port = 8080,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$UsersFile = Join-Path $Root 'data\usuarios.json'
$QuotesFile = Join-Path $Root 'data\cotizaciones.json'
$TrmFile = Join-Path $Root 'data\trm.json'
$SessionBridgeFile = Join-Path $Root 'data\session_bridge.json'
$BitrixFile = Join-Path $Root 'data\bitrix.json'
$AsesoresFile = Join-Path $Root 'data\asesores.json'
$GerentesProductoFile = Join-Path $Root 'data\gerentes_producto.json'
$BitrixGerentesFile = Join-Path $Root 'data\bitrix_gerentes.json'
$GpBitrixClientesCacheDir = Join-Path $Root 'data\gp_bitrix_clientes_cache'
$GpBitrixClientesTtlSec = 300
$AsesorClientesIndexFile = Join-Path $Root 'data\asesor_clientes_index.json'
$AsesorClientesManualFile = Join-Path $Root 'data\asesor_clientes_manual.json'
$AsesorBitrixClientesCacheDir = Join-Path $Root 'data\asesor_bitrix_clientes_cache'
$BitrixCompanyNamePrimary = 'UF_CRM_1746192481'
$BitrixCompanyNameFallback = 'UF_CRM_1746192546'
$AsesorBitrixClientesTtlSec = 300
$BitrixQuotesSyncSince = '2026-08-20'
$BitrixQuotesSyncDir = Join-Path $Root 'data\asesor_bitrix_quotes_sync'
$BitrixQuotesSyncFlag = Join-Path $Root 'data\.bitrix_quotes_sync_at'
$BitrixQuotesSyncTtlSec = 300
$NitTelefonosFile = Join-Path $Root 'data\nit_telefonos.json'
$NitDireccionesFile = Join-Path $Root 'data\nit_direcciones.json'
$ClientesSinVendedorDismissedFile = Join-Path $Root 'data\clientes_sin_vendedor_dismissed.json'
$Prefix = "http://127.0.0.1:$Port/"

function Get-PythonLauncher {
  foreach ($name in @('py', 'python', 'python3')) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) { return $cmd.Source }
  }
  return ''
}

# Dispara sync Bitrix→cotizaciones.json (mismo mapeo que el servidor) con TTL 5 min.
function Start-LocalBitrixQuotesSyncIfDue([bool]$force = $false, [bool]$importNew = $false) {
  $out = [ordered]@{
    started = $false
    from_cache = $false
    error = ''
    pid = 0
    import_new = $importNew
  }
  try {
    if (-not $force -and (Test-Path $BitrixQuotesSyncFlag)) {
      $age = ((Get-Date) - (Get-Item -LiteralPath $BitrixQuotesSyncFlag).LastWriteTime).TotalSeconds
      if ($age -ge 0 -and $age -lt $BitrixQuotesSyncTtlSec) {
        $out.from_cache = $true
        return $out
      }
    }
  } catch {}

  $py = Get-PythonLauncher
  if (-not $py) {
    $out.error = 'Python no encontrado para sincronizar Bitrix.'
    return $out
  }
  $script = Join-Path $Root 'tools\sync_bitrix_quotes_all.py'
  if (-not (Test-Path -LiteralPath $script)) {
    $out.error = 'Falta tools/sync_bitrix_quotes_all.py'
    return $out
  }
  try {
    $dir = Split-Path $BitrixQuotesSyncFlag -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Set-Content -LiteralPath $BitrixQuotesSyncFlag -Value ((Get-Date).ToString('o')) -Encoding UTF8
  } catch {}

  try {
    # Ruta relativa: evita que Start-Process parta "C:\IZC Server\..." por el espacio.
    $relScript = 'tools\sync_bitrix_quotes_all.py'
    $argList = @('-u', $relScript)
    if ($importNew) { $argList += '--import-new' } else { $argList += '--link-only' }
    $p = Start-Process -FilePath $py -ArgumentList $argList -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    $out.started = $true
    $out.pid = [int]$p.Id
  } catch {
    $out.error = [string]$_.Exception.Message
  }
  return $out
}

function Normalize-AsesorCodigo([string]$codigo) {
  $c = ([string]$codigo).Trim().ToUpperInvariant() -replace '[\s.]', ''
  if ($c -match '^V(\d{1,4})$') {
    return ('V{0}' -f [int]$Matches[1])
  }
  # Gerentes de producto SAT usan panel GP, no el de asesores V#.
  if ($c -match '^GP\d{1,4}$') { return '' }
  if ($c -eq 'ZKTECO' -or $c -eq 'ZEBRA' -or $c -eq 'SAT') { return '' }
  # Codigos alfabeticos tipo ADV (2-6 letras, opcionalmente con digitos)
  if ($c -match '^[A-Z]{2,6}\d{0,4}$') {
    return $c
  }
  return ''
}

function As-ObjectList($value) {
  # Unwrap accidental nesting from "@(Func)" when Func returns ",$array".
  $list = New-Object System.Collections.Generic.List[object]
  if ($null -eq $value) { return $list }
  $cur = $value
  while (
    $cur -is [System.Array] -and
    $cur.Length -eq 1 -and
    $null -ne $cur[0] -and
    ($cur[0] -is [System.Array] -or $cur[0] -is [System.Collections.IList])
  ) {
    $cur = $cur[0]
  }
  if ($cur -is [System.Array] -or ($cur -is [System.Collections.IList] -and $cur -isnot [string])) {
    foreach ($item in $cur) {
      if ($null -ne $item) { [void]$list.Add($item) }
    }
  } elseif ($null -ne $cur) {
    [void]$list.Add($cur)
  }
  return $list
}

function Read-Asesores {
  if (-not (Test-Path $AsesoresFile)) { return ,[object[]]@() }
  try {
    $raw = Get-Content $AsesoresFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return ,[object[]]@() }
    $data = $raw | ConvertFrom-Json
    # Compat: ConvertTo-Json a veces guarda { value: [...], Count: N }
    if ($null -ne $data -and $null -ne $data.PSObject.Properties['value'] -and $null -ne $data.value) {
      $data = $data.value
    }
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($item in (As-ObjectList $data)) {
      if ($null -eq $item) { continue }
      if (-not (Normalize-AsesorCodigo ([string]$item.codigo))) { continue }
      [void]$list.Add($item)
    }
    return ,$list.ToArray()
  } catch {
    return ,[object[]]@()
  }
}

function Write-Asesores($asesores) {
  $dir = Split-Path $AsesoresFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($item in (As-ObjectList $asesores)) {
    if ($null -eq $item) { continue }
    $codigo = Normalize-AsesorCodigo ([string]$item.codigo)
    if (-not $codigo) { continue }
    $nombre = ([string]$item.nombre).Trim()
    if (-not $nombre) { $nombre = $codigo }
    $hash = [string]$item.password_hash
    if (-not $hash) {
      $plain = [string]$item.password
      if ($plain) { $hash = New-PasswordHash $plain }
    }
    if (-not $hash) { continue }
    $created = [string]$item.created_at
    if (-not $created) { $created = (Get-Date).ToString('o') }
    $list.Add([ordered]@{
      codigo = $codigo
      nombre = $nombre
      password_hash = $hash
      created_at = $created
    })
  }

  if ($list.Count -eq 0) {
    $json = '[]'
  } else {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('[')
    for ($i = 0; $i -lt $list.Count; $i++) {
      $a = $list[$i]
      $codigoJson = ($a.codigo | ConvertTo-Json -Compress)
      $nombreJson = ($a.nombre | ConvertTo-Json -Compress)
      $hashJson = ($a.password_hash | ConvertTo-Json -Compress)
      $createdJson = ($a.created_at | ConvertTo-Json -Compress)
      [void]$sb.Append('  {')
      [void]$sb.Append("`n    `"codigo`": $codigoJson,")
      [void]$sb.Append("`n    `"nombre`": $nombreJson,")
      [void]$sb.Append("`n    `"password_hash`": $hashJson,")
      [void]$sb.Append("`n    `"created_at`": $createdJson")
      [void]$sb.Append("`n  }")
      if ($i -lt $list.Count - 1) { [void]$sb.Append(',') }
      [void]$sb.AppendLine()
    }
    [void]$sb.Append(']')
    $json = $sb.ToString()
  }
  [System.IO.File]::WriteAllText($AsesoresFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Find-Asesor($asesores, [string]$codigo) {
  $code = Normalize-AsesorCodigo $codigo
  if (-not $code) { return $null }
  foreach ($a in (As-ObjectList $asesores)) {
    if ((Normalize-AsesorCodigo ([string]$a.codigo)) -eq $code) { return $a }
  }
  return $null
}

function Normalize-GpCodigo([string]$codigo) {
  $c = ([string]$codigo).Trim().ToUpperInvariant() -replace '[\s.]', ''
  if ($c -match '^GP(\d{1,4})$') {
    return ('GP{0}' -f [int]$Matches[1])
  }
  return ''
}

function Test-IsGpLoginId([string]$raw) {
  return [bool](Normalize-GpCodigo $raw)
}

function Read-GerentesProducto {
  if (-not (Test-Path $GerentesProductoFile)) { return ,[object[]]@() }
  try {
    $raw = Get-Content $GerentesProductoFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return ,[object[]]@() }
    $data = $raw | ConvertFrom-Json
    if ($null -ne $data -and $null -ne $data.PSObject.Properties['value'] -and $null -ne $data.value) {
      $data = $data.value
    }
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($item in (As-ObjectList $data)) {
      if ($null -eq $item) { continue }
      if (-not (Normalize-GpCodigo ([string]$item.codigo))) { continue }
      [void]$list.Add($item)
    }
    return ,$list.ToArray()
  } catch {
    return ,[object[]]@()
  }
}

function Write-GerentesProducto($rows) {
  $dir = Split-Path $GerentesProductoFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($item in (As-ObjectList $rows)) {
    if ($null -eq $item) { continue }
    $codigo = Normalize-GpCodigo ([string]$item.codigo)
    if (-not $codigo) { continue }
    $nombre = ([string]$item.nombre).Trim()
    if (-not $nombre) { $nombre = $codigo }
    $hash = [string]$item.password_hash
    if (-not $hash) {
      $plain = [string]$item.password
      if ($plain) { $hash = New-PasswordHash $plain }
    }
    if (-not $hash) { continue }
    $created = [string]$item.created_at
    if (-not $created) { $created = (Get-Date).ToString('o') }
    $list.Add([ordered]@{
      codigo = $codigo
      nombre = $nombre
      password_hash = $hash
      bitrix_id = ([string]$item.bitrix_id).Trim()
      email = ([string]$item.email).Trim()
      created_at = $created
    })
  }
  if ($list.Count -eq 0) {
    $json = '[]'
  } else {
    $json = ($list | ConvertTo-Json -Depth 6)
    if (-not $json.Trim().StartsWith('[')) { $json = '[' + $json + ']' }
  }
  [System.IO.File]::WriteAllText($GerentesProductoFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Find-GerenteProducto($rows, [string]$codigo) {
  $code = Normalize-GpCodigo $codigo
  if (-not $code) { return $null }
  foreach ($g in (As-ObjectList $rows)) {
    if ((Normalize-GpCodigo ([string]$g.codigo)) -eq $code) { return $g }
  }
  return $null
}

function Test-IsSatActor($body) {
  foreach ($k in @('nit','admin_nit','sat_user','asesor_codigo','gp_codigo')) {
    try {
      $v = ([string]$body.$k -replace '[\s.]', '').ToUpperInvariant()
      if ($v -eq 'SAT' -or $v -eq 'ADMINSAT') { return $true }
    } catch {}
  }
  return $false
}

function Get-GpBitrixIds([string]$codigo) {
  $code = Normalize-GpCodigo $codigo
  $ids = New-Object System.Collections.Generic.List[string]
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  if (-not $code) { return ,$ids }
  $gp = Find-GerenteProducto (Read-GerentesProducto) $code
  if ($null -ne $gp) {
    $bid = ([string]$gp.bitrix_id).Trim()
    if ($bid -and $seen.Add($bid)) { [void]$ids.Add($bid) }
  }
  if (Test-Path $BitrixGerentesFile) {
    try {
      $map = (Get-Content $BitrixGerentesFile -Raw -Encoding UTF8) | ConvertFrom-Json
      foreach ($p in $map.PSObject.Properties) {
        $blob = ([string]$p.Value -replace '[\s.]', '').ToUpperInvariant()
        if ($blob -and $blob.Contains($code)) {
          $sid = [string]$p.Name
          if ($sid -and $seen.Add($sid)) { [void]$ids.Add($sid) }
        }
      }
    } catch {}
  }
  return ,$ids
}

function Sync-GpClientesFromBitrix([string]$codigo, [bool]$force = $false, [bool]$cacheOnly = $false) {
  $code = Normalize-GpCodigo $codigo
  $empty = [ordered]@{
    clientes = @()
    synced = $false
    from_cache = $false
    error = ''
    fetched_at = ''
    bitrix_count = 0
  }
  if (-not $code) {
    $empty.error = 'Codigo GP vacio.'
    return $empty
  }
  if (-not (Test-Path $GpBitrixClientesCacheDir)) {
    New-Item -ItemType Directory -Path $GpBitrixClientesCacheDir -Force | Out-Null
  }
  $cachePath = Join-Path $GpBitrixClientesCacheDir ($code + '.json')
  if (-not $force -and (Test-Path $cachePath)) {
    try {
      $cached = (Get-Content $cachePath -Raw -Encoding UTF8) | ConvertFrom-Json
      $fetchedAt = [string]$cached.fetched_at
      $useCache = $false
      if ($fetchedAt) {
        $age = ((Get-Date) - [datetime]::Parse($fetchedAt)).TotalSeconds
        if ($age -ge 0 -and $age -lt $GpBitrixClientesTtlSec) { $useCache = $true }
      }
      if ($useCache -or $cacheOnly) {
        $list = New-Object System.Collections.Generic.List[object]
        foreach ($c in (As-ObjectList $cached.clientes)) {
          if ($null -ne $c) { [void]$list.Add($c) }
        }
        return [ordered]@{
          clientes = @($list)
          synced = $true
          from_cache = $true
          error = ''
          fetched_at = $fetchedAt
          bitrix_count = @($list).Count
        }
      }
    } catch {}
  }
  if ($cacheOnly) { return $empty }

  $cfg = Read-BitrixConfig
  $ids = @(Get-GpBitrixIds $code)
  $byNit = @{}

  if ($cfg.enabled -and $cfg.webhook_base -and $ids.Count -gt 0) {
    foreach ($assignedId in $ids) {
      $start = 0
      do {
        try {
          $resp = Invoke-BitrixRest $cfg.webhook_base 'crm.company.list.json' @{
            filter = @{ ASSIGNED_BY_ID = [int]$assignedId }
            select = @('ID', 'TITLE', 'ASSIGNED_BY_ID', 'PHONE', $BitrixCompanyNamePrimary, $BitrixCompanyNameFallback)
            order = @{ ID = 'ASC' }
            start = $start
          }
        } catch {
          $empty.error = $_.Exception.Message
          break
        }
        foreach ($co in (As-ObjectList $resp.result)) {
          if ($null -eq $co) { continue }
          $nit = Clean-BitrixCompanyNit ([string]$co.TITLE)
          if (-not $nit) { continue }
          $nombre = Get-BitrixCompanyDisplayName $co $nit
          $phones = @(Extract-BitrixPhones $co.PHONE)
          $telefono = if ($phones.Count) { ($phones -join ' / ') } else { '' }
          if (-not $byNit.ContainsKey($nit)) {
            $byNit[$nit] = [ordered]@{
              nit = $nit
              nombre = $(if ($nombre) { $nombre } else { $nit })
              telefono = $telefono
              manual = $false
              source = 'bitrix'
            }
          }
        }
        if ($null -ne $resp.next) { $start = [int]$resp.next } else { $start = -1 }
      } while ($start -ge 0)
    }
  } elseif ($ids.Count -eq 0) {
    $empty.error = 'GP sin ID Bitrix mapeado.'
  } else {
    $empty.error = 'Bitrix no configurado.'
  }

  # Fallback: export local bitrix_companias.json
  if ($byNit.Count -eq 0 -and $ids.Count -gt 0) {
    $exportPath = Join-Path $Root 'data\bitrix_companias.json'
    if (Test-Path $exportPath) {
      try {
        $export = (Get-Content $exportPath -Raw -Encoding UTF8) | ConvertFrom-Json
        $companies = @()
        if ($null -ne $export.companies) { $companies = As-ObjectList $export.companies }
        $idSet = New-Object 'System.Collections.Generic.HashSet[string]'
        foreach ($id in $ids) { [void]$idSet.Add([string]$id) }
        foreach ($co in $companies) {
          $aid = [string]$co.ASSIGNED_BY_ID
          if (-not $aid -or -not $idSet.Contains($aid)) { continue }
          $nit = Clean-BitrixCompanyNit ([string]$co.TITLE)
          if (-not $nit) { continue }
          $nombre = ''
          try { $nombre = [string]$co.$BitrixCompanyNameFallback } catch {}
          if (-not $nombre) { try { $nombre = [string]$co.$BitrixCompanyNamePrimary } catch {} }
          if (-not $nombre) { $nombre = $nit }
          if (-not $byNit.ContainsKey($nit)) {
            $byNit[$nit] = [ordered]@{
              nit = $nit
              nombre = $nombre
              telefono = ''
              manual = $false
              source = 'export'
            }
          }
        }
        if ($byNit.Count -gt 0) { $empty.error = '' }
      } catch {}
    }
  }

  $clientes = @($byNit.Values | Sort-Object { $_.nombre })
  $fetchedAt = (Get-Date).ToString('o')
  $payload = [ordered]@{
    fetched_at = $fetchedAt
    codigo = $code
    bitrix_ids = @($ids)
    count = $clientes.Count
    clientes = $clientes
  }
  try { ($payload | ConvertTo-Json -Depth 8) | Set-Content -Path $cachePath -Encoding UTF8 } catch {}
  return [ordered]@{
    clientes = $clientes
    synced = $true
    from_cache = $false
    error = [string]$empty.error
    fetched_at = $fetchedAt
    bitrix_count = $clientes.Count
  }
}

function Get-GpClientNitSet([string]$codigo) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  $sync = Sync-GpClientesFromBitrix $codigo $false $true
  foreach ($c in (As-ObjectList $sync.clientes)) {
    $nit = Normalize-Nit ([string]$c.nit)
    if ($nit) {
      [void]$set.Add($nit)
      $digits = ($nit -replace '[^\d]', '')
      if ($digits) {
        [void]$set.Add($digits)
        $nz = $digits.TrimStart('0')
        if ($nz) { [void]$set.Add($nz) }
      }
    }
  }
  return $set
}

function Test-QuoteIsMadeByGp($q, [string]$codigo = '') {
  if ($null -eq $q) { return $false }
  $src = ([string]$q.quote_source).Trim().ToLowerInvariant()
  $seller = Normalize-GpCodigo ([string]$q.seller_codigo)
  $by = Normalize-GpCodigo ([string]$(if ($q.asesor_cotizado_by) { $q.asesor_cotizado_by } else { $q.finished_by }))
  $want = Normalize-GpCodigo $codigo
  if ($want) {
    return ($seller -eq $want -or $by -eq $want)
  }
  if ($src -eq 'gp') { return $true }
  return [bool]($seller -or $by)
}

function Test-QuoteIsMadeBySat($q) {
  if ($null -eq $q) { return $false }
  $src = ([string]$q.quote_source).Trim().ToLowerInvariant()
  if ($src -eq 'sat') { return $true }
  foreach ($k in @('seller_codigo','asesor_cotizado_by','sat_user','finished_by','nit')) {
    try {
      $v = ([string]$q.$k -replace '[\s.]', '').ToUpperInvariant()
      if ($v -eq 'SAT' -or $v -eq 'ADMINSAT') {
        if ($k -eq 'nit' -and ($src -eq 'cliente' -or $src -eq 'portal')) { continue }
        return $true
      }
    } catch {}
  }
  return $false
}

function Test-QuoteIsSatGerente($q) {
  if ($null -eq $q) { return $false }
  if (Test-QuoteIsMadeBySat $q) { return $true }
  if (Test-QuoteIsMadeByGp $q '') { return $true }
  return $false
}

function Get-AllGpClientNitSet {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($g in (As-ObjectList (Read-GerentesProducto))) {
    $code = Normalize-GpCodigo ([string]$g.codigo)
    if (-not $code) { continue }
    $gpSet = Get-GpClientNitSet $code
    if ($null -eq $gpSet) { continue }
    foreach ($n in @($gpSet)) {
      if ($n) { [void]$set.Add([string]$n) }
    }
  }
  return $set
}

function Get-QuotesForSat([string]$scope = 'gerentes', $opts = $null) {
  $listOnly = $false
  try { if ($opts -and $opts['list_only']) { $listOnly = $true } } catch {}
  $scope = ([string]$scope).Trim().ToLowerInvariant()
  if ($scope -ne 'clientes') { $scope = 'gerentes' }
  $nitSet = $null
  if ($scope -eq 'clientes') { $nitSet = Get-AllGpClientNitSet }
  $safe = New-Object System.Collections.ArrayList
  $all = As-ObjectList (Read-Quotes)
  $sorted = $all | Sort-Object { [string]$_.created_at } -Descending
  foreach ($q in (As-ObjectList $sorted)) {
    if ($null -eq $q) { continue }
    try { if ($q.asesor_eliminada) { continue } } catch {}
    if (-not (Test-QuoteHasPricedDeal $q)) { continue }
    if ($scope -eq 'gerentes') {
      if (-not (Test-QuoteIsSatGerente $q)) { continue }
    } else {
      if (-not (Test-QuoteIsMadeByCliente $q)) { continue }
      $src = ([string]$q.quote_source).Trim().ToLowerInvariant()
      if ($src -in @('asesor','gp','zkteco','sat','zebra')) { continue }
      $nit = Normalize-Nit ([string]$q.nit)
      if (-not $nit) { continue }
      $ok = $false
      if ($null -ne $nitSet) {
        $ok = $nitSet.Contains($nit) -or $nitSet.Contains(($nit -replace '^0+',''))
      }
      # Compat: seller_codigo GP marca la cotizacion como de cliente GP.
      if (-not $ok) {
        $sellerGp = Normalize-GpCodigo ([string]$q.seller_codigo)
        if ($sellerGp) { $ok = $true }
      }
      if (-not $ok) { continue }
    }
    $estado = Get-QuoteAsesorEstado $q
    $row = if ($listOnly) { Convert-QuoteToAsesorListRow $q $estado } else { Convert-QuoteToAsesorDetailRow $q $estado }
    [void]$safe.Add($row)
  }
  return [ordered]@{
    quotes = @($safe)
    count = $safe.Count
    scope = $scope
  }
}

function Get-QuotesForGp([string]$codigo, [string]$scope = 'historial', $opts = $null) {
  $code = Normalize-GpCodigo $codigo
  $listOnly = $false
  try { if ($opts -and $opts['list_only']) { $listOnly = $true } } catch {}
  $scope = ([string]$scope).Trim().ToLowerInvariant()
  if ($scope -ne 'clientes') { $scope = 'historial' }
  $nitSet = $null
  if ($scope -eq 'clientes') { $nitSet = Get-GpClientNitSet $code }
  $safe = New-Object System.Collections.ArrayList
  $all = As-ObjectList (Read-Quotes)
  $sorted = $all | Sort-Object { [string]$_.created_at } -Descending
  foreach ($q in (As-ObjectList $sorted)) {
    if ($null -eq $q) { continue }
    try { if ($q.asesor_eliminada) { continue } } catch {}
    if (-not (Test-QuoteHasPricedDeal $q)) { continue }
    if ($scope -eq 'historial') {
      if (-not (Test-QuoteIsMadeByGp $q $code)) { continue }
    } else {
      if (-not (Test-QuoteIsMadeByCliente $q)) { continue }
      $src = ([string]$q.quote_source).Trim().ToLowerInvariant()
      if ($src -in @('asesor','gp','zkteco','sat','zebra')) { continue }
      $nit = Normalize-Nit ([string]$q.nit)
      if (-not $nit) { continue }
      $ok = $nitSet.Contains($nit) -or $nitSet.Contains(($nit -replace '^0+',''))
      if (-not $ok) { continue }
    }
    $estado = Get-QuoteAsesorEstado $q
    $row = if ($listOnly) { Convert-QuoteToAsesorListRow $q $estado } else { Convert-QuoteToAsesorDetailRow $q $estado }
    [void]$safe.Add($row)
  }
  return [ordered]@{
    quotes = @($safe)
    count = $safe.Count
    scope = $scope
    codigo = $code
  }
}



$script:AsesorNombresByNitCache = $null

function Get-AsesorNombresByNitMap {
  if ($null -ne $script:AsesorNombresByNitCache) {
    return $script:AsesorNombresByNitCache
  }
  $map = @{}
  $nombresFile = Join-Path $Root 'data\nit_nombres.json'
  if (Test-Path $nombresFile) {
    try {
      $raw = Get-Content $nombresFile -Raw -Encoding UTF8
      $data = $raw | ConvertFrom-Json
      foreach ($row in (As-ObjectList $data)) {
        if ($null -eq $row) { continue }
        $nit = Normalize-Nit ([string]$row.nit)
        $nombre = ([string]$row.nombre).Trim()
        if ($nit -and $nombre) { $map[$nit] = $nombre }
      }
    } catch {}
  }
  if ($map.Count -eq 0 -and (Test-Path $AsesorClientesIndexFile)) {
    try {
      $raw = Get-Content $AsesorClientesIndexFile -Raw -Encoding UTF8
      $data = $raw | ConvertFrom-Json
      if ($null -ne $data.nombres_by_nit) {
        foreach ($p in $data.nombres_by_nit.PSObject.Properties) {
          $val = ([string]$p.Value).Trim()
          if ($val) { $map[[string]$p.Name] = $val }
        }
      }
    } catch {}
  }
  $script:AsesorNombresByNitCache = $map
  return $map
}

function Resolve-ClienteNombreFromIndex([string]$nit, [string]$fallback = '') {
  $n = Normalize-Nit $nit
  $fb = ([string]$fallback).Trim()
  if (-not $n) { return $fb }
  $map = Get-AsesorNombresByNitMap
  foreach ($key in @($n, ($n -replace '[^\d]', ''), (($n -replace '[^\d]', '').TrimStart('0')))) {
    if (-not $key) { continue }
    if ($map.ContainsKey($key) -and $map[$key]) { return $map[$key] }
  }
  if ($fb -and $fb -ne $n) { return $fb }
  return $(if ($fb) { $fb } else { $n })
}

$script:AsesorTelefonosByNitCache = $null

function Get-AsesorTelefonosByNitMap {
  if ($null -ne $script:AsesorTelefonosByNitCache) {
    return $script:AsesorTelefonosByNitCache
  }
  $map = @{}
  if (Test-Path $NitTelefonosFile) {
    try {
      $raw = Get-Content $NitTelefonosFile -Raw -Encoding UTF8
      $data = $raw | ConvertFrom-Json
      foreach ($row in (As-ObjectList $data)) {
        if ($null -eq $row) { continue }
        $nit = Normalize-Nit ([string]$row.nit)
        $tel = ([string]$row.telefono).Trim()
        if (-not $tel) { $tel = ([string]$row.telefonos).Trim() }
        if ($nit -and $tel) { $map[$nit] = $tel }
      }
    } catch {}
  }
  $script:AsesorTelefonosByNitCache = $map
  return $map
}

function Normalize-TelefonoDisplay([string]$telefono) {
  $p = ([string]$telefono).Trim()
  if (-not $p) { return '' }
  $parts = @()
  foreach ($chunk in @($p -split '\s*/\s*|\s*·\s*|\s*,\s*')) {
    $one = ([string]$chunk).Trim()
    if (-not $one) { continue }
    $compact = ($one -replace '[\s\-]', '')
    if ($compact.StartsWith('+57')) { $compact = $compact.Substring(3) }
    elseif ($compact.StartsWith('0057')) { $compact = $compact.Substring(4) }
    elseif ($compact -match '^57\d{7,10}$') { $compact = $compact.Substring(2) }
    if ($compact) { $parts += $compact }
  }
  if ($parts.Count -eq 0) { return '' }
  return ($parts -join ' / ')
}

function Resolve-ClienteTelefonoFromIndex([string]$nit, [string]$fallback = '') {
  $n = Normalize-Nit $nit
  $fb = Normalize-TelefonoDisplay $fallback
  if (-not $n) { return $fb }
  $map = Get-AsesorTelefonosByNitMap
  foreach ($key in @($n, ($n -replace '[^\d]', ''), (($n -replace '[^\d]', '').TrimStart('0')))) {
    if (-not $key) { continue }
    if ($map.ContainsKey($key) -and $map[$key]) {
      return (Normalize-TelefonoDisplay $map[$key])
    }
  }
  return $fb
}

$script:AsesorDireccionesByNitCache = $null

function Get-AsesorDireccionesByNitMap {
  if ($null -ne $script:AsesorDireccionesByNitCache) {
    return $script:AsesorDireccionesByNitCache
  }
  $map = @{}
  if (Test-Path $NitDireccionesFile) {
    try {
      $raw = Get-Content $NitDireccionesFile -Raw -Encoding UTF8
      $data = $raw | ConvertFrom-Json
      foreach ($row in (As-ObjectList $data)) {
        if ($null -eq $row) { continue }
        $nit = Normalize-Nit ([string]$row.nit)
        $dir = ([string]$row.direccion).Trim()
        if (-not $dir) { $dir = ([string]$row.address).Trim() }
        if ($nit -and $dir) { $map[$nit] = $dir }
      }
    } catch {}
  }
  $script:AsesorDireccionesByNitCache = $map
  return $map
}

function Resolve-ClienteDireccionFromIndex([string]$nit, [string]$fallback = '') {
  $n = Normalize-Nit $nit
  $fb = ([string]$fallback).Trim()
  if (-not $n) { return $fb }
  $map = Get-AsesorDireccionesByNitMap
  foreach ($key in @($n, ($n -replace '[^\d]', ''), (($n -replace '[^\d]', '').TrimStart('0')))) {
    if (-not $key) { continue }
    if ($map.ContainsKey($key) -and $map[$key]) {
      return ([string]$map[$key]).Trim()
    }
  }
  return $fb
}

function Get-AsesorClientes([string]$codigo) {
  $code = Normalize-AsesorCodigo $codigo
  $list = New-Object System.Collections.Generic.List[object]
  if (-not $code) { return ,$list }
  if (-not (Test-Path $AsesorClientesIndexFile)) { return ,$list }
  try {
    $raw = Get-Content $AsesorClientesIndexFile -Raw -Encoding UTF8
    $data = $raw | ConvertFrom-Json
    $entry = $null
    if ($null -ne $data.by_codigo) {
      $prop = $data.by_codigo.PSObject.Properties[$code]
      if ($null -ne $prop) { $entry = $prop.Value }
    }
    if ($null -eq $entry) { return ,$list }
    foreach ($c in (As-ObjectList $entry.clientes)) {
      if ($null -eq $c) { continue }
      $nitProp = $c.PSObject.Properties['nit']
      if ($null -eq $nitProp) { continue }
      $nit = Normalize-Nit ([string]$c.nit)
      if (-not $nit -or $nit.Length -gt 40) { continue }
      $nombre = ([string]$c.nombre).Trim()
      if (-not $nombre -or $nombre -eq $nit) {
        $nombre = Resolve-ClienteNombreFromIndex $nit $nombre
      }
      if (-not $nombre) { $nombre = $nit }
      $telefono = Normalize-TelefonoDisplay ([string]$c.telefono)
      if (-not $telefono) { $telefono = Normalize-TelefonoDisplay ([string]$c.telefonos) }
      if (-not $telefono) { $telefono = Resolve-ClienteTelefonoFromIndex $nit '' }
      $list.Add([ordered]@{ nit = $nit; nombre = $nombre; telefono = $telefono })
    }
    return ,$list
  } catch {
    return ,(New-Object System.Collections.Generic.List[object])
  }
}

function Read-AsesorClientesManual {
  if (-not (Test-Path $AsesorClientesManualFile)) {
    return [ordered]@{ by_codigo = [ordered]@{} }
  }
  try {
    $raw = Get-Content $AsesorClientesManualFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return [ordered]@{ by_codigo = [ordered]@{} }
    }
    $data = $raw | ConvertFrom-Json
    $by = [ordered]@{}
    if ($null -ne $data.by_codigo) {
      foreach ($p in $data.by_codigo.PSObject.Properties) {
        $arr = New-Object System.Collections.Generic.List[object]
        foreach ($c in (As-ObjectList $p.Value)) {
          if ($null -ne $c) { [void]$arr.Add($c) }
        }
        $by[[string]$p.Name] = $arr
      }
    }
    return [ordered]@{ by_codigo = $by }
  } catch {
    return [ordered]@{ by_codigo = [ordered]@{} }
  }
}

function Write-AsesorClientesManual($data) {
  $by = [ordered]@{}
  $src = $null
  if ($data -is [System.Collections.IDictionary] -and $data.Contains('by_codigo')) {
    $src = $data['by_codigo']
  } elseif ($null -ne $data.by_codigo) {
    $src = $data.by_codigo
  }
  if ($src -is [System.Collections.IDictionary]) {
    foreach ($k in @($src.Keys)) {
      $code = Normalize-AsesorCodigo ([string]$k)
      if (-not $code) { continue }
      $rows = New-Object System.Collections.ArrayList
      foreach ($c in (As-ObjectList $src[$k])) {
        if ($null -eq $c) { continue }
        $nit = ''
        $nombre = ''
        $telefono = ''
        $createdAt = ''
        $createdBy = ''
        $updatedAt = ''
        $updatedBy = ''
        if ($c -is [System.Collections.IDictionary]) {
          $nit = Normalize-Nit ([string]$c['nit'])
          $nombre = ([string]$c['nombre']).Trim()
          $telefono = Normalize-TelefonoDisplay ([string]$c['telefono'])
          $createdAt = [string]$c['created_at']
          $createdBy = [string]$c['created_by']
          $updatedAt = [string]$c['updated_at']
          $updatedBy = [string]$c['updated_by']
        } else {
          $nit = Normalize-Nit ([string]$c.nit)
          $nombre = ([string]$c.nombre).Trim()
          $telefono = Normalize-TelefonoDisplay ([string]$c.telefono)
          $createdAt = [string]$c.created_at
          $createdBy = [string]$c.created_by
          $updatedAt = [string]$c.updated_at
          $updatedBy = [string]$c.updated_by
        }
        if (-not $nit) { continue }
        [void]$rows.Add([ordered]@{
          nit = $nit
          nombre = $nombre
          telefono = $telefono
          created_at = $createdAt
          created_by = $createdBy
          updated_at = $updatedAt
          updated_by = $updatedBy
        })
      }
      # Forzar siempre array JSON (ConvertTo-Json convierte 1 ítem en objeto).
      $by[$code] = @($rows.ToArray())
    }
  }

  # Serializar a mano para que 1 cliente quede como [{...}] y no como {...}.
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('{')
  [void]$sb.AppendLine('  "by_codigo": {')
  $codes = @($by.Keys)
  for ($i = 0; $i -lt $codes.Count; $i++) {
    $code = [string]$codes[$i]
    $codeJson = ($code | ConvertTo-Json -Compress)
    [void]$sb.Append('    ')
    [void]$sb.Append($codeJson)
    [void]$sb.Append(': ')
    $arr = @($by[$code])
    if ($arr.Count -eq 0) {
      [void]$sb.Append('[]')
    } else {
      $parts = New-Object System.Collections.Generic.List[string]
      foreach ($row in $arr) {
        $parts.Add(($row | ConvertTo-Json -Compress -Depth 5))
      }
      [void]$sb.Append('[')
      [void]$sb.Append(($parts -join ','))
      [void]$sb.Append(']')
    }
    if ($i -lt ($codes.Count - 1)) { [void]$sb.Append(',') }
    [void]$sb.AppendLine('')
  }
  [void]$sb.AppendLine('  }')
  [void]$sb.AppendLine('}')
  [System.IO.File]::WriteAllText($AsesorClientesManualFile, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))
}

function Get-AsesorClientesManual([string]$codigo) {
  $code = Normalize-AsesorCodigo $codigo
  $list = New-Object System.Collections.Generic.List[object]
  if (-not $code) { return ,$list }
  $data = Read-AsesorClientesManual
  $rows = $null
  if ($data.by_codigo -is [System.Collections.IDictionary] -and $data.by_codigo.Contains($code)) {
    $rows = $data.by_codigo[$code]
  } elseif ($null -ne $data.by_codigo) {
    $prop = $data.by_codigo.PSObject.Properties[$code]
    if ($null -ne $prop) { $rows = $prop.Value }
  }
  foreach ($c in (As-ObjectList $rows)) {
    if ($null -eq $c) { continue }
    $nit = Normalize-Nit ([string]$c.nit)
    if (-not $nit) { continue }
    $nombre = ([string]$c.nombre).Trim()
    if (-not $nombre) { $nombre = $nit }
    $telefono = Normalize-TelefonoDisplay ([string]$c.telefono)
    if (-not $telefono) { $telefono = Resolve-ClienteTelefonoFromIndex $nit '' }
    $list.Add([ordered]@{ nit = $nit; nombre = $nombre; telefono = $telefono; manual = $true })
  }
  return ,$list
}

function Get-BitrixVendedoresMap {
  $mapFile = Join-Path $Root 'data\bitrix_vendedores.json'
  if (-not (Test-Path $mapFile)) { return @{} }
  try {
    $raw = Get-Content $mapFile -Raw -Encoding UTF8
    $data = $raw | ConvertFrom-Json
    $map = @{}
    foreach ($p in $data.PSObject.Properties) {
      $map[[string]$p.Name] = [string]$p.Value
    }
    return $map
  } catch {
    return @{}
  }
}

function Resolve-AsesorCodigoFromBitrixId($userId) {
  if (-not $userId) { return '' }
  $map = Get-BitrixVendedoresMap
  $key = [string]$userId
  if (-not $map.ContainsKey($key)) { return '' }
  $name = ([string]$map[$key]).ToUpperInvariant()
  if ($name -match '(?<![A-Z0-9])V(\d{1,4})(?![0-9])') {
    return ('V{0}' -f [int]$Matches[1])
  }
  if ($name -match '(?<![A-Z0-9])(ADV)(?![A-Z0-9])') {
    return $Matches[1]
  }
  return ''
}

function Get-SellerNameFromCodigoOrId([string]$codigo, [string]$assigned) {
  $map = Get-BitrixVendedoresMap
  if ($assigned -and $map.ContainsKey([string]$assigned) -and $map[[string]$assigned]) {
    return ([string]$map[[string]$assigned]).Trim()
  }
  $code = Normalize-AsesorCodigo $codigo
  if ($code) {
    foreach ($kv in $map.GetEnumerator()) {
      if ((Resolve-AsesorCodigoFromBitrixId $kv.Key) -eq $code) {
        $n = ([string]$kv.Value).Trim()
        if ($n) { return $n }
      }
    }
    $asesor = Find-Asesor (Read-Asesores) $code
    if ($null -ne $asesor) {
      $n = ([string]$asesor.nombre).Trim()
      if ($n) { return ($code + ' · ' + $n) }
      return $code
    }
  }
  return ''
}

$script:AsesorCodigoByNitCache = $null

function Get-AsesorCodigoByNitMap {
  if ($null -ne $script:AsesorCodigoByNitCache) {
    return $script:AsesorCodigoByNitCache
  }
  $map = @{}
  if (Test-Path $AsesorClientesIndexFile) {
    try {
      $raw = Get-Content $AsesorClientesIndexFile -Raw -Encoding UTF8
      $data = $raw | ConvertFrom-Json
      if ($null -ne $data.by_codigo) {
        foreach ($p in $data.by_codigo.PSObject.Properties) {
          $code = Normalize-AsesorCodigo ([string]$p.Name)
          foreach ($c in (As-ObjectList $p.Value.clientes)) {
            $cNit = Normalize-Nit ([string]$c.nit)
            if (-not $cNit) { continue }
            $map[$cNit] = $code
            $digits = ($cNit -replace '[^\d]', '')
            if ($digits) {
              $map[$digits] = $code
              $noZeros = $digits.TrimStart('0')
              if ($noZeros) { $map[$noZeros] = $code }
            }
          }
        }
      }
    } catch {}
  }
  $script:AsesorCodigoByNitCache = $map
  return $map
}

function Find-AsesorCodigoByClientNit([string]$nit) {
  $n = Normalize-Nit $nit
  if (-not $n) { return '' }
  $map = Get-AsesorCodigoByNitMap
  foreach ($key in @($n, ($n -replace '[^\d]', ''), (($n -replace '[^\d]', '').TrimStart('0')))) {
    if ($key -and $map.ContainsKey($key) -and $map[$key]) { return $map[$key] }
  }
  return ''
}

function Resolve-QuoteSellerLabel($quote) {
  $sellerName = ''
  $sellerCodigo = ''
  $assigned = ''
  if ($null -ne $quote) {
    $sellerName = ([string]$quote.seller_name).Trim()
    $sellerCodigo = Normalize-AsesorCodigo ([string]$quote.seller_codigo)
    $assigned = [string]$quote.assigned_by_id
  }
  if (-not $sellerCodigo -and $assigned) {
    $sellerCodigo = Resolve-AsesorCodigoFromBitrixId $assigned
  }
  if (-not $sellerName) {
    $sellerName = Get-SellerNameFromCodigoOrId $sellerCodigo $assigned
  }
  if (-not $sellerName -and $null -ne $quote) {
    $foundCode = Find-AsesorCodigoByClientNit ([string]$quote.nit)
    if ($foundCode) {
      $sellerCodigo = $foundCode
      $sellerName = Get-SellerNameFromCodigoOrId $foundCode ''
    }
  }
  return [ordered]@{
    seller_codigo = $sellerCodigo
    assigned_by_id = $assigned
    seller_name = $sellerName
    seller_label = $(if ($sellerName) { $sellerName } elseif ($sellerCodigo) { $sellerCodigo } else { '' })
  }
}

function Get-AsesorBitrixIds([string]$codigo) {
  $code = Normalize-AsesorCodigo $codigo
  $ids = New-Object System.Collections.Generic.List[string]
  if (-not $code) { return ,$ids }
  if (Test-Path $AsesorClientesIndexFile) {
    try {
      $raw = Get-Content $AsesorClientesIndexFile -Raw -Encoding UTF8
      $data = $raw | ConvertFrom-Json
      $prop = $null
      if ($null -ne $data.by_codigo) { $prop = $data.by_codigo.PSObject.Properties[$code] }
      if ($null -ne $prop -and $null -ne $prop.Value.bitrix_ids) {
        foreach ($id in (As-ObjectList $prop.Value.bitrix_ids)) {
          foreach ($flat in (As-ObjectList $id)) {
            $sid = [string]$flat
            if ($sid) { [void]$ids.Add($sid) }
          }
        }
      }
    } catch {}
  }
  if ($ids.Count -eq 0) {
    $map = Get-BitrixVendedoresMap
    foreach ($kv in $map.GetEnumerator()) {
      if ((Resolve-AsesorCodigoFromBitrixId $kv.Key) -eq $code) {
        [void]$ids.Add([string]$kv.Key)
      }
    }
  }
  $unique = New-Object System.Collections.Generic.List[string]
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($id in $ids) {
    foreach ($flat in (As-ObjectList $id)) {
      $sid = [string]$flat
      if ($sid -and $seen.Add($sid)) { [void]$unique.Add($sid) }
    }
  }
  return ,$unique
}

function Clean-BitrixCompanyNit([string]$title) {
  $t = ([string]$title).Trim()
  if (-not $t) { return '' }
  if ($t -match '^(\d{6,15})(-\d)?\b') { return $Matches[1] }
  $digits = ($t -replace '[^\d]', '')
  if ($digits.Length -ge 6 -and $digits.Length -le 15) { return $digits }
  return ''
}

function Get-BitrixCompanyDisplayName($co, [string]$nit) {
  $cands = New-Object System.Collections.Generic.List[string]
  foreach ($field in @($BitrixCompanyNamePrimary, $BitrixCompanyNameFallback, 'TITLE')) {
    try {
      $v = ([string]$co.$field).Trim()
      if ($v) { [void]$cands.Add($v) }
    } catch {}
  }
  $best = ''
  $bestScore = -1
  foreach ($cand in $cands) {
    $n = $cand
    foreach ($key in @($nit, ($nit -replace '[^\d]', ''))) {
      if (-not $key) { continue }
      $n = [regex]::Replace($n, ('^' + [regex]::Escape($key) + '\s*[-–:/]\s*'), '', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase).Trim()
    }
    if (-not $n -or $n -eq $nit) { continue }
    $digitCount = ([regex]::Matches($n, '\d')).Count
    $score = $n.Length - ($digitCount * 2)
    if ($score -gt $bestScore) {
      $bestScore = $score
      $best = $n
    }
  }
  if ($best) { return $best }
  if ($nit) { return $nit }
  return ''
}

function Extract-BitrixPhones($phoneField) {
  $vals = New-Object System.Collections.Generic.List[string]
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  if ($null -eq $phoneField) { return ,$vals }
  foreach ($it in (As-ObjectList $phoneField)) {
    $v = ''
    if ($null -eq $it) { continue }
    try {
      if ($null -ne $it.VALUE) { $v = [string]$it.VALUE }
      else { $v = [string]$it }
    } catch { $v = [string]$it }
    $v = ($v -replace '[\s\-]', '').Trim()
    if ($v.StartsWith('+57')) { $v = $v.Substring(3) }
    elseif ($v.StartsWith('0057')) { $v = $v.Substring(4) }
    elseif ($v -match '^57\d{7,10}$') { $v = $v.Substring(2) }
    if (-not $v) { continue }
    $key = ($v -replace '[^\d]', '')
    if (-not $key -or -not $seen.Add($key)) { continue }
    [void]$vals.Add($v)
  }
  return ,$vals
}

function Sync-AsesorClientesFromBitrix([string]$codigo, [bool]$force = $false, [bool]$cacheOnly = $false) {
  $code = Normalize-AsesorCodigo $codigo
  $empty = [ordered]@{
    clientes = @()
    synced = $false
    from_cache = $false
    error = ''
    fetched_at = ''
  }
  if (-not $code) {
    $empty.error = 'Código asesor vacío.'
    return $empty
  }
  if (-not (Test-Path $AsesorBitrixClientesCacheDir)) {
    New-Item -ItemType Directory -Path $AsesorBitrixClientesCacheDir -Force | Out-Null
  }
  $cachePath = Join-Path $AsesorBitrixClientesCacheDir ($code + '.json')
  if (-not $force -and (Test-Path $cachePath)) {
    try {
      $cached = (Get-Content $cachePath -Raw -Encoding UTF8) | ConvertFrom-Json
      $fetchedAt = [string]$cached.fetched_at
      $useCache = $false
      if ($fetchedAt) {
        $age = ((Get-Date) - [datetime]::Parse($fetchedAt)).TotalSeconds
        if ($age -ge 0 -and $age -lt $AsesorBitrixClientesTtlSec) { $useCache = $true }
      }
      # En listados rápidos: usar caché aunque esté vencida (sin pegarle a Bitrix).
      if ($useCache -or $cacheOnly) {
          $list = New-Object System.Collections.Generic.List[object]
          foreach ($c in (As-ObjectList $cached.clientes)) {
            if ($null -ne $c) { [void]$list.Add($c) }
          }
          return [ordered]@{
            clientes = @($list)
            synced = $true
            from_cache = $true
            error = ''
            fetched_at = $fetchedAt
        }
      }
    } catch {}
  }
  if ($cacheOnly) {
    return $empty
  }

  $cfg = Read-BitrixConfig
  if (-not $cfg.enabled -or -not $cfg.webhook_base) {
    $empty.error = 'Bitrix no configurado.'
    return $empty
  }
  $ids = @(Get-AsesorBitrixIds $code)
  if ($ids.Count -eq 0) {
    $empty.error = 'Asesor sin ID Bitrix mapeado.'
    return $empty
  }

  $byNit = @{}
  foreach ($assignedId in $ids) {
    $start = 0
    do {
      try {
        $resp = Invoke-BitrixRest $cfg.webhook_base 'crm.company.list.json' @{
          filter = @{ ASSIGNED_BY_ID = [int]$assignedId }
          select = @('ID', 'TITLE', 'ASSIGNED_BY_ID', 'PHONE', $BitrixCompanyNamePrimary, $BitrixCompanyNameFallback)
          order = @{ ID = 'ASC' }
          start = $start
        }
      } catch {
        $empty.error = $_.Exception.Message
        break
      }
      foreach ($co in (As-ObjectList $resp.result)) {
        if ($null -eq $co) { continue }
        $nit = Clean-BitrixCompanyNit ([string]$co.TITLE)
        if (-not $nit) { continue }
        $nombre = Get-BitrixCompanyDisplayName $co $nit
        $phones = @(Extract-BitrixPhones $co.PHONE)
        $telefono = if ($phones.Count) { ($phones -join ' / ') } else { '' }
        if (-not $byNit.ContainsKey($nit)) {
          $byNit[$nit] = [ordered]@{
            nit = $nit
            nombre = $(if ($nombre) { $nombre } else { $nit })
            telefono = $telefono
            manual = $false
            source = 'bitrix'
          }
        } else {
          $cur = ([string]$byNit[$nit].nombre).Trim()
          if ((-not $cur -or $cur -eq $nit) -and $nombre -and $nombre -ne $nit) {
            $byNit[$nit].nombre = $nombre
          }
          if (-not ([string]$byNit[$nit].telefono).Trim() -and $telefono) {
            $byNit[$nit].telefono = $telefono
          }
        }
      }
      if ($null -ne $resp.next) { $start = [int]$resp.next } else { $start = -1 }
    } while ($start -ge 0)
  }

  $clientes = @($byNit.Values | Sort-Object { $_.nombre })
  $fetchedAt = (Get-Date).ToString('o')
  $payload = [ordered]@{
    fetched_at = $fetchedAt
    codigo = $code
    bitrix_ids = @($ids)
    count = $clientes.Count
    clientes = $clientes
  }
  try {
    ($payload | ConvertTo-Json -Depth 8) | Set-Content -Path $cachePath -Encoding UTF8
  } catch {}

  # Actualiza solo este asesor en el índice.
  try {
    $idx = $null
    if (Test-Path $AsesorClientesIndexFile) {
      $idx = (Get-Content $AsesorClientesIndexFile -Raw -Encoding UTF8) | ConvertFrom-Json
    }
    if ($null -eq $idx) { $idx = [pscustomobject]@{ by_codigo = [pscustomobject]@{} } }
    if ($null -eq $idx.by_codigo) { $idx | Add-Member -NotePropertyName by_codigo -NotePropertyValue ([pscustomobject]@{}) -Force }
    $prevIds = @($ids)
    try {
      $prop = $idx.by_codigo.PSObject.Properties[$code]
      if ($null -ne $prop -and $null -ne $prop.Value.bitrix_ids) {
        $prevIds = @($prop.Value.bitrix_ids)
      }
    } catch {}
    $entry = [ordered]@{
      bitrix_ids = $prevIds
      count = $clientes.Count
      clientes = @($clientes | ForEach-Object {
        [ordered]@{ nit = $_.nit; nombre = $_.nombre; telefono = $_.telefono }
      })
    }
    $idx.by_codigo | Add-Member -NotePropertyName $code -NotePropertyValue $entry -Force
    $idx | Add-Member -NotePropertyName built_at -NotePropertyValue $fetchedAt -Force
    $idx | Add-Member -NotePropertyName source -NotePropertyValue 'bitrix live sync + bitrix_vendedores.json' -Force
    ($idx | ConvertTo-Json -Depth 12) | Set-Content -Path $AsesorClientesIndexFile -Encoding UTF8
  } catch {}

  return [ordered]@{
    clientes = $clientes
    synced = $true
    from_cache = $false
    error = [string]$empty.error
    fetched_at = $fetchedAt
  }
}

function Get-AsesorNitSet([string]$codigo, [bool]$cacheOnly = $true) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  $all = New-Object System.Collections.Generic.List[object]
  foreach ($c in (Get-AsesorClientes $codigo)) { if ($null -ne $c) { [void]$all.Add($c) } }
  foreach ($c in (Get-AsesorClientesManual $codigo)) { if ($null -ne $c) { [void]$all.Add($c) } }
  # Incluir clientes Bitrix desde caché (no live en rutas de listado/guardar).
  try {
    $sync = Sync-AsesorClientesFromBitrix $codigo $false $cacheOnly
    foreach ($c in (As-ObjectList $sync.clientes)) {
      if ($null -ne $c) { [void]$all.Add($c) }
    }
  } catch {}
  foreach ($c in $all) {
    $nit = Normalize-Nit ([string]$c.nit)
    if ($nit) { [void]$set.Add($nit) }
    $digits = ($nit -replace '[^\d]', '')
    if ($digits) {
      [void]$set.Add($digits)
      $noZeros = $digits.TrimStart('0')
      if ($noZeros) { [void]$set.Add($noZeros) }
    }
  }
  return $set
}

function Clear-AsesorBitrixClientesCache([string]$codigo) {
  $code = Normalize-AsesorCodigo $codigo
  if (-not $code) { return }
  $cachePath = Join-Path $AsesorBitrixClientesCacheDir ($code + '.json')
  if (Test-Path $cachePath) {
    try { Remove-Item -LiteralPath $cachePath -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Upsert-AsesorClienteManual([string]$codigo, [string]$clientNit, [string]$nombre, [string]$telefono = '') {
  $codigo = Normalize-AsesorCodigo $codigo
  $clientNit = Normalize-Nit $clientNit
  $nombre = ([string]$nombre).Trim()
  $telefono = Normalize-TelefonoDisplay $telefono
  if (-not $codigo -or -not $clientNit) {
    return [ordered]@{ ok = $false; updated = $false; error = 'Falta código o NIT.' }
  }
  if (-not $nombre) { $nombre = $clientNit }

  $data = Read-AsesorClientesManual
  if (-not ($data.by_codigo -is [System.Collections.IDictionary])) {
    $data = [ordered]@{ by_codigo = [ordered]@{} }
  }
  if (-not $data.by_codigo.Contains($codigo)) {
    $data.by_codigo[$codigo] = New-Object System.Collections.Generic.List[object]
  }
  $list = New-Object System.Collections.Generic.List[object]
  foreach ($row in (As-ObjectList $data.by_codigo[$codigo])) {
    if ($null -ne $row) { [void]$list.Add($row) }
  }
  $updated = $false
  $savedAt = (Get-Date).ToString('o')
  $newList = New-Object System.Collections.Generic.List[object]
  foreach ($row in $list) {
    $rowNit = Normalize-Nit ([string]$row.nit)
    if ($rowNit -eq $clientNit) {
      $copy = [ordered]@{
        nit = $clientNit
        nombre = $nombre
        telefono = $(if ($telefono) { $telefono } else { Normalize-TelefonoDisplay ([string]$row.telefono) })
        created_at = [string]$row.created_at
        created_by = [string]$row.created_by
        updated_at = $savedAt
        updated_by = $codigo
      }
      [void]$newList.Add($copy)
      $updated = $true
    } else {
      [void]$newList.Add($row)
    }
  }
  if (-not $updated) {
    [void]$newList.Add([ordered]@{
      nit = $clientNit
      nombre = $nombre
      telefono = $telefono
      created_at = $savedAt
      created_by = $codigo
    })
  }
  $data.by_codigo[$codigo] = $newList
  Write-AsesorClientesManual $data
  $script:AsesorCodigoByNitCache = $null
  return [ordered]@{ ok = $true; updated = $updated; error = '' }
}

function Get-QuoteAsesorEstado($quote) {
  $e = ([string]$quote.asesor_estado).Trim().ToLowerInvariant()
  if ($e -eq 'nueva' -or $e -eq 'nuevo' -or $e -eq 'new') { return 'nueva' }
  if ($e -eq 'pendiente' -or $e -eq 'pending') { return 'pendiente' }
  if ($e -eq 'seguimiento' -or $e -eq 'follow' -or $e -eq 'followup') { return 'seguimiento' }
  if ($e -eq 'vendido' -or $e -eq 'venta' -or $e -eq 'sold') { return 'vendido' }
  if ($e -eq 'perdida' -or $e -eq 'perdido' -or $e -eq 'lost') { return 'perdida' }
  if ($e -eq 'cerrado_modificado' -or $e -eq 'cerrado-modificado' -or $e -eq 'cerradomodificado') { return 'cerrado_modificado' }
  if ($e -eq 'cotizado' -or $e -eq 'cotizada') { return 'cotizado' }
  # Cotizaciones antiguas sin campo: ya viven en el historial como Cotizado.
  return 'cotizado'
}

function Test-QuoteIsMadeByCliente($q) {
  if ($null -eq $q) { return $false }
  $src = ([string]$q.quote_source).Trim().ToLowerInvariant()
  if ($src -in @('zkteco','asesor','zebra','gp','sat','bitrix','izc')) { return $false }
  $nit = ([string]$q.nit -replace '[\s.]', '').ToUpperInvariant()
  $seller = ([string]$(if ($q.seller_codigo) { $q.seller_codigo } elseif ($q.asesor_cotizado_by) { $q.asesor_cotizado_by } else { $q.finished_by }) -replace '[\s.]', '').ToUpperInvariant()
  if ($nit -in @('ZKTECO','SAT','ADMINSAT') -or $seller -in @('ZKTECO','SAT','ADMINSAT')) { return $false }
  if ($nit -match '^GP\d{1,4}$' -or $seller -match '^GP\d{1,4}$') { return $false }
  if ($src -eq 'cliente' -or $src -eq 'portal') { return $true }
  # Legado: save_quote del portal siempre pide fecha_cierre_cliente.
  if (([string]$q.fecha_cierre_cliente).Trim() -ne '') {
    $by = ([string]$(if ($q.asesor_cotizado_by) { $q.asesor_cotizado_by } else { $q.finished_by }) -replace '[\s.]', '').ToUpperInvariant()
    if ($by -and $by -ne 'CLIENTE') { return $false }
    return $true
  }
  return $false
}

function Get-QuoteEffectiveNit($q) {
  $nit = Normalize-Nit ([string]$q.nit)
  if ($nit) { return $nit }
  $id = [string]$q.id
  if ($id -match '-(\d{6,15})$') { return (Normalize-Nit $Matches[1]) }
  return ''
}

function Test-QuoteIsClienteNuevaForAsesor($q, $nitSet) {
  if ($null -eq $q) { return $false }
  if (([string]$q.asesor_cotizado_at).Trim() -ne '') { return $false }
  if (([string]$q.finished_at).Trim() -ne '') { return $false }
  $raw = ([string]$q.asesor_estado).Trim().ToLowerInvariant()
  if ($raw -ne '' -and $raw -ne 'nueva' -and $raw -ne 'nuevo' -and $raw -ne 'new') { return $false }
  if (-not (Test-QuoteIsMadeByCliente $q)) { return $false }
  return (Test-NitInSet (Get-QuoteEffectiveNit $q) $nitSet)
}

function Find-LatestClienteNuevaQuoteId($quotes, [string]$codigo, [string]$clientNit) {
  $want = Normalize-Nit $clientNit
  if (-not $want) { return '' }
  $nitSet = Get-AsesorNitSet $codigo $true
  $bestId = ''
  $bestAt = ''
  foreach ($q in (As-ObjectList $quotes)) {
    if ($null -eq $q) { continue }
    if (-not (Test-QuoteIsClienteNuevaForAsesor $q $nitSet)) { continue }
    if ((Get-QuoteEffectiveNit $q) -ne $want) { continue }
    $id = ([string]$q.id).Trim()
    if (-not $id) { continue }
    $at = [string]$q.created_at
    if (-not $bestId -or $at -gt $bestAt) {
      $bestId = $id
      $bestAt = $at
    }
  }
  return $bestId
}

function Normalize-QuotePipelineEstado([string]$raw) {
  $e = ([string]$raw).Trim().ToLowerInvariant()
  if ($e -eq 'pendiente' -or $e -eq 'pending') { return 'pendiente' }
  if ($e -eq 'seguimiento' -or $e -eq 'follow' -or $e -eq 'followup') { return 'seguimiento' }
  if ($e -eq 'vendido' -or $e -eq 'venta' -or $e -eq 'sold') { return 'vendido' }
  if ($e -eq 'perdida' -or $e -eq 'perdido' -or $e -eq 'lost') { return 'perdida' }
  if ($e -eq 'cerrado_modificado' -or $e -eq 'cerrado-modificado' -or $e -eq 'cerradomodificado') { return 'cerrado_modificado' }
  if ($e -eq 'cotizado' -or $e -eq 'cotizada') { return 'cotizado' }
  return ''
}

function Test-QuoteIsDuplicated($q) {
  if ($null -eq $q) { return $false }
  if ($q.is_duplicated -eq $true -or [string]$q.is_duplicated -eq 'True' -or [string]$q.is_duplicated -eq '1') { return $true }
  if ($q.duplicated -eq $true -or [string]$q.duplicated -eq 'True' -or [string]$q.duplicated -eq '1') { return $true }
  $from = [string]($(if ($q.duplicated_from) { $q.duplicated_from } elseif ($q.recotizado_desde) { $q.recotizado_desde } else { '' })).Trim()
  return ($from -ne '')
}

function Test-QuoteIsAdvisorRecotizada($q) {
  if ($null -eq $q) { return $false }
  $src = [string]$q.quote_source
  if ($src -ne 'asesor') { return $false }
  if ([string]$q.recotizado_by) { return $true }
  if ([string]$q.recotizado_at) { return $true }
  if ([string]$q.recotizado_desde) { return $true }
  $from = [string]($(if ($q.duplicated_from) { $q.duplicated_from } else { '' })).Trim()
  if ($from -eq '') { return $false }
  # No contar marcas automáticas Bitrix.
  if ([string]$q.duplicate_kind -eq 'bitrix_same_amount') { return $false }
  return $true
}

function Test-QuoteInDuplicadasPanel($q) {
  return (Test-QuoteIsAdvisorRecotizada $q)
}

function Get-QuoteDuplicateMoneyKey($q) {
  $totals = $null
  try { $totals = $q.totals } catch {}
  $usd = 0.0
  $cop = 0.0
  $trm = 0.0
  try { if ($null -ne $totals -and $null -ne $totals.usdIva) { $usd = [double]$totals.usdIva } } catch {}
  if ($usd -le 0) { try { if ($null -ne $totals -and $null -ne $totals.usd) { $usd = [double]$totals.usd } } catch {} }
  try { if ($null -ne $totals -and $null -ne $totals.copIva) { $cop = [double]$totals.copIva } } catch {}
  if ($cop -le 0) { try { if ($null -ne $totals -and $null -ne $totals.cop) { $cop = [double]$totals.cop } } catch {} }
  try { if ($null -ne $q.trm) { $trm = [double]$q.trm } } catch {}
  if ($trm -le 0) { try { if ($null -ne $totals -and $null -ne $totals.trm) { $trm = [double]$totals.trm } } catch {} }
  if ($usd -gt 0) { return ('USD:{0:F1}' -f [math]::Round($usd, 1)) }
  if ($cop -gt 0 -and $trm -gt 1000) { return ('USD:{0:F1}' -f [math]::Round(($cop / $trm), 1)) }
  if ($cop -gt 0) { return ('COP:{0}' -f ([int][math]::Round($cop / 10.0) * 10)) }
  return ''
}

# Remarca duplicadas Bitrix (mismo vendedor+NIT+monto) y persiste si hubo cambios.
function Repair-AsesorDuplicateFlags([bool]$force = $false) {
  $flag = Join-Path $Root 'data\.quotes_dup_mark_at'
  if (-not $force -and (Test-Path -LiteralPath $flag)) {
    try {
      $age = ((Get-Date) - (Get-Item -LiteralPath $flag).LastWriteTime).TotalSeconds
      if ($age -ge 0 -and $age -lt 120) { return 0 }
    } catch {}
  }
  $quotes = New-Object System.Collections.Generic.List[object]
  foreach ($q in (As-ObjectList (Read-Quotes))) {
    if ($null -ne $q) { [void]$quotes.Add($q) }
  }
  # Limpiar marcas auto (conserva recotizaciones asesor)
  foreach ($q in $quotes) {
    if (Test-QuoteIsAdvisorRecotizada $q) { continue }
    try {
      if ($q.PSObject.Properties.Name -contains 'duplicated_from') { $q.PSObject.Properties.Remove('duplicated_from') }
    } catch { try { $q.duplicated_from = $null } catch {} }
    try {
      if ($q.PSObject.Properties.Name -contains 'is_duplicated') { $q.PSObject.Properties.Remove('is_duplicated') }
    } catch { try { $q.is_duplicated = $false } catch {} }
    try {
      if ($q.PSObject.Properties.Name -contains 'duplicated') { $q.PSObject.Properties.Remove('duplicated') }
    } catch {}
    try {
      if ($q.PSObject.Properties.Name -contains 'duplicate_kind') { $q.PSObject.Properties.Remove('duplicate_kind') }
    } catch {}
  }

  $groups = @{}
  for ($i = 0; $i -lt $quotes.Count; $i++) {
    $q = $quotes[$i]
    if ($null -eq $q) { continue }
    if ($q.asesor_eliminada -eq $true) { continue }
    if (Test-QuoteIsAdvisorRecotizada $q) { continue }
    $seller = Normalize-AsesorCodigo ([string]$q.seller_codigo)
    $nit = ([string]$q.nit) -replace '\D', ''
    $mk = Get-QuoteDuplicateMoneyKey $q
    if (-not $seller -or -not $nit -or -not $mk) { continue }
    $key = "$seller|$nit|$mk"
    if (-not $groups.ContainsKey($key)) { $groups[$key] = New-Object System.Collections.Generic.List[int] }
    [void]$groups[$key].Add($i)
  }

  $changed = 0
  foreach ($key in $groups.Keys) {
    $idxs = @($groups[$key])
    if ($idxs.Count -lt 2) { continue }
    $sorted = $idxs | Sort-Object {
      $qq = $quotes[$_]
      $pref = 0
      $id = [string]$qq.id
      if ($id.StartsWith('bx')) { $pref = 1 }
      '{0}|{1}|{2}' -f [string]$qq.created_at, $pref, $id
    }
    $canon = $quotes[$sorted[0]]
    $cid = [string]$canon.id
    if (-not $cid) { continue }
    for ($n = 1; $n -lt $sorted.Count; $n++) {
      $q = $quotes[$sorted[$n]]
      if (Test-QuoteIsAdvisorRecotizada $q) { continue }
      $q | Add-Member -NotePropertyName is_duplicated -NotePropertyValue $true -Force
      $q | Add-Member -NotePropertyName duplicated_from -NotePropertyValue $cid -Force
      $q | Add-Member -NotePropertyName duplicate_kind -NotePropertyValue 'bitrix_same_amount' -Force
      $changed++
    }
  }
  if ($changed -gt 0) {
    Write-Quotes $quotes.ToArray()
  }
  try {
    Set-Content -LiteralPath $flag -Value ((Get-Date).ToString('o')) -Encoding UTF8
  } catch {}
  return $changed
}

function Parse-TrmFromBitrixComments([string]$comments) {
  if (-not $comments) { return 0.0 }
  $m = [regex]::Match($comments, 'TRM:\s*([\d.,]+)', 'IgnoreCase')
  if (-not $m.Success) { return 0.0 }
  $raw = [string]$m.Groups[1].Value
  try {
    if ($raw.Contains(',') -and $raw.Contains('.')) {
      if ($raw.LastIndexOf(',') -gt $raw.LastIndexOf('.')) {
        $raw = $raw.Replace('.', '').Replace(',', '.')
      } else {
        $raw = $raw.Replace(',', '')
      }
    } else {
      $raw = $raw.Replace(',', '.')
    }
    $v = [double]$raw
    if ($v -gt 0) { return $v }
  } catch {}
  return 0.0
}

function Convert-QuoteToAsesorDetailRow($q, [string]$estado) {
  $items = New-Object System.Collections.ArrayList
  if ($null -ne $q.items) {
    foreach ($it in (As-ObjectList $q.items)) {
      if ($null -ne $it) { [void]$items.Add($it) }
    }
  }
  $empresa = [string]$q.empresa
  if (-not $empresa -and $null -ne $q.totals -and $q.totals.empresa) {
    $empresa = [string]$q.totals.empresa
  }
  $totals = if ($null -ne $q.totals) { $q.totals } else { @{} }
  return [ordered]@{
    id = [string]$q.id
    nit = [string]$q.nit
    nombre = [string]$q.nombre
    created_at = [string]$q.created_at
    trm = $q.trm
    items = $items
    totals = $totals
    empresa = $empresa
    bitrix_deal_id = [string]$q.bitrix_deal_id
    seller_codigo = Normalize-AsesorCodigo ([string]$q.seller_codigo)
    assigned_by_id = [string]$q.assigned_by_id
    seller_name = [string]$q.seller_name
    asesor_estado = $estado
    asesor_cotizado_at = [string]$q.asesor_cotizado_at
    asesor_comentario = [string]$q.asesor_comentario
    asesor_comentario_at = [string]$q.asesor_comentario_at
    asesor_comentario_by = [string]$q.asesor_comentario_by
    fecha_cierre = [string]$q.fecha_cierre
    fecha_cierre_cliente = [string]$q.fecha_cierre_cliente
    is_duplicated = [bool](Test-QuoteIsDuplicated $q)
    duplicated_from = [string]($(if ($q.duplicated_from) { $q.duplicated_from } elseif ($q.recotizado_desde) { $q.recotizado_desde } else { '' }))
    recotizado_desde = [string]($(if ($q.recotizado_desde) { $q.recotizado_desde } elseif ($q.duplicated_from) { $q.duplicated_from } else { '' }))
    quote_source = [string]$q.quote_source
    synced_from_bitrix = [bool]$q.synced_from_bitrix
  }
}

function Test-QuoteItemsArePlaceholder($q) {
  $items = @(As-ObjectList $q.items)
  if ($items.Count -le 0) { return $true }
  foreach ($it in $items) {
    if ($null -eq $it) { continue }
    $sku = ([string]$it.sku).Trim()
    if ($sku) { return $false }
    $name = ([string]($(if ($it.name) { $it.name } elseif ($it.descripcion) { $it.descripcion } else { '' }))).Trim().ToLowerInvariant()
    if ($name -and $name -notmatch 'productos\s+cotizados' -and $name -ne '—' -and $name -ne '-') {
      return $false
    }
  }
  return $true
}

function Prepare-QuoteForDisplay($q, [bool]$tryBitrix = $false) {
  if ($null -eq $q) { return $false }
  $changed = $false
  $trmEntry = Read-Trm
  $defaultTrm = 3204.0
  try {
    if ($null -ne $trmEntry -and $null -ne $trmEntry.value -and [double]$trmEntry.value -gt 0) {
      $defaultTrm = [double]$trmEntry.value
    }
  } catch {}

  $empresa = [string]$q.empresa
  if (-not $empresa -and $null -ne $q.totals -and $q.totals.empresa) {
    $empresa = [string]$q.totals.empresa
  }
  if ($empresa -and -not $q.empresa) {
    $q | Add-Member -NotePropertyName empresa -NotePropertyValue $empresa -Force
    $changed = $true
  }

  $needTrm = $true
  try { if ($null -ne $q.trm -and [double]$q.trm -gt 0) { $needTrm = $false } } catch {}
  $needItems = Test-QuoteItemsArePlaceholder $q

  if ($tryBitrix -and ($needTrm -or $needItems)) {
    $dealId = ([string]$q.bitrix_deal_id).Trim()
    $cfg = $null
    try { $cfg = Read-BitrixConfig } catch { $cfg = $null }
    if ($dealId -and $null -ne $cfg -and $cfg.enabled -and $cfg.webhook_base) {
      $comments = ''
      try {
        $deal = Invoke-BitrixRest $cfg.webhook_base 'crm.deal.get.json' @{ id = [int]$dealId }
        if ($null -ne $deal.result) { $comments = [string]$deal.result.COMMENTS }
      } catch {}
      if ($needTrm -and $comments) {
        $parsedTrm = Parse-TrmFromBitrixComments $comments
        if ($parsedTrm -gt 0) {
          $q | Add-Member -NotePropertyName trm -NotePropertyValue $parsedTrm -Force
          $needTrm = $false
          $changed = $true
        }
      }
      if ($needItems) {
        try {
          $prod = Invoke-BitrixRest $cfg.webhook_base 'crm.deal.productrows.get.json' @{ id = [int]$dealId }
          $rows = @()
          if ($null -ne $prod.result) { $rows = @($prod.result) }
          if ($rows.Count -gt 0) {
            $newItems = New-Object System.Collections.ArrayList
            $sumUsd = 0.0
            $sumQty = 0.0
            foreach ($row in $rows) {
              if ($null -eq $row) { continue }
              $productName = [string]$row.PRODUCT_NAME
              $sku = ''
              $name = $productName
              if ($productName -match '^([^\-]+)-(.+)$') {
                $sku = $Matches[1].Trim()
                $name = $Matches[2].Trim()
              }
              $qty = 1.0
              try { if ($null -ne $row.QUANTITY -and [double]$row.QUANTITY -gt 0) { $qty = [double]$row.QUANTITY } } catch {}
              $price = 0.0
              try { if ($null -ne $row.PRICE) { $price = [double]$row.PRICE } } catch {}
              $cur = 'USD'
              try {
                $dealCur = ''
                if ($comments -match 'Total USD') { $cur = 'USD' }
                elseif ($null -ne $q.totals -and $q.totals.hasUsd -eq $true) { $cur = 'USD' }
                elseif ($null -ne $q.totals -and $q.totals.hasCop -eq $true) { $cur = 'COP' }
              } catch {}
              $item = [ordered]@{
                sku = $sku
                name = $(if ($name) { $name } else { $sku })
                referencia = $(if ($name) { $name } else { $sku })
                qty = $qty
                currency = $cur
              }
              if ($cur -eq 'USD') {
                $item.usdIva = $price
                $item.totalUsdIva = $price * $qty
                $sumUsd += ($price * $qty)
              } else {
                $item.copIva = $price
                $item.totalCopIva = $price * $qty
              }
              $sumQty += $qty
              [void]$newItems.Add($item)
            }
            if ($newItems.Count -gt 0) {
              $q | Add-Member -NotePropertyName items -NotePropertyValue $newItems -Force
              $t = if ($null -ne $q.totals) { $q.totals } else { [ordered]@{} }
              if ($sumUsd -gt 0) {
                try { $t | Add-Member -NotePropertyName usdIva -NotePropertyValue $sumUsd -Force } catch { $t.usdIva = $sumUsd }
                try { $t | Add-Member -NotePropertyName hasUsd -NotePropertyValue $true -Force } catch { $t.hasUsd = $true }
              }
              try { $t | Add-Member -NotePropertyName qty -NotePropertyValue $sumQty -Force } catch { $t.qty = $sumQty }
              if ($empresa) {
                try { $t | Add-Member -NotePropertyName empresa -NotePropertyValue $empresa -Force } catch { $t.empresa = $empresa }
              }
              $q | Add-Member -NotePropertyName totals -NotePropertyValue $t -Force
              $needItems = $false
              $changed = $true
            }
          }
        } catch {}
      }
    }
  }

  if ($needTrm -and $defaultTrm -gt 0) {
    $q | Add-Member -NotePropertyName trm -NotePropertyValue $defaultTrm -Force
    $changed = $true
  }
  return $changed
}

function Convert-QuoteToAsesorListRow($q, [string]$estado) {
  $totalsObj = if ($null -ne $q.totals) { $q.totals } else { $null }
  $productCount = 0
  $sumUsd = 0.0
  $sumCop = 0.0
  if ($null -ne $q.items) {
    foreach ($it in (As-ObjectList $q.items)) {
      if ($null -eq $it) { continue }
      $productCount++
      $cur = ([string]$it.currency).ToUpperInvariant()
      $lineUsd = 0.0
      $lineCop = 0.0
      try {
        if ($null -ne $it.totalUsdIva) { $lineUsd = [double]$it.totalUsdIva }
        elseif ($null -ne $it.usdIva) { $lineUsd = [double]$it.usdIva }
        elseif ($null -ne $it.totalUsd) { $lineUsd = [double]$it.totalUsd }
        elseif ($null -ne $it.usd) { $lineUsd = [double]$it.usd }
      } catch {}
      try {
        if ($null -ne $it.totalCopIva) { $lineCop = [double]$it.totalCopIva }
        elseif ($null -ne $it.copIva) { $lineCop = [double]$it.copIva }
        elseif ($null -ne $it.totalCop) { $lineCop = [double]$it.totalCop }
        elseif ($null -ne $it.cop) { $lineCop = [double]$it.cop }
      } catch {}
      if ($cur -eq 'COP') { $sumCop += $lineCop }
      elseif ($cur -eq 'USD') { $sumUsd += $lineUsd }
      else {
        if ($lineCop -gt 0) { $sumCop += $lineCop }
        if ($lineUsd -gt 0) { $sumUsd += $lineUsd }
      }
    }
  }
  $qtyTotal = 0
  if ($null -ne $totalsObj -and $null -ne $totalsObj.qty) {
    try { $qtyTotal = [int][math]::Round([double]$totalsObj.qty) } catch { $qtyTotal = 0 }
  }
  if ($qtyTotal -gt $productCount) { $productCount = $qtyTotal }
  $empresa = [string]$q.empresa
  if (-not $empresa -and $null -ne $totalsObj -and $totalsObj.empresa) {
    $empresa = [string]$totalsObj.empresa
  }
  $usdIva = $null
  $copIva = $null
  $usd = $null
  $cop = $null
  $totalConFlete = $null
  if ($null -ne $totalsObj) {
    try { if ($null -ne $totalsObj.usdIva -and [double]$totalsObj.usdIva -gt 0) { $usdIva = [double]$totalsObj.usdIva } } catch {}
    try { if ($null -ne $totalsObj.copIva -and [double]$totalsObj.copIva -gt 0) { $copIva = [double]$totalsObj.copIva } } catch {}
    try { if ($null -ne $totalsObj.usd -and [double]$totalsObj.usd -gt 0) { $usd = [double]$totalsObj.usd } } catch {}
    try { if ($null -ne $totalsObj.cop -and [double]$totalsObj.cop -gt 0) { $cop = [double]$totalsObj.cop } } catch {}
    try { if ($null -ne $totalsObj.totalConFlete -and [double]$totalsObj.totalConFlete -gt 0) { $totalConFlete = [double]$totalsObj.totalConFlete } } catch {}
  }
  if ($sumUsd -gt 0) { $usdIva = $sumUsd }
  if ($sumCop -gt 0) { $copIva = $sumCop }
  $hasUsd = $false
  $hasCop = $false
  if ($null -ne $usdIva -or $null -ne $usd) { $hasUsd = $true }
  if ($null -ne $copIva -or $null -ne $cop -or $null -ne $totalConFlete) { $hasCop = $true }
  if ($null -ne $totalsObj) {
    try { if ($totalsObj.hasUsd -eq $true) { $hasUsd = $true } } catch {}
    try { if ($totalsObj.hasCop -eq $true) { $hasCop = $true } } catch {}
  }
  if ($hasUsd -and $null -eq $usdIva -and $null -ne $usd) { $usdIva = $usd }
  if ($hasCop -and $null -eq $copIva -and $null -ne $cop) { $copIva = $cop }
  $lightTotals = [ordered]@{
    cop = $cop
    copIva = $copIva
    usd = $usd
    usdIva = $usdIva
    totalConFlete = $totalConFlete
    qty = $(if ($qtyTotal -gt 0) { $qtyTotal } elseif ($null -ne $totalsObj) { $totalsObj.qty } else { $null })
    hasCop = $hasCop
    hasUsd = $hasUsd
    empresa = $empresa
  }
  $totalUsd = $null
  $totalCop = $null
  if ($null -ne $usdIva) { $totalUsd = [math]::Round([double]$usdIva, 4) }
  if ($null -ne $copIva) { $totalCop = [math]::Round([double]$copIva, 2) }
  elseif ($null -ne $totalConFlete) { $totalCop = [math]::Round([double]$totalConFlete, 2) }
  $totalParts = New-Object System.Collections.Generic.List[string]
  if ($null -ne $totalUsd) {
    $totalParts.Add(('USD {0:N2}' -f $totalUsd))
  }
  if ($null -ne $totalCop) {
    $totalParts.Add(('$ {0:N2} COP' -f $totalCop))
  }
  return [ordered]@{
    id = [string]$q.id
    nit = [string]$q.nit
    nombre = [string]$q.nombre
    created_at = [string]$q.created_at
    empresa = $empresa
    bitrix_deal_id = [string]$q.bitrix_deal_id
    seller_codigo = Normalize-AsesorCodigo ([string]$q.seller_codigo)
    assigned_by_id = [string]$q.assigned_by_id
    seller_name = [string]$q.seller_name
    asesor_estado = $estado
    asesor_cotizado_at = [string]$q.asesor_cotizado_at
    asesor_comentario = [string]$q.asesor_comentario
    fecha_cierre = [string]$q.fecha_cierre
    fecha_cierre_cliente = [string]$q.fecha_cierre_cliente
    is_duplicated = [bool](Test-QuoteIsDuplicated $q)
    duplicated_from = [string]($(if ($q.duplicated_from) { $q.duplicated_from } elseif ($q.recotizado_desde) { $q.recotizado_desde } else { '' }))
    recotizado_desde = [string]($(if ($q.recotizado_desde) { $q.recotizado_desde } elseif ($q.duplicated_from) { $q.duplicated_from } else { '' }))
    duplicate_kind = [string]$q.duplicate_kind
    quote_source = [string]$q.quote_source
    product_count = $productCount
    items_count = $productCount
    total_usd = $totalUsd
    total_cop = $totalCop
    total_display = [string]($totalParts -join ' · ')
    totals = $lightTotals
  }
}

function Test-QuoteHasPricedDeal($quote) {
  if ($null -eq $quote) { return $false }
  $tot = $null
  try { $tot = $quote.totals } catch {}
  if ($null -ne $tot) {
    foreach ($k in @('usdIva', 'copIva', 'totalConFlete', 'usd', 'cop', 'totalUsdIva', 'totalCopIva')) {
      try {
        $raw = $tot.$k
        if ($null -eq $raw -or [string]$raw -eq '') { continue }
        if ([double]$raw -gt 0) { return $true }
      } catch {}
    }
  }
  foreach ($line in (As-ObjectList $quote.items)) {
    if ($null -eq $line) { continue }
    foreach ($k in @('usdIva', 'copIva', 'totalUsdIva', 'totalCopIva', 'usd', 'cop', 'unitario_usd', 'unitario_cop', 'price', 'PRICE')) {
      try {
        $raw = $line.$k
        if ($null -eq $raw -or [string]$raw -eq '') { continue }
        if ([double]$raw -gt 0) { return $true }
      } catch {}
    }
  }
  return $false
}

function Test-OrphanBitrixDealQuote($quote) {
  if ($null -eq $quote) { return $false }
  $nombre = ([string]$quote.nombre).Trim()
  if ($nombre -match '^Deal\s+\d+') { return $true }
  $nitDigits = (([string]$quote.nit) -replace '[^\d]', '')
  $id = ([string]$quote.id).Trim()
  $isBx = ($id -match '^bx[-_]') -or
    ($quote.synced_from_bitrix -eq $true) -or
    ([string]$quote.synced_from_bitrix -eq 'True') -or
    ([string]$quote.synced_from_bitrix -eq '1') -or
    ([string]$quote.bitrix_deal_id).Trim()
  if ($isBx -and (-not $nitDigits -or $nitDigits -eq '0')) { return $true }
  return $false
}

function Get-QuotesForAsesor([string]$codigo, [string]$filtro = 'all', $opts = $null) {
  $code = Normalize-AsesorCodigo $codigo
  $want = ([string]$filtro).Trim().ToLowerInvariant()
  if ($want -eq 'nuevo' -or $want -eq 'new') { $want = 'nuevas' }
  if ($want -eq 'historial' -or $want -eq 'cotizado' -or $want -eq 'cotizados') { $want = 'historial' }
  if ($want -eq 'duplicada' -or $want -eq 'duplicated') { $want = 'duplicadas' }
  if ($want -ne 'nuevas' -and $want -ne 'historial' -and $want -ne 'duplicadas') { $want = 'all' }

  $listOnly = $false
  $bundleMode = $false
  if ($null -ne $opts) {
    try {
      if ($opts.list_only -or $opts['list_only']) { $listOnly = $true }
    } catch {}
    try {
      if ($opts.bundle -or $opts['bundle']) { $bundleMode = $true; $listOnly = $true }
    } catch {}
  }

  $nitSet = Get-AsesorNitSet $code $true
  $bitrixIds = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($id in (Get-AsesorBitrixIds $code)) {
    if ($id) { [void]$bitrixIds.Add([string]$id) }
  }
  $safe = New-Object System.Collections.Generic.List[object]
  $bucketHistorial = New-Object System.Collections.Generic.List[object]
  $bucketNuevas = New-Object System.Collections.Generic.List[object]
  $bucketDuplicadas = New-Object System.Collections.Generic.List[object]
  $countNuevas = 0
  $countHistorial = 0
  $countDuplicadas = 0
  $countMatched = 0
  $quotesInFile = 0
  foreach ($q in (As-ObjectList (Read-Quotes))) {
    $quotesInFile++
    if ($null -eq $q) { continue }
    $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
    if (-not $sellerCode) { $sellerCode = Normalize-AsesorCodigo ([string]$q.asesor_cotizado_by) }
    $assigned = [string]$q.assigned_by_id
    $match = $false
    if ($sellerCode -and $sellerCode -eq $code) { $match = $true }
    elseif ($assigned -and $bitrixIds.Contains($assigned)) { $match = $true }
    else {
      foreach ($field in @('asesor_estado_by','asesor_comentario_by','empresa_editado_by','recotizado_by','flete_editado_by','fecha_cierre_by')) {
        try {
          $by = Normalize-AsesorCodigo ([string]$q.$field)
          if ($by -and $by -eq $code) { $match = $true; break }
        } catch {}
      }
    }
    if (-not $match) {
      $effNit = [string]$q.nit
      if (-not $effNit -and [string]$q.id -match '-(\d{6,15})$') { $effNit = $Matches[1] }
      if (Test-NitInSet $effNit $nitSet) { $match = $true }
    }
    if (-not $match) { continue }
    $countMatched++
    if ($q.asesor_eliminada -eq $true -or [string]$q.asesor_eliminada -eq 'True' -or [string]$q.asesor_eliminada -eq '1') {
      continue
    }
    if (-not (Test-QuoteHasPricedDeal $q)) {
      continue
    }
    if (Test-OrphanBitrixDealQuote $q) {
      continue
    }
    $estado = Get-QuoteAsesorEstado $q
    $isNueva = (Test-QuoteIsClienteNuevaForAsesor $q $nitSet)
    $isDuplicada = (Test-QuoteInDuplicadasPanel $q)
    if ($isNueva) { $countNuevas++ }
    if ($isDuplicada) { $countDuplicadas++ }
    # Historial = cotizaciones del asesor (no las que armó el cliente y siguen pendientes).
    if (-not $isNueva) { $countHistorial++ }
    if ($want -eq 'nuevas' -and -not $isNueva) { continue }
    if ($want -eq 'duplicadas' -and -not $isDuplicada) { continue }
    if ($want -eq 'historial' -and $isNueva) { continue }
    # historial / all: incluir todo (salvo nuevas en historial)

    if ($listOnly) {
      $row = Convert-QuoteToAsesorListRow $q $estado
    } else {
    $items = New-Object System.Collections.ArrayList
    if ($null -ne $q.items) {
      foreach ($it in (As-ObjectList $q.items)) {
        if ($null -ne $it) { [void]$items.Add($it) }
      }
    }
    $empresa = [string]$q.empresa
    if (-not $empresa -and $null -ne $q.totals -and $q.totals.empresa) {
      $empresa = [string]$q.totals.empresa
    }
      $row = [ordered]@{
      id = [string]$q.id
      nit = [string]$q.nit
      nombre = [string]$q.nombre
      created_at = [string]$q.created_at
      trm = $q.trm
      items = $items
      totals = $(if ($null -ne $q.totals) { $q.totals } else { @{} })
      empresa = $empresa
      bitrix_deal_id = [string]$q.bitrix_deal_id
      seller_codigo = $sellerCode
      assigned_by_id = $assigned
      seller_name = [string]$q.seller_name
      asesor_estado = $estado
      asesor_cotizado_at = [string]$q.asesor_cotizado_at
      asesor_comentario = [string]$q.asesor_comentario
      asesor_comentario_at = [string]$q.asesor_comentario_at
      asesor_comentario_by = [string]$q.asesor_comentario_by
      fecha_cierre = [string]$q.fecha_cierre
      fecha_cierre_cliente = [string]$q.fecha_cierre_cliente
      is_duplicated = [bool](Test-QuoteIsDuplicated $q)
      duplicated_from = [string]($(if ($q.duplicated_from) { $q.duplicated_from } elseif ($q.recotizado_desde) { $q.recotizado_desde } else { '' }))
      }
    }

    if ($bundleMode) {
      if ($isNueva) {
        [void]$bucketNuevas.Add($row)
      } else {
      [void]$bucketHistorial.Add($row)
      }
      if ($isDuplicada) { [void]$bucketDuplicadas.Add($row) }
      continue
    }
    [void]$safe.Add($row)
  }

  if ($bundleMode) {
    $sortedH = @($bucketHistorial | Sort-Object { $_.created_at } -Descending)
    $sortedN = @($bucketNuevas | Sort-Object { $_.created_at } -Descending)
    $sortedD = @($bucketDuplicadas | Sort-Object { $_.created_at } -Descending)
    $outH = New-Object System.Collections.Generic.List[object]
    $outN = New-Object System.Collections.Generic.List[object]
    $outD = New-Object System.Collections.Generic.List[object]
    foreach ($row in $sortedH) { if ($null -ne $row) { [void]$outH.Add($row) } }
    foreach ($row in $sortedN) { if ($null -ne $row) { [void]$outN.Add($row) } }
    foreach ($row in $sortedD) { if ($null -ne $row) { [void]$outD.Add($row) } }
    return [ordered]@{
      quotes = $outH
      historial = $outH
      nuevas = $outN
      duplicadas = $outD
      count = $outH.Count
      count_nuevas = $countNuevas
      count_historial = $countHistorial
      count_duplicadas = $countDuplicadas
      quotes_in_file = $quotesInFile
      quotes_matched = $countMatched
    }
  }

  $sorted = @($safe | Sort-Object { $_.created_at } -Descending)
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($row in $sorted) { if ($null -ne $row) { [void]$out.Add($row) } }
  return [ordered]@{
    quotes = $out
    historial = @()
    nuevas = @()
    duplicadas = @()
    count = $out.Count
    count_nuevas = $countNuevas
    count_historial = $countHistorial
    count_duplicadas = $countDuplicadas
    quotes_in_file = $quotesInFile
    quotes_matched = $countMatched
  }
}

function Get-AsesorClientesMerged([string]$codigo, [bool]$refreshBitrix = $false, [bool]$cacheOnly = $false) {
  $code = Normalize-AsesorCodigo $codigo
  $byNit = @{}
  $syncMeta = [ordered]@{
    synced = $false
    from_cache = $false
    error = ''
    fetched_at = ''
    bitrix_count = 0
  }

  $sync = Sync-AsesorClientesFromBitrix $code $refreshBitrix ($(if ($refreshBitrix) { $false } else { $cacheOnly }))
  $syncMeta.synced = [bool]$sync.synced
  $syncMeta.from_cache = [bool]$sync.from_cache
  $syncMeta.error = [string]$sync.error
  $syncMeta.fetched_at = [string]$sync.fetched_at
  $syncMeta.bitrix_count = @($sync.clientes).Count

  foreach ($c in (Get-AsesorClientes $code)) {
    if ($null -eq $c) { continue }
    $nit = Normalize-Nit ([string]$c.nit)
    if (-not $nit -or $nit.Length -gt 40) { continue }
    $telefono = Normalize-TelefonoDisplay ([string]$c.telefono)
    if (-not $telefono) { $telefono = Resolve-ClienteTelefonoFromIndex $nit '' }
    $nombre = ([string]$c.nombre).Trim()
    if (-not $nombre) { $nombre = $nit }
    $activity = [string]$c.updated_at
    if (-not $activity) { $activity = [string]$c.created_at }
    $byNit[$nit] = [ordered]@{
      nit = $nit
      nombre = $nombre
      telefono = $telefono
      manual = $false
      activity_at = $activity
    }
  }

  foreach ($c in (Get-AsesorClientesManual $code)) {
    if ($null -eq $c) { continue }
    $nit = Normalize-Nit ([string]$c.nit)
    if (-not $nit -or $nit.Length -gt 40) { continue }
    $telefono = Normalize-TelefonoDisplay ([string]$c.telefono)
    if (-not $telefono) { $telefono = Resolve-ClienteTelefonoFromIndex $nit '' }
    $nombre = ([string]$c.nombre).Trim()
    if (-not $nombre) { $nombre = $nit }
    $activity = [string]$c.updated_at
    if (-not $activity) { $activity = [string]$c.created_at }
    $byNit[$nit] = [ordered]@{
      nit = $nit
      nombre = $nombre
      telefono = $telefono
      manual = $true
      activity_at = $activity
    }
  }

  foreach ($c in (As-ObjectList $sync.clientes)) {
    if ($null -eq $c) { continue }
    $nit = Normalize-Nit ([string]$c.nit)
    if (-not $nit -or $nit.Length -gt 40) { continue }
    $nombreBx = ([string]$c.nombre).Trim()
    if (-not $nombreBx) { $nombreBx = $nit }
    $telefonoBx = Normalize-TelefonoDisplay ([string]$c.telefono)
    $activityBx = [string]$c.activity_at
    if (-not $activityBx) { $activityBx = [string]$c.updated_at }
    if (-not $activityBx) { $activityBx = [string]$c.created_at }
    if (-not $byNit.ContainsKey($nit)) {
      $byNit[$nit] = [ordered]@{
        nit = $nit
        nombre = $nombreBx
        telefono = $telefonoBx
        manual = $false
        activity_at = $activityBx
      }
    } else {
      $current = ([string]$byNit[$nit].nombre).Trim()
      if ((-not $current -or $current -eq $nit) -and $nombreBx -and $nombreBx -ne $nit) {
        $byNit[$nit]['nombre'] = $nombreBx
      }
      if (-not ([string]$byNit[$nit].telefono).Trim() -and $telefonoBx) {
        $byNit[$nit]['telefono'] = $telefonoBx
      }
      $prevAt = [string]$byNit[$nit].activity_at
      if ($activityBx -and (-not $prevAt -or ($activityBx -gt $prevAt))) {
        $byNit[$nit]['activity_at'] = $activityBx
      }
    }
  }

  $bundleAll = Get-QuotesForAsesor $code 'all' @{ list_only = $true }
  foreach ($q in (As-ObjectList $bundleAll.quotes)) {
    if ($null -eq $q) { continue }
    $nit = Normalize-Nit ([string]$q.nit)
    if (-not $nit) { continue }
    $nombreQuote = ([string]$q.nombre).Trim()
    $nombre = Resolve-ClienteNombreFromIndex $nit $nombreQuote
    if (-not $nombre) { $nombre = $(if ($nombreQuote) { $nombreQuote } else { $nit }) }
    $telefono = Resolve-ClienteTelefonoFromIndex $nit ''
    $quoteAt = [string]$q.finished_at
    if (-not $quoteAt) { $quoteAt = [string]$q.created_at }
    if (-not $byNit.ContainsKey($nit)) {
      $byNit[$nit] = [ordered]@{
        nit = $nit
        nombre = $nombre
        telefono = $telefono
        manual = $false
        activity_at = $quoteAt
      }
    } else {
      $current = ([string]$byNit[$nit].nombre).Trim()
      if ((-not $current -or $current -eq $nit) -and $nombre -and $nombre -ne $nit) {
        $byNit[$nit]['nombre'] = $nombre
      }
      if (-not ([string]$byNit[$nit].telefono).Trim() -and $telefono) {
        $byNit[$nit]['telefono'] = $telefono
      }
      $prevAt = [string]$byNit[$nit].activity_at
      if ($quoteAt -and (-not $prevAt -or ($quoteAt -gt $prevAt))) {
        $byNit[$nit]['activity_at'] = $quoteAt
      }
    }
  }

  $out = New-Object System.Collections.ArrayList
  $portalByNit = @{}
  foreach ($u in (Read-Users)) {
    if ($null -eq $u) { continue }
    $uNit = Normalize-Nit ([string]$u.nit)
    if (-not $uNit) { continue }
    $portalByNit[$uNit] = $u
  }
  $sortedRows = @($byNit.Values | Sort-Object `
    @{ Expression = { [string]$_.activity_at }; Descending = $true }, `
    @{ Expression = { [string]$_.nombre }; Descending = $false })
  foreach ($row in $sortedRows) {
    if ($null -eq $row) { continue }
    $nitKey = [string]$row.nit
    $contactoNombre = ''
    $contactoTel = [string]$row.telefono
    if ($portalByNit.ContainsKey($nitKey)) {
      $u = $portalByNit[$nitKey]
      $contactoNombre = ([string]$u.contacto_nombre).Trim()
      if (-not $contactoNombre) { $contactoNombre = ([string]$u.nombre_contacto).Trim() }
      $ct = Normalize-TelefonoDisplay ([string]$u.contacto_telefono)
      if (-not $ct) { $ct = Normalize-TelefonoDisplay ([string]$u.telefono_contacto) }
      if (-not $ct) { $ct = Normalize-TelefonoDisplay ([string]$u.telefono) }
      if ($ct) { $contactoTel = $ct }
    }
      [void]$out.Add([ordered]@{
      nit = $nitKey
        nombre = [string]$row.nombre
      telefono = $contactoTel
      contacto_nombre = $contactoNombre
      contacto_telefono = $contactoTel
        manual = ($row.manual -eq $true -or [string]$row.manual -eq 'True' -or [string]$row.manual -eq '1')
        activity_at = [string]$row.activity_at
      })
  }

  return [ordered]@{
    clientes = @($out)
    sync = $syncMeta
  }
}

function Test-NitInSet([string]$nit, $set) {
  if ($null -eq $set -or $set.Count -eq 0) { return $false }
  $n = Normalize-Nit $nit
  if ($n -and $set.Contains($n)) { return $true }
  $digits = ($n -replace '[^\d]', '')
  if ($digits -and $set.Contains($digits)) { return $true }
  $noZeros = $digits.TrimStart('0')
  if ($noZeros -and $set.Contains($noZeros)) { return $true }
  return $false
}

function Test-AsesorOwnsQuote($q, [string]$codigo) {
  if ($null -eq $q) { return $false }
  $code = Normalize-AsesorCodigo $codigo
  if (-not $code) { return $false }
  $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
  if (-not $sellerCode) { $sellerCode = Normalize-AsesorCodigo ([string]$q.asesor_cotizado_by) }
  if ($sellerCode -and $sellerCode -eq $code) { return $true }
  foreach ($field in @('asesor_estado_by','asesor_comentario_by','empresa_editado_by','recotizado_by','flete_editado_by','fecha_cierre_by','asesor_eliminada_by')) {
    try {
      $by = Normalize-AsesorCodigo ([string]$q.$field)
      if ($by -and $by -eq $code) { return $true }
    } catch {}
  }
  $assigned = [string]$q.assigned_by_id
  if ($assigned) {
    foreach ($id in (Get-AsesorBitrixIds $code)) {
      if ([string]$id -eq $assigned) { return $true }
    }
    try {
      $fromBx = Resolve-AsesorCodigoFromBitrixId $assigned
      if ($fromBx -and $fromBx -eq $code) { return $true }
    } catch {}
  }
  $nitSet = Get-AsesorNitSet $code $true
  $effNit = [string]$q.nit
  if (-not $effNit -and [string]$q.id -match '-(\d{6,15})$') { $effNit = $Matches[1] }
  if (Test-NitInSet $effNit $nitSet) { return $true }
  return $false
}

function Normalize-Nit([string]$nit) {
  $n = (($nit | ForEach-Object { $_ }) -replace '[\s.]', '').Trim()
  # Quitar digito de verificacion: 900639921-7 -> 900639921
  return ($n -replace '-\d$', '')
}

function Test-IsAdminNit([string]$nit) {
  $token = (($nit | ForEach-Object { $_ }) -replace '[\s._-]', '').Trim().ToUpper()
  if ($token -eq 'ADMINIZC' -or $token -eq 'ADMIN' -or $token -eq 'IZCADMIN') { return $true }
  $n = Normalize-Nit $nit
  if (-not $n) { return $false }
  if ($n -eq 'Admin IZC' -or $n -eq 'AdminIZC' -or $n -eq '03166122778' -or $n -eq '3166122778') { return $true }
  $nCore = $n.TrimStart('0')
  return [bool]($nCore -eq '3166122778')
}


function Get-ClientesSinVendedorDismissedMap {
  $map = @{}
  if (-not (Test-Path $ClientesSinVendedorDismissedFile)) { return $map }
  try {
    $raw = Get-Content $ClientesSinVendedorDismissedFile -Raw -Encoding UTF8
    $data = $raw | ConvertFrom-Json
    $rows = @()
    if ($null -ne $data.nits) { $rows = As-ObjectList $data.nits }
    else { $rows = As-ObjectList $data }
    foreach ($nit in $rows) {
      $n = Normalize-Nit ([string]$(if ($nit -is [string]) { $nit } elseif ($null -ne $nit.nit) { $nit.nit } else { $nit }))
      if ($n) { $map[$n] = $true }
    }
  } catch {}
  return $map
}

function Save-ClientesSinVendedorDismissedMap($map) {
  $nits = @($map.Keys | Sort-Object)
  $payload = [ordered]@{
    updated_at = (Get-Date).ToString('o')
    nits = $nits
  }
  $json = ($payload | ConvertTo-Json -Depth 5 -Compress)
  [System.IO.File]::WriteAllText($ClientesSinVendedorDismissedFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Add-ClienteSinVendedorDismissed([string]$nit) {
  $n = Normalize-Nit $nit
  if (-not $n) { return }
  $map = Get-ClientesSinVendedorDismissedMap
  if ($map.ContainsKey($n)) { return }
  $map[$n] = $true
  Save-ClientesSinVendedorDismissedMap $map
}

function Remove-ClienteSinVendedorDismissed([string]$nit) {
  $n = Normalize-Nit $nit
  if (-not $n) { return }
  $map = Get-ClientesSinVendedorDismissedMap
  if (-not $map.ContainsKey($n)) { return }
  $map.Remove($n)
  Save-ClientesSinVendedorDismissedMap $map
}

function New-PasswordHash([string]$password) {
  $iterations = 100000
  $salt = New-Object byte[] 16
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($salt)
  $rng.Dispose()
  $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes(
    $password,
    $salt,
    $iterations,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256
  )
  $hash = $pbkdf2.GetBytes(32)
  $pbkdf2.Dispose()
  return 'pbkdf2$' + $iterations + '$' + [Convert]::ToBase64String($salt) + '$' + [Convert]::ToBase64String($hash)
}

function Test-PasswordHash([string]$password, $user) {
  $storedHash = [string]$user.password_hash
  if ($storedHash -and $storedHash.StartsWith('pbkdf2$')) {
    $parts = $storedHash.Split('$')
    if ($parts.Length -ne 4) { return $false }
    $iterations = [int]$parts[1]
    $salt = [Convert]::FromBase64String($parts[2])
    $expected = [Convert]::FromBase64String($parts[3])
    $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes(
      $password,
      $salt,
      $iterations,
      [System.Security.Cryptography.HashAlgorithmName]::SHA256
    )
    $actual = $pbkdf2.GetBytes(32)
    $pbkdf2.Dispose()
    if ($actual.Length -ne $expected.Length) { return $false }
    $ok = $true
    for ($i = 0; $i -lt $actual.Length; $i++) {
      if ($actual[$i] -ne $expected[$i]) { $ok = $false }
    }
    return $ok
  }

  # Compatibilidad con registros viejos en texto plano
  $legacy = [string]$user.password
  return ($legacy -ne '' -and $legacy -eq $password)
}

function Protect-UserRecord($user) {
  $nit = Normalize-Nit ([string]$user.nit)
  $nombre = ([string]$user.nombre).Trim()
  if (-not $nombre) { $nombre = ([string]$user.name).Trim() }
  $created = [string]$user.created_at
  if (-not $created) { $created = (Get-Date).ToString('o') }

  $hash = [string]$user.password_hash
  if (-not $hash) {
    $plain = [string]$user.password
    if ($plain) { $hash = New-PasswordHash $plain }
  }

  $contactoNombre = ([string]$user.contacto_nombre).Trim()
  if (-not $contactoNombre) { $contactoNombre = ([string]$user.nombre_contacto).Trim() }
  $contactoTel = Normalize-TelefonoDisplay ([string]$user.contacto_telefono)
  if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$user.telefono_contacto) }
  if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$user.telefono) }

  $row = [ordered]@{
    nit = $nit
    nombre = $nombre
    password_hash = $hash
    created_at = $created
  }
  if ($contactoNombre) { $row.contacto_nombre = $contactoNombre }
  if ($contactoTel) {
    $row.contacto_telefono = $contactoTel
    $row.telefono = $contactoTel
  }
  return [pscustomobject]$row
}

function Read-Users {
  if (-not (Test-Path $UsersFile)) { return ,[object[]]@() }
  try {
    $raw = Get-Content $UsersFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return ,[object[]]@() }
    $data = $raw | ConvertFrom-Json
    $list = New-Object System.Collections.Generic.List[object]
    if ($data -is [System.Array]) {
      foreach ($item in $data) {
        if ($null -ne $item -and [string]$item.nit -and ([string]$item.nit).Trim() -notmatch '\s') {
          $list.Add($item)
        }
      }
    } elseif ($null -ne $data) {
      if ([string]$data.nit -and ([string]$data.nit).Trim() -notmatch '\s') {
        $list.Add($data)
      }
    }
    return ,$list.ToArray()
  } catch {
    return ,[object[]]@()
  }
}

function Write-Users($users) {
  $dir = Split-Path $UsersFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

  $list = New-Object System.Collections.Generic.List[object]
  foreach ($item in @($users)) {
    if ($null -eq $item) { continue }
    $nit = [string]$item.nit
    $hash = [string]$item.password_hash
    if (-not $nit -or $nit -match '\s') { continue }
    if (-not $hash) { continue }
    $nombre = ([string]$item.nombre).Trim()
    if (-not $nombre) { $nombre = ([string]$item.name).Trim() }
    $created = [string]$item.created_at
    if (-not $created) { $created = (Get-Date).ToString('o') }
    $row = [ordered]@{
      nit = $nit
      nombre = $nombre
      password_hash = $hash
      created_at = $created
    }
    $role = ([string]$item.role).Trim()
    if ($role) { $row.role = $role }
    $contactoNombre = ([string]$item.contacto_nombre).Trim()
    if (-not $contactoNombre) { $contactoNombre = ([string]$item.nombre_contacto).Trim() }
    if ($contactoNombre) { $row.contacto_nombre = $contactoNombre }
    $contactoTel = Normalize-TelefonoDisplay ([string]$item.contacto_telefono)
    if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$item.telefono_contacto) }
    if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$item.telefono) }
    if ($contactoTel) {
      $row.contacto_telefono = $contactoTel
      $row.telefono = $contactoTel
    }
    $nombreUpdated = [string]$item.nombre_updated_at
    if ($nombreUpdated) { $row.nombre_updated_at = $nombreUpdated }
    $list.Add($row)
  }

  if ($list.Count -eq 0) {
    $json = '[]'
  } else {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('[')
    for ($i = 0; $i -lt $list.Count; $i++) {
      $u = $list[$i]
      $nitJson = ($u.nit | ConvertTo-Json -Compress)
      $nombreJson = ($u.nombre | ConvertTo-Json -Compress)
      $hashJson = ($u.password_hash | ConvertTo-Json -Compress)
      $createdJson = ($u.created_at | ConvertTo-Json -Compress)
      [void]$sb.Append('  {')
      [void]$sb.Append("`n    `"nit`": $nitJson,")
      [void]$sb.Append("`n    `"nombre`": $nombreJson,")
      [void]$sb.Append("`n    `"password_hash`": $hashJson,")
      [void]$sb.Append("`n    `"created_at`": $createdJson")
      [void]$sb.Append("`n  }")
      if ($i -lt $list.Count - 1) { [void]$sb.Append(',') }
      [void]$sb.AppendLine()
    }
    [void]$sb.Append(']')
    $json = $sb.ToString()
  }
  [System.IO.File]::WriteAllText($UsersFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Read-Quotes {
  if (-not (Test-Path $QuotesFile)) { return ,[object[]]@() }
  try {
    $raw = Get-Content $QuotesFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return ,[object[]]@() }
    $data = $raw | ConvertFrom-Json
    if ($data -is [System.Array]) { return ,$data }
    if ($null -ne $data) { return ,@($data) }
    return ,[object[]]@()
  } catch {
    return ,[object[]]@()
  }
}

function Write-Quotes($quotes) {
  $dir = Split-Path $QuotesFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $json = ($quotes | ConvertTo-Json -Depth 12 -Compress:$false)
  [System.IO.File]::WriteAllText($QuotesFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
}

function Read-Trm {
  if (-not (Test-Path $TrmFile)) {
    return [ordered]@{
      value = 3204
      updated_at = ''
      updated_by_nit = ''
      updated_by_nombre = ''
    }
  }
  try {
    $raw = Get-Content $TrmFile -Raw -Encoding UTF8
    $data = $raw | ConvertFrom-Json
    if ($null -eq $data) { throw 'empty' }
    return $data
  } catch {
    return [ordered]@{
      value = 3204
      updated_at = ''
      updated_by_nit = ''
      updated_by_nombre = ''
    }
  }
}

function Write-Trm([double]$value, [string]$adminNit, [string]$adminNombre) {
  $entry = [ordered]@{
    value = $value
    updated_at = (Get-Date).ToString('o')
    updated_by_nit = $adminNit
    updated_by_nombre = $adminNombre
  }
  $dir = Split-Path $TrmFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $json = ($entry | ConvertTo-Json -Depth 4 -Compress:$false)
  [System.IO.File]::WriteAllText($TrmFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
  return $entry
}

function Normalize-BitrixWebhook([string]$url) {
  $u = ([string]$url).Trim()
  if (-not $u) { return '' }
  $u = $u -replace '\\', '/'
  # Quitar metodo al final si pegaron .../crm.deal.add
  $u = $u -replace '/crm\.[a-z0-9_.]+(\.json)?/?$', '/'
  if (-not $u.EndsWith('/')) { $u = $u + '/' }
  return $u
}

function Read-BitrixConfig {
  $defaults = [ordered]@{
    enabled = $false
    webhook_base = ''
    stage_id = ''
    stage_cotizado = ''
    stage_seguimiento = ''
    stage_vendido = ''
    stage_perdida = ''
    category_id = ''
    currency_id = 'COP'
    marca_field = 'UF_CRM_1749499637'
    # Companias: TITLE = NIT, UF = razon social, ASSIGNED_BY_ID = vendedor
    company_razon_field = 'UF_CRM_1746192546'
    updated_at = ''
    updated_by_nit = ''
  }
  if (-not (Test-Path $BitrixFile)) { return $defaults }
  try {
    $raw = Get-Content $BitrixFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return $defaults }
    $data = $raw | ConvertFrom-Json
    $marcaField = ([string]$data.marca_field).Trim()
    if (-not $marcaField) { $marcaField = 'UF_CRM_1749499637' }
    $razonField = ([string]$data.company_razon_field).Trim()
    if (-not $razonField) { $razonField = 'UF_CRM_1746192546' }
    return [ordered]@{
      enabled = [bool]$data.enabled
      webhook_base = Normalize-BitrixWebhook ([string]$data.webhook_base)
      stage_id = ([string]$data.stage_id).Trim()
      stage_cotizado = ([string]$data.stage_cotizado).Trim()
      stage_seguimiento = ([string]$data.stage_seguimiento).Trim()
      stage_vendido = ([string]$data.stage_vendido).Trim()
      stage_perdida = ([string]$data.stage_perdida).Trim()
      stage_pendiente = ([string]$data.stage_pendiente).Trim()
      stage_cerrado_modificado = ([string]$data.stage_cerrado_modificado).Trim()
      category_id = ([string]$data.category_id).Trim()
      currency_id = $(if ([string]$data.currency_id) { ([string]$data.currency_id).Trim().ToUpperInvariant() } else { 'COP' })
      marca_field = $marcaField
      company_razon_field = $razonField
      updated_at = [string]$data.updated_at
      updated_by_nit = [string]$data.updated_by_nit
    }
  } catch {
    return $defaults
  }
}

function Write-BitrixConfig($cfg, [string]$adminNit) {
  $marcaField = ([string]$cfg.marca_field).Trim()
  if (-not $marcaField) { $marcaField = 'UF_CRM_1749499637' }
  $razonField = ([string]$cfg.company_razon_field).Trim()
  if (-not $razonField) { $razonField = 'UF_CRM_1746192546' }
  # Conservar stage_* existentes del archivo para no borrarlos al guardar desde Admin.
  $prev = $null
  try { if (Test-Path $BitrixFile) { $prev = Read-BitrixConfig } } catch { $prev = $null }
  $pick = {
    param($newVal, $oldVal)
    $n = ([string]$newVal).Trim()
    if ($n) { return $n }
    return ([string]$oldVal).Trim()
  }
  $entry = [ordered]@{
    enabled = [bool]$cfg.enabled
    webhook_base = Normalize-BitrixWebhook ([string]$cfg.webhook_base)
    stage_id = (& $pick $cfg.stage_id $(if ($prev) { $prev.stage_id } else { '' }))
    stage_cotizado = (& $pick $cfg.stage_cotizado $(if ($prev) { $prev.stage_cotizado } else { 'C3:FINAL_INVOICE' }))
    stage_pendiente = (& $pick $cfg.stage_pendiente $(if ($prev) { $prev.stage_pendiente } else { 'C3:UC_G99HUH' }))
    stage_seguimiento = (& $pick $cfg.stage_seguimiento $(if ($prev) { $prev.stage_seguimiento } else { 'C3:NEW' }))
    stage_vendido = (& $pick $cfg.stage_vendido $(if ($prev) { $prev.stage_vendido } else { 'C3:EXECUTING' }))
    stage_perdida = (& $pick $cfg.stage_perdida $(if ($prev) { $prev.stage_perdida } else { 'C3:UC_S78RLD' }))
    stage_cerrado_modificado = (& $pick $cfg.stage_cerrado_modificado $(if ($prev) { $prev.stage_cerrado_modificado } else { 'C3:UC_MGTF3H' }))
    stage_duplicada_recotizada = (& $pick $cfg.stage_duplicada_recotizada $(if ($prev) { $prev.stage_duplicada_recotizada } else { 'C3:UC_M9PUWP' }))
    category_id = (& $pick $cfg.category_id $(if ($prev) { $prev.category_id } else { '' }))
    currency_id = $(if ([string]$cfg.currency_id) { ([string]$cfg.currency_id).Trim().ToUpperInvariant() } else { 'COP' })
    marca_field = $marcaField
    company_razon_field = $razonField
    updated_at = (Get-Date).ToString('o')
    updated_by_nit = $adminNit
  }
  if (-not $entry.stage_id) { $entry.stage_id = $entry.stage_cotizado }
  $dir = Split-Path $BitrixFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $json = ($entry | ConvertTo-Json -Depth 4 -Compress:$false)
  [System.IO.File]::WriteAllText($BitrixFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
  return $entry
}

function ConvertTo-BitrixForm($obj, [string]$prefix = '') {
  $result = [ordered]@{}
  if ($null -eq $obj) { return $result }

  if ($obj -is [System.Collections.IDictionary]) {
    foreach ($key in @($obj.Keys)) {
      $path = if ($prefix) { "$prefix[$key]" } else { [string]$key }
      $child = ConvertTo-BitrixForm $obj[$key] $path
      foreach ($ck in @($child.Keys)) { $result[$ck] = $child[$ck] }
    }
    return $result
  }

  if (($obj -is [System.Collections.IEnumerable]) -and -not ($obj -is [string])) {
    $i = 0
    foreach ($item in @($obj)) {
      $path = "$prefix[$i]"
      $child = ConvertTo-BitrixForm $item $path
      foreach ($ck in @($child.Keys)) { $result[$ck] = $child[$ck] }
      $i++
    }
    return $result
  }

  if ($prefix) {
    if ($obj -is [double] -or $obj -is [float] -or $obj -is [decimal] -or $obj -is [int] -or $obj -is [long]) {
      $result[$prefix] = ([IFormattable]$obj).ToString($null, [System.Globalization.CultureInfo]::InvariantCulture)
    } else {
      $result[$prefix] = [string]$obj
    }
  }
  return $result
}
function Invoke-BitrixRest([string]$webhookBase, [string]$method, $payload) {
  $base = Normalize-BitrixWebhook $webhookBase
  if (-not $base) { throw 'Webhook Bitrix vacio.' }
  $url = $base + $method.TrimStart('/')
  # JSON (igual que api/auth.php): más fiable que form-urlencoded con STAGE_ID tipo C3:…
  $json = $null
  if ($null -ne $payload) {
    $json = ($payload | ConvertTo-Json -Depth 12 -Compress)
  }
  if ($json) {
    $response = Invoke-RestMethod -Method Post -Uri $url -Body $json -ContentType 'application/json; charset=utf-8' -TimeoutSec 25
  } else {
    $response = Invoke-RestMethod -Method Post -Uri $url -TimeoutSec 25
  }
  if ($null -ne $response.error -and [string]$response.error) {
    $desc = [string]$response.error_description
    if (-not $desc) { $desc = [string]$response.error }
    throw ("Bitrix {0}: {1}" -f [string]$response.error, $desc)
  }
  return $response
}

function Clear-BitrixDealObservers([string]$webhookBase, $dealId) {
  $id = ([string]$dealId).Trim()
  if (-not $id -or $id -notmatch '^\d+$') { return }
  try {
    Invoke-BitrixRest $webhookBase 'crm.item.update.json' @{
      entityTypeId = 2
      id = [int]$id
      fields = @{ observers = @() }
    } | Out-Null
  } catch {}
  try {
    $got = Invoke-BitrixRest $webhookBase 'crm.item.get.json' @{
      entityTypeId = 2
      id = [int]$id
    }
    $item = $got.result
    $observers = @()
    if ($null -ne $item) {
      if ($null -ne $item.observers) { $observers = @($item.observers) }
      elseif ($null -ne $item.OBSERVERS) { $observers = @($item.OBSERVERS) }
    }
    $userIds = New-Object System.Collections.Generic.List[int]
    foreach ($uid in $observers) {
      $n = 0
      if ($uid -is [hashtable] -or $uid -is [System.Collections.IDictionary] -or ($null -ne $uid.PSObject -and $uid.PSObject.Properties.Name -contains 'id')) {
        try { $n = [int]($uid.id) } catch {
          try { $n = [int]($uid.ID) } catch {
            try { $n = [int]($uid.userId) } catch { $n = 0 }
          }
        }
      } else {
        try { $n = [int]$uid } catch { $n = 0 }
      }
      if ($n -gt 0 -and -not $userIds.Contains($n)) { [void]$userIds.Add($n) }
    }
    if ($userIds.Count -gt 0) {
      try {
        Invoke-BitrixRest $webhookBase 'crm.observer.delete.json' @{
          entityTypeId = 2
          entityId = [int]$id
          userIds = $userIds.ToArray()
        } | Out-Null
      } catch {}
      try {
        Invoke-BitrixRest $webhookBase 'crm.item.update.json' @{
          entityTypeId = 2
          id = [int]$id
          fields = @{ observers = @() }
        } | Out-Null
      } catch {}
    }
  } catch {}
}

function Get-BitrixOpportunity($quote, $currencyId) {
  $currencyId = ([string]$currencyId).ToUpperInvariant()
  if (-not $currencyId) { $currencyId = 'COP' }
  $sum = 0.0
  $hasItem = $false
  foreach ($item in @($quote.items)) {
    if ($null -eq $item) { continue }
    $hasItem = $true
    $v = $null
    if ($currencyId -eq 'USD') {
      $v = $item.totalUsdIva
      if ($null -eq $v) { $v = $item.usdIva }
    } else {
      $v = $item.totalCopIva
      if ($null -eq $v) { $v = $item.copIva }
    }
    try {
      if ($null -ne $v) { $sum += [double]$v }
    } catch {}
  }
  if ($hasItem -and $sum -gt 0) { return $sum }

  $totals = $quote.totals
  if ($null -eq $totals) { return 0.0 }
  try {
    if ($currencyId -eq 'USD' -and $null -ne $totals.usdIva) { return [double]$totals.usdIva }
    if ($currencyId -ne 'USD' -and $null -ne $totals.copIva) { return [double]$totals.copIva }
  } catch {}
  return 0.0
}

function Get-BitrixDealCurrency($quote, $fallbackCurrency) {
  $hasUsd = $false
  $hasCop = $false
  foreach ($item in @($quote.items)) {
    if ($null -eq $item) { continue }
    $c = ([string]$item.currency).ToUpperInvariant()
    if ($c -eq 'COP') { $hasCop = $true } else { $hasUsd = $true }
  }
  if ($hasUsd -and -not $hasCop) { return 'USD' }
  if ($hasCop -and -not $hasUsd) { return 'COP' }

  $totals = $quote.totals
  if ($null -ne $totals) {
    try { if ($totals.hasUsd -eq $true -and $totals.hasCop -ne $true) { return 'USD' } } catch {}
    try { if ($totals.hasCop -eq $true -and $totals.hasUsd -ne $true) { return 'COP' } } catch {}
  }

  $fallback = ([string]$fallbackCurrency).ToUpperInvariant()
  if ($fallback) { return $fallback }
  return 'COP'
}

function Format-BitrixQuoteComments($quote) {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('Cotizacion IZC Mayorista')
  $qid = [string]$quote.id
  if ($qid) { $lines.Add('ID IZC: ' + $qid) }
  $lines.Add('NIT: ' + [string]$quote.nit)
  $lines.Add('Cliente: ' + [string]$quote.nombre)
  $lines.Add('TRM: ' + [string]$quote.trm)
  $lines.Add('Fecha: ' + [string]$quote.created_at)
  $lines.Add('')
  $lines.Add('Productos:')
  foreach ($item in @($quote.items)) {
    if ($null -eq $item) { continue }
    $sku = [string]$item.sku
    $name = [string]$item.name
    $qty = [string]$item.qty
    $currency = ([string]$item.currency).ToUpperInvariant()
    if ($currency -eq 'USD') {
      $total = $item.totalUsdIva
      if ($null -eq $total) { $total = $item.usdIva }
      $lines.Add("- [$sku] $name x$qty = $total USD + IVA")
    } else {
      $total = $item.totalCopIva
      if ($null -eq $total) { $total = $item.copIva }
      $lines.Add("- [$sku] $name x$qty = $total COP + IVA")
    }
  }
  $totals = $quote.totals
  if ($null -ne $totals) {
    $lines.Add('')
    $hasUsd = $false
    $hasCop = $false
    try { if ($totals.hasUsd -eq $true) { $hasUsd = $true } } catch {}
    try { if ($totals.hasCop -eq $true) { $hasCop = $true } } catch {}
    if (-not $hasUsd -and -not $hasCop) {
      try { if ([double]$totals.usdIva -gt 0) { $hasUsd = $true } } catch {}
      try { if ([double]$totals.copIva -gt 0) { $hasCop = $true } } catch {}
    }
    if ($hasUsd) { $lines.Add('Total USD + IVA: ' + [string]$totals.usdIva) }
    if ($hasCop) { $lines.Add('Total COP + IVA: ' + [string]$totals.copIva) }
  }
  return ($lines -join "`n")
}

function Get-BitrixFirstId($response) {
  if ($null -eq $response) { return $null }
  $list = $response.result
  if ($null -eq $list) { return $null }
  if ($list -is [System.Collections.IEnumerable] -and -not ($list -is [string])) {
    foreach ($row in @($list)) {
      if ($null -eq $row) { continue }
      try {
        if ($null -ne $row.ID) { return [string]$row.ID }
        if ($null -ne $row.id) { return [string]$row.id }
      } catch {}
    }
  }
  return $null
}

function Ensure-BitrixCompany([string]$webhookBase, [string]$nit, [string]$nombre, $assignedById = $null) {
  $nit = ([string]$nit).Trim()
  if (-not $nit) { return $null }
  $assignedById = ([string]$assignedById).Trim()
  $nombre = ([string]$nombre).Trim()

  $found = Invoke-BitrixRest $webhookBase 'crm.company.list.json' @{
    filter = @{ TITLE = $nit }
    select = @('ID', 'TITLE', 'ASSIGNED_BY_ID')
  }
  $existing = Get-BitrixFirstId $found
  if ($existing) {
    $upd = @{}
    if ($assignedById) {
      try { $upd.ASSIGNED_BY_ID = [int]$assignedById } catch { $upd.ASSIGNED_BY_ID = $assignedById }
    }
    if ($nombre) {
      $upd[$BitrixCompanyNamePrimary] = $nombre
      $upd[$BitrixCompanyNameFallback] = $nombre
      $upd.COMMENTS = ('Cliente IZC: ' + $nombre)
    }
    if ($upd.Count -gt 0) {
      try {
        Invoke-BitrixRest $webhookBase 'crm.company.update.json' @{
          id = $existing
          fields = $upd
        } | Out-Null
      } catch {}
    }
    return $existing
  }

  # Igual que cotizaciones manuales: Compañía = NIT, tipo Client / IT
  $fields = @{
    TITLE = $nit
    COMPANY_TYPE = 'CUSTOMER'
    INDUSTRY = 'IT'
    OPENED = 'Y'
  }
  if ($nombre) {
    $fields.COMMENTS = ('Cliente IZC: ' + $nombre)
    $fields[$BitrixCompanyNamePrimary] = $nombre
    $fields[$BitrixCompanyNameFallback] = $nombre
  }
  if ($assignedById) {
    try { $fields.ASSIGNED_BY_ID = [int]$assignedById } catch { $fields.ASSIGNED_BY_ID = $assignedById }
  }
  $created = Invoke-BitrixRest $webhookBase 'crm.company.add.json' @{
    fields = $fields
    params = @{ REGISTER_SONET_EVENT = 'N' }
  }
  if ($null -ne $created.result -and [string]$created.result) {
    return [string]$created.result
  }
  throw 'Bitrix no devolvio ID de compania.'
}

function Ensure-BitrixContact([string]$webhookBase, [string]$nombre, $companyId, [string]$nit, $assignedById = $null) {
  $nombre = ([string]$nombre).Trim()
  if (-not $nombre) { return $null }
  $assignedById = ([string]$assignedById).Trim()

  # Contacto = nombre del cliente (como PROVEXPRESS en las otras cotizaciones)
  $filter = @{ NAME = $nombre }
  if ($companyId) { $filter.COMPANY_ID = $companyId }
  $found = Invoke-BitrixRest $webhookBase 'crm.contact.list.json' @{
    filter = $filter
    select = @('ID', 'NAME', 'LAST_NAME', 'COMPANY_ID', 'ASSIGNED_BY_ID')
  }
  $existing = Get-BitrixFirstId $found
  if ($existing) {
    if ($assignedById) {
      $upd = @{ ASSIGNED_BY_ID = $(try { [int]$assignedById } catch { $assignedById }) }
      if ($companyId) { $upd.COMPANY_ID = $(try { [int]$companyId } catch { $companyId }) }
      try {
        Invoke-BitrixRest $webhookBase 'crm.contact.update.json' @{
          id = $existing
          fields = $upd
        } | Out-Null
      } catch {}
    }
    return $existing
  }

  $fields = @{
    NAME = $nombre
    LAST_NAME = ''
    OPENED = 'Y'
    TYPE_ID = 'CLIENT'
  }
  if ($companyId) { $fields.COMPANY_ID = $companyId }
  if ($nit) { $fields.COMMENTS = ('NIT: ' + $nit) }
  if ($assignedById) {
    try { $fields.ASSIGNED_BY_ID = [int]$assignedById } catch { $fields.ASSIGNED_BY_ID = $assignedById }
  }

  try {
    $created = Invoke-BitrixRest $webhookBase 'crm.contact.add.json' @{
      fields = $fields
      params = @{ REGISTER_SONET_EVENT = 'N' }
    }
  } catch {
    # Algunos portales exigen apellido
    $fields.LAST_NAME = '-'
    $created = Invoke-BitrixRest $webhookBase 'crm.contact.add.json' @{
      fields = $fields
      params = @{ REGISTER_SONET_EVENT = 'N' }
    }
  }

  if ($null -ne $created.result -and [string]$created.result) {
    return [string]$created.result
  }
  throw 'Bitrix no devolvio ID de contacto.'
}

function Get-BrandCatalogMap {
  $path = Join-Path $Root 'assets\files\brand_products.json'
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  try {
    $data = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($prop in $data.PSObject.Properties) {
      foreach ($p in @($prop.Value)) {
        if ($null -eq $p) { continue }
        $sku = [string]$p.sku
        if (-not $sku) { continue }
        $map[$sku] = @{
          brand = [string]$p.brand
          brandName = $(if ($p.brandName) { [string]$p.brandName } else { [string]$p.brand })
          name = [string]$p.name
          category = [string]$p.category
          type = [string]$p.type
        }
        $noZeros = $sku -replace '^0+', ''
        if ($noZeros -and -not $map.ContainsKey($noZeros)) { $map[$noZeros] = $map[$sku] }
      }
    }
  } catch {}
  return $map
}

function Get-BitrixMarcaItems([string]$webhookBase, [string]$fieldName) {
  $resp = Invoke-BitrixRest $webhookBase 'crm.deal.fields.json' $null
  if ($null -eq $resp -or $null -eq $resp.result) { return @() }
  $prop = $resp.result.PSObject.Properties[[string]$fieldName]
  if ($null -eq $prop -or $null -eq $prop.Value) { return @() }
  return @($prop.Value.items)
}

function Resolve-BitrixMarcaId($marcaItems, [string]$brandKey, [string]$brandName, [string]$productHint) {
  if (-not $marcaItems -or @($marcaItems).Count -eq 0) { return $null }
  $brandU = ([string]$brandName).Trim().ToUpperInvariant()
  $keyU = ([string]$brandKey).Trim().ToUpperInvariant()
  if (-not $brandU) { $brandU = $keyU }
  if (-not $brandU) { return $null }

  $hint = ([string]$productHint).ToUpperInvariant()
  $want = New-Object System.Collections.Generic.List[string]
  if ($hint -match 'IMPRESORA|CABEZAL|RIBBON|ETIQUET|ZD\d|ZT\d|ZC\d|PRINT') {
    [void]$want.Add('IMP')
    [void]$want.Add('ESCR')
  }
  if ($hint -match 'LECTOR|SCAN|MAGELLAN|QUICKSCAN|DS\d') { [void]$want.Add('LECTOR') }
  if ($hint -match 'MOVIL|MOBILE|TC\d|MC\d|TERMINAL') { [void]$want.Add('MOV') }
  if ($hint -match 'CARNET|CARD|ZXP|ZC1|ZC3') { [void]$want.Add('CARNET') }
  if ($hint -match 'SUMINIST|RIBBON') { [void]$want.Add('SUMINIST') }

  $bestId = $null
  $bestScore = -1
  foreach ($it in @($marcaItems)) {
    $val = [string]$it.VALUE
    $valU = $val.ToUpperInvariant()
    $matchBrand = ($valU.Contains($brandU)) -or ($keyU -and $valU.Contains($keyU))
    if (-not $matchBrand) { continue }
    $score = 1
    if ($valU -eq $brandU) { $score += 5 }
    foreach ($w in $want) {
      if ($valU.Contains($w)) { $score += 3 }
    }
    if ($score -gt $bestScore) {
      $bestScore = $score
      $bestId = [string]$it.ID
    }
  }
  return $bestId
}

function Get-QuoteMarcaId([string]$webhookBase, $cfg, $quote) {
  $fieldName = [string]$cfg.marca_field
  if (-not $fieldName) { $fieldName = 'UF_CRM_1749499637' }
  $items = Get-BitrixMarcaItems $webhookBase $fieldName
  $brandMap = Get-BrandCatalogMap
  foreach ($item in @($quote.items)) {
    if ($null -eq $item) { continue }
    $sku = [string]$item.sku
    $name = [string]$item.name
    $meta = $null
    if ($sku -and $brandMap.ContainsKey($sku)) { $meta = $brandMap[$sku] }
    elseif ($sku) {
      $nz = $sku -replace '^0+', ''
      if ($nz -and $brandMap.ContainsKey($nz)) { $meta = $brandMap[$nz] }
    }
    $brandKey = ''
    $brandName = ''
    if ($meta) {
      $brandKey = [string]$meta.brand
      $brandName = [string]$meta.brandName
      if (-not $name) { $name = [string]$meta.name }
    }
    if (-not $brandName -and $item.brandName) { $brandName = [string]$item.brandName }
    if (-not $brandKey -and $item.brand) { $brandKey = [string]$item.brand }
    $hint = ($name + ' ' + [string]$meta.category + ' ' + [string]$meta.type)
    $id = Resolve-BitrixMarcaId $items $brandKey $brandName $hint
    if ($id) { return $id }
  }
  return $null
}

function Build-BitrixProductRows($quote, [string]$dealCurrency) {
  $rows = @()
  $sort = 10
  $dealCurrency = ([string]$dealCurrency).ToUpperInvariant()
  foreach ($item in @($quote.items)) {
    if ($null -eq $item) { continue }
    $sku = [string]$item.sku
    $name = [string]$item.name
    if (-not $name) { $name = $sku }
    $productName = if ($sku) { "$sku-$name" } else { $name }

    $qty = 1
    try {
      $qty = [int]([math]::Floor([double]$item.qty))
    } catch { $qty = 1 }
    if ($qty -le 0) { $qty = 1 }

    $unit = 0.0
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    try {
      $raw = $null
      if ($dealCurrency -eq 'USD') {
        if ($null -ne $item.usdIva) { $raw = $item.usdIva }
        elseif ($null -ne $item.usd) { $raw = $item.usd }
      } else {
        if ($null -ne $item.copIva) { $raw = $item.copIva }
        elseif ($null -ne $item.cop) { $raw = $item.cop }
      }
      if ($null -ne $raw) {
        if ($raw -is [double] -or $raw -is [decimal] -or $raw -is [int] -or $raw -is [long]) {
          $unit = [double]$raw
        } else {
          [void][double]::TryParse(([string]$raw).Replace(',', '.'), [System.Globalization.NumberStyles]::Float, $inv, [ref]$unit)
        }
      }
    } catch { $unit = 0.0 }

    $priceStr = $unit.ToString('0.00', $inv)
    $rows += @{
      PRODUCT_ID = '0'
      PRODUCT_NAME = $productName
      PRICE = $priceStr
      QUANTITY = ([string]$qty)
      TAX_RATE = '19'
      TAX_INCLUDED = 'Y'
      MEASURE_CODE = '796'
      MEASURE_NAME = 'pcs.'
      SORT = ([string]$sort)
    }
    $sort += 10
  }
  return $rows
}

function Set-BitrixDealProducts([string]$webhookBase, [string]$dealId, $rows) {
  if (-not $dealId) { return }
  $list = @($rows)
  if ($list.Count -eq 0) { return }

  $inv = [System.Globalization.CultureInfo]::InvariantCulture
  $base = Normalize-BitrixWebhook $webhookBase
  $url = $base + 'crm.deal.productrows.set.json'
  $payload = @{
    id = [int]$dealId
    rows = @($list | ForEach-Object {
      $priceRaw = ([string]$_.PRICE).Replace(',', '.')
      $qtyRaw = ([string]$_.QUANTITY).Replace(',', '.')
      $price = 0.0
      $qty = 1.0
      [void][double]::TryParse($priceRaw, [System.Globalization.NumberStyles]::Float, $inv, [ref]$price)
      [void][double]::TryParse($qtyRaw, [System.Globalization.NumberStyles]::Float, $inv, [ref]$qty)
      if ($qty -le 0) { $qty = 1.0 }
      @{
        PRODUCT_ID = 0
        PRODUCT_NAME = [string]$_.PRODUCT_NAME
        PRICE = $price
        QUANTITY = $qty
        TAX_RATE = 19
        TAX_INCLUDED = 'Y'
        MEASURE_CODE = 796
        MEASURE_NAME = 'pcs.'
        SORT = [int]$_.SORT
      }
    })
  }
  $json = ConvertTo-Json -InputObject $payload -Depth 8 -Compress
  $response = Invoke-RestMethod -Method Post -Uri $url -Body $json -ContentType 'application/json; charset=utf-8' -TimeoutSec 25
  if ($null -ne $response.error -and [string]$response.error) {
    throw ("Bitrix {0}: {1}" -f [string]$response.error, [string]$response.error_description)
  }
}

function Convert-BitrixUfToItemField([string]$ufName) {
  $uf = ([string]$ufName).Trim()
  if ($uf -match '^UF_CRM_(\d+)_(.+)$') {
    return ('ufCrm{0}_{1}' -f $Matches[1], $Matches[2])
  }
  return $uf
}

function Get-BitrixNitVariants([string]$nit) {
  $raw = (($nit | ForEach-Object { $_ }) -replace '[\s.]', '').Trim()
  $n = Normalize-Nit $nit
  $list = New-Object System.Collections.Generic.List[string]
  if ($n) { [void]$list.Add($n) }
  # Si el original traía DV, también buscar esa forma en Bitrix
  if ($raw -match '^\d+-\d$' -and $list -notcontains $raw) { [void]$list.Add($raw) }
  $digits = ($n -replace '[^\d]', '')
  if ($digits -and $list -notcontains $digits) { [void]$list.Add($digits) }
  # Sin ceros a la izquierda (en Bitrix a veces guardan 830121927 vs 0830121927)
  $noZeros = $digits.TrimStart('0')
  if ($noZeros -and $list -notcontains $noZeros) { [void]$list.Add($noZeros) }
  return @($list)
}
function Get-BitrixSellerMap {
  $mapFile = Join-Path $Root 'data\bitrix_vendedores.json'
  if (-not (Test-Path $mapFile)) { return @{} }
  try {
    $raw = Get-Content $mapFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    $data = $raw | ConvertFrom-Json
    $map = @{}
    if ($null -eq $data) { return @{} }
    foreach ($p in $data.PSObject.Properties) {
      $map[[string]$p.Name] = [string]$p.Value
    }
    return $map
  } catch {
    return @{}
  }
}

function Test-BitrixKnownSeller($userId, $map) {
  if (-not $userId) { return $false }
  $key = [string]$userId
  return ($map.ContainsKey($key) -and ([string]$map[$key]).Trim() -ne '')
}

function Get-BitrixCompanyFieldValue($company, [string]$fieldName) {
  if ($null -eq $company -or -not $fieldName) { return '' }
  $prop = $company.PSObject.Properties[$fieldName]
  if ($null -eq $prop) { return '' }
  $raw = $prop.Value
  if ($null -eq $raw -or [string]$raw -eq '') { return '' }
  if ($raw -is [System.Collections.IEnumerable] -and -not ($raw -is [string])) {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($x in @($raw)) {
      if ($null -eq $x) { continue }
      if ($x -is [System.Management.Automation.PSObject] -and $null -ne $x.PSObject.Properties['value']) {
        $s = ([string]$x.value).Trim()
      } else {
        $s = ([string]$x).Trim()
      }
      if ($s) { [void]$parts.Add($s) }
    }
    return (($parts.ToArray()) -join ', ').Trim()
  }
  return ([string]$raw).Trim()
}

function Find-BitrixSellerFromCompanyDeals([string]$webhookBase, $companyIds, $sellerMap) {
  foreach ($companyId in @($companyIds)) {
    if (-not $companyId) { continue }
    try {
      $dealList = Invoke-BitrixRest $webhookBase 'crm.deal.list.json' @{
        filter = @{ COMPANY_ID = $companyId }
        select = @('ID', 'ASSIGNED_BY_ID', 'TITLE', 'DATE_CREATE')
        order = @{ ID = 'DESC' }
        start = 0
      }
      $deals = @()
      if ($null -ne $dealList.result) { $deals = @($dealList.result) }
      foreach ($deal in $deals) {
        if ($null -eq $deal) { continue }
        $assigned = $deal.ASSIGNED_BY_ID
        if (Test-BitrixKnownSeller $assigned $sellerMap) {
          return @{
            assigned_by_id = $assigned
            company_id = $companyId
            deal_id = $deal.ID
            source = 'company_deal'
          }
        }
      }
    } catch {}
  }
  return $null
}


function Get-BitrixUserContactInfo([string]$webhookBase, $userId) {
  $uid = ([string]$userId).Trim()
  if (-not $uid) {
    return @{
      ok = $false
      bitrix_user_id = ''
      nombre = ''
      email = ''
      telefono = ''
      codigo = ''
    }
  }

  $cacheFile = Join-Path $Root 'data\bitrix_user_contacts_cache.json'
  $cache = @{}
  if (Test-Path -LiteralPath $cacheFile) {
    try {
      $raw = Get-Content -LiteralPath $cacheFile -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($null -ne $raw) {
        foreach ($p in $raw.PSObject.Properties) {
          $cache[$p.Name] = $p.Value
        }
      }
    } catch {}
  }
  if ($cache.ContainsKey($uid) -and $null -ne $cache[$uid]) {
    try {
      $at = [datetime]::Parse([string]$cache[$uid].cached_at)
      if (((Get-Date) - $at).TotalSeconds -lt 86400) {
        return $cache[$uid]
      }
    } catch {}
  }

  $nombre = ''
  $email = ''
  $telefono = ''
  $ok = $false
  try {
    $resp = Invoke-BitrixRest $webhookBase 'user.get.json' @{ ID = $uid }
    $u = $null
    if ($null -ne $resp.result) {
      if ($resp.result -is [System.Collections.IEnumerable] -and -not ($resp.result -is [string])) {
        foreach ($item in @($resp.result)) { $u = $item; break }
      } else {
        $u = $resp.result
      }
    }
    if ($null -ne $u) {
      $ok = $true
      $parts = @()
      foreach ($k in @('NAME', 'SECOND_NAME', 'LAST_NAME')) {
        $v = ([string]$u.$k).Trim()
        if ($v) { $parts += $v }
      }
      $nombre = ($parts -join ' ').Trim()
      if ($nombre -match '^(?:IZC|VALTECH)\s*V\d+\s*[-–—]?\s*(.*)$') {
        $nombre = $Matches[1].Trim()
      }
      $email = ([string]$u.EMAIL).Trim()
      foreach ($phoneKey in @('PERSONAL_MOBILE', 'WORK_PHONE', 'PERSONAL_PHONE')) {
        $p = Normalize-TelefonoDisplay ([string]$u.$phoneKey)
        if ($p) { $telefono = $p; break }
      }
    }
  } catch {}

  if (-not $nombre) {
    $map = Get-BitrixSellerMap
    if ($map.ContainsKey($uid)) {
      $nombre = ([string]$map[$uid]).Trim()
      if ($nombre -match '^(?:IZC|VALTECH)\s*V\d+\s*[-–—]?\s*(.*)$') {
        $nombre = $Matches[1].Trim()
      }
    }
  }

  $codigo = ''
  try { $codigo = Resolve-AsesorCodigoFromBitrixId $uid } catch { $codigo = '' }

  $out = [pscustomobject]@{
    ok = $ok
    bitrix_user_id = $uid
    nombre = $nombre
    email = $email
    telefono = $telefono
    codigo = $codigo
    cached_at = (Get-Date).ToString('o')
  }
  $cache[$uid] = $out
  try {
    $obj = [ordered]@{}
    foreach ($k in $cache.Keys) { $obj[$k] = $cache[$k] }
    ($obj | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $cacheFile -Encoding UTF8
  } catch {}
  return $out
}

function Get-BitrixUserDisplayName([string]$webhookBase, $userId) {
  if (-not $userId) { return '' }
  $map = Get-BitrixSellerMap
  $key = [string]$userId
  if ($map.ContainsKey($key) -and ([string]$map[$key]).Trim()) {
    return ([string]$map[$key]).Trim()
  }
  try {
    $resp = Invoke-BitrixRest $webhookBase 'user.get.json' @{ ID = $userId }
    $u = $null
    if ($null -ne $resp.result) {
      if ($resp.result -is [System.Collections.IEnumerable] -and -not ($resp.result -is [string])) {
        foreach ($item in @($resp.result)) { $u = $item; break }
      } else {
        $u = $resp.result
      }
    }
    if ($null -eq $u) { return ('ID ' + $userId) }
    $name = ([string]$u.NAME).Trim()
    $last = ([string]$u.LAST_NAME).Trim()
    $second = ([string]$u.SECOND_NAME).Trim()
    $parts = @($name, $second, $last) | Where-Object { $_ }
    if ($parts.Count -gt 0) { return ($parts -join ' ').Trim() }
    if ([string]$u.EMAIL) { return [string]$u.EMAIL }
    return ('ID ' + $userId)
  } catch {}
  return ('ID ' + $userId)
}

function Find-BitrixSellerByNit([string]$webhookBase, $cfg, [string]$nit) {
  $razonField = ([string]$cfg.company_razon_field).Trim()
  if (-not $razonField) { $razonField = 'UF_CRM_1746192546' }
  $nameField = ([string]$cfg.company_name_field).Trim()
  if (-not $nameField) { $nameField = 'UF_CRM_1746192481' }
  $sellerMap = Get-BitrixSellerMap
  $variants = @(Get-BitrixNitVariants $nit)
  if ($variants.Count -eq 0) {
    return @{
      found = $false
      seller_missing = $true
      assigned_by_id = $null
      seller_name = ''
      razon_social = ''
      nit = $nit
      source = 'company'
      warning = 'NIT vacio; no se pudo buscar vendedor en Companias.'
    }
  }

  $companiesFound = New-Object System.Collections.Generic.List[object]
  $bestMapped = $null
  $bestAny = $null

  foreach ($variant in $variants) {
    try {
      $select = @('ID', 'TITLE', 'ASSIGNED_BY_ID', $razonField)
      if ($nameField -and $nameField -ne $razonField) { $select += $nameField }
      $found = Invoke-BitrixRest $webhookBase 'crm.company.list.json' @{
        filter = @{ TITLE = $variant }
        select = $select
      }
      $companies = @()
      if ($null -ne $found.result) { $companies = @($found.result) }
      foreach ($co in $companies) {
        if ($null -eq $co) { continue }
        $assigned = $co.ASSIGNED_BY_ID
        $razon = Get-BitrixCompanyFieldValue $co $nameField
        if (-not $razon) { $razon = Get-BitrixCompanyFieldValue $co $razonField }
        if (-not $razon) { $razon = ([string]$co.TITLE).Trim() }
        $row = @{
          assigned_by_id = $assigned
          razon_social = $razon
          nit_matched = $variant
          company_id = $co.ID
          source = 'company'
        }
        [void]$companiesFound.Add($row)
        if ($assigned -and (Test-BitrixKnownSeller $assigned $sellerMap)) {
          $bestMapped = $row
          break
        }
        if ($assigned -and $null -eq $bestAny) { $bestAny = $row }
        if ($null -eq $bestAny) { $bestAny = $row }
      }
      if ($bestMapped) { break }
    } catch {}
  }

  if ($bestMapped) {
    return @{
      found = $true
      seller_missing = $false
      assigned_by_id = $bestMapped.assigned_by_id
      seller_name = (Get-BitrixUserDisplayName $webhookBase $bestMapped.assigned_by_id)
      razon_social = [string]$bestMapped.razon_social
      nit = $nit
      source = 'company'
      warning = ''
    }
  }

  $companyIds = @($companiesFound | ForEach-Object { $_.company_id } | Where-Object { $_ } | Select-Object -Unique)
  $fromDeal = Find-BitrixSellerFromCompanyDeals $webhookBase $companyIds $sellerMap
  if ($null -ne $fromDeal -and $fromDeal.assigned_by_id) {
    $razon = ''
    foreach ($c in $companiesFound) {
      if ([string]$c.company_id -eq [string]$fromDeal.company_id) {
        $razon = [string]$c.razon_social
        break
      }
    }
    return @{
      found = $true
      seller_missing = $false
      assigned_by_id = $fromDeal.assigned_by_id
      seller_name = (Get-BitrixUserDisplayName $webhookBase $fromDeal.assigned_by_id)
      razon_social = $razon
      nit = $nit
      source = 'company_deal'
      warning = ''
    }
  }

  if ($null -eq $bestAny) {
    return @{
      found = $false
      seller_missing = $true
      assigned_by_id = $null
      seller_name = ''
      razon_social = ''
      nit = $nit
      source = 'company'
      warning = ('El cliente NIT ' + $nit + ' no existe en Companias de Bitrix o no se pudo consultar. Verifica.')
    }
  }

  if (-not $bestAny.assigned_by_id) {
    return @{
      found = $true
      seller_missing = $true
      assigned_by_id = $null
      seller_name = ''
      razon_social = [string]$bestAny.razon_social
      nit = $nit
      source = 'company'
      warning = ('El cliente NIT ' + $nit + ' existe en Companias pero no tiene vendedor IZC asignado. Verifica.')
    }
  }

  $sellerName = Get-BitrixUserDisplayName $webhookBase $bestAny.assigned_by_id
  return @{
    found = $true
    seller_missing = $true
    assigned_by_id = $null
    seller_name = $sellerName
    razon_social = [string]$bestAny.razon_social
    nit = $nit
    source = 'company'
    warning = ('El cliente NIT ' + $nit + ' no tiene un vendedor IZC valido en Companias ni en negociaciones previas (Responsable actual: ' + $sellerName + '). Verifica.')
  }
}

function Get-BitrixStageLabelNorm([string]$name) {
  $s = ([string]$name).Trim().ToUpperInvariant()
  $normalized = $s.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $normalized.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sb.Append($ch)
    }
  }
  $s = $sb.ToString()
  return ($s -replace '\s+', ' ').Trim()
}

function Get-BitrixPipelineStages($cfg) {
  $script:BitrixPipelineStagesCache = $script:BitrixPipelineStagesCache
  if ($null -eq $script:BitrixPipelineStagesCache) { $script:BitrixPipelineStagesCache = @{} }
  $key = ([string]$cfg.webhook_base).Trim() + '|' + ([string]$cfg.category_id).Trim()
  if ($script:BitrixPipelineStagesCache.ContainsKey($key)) {
    return $script:BitrixPipelineStagesCache[$key]
  }
  $stages = @()
  if ($cfg.webhook_base -and $cfg.category_id) {
    $res = Invoke-BitrixRest $cfg.webhook_base 'crm.dealcategory.stage.list.json' @{ id = $cfg.category_id }
    if ($res -and $res.result) { $stages = @($res.result) }
  }
  $script:BitrixPipelineStagesCache[$key] = $stages
  return $stages
}

function Find-BitrixStageId($cfg, [string[]]$labels) {
  $want = @()
  foreach ($label in $labels) {
    $norm = Get-BitrixStageLabelNorm $label
    if ($norm) { $want += $norm }
  }
  if (-not $want.Count) { return '' }
  foreach ($stage in (Get-BitrixPipelineStages $cfg)) {
    $name = Get-BitrixStageLabelNorm ([string]($stage.NAME))
    foreach ($label in $want) {
      if ($name -eq $label -or ($label -and $name.Contains($label))) {
        return ([string]($stage.STATUS_ID)).Trim()
      }
    }
  }
  return ''
}

function Get-BitrixStageIdForEstado($cfg, [string]$estado) {
  $estado = Normalize-QuotePipelineEstado $estado
  if (-not $estado) { $estado = 'cotizado' }
  $cotizado = ([string]$cfg.stage_cotizado).Trim()
  if (-not $cotizado) { $cotizado = ([string]$cfg.stage_id).Trim() }
  if (-not $cotizado) { $cotizado = 'C3:FINAL_INVOICE' }
  $fromCfg = @{
    cotizado = $cotizado
    pendiente = ([string]$cfg.stage_pendiente).Trim()
    seguimiento = ([string]$cfg.stage_seguimiento).Trim()
    vendido = ([string]$cfg.stage_vendido).Trim()
    perdida = ([string]$cfg.stage_perdida).Trim()
    cerrado_modificado = ([string]$cfg.stage_cerrado_modificado).Trim()
  }
  if (-not $fromCfg.seguimiento) { $fromCfg.seguimiento = 'C3:NEW' }
  if (-not $fromCfg.vendido) { $fromCfg.vendido = 'C3:EXECUTING' }
  if (-not $fromCfg.perdida) { $fromCfg.perdida = 'C3:UC_S78RLD' }
  if (-not $fromCfg.pendiente) {
    $found = Find-BitrixStageId $cfg @('PENDIENTE')
    if ($found) { $fromCfg.pendiente = $found } else { $fromCfg.pendiente = 'C3:UC_G99HUH' }
  }
  if (-not $fromCfg.cerrado_modificado) {
    $found = Find-BitrixStageId $cfg @('CERRADO MODIFICADO')
    if ($found) { $fromCfg.cerrado_modificado = $found } else { $fromCfg.cerrado_modificado = 'C3:UC_MGTF3H' }
  }
  $stage = [string]$fromCfg[$estado]
  if (-not $stage) {
    $defaults = @{
      cotizado = $cotizado
      pendiente = 'C3:UC_G99HUH'
      seguimiento = 'C3:NEW'
      vendido = 'C3:EXECUTING'
      perdida = 'C3:UC_S78RLD'
      cerrado_modificado = 'C3:UC_MGTF3H'
    }
    $stage = [string]$defaults[$estado]
  }
  if (-not $stage) { $stage = $cotizado }
  return $stage
}

function Get-BitrixStageDuplicadaRecotizada($cfg) {
  $stage = ([string]$cfg.stage_duplicada_recotizada).Trim()
  if ($stage) { return $stage }
  $found = Find-BitrixStageId $cfg @('DUPLICADA RECOTIZADA', 'DUPLICADA', 'RECOTIZADA')
  if ($found) { return $found }
  return 'C3:UC_M9PUWP'
}

function Get-BitrixStageIdForQuote($cfg, $quote, [string]$estado = 'cotizado') {
  $estado = Normalize-QuotePipelineEstado $estado
  if (-not $estado) { $estado = 'cotizado' }
  if ($estado -eq 'cotizado' -and (Test-QuoteInDuplicadasPanel $quote)) {
    return (Get-BitrixStageDuplicadaRecotizada $cfg)
  }
  return (Get-BitrixStageIdForEstado $cfg $estado)
}

function Sync-BitrixDealStageForQuote($quote, [string]$estado) {
  $out = [ordered]@{
    ok = $false
    skipped = $false
    error = ''
    deal_id = ''
    stage_id = ''
  }
  if ($null -eq $quote) {
    $out.error = 'Cotización inválida.'
    return $out
  }
  $cfg = Read-BitrixConfig
  if (-not $cfg.enabled -or -not $cfg.webhook_base) {
    $out.skipped = $true
    $out.error = 'Bitrix desactivado.'
    return $out
  }
  $stageId = Get-BitrixStageIdForQuote $cfg $quote $estado
  $out.stage_id = $stageId
  if (-not $stageId) {
    $out.error = 'Sin STAGE_ID para el estado.'
    return $out
  }
  $dealId = ([string]$quote.bitrix_deal_id).Trim()
  if (-not $dealId) {
    try {
      $resolved = Resolve-BitrixDealIdForQuote $quote $true
      if ($resolved) { $dealId = [string]$resolved }
    } catch {}
  }
  if (-not $dealId) {
    $out.error = 'La cotización no tiene negociación en Bitrix.'
    return $out
  }
  $out.deal_id = $dealId
  $fields = @{ STAGE_ID = $stageId }
  try {
    $result = Invoke-BitrixRest $cfg.webhook_base 'crm.deal.update.json' @{
      id = [int]$dealId
      fields = $fields
    }
    if ($result.error) {
      $err = $(if ($result.error_description) { [string]$result.error_description } else { [string]$result.error })
      $code = ([string]$result.error).ToUpperInvariant()
      if ($code -eq 'ERROR_WRONG_AUTH' -or $code -eq 'WRONG_AUTH' -or $err -match 'credential') {
        $err = 'Webhook Bitrix invalido o revocado. En Admin > Bitrix pega un webhook nuevo, pulsa Probar y Guardar.'
      }
      $out.error = $err
      return $out
    }
  } catch {
    $msg = [string]$_.Exception.Message
    if ($msg -match 'credential|WRONG_AUTH|ERROR_WRONG_AUTH') {
      $msg = 'Webhook Bitrix invalido o revocado. En Admin > Bitrix pega un webhook nuevo, pulsa Probar y Guardar.'
    }
    $out.error = $msg
    return $out
  }
  $out.ok = $true
  return $out
}

function Send-BitrixDeal($quote) {
  $cfg = Read-BitrixConfig
  if (-not $cfg.enabled) {
    return @{ ok = $false; skipped = $true; error = 'Bitrix desactivado.' }
  }
  if (-not $cfg.webhook_base -or -not $cfg.stage_id) {
    return @{ ok = $false; skipped = $true; error = 'Falta webhook o STAGE_ID de Bitrix.' }
  }

  $dealCurrency = Get-BitrixDealCurrency $quote $cfg.currency_id
  $opportunity = Get-BitrixOpportunity $quote $dealCurrency
  $nit = [string]$quote.nit
  $nombre = [string]$quote.nombre

  $sellerInfo = @{
    found = $false
    seller_missing = $true
    assigned_by_id = $null
    seller_name = ''
    razon_social = ''
    warning = ''
  }
  # Prioridad: código del asesor que cotizó (evita dueño del webhook / NIT previo).
  $sellerCodigo = Normalize-AsesorCodigo ([string]$(if ($null -ne $quote.seller_codigo) { $quote.seller_codigo } elseif ($null -ne $quote.asesor_cotizado_by) { $quote.asesor_cotizado_by } else { '' }))
  $forcedAssigned = $null
  if ($sellerCodigo) {
    $ids = @(Get-AsesorBitrixIds $sellerCodigo)
    if ($ids.Count -gt 0) { $forcedAssigned = [string]$ids[0] }
  }
  if (-not $forcedAssigned -and $null -ne $quote.assigned_by_id -and [string]$quote.assigned_by_id -ne '') {
    $forcedAssigned = [string]$quote.assigned_by_id
  }
  $quoteSource = ([string]$quote.quote_source).Trim().ToLowerInvariant()
  if ($forcedAssigned) {
    $forcedName = ([string]$quote.seller_name).Trim()
    if (-not $forcedName) {
      $map = Get-BitrixVendedoresMap
      if ($map.ContainsKey($forcedAssigned)) { $forcedName = ([string]$map[$forcedAssigned]).Trim() }
    }
    if (-not $forcedName) { $forcedName = Get-BitrixUserDisplayName $cfg.webhook_base $forcedAssigned }
    $sellerInfo = @{
      found = $true
      seller_missing = $false
      assigned_by_id = $forcedAssigned
      seller_name = $forcedName
      razon_social = ''
      warning = ''
      source = $(if ($sellerCodigo) { 'asesor' } else { 'quote' })
    }
  } elseif ($sellerCodigo -or $quoteSource -eq 'asesor') {
    return @{
      ok = $false
      skipped = $false
      error = ('Asesor sin ID Bitrix mapeado (' + $(if ($sellerCodigo) { $sellerCodigo } else { 'asesor' }) + ').')
      seller_missing = $true
      seller_name = ''
      seller_warning = 'No se asignó responsable por NIT para evitar dueño incorrecto del webhook.'
    }
  } else {
    try {
      $sellerInfo = Find-BitrixSellerByNit $cfg.webhook_base $cfg $nit
    } catch {
      $sellerInfo = @{
        found = $false
        seller_missing = $true
        assigned_by_id = $null
        seller_name = ''
        razon_social = ''
        warning = ('No se pudo consultar vendedor en Companias: ' + $_.Exception.Message)
      }
    }
  }

  $assignId = $null
  if ($sellerInfo.assigned_by_id) { $assignId = [string]$sellerInfo.assigned_by_id }
  $companyId = $null
  $contactId = $null
  try {
    $companyId = Ensure-BitrixCompany $cfg.webhook_base $nit $nombre $assignId
    $contactId = Ensure-BitrixContact $cfg.webhook_base $nombre $companyId $nit $assignId
  } catch {
    return @{
      ok = $false
      skipped = $false
      error = ('No se pudo crear Compania/Contacto: ' + $_.Exception.Message)
      seller_missing = [bool]$sellerInfo.seller_missing
      seller_name = [string]$sellerInfo.seller_name
      seller_warning = [string]$sellerInfo.warning
    }
  }

  $marcaId = $null
  try { $marcaId = Get-QuoteMarcaId $cfg.webhook_base $cfg $quote } catch { $marcaId = $null }

  $stageForCreate = Get-BitrixStageIdForQuote $cfg $quote 'cotizado'
  if (-not $stageForCreate) { $stageForCreate = [string]$cfg.stage_id }
  $fields = @{
    STAGE_ID = $stageForCreate
    OPPORTUNITY = $opportunity
    CURRENCY_ID = $dealCurrency
    COMMENTS = (Format-BitrixQuoteComments $quote)
    OPENED = 'Y'
  }
  if ($cfg.category_id) {
    try { $fields.CATEGORY_ID = [int]$cfg.category_id } catch { $fields.CATEGORY_ID = $cfg.category_id }
  }
  if ($companyId) { $fields.COMPANY_ID = $companyId }
  if ($contactId) {
    $fields.CONTACT_ID = $contactId
    $fields.CONTACT_IDS = @($contactId)
  }
  if ($marcaId -and $cfg.marca_field) {
    $fields[[string]$cfg.marca_field] = $marcaId
  }
  $quoteOriginId = [string]$quote.id
  if ($quoteOriginId) {
    $fields.ORIGIN_ID = $quoteOriginId
    $fields.ORIGINATOR_ID = 'IZC'
  }
  if ($sellerInfo.assigned_by_id) {
    try { $fields.ASSIGNED_BY_ID = [int]$sellerInfo.assigned_by_id } catch { $fields.ASSIGNED_BY_ID = $sellerInfo.assigned_by_id }
  }

  try {
    $result = Invoke-BitrixRest $cfg.webhook_base 'crm.deal.add.json' @{ fields = $fields }
    $dealId = $null
    if ($null -ne $result.result) { $dealId = [string]$result.result }
    if (-not $dealId) {
      return @{ ok = $false; skipped = $false; error = 'Bitrix no devolvio ID de negociacion.'; raw = $result }
    }

    # Titulo en espanol sin acentos (evita mojibake en form-urlencoded)
    $updateFields = @{ TITLE = ('Negociacion #{0}' -f $dealId) }
    if ($sellerInfo.assigned_by_id) {
      try { $updateFields.ASSIGNED_BY_ID = [int]$sellerInfo.assigned_by_id } catch { $updateFields.ASSIGNED_BY_ID = $sellerInfo.assigned_by_id }
    }
    try {
      Invoke-BitrixRest $cfg.webhook_base 'crm.deal.update.json' @{
        id = $dealId
        fields = $updateFields
      } | Out-Null
    } catch {}
    # Quitar Observadores (p.ej. usuario del webhook). El responsable/vendedor se mantiene.
    Clear-BitrixDealObservers $cfg.webhook_base $dealId

    if ($contactId) {
      try {
        Invoke-BitrixRest $cfg.webhook_base 'crm.deal.contact.add.json' @{
          id = $dealId
          fields = @{
            CONTACT_ID = $contactId
            IS_PRIMARY = 'Y'
          }
        } | Out-Null
      } catch {}
    }

    $productRows = @()
    $productsOk = $false
    $productsError = ''
    try {
      $productRows = @(Build-BitrixProductRows $quote $dealCurrency)
      Set-BitrixDealProducts $cfg.webhook_base $dealId $productRows
      $productsOk = $true
    } catch {
      $productsOk = $false
      $productsError = ('Negocio creado, pero Productos fallo: ' + $_.Exception.Message)
    }

    return @{
      ok = $true
      skipped = $false
      deal_id = $dealId
      company_id = $companyId
      contact_id = $contactId
      marca_id = $marcaId
      products_ok = $productsOk
      error = $productsError
      assigned_by_id = $sellerInfo.assigned_by_id
      seller_name = [string]$sellerInfo.seller_name
      seller_missing = [bool]$sellerInfo.seller_missing
      seller_warning = [string]$sellerInfo.warning
      razon_social = [string]$sellerInfo.razon_social
    }
  } catch {
    return @{
      ok = $false
      skipped = $false
      error = $_.Exception.Message
      seller_missing = [bool]$sellerInfo.seller_missing
      seller_name = [string]$sellerInfo.seller_name
      seller_warning = [string]$sellerInfo.warning
    }
  }
}

function Test-LikelyBitrixDealId([string]$val) {
  $s = ([string]$val).Trim()
  if (-not $s) { return $false }
  if ($s -notmatch '^\d+$') { return $false }
  if ($s.Length -gt 12) { return $false }
  if ($s -match '^20\d{6,}') { return $false }
  return $true
}

function Resolve-BitrixDealIdForQuote($quote, [bool]$persist = $true) {
  if ($null -eq $quote) { return '' }
  $quoteId = [string]$quote.id
  if ($quoteId) {
    foreach ($q in (Read-Quotes)) {
      if ([string]$q.id -eq $quoteId) { $quote = $q; break }
    }
  }
  $existing = [string]$quote.bitrix_deal_id
  if ($existing -and (Test-LikelyBitrixDealId $existing)) { return $existing.Trim() }
  if (-not $quoteId) { return '' }
  $cfg = Read-BitrixConfig
  if (-not $cfg.enabled -or -not $cfg.webhook_base) { return '' }
  $webhook = $cfg.webhook_base
  $dealId = ''

  function Try-DealFilter($filter) {
    if ($script:dealIdLocal) { return }
    try {
      $found = Invoke-BitrixRest $webhook 'crm.deal.list.json' @{
        filter = $filter
        select = @('ID', 'TITLE', 'ORIGIN_ID', 'DATE_CREATE', 'COMPANY_ID')
        order = @{ ID = 'DESC' }
        start = 0
      }
      $rows = @()
      if ($null -ne $found.result) { $rows = @($found.result) }
      if ($rows.Count -gt 0 -and $rows[0].ID -and (Test-LikelyBitrixDealId ([string]$rows[0].ID))) {
        $script:dealIdLocal = [string]$rows[0].ID
      }
    } catch {}
  }

  $script:dealIdLocal = ''
  Try-DealFilter @{ ORIGIN_ID = $quoteId }
  Try-DealFilter @{ '%COMMENTS' = ('ID IZC: ' + $quoteId) }
  Try-DealFilter @{ '%COMMENTS' = $quoteId }
  $dealId = $script:dealIdLocal

  if (-not $dealId) {
    $nit = Normalize-Nit ([string]$quote.nit)
    $companyId = $null
    if ($nit) {
      try {
        $companies = Invoke-BitrixRest $webhook 'crm.company.list.json' @{
          filter = @{ TITLE = $nit }
          select = @('ID', 'TITLE')
        }
        if ($null -ne $companies.result -and @($companies.result).Count -gt 0) {
          $companyId = [string](@($companies.result)[0].ID)
        }
      } catch {}
    }
    if ($companyId) {
      try {
        $found = Invoke-BitrixRest $webhook 'crm.deal.list.json' @{
          filter = @{ COMPANY_ID = $companyId }
          select = @('ID', 'TITLE', 'DATE_CREATE', 'COMMENTS')
          order = @{ ID = 'DESC' }
          start = 0
        }
        $rows = @()
        if ($null -ne $found.result) { $rows = @($found.result) }
        $quoteDay = ''
        $created = [string]$quote.created_at
        if ($created -match '^(\d{4}-\d{2}-\d{2})') { $quoteDay = $Matches[1] }
        $idHead = ($quoteId -split '-')[0]
        foreach ($row in $rows) {
          if ($null -eq $row -or -not $row.ID) { continue }
          $comments = [string]$row.COMMENTS
          if ($comments -and ($comments.Contains($quoteId) -or ($idHead -and $comments.Contains($idHead)))) {
            $dealId = [string]$row.ID
            break
          }
          if ($quoteDay) {
            $dc = [string]$row.DATE_CREATE
            if ($dc -and $dc.StartsWith($quoteDay)) {
              $dealId = [string]$row.ID
              break
            }
          }
        }
        if (-not $dealId -and $rows.Count -eq 1 -and $rows[0].ID) {
          $dealId = [string]$rows[0].ID
        }
      } catch {}
    }
  }

  if (-not $dealId -or -not $persist) { return $dealId }

  $rewritten = New-Object System.Collections.Generic.List[object]
  $changed = $false
  foreach ($q in (Read-Quotes)) {
    if ([string]$q.id -eq $quoteId) {
      $row = [ordered]@{}
      if ($q -is [System.Collections.IDictionary]) {
        foreach ($k in @($q.Keys)) { $row[$k] = $q[$k] }
      } else {
        foreach ($p in @($q.PSObject.Properties)) { $row[$p.Name] = $p.Value }
      }
      $row['bitrix_deal_id'] = $dealId
      [void]$rewritten.Add($row)
      $changed = $true
    } else {
      [void]$rewritten.Add($q)
    }
  }
  if ($changed) { Write-Quotes $rewritten.ToArray() }
  return $dealId
}

function Ensure-BitrixDealIdForQuote($quote) {
  $quoteId = ''
  if ($null -ne $quote) { $quoteId = ([string]$quote.id).Trim() }
  if ($quoteId) {
    foreach ($q in (Read-Quotes)) {
      if ([string]$q.id -eq $quoteId) { $quote = $q; break }
    }
  }
  $dealId = Resolve-BitrixDealIdForQuote $quote $true
  if ($dealId -and (Test-LikelyBitrixDealId $dealId)) {
    return @{ ok = $true; deal_id = $dealId; created = $false; error = '' }
  }
  if (-not $quoteId) {
    return @{ ok = $false; deal_id = ''; created = $false; error = 'Cotización sin id.' }
  }
  $full = $quote
  $bitrix = $null
  try {
    $bitrix = Send-BitrixDeal $full
  } catch {
    return @{ ok = $false; deal_id = ''; created = $false; error = ('Bitrix: ' + $_.Exception.Message) }
  }
  $dealId = ''
  if ($null -ne $bitrix -and $bitrix.deal_id) { $dealId = [string]$bitrix.deal_id }
  if (-not (Test-LikelyBitrixDealId $dealId)) {
    $err = ''
    if ($null -ne $bitrix) { $err = [string]$bitrix.error }
    if (-not $err -and $null -ne $bitrix -and $bitrix.skipped) {
      $err = 'Bitrix no está activo o no está configurado.'
    }
    if (-not $err) { $err = 'No se pudo crear la negociación en Bitrix.' }
    return @{ ok = $false; deal_id = ''; created = $false; error = $err }
  }
  $rewritten = New-Object System.Collections.Generic.List[object]
  foreach ($q in (Read-Quotes)) {
    if ([string]$q.id -eq $quoteId) {
      $row = [ordered]@{}
      if ($q -is [System.Collections.IDictionary]) {
        foreach ($k in @($q.Keys)) { $row[$k] = $q[$k] }
      } else {
        foreach ($p in @($q.PSObject.Properties)) { $row[$p.Name] = $p.Value }
      }
      $row['bitrix_deal_id'] = $dealId
      [void]$rewritten.Add($row)
    } else {
      [void]$rewritten.Add($q)
    }
  }
  Write-Quotes $rewritten.ToArray()
  return @{ ok = $true; deal_id = $dealId; created = $true; error = '' }
}

function Send-Json($response, $obj, [int]$code = 200) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 8))
  $response.StatusCode = $code
  $response.ContentType = 'application/json; charset=utf-8'
  $response.Headers.Add('Cache-Control', 'no-store')
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

function Read-SessionBridge {
  if (-not (Test-Path $SessionBridgeFile)) {
    return [ordered]@{ nit = ''; nombre = ''; updated_at = '' }
  }
  try {
    $raw = Get-Content $SessionBridgeFile -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return [ordered]@{ nit = ''; nombre = ''; updated_at = '' }
    }
    $data = $raw | ConvertFrom-Json
    return [ordered]@{
      nit = Normalize-Nit ([string]$data.nit)
      nombre = ([string]$data.nombre).Trim()
      updated_at = [string]$data.updated_at
    }
  } catch {
    return [ordered]@{ nit = ''; nombre = ''; updated_at = '' }
  }
}

function Write-SessionBridge([string]$nit, [string]$nombre) {
  $dir = Split-Path $SessionBridgeFile -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $entry = [ordered]@{
    nit = Normalize-Nit $nit
    nombre = ([string]$nombre).Trim()
    updated_at = (Get-Date).ToString('o')
  }
  $json = ($entry | ConvertTo-Json -Depth 4 -Compress:$false)
  [System.IO.File]::WriteAllText($SessionBridgeFile, $json + "`n", [System.Text.UTF8Encoding]::new($false))
  return $entry
}

function Get-Mime([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { return 'text/html; charset=utf-8' }
    '.css'  { return 'text/css; charset=utf-8' }
    '.js'   { return 'application/javascript; charset=utf-8' }
    '.json' { return 'application/json; charset=utf-8' }
    '.png'  { return 'image/png' }
    '.jpg'  { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.gif'  { return 'image/gif' }
    '.svg'  { return 'image/svg+xml' }
    '.ico'  { return 'image/x-icon' }
    '.webp' { return 'image/webp' }
    '.mp4'  { return 'video/mp4' }
    '.webm' { return 'video/webm' }
    '.woff' { return 'font/woff' }
    '.woff2'{ return 'font/woff2' }
    '.xls'  { return 'application/vnd.ms-excel' }
    '.xlsx' { return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    default { return 'application/octet-stream' }
  }
}

function Handle-Auth($request, $response) {
  if ($request.HttpMethod -eq 'OPTIONS') {
    $response.StatusCode = 204
    $response.Headers.Add('Access-Control-Allow-Origin', '*')
    $response.Headers.Add('Access-Control-Allow-Methods', 'POST, OPTIONS')
    $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
    $response.Close()
    return
  }

  if ($request.HttpMethod -ne 'POST') {
    Send-Json $response @{ ok = $false; error = 'Metodo no permitido' } 405
    return
  }

  $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
  $raw = $reader.ReadToEnd()
  $reader.Close()
  try { $body = $raw | ConvertFrom-Json } catch { $body = $null }
  if (-not $body) {
    Send-Json $response @{ ok = $false; error = 'JSON invalido' } 400
    return
  }

  $action = ([string]$body.action).Trim()
  $nit = Normalize-Nit ([string]$body.nit)
  $password = [string]$body.password
  $nombre = ([string]$body.nombre).Trim()
  if (-not $nombre) { $nombre = ([string]$body.name).Trim() }
  $contactoNombre = ([string]$body.contacto_nombre).Trim()
  if (-not $contactoNombre) { $contactoNombre = ([string]$body.nombre_contacto).Trim() }
  $contactoTel = Normalize-TelefonoDisplay ([string]$body.contacto_telefono)
  if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$body.telefono_contacto) }
  if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$body.telefono) }

  if ($action -eq 'register') {
    if (-not $nombre -or $nombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa el nombre de la empresa (minimo 2 caracteres).' } 400
      return
    }
    if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido. Usa solo numeros (sin digito de verificacion).' } 400
      return
    }
    if (-not $contactoTel -or (($contactoTel -replace '\D','').Length -lt 7)) {
      Send-Json $response @{ ok = $false; error = 'Ingresa un numero de contacto valido.' } 400
      return
    }
    if (-not $contactoNombre -or $contactoNombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa el nombre del contacto (minimo 2 caracteres).' } 400
      return
    }
    if ($password.Length -lt 4) {
      Send-Json $response @{ ok = $false; error = 'La contrasena debe tener al menos 4 caracteres.' } 400
      return
    }
    $users = New-Object System.Collections.Generic.List[object]
    foreach ($u in (Read-Users)) { $users.Add($u) }
    foreach ($u in $users) {
      if ((Normalize-Nit ([string]$u.nit)) -eq $nit) {
        Send-Json $response @{ ok = $false; error = 'Este NIT ya esta registrado.' } 409
        return
      }
    }
    $users.Add((Protect-UserRecord ([pscustomobject]@{
      nit = $nit
      nombre = $nombre
      contacto_nombre = $contactoNombre
      contacto_telefono = $contactoTel
      telefono = $contactoTel
      password = $password
      created_at = (Get-Date).ToString('o')
    })))
    Write-Users $users.ToArray()
    Send-Json $response @{
      ok = $true
      nit = $nit
      nombre = $nombre
      contacto_nombre = $contactoNombre
      contacto_telefono = $contactoTel
      message = 'Registro exitoso.'
    }
    return
  }

  if ($action -eq 'login') {
    $rawLogin = [string]$body.nit
    $loginId = Normalize-AsesorCodigo $rawLogin
    if (-not $loginId) { $loginId = $nit }
    $satKey = ($rawLogin -replace '[\s.]', '').ToUpperInvariant()
    if ($satKey -eq 'SAT' -or $satKey -eq 'ADMINSAT') {
      $foundSat = $null
      foreach ($u in (Read-Users)) {
        if ($null -eq $u) { continue }
        $un = ([string]$u.nit -replace '[\s.]', '').ToUpperInvariant()
        if ($un -eq 'SAT' -or $un -eq 'ADMINSAT') { $foundSat = $u; break }
      }
      if (-not $foundSat -or -not (Test-PasswordHash $password $foundSat)) {
        Send-Json $response @{ ok = $false; error = 'Usuario o contrasena incorrectos.' } 401
        return
      }
      $satNombre = ([string]$foundSat.nombre).Trim()
      if (-not $satNombre) { $satNombre = 'Admin SAT' }
      Send-Json $response @{
        ok = $true
        nit = 'SAT'
        nombre = $satNombre
        role = 'sat'
        message = 'Sesion iniciada.'
      }
      return
    }
    if (-not $loginId -or -not $password) {
      Send-Json $response @{ ok = $false; error = 'Ingresa usuario y contrasena.' } 400
      return
    }

    $gpCode = Normalize-GpCodigo $loginId
    if (-not $gpCode) { $gpCode = Normalize-GpCodigo $rawLogin }
    if (-not $gpCode) { $gpCode = Normalize-GpCodigo $nit }
    if ($gpCode) {
      $gp = Find-GerenteProducto (Read-GerentesProducto) $gpCode
      if (-not $gp) {
        Send-Json $response @{ ok = $false; error = 'Ese GP no esta registrado. Usa Registro GP.' } 401
        return
      }
      if (-not (Test-PasswordHash $password $gp)) {
        Send-Json $response @{ ok = $false; error = 'Usuario o contrasena incorrectos.' } 401
        return
      }
      $gpNombre = ([string]$gp.nombre).Trim()
      if (-not $gpNombre) { $gpNombre = $gpCode }
      Send-Json $response @{
        ok = $true
        nit = $gpCode
        nombre = $gpNombre
        role = 'gp'
        message = 'Sesion iniciada.'
      }
      return
    }

    $asesorCode = Normalize-AsesorCodigo $loginId
    if ($asesorCode) {
      $asesores = As-ObjectList (Read-Asesores)
      $asesor = Find-Asesor $asesores $asesorCode
      if (-not $asesor -or -not (Test-PasswordHash $password $asesor)) {
        Send-Json $response @{ ok = $false; error = 'Usuario o contrasena incorrectos.' } 401
        return
      }
      $asesorNombre = ([string]$asesor.nombre).Trim()
      if (-not $asesorNombre) { $asesorNombre = $asesorCode }
      Send-Json $response @{
        ok = $true
        nit = $asesorCode
        nombre = $asesorNombre
        role = 'asesor'
        message = 'Sesion iniciada.'
      }
      return
    }

    $users = New-Object System.Collections.Generic.List[object]
    foreach ($u in (Read-Users)) { $users.Add($u) }
    $found = $null
    $foundIndex = -1
    for ($i = 0; $i -lt $users.Count; $i++) {
      if ((Normalize-Nit ([string]$users[$i].nit)) -eq $nit) {
        $found = $users[$i]
        $foundIndex = $i
        break
      }
    }
    if (-not $found -or -not (Test-PasswordHash $password $found)) {
      Send-Json $response @{ ok = $false; error = 'NIT o contrasena incorrectos.' } 401
      return
    }

    # Migrar texto plano a hash si aplica
    if (-not [string]$found.password_hash) {
      $users[$foundIndex] = Protect-UserRecord ([pscustomobject]@{
        nit = [string]$found.nit
        nombre = [string]$found.nombre
        password = $password
        created_at = [string]$found.created_at
      })
      Write-Users $users.ToArray()
      $found = $users[$foundIndex]
    }

    $foundNombre = ([string]$found.nombre).Trim()
    $role = 'cliente'
    if (Test-IsAdminNit $nit) { $role = 'admin' }
    Send-Json $response @{ ok = $true; nit = [string]$found.nit; nombre = $foundNombre; role = $role; message = 'Sesion iniciada.' }
    return
  }

  if ($action -eq 'register_asesor') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $codigo = Normalize-AsesorCodigo ([string]$body.codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesorPass = [string]$body.password
    $asesorNombre = ([string]$body.nombre).Trim()
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Codigo de vendedor invalido. Usa V1, V2, V31, ADV, etc.' } 400
      return
    }
    if ($asesorPass.Length -lt 4) {
      Send-Json $response @{ ok = $false; error = 'La contrasena debe tener al menos 4 caracteres.' } 400
      return
    }
    if (-not $asesorNombre) { $asesorNombre = $codigo }
    $asesores = New-Object System.Collections.Generic.List[object]
    foreach ($a in (As-ObjectList (Read-Asesores))) { $asesores.Add($a) }
    if (Find-Asesor $asesores $codigo) {
      Send-Json $response @{ ok = $false; error = ('El asesor ' + $codigo + ' ya esta registrado.') } 409
      return
    }
    $asesores.Add([pscustomobject]@{
      codigo = $codigo
      nombre = $asesorNombre
      password = $asesorPass
      created_at = (Get-Date).ToString('o')
    })
    Write-Asesores $asesores.ToArray()
    Send-Json $response @{
      ok = $true
      codigo = $codigo
      nombre = $asesorNombre
      message = ('Asesor ' + $codigo + ' registrado.')
    }
    return
  }

  if ($action -eq 'update_cliente_nombre' -or $action -eq 'update_user_nombre' -or $action -eq 'set_cliente_nombre') {
    $clientNit = Normalize-Nit ([string]$body.nit)
    $nombre = ([string]$body.nombre).Trim()
    if (-not $nombre) { $nombre = ([string]$body.name).Trim() }
    if (-not $clientNit -or $clientNit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    if ((Test-IsAdminNit $clientNit) -or $clientNit -eq 'ZKTECO') {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    if (-not $nombre -or $nombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa un nombre valido (minimo 2 caracteres).' } 400
      return
    }
    if ($nombre.Length -gt 80) {
      Send-Json $response @{ ok = $false; error = 'El nombre es demasiado largo (max. 80).' } 400
      return
    }
    $users = New-Object System.Collections.Generic.List[object]
    $found = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($u in (Read-Users)) {
      if ($null -eq $u) { continue }
      if ((Normalize-Nit ([string]$u.nit)) -ne $clientNit) {
        [void]$users.Add($u)
        continue
      }
      $role = ([string]$u.role).Trim().ToLowerInvariant()
      if ($role -eq 'admin' -or $role -eq 'zkteco' -or $role -eq 'zebra' -or $role -eq 'asesor') {
        Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
        return
      }
      $copy = [ordered]@{}
      if ($u -is [System.Collections.IDictionary]) {
        foreach ($k in @($u.Keys)) { $copy[$k] = $u[$k] }
      } else {
        foreach ($p in @($u.PSObject.Properties)) { $copy[$p.Name] = $p.Value }
      }
      $copy['nombre'] = $nombre
      $copy['nombre_updated_at'] = $savedAt
      [void]$users.Add([pscustomobject]$copy)
      $found = $true
    }
    if (-not $found) {
      Send-Json $response @{ ok = $false; error = 'Usuario no encontrado.' } 404
      return
    }
    Write-Users $users.ToArray()
    Send-Json $response @{
      ok = $true
      nit = $clientNit
      nombre = $nombre
      message = 'Nombre actualizado.'
    }
    return
  }

  if ($action -eq 'update_admin_nombre' -or $action -eq 'set_admin_nombre') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not $adminNit) { $adminNit = Normalize-Nit ([string]$body.nit) }
    $nombre = ([string]$body.nombre).Trim()
    if (-not $nombre) { $nombre = ([string]$body.name).Trim() }
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    if (-not $nombre -or $nombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa un nombre valido (minimo 2 caracteres).' } 400
      return
    }
    if ($nombre.Length -gt 80) {
      Send-Json $response @{ ok = $false; error = 'El nombre es demasiado largo (max. 80).' } 400
      return
    }
    $users = New-Object System.Collections.Generic.List[object]
    $found = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($u in (Read-Users)) {
      if ($null -eq $u) { continue }
      if ((Normalize-Nit ([string]$u.nit)) -ne $adminNit) {
        [void]$users.Add($u)
        continue
      }
      $copy = [ordered]@{}
      if ($u -is [System.Collections.IDictionary]) {
        foreach ($k in @($u.Keys)) { $copy[$k] = $u[$k] }
      } else {
        foreach ($p in @($u.PSObject.Properties)) { $copy[$p.Name] = $p.Value }
      }
      $copy['nombre'] = $nombre
      $copy['nombre_updated_at'] = $savedAt
      $copy['role'] = 'admin'
      [void]$users.Add([pscustomobject]$copy)
      $found = $true
    }
    if (-not $found) {
      Send-Json $response @{ ok = $false; error = 'Usuario administrador no encontrado.' } 404
      return
    }
    Write-Users $users.ToArray()
    Send-Json $response @{
      ok = $true
      nit = $adminNit
      nombre = $nombre
      message = 'Nombre actualizado.'
    }
    return
  }

  if ($action -eq 'update_asesor_nombre' -or $action -eq 'set_asesor_nombre') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.codigo) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $nombre = ([string]$body.nombre).Trim()
    if (-not $nombre) { $nombre = ([string]$body.name).Trim() }
    if (-not $nombre -or $nombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa un nombre válido (mínimo 2 caracteres).' } 400
      return
    }
    if ($nombre.Length -gt 80) {
      Send-Json $response @{ ok = $false; error = 'El nombre es demasiado largo (máx. 80).' } 400
      return
    }
    $list = New-Object System.Collections.Generic.List[object]
    $found = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($a in (As-ObjectList (Read-Asesores))) {
      if ($null -eq $a) { continue }
      if ((Normalize-AsesorCodigo ([string]$a.codigo)) -ne $codigo) {
        [void]$list.Add($a)
        continue
      }
      $copy = [ordered]@{}
      if ($a -is [System.Collections.IDictionary]) {
        foreach ($k in @($a.Keys)) { $copy[$k] = $a[$k] }
      } else {
        foreach ($p in @($a.PSObject.Properties)) { $copy[$p.Name] = $p.Value }
      }
      $copy['nombre'] = $nombre
      $copy['nombre_updated_at'] = $savedAt
      [void]$list.Add($copy)
      $found = $true
    }
    if (-not $found) {
      Send-Json $response @{ ok = $false; error = 'Asesor no encontrado.' } 404
      return
    }
    Write-Asesores $list.ToArray()
    Send-Json $response @{
      ok = $true
      codigo = $codigo
      nombre = $nombre
      message = 'Nombre actualizado.'
    }
    return
  }

  if ($action -eq 'list_asesores') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $safe = New-Object System.Collections.Generic.List[object]
    foreach ($a in (As-ObjectList (Read-Asesores))) {
      $code = Normalize-AsesorCodigo ([string]$a.codigo)
      if (-not $code) { continue }
      [void]$safe.Add([ordered]@{
        codigo = $code
        nombre = ([string]$a.nombre).Trim()
        created_at = [string]$a.created_at
      })
    }
    $sortedAsesores = @($safe.ToArray() | Sort-Object `
      @{ Expression = {
          $c = [string]$_.codigo
          if ($c -match '(\d+)') { [int]$Matches[1] } else { [int]::MaxValue }
        }; Ascending = $true }, `
      @{ Expression = { [string]$_.codigo }; Ascending = $true })
    Send-Json $response @{ ok = $true; asesores = @($sortedAsesores); count = @($sortedAsesores).Count }
    return
  }

  if ($action -eq 'delete_asesor') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $codigo = Normalize-AsesorCodigo ([string]$body.codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Codigo de asesor invalido.' } 400
      return
    }
    $kept = New-Object System.Collections.Generic.List[object]
    $removed = $false
    foreach ($a in (As-ObjectList (Read-Asesores))) {
      if ((Normalize-AsesorCodigo ([string]$a.codigo)) -eq $codigo) {
        $removed = $true
        continue
      }
      $kept.Add($a)
    }
    if (-not $removed) {
      Send-Json $response @{ ok = $false; error = 'Asesor no encontrado.' } 404
      return
    }
    Write-Asesores $kept.ToArray()
    Send-Json $response @{ ok = $true; message = ('Asesor ' + $codigo + ' eliminado.') }
    return
  }

  if ($action -eq 'list_clientes_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $force = $false
    $fast = $false
    try {
      if ($body.refresh_bitrix -or $body.sync_bitrix -or $body.force) { $force = $true }
    } catch {}
    try {
      if ($body.fast) { $fast = $true }
    } catch {}
    try {
      $merged = Get-AsesorClientesMerged $codigo ([bool]$force) ($fast -and -not $force)
    } catch {
      Send-Json $response @{ ok = $false; error = [string]$_.Exception.Message } 500
      return
    }
    try {
      $clientesList = $merged.clientes
      $sync = $merged.sync
      $clientes = New-Object System.Collections.ArrayList
      foreach ($row in (As-ObjectList $clientesList)) {
        if ($null -ne $row) { [void]$clientes.Add($row) }
      }
      Send-Json $response @{
        ok = $true
        codigo = $codigo
        clientes = @($clientes)
        count = $clientes.Count
        bitrix_synced = [bool]$sync.synced
        bitrix_from_cache = [bool]$sync.from_cache
        bitrix_count = [int]$sync.bitrix_count
        bitrix_fetched_at = [string]$sync.fetched_at
        bitrix_error = [string]$sync.error
      }
    } catch {
      Send-Json $response @{ ok = $false; error = [string]$_.Exception.Message } 500
    }
    return
  }

  if ($action -eq 'register_cliente_asesor' -or $action -eq 'add_cliente_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $clientNit = Normalize-Nit ([string]$body.client_nit)
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.cliente_nit) }
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.nit_cliente) }
    $nombre = ([string]$body.nombre).Trim()
    if (-not $nombre) { $nombre = ([string]$body.cliente_nombre).Trim() }
    if (-not $nombre) { $nombre = ([string]$body.name).Trim() }
    $telefono = Normalize-TelefonoDisplay ([string]$body.telefono)
    if (-not $telefono) { $telefono = Normalize-TelefonoDisplay ([string]$body.phone) }
    $digitsOnly = ($clientNit -replace '[^\d]', '')
    if (-not $clientNit -or $digitsOnly.Length -lt 6 -or $digitsOnly.Length -gt 15) {
      Send-Json $response @{ ok = $false; error = 'NIT inválido. Usa solo números (6 a 15 dígitos).' } 400
      return
    }
    if (-not $nombre -or $nombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa el nombre del cliente (mínimo 2 caracteres).' } 400
      return
    }
    if ($nombre.Length -gt 120) {
      Send-Json $response @{ ok = $false; error = 'El nombre es demasiado largo (máx. 120).' } 400
      return
    }

    $upsert = Upsert-AsesorClienteManual $codigo $clientNit $nombre $telefono
    if (-not $upsert.ok) {
      Send-Json $response @{ ok = $false; error = $(if ($upsert.error) { $upsert.error } else { 'No se pudo guardar el cliente.' }) } 500
      return
    }
    $updated = [bool]$upsert.updated

    $bitrixCompany = [ordered]@{ ok = $false; company_id = ''; error = '' }
    $assignedId = ''
    foreach ($id in (As-ObjectList (Get-AsesorBitrixIds $codigo))) {
      if ($id) { $assignedId = [string]$id; break }
    }
    $cfg = Read-BitrixConfig
    if ($cfg.enabled -and $cfg.webhook_base -and $assignedId) {
      try {
        $companyId = Ensure-BitrixCompany $cfg.webhook_base $clientNit $nombre $assignedId
        if ($companyId) {
          $bitrixCompany.ok = $true
          $bitrixCompany.company_id = [string]$companyId
          Clear-AsesorBitrixClientesCache $codigo
        } else {
          $bitrixCompany.error = 'Bitrix no devolvió ID de compañía.'
        }
      } catch {
        $bitrixCompany.error = [string]$_.Exception.Message
      }
    } elseif (-not $assignedId) {
      $bitrixCompany.error = 'Asesor sin ID Bitrix mapeado.'
    }

    $merged = Get-AsesorClientesMerged $codigo ([bool]$bitrixCompany.ok)
    $clientesList = $merged.clientes
    $clientes = New-Object System.Collections.ArrayList
    foreach ($row in (As-ObjectList $clientesList)) {
      if ($null -ne $row) { [void]$clientes.Add($row) }
    }
    $msg = $(if ($updated) { 'Cliente actualizado.' } else { 'Cliente registrado.' })
    if ($bitrixCompany.ok) {
      $msg += ' Compañía sincronizada en Bitrix.'
    } elseif ($bitrixCompany.error) {
      $msg += (' (Bitrix: ' + $bitrixCompany.error + ')')
    }
    Send-Json $response @{
      ok = $true
      message = $msg
      codigo = $codigo
      cliente = @{
        nit = $clientNit
        nombre = $nombre
        telefono = $telefono
        manual = $true
      }
      bitrix = $bitrixCompany
      clientes = $clientes
      count = $clientes.Count
    }
    return
  }


  if ($action -eq 'resolve_cliente_asesor_contacto') {
    $clientNit = Normalize-Nit ([string]$body.nit)
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.client_nit) }
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.cliente_nit) }
    if (-not $clientNit) {
      Send-Json $response @{ ok = $false; error = 'Falta el NIT del cliente.' } 400
      return
    }

    $cfg = Read-BitrixConfig
    $webhook = ([string]$cfg.webhook_base).Trim()
    if (-not $cfg.enabled -or -not $webhook) {
      Send-Json $response @{
        ok = $false
        error = 'Bitrix no está configurado.'
        nit = $clientNit
        asesor = $null
      } 503
      return
    }

    $seller = Find-BitrixSellerByNit $webhook $cfg $clientNit
    $assigned = ([string]$seller.assigned_by_id).Trim()
    if (-not $assigned) {
      $codigo = Find-AsesorCodigoByClientNit $clientNit
      $nombre = ''
      if ($codigo) {
        $asesor = Find-Asesor (Read-Asesores) $codigo
        if ($asesor) { $nombre = ([string]$asesor.nombre).Trim() }
      }
      Send-Json $response @{
        ok = $true
        nit = $clientNit
        found = [bool]($codigo -or $nombre)
        asesor = @{
          codigo = $codigo
          nombre = $nombre
          telefono = ''
          email = ''
          bitrix_user_id = ''
          source = 'local_map'
        }
      }
      return
    }

    $contact = Get-BitrixUserContactInfo $webhook $assigned
    $codigo = ([string]$contact.codigo).Trim()
    if (-not $codigo) {
      try { $codigo = Resolve-AsesorCodigoFromBitrixId $assigned } catch { $codigo = '' }
    }
    $nombre = ([string]$contact.nombre).Trim()
    if (-not $nombre) {
      $nombre = ([string]$seller.seller_name).Trim()
      if ($nombre -match '^(?:IZC|VALTECH)\s*V\d+\s*[-–—]?\s*(.*)$') {
        $nombre = $Matches[1].Trim()
      }
    }

    Send-Json $response @{
      ok = $true
      nit = $clientNit
      found = $true
      asesor = @{
        codigo = $codigo
        nombre = $nombre
        telefono = ([string]$contact.telefono).Trim()
        email = ([string]$contact.email).Trim()
        bitrix_user_id = $assigned
        source = 'bitrix_user'
      }
    }
    return
  }

  if ($action -eq 'resolve_cliente_pdf_contacto') {
    $clientNit = Normalize-Nit ([string]$body.nit)
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.client_nit) }
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.cliente_nit) }
    if (-not $clientNit) {
      Send-Json $response @{ ok = $false; error = 'Falta el NIT del cliente.' } 400
      return
    }
    Send-Json $response @{
      ok = $true
      nit = $clientNit
      telefono = (Resolve-ClienteTelefonoFromIndex $clientNit '')
      direccion = (Resolve-ClienteDireccionFromIndex $clientNit '')
    }
    return
  }

  if ($action -eq 'lookup_cliente_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $clientNit = Normalize-Nit ([string]$body.client_nit)
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.cliente_nit) }
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.nit_cliente) }
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.q) }
    if (-not $clientNit) {
      Send-Json $response @{ ok = $false; error = 'Falta el NIT del cliente.' } 400
      return
    }

    $nombre = ''
    $telefono = ''
    $source = ''
    $inMisClientes = $false
    $wantDigits = ($clientNit -replace '[^\d]', '')
    $wantNoZeros = if ($wantDigits) { $wantDigits.TrimStart('0') } else { '' }

    $mergedLookup = Get-AsesorClientesMerged $codigo $false
    foreach ($c in (As-ObjectList $mergedLookup.clientes)) {
      if ($null -eq $c) { continue }
      $cNit = Normalize-Nit ([string]$c.nit)
      $cDigits = ($cNit -replace '[^\d]', '')
      $cNoZeros = if ($cDigits) { $cDigits.TrimStart('0') } else { '' }
      $match = ($cNit -eq $clientNit) -or
        ($wantDigits -and $cDigits -eq $wantDigits) -or
        ($wantNoZeros -and $cNoZeros -eq $wantNoZeros)
      if (-not $match) { continue }
      $nombre = ([string]$c.nombre).Trim()
      $telefono = ([string]$c.telefono).Trim()
      $source = 'asesor'
      $inMisClientes = $true
      break
    }

    if (-not $nombre -or $nombre -eq $clientNit) {
      $fromIndex = Resolve-ClienteNombreFromIndex $clientNit ''
      if ($fromIndex -and $fromIndex -ne $clientNit) {
        $nombre = $fromIndex
        if (-not $source) { $source = 'nit_nombres' }
      }
    }
    if (-not $telefono) {
      $telefono = Resolve-ClienteTelefonoFromIndex $clientNit ''
    }

    $found = [bool]($nombre -and $nombre -ne $clientNit)
    Send-Json $response @{
      ok = $true
      nit = $clientNit
      nombre = $nombre
      telefono = $telefono
      found = $found
      in_mis_clientes = $inMisClientes
      source = $source
    }
    return
  }

  if ($action -eq 'get_quote_asesor' -or $action -eq 'enrich_quote_items') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $tryBitrix = $true
    try {
      if ($null -ne $body.enrich_bitrix) { $tryBitrix = [bool]$body.enrich_bitrix }
      elseif ($null -ne $body.PSObject.Properties['enrich_bitrix']) {
        $tryBitrix = [bool]$body.enrich_bitrix
      }
    } catch {}
    try {
      if ($action -eq 'enrich_quote_items' -and ($body.bitrix -or $body.enrich_bitrix)) { $tryBitrix = $true }
    } catch {}

    $quotes = New-Object System.Collections.Generic.List[object]
    $found = $null
    $foundIdx = -1
    $i = 0
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { $i++; continue }
      [void]$quotes.Add($q)
      if ([string]$q.id -eq $quoteId) {
        $found = $q
        $foundIdx = $i
      }
      $i++
    }
    if ($foundIdx -lt 0 -or $null -eq $found) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    # Ownership alineada a PHP (seller / assigned / *_by / NIT).
    $owned = Test-AsesorOwnsQuote $found $codigo
    if (-not $owned) {
      # Reparar seller vacío y reintentar.
      $sellerFix = Normalize-AsesorCodigo ([string]$found.seller_codigo)
      if (-not $sellerFix) {
        $fromBx = ''
        try { $fromBx = Resolve-AsesorCodigoFromBitrixId ([string]$found.assigned_by_id) } catch {}
        if ($fromBx) {
          $copy = [ordered]@{}
          foreach ($p in $found.PSObject.Properties) { $copy[$p.Name] = $p.Value }
          $copy['seller_codigo'] = $fromBx
          $found = [pscustomobject]$copy
          $quotes[$foundIdx] = $found
          Write-Quotes $quotes
          $owned = Test-AsesorOwnsQuote $found $codigo
        }
      }
    }
    if (-not $owned) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }

    $changed = Prepare-QuoteForDisplay $found $tryBitrix
    if ($changed) {
      $quotes[$foundIdx] = $found
      Write-Quotes $quotes
    }
    $estado = Get-QuoteAsesorEstado $found
    $safe = Convert-QuoteToAsesorDetailRow $found $estado
    Send-Json $response @{
      ok = $true
      quote = $safe
      enriched = $true
    }
    return
  }

  if ($action -eq 'list_quotes_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $fast = $false
    $wantBundle = $false
    $listOnly = $false
    $forceBitrix = $false
    try { if ($body.fast -or $body.skip_repairs) { $fast = $true } } catch {}
    try { if ($body.bundle) { $wantBundle = $true } } catch {}
    try { if ($body.list_only) { $listOnly = $true } } catch {}
    try {
      if ($body.refresh_bitrix -or $body.sync_bitrix -or $body.force) { $forceBitrix = $true }
    } catch {}
    if ($fast -or $wantBundle) { $listOnly = $true }

    # Igual que en el hosting: al abrir/refrescar el panel, mapea Bitrix→local (sin crear nuevas).
    $bitrixSync = Start-LocalBitrixQuotesSyncIfDue $forceBitrix $false
    # Remarcar duplicadas (NIT+monto) para historial y pestaña Duplicadas.
    Repair-AsesorDuplicateFlags $forceBitrix | Out-Null

    $filtro = ([string]$body.filtro).Trim().ToLowerInvariant()
    if (-not $filtro) { $filtro = ([string]$body.estado).Trim().ToLowerInvariant() }
    if (-not $filtro) { $filtro = $(if ($wantBundle) { 'all' } else { 'historial' }) }

    $listOpts = @{ list_only = $listOnly }
    if ($wantBundle) { $listOpts['bundle'] = $true }

    $bundleAll = Get-QuotesForAsesor $codigo 'all' $listOpts
    $bundle = $bundleAll
    if (-not $wantBundle -and $filtro -ne 'all') {
      $bundle = Get-QuotesForAsesor $codigo $filtro $listOpts
    }

    $resolvedDeal = ''
    $resolveError = ''
    $resolveId = ([string]$body.resolve_deal_quote_id).Trim()
    if ($resolveId) {
      $owned = $null
      foreach ($row in (As-ObjectList $bundleAll.quotes)) {
        if ($null -ne $row -and [string]$row.id -eq $resolveId) {
          $owned = $row
          break
        }
      }
      if ($null -eq $owned) {
        $resolveError = 'Cotización no encontrada para este asesor.'
      } else {
        $ensured = Ensure-BitrixDealIdForQuote $owned
        if ($ensured.ok -and $ensured.deal_id) {
          $resolvedDeal = [string]$ensured.deal_id
          $bundleAll = Get-QuotesForAsesor $codigo 'all' $listOpts
          if ($wantBundle) {
            $bundle = $bundleAll
          } else {
            $bundle = Get-QuotesForAsesor $codigo $filtro $listOpts
          }
        } else {
          $resolveError = [string]$ensured.error
          if (-not $resolveError) {
            $resolveError = 'No se encontró la negociación en Bitrix para esta cotización.'
          }
        }
      }
    }
    $safe = New-Object System.Collections.ArrayList
    foreach ($row in (As-ObjectList $bundle.quotes)) {
      if ($null -ne $row) { [void]$safe.Add($row) }
    }
    $payload = [ordered]@{
      ok = $true
      quotes = $safe
      count = $safe.Count
      count_nuevas = [int]$bundleAll.count_nuevas
      count_historial = [int]$bundleAll.count_historial
      count_duplicadas = [int]$bundleAll.count_duplicadas
      quotes_in_file = [int]$bundleAll.quotes_in_file
      quotes_matched = [int]$bundleAll.quotes_matched
      filtro = $filtro
      role = 'asesor'
      codigo = $codigo
      resolved_bitrix_deal_id = $resolvedDeal
      resolve_error = $resolveError
      bitrix_sync = $bitrixSync
    }
    if ($wantBundle) {
      $payload['historial'] = @(As-ObjectList $bundleAll.historial)
      $payload['nuevas'] = @(As-ObjectList $bundleAll.nuevas)
      $payload['duplicadas'] = @(As-ObjectList $bundleAll.duplicadas)
    }
    Send-Json $response $payload
    return
  }

  if ($action -eq 'resolve_quote_bitrix_deal') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $owned = $null
    $bundle = Get-QuotesForAsesor $codigo 'all'
    foreach ($row in (As-ObjectList $bundle.quotes)) {
      if ($null -ne $row -and [string]$row.id -eq $quoteId) {
        $owned = $row
        break
      }
    }
    if ($null -eq $owned) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }
    $ensured = Ensure-BitrixDealIdForQuote $owned
    $dealId = ''
    if ($ensured.deal_id) { $dealId = [string]$ensured.deal_id }
    if (-not $dealId) {
      $err = [string]$ensured.error
      if (-not $err) { $err = 'No se encontró la negociación en Bitrix para esta cotización.' }
      Send-Json $response @{
        ok = $false
        error = $err
        quote_id = $quoteId
        bitrix_deal_id = ''
      } 404
      return
    }
    Send-Json $response @{
      ok = $true
      quote_id = $quoteId
      bitrix_deal_id = $dealId
      created = [bool]$ensured.created
    }
    return
  }

  if ($action -eq 'marcar_cotizado_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $owned = Get-QuotesForAsesor $codigo 'all'
    $allowed = $false
    foreach ($row in (As-ObjectList $owned.quotes)) {
      if ([string]$row.id -eq $quoteId) { $allowed = $true; break }
    }
    if (-not $allowed) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }
    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -eq $quoteId) {
        $copy = [ordered]@{}
        foreach ($p in $q.PSObject.Properties) {
          $copy[$p.Name] = $p.Value
        }
        $copy['asesor_estado'] = 'cotizado'
        $copy['asesor_cotizado_at'] = (Get-Date).ToString('o')
        $copy['asesor_cotizado_by'] = $codigo
        [void]$quotes.Add($copy)
        $updated = $true
      } else {
        [void]$quotes.Add($q)
      }
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()
    $bundle = Get-QuotesForAsesor $codigo 'all'
    Send-Json $response @{
      ok = $true
      message = 'Cotización marcada como cotizada.'
      quote_id = $quoteId
      count_nuevas = [int]$bundle.count_nuevas
      count_historial = [int]$bundle.count_historial
    }
    return
  }

  if ($action -eq 'set_quote_estado' -or $action -eq 'update_quote_estado') {
    $estado = Normalize-QuotePipelineEstado ([string]$body.estado)
    if (-not $estado) { $estado = Normalize-QuotePipelineEstado ([string]$body.asesor_estado) }
    if (-not $estado) {
      Send-Json $response @{ ok = $false; error = 'Estado inválido. Usa cotizado, pendiente, seguimiento, vendido, perdida o cerrado_modificado.' } 400
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }

    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Solo el asesor puede cambiar el estado.' } 403
      return
    }
    $owned = Get-QuotesForAsesor $codigo 'all'
    $allowed = $false
    $ownedRow = $null
    foreach ($row in (As-ObjectList $owned.quotes)) {
      if ([string]$row.id -eq $quoteId) {
        $allowed = $true
        $ownedRow = $row
        break
      }
    }
    if (-not $allowed) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -ne $quoteId) {
        [void]$quotes.Add($q)
        continue
      }
      $prevEstado = Get-QuoteAsesorEstado $q
      if ($prevEstado -eq 'nueva') {
        Send-Json $response @{ ok = $false; error = 'Primero termina la cotización (Cotizar) para pasar al historial.' } 400
        return
      }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $copy['asesor_estado'] = $estado
      $copy['asesor_estado_at'] = (Get-Date).ToString('o')
      $copy['asesor_estado_by'] = $codigo
      [void]$quotes.Add($copy)
      $updated = $true
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()

    $updatedQuote = $null
    foreach ($q in $quotes) {
      if ([string]$q.id -eq $quoteId) { $updatedQuote = $q; break }
    }
    $bitrix = [ordered]@{ ok = $false; skipped = $true; error = '' }
    try {
      $bitrix = Sync-BitrixDealStageForQuote $updatedQuote $estado
    } catch {
      $bitrix = [ordered]@{ ok = $false; skipped = $false; error = [string]$_.Exception.Message }
    }

    $labels = @{
      cotizado = 'Cotizado'
      pendiente = 'Pendiente'
      seguimiento = 'Seguimiento'
      vendido = 'Vendido'
      perdida = 'Perdida'
      cerrado_modificado = 'Cerrado Modificado'
    }
    $columns = @{
      cotizado = 'COTIZACION'
      pendiente = 'PENDIENTE'
      seguimiento = '1 SEGUIMIENTO'
      vendido = 'CERRADO GANADO'
      perdida = 'CERRADO PERDIDO'
      cerrado_modificado = 'CERRADO MODIFICADO'
    }
    $label = $labels[$estado]
    $message = 'Estado actualizado a ' + $label + '.'
    if ($bitrix.ok) {
      $col = [string]$columns[$estado]
      $message = $message + ' Bitrix -> ' + $col
      if ($bitrix.deal_id) {
        $message = $message + ' (#' + ([string]$bitrix.deal_id) + ')'
      }
      $message = $message + '.'
    } elseif (-not $bitrix.skipped -and $bitrix.error) {
      $message = $message + ' (Bitrix: ' + ([string]$bitrix.error) + ')'
    }

    $bundle = Get-QuotesForAsesor $codigo 'all'
    Send-Json $response @{
      ok = $true
      message = $message
      quote_id = $quoteId
      asesor_estado = $estado
      bitrix = $bitrix
      count_nuevas = [int]$bundle.count_nuevas
      count_historial = [int]$bundle.count_historial
      count_duplicadas = [int]$bundle.count_duplicadas
    }
    return
  }

  if ($action -eq 'push_estados_bitrix' -or $action -eq 'sync_estados_to_bitrix') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $max = 150
    try { if ($null -ne $body.max) { $max = [int]$body.max } } catch { $max = 150 }
    if ($max -lt 1) { $max = 1 }
    if ($max -gt 300) { $max = 300 }

    $cfg = Read-BitrixConfig
    $ownedIds = @{}
    $bundle = Get-QuotesForAsesor $codigo 'all'
    foreach ($row in (As-ObjectList $bundle.quotes)) {
      if ($null -ne $row -and $row.id) { $ownedIds[[string]$row.id] = $true }
    }

    $updated = 0
    $failed = 0
    $skipped = 0
    $pushed = 0
    $errors = New-Object System.Collections.Generic.List[string]
    $errMsg = ''
    $stopAuth = $false
    $outQuotes = New-Object System.Collections.Generic.List[object]
    $changed = $false

    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }

      $qid = [string]$copy.id
      if (-not $qid -or -not $ownedIds.ContainsKey($qid)) {
        [void]$outQuotes.Add($copy)
        continue
      }
      if ($stopAuth) {
        [void]$outQuotes.Add($copy)
        continue
      }

      $estado = Normalize-QuotePipelineEstado ([string]$copy.asesor_estado)
      if (-not $estado -or $estado -eq 'nueva') {
        $skipped++
        [void]$outQuotes.Add($copy)
        continue
      }
      $dealId = ([string]$copy.bitrix_deal_id).Trim()
      if (-not $dealId) {
        $skipped++
        [void]$outQuotes.Add($copy)
        continue
      }
      $stageId = Get-BitrixStageIdForEstado $cfg $estado
      if (-not $stageId) {
        $skipped++
        [void]$outQuotes.Add($copy)
        continue
      }
      if (([string]$copy.asesor_estado_bitrix_stage).Trim() -eq $stageId -and ([string]$copy.asesor_estado_bitrix_for).Trim() -eq $estado) {
        $skipped++
        [void]$outQuotes.Add($copy)
        continue
      }
      if ($pushed -ge $max) {
        [void]$outQuotes.Add($copy)
        continue
      }

      $pushed++
      $sync = Sync-BitrixDealStageForQuote $copy $estado
      if ($sync.ok) {
        $updated++
        $copy['asesor_estado_bitrix_stage'] = $stageId
        $copy['asesor_estado_bitrix_for'] = $estado
        $copy['asesor_estado_bitrix_at'] = (Get-Date).ToString('o')
        $changed = $true
      } elseif ($sync.skipped) {
        $skipped++
      } else {
        $failed++
        $e = [string]$sync.error
        if ($e -and $errors.Count -lt 5) { [void]$errors.Add('#' + $dealId + ': ' + $e) }
        if (-not $errMsg -and $e) { $errMsg = $e }
        if ($e -match 'Webhook Bitrix invalido|credential|WRONG_AUTH') { $stopAuth = $true }
      }
      [void]$outQuotes.Add($copy)
    }

    if ($changed) { Write-Quotes $outQuotes.ToArray() }

    $msg = if ($updated -gt 0) {
      'Se sincronizaron ' + $updated + ' cotizacion(es) a Bitrix.'
    } elseif ($errMsg) {
      $errMsg
    } else {
      'Nada pendiente: los estados del panel ya estaban en Bitrix.'
    }
    if ($failed -gt 0) { $msg = $msg + ' Fallaron ' + $failed + '.' }

    Send-Json $response @{
      ok = ($updated -gt 0 -or $failed -eq 0)
      message = $msg
      push = @{
        ok = ($updated -gt 0 -or $failed -eq 0)
        pushed = $pushed
        updated = $updated
        failed = $failed
        skipped = $skipped
        error = $errMsg
        errors = @($errors)
      }
    }
    return
  }

  if ($action -eq 'set_quote_comentario' -or $action -eq 'update_quote_comentario') {
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $comentario = ([string]$body.comentario).Trim()
    if (-not $comentario) { $comentario = ([string]$body.asesor_comentario).Trim() }
    if ($comentario.Length -gt 2000) {
      Send-Json $response @{ ok = $false; error = 'El comentario no puede superar 2000 caracteres.' } 400
      return
    }

    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Solo el asesor puede guardar el comentario.' } 403
      return
    }
    $owned = Get-QuotesForAsesor $codigo 'all'
    $allowed = $false
    foreach ($row in (As-ObjectList $owned.quotes)) {
      if ([string]$row.id -eq $quoteId) { $allowed = $true; break }
    }
    if (-not $allowed) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -ne $quoteId) {
        [void]$quotes.Add($q)
        continue
      }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $copy['asesor_comentario'] = $comentario
      $copy['asesor_comentario_at'] = $savedAt
      $copy['asesor_comentario_by'] = $codigo
      [void]$quotes.Add($copy)
      $updated = $true
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()
    Send-Json $response @{
      ok = $true
      message = if ($comentario) { 'Comentario guardado.' } else { 'Comentario eliminado.' }
      quote_id = $quoteId
      asesor_comentario = $comentario
      asesor_comentario_at = $savedAt
      asesor_comentario_by = $codigo
    }
    return
  }

  if ($action -eq 'set_quote_fecha_cierre' -or $action -eq 'update_quote_fecha_cierre') {
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $fecha = ([string]$body.fecha_cierre).Trim()
    if (-not $fecha) { $fecha = ([string]$body.fechaCierre).Trim() }
    if ($fecha -and $fecha -notmatch '^\d{4}-\d{2}-\d{2}$') {
      Send-Json $response @{ ok = $false; error = 'Fecha de cierre inválida. Usa AAAA-MM-DD.' } 400
      return
    }

    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Solo el asesor puede definir la fecha de cierre.' } 403
      return
    }
    $owned = Get-QuotesForAsesor $codigo 'all'
    $allowed = $false
    foreach ($row in (As-ObjectList $owned.quotes)) {
      if ([string]$row.id -eq $quoteId) { $allowed = $true; break }
    }
    if (-not $allowed) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -ne $quoteId) {
        [void]$quotes.Add($q)
        continue
      }
      $prevEstado = Get-QuoteAsesorEstado $q
      if ($prevEstado -eq 'nueva') {
        Send-Json $response @{ ok = $false; error = 'Primero termina la cotización para definir fecha de cierre.' } 400
        return
      }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $copy['fecha_cierre'] = $fecha
      $copy['fecha_cierre_at'] = $savedAt
      $copy['fecha_cierre_by'] = $codigo
      [void]$quotes.Add($copy)
      $updated = $true
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()
    Send-Json $response @{
      ok = $true
      message = if ($fecha) { 'Fecha de cierre guardada.' } else { 'Fecha de cierre eliminada.' }
      quote_id = $quoteId
      fecha_cierre = $fecha
      fecha_cierre_at = $savedAt
      fecha_cierre_by = $codigo
    }
    return
  }

  if ($action -eq 'set_quote_flete' -or $action -eq 'update_quote_flete') {
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $rawFlete = $body.flete_antes_iva
    if ($null -eq $rawFlete -or [string]$rawFlete -eq '') { $rawFlete = $body.fleteAntesIva }
    if ($null -eq $rawFlete -or [string]$rawFlete -eq '') { $rawFlete = $body.flete }
    if ($null -eq $rawFlete -or [string]$rawFlete -eq '') {
      Send-Json $response @{ ok = $false; error = 'Falta el valor del flete.' } 400
      return
    }
    $fleteStr = ([string]$rawFlete).Trim()
    $fleteStr = $fleteStr -replace '[$\s]|COP|cop', ''
    if ($fleteStr.Contains(',') -and $fleteStr.Contains('.')) {
      $fleteStr = $fleteStr.Replace('.', '').Replace(',', '.')
    } else {
      $fleteStr = $fleteStr.Replace(',', '.')
    }
    $fleteAntes = 0.0
    try { $fleteAntes = [double]$fleteStr } catch {
      Send-Json $response @{ ok = $false; error = 'Flete inválido.' } 400
      return
    }
    if ($fleteAntes -lt 0) {
      Send-Json $response @{ ok = $false; error = 'Flete inválido.' } 400
      return
    }

    $rawIva = $body.flete_iva
    if ($null -eq $rawIva -or [string]$rawIva -eq '') { $rawIva = $body.fleteIva }
    $fleteIva = $null
    if ($null -ne $rawIva -and [string]$rawIva -ne '') {
      $ivaStr = ([string]$rawIva).Trim()
      $ivaStr = $ivaStr -replace '[$\s]|COP|cop', ''
      if ($ivaStr.Contains(',') -and $ivaStr.Contains('.')) {
        $ivaStr = $ivaStr.Replace('.', '').Replace(',', '.')
      } else {
        $ivaStr = $ivaStr.Replace(',', '.')
      }
      try { $fleteIva = [double]$ivaStr } catch {
        Send-Json $response @{ ok = $false; error = 'IVA de flete inválido.' } 400
        return
      }
      if ($fleteIva -lt 0) {
        Send-Json $response @{ ok = $false; error = 'IVA de flete inválido.' } 400
        return
      }
    }
    if ($null -eq $fleteIva) { $fleteIva = $fleteAntes * 0.19 }

    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Solo el asesor puede editar el flete.' } 403
      return
    }
    $owned = Get-QuotesForAsesor $codigo 'all'
    $allowed = $false
    foreach ($row in (As-ObjectList $owned.quotes)) {
      if ([string]$row.id -eq $quoteId) { $allowed = $true; break }
    }
    if (-not $allowed) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    $savedAt = (Get-Date).ToString('o')
    $outTotals = $null
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -ne $quoteId) {
        [void]$quotes.Add($q)
        continue
      }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $totals = [ordered]@{}
      if ($null -ne $q.totals) {
        if ($q.totals -is [System.Collections.IDictionary]) {
          foreach ($k in @($q.totals.Keys)) { $totals[$k] = $q.totals[$k] }
        } else {
          foreach ($p in $q.totals.PSObject.Properties) { $totals[$p.Name] = $p.Value }
        }
      }
      $subtotal = 0.0
      try {
        if ($null -ne $totals.totalSinFlete) { $subtotal = [double]$totals.totalSinFlete }
      } catch { $subtotal = 0.0 }
      if ($subtotal -lt 0) { $subtotal = 0.0 }
      if ($subtotal -eq 0 -and $null -ne $q.items) {
        foreach ($it in (As-ObjectList $q.items)) {
          if ($null -eq $it) { continue }
          try {
            if ($null -ne $it.totalCopIva) { $subtotal += [double]$it.totalCopIva }
          } catch {}
        }
      }
      $totals['totalSinFlete'] = $subtotal
      $totals['fleteAntesIva'] = $fleteAntes
      $totals['fleteIva'] = $fleteIva
      $totals['totalConFlete'] = $subtotal + $fleteAntes + $fleteIva
      $copy['totals'] = $totals
      $copy['flete_editado_at'] = $savedAt
      $copy['flete_editado_by'] = $codigo
      $outTotals = $totals
      [void]$quotes.Add($copy)
      $updated = $true
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()
    Send-Json $response @{
      ok = $true
      message = 'Flete guardado.'
      quote_id = $quoteId
      flete_antes_iva = $fleteAntes
      flete_iva = $fleteIva
      totals = $outTotals
      flete_editado_at = $savedAt
      flete_editado_by = $codigo
    }
    return
  }

  if ($action -eq 'set_quote_empresa' -or $action -eq 'update_quote_empresa') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Solo el asesor puede editar la empresa.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }
    $empresaRaw = ([string]$body.empresa).Trim()
    if (-not $empresaRaw) {
      Send-Json $response @{ ok = $false; error = 'Falta la empresa.' } 400
      return
    }
    if ($empresaRaw -notmatch '(?i)VALTECH|IZC') {
      Send-Json $response @{ ok = $false; error = 'Empresa no válida.' } 400
      return
    }
    $empresa = if ($empresaRaw -match '(?i)VALTECH') { 'VALTECH MAYORISTA S.A.S.' } else { 'IZC MAYORISTA S.A.S.' }

    $owned = Get-QuotesForAsesor $codigo 'all'
    $allowed = $false
    foreach ($row in (As-ObjectList $owned.quotes)) {
      if ([string]$row.id -eq $quoteId) { $allowed = $true; break }
    }
    if (-not $allowed) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
      return
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -ne $quoteId) {
        [void]$quotes.Add($q)
        continue
      }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $totals = [ordered]@{}
      if ($null -ne $q.totals) {
        if ($q.totals -is [System.Collections.IDictionary]) {
          foreach ($k in @($q.totals.Keys)) { $totals[$k] = $q.totals[$k] }
        } else {
          foreach ($p in $q.totals.PSObject.Properties) { $totals[$p.Name] = $p.Value }
        }
      }
      $totals['empresa'] = $empresa
      $copy['totals'] = $totals
      $copy['empresa'] = $empresa
      $copy['empresa_editado_at'] = $savedAt
      $copy['empresa_editado_by'] = $codigo
      [void]$quotes.Add($copy)
      $updated = $true
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()
    Send-Json $response @{
      ok = $true
      message = 'Empresa actualizada.'
      quote_id = $quoteId
      empresa = $empresa
      empresa_editado_at = $savedAt
      empresa_editado_by = $codigo
    }
    return
  }

  if ($action -eq 'delete_quote_asesor' -or $action -eq 'hide_quote_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Solo el asesor puede eliminar cotizaciones de su panel.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotización.' } 400
      return
    }

    $nitSet = Get-AsesorNitSet $codigo
    $bitrixIds = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($id in (Get-AsesorBitrixIds $codigo)) {
      if ($id) { [void]$bitrixIds.Add([string]$id) }
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updated = $false
    $savedAt = (Get-Date).ToString('o')
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      if ([string]$q.id -ne $quoteId) {
        [void]$quotes.Add($q)
        continue
      }
      $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
      $assigned = [string]$q.assigned_by_id
      $match = $false
      if ($sellerCode -and $sellerCode -eq $codigo) { $match = $true }
      elseif ($assigned -and $bitrixIds.Contains($assigned)) { $match = $true }
      elseif (Test-NitInSet ([string]$q.nit) $nitSet) { $match = $true }
      if (-not $match) {
        Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
        return
      }
      if ($q.asesor_eliminada -eq $true -or [string]$q.asesor_eliminada -eq 'True' -or [string]$q.asesor_eliminada -eq '1') {
        Send-Json $response @{
          ok = $true
          message = 'La cotización ya no aparece en tu historial.'
          quote_id = $quoteId
        }
        return
      }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $copy['asesor_eliminada'] = $true
      $copy['asesor_eliminada_at'] = $savedAt
      $copy['asesor_eliminada_by'] = $codigo
      [void]$quotes.Add($copy)
      $updated = $true
    }
    if (-not $updated) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }
    Write-Quotes $quotes.ToArray()
    Send-Json $response @{
      ok = $true
      message = 'Cotización eliminada de tu historial. Sigue visible para el administrador.'
      quote_id = $quoteId
      asesor_eliminada_at = $savedAt
      asesor_eliminada_by = $codigo
    }
    return
  }

  if ($action -eq 'finish_quote_asesor') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) { $quoteId = ([string]$body.id).Trim() }
    $clientNit = Normalize-Nit ([string]$body.client_nit)
    if (-not $clientNit) { $clientNit = Normalize-Nit ([string]$body.nit) }
    $clientNombre = ([string]$body.nombre).Trim()
    $items = @()
    if ($null -ne $body.items) { $items = @($body.items) }
    if ($items.Count -eq 0) {
      Send-Json $response @{ ok = $false; error = 'La cotización no tiene productos.' } 400
      return
    }
    if (-not $clientNit) {
      Send-Json $response @{ ok = $false; error = 'Falta el NIT del cliente.' } 400
      return
    }

    $sellerAssigned = $null
    $sellerName = ([string]$asesor.nombre).Trim()
    $ids = Get-AsesorBitrixIds $codigo
    foreach ($id in (As-ObjectList $ids)) {
      if ($id) { $sellerAssigned = [string]$id; break }
    }
    if ($sellerAssigned) {
      $map = Get-BitrixVendedoresMap
      if ($map.ContainsKey($sellerAssigned) -and $map[$sellerAssigned]) {
        $sellerName = ([string]$map[$sellerAssigned]).Trim()
      }
    }
    if (-not $sellerAssigned) {
      Send-Json $response @{
        ok = $false
        error = ('Tu código de asesor (' + $codigo + ') no tiene ID de Bitrix. No se puede subir la cotización sin responsable correcto.')
      } 400
      return
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $updatedQuote = $null
    $bitrixIds = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($id in (As-ObjectList $ids)) {
      if ($id) { [void]$bitrixIds.Add([string]$id) }
    }
    $nitSet = Get-AsesorNitSet $codigo $true

    # Si Cotizar perdió el quote_id, adoptar la pendiente de Cotizaciones Cliente del mismo NIT.
    if (-not $quoteId -and $clientNit) {
      $allQuotes = As-ObjectList (Read-Quotes)
      $quoteId = Find-LatestClienteNuevaQuoteId $allQuotes $codigo $clientNit
    }
    $isNew = -not $quoteId

    if ($isNew) {
      # Cotizar: aceptar Mis clientes (índice/manual/Bitrix caché) o reclamar NIT nuevo.
      if (-not (Test-NitInSet $clientNit $nitSet)) {
        if (-not $clientNombre) {
          $clientNombre = Resolve-ClienteNombreFromIndex $clientNit $clientNit
        }
        $claim = Upsert-AsesorClienteManual $codigo $clientNit $clientNombre ''
        if (-not $claim.ok) {
          Send-Json $response @{
            ok = $false
            error = 'Ese cliente no está en Mis clientes y no se pudo registrar automáticamente. Regístralo primero.'
          } 403
          return
        }
        # No llamar Bitrix aquí: sync_bitrix_quote lo hace en segundo plano.
      }
      if (-not $clientNombre) { $clientNombre = $clientNit }
      $quoteId = (Get-Date).ToString('yyyyMMddHHmmssffffff') + '-' + $clientNit
      foreach ($q in (As-ObjectList (Read-Quotes))) {
        if ($null -ne $q) { [void]$quotes.Add($q) }
      }
      $duplicatedFrom = ([string]$body.duplicated_from).Trim()
      if (-not $duplicatedFrom) { $duplicatedFrom = ([string]$body.recotizado_desde).Trim() }
      $isDuplicated = [bool]$body.is_duplicated -or [bool]$body.recotizar -or [bool]$duplicatedFrom
      $updatedQuote = [ordered]@{
        id = $quoteId
        nit = $clientNit
        nombre = $clientNombre
        created_at = (Get-Date).ToString('o')
        trm = $body.trm
        empresa = ([string]$body.empresa).Trim()
        items = $items
        totals = $(if ($null -ne $body.totals) { $body.totals } else { @{} })
        seller_codigo = $codigo
        assigned_by_id = $sellerAssigned
        seller_name = $sellerName
        asesor_estado = 'cotizado'
        asesor_cotizado_at = (Get-Date).ToString('o')
        asesor_cotizado_by = $codigo
        quote_source = 'asesor'
        finished_at = (Get-Date).ToString('o')
      }
      if ($isDuplicated) {
        $updatedQuote['is_duplicated'] = $true
        if ($duplicatedFrom) {
          $updatedQuote['duplicated_from'] = $duplicatedFrom
          $updatedQuote['recotizado_desde'] = $duplicatedFrom
          $updatedQuote['recotizado_at'] = (Get-Date).ToString('o')
          $updatedQuote['recotizado_by'] = $codigo
        }
      }
      [void]$quotes.Add($updatedQuote)
    } else {
      $found = $false
      foreach ($q in (As-ObjectList (Read-Quotes))) {
        if ($null -eq $q) { continue }
        if ([string]$q.id -ne $quoteId) {
          [void]$quotes.Add($q)
          continue
        }
        $sellerCodeQ = Normalize-AsesorCodigo ([string]$q.seller_codigo)
        $assignedQ = [string]$q.assigned_by_id
        $allowed = $false
        if ($sellerCodeQ -and $sellerCodeQ -eq $codigo) { $allowed = $true }
        elseif ($assignedQ -and $bitrixIds.Contains($assignedQ)) { $allowed = $true }
        elseif (Test-NitInSet ([string]$q.nit) $nitSet) { $allowed = $true }
        if (-not $allowed) {
          Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
          return
        }
        $copy = [ordered]@{}
        foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
        if ($clientNit) { $copy['nit'] = $clientNit }
        if ($clientNombre) { $copy['nombre'] = $clientNombre }
        $copy['trm'] = $body.trm
        $copy['empresa'] = ([string]$body.empresa).Trim()
        $copy['items'] = $items
        $copy['totals'] = $(if ($null -ne $body.totals) { $body.totals } else { @{} })
        $copy['seller_codigo'] = $codigo
        $copy['assigned_by_id'] = $sellerAssigned
        $copy['seller_name'] = $sellerName
        $copy['asesor_estado'] = 'cotizado'
        $copy['asesor_cotizado_at'] = (Get-Date).ToString('o')
        $copy['asesor_cotizado_by'] = $codigo
        $copy['quote_source'] = 'asesor'
        $copy['finished_at'] = (Get-Date).ToString('o')
        $duplicatedFrom = ([string]$body.duplicated_from).Trim()
        if (-not $duplicatedFrom) { $duplicatedFrom = ([string]$body.recotizado_desde).Trim() }
        if (-not $duplicatedFrom) {
          $duplicatedFrom = [string]($(if ($copy.duplicated_from) { $copy.duplicated_from } elseif ($copy.recotizado_desde) { $copy.recotizado_desde } else { '' }))
        }
        if ($duplicatedFrom) {
          $copy['duplicated_from'] = $duplicatedFrom
          $copy['recotizado_desde'] = $duplicatedFrom
          $copy['is_duplicated'] = $true
          $copy['recotizado_at'] = (Get-Date).ToString('o')
          $copy['recotizado_by'] = $codigo
        }
        $updatedQuote = $copy
        [void]$quotes.Add($copy)
        $found = $true
      }
      if (-not $found -or $null -eq $updatedQuote) {
        Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
        return
      }
    }
    Write-Quotes $quotes.ToArray()

    # Registrar productos manuales creados por el asesor (best-effort en archivo local).
    try {
      $pcFile = Join-Path $Root 'data\productos_creados_asesor.json'
      $pc = @{ products = @(); updated_at = '' }
      if (Test-Path -LiteralPath $pcFile) {
        try { $pc = (Get-Content -LiteralPath $pcFile -Raw -Encoding UTF8) | ConvertFrom-Json } catch {}
      }
      if ($null -eq $pc.products) { $pc | Add-Member -NotePropertyName products -NotePropertyValue @() -Force }
      $list = New-Object System.Collections.Generic.List[object]
      foreach ($p in (As-ObjectList $pc.products)) { if ($null -ne $p) { [void]$list.Add($p) } }
      foreach ($it in (As-ObjectList $updatedQuote.items)) {
        if ($null -eq $it) { continue }
        $isCustom = $false
        try { if ($it.custom -eq $true -or $it.manual -eq $true) { $isCustom = $true } } catch {}
        try { if ([string]$it.created_by) { $isCustom = $true } } catch {}
        if (-not $isCustom) { continue }
        $sku = ([string]$(if ($it.sku) { $it.sku } else { $it.codigo })).Trim().ToUpperInvariant()
        if (-not $sku) { continue }
        $usd = 0.0
        try { if ($null -ne $it.unitarioUsd) { $usd = [double]$it.unitarioUsd } } catch {}
        if ($usd -le 0) { try { if ($null -ne $it.usd) { $usd = [double]$it.usd } } catch {} }
        $cop = 0.0
        try { if ($null -ne $it.unitarioCop) { $cop = [double]$it.unitarioCop } } catch {}
        if ($cop -le 0) { try { if ($null -ne $it.copIva) { $cop = [double]$it.copIva / 1.19 } } catch {} }
        [void]$list.Add([ordered]@{
          sku = $sku
          name = [string]$it.name
          referencia = [string]$it.referencia
          unitario_usd = $usd
          unitario_cop = $cop
          seller_codigo = [string]$(if ($it.created_by) { $it.created_by } else { $codigo })
          seller_name = [string]$updatedQuote.seller_name
          created_at = [string]$(if ($it.created_at) { $it.created_at } else { $updatedQuote.created_at })
          quote_id = [string]$updatedQuote.id
        })
      }
      $pc.products = $list.ToArray()
      $pc.updated_at = (Get-Date).ToString('o')
      ($pc | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $pcFile -Encoding UTF8
    } catch {}

    # Bitrix en segundo plano (sync_bitrix_quote); no bloquear al asesor.
    $existingDeal = ([string]$updatedQuote.bitrix_deal_id).Trim()
    $cfgBx = Read-BitrixConfig
    if ($existingDeal) {
      $bitrix = [ordered]@{
        ok = $true
        skipped = $false
        pending = $false
        deal_id = $existingDeal
        from_cache = $true
      }
    } elseif (-not $cfgBx.enabled) {
      $bitrix = [ordered]@{ ok = $false; skipped = $true; pending = $false; error = 'Bitrix desactivado.' }
    } elseif (-not $cfgBx.webhook_base -or -not $cfgBx.stage_id) {
      $bitrix = [ordered]@{ ok = $false; skipped = $true; pending = $false; error = 'Falta webhook o STAGE_ID de Bitrix.' }
    } else {
      $bitrix = [ordered]@{ ok = $false; skipped = $false; pending = $true; error = '' }
    }

    Send-Json $response @{
      ok = $true
      message = 'Cotizacion guardada'
      quote_id = $quoteId
      bitrix = $bitrix
      is_duplicated = [bool](Test-QuoteIsDuplicated $updatedQuote)
      duplicated_from = [string]($(if ($updatedQuote.duplicated_from) { $updatedQuote.duplicated_from } elseif ($updatedQuote.recotizado_desde) { $updatedQuote.recotizado_desde } else { '' }))
    }
    return
  }

  if ($action -eq 'sync_bitrix_quote') {
    $codigo = Normalize-AsesorCodigo ([string]$body.asesor_codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit_asesor) }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $quoteId = ([string]$body.quote_id).Trim()
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta quote_id.' } 400
      return
    }

    $nitSet = Get-AsesorNitSet $codigo $true
    $bitrixIds = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($id in (As-ObjectList (Get-AsesorBitrixIds $codigo))) {
      if ($id) { [void]$bitrixIds.Add([string]$id) }
    }

    $quotes = New-Object System.Collections.Generic.List[object]
    $quote = $null
    $quoteIdx = -1
    $i = 0
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      [void]$quotes.Add($q)
      if ([string]$q.id -eq $quoteId) {
        $sellerCodeQ = Normalize-AsesorCodigo ([string]$q.seller_codigo)
        $assignedQ = [string]$q.assigned_by_id
        $allowed = $false
        if ($sellerCodeQ -and $sellerCodeQ -eq $codigo) { $allowed = $true }
        elseif ($assignedQ -and $bitrixIds.Contains($assignedQ)) { $allowed = $true }
        elseif (Test-NitInSet ([string]$q.nit) $nitSet) { $allowed = $true }
        if (-not $allowed) {
          Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
          return
        }
        $quote = $q
        $quoteIdx = $i
      }
      $i++
    }
    if ($null -eq $quote -or $quoteIdx -lt 0) {
      Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
      return
    }

    $existing = ([string]$quote.bitrix_deal_id).Trim()
    if ($existing) {
    Send-Json $response @{
      ok = $true
        quote_id = $quoteId
        bitrix = [ordered]@{
          ok = $true
          deal_id = $existing
          from_cache = $true
          pending = $false
        }
      }
      return
    }

    $bitrix = [ordered]@{ ok = $false; skipped = $true; error = 'Bitrix no ejecutado.'; pending = $false }
    try {
      $bitrix = Send-BitrixDeal $quote
      if ($null -eq $bitrix.pending) { $bitrix['pending'] = $false }
    } catch {
      $bitrix = [ordered]@{
        ok = $false
        skipped = $false
        pending = $false
        error = ('Bitrix: ' + $_.Exception.Message)
      }
    }

    if ($bitrix.ok -and $bitrix.deal_id) {
      $copy = [ordered]@{}
      foreach ($p in $quote.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $copy['bitrix_deal_id'] = [string]$bitrix.deal_id
      if ($quote.assigned_by_id) {
        $copy['assigned_by_id'] = [string]$quote.assigned_by_id
        $copy['seller_codigo'] = Normalize-AsesorCodigo ([string]$(if ($quote.seller_codigo) { $quote.seller_codigo } else { $codigo }))
        if ($quote.seller_name) { $copy['seller_name'] = [string]$quote.seller_name }
      }
      $rewritten = New-Object System.Collections.Generic.List[object]
      for ($j = 0; $j -lt $quotes.Count; $j++) {
        if ($j -eq $quoteIdx) { [void]$rewritten.Add($copy) }
        else { [void]$rewritten.Add($quotes[$j]) }
      }
      Write-Quotes $rewritten.ToArray()
    }

    Send-Json $response @{
      ok = [bool]$bitrix.ok
      quote_id = $quoteId
      bitrix = $bitrix
      error = [string]$bitrix.error
    }
    return
  }

  if ($action -eq 'list') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }

    $asesorNombreByCodigo = @{}
    foreach ($a in (As-ObjectList (Read-Asesores))) {
      $code = Normalize-AsesorCodigo ([string]$a.codigo)
      if (-not $code) { continue }
      $nm = ([string]$a.nombre).Trim()
      $asesorNombreByCodigo[$code] = $(if ($nm) { $nm } else { $code })
    }

    $byNit = @{}
    foreach ($u in (Read-Users)) {
      $uNit = Normalize-Nit ([string]$u.nit)
      if (-not $uNit) { continue }
      $nombre = ([string]$u.nombre).Trim()
      $contactoNombre = ([string]$u.contacto_nombre).Trim()
      if (-not $contactoNombre) { $contactoNombre = ([string]$u.nombre_contacto).Trim() }
      $contactoTel = Normalize-TelefonoDisplay ([string]$u.contacto_telefono)
      if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$u.telefono_contacto) }
      if (-not $contactoTel) { $contactoTel = Normalize-TelefonoDisplay ([string]$u.telefono) }
      $byNit[$uNit] = [ordered]@{
        nit = $uNit
        nombre = $(if ($nombre) { $nombre } else { $uNit })
        contacto_nombre = $contactoNombre
        contacto_telefono = $contactoTel
        telefono = $contactoTel
        created_at = [string]$u.created_at
        origen = 'portal'
        vendedor_codigo = ''
        vendedor_nombre = ''
        vendedor = ''
      }
    }

    $manual = Read-AsesorClientesManual
    $byCodigo = $null
    if ($manual -is [System.Collections.IDictionary] -and $manual.Contains('by_codigo')) {
      $byCodigo = $manual['by_codigo']
    } elseif ($manual -and $manual.by_codigo) {
      $byCodigo = $manual.by_codigo
    }
    if ($byCodigo -is [System.Collections.IDictionary]) {
      foreach ($codigoRaw in @($byCodigo.Keys)) {
        $codigo = Normalize-AsesorCodigo ([string]$codigoRaw)
        if (-not $codigo) { continue }
        $list = @(As-ObjectList $byCodigo[$codigoRaw])
        $vendedorNombre = if ($asesorNombreByCodigo.ContainsKey($codigo)) { $asesorNombreByCodigo[$codigo] } else { $codigo }
        $vendedorLabel = if ($vendedorNombre -and $vendedorNombre -ne $codigo) { "$codigo · $vendedorNombre" } else { $codigo }
        foreach ($c in $list) {
          if ($null -eq $c) { continue }
          $cNit = Normalize-Nit ([string]$c.nit)
          if (-not $cNit) { continue }
          $cNombre = ([string]$c.nombre).Trim()
          $created = [string]$(if ($c.created_at) { $c.created_at } elseif ($c.updated_at) { $c.updated_at } else { '' })
          if (-not $byNit.ContainsKey($cNit)) {
            $byNit[$cNit] = [ordered]@{
              nit = $cNit
              nombre = $(if ($cNombre) { $cNombre } else { $cNit })
              contacto_nombre = ''
              contacto_telefono = ''
              telefono = ''
              created_at = $created
              origen = 'asesor'
              vendedor_codigo = $codigo
              vendedor_nombre = $vendedorNombre
              vendedor = $vendedorLabel
            }
          } else {
            $row = $byNit[$cNit]
            if ((-not $row.nombre -or $row.nombre -eq $cNit) -and $cNombre) { $row.nombre = $cNombre }
            if (-not $row.created_at -and $created) { $row.created_at = $created }
            $row.origen = if ($row.origen -eq 'portal') { 'portal+asesor' } else { 'asesor' }
            $row.vendedor_codigo = $codigo
            $row.vendedor_nombre = $vendedorNombre
            $row.vendedor = $vendedorLabel
            $byNit[$cNit] = $row
          }
        }
      }
    }

    foreach ($nitKey in @($byNit.Keys)) {
      $row = $byNit[$nitKey]
      if (([string]$row.vendedor_codigo).Trim()) { continue }
      $codigo = Find-AsesorCodigoByClientNit $nitKey
      if (-not $codigo) {
        $row.vendedor = ''
        $byNit[$nitKey] = $row
        continue
      }
      $vendedorNombre = if ($asesorNombreByCodigo.ContainsKey($codigo)) { $asesorNombreByCodigo[$codigo] } else { $codigo }
      $row.vendedor_codigo = $codigo
      $row.vendedor_nombre = $vendedorNombre
      $row.vendedor = if ($vendedorNombre -and $vendedorNombre -ne $codigo) { "$codigo · $vendedorNombre" } else { $codigo }
      $byNit[$nitKey] = $row
    }

    $safe = @($byNit.Values | Sort-Object { $_.created_at } -Descending)
    Send-Json $response @{ ok = $true; users = $safe; count = $safe.Count }
    return
  }

  if ($action -eq 'delete') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    if ($nit -eq $adminNit) {
      Send-Json $response @{ ok = $false; error = 'No puedes eliminar tu propia cuenta de administrador.' } 400
      return
    }
    $origen = ([string]$body.origen).Trim().ToLowerInvariant()
    $vendedorCodigo = Normalize-AsesorCodigo ([string]$body.vendedor_codigo)
    $touchPortal = (-not $origen -or $origen.Contains('portal'))
    $touchAsesor = (-not $origen -or $origen.Contains('asesor'))
    $removed = $false

    if ($touchPortal) {
      $users = New-Object System.Collections.Generic.List[object]
      foreach ($u in (Read-Users)) {
        if ((Normalize-Nit ([string]$u.nit)) -eq $nit) {
          $removed = $true
          continue
        }
        $users.Add($u)
      }
      if ($removed) {
        Write-Users $users.ToArray()
      }
    }

    if ($touchAsesor) {
      $manual = Read-AsesorClientesManual
      $changedManual = $false
      $by = $null
      if ($manual -is [System.Collections.IDictionary] -and $manual.Contains('by_codigo')) {
        $by = $manual['by_codigo']
      } elseif ($manual -and $manual.by_codigo) {
        $by = $manual.by_codigo
      }
      if ($by -is [System.Collections.IDictionary]) {
        foreach ($codeKey in @($by.Keys)) {
          $code = Normalize-AsesorCodigo ([string]$codeKey)
          if ($vendedorCodigo -and $code -ne $vendedorCodigo) { continue }
          $kept = New-Object System.Collections.Generic.List[object]
          foreach ($c in (As-ObjectList $by[$codeKey])) {
            if ($null -eq $c) { continue }
            if ((Normalize-Nit ([string]$c.nit)) -eq $nit) {
              $removed = $true
              $changedManual = $true
              continue
            }
            $kept.Add($c)
          }
          $by[$codeKey] = $kept
        }
        if ($manual -is [System.Collections.IDictionary]) {
          $manual['by_codigo'] = $by
        } else {
          $manual.by_codigo = $by
        }
      }
      if ($changedManual) {
        Write-AsesorClientesManual $manual
      }
    }

    if (-not $removed) {
      Send-Json $response @{ ok = $false; error = 'Cliente no encontrado.' } 404
      return
    }
    Send-Json $response @{ ok = $true; message = 'Cliente eliminado.'; nit = $nit }
    return
  }

  if ($action -eq 'upsert') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    $hash = [string]$body.password_hash
    if (-not $hash -or -not $hash.StartsWith('pbkdf2$')) {
      Send-Json $response @{ ok = $false; error = 'Hash de contrasena invalido.' } 400
      return
    }
    $created = [string]$body.created_at
    if (-not $created) { $created = (Get-Date).ToString('o') }
    $users = New-Object System.Collections.Generic.List[object]
    $replaced = $false
    foreach ($u in (Read-Users)) {
      if ((Normalize-Nit ([string]$u.nit)) -eq $nit) {
        $users.Add([ordered]@{
          nit = $nit
          nombre = $nombre
          password_hash = $hash
          created_at = $created
        })
        $replaced = $true
      } else {
        $users.Add($u)
      }
    }
    if (-not $replaced) {
      $users.Add([ordered]@{
        nit = $nit
        nombre = $nombre
        password_hash = $hash
        created_at = $created
      })
    }
    Write-Users $users.ToArray()
    Send-Json $response @{ ok = $true; nit = $nit; nombre = $nombre; message = 'Usuario guardado en usuarios.json.' }
    return
  }

  if ($action -eq 'set_bridge_session') {
    $entry = Write-SessionBridge $nit $nombre
    Send-Json $response @{
      ok = $true
      nit = [string]$entry.nit
      nombre = [string]$entry.nombre
      updated_at = [string]$entry.updated_at
    }
    return
  }

  if ($action -eq 'get_bridge_session') {
    $entry = Read-SessionBridge
    Send-Json $response @{
      ok = $true
      nit = [string]$entry.nit
      nombre = [string]$entry.nombre
      updated_at = [string]$entry.updated_at
    }
    return
  }

  if ($action -eq 'sync') {
    $incoming = @()
    if ($null -ne $body.users) {
      $incoming = @($body.users)
    }
    $clean = @()
    foreach ($u in $incoming) {
      $n = Normalize-Nit ([string]$u.nit)
      if (-not $n -or $n -notmatch '^\d{6,15}(-\d)?$') { continue }
      $existingHash = [string]$u.password_hash
      $plain = [string]$u.password
      if ($existingHash -and $existingHash.StartsWith('pbkdf2$')) {
        $clean += [pscustomobject]@{
          nit = $n
          password_hash = $existingHash
          created_at = $(if ([string]$u.created_at) { [string]$u.created_at } else { (Get-Date).ToString('o') })
        }
        continue
      }
      if ($plain.Length -lt 4) { continue }
      $clean += (Protect-UserRecord ([pscustomobject]@{
        nit = $n
        password = $plain
        created_at = [string]$u.created_at
      }))
    }
    Write-Users $clean
    Send-Json $response @{ ok = $true; count = $clean.Count; message = 'Usuarios guardados en data/usuarios.json' }
    return
  }

  if ($action -eq 'save_quote') {
    $rawNitIn = ([string]$body.nit).Trim()
    $quoteSourceIn = ([string]$body.quote_source).Trim().ToLowerInvariant()
    $isSatQuote = $false
    $satKeyIn = ($rawNitIn -replace '[\s.]', '').ToUpperInvariant()
    if ($satKeyIn -eq 'SAT' -or $satKeyIn -eq 'ADMINSAT' -or $quoteSourceIn -eq 'sat') { $isSatQuote = $true }
    $gpCodeIn = Normalize-GpCodigo ([string]$(if ($body.seller_codigo) { $body.seller_codigo } elseif ($body.gp_codigo) { $body.gp_codigo } else { $rawNitIn }))
    $isGpQuote = $false
    if ($gpCodeIn -and ((Test-IsGpLoginId $rawNitIn) -or $quoteSourceIn -eq 'gp')) { $isGpQuote = $true }
    $clientNitIn = Normalize-Nit ([string]$(if ($body.client_nit) { $body.client_nit } elseif ($body.cliente_nit) { $body.cliente_nit } else { $body.nit_cliente }))
    if ($isSatQuote) {
      $nit = 'SAT'
    } elseif ($isGpQuote) {
      $nit = if ($clientNitIn) { $clientNitIn } else { $gpCodeIn }
    } else {
      $nit = Normalize-Nit $rawNitIn
    }
    if (-not $isSatQuote -and -not ($isGpQuote -and -not $clientNitIn)) {
      if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
        Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
        return
      }
    }
    $gpRow = $null
    if ($isGpQuote) {
      $gpRow = Find-GerenteProducto (Read-GerentesProducto) $gpCodeIn
      if (-not $gpRow) {
        Send-Json $response @{ ok = $false; error = 'Gerente de producto no registrado.' } 403
        return
      }
    }
    $found = $null
    if ($isSatQuote) {
      foreach ($u in (Read-Users)) {
        $un = ([string]$u.nit -replace '[\s.]', '').ToUpperInvariant()
        if ($un -eq 'SAT' -or $un -eq 'ADMINSAT') { $found = $u; break }
      }
    } elseif (-not $isGpQuote) {
      foreach ($u in (Read-Users)) {
        if ((Normalize-Nit ([string]$u.nit)) -eq $nit) { $found = $u; break }
      }
      if (-not $found) {
        Send-Json $response @{ ok = $false; error = 'Usuario no registrado.' } 403
        return
      }
    }
    if (-not $nombre -and $found) { $nombre = ([string]$found.nombre).Trim() }
    if ($isSatQuote -and -not $nombre) { $nombre = 'Admin SAT' }
    if ($isGpQuote) {
      $gpNombre = ([string]$gpRow.nombre).Trim()
      if (-not $gpNombre) { $gpNombre = $gpCodeIn }
      $clientNombreIn = ([string]$(if ($body.client_nombre) { $body.client_nombre } else { $body.cliente_nombre })).Trim()
      if ($clientNitIn -and $clientNombreIn) { $nombre = $clientNombreIn }
      elseif (-not $nombre) { $nombre = $gpNombre }
    }
    $items = @()
    if ($null -ne $body.items) { $items = @($body.items) }
    if ($items.Count -eq 0) {
      Send-Json $response @{ ok = $false; error = 'La cotizacion no tiene productos.' } 400
      return
    }
    $fechaCierreCliente = ''
    try {
      if ($null -ne $body.fecha_cierre_cliente) { $fechaCierreCliente = ([string]$body.fecha_cierre_cliente).Trim() }
      elseif ($null -ne $body.fechaCierreCliente) { $fechaCierreCliente = ([string]$body.fechaCierreCliente).Trim() }
    } catch { $fechaCierreCliente = '' }
    if (-not $fechaCierreCliente) {
      Send-Json $response @{ ok = $false; error = 'Indica la fecha de cierre de venta.' } 400
      return
    }
    if ($fechaCierreCliente -notmatch '^\d{4}-\d{2}-\d{2}$') {
      Send-Json $response @{ ok = $false; error = 'Fecha de cierre de venta invalida.' } 400
      return
    }
    try {
      $null = [datetime]::ParseExact($fechaCierreCliente, 'yyyy-MM-dd', [System.Globalization.CultureInfo]::InvariantCulture)
    } catch {
      Send-Json $response @{ ok = $false; error = 'Fecha de cierre de venta invalida.' } 400
      return
    }
    $quoteId = (Get-Date).ToString('yyyyMMddHHmmssffffff') + '-' + $nit
    $sellerCodigo = ''
    $sellerAssigned = $null
    $sellerName = ''
    try {
      $cfgSeller = Read-BitrixConfig
      if ($cfgSeller.enabled -and $cfgSeller.webhook_base) {
        $sellerInfoPre = Find-BitrixSellerByNit $cfgSeller.webhook_base $cfgSeller $nit
        if ($sellerInfoPre.assigned_by_id) {
          $sellerAssigned = $sellerInfoPre.assigned_by_id
          $sellerName = [string]$sellerInfoPre.seller_name
          $sellerCodigo = Resolve-AsesorCodigoFromBitrixId $sellerAssigned
        }
      }
    } catch {}

    if ($isSatQuote) {
      $sellerCodigo = 'SAT'
      $sellerName = $(if ($nombre) { $nombre } else { 'Admin SAT' })
      $sellerAssigned = $null
    } elseif ($isGpQuote) {
      $sellerCodigo = $gpCodeIn
      $sellerName = ([string]$gpRow.nombre).Trim()
      if (-not $sellerName) { $sellerName = $gpCodeIn }
      $sellerAssigned = $null
      $gpIds = @(Get-GpBitrixIds $gpCodeIn)
      if ($gpIds.Count -gt 0) { $sellerAssigned = $gpIds[0] }
    }
    $quote = [ordered]@{
      id = $quoteId
      nit = $nit
      nombre = $nombre
      created_at = (Get-Date).ToString('o')
      trm = $body.trm
      empresa = ([string]$(if ($null -ne $body.empresa) { $body.empresa } elseif ($null -ne $body.totals -and $null -ne $body.totals.empresa) { $body.totals.empresa } else { '' })).Trim()
      fecha_cierre_cliente = $fechaCierreCliente
      items = $items
      totals = $(if ($null -ne $body.totals) { $body.totals } else { @{} })
      seller_codigo = $sellerCodigo
      assigned_by_id = $sellerAssigned
      seller_name = $sellerName
      asesor_estado = $(if ($isSatQuote -or $isGpQuote) { 'cotizado' } else { 'nueva' })
      quote_source = $(if ($isSatQuote) { 'sat' } elseif ($isGpQuote) { 'gp' } else { 'cliente' })
    }
    if ($isSatQuote) {
      $quote['asesor_cotizado_at'] = (Get-Date).ToString('o')
      $quote['asesor_cotizado_by'] = 'SAT'
      $quote['finished_at'] = (Get-Date).ToString('o')
    }
    if ($isGpQuote) {
      $quote['asesor_cotizado_at'] = (Get-Date).ToString('o')
      $quote['asesor_cotizado_by'] = $gpCodeIn
      $quote['finished_at'] = (Get-Date).ToString('o')
      $quote['seller_codigo'] = $gpCodeIn
      $quote['seller_name'] = $sellerName
    }
    $quotes = New-Object System.Collections.Generic.List[object]
    foreach ($q in (Read-Quotes)) { $quotes.Add($q) }
    $quotes.Add($quote)
    Write-Quotes $quotes.ToArray()

    $bitrix = Send-BitrixDeal $quote
    if ($bitrix.ok) {
      # Refuerza vendedor con lo que Bitrix resolvio al crear el deal
      $changed = $false
      if ($bitrix.assigned_by_id) {
        $quote.assigned_by_id = $bitrix.assigned_by_id
        $resolved = Resolve-AsesorCodigoFromBitrixId $bitrix.assigned_by_id
        if ($resolved) { $quote.seller_codigo = $resolved }
        $changed = $true
      }
      if ($bitrix.seller_name) {
        $quote.seller_name = [string]$bitrix.seller_name
        $changed = $true
      }
      if ($bitrix.deal_id) {
        $quote['bitrix_deal_id'] = [string]$bitrix.deal_id
        $changed = $true
      }
      if ($changed) {
        $quotes[$quotes.Count - 1] = $quote
        Write-Quotes $quotes.ToArray()
      }
    }
    $message = 'Cotizacion guardada'
    Send-Json $response @{
      ok = $true
      id = $quoteId
      message = $message
      bitrix = $bitrix
    }
    return
  }

  if ($action -eq 'get_bitrix') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $cfg = Read-BitrixConfig
    $masked = [string]$cfg.webhook_base
    if ($masked.Length -gt 40) {
      $masked = $masked.Substring(0, 28) + '…' + $masked.Substring($masked.Length - 8)
    }
    Send-Json $response @{
      ok = $true
      enabled = [bool]$cfg.enabled
      webhook_base = [string]$cfg.webhook_base
      webhook_masked = $masked
      stage_id = [string]$cfg.stage_id
      category_id = [string]$cfg.category_id
      currency_id = [string]$cfg.currency_id
      updated_at = [string]$cfg.updated_at
      configured = ([bool]$cfg.enabled -and [string]$cfg.webhook_base -and [string]$cfg.stage_id)
    }
    return
  }

  if ($action -eq 'set_bitrix') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $cfg = Read-BitrixConfig
    if ($null -ne $body.enabled) { $cfg.enabled = [bool]$body.enabled }
    if ($null -ne $body.webhook_base) { $cfg.webhook_base = [string]$body.webhook_base }
    if ($null -ne $body.stage_id) { $cfg.stage_id = [string]$body.stage_id }
    if ($null -ne $body.category_id) { $cfg.category_id = [string]$body.category_id }
    if ($null -ne $body.currency_id) { $cfg.currency_id = [string]$body.currency_id }
    if (-not $cfg.webhook_base -or -not $cfg.stage_id) {
      Send-Json $response @{ ok = $false; error = 'Webhook y STAGE_ID son obligatorios.' } 400
      return
    }
    $saved = Write-BitrixConfig $cfg $adminNit
    Send-Json $response @{
      ok = $true
      message = 'Configuracion Bitrix guardada.'
      enabled = [bool]$saved.enabled
      stage_id = [string]$saved.stage_id
      category_id = [string]$saved.category_id
      currency_id = [string]$saved.currency_id
      updated_at = [string]$saved.updated_at
    }
    return
  }

  if ($action -eq 'test_bitrix') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $cfg = Read-BitrixConfig
    if ($null -ne $body.webhook_base -and [string]$body.webhook_base) {
      $cfg.webhook_base = [string]$body.webhook_base
    }
    if ($null -ne $body.stage_id -and [string]$body.stage_id) {
      $cfg.stage_id = [string]$body.stage_id
    }
    if ($null -ne $body.category_id) { $cfg.category_id = [string]$body.category_id }
    if (-not $cfg.webhook_base) {
      Send-Json $response @{ ok = $false; error = 'Falta webhook_base.' } 400
      return
    }
    try {
      $profile = Invoke-BitrixRest $cfg.webhook_base 'profile.json' @{}
      $stages = $null
      if ($cfg.category_id -ne '') {
        try {
          $stages = Invoke-BitrixRest $cfg.webhook_base 'crm.dealcategory.stage.list.json' @{ id = $cfg.category_id }
        } catch { $stages = $null }
      }
      Send-Json $response @{
        ok = $true
        message = 'Webhook Bitrix responde correctamente.'
        profile = $profile.result
        stages = $(if ($null -ne $stages) { $stages.result } else { @() })
        stage_id = [string]$cfg.stage_id
      }
    } catch {
      Send-Json $response @{ ok = $false; error = 'No se pudo contactar Bitrix: ' + $_.Exception.Message } 502
    }
    return
  }

  if ($action -eq 'list_quotes') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $forceBitrix = $false
    $importNew = $false
    try {
      if ($body.refresh_bitrix -or $body.sync_bitrix -or $body.force) { $forceBitrix = $true }
      if ($body.import_new -or $body.import_bitrix_new) { $importNew = $true }
    } catch {}
    # Admin local: mapea Bitrix (deal_id/estado) sin crear cotizaciones nuevas por defecto.
    $bitrixSync = Start-LocalBitrixQuotesSyncIfDue $forceBitrix $importNew

    $safe = New-Object System.Collections.ArrayList
    $clientCount = 0
    $sorted = @(Read-Quotes) | Sort-Object { [string]$_.created_at } -Descending
    foreach ($q in $sorted) {
      if ($null -eq $q) { continue }
      if (-not (Test-QuoteHasPricedDeal $q)) { continue }
      $seller = Resolve-QuoteSellerLabel $q
      $isClient = $false
      if (Test-QuoteIsMadeByCliente $q) {
        $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
        if (-not $sellerCode) { $sellerCode = Normalize-AsesorCodigo ([string]$seller.seller_codigo) }
        $assigned = [string]$q.assigned_by_id
        if (-not $assigned) { $assigned = [string]$seller.assigned_by_id }
        $isGpSeller = [bool](Normalize-GpCodigo ([string]$q.seller_codigo))
        $isGpAssigned = $false
        if ($assigned -and (Test-Path $BitrixGerentesFile)) {
          try {
            $gmap = (Get-Content $BitrixGerentesFile -Raw -Encoding UTF8) | ConvertFrom-Json
            if ($null -ne $gmap.PSObject.Properties[$assigned]) { $isGpAssigned = $true }
          } catch {}
        }
        $inAsesor = $false
        if (-not $isGpSeller -and -not $isGpAssigned) {
          if ($sellerCode -match '^V\d+' -or $sellerCode -eq 'ADV') { $inAsesor = $true }
          elseif (Find-AsesorCodigoByClientNit (Normalize-Nit ([string]$q.nit))) { $inAsesor = $true }
          elseif ($assigned -and (Resolve-AsesorCodigoFromBitrixId $assigned)) { $inAsesor = $true }
        }
        $isClient = $inAsesor
      }
      if ($isClient) { $clientCount++ }
      [void]$safe.Add([ordered]@{
        id = [string]$q.id
        nit = [string]$q.nit
        nombre = [string]$q.nombre
        created_at = [string]$q.created_at
        trm = $q.trm
        items = $(if ($null -ne $q.items) { @($q.items) } else { @() })
        totals = $(if ($null -ne $q.totals) { $q.totals } else { @{} })
        seller_codigo = [string]$seller.seller_codigo
        seller_codigo_raw = (Normalize-AsesorCodigo ([string]$q.seller_codigo))
        assigned_by_id = [string]$seller.assigned_by_id
        seller_name = [string]$seller.seller_name
        seller_label = [string]$seller.seller_label
        asesor_estado = (Get-QuoteAsesorEstado $q)
        asesor_comentario = [string]$q.asesor_comentario
        asesor_comentario_at = [string]$q.asesor_comentario_at
        asesor_comentario_by = [string]$q.asesor_comentario_by
        fecha_cierre = [string]$q.fecha_cierre
        fecha_cierre_cliente = [string]$q.fecha_cierre_cliente
        quote_source = [string]$q.quote_source
        bitrix_deal_id = [string]$q.bitrix_deal_id
        synced_from_bitrix = [bool]$q.synced_from_bitrix
        is_duplicated = [bool](Test-QuoteIsDuplicated $q)
        duplicated_from = [string]($(if ($q.duplicated_from) { $q.duplicated_from } elseif ($q.recotizado_desde) { $q.recotizado_desde } else { '' }))
        is_client_quote = [bool]$isClient
      })
    }
    Send-Json $response @{ ok = $true; quotes = @($safe); count = $safe.Count; client_count = $clientCount; bitrix_sync = $bitrixSync }
    return
  }

  if ($action -eq 'list_clientes_sin_vendedor' -or $action -eq 'list_unassigned_clients') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $usersByNit = @{}
    foreach ($u in (As-ObjectList (Read-Users))) {
      if ($null -eq $u) { continue }
      $n = Normalize-Nit ([string]$u.nit)
      if (-not $n) { continue }
      $usersByNit[$n] = [ordered]@{
        nombre = ([string]$u.nombre).Trim()
        created_at = [string]$u.created_at
        registered = $true
      }
    }
    $dismissed = Get-ClientesSinVendedorDismissedMap
    $byNit = @{}
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      $n = Normalize-Nit ([string]$(if ($q.nit) { $q.nit } else { $q.client_nit }))
      if (-not $n) { continue }
      if ($dismissed.ContainsKey($n)) { continue }
      if (Find-AsesorCodigoByClientNit $n) { continue }
      $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
      if (-not $sellerCode) { $sellerCode = Resolve-AsesorCodigoFromBitrixId ([string]$q.assigned_by_id) }
      $orphan = (-not $sellerCode)
      if (-not $byNit.ContainsKey($n)) {
        $byNit[$n] = [ordered]@{
          nit = $n
          nombre = ([string]$q.nombre).Trim()
          quotes_total = 0
          quotes_sin_vendedor = 0
          last_quote_at = ''
          registered = $usersByNit.ContainsKey($n)
        }
      }
      $byNit[$n].quotes_total = [int]$byNit[$n].quotes_total + 1
      if ($orphan) { $byNit[$n].quotes_sin_vendedor = [int]$byNit[$n].quotes_sin_vendedor + 1 }
      $created = [string]($(if ($q.finished_at) { $q.finished_at } else { $q.created_at }))
      if ($created -and ([string]$created).CompareTo([string]$byNit[$n].last_quote_at) -gt 0) {
        $byNit[$n].last_quote_at = $created
      }
      if ((-not $byNit[$n].nombre -or $byNit[$n].nombre -eq $n) -and ([string]$q.nombre).Trim()) {
        $byNit[$n].nombre = ([string]$q.nombre).Trim()
      }
    }
    $out = New-Object System.Collections.Generic.List[object]
    foreach ($kv in $byNit.GetEnumerator()) {
      $row = $kv.Value
      if ([int]$row.quotes_sin_vendedor -le 0) { continue }
      if ($usersByNit.ContainsKey($row.nit) -and $usersByNit[$row.nit].nombre -and (-not $row.nombre -or $row.nombre -eq $row.nit)) {
        $row.nombre = $usersByNit[$row.nit].nombre
      }
      if (-not $row.nombre) { $row.nombre = $row.nit }
      $row.registered = $usersByNit.ContainsKey($row.nit)
      $row.registered_at = $(if ($usersByNit.ContainsKey($row.nit)) { [string]$usersByNit[$row.nit].created_at } else { '' })
      [void]$out.Add($row)
    }
    $sorted = @($out | Sort-Object { [string]$_.last_quote_at } -Descending)
    Send-Json $response @{ ok = $true; clients = $sorted; count = $sorted.Count }
    return
  }

  if ($action -eq 'assign_vendedor_cliente' -or $action -eq 'assign_seller_client') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $nit = Normalize-Nit ([string]$(if ($body.client_nit) { $body.client_nit } elseif ($body.nit) { $body.nit } else { '' }))
    $codigo = Normalize-AsesorCodigo ([string]$(if ($body.seller_codigo) { $body.seller_codigo } elseif ($body.asesor_codigo) { $body.asesor_codigo } else { $body.vendedor_codigo }))
    Remove-ClienteSinVendedorDismissed $nit
    if (-not $nit -or $nit -notmatch '^\d{6,15}$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    $asesor = Find-Asesor (Read-Asesores) $codigo
    if (-not $asesor) {
      Send-Json $response @{ ok = $false; error = 'Vendedor no encontrado.' } 400
      return
    }
    $nombre = ([string]$(if ($body.nombre) { $body.nombre } else { $body.cliente_nombre })).Trim()
    if (-not $nombre) {
      foreach ($u in (As-ObjectList (Read-Users))) {
        if ((Normalize-Nit ([string]$u.nit)) -eq $nit) { $nombre = ([string]$u.nombre).Trim(); break }
      }
    }
    if (-not $nombre) {
      foreach ($q in (As-ObjectList (Read-Quotes))) {
        $qn = Normalize-Nit ([string]$(if ($q.nit) { $q.nit } else { $q.client_nit }))
        if ($qn -eq $nit -and ([string]$q.nombre).Trim()) { $nombre = ([string]$q.nombre).Trim(); break }
      }
    }
    if (-not $nombre) { $nombre = $nit }

    $manual = Read-AsesorClientesManual
    if ($null -eq $manual.by_codigo) { $manual.by_codigo = [ordered]@{} }
    # Quitar NIT de otros asesores
    $codeKeys = @()
    if ($manual.by_codigo -is [System.Collections.IDictionary]) {
      $codeKeys = @($manual.by_codigo.Keys)
    } else {
      foreach ($prop in @($manual.by_codigo.PSObject.Properties)) { $codeKeys += [string]$prop.Name }
    }
    foreach ($codeKey in $codeKeys) {
      $kept = New-Object System.Collections.Generic.List[object]
      $rows = $null
      if ($manual.by_codigo -is [System.Collections.IDictionary]) { $rows = $manual.by_codigo[$codeKey] }
      else { $rows = $manual.by_codigo.$codeKey }
      foreach ($c in (As-ObjectList $rows)) {
        if ($null -eq $c) { continue }
        if ((Normalize-Nit ([string]$c.nit)) -eq $nit) { continue }
        [void]$kept.Add($c)
      }
      $manual.by_codigo[$codeKey] = $kept
    }
    $list = New-Object System.Collections.Generic.List[object]
    $existing = $null
    if ($manual.by_codigo -is [System.Collections.IDictionary]) { $existing = $manual.by_codigo[$codigo] }
    foreach ($c in (As-ObjectList $existing)) { if ($null -ne $c) { [void]$list.Add($c) } }
    $updated = $false
    for ($i = 0; $i -lt $list.Count; $i++) {
      if ((Normalize-Nit ([string]$list[$i].nit)) -ne $nit) { continue }
      $copy = [ordered]@{}
      foreach ($p in $list[$i].PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $copy['nombre'] = $nombre
      $copy['updated_at'] = (Get-Date).ToString('o')
      $copy['updated_by'] = $(if ($adminNit) { $adminNit } else { 'admin' })
      $copy['assigned_by_admin'] = $true
      $list[$i] = $copy
      $updated = $true
      break
    }
    if (-not $updated) {
      [void]$list.Add([ordered]@{
        nit = $nit
        nombre = $nombre
        telefono = ''
        created_at = (Get-Date).ToString('o')
        created_by = $(if ($adminNit) { $adminNit } else { 'admin' })
        assigned_by_admin = $true
      })
    }
    $manual.by_codigo[$codigo] = $list.ToArray()
    Write-AsesorClientesManual $manual
    $script:AsesorCodigoByNitCache = $null

    $bitrixIds = Get-AsesorBitrixIds $codigo
    $assignedId = ''
    if ($bitrixIds -and $bitrixIds.Count -gt 0) { $assignedId = [string]$bitrixIds[0] }
    $sellerName = Get-SellerNameFromCodigoOrId $codigo $assignedId
    if (-not $sellerName) {
      $sellerName = ([string]$asesor.nombre).Trim()
      if ($sellerName -and $sellerName -notlike "*$codigo*") { $sellerName = ($codigo + ' - ' + $sellerName) }
      if (-not $sellerName) { $sellerName = $codigo }
    }

    $quotesOut = New-Object System.Collections.Generic.List[object]
    $quotesUpdated = 0
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      $copy = [ordered]@{}
      foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
      $qn = Normalize-Nit ([string]$(if ($copy.nit) { $copy.nit } else { $copy.client_nit }))
      if ($qn -eq $nit) {
        $copy['seller_codigo'] = $codigo
        $copy['seller_name'] = $sellerName
        if ($assignedId) { $copy['assigned_by_id'] = $assignedId }
        $copy['assigned_by_admin'] = $true
        $copy['vendedor_asignado_at'] = (Get-Date).ToString('o')
        $copy['vendedor_asignado_by'] = $(if ($adminNit) { $adminNit } else { 'admin' })
        $quotesUpdated++
      }
      [void]$quotesOut.Add($copy)
    }
    if ($quotesUpdated -gt 0) { Write-Quotes $quotesOut.ToArray() }

    Send-Json $response @{
      ok = $true
      message = 'Vendedor asignado. Las cotizaciones ya aparecen en el panel del asesor.'
      quotes_updated = $quotesUpdated
      client = @{
        nit = $nit
        nombre = $nombre
        vendedor_codigo = $codigo
        vendedor_nombre = $sellerName
      }
    }
    return
  }

  if ($action -eq 'delete_cliente_sin_vendedor' -or $action -eq 'dismiss_unassigned_client') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $nit = Normalize-Nit ([string]$(if ($body.client_nit) { $body.client_nit } elseif ($body.nit) { $body.nit } else { '' }))
    if (-not $nit -or $nit -notmatch '^\d{6,15}$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    $quotesOut = New-Object System.Collections.Generic.List[object]
    $quotesRemoved = 0
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      $qn = Normalize-Nit ([string]$(if ($q.nit) { $q.nit } else { $q.client_nit }))
      if ($qn -ne $nit) {
        [void]$quotesOut.Add($q)
        continue
      }
      $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
      if (-not $sellerCode) { $sellerCode = Resolve-AsesorCodigoFromBitrixId ([string]$q.assigned_by_id) }
      if (-not $sellerCode) {
        $quotesRemoved++
        continue
      }
      [void]$quotesOut.Add($q)
    }
    if ($quotesRemoved -gt 0) { Write-Quotes $quotesOut.ToArray() }

    $userRemoved = $false
    if ($nit -ne $adminNit) {
      $usersOut = New-Object System.Collections.Generic.List[object]
      foreach ($u in (As-ObjectList (Read-Users))) {
        if ($null -eq $u) { continue }
        if ((Normalize-Nit ([string]$u.nit)) -ne $nit) {
          [void]$usersOut.Add($u)
          continue
        }
        $role = ([string]$u.role).Trim().ToLowerInvariant()
        if ($role -in @('admin', 'asesor', 'zkteco', 'zebra')) {
          [void]$usersOut.Add($u)
          continue
        }
        $userRemoved = $true
      }
      if ($userRemoved) { Write-Users $usersOut.ToArray() }
    }

    Add-ClienteSinVendedorDismissed $nit
    $msg = 'Cliente quitado de la lista'
    if ($quotesRemoved -gt 0) { $msg += (' (' + $quotesRemoved + ' cotizacion(es) sin vendedor eliminadas)') }
    if ($userRemoved) { $msg += ' y cuenta portal eliminada' }
    $msg += '.'
    Send-Json $response @{
      ok = $true
      message = $msg
      nit = $nit
      quotes_removed = $quotesRemoved
      user_removed = $userRemoved
      dismissed = $true
    }
    return
  }

  if ($action -eq 'sync_local_data' -or $action -eq 'sync_local_all') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    $asesorCodigo = Normalize-AsesorCodigo ([string]$(if ($body.asesor_codigo) { $body.asesor_codigo } else { $body.nit }))
    $isAdmin = (Test-IsAdminNit $adminNit)
    $isAsesor = $false
    if ($asesorCodigo) { $isAsesor = [bool](Find-Asesor (Read-Asesores) $asesorCodigo) }
    if (-not $isAdmin -and -not $isAsesor) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }

    $force = $true
    $clientesOk = 0
    $clientesErr = 0
    $codes = New-Object System.Collections.Generic.List[string]
    if ($isAsesor -and -not $isAdmin) {
      [void]$codes.Add($asesorCodigo)
    } else {
      foreach ($a in (As-ObjectList (Read-Asesores))) {
        $c = Normalize-AsesorCodigo ([string]$(if ($a.codigo) { $a.codigo } else { $a.nit }))
        if ($c) { [void]$codes.Add($c) }
      }
    }
    foreach ($c in $codes) {
      try {
        $sync = Sync-AsesorClientesFromBitrix $c $force $false
        if ($sync -and -not $sync.error) { $clientesOk++ } else { $clientesErr++ }
      } catch { $clientesErr++ }
    }

    $quotesSync = Start-LocalBitrixQuotesSyncIfDue $true $false
    # Esperar un poco a que el proceso arranque / avance
    Start-Sleep -Seconds 2

    $msg = "Clientes Bitrix: $clientesOk asesores ok"
    if ($clientesErr -gt 0) { $msg = $msg + ", $clientesErr con error" }
    if ($quotesSync.started) {
      $msg = $msg + '. Cotizaciones: mapeo Bitrix iniciado (deal_id/estado, sin crear nuevas).'
    } elseif ($quotesSync.from_cache) {
      $msg = $msg + '. Cotizaciones: sync reciente en cache.'
    } elseif ($quotesSync.error) {
      $msg = $msg + '. Cotizaciones: ' + [string]$quotesSync.error
    }

    Send-Json $response @{
      ok = $true
      message = $msg
      clientes_ok = $clientesOk
      clientes_err = $clientesErr
      quotes_sync = $quotesSync
      import_new = $false
    }
    return
  }

  if ($action -eq 'pull_from_remote_server') {
    # Solo en el PC local: lee el servidor remoto y escribe data/ local.
    # NUNCA escribe en el servidor remoto.
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $serverBase = ([string]$body.server_base).Trim().TrimEnd('/')
    if (-not $serverBase) { $serverBase = 'http://pqr.izc.com.co:8183/IZC' }
    $uris = @(
      ($serverBase + '/api/auth.php'),
      ($serverBase + '/api/auth')
    )
    $payload = (@{ action = 'export_admin_data'; admin_nit = $adminNit } | ConvertTo-Json -Compress)
    $rawText = $null
    $lastErr = ''
    foreach ($uri in $uris) {
      try {
        $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $uri -Body $payload -ContentType 'application/json; charset=utf-8' -TimeoutSec 300
        $rawText = [string]$r.Content
        if ($rawText -match '"ok"\s*:\s*true') { break }
        $lastErr = $rawText.Substring(0, [Math]::Min(240, $rawText.Length))
        $rawText = $null
      } catch {
        $lastErr = [string]$_.Exception.Message
      }
    }
    if (-not $rawText) {
      Send-Json $response @{ ok = $false; error = ('No se pudo leer el servidor: ' + $lastErr + ' Sube api/auth.php (export_admin_data) al servidor.') } 502
      return
    }
    $resp = $rawText | ConvertFrom-Json
    if (-not $resp.ok) {
      Send-Json $response @{ ok = $false; error = ([string]$resp.error) } 400
      return
    }
    if (-not $resp.read_only) {
      Send-Json $response @{ ok = $false; error = 'Respuesta sin read_only; abortado por seguridad.' } 500
      return
    }
    if (-not $resp.files_raw) {
      Send-Json $response @{ ok = $false; error = 'El servidor no devolvio files_raw. Actualiza api/auth.php en el servidor.' } 500
      return
    }

    $backup = Join-Path $Root ('data\_backup_before_pull_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $names = @(
      'cotizaciones.json','usuarios.json','asesores.json','trm.json',
      'asesor_clientes_manual.json','asesor_clientes_index.json',
      'productos_creados_asesor.json','bitrix_vendedores.json',
      'nit_nombres.json','nit_telefonos.json','nit_direcciones.json'
    )
    $written = 0
    foreach ($name in $names) {
      $prop = $resp.files_raw.PSObject.Properties[$name]
      if (-not $prop -or $null -eq $prop.Value -or [string]$prop.Value -eq '') { continue }
      $dest = Join-Path $Root ('data\' + $name)
      if (Test-Path $dest) { Copy-Item -LiteralPath $dest -Destination (Join-Path $backup $name) -Force }
      $content = [string]$prop.Value
      if (-not $content.EndsWith("`n")) { $content = $content + "`n" }
      [System.IO.File]::WriteAllText($dest, $content, [System.Text.UTF8Encoding]::new($false))
      $written++
    }

    $summary = 'Local actualizado desde el servidor (' + $written + ' archivos). Backup: ' + $backup + '. El servidor no se modifico.'
    # Tras alinear el set con el servidor, mapear deal_id/estado desde Bitrix (sin importar nuevas).
    $mapSync = Start-LocalBitrixQuotesSyncIfDue $true $false
    if ($mapSync.started) {
      $summary = $summary + ' Mapeo Bitrix (historial) iniciado.'
    } elseif ($mapSync.error) {
      $summary = $summary + ' Aviso mapeo Bitrix: ' + [string]$mapSync.error
    }
    Send-Json $response @{
      ok = $true
      message = $summary
      written = $written
      backup = $backup
      counts = $resp.counts
      read_only_remote = $true
      bitrix_map = $mapSync
    }
    return
  }

  if ($action -eq 'list_productos_creados' -or $action -eq 'list_created_products') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $products = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      $src = ([string]$q.quote_source).ToLowerInvariant()
      $sellerCodigo = Normalize-AsesorCodigo ([string]$q.seller_codigo)
      if (-not $sellerCodigo) { $sellerCodigo = Normalize-AsesorCodigo ([string]$q.asesor_cotizado_by) }
      $sellerName = [string]$q.seller_name
      $createdAt = [string]($(if ($q.finished_at) { $q.finished_at } else { $q.created_at }))
      $qid = [string]$q.id
      foreach ($it in (As-ObjectList $q.items)) {
        if ($null -eq $it) { continue }
        $custom = $false
        try { if ($it.custom -eq $true -or [string]$it.custom -eq 'True' -or [string]$it.custom -eq '1') { $custom = $true } } catch {}
        try { if ($it.manual -eq $true -or [string]$it.manual -eq 'True' -or [string]$it.manual -eq '1') { $custom = $true } } catch {}
        try { if ([string]$it.created_by) { $custom = $true } } catch {}
        $name = [string]$it.name
        if (-not $custom -and $name -notmatch '(?i)^producto\s+') {
          continue
        }
        $sku = ([string]$(if ($it.sku) { $it.sku } else { $it.codigo })).Trim().ToUpperInvariant()
        if (-not $sku) { continue }
        $usd = 0.0
        try { if ($null -ne $it.unitarioUsd) { $usd = [double]$it.unitarioUsd } } catch {}
        if ($usd -le 0) { try { if ($null -ne $it.usd) { $usd = [double]$it.usd } } catch {} }
        if ($usd -le 0) { try { if ($null -ne $it.usdIva) { $usd = [double]$it.usdIva / 1.19 } } catch {} }
        $cop = 0.0
        try { if ($null -ne $it.unitarioCop) { $cop = [double]$it.unitarioCop } } catch {}
        if ($cop -le 0) { try { if ($null -ne $it.copSinIva) { $cop = [double]$it.copSinIva } } catch {} }
        if ($cop -le 0) { try { if ($null -ne $it.cop) { $cop = [double]$it.cop } } catch {} }
        if ($cop -le 0) { try { if ($null -ne $it.copIva) { $cop = [double]$it.copIva / 1.19 } } catch {} }
        $trmQ = 0.0
        try { if ($null -ne $q.trm) { $trmQ = [double]$q.trm } } catch {}
        if ($usd -le 0 -and $cop -gt 0 -and $trmQ -gt 1000) { $usd = $cop / $trmQ }
        $itemSeller = Normalize-AsesorCodigo ([string]$it.created_by)
        if (-not $itemSeller) { $itemSeller = $sellerCodigo }
        $itemCreated = [string]($(if ($it.created_at) { $it.created_at } else { $createdAt }))
        $key = "$sku|$itemSeller|$qid"
        if (-not $seen.Add($key)) { continue }
        [void]$products.Add([ordered]@{
          sku = $sku
          name = $name
          referencia = [string]$it.referencia
          unitario_usd = $usd
          unitario_cop = $cop
          seller_codigo = $itemSeller
          seller_name = $sellerName
          created_at = $itemCreated
          quote_id = $qid
        })
      }
    }
    $sorted = @($products | Sort-Object { [string]$_.created_at } -Descending)
    Send-Json $response @{ ok = $true; products = $sorted; count = $sorted.Count }
    return
  }

  if ($action -eq 'get_productos_creados') {
    $codigo = Normalize-AsesorCodigo ([string]$(if ($body.asesor_codigo) { $body.asesor_codigo } else { $body.nit_asesor }))
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    $okAsesor = $false
    if ($codigo) {
      $asesorFound = Find-Asesor (Read-Asesores) $codigo
      if ($null -ne $asesorFound) { $okAsesor = $true }
    }
    $okAdmin = (Test-IsAdminNit $adminNit)
    if (-not $okAsesor -and -not $okAdmin) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $all = New-Object System.Collections.Generic.List[object]
    $seenG = New-Object 'System.Collections.Generic.HashSet[string]'
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -eq $q) { continue }
      $sellerCodigo = Normalize-AsesorCodigo ([string]$q.seller_codigo)
      if (-not $sellerCodigo) { $sellerCodigo = Normalize-AsesorCodigo ([string]$q.asesor_cotizado_by) }
      $sellerName = [string]$q.seller_name
      $createdAt = [string]($(if ($q.finished_at) { $q.finished_at } else { $q.created_at }))
      $qid = [string]$q.id
      $trmQ = 0.0
      try { if ($null -ne $q.trm) { $trmQ = [double]$q.trm } } catch {}
      foreach ($it in (As-ObjectList $q.items)) {
        if ($null -eq $it) { continue }
        $isCustom = $false
        try { if ($it.custom -eq $true -or $it.manual -eq $true) { $isCustom = $true } } catch {}
        try { if ([string]$it.created_by) { $isCustom = $true } } catch {}
        $name = [string]$it.name
        if (-not $isCustom -and $name -notmatch '(?i)^producto\s+') { continue }
        $sku = ([string]$(if ($it.sku) { $it.sku } else { $it.codigo })).Trim().ToUpperInvariant()
        if (-not $sku) { continue }
        $usd = 0.0
        try { if ($null -ne $it.unitarioUsd) { $usd = [double]$it.unitarioUsd } } catch {}
        if ($usd -le 0) { try { if ($null -ne $it.usd) { $usd = [double]$it.usd } } catch {} }
        $cop = 0.0
        try { if ($null -ne $it.unitarioCop) { $cop = [double]$it.unitarioCop } } catch {}
        if ($cop -le 0) { try { if ($null -ne $it.copIva) { $cop = [double]$it.copIva / 1.19 } } catch {} }
        if ($usd -le 0 -and $cop -gt 0 -and $trmQ -gt 1000) { $usd = $cop / $trmQ }
        $itemSeller = Normalize-AsesorCodigo ([string]$it.created_by)
        if (-not $itemSeller) { $itemSeller = $sellerCodigo }
        $itemCreated = [string]($(if ($it.created_at) { $it.created_at } else { $createdAt }))
        $key = "$sku|$itemSeller|$qid"
        if (-not $seenG.Add($key)) { continue }
        [void]$all.Add([ordered]@{
          sku = $sku
          name = $name
          referencia = [string]$it.referencia
          unitario_usd = $usd
          unitario_cop = $cop
          seller_codigo = $itemSeller
          seller_name = $sellerName
          created_at = $itemCreated
          quote_id = $qid
        })
      }
    }
    $pcFileG = Join-Path $Root 'data\productos_creados_asesor.json'
    if (Test-Path -LiteralPath $pcFileG) {
      try {
        $pcG = (Get-Content -LiteralPath $pcFileG -Raw -Encoding UTF8) | ConvertFrom-Json
        foreach ($p in (As-ObjectList $pcG.products)) {
          if ($null -eq $p) { continue }
          $sku = ([string]$p.sku).Trim().ToUpperInvariant()
          if (-not $sku) { continue }
          $seller = Normalize-AsesorCodigo ([string]$p.seller_codigo)
          $qid = [string]$p.quote_id
          $key = "$sku|$seller|$qid"
          if (-not $seenG.Add($key)) { continue }
          $usd = 0.0; $cop = 0.0
          try { if ($null -ne $p.unitario_usd) { $usd = [double]$p.unitario_usd } } catch {}
          try { if ($null -ne $p.unitario_cop) { $cop = [double]$p.unitario_cop } } catch {}
          [void]$all.Add([ordered]@{
            sku = $sku
            name = [string]$p.name
            referencia = [string]$p.referencia
            unitario_usd = $usd
            unitario_cop = $cop
            seller_codigo = $seller
            seller_name = [string]$p.seller_name
            created_at = [string]$p.created_at
            quote_id = $qid
          })
        }
      } catch {}
    }
    $bySku = @{}
    foreach ($p in $all) {
      $sku = [string]$p.sku
      if (-not $sku) { continue }
      if (-not $bySku.ContainsKey($sku)) { $bySku[$sku] = $p; continue }
      $prev = $bySku[$sku]
      $prevPh = ([string]$prev.name) -match '(?i)^producto\s+'
      $nextPh = ([string]$p.name) -match '(?i)^producto\s+'
      $newer = ([string]$p.created_at) -gt ([string]$prev.created_at)
      if ($prevPh -and -not $nextPh) {
        $bySku[$sku] = $p
      } elseif (-not $prevPh -and $nextPh -and $newer) {
        $merged = [ordered]@{
          sku = $sku
          name = [string]$prev.name
          referencia = $(if ([string]$p.referencia) { [string]$p.referencia } else { [string]$prev.referencia })
          unitario_usd = $(if ([double]$p.unitario_usd -gt 0) { [double]$p.unitario_usd } else { [double]$prev.unitario_usd })
          unitario_cop = $(if ([double]$p.unitario_cop -gt 0) { [double]$p.unitario_cop } else { [double]$prev.unitario_cop })
          seller_codigo = [string]$p.seller_codigo
          seller_name = [string]$p.seller_name
          created_at = [string]$p.created_at
          quote_id = [string]$p.quote_id
        }
        $bySku[$sku] = $merged
      } elseif ($newer) {
        $bySku[$sku] = $p
      }
    }
    $uniq = @($bySku.Values)
    Send-Json $response @{ ok = $true; products = $uniq; count = $uniq.Count }
    return
  }

  if ($action -eq 'list_my_quotes') {
    if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    $safe = @()
    $sorted = @(Read-Quotes) | Sort-Object { [string]$_.created_at } -Descending
    foreach ($q in $sorted) {
      if ($null -eq $q) { continue }
      if ((Normalize-Nit ([string]$q.nit)) -ne $nit) { continue }
      $safe += [ordered]@{
        id = [string]$q.id
        nit = [string]$q.nit
        nombre = [string]$q.nombre
        created_at = [string]$q.created_at
        fecha_cierre_cliente = [string]$q.fecha_cierre_cliente
        trm = $q.trm
        items = $(if ($null -ne $q.items) { @($q.items) } else { @() })
        totals = $(if ($null -ne $q.totals) { $q.totals } else { @{} })
      }
    }
    Send-Json $response @{ ok = $true; quotes = $safe; count = $safe.Count }
    return
  }

  if ($action -eq 'get_trm') {
    $entry = Read-Trm
    $value = 3204.0
    try { $value = [double]$entry.value } catch { $value = 3204.0 }
    if ($value -le 0) { $value = 3204.0 }
    Send-Json $response @{
      ok = $true
      value = $value
      updated_at = [string]$entry.updated_at
      updated_by_nit = [string]$entry.updated_by_nit
      updated_by_nombre = [string]$entry.updated_by_nombre
    }
    return
  }

  if ($action -eq 'set_trm') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if (-not (Test-IsAdminNit $adminNit)) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $value = 0.0
    try { $value = [double]$body.value } catch { $value = 0.0 }
    if ($value -le 0) {
      Send-Json $response @{ ok = $false; error = 'La TRM debe ser mayor que cero.' } 400
      return
    }
    $adminNombre = ([string]$body.admin_nombre).Trim()
    $entry = Write-Trm $value $adminNit $adminNombre
    Send-Json $response @{
      ok = $true
      value = [double]$entry.value
      updated_at = [string]$entry.updated_at
      message = 'TRM actualizada para el cotizador.'
    }
    return
  }


  if ($action -eq 'list_gerentes_producto') {
    if (-not (Test-IsSatActor $body) -and -not (Test-IsAdminNit (Normalize-Nit ([string]$body.admin_nit)))) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $rows = New-Object System.Collections.ArrayList
    foreach ($g in (As-ObjectList (Read-GerentesProducto))) {
      if ($null -eq $g) { continue }
      [void]$rows.Add([ordered]@{
        codigo = Normalize-GpCodigo ([string]$g.codigo)
        nombre = ([string]$g.nombre).Trim()
        bitrix_id = ([string]$g.bitrix_id).Trim()
        email = ([string]$g.email).Trim()
        created_at = [string]$g.created_at
      })
    }
    Send-Json $response @{ ok = $true; gerentes = @($rows); count = $rows.Count }
    return
  }

  if ($action -eq 'register_gp' -or $action -eq 'register_gerente_producto') {
    # Registro publico: el GP se registra solo.
    $codigo = Normalize-GpCodigo ([string]$(if ($body.codigo) { $body.codigo } elseif ($body.gp) { $body.gp } else { $body.nit }))
    $passwordGp = [string]$body.password
    $nombreGp = ([string]$body.nombre).Trim()
    $bitrixId = ([string]$body.bitrix_id).Trim()
    $email = ([string]$body.email).Trim()
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Codigo GP invalido. Usa GP1, GP23, etc.' } 400
      return
    }
    if ($passwordGp.Length -lt 4) {
      Send-Json $response @{ ok = $false; error = 'La contrasena debe tener al menos 4 caracteres.' } 400
      return
    }
    if (-not $nombreGp -or $nombreGp.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa tu nombre (minimo 2 caracteres).' } 400
      return
    }
    if (-not $bitrixId -and (Test-Path $BitrixGerentesFile)) {
      try {
        $map = (Get-Content $BitrixGerentesFile -Raw -Encoding UTF8) | ConvertFrom-Json
        foreach ($p in $map.PSObject.Properties) {
          $blob = ([string]$p.Value -replace '[\s.]', '').ToUpperInvariant()
          if ($blob -and $blob.Contains($codigo)) { $bitrixId = [string]$p.Name; break }
        }
      } catch {}
    }
    $rows = New-Object System.Collections.Generic.List[object]
    foreach ($g in (As-ObjectList (Read-GerentesProducto))) { if ($null -ne $g) { [void]$rows.Add($g) } }
    $existing = Find-GerenteProducto $rows $codigo
    if ($existing) {
      $kept = New-Object System.Collections.Generic.List[object]
      foreach ($g in $rows) {
        if ((Normalize-GpCodigo ([string]$g.codigo)) -eq $codigo) {
          $kept.Add([pscustomobject]@{
            codigo = $codigo
            nombre = $nombreGp
            password_hash = (New-PasswordHash $passwordGp)
            bitrix_id = $(if ($bitrixId) { $bitrixId } else { [string]$g.bitrix_id })
            email = $(if ($email) { $email } else { [string]$g.email })
            created_at = $(if ($g.created_at) { [string]$g.created_at } else { (Get-Date).ToString('o') })
          })
        } else {
          [void]$kept.Add($g)
        }
      }
      Write-GerentesProducto $kept.ToArray()
      Send-Json $response @{
        ok = $true
        message = 'Cuenta GP actualizada. Ya puedes iniciar sesion.'
        codigo = $codigo
        nit = $codigo
        nombre = $nombreGp
        role = 'gp'
        updated = $true
      }
      return
    }
    $rows.Add([pscustomobject]@{
      codigo = $codigo
      nombre = $nombreGp
      password_hash = (New-PasswordHash $passwordGp)
      bitrix_id = $bitrixId
      email = $email
      created_at = (Get-Date).ToString('o')
    })
    Write-GerentesProducto $rows.ToArray()
    Send-Json $response @{
      ok = $true
      message = 'Cuenta GP creada. Ya puedes iniciar sesion.'
      codigo = $codigo
      nit = $codigo
      nombre = $nombreGp
      role = 'gp'
    }
    return
  }

  if ($action -eq 'delete_gp' -or $action -eq 'delete_gerente_producto') {
    if (-not (Test-IsSatActor $body) -and -not (Test-IsAdminNit (Normalize-Nit ([string]$body.admin_nit)))) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $codigo = Normalize-GpCodigo ([string]$(if ($body.codigo) { $body.codigo } else { $body.gp }))
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Falta codigo GP.' } 400
      return
    }
    $kept = New-Object System.Collections.Generic.List[object]
    $removed = $false
    foreach ($g in (As-ObjectList (Read-GerentesProducto))) {
      if ((Normalize-GpCodigo ([string]$g.codigo)) -eq $codigo) { $removed = $true; continue }
      [void]$kept.Add($g)
    }
    if (-not $removed) {
      Send-Json $response @{ ok = $false; error = 'GP no encontrado.' } 404
      return
    }
    Write-GerentesProducto $kept.ToArray()
    Send-Json $response @{ ok = $true; message = ('GP ' + $codigo + ' eliminado.') }
    return
  }

  if ($action -eq 'list_clientes_gp') {
    $codigo = Normalize-GpCodigo ([string]$(if ($body.gp_codigo) { $body.gp_codigo } elseif ($body.asesor_codigo) { $body.asesor_codigo } else { $body.nit }))
    $gp = Find-GerenteProducto (Read-GerentesProducto) $codigo
    $okAdmin = (Test-IsSatActor $body) -or (Test-IsAdminNit (Normalize-Nit ([string]$body.admin_nit)))
    if (-not $gp -and -not $okAdmin) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    if ($okAdmin -and -not $codigo) {
      $codigo = Normalize-GpCodigo ([string]$(if ($body.gp_codigo) { $body.gp_codigo } else { $body.codigo }))
    }
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Falta codigo GP.' } 400
      return
    }
    $force = $false
    try { if ($body.refresh_bitrix -or $body.sync_bitrix -or $body.force) { $force = $true } } catch {}
    $data = Sync-GpClientesFromBitrix $codigo $force $false
    $clientes = New-Object System.Collections.ArrayList
    foreach ($c in (As-ObjectList $data.clientes)) { if ($null -ne $c) { [void]$clientes.Add($c) } }
    Send-Json $response @{
      ok = $true
      codigo = $codigo
      clientes = @($clientes)
      count = $clientes.Count
      bitrix_synced = [bool]$data.synced
      bitrix_from_cache = [bool]$data.from_cache
      bitrix_count = [int]$data.bitrix_count
      bitrix_fetched_at = [string]$data.fetched_at
      bitrix_error = [string]$data.error
    }
    return
  }

  if ($action -eq 'list_quotes_sat') {
    if (-not (Test-IsSatActor $body) -and -not (Test-IsAdminNit (Normalize-Nit ([string]$body.admin_nit)))) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $scope = ([string]$body.scope).Trim().ToLowerInvariant()
    if ($scope -ne 'clientes') { $scope = 'gerentes' }
    $listOnly = $false
    try { if ($body.fast -or $body.list_only) { $listOnly = $true } } catch {}
    $data = Get-QuotesForSat $scope @{ list_only = $listOnly }
    $otherScope = if ($scope -eq 'clientes') { 'gerentes' } else { 'clientes' }
    $other = Get-QuotesForSat $otherScope @{ list_only = $true }
    $gerentesCount = 0
    foreach ($g in (As-ObjectList (Read-GerentesProducto))) {
      if ($null -eq $g) { continue }
      if (Normalize-GpCodigo ([string]$g.codigo)) { $gerentesCount++ }
    }
    Send-Json $response @{
      ok = $true
      quotes = @($data.quotes)
      count = [int]$data.count
      scope = $scope
      client_count = $(if ($scope -eq 'clientes') { [int]$data.count } else { [int]$other.count })
      gerentes_quotes_count = $(if ($scope -eq 'gerentes') { [int]$data.count } else { [int]$other.count })
      gerentes_count = $gerentesCount
      role = 'sat'
      codigo = 'SAT'
    }
    return
  }

  if ($action -eq 'list_quotes_gp') {
    $codigo = Normalize-GpCodigo ([string]$(if ($body.gp_codigo) { $body.gp_codigo } elseif ($body.asesor_codigo) { $body.asesor_codigo } else { $body.nit }))
    $gp = Find-GerenteProducto (Read-GerentesProducto) $codigo
    $okAdmin = (Test-IsSatActor $body) -or (Test-IsAdminNit (Normalize-Nit ([string]$body.admin_nit)))
    if (-not $gp -and -not $okAdmin) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    if ($okAdmin -and -not $codigo) {
      $codigo = Normalize-GpCodigo ([string]$(if ($body.gp_codigo) { $body.gp_codigo } else { $body.codigo }))
    }
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Falta codigo GP.' } 400
      return
    }
    $scope = ([string]$body.scope).Trim().ToLowerInvariant()
    if ($scope -ne 'clientes') { $scope = 'historial' }
    $listOnly = $false
    try { if ($body.fast -or $body.list_only) { $listOnly = $true } } catch {}
    $data = Get-QuotesForGp $codigo $scope @{ list_only = $listOnly }
    $otherScope = if ($scope -eq 'clientes') { 'historial' } else { 'clientes' }
    $other = Get-QuotesForGp $codigo $otherScope @{ list_only = $true }
    $clients = Sync-GpClientesFromBitrix $codigo $false $false
    Send-Json $response @{
      ok = $true
      codigo = $codigo
      scope = $scope
      quotes = @($data.quotes)
      count = [int]$data.count
      historial_count = $(if ($scope -eq 'historial') { [int]$data.count } else { [int]$other.count })
      client_quotes_count = $(if ($scope -eq 'clientes') { [int]$data.count } else { [int]$other.count })
      clientes_count = @($clients.clientes).Count
      role = 'gp'
    }
    return
  }

  if ($action -eq 'get_quote_gp') {
    $codigo = Normalize-GpCodigo ([string]$(if ($body.gp_codigo) { $body.gp_codigo } elseif ($body.asesor_codigo) { $body.asesor_codigo } else { $body.nit }))
    $gp = Find-GerenteProducto (Read-GerentesProducto) $codigo
    $okAdmin = (Test-IsSatActor $body) -or (Test-IsAdminNit (Normalize-Nit ([string]$body.admin_nit)))
    if (-not $gp -and -not $okAdmin) {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $quoteId = ([string]$(if ($body.quote_id) { $body.quote_id } else { $body.id })).Trim()
    if (-not $quoteId) {
      Send-Json $response @{ ok = $false; error = 'Falta el id de la cotizacion.' } 400
      return
    }
    $found = $null
    foreach ($q in (As-ObjectList (Read-Quotes))) {
      if ($null -ne $q -and [string]$q.id -eq $quoteId) { $found = $q; break }
    }
    if (-not $found) {
      Send-Json $response @{ ok = $false; error = 'Cotizacion no encontrada.' } 404
      return
    }
    Prepare-QuoteForDisplay $found $false | Out-Null
    $estado = Get-QuoteAsesorEstado $found
    Send-Json $response @{ ok = $true; quote = (Convert-QuoteToAsesorDetailRow $found $estado) }
    return
  }


  Send-Json $response @{ ok = $false; error = 'Accion no valida.' } 400
}

function Handle-Static($request, $response) {
  $rel = [Uri]::UnescapeDataString($request.Url.AbsolutePath.TrimStart('/'))
  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'marcas.html' }
  $rel = $rel -replace '/', '\'
  if ($rel.Contains('..')) {
    $response.StatusCode = 400
    $response.Close()
    return
  }
  $full = Join-Path $Root $rel
  if (-not (Test-Path $full) -or (Get-Item $full).PSIsContainer) {
    $response.StatusCode = 404
    $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
    $response.ContentType = 'text/plain; charset=utf-8'
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
    $response.OutputStream.Close()
    return
  }

  $mime = Get-Mime $full
  $fileInfo = Get-Item -LiteralPath $full
  $fileLen = [long]$fileInfo.Length
  $response.Headers.Add('Cache-Control', 'no-store')
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
  $response.Headers.Add('Accept-Ranges', 'bytes')
  $response.ContentType = $mime

  $rangeHeader = [string]$request.Headers['Range']
  $isVideo = $mime.StartsWith('video/')
  if ($isVideo -and $rangeHeader -match '^bytes=(\d*)-(\d*)$') {
    $start = 0L
    $end = $fileLen - 1L
    if ($Matches[1] -ne '') { $start = [long]$Matches[1] }
    if ($Matches[2] -ne '') { $end = [long]$Matches[2] }
    if ($start -lt 0) { $start = 0 }
    if ($end -ge $fileLen) { $end = $fileLen - 1 }
    if ($start -gt $end -or $start -ge $fileLen) {
      $response.StatusCode = 416
      $response.Headers.Add('Content-Range', "bytes */$fileLen")
      $response.ContentLength64 = 0
      $response.OutputStream.Close()
      return
    }
    $length = $end - $start + 1
    $buffer = New-Object byte[] $length
    $fs = [System.IO.File]::OpenRead($full)
    try {
      $null = $fs.Seek($start, [System.IO.SeekOrigin]::Begin)
      $read = 0
      while ($read -lt $length) {
        $n = $fs.Read($buffer, $read, [int]($length - $read))
        if ($n -le 0) { break }
        $read += $n
      }
    } finally {
      $fs.Close()
    }
    $response.StatusCode = 206
    $response.Headers.Add('Content-Range', "bytes $start-$end/$fileLen")
    $response.ContentLength64 = $length
    $response.OutputStream.Write($buffer, 0, $length)
    $response.OutputStream.Close()
    return
  }

  $bytes = [System.IO.File]::ReadAllBytes($full)
  $response.StatusCode = 200
  $response.ContentLength64 = $bytes.Length
  $response.OutputStream.Write($bytes, 0, $bytes.Length)
  $response.OutputStream.Close()
}

# Asegurar archivos de datos
$dir = Split-Path $UsersFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
if (-not (Test-Path $UsersFile)) { Write-Users @() }
if (-not (Test-Path $QuotesFile)) { Write-Quotes @() }
if (-not (Test-Path $TrmFile)) { Write-Trm 3204.0 '' '' | Out-Null }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)
try {
  $listener.Start()
} catch {
  $msg = [string]$_.Exception.Message
  try {
    $log = Join-Path $PSScriptRoot 'servidor_local.log'
    Add-Content -LiteralPath $log -Value ("[{0}] Start failed port {1}: {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Port, $msg) -Encoding UTF8
  } catch {}
  Write-Host "No se pudo iniciar el servidor en $Prefix"
  Write-Host $msg
  Write-Host "Prueba cerrar otro programa en el puerto $Port o ejecutar ABRIR.bat como administrador."
  pause
  exit 1
}

$url = "${Prefix}marcas.html"
Write-Host "IZC local en $url"
Write-Host "Usuarios: $UsersFile"
Write-Host "Ctrl+C para detener."
if (-not $NoBrowser) {
  Start-Process $url | Out-Null
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $path = $req.Url.AbsolutePath
  try {
    if ($path -eq '/api/auth' -or $path -eq '/api/auth.php') {
      Handle-Auth $req $res
    } else {
      Handle-Static $req $res
    }
  } catch {
    try {
      Send-Json $res @{ ok = $false; error = $_.Exception.Message } 500
    } catch {
      try { $res.Abort() } catch {}
    }
  }
}
