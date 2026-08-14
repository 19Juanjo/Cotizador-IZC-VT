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
$AsesorClientesIndexFile = Join-Path $Root 'data\asesor_clientes_index.json'
$NitTelefonosFile = Join-Path $Root 'data\nit_telefonos.json'
$Prefix = "http://127.0.0.1:$Port/"

function Normalize-AsesorCodigo([string]$codigo) {
  $c = ([string]$codigo).Trim().ToUpperInvariant() -replace '[\s.]', ''
  if ($c -match '^V(\d{1,4})$') {
    return ('V{0}' -f [int]$Matches[1])
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
          if ($id) { [void]$ids.Add([string]$id) }
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
    if ($seen.Add([string]$id)) { [void]$unique.Add([string]$id) }
  }
  return ,$unique
}

function Get-AsesorNitSet([string]$codigo) {
  $set = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($c in (Get-AsesorClientes $codigo)) {
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

function Get-QuoteAsesorEstado($quote) {
  $e = ([string]$quote.asesor_estado).Trim().ToLowerInvariant()
  if ($e -eq 'nueva' -or $e -eq 'nuevo' -or $e -eq 'new') { return 'nueva' }
  if ($e -eq 'seguimiento' -or $e -eq 'follow' -or $e -eq 'followup') { return 'seguimiento' }
  if ($e -eq 'vendido' -or $e -eq 'venta' -or $e -eq 'sold') { return 'vendido' }
  if ($e -eq 'cotizado' -or $e -eq 'cotizada') { return 'cotizado' }
  # Cotizaciones antiguas sin campo: ya viven en el historial como Cotizado.
  return 'cotizado'
}

function Normalize-QuotePipelineEstado([string]$raw) {
  $e = ([string]$raw).Trim().ToLowerInvariant()
  if ($e -eq 'seguimiento' -or $e -eq 'follow' -or $e -eq 'followup') { return 'seguimiento' }
  if ($e -eq 'vendido' -or $e -eq 'venta' -or $e -eq 'sold') { return 'vendido' }
  if ($e -eq 'cotizado' -or $e -eq 'cotizada') { return 'cotizado' }
  return ''
}

function Get-QuotesForAsesor([string]$codigo, [string]$filtro = 'all') {
  $code = Normalize-AsesorCodigo $codigo
  $want = ([string]$filtro).Trim().ToLowerInvariant()
  if ($want -eq 'nuevo' -or $want -eq 'new') { $want = 'nuevas' }
  if ($want -eq 'historial' -or $want -eq 'cotizado' -or $want -eq 'cotizados') { $want = 'historial' }
  if ($want -ne 'nuevas' -and $want -ne 'historial') { $want = 'all' }
  $nitSet = Get-AsesorNitSet $code
  $bitrixIds = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($id in (Get-AsesorBitrixIds $code)) {
    if ($id) { [void]$bitrixIds.Add([string]$id) }
  }
  $safe = New-Object System.Collections.Generic.List[object]
  $countNuevas = 0
  $countHistorial = 0
  foreach ($q in (As-ObjectList (Read-Quotes))) {
    if ($null -eq $q) { continue }
    $sellerCode = Normalize-AsesorCodigo ([string]$q.seller_codigo)
    $assigned = [string]$q.assigned_by_id
    $match = $false
    if ($sellerCode -and $sellerCode -eq $code) { $match = $true }
    elseif ($assigned -and $bitrixIds.Contains($assigned)) { $match = $true }
    elseif (Test-NitInSet ([string]$q.nit) $nitSet) { $match = $true }
    if (-not $match) { continue }
    $estado = Get-QuoteAsesorEstado $q
    if ($estado -eq 'nueva') { $countNuevas++ } else { $countHistorial++ }
    if ($want -eq 'nuevas' -and $estado -ne 'nueva') { continue }
    if ($want -eq 'historial' -and $estado -eq 'nueva') { continue }
    $items = New-Object System.Collections.ArrayList
    if ($null -ne $q.items) {
      foreach ($it in (As-ObjectList $q.items)) {
        if ($null -ne $it) { [void]$items.Add($it) }
      }
    }
    $safe.Add([ordered]@{
      id = [string]$q.id
      nit = [string]$q.nit
      nombre = [string]$q.nombre
      created_at = [string]$q.created_at
      trm = $q.trm
      items = $items
      totals = $(if ($null -ne $q.totals) { $q.totals } else { @{} })
      seller_codigo = $sellerCode
      assigned_by_id = $assigned
      seller_name = [string]$q.seller_name
      asesor_estado = $estado
      asesor_cotizado_at = [string]$q.asesor_cotizado_at
    })
  }
  $sorted = @($safe | Sort-Object { $_.created_at } -Descending)
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($row in $sorted) { if ($null -ne $row) { [void]$out.Add($row) } }
  return ,[ordered]@{
    quotes = $out
    count = $out.Count
    count_nuevas = $countNuevas
    count_historial = $countHistorial
  }
}

function Get-AsesorClientesMerged([string]$codigo) {
  $code = Normalize-AsesorCodigo $codigo
  $byNit = @{}
  foreach ($c in (Get-AsesorClientes $codigo)) {
    $nit = Normalize-Nit ([string]$c.nit)
    if (-not $nit) { continue }
    # Ignore collapsed/corrupt mega-rows from older buggy responses
    if ($nit.Length -gt 40) { continue }
    $telefono = Normalize-TelefonoDisplay ([string]$c.telefono)
    if (-not $telefono) { $telefono = Resolve-ClienteTelefonoFromIndex $nit '' }
    $byNit[$nit] = [ordered]@{
      nit = $nit
      nombre = ([string]$c.nombre).Trim()
      telefono = $telefono
    }
  }
  foreach ($q in (As-ObjectList ((Get-QuotesForAsesor $code 'all').quotes))) {
    $nit = Normalize-Nit ([string]$q.nit)
    if (-not $nit) { continue }
    $nombreQuote = ([string]$q.nombre).Trim()
    $nombre = Resolve-ClienteNombreFromIndex $nit $nombreQuote
    $telefono = Resolve-ClienteTelefonoFromIndex $nit ''
    if (-not $byNit.ContainsKey($nit)) {
      $byNit[$nit] = [ordered]@{
        nit = $nit
        nombre = $(if ($nombre) { $nombre } else { $nit })
        telefono = $telefono
      }
    } else {
      $current = ([string]$byNit[$nit].nombre).Trim()
      if ((-not $current -or $current -eq $nit) -and $nombre -and $nombre -ne $nit) {
        $byNit[$nit].nombre = $nombre
      }
      if (-not ([string]$byNit[$nit].telefono).Trim() -and $telefono) {
        $byNit[$nit].telefono = $telefono
      }
    }
  }
  $out = New-Object System.Collections.Generic.List[object]
  foreach ($row in @($byNit.Values | Sort-Object { $_.nombre })) {
    if ($null -ne $row) { [void]$out.Add($row) }
  }
  return ,$out
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

function Normalize-Nit([string]$nit) {
  return (($nit | ForEach-Object { $_ }) -replace '[\s.]', '').Trim()
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

  return [pscustomobject]@{
    nit = $nit
    nombre = $nombre
    password_hash = $hash
    created_at = $created
  }
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
    $list.Add([ordered]@{
      nit = $nit
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
  $entry = [ordered]@{
    enabled = [bool]$cfg.enabled
    webhook_base = Normalize-BitrixWebhook ([string]$cfg.webhook_base)
    stage_id = ([string]$cfg.stage_id).Trim()
    category_id = ([string]$cfg.category_id).Trim()
    currency_id = $(if ([string]$cfg.currency_id) { ([string]$cfg.currency_id).Trim().ToUpperInvariant() } else { 'COP' })
    marca_field = $marcaField
    company_razon_field = $razonField
    updated_at = (Get-Date).ToString('o')
    updated_by_nit = $adminNit
  }
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
  $form = ConvertTo-BitrixForm $payload
  if ($null -eq $form -or $form.Count -eq 0) {
    $response = Invoke-RestMethod -Method Post -Uri $url -TimeoutSec 25
  } else {
    $response = Invoke-RestMethod -Method Post -Uri $url -Body $form -ContentType 'application/x-www-form-urlencoded; charset=utf-8' -TimeoutSec 25
  }
  if ($null -ne $response.error -and [string]$response.error) {
    $desc = [string]$response.error_description
    if (-not $desc) { $desc = [string]$response.error }
    throw ("Bitrix {0}: {1}" -f [string]$response.error, $desc)
  }
  return $response
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

function Ensure-BitrixCompany([string]$webhookBase, [string]$nit, [string]$nombre) {
  $nit = ([string]$nit).Trim()
  if (-not $nit) { return $null }

  $found = Invoke-BitrixRest $webhookBase 'crm.company.list.json' @{
    filter = @{ TITLE = $nit }
    select = @('ID', 'TITLE')
  }
  $existing = Get-BitrixFirstId $found
  if ($existing) { return $existing }

  # Igual que cotizaciones manuales: Compañía = NIT, tipo Client / IT
  $fields = @{
    TITLE = $nit
    COMPANY_TYPE = 'CUSTOMER'
    INDUSTRY = 'IT'
    OPENED = 'Y'
  }
  if ($nombre) { $fields.COMMENTS = ('Cliente IZC: ' + $nombre) }
  $created = Invoke-BitrixRest $webhookBase 'crm.company.add.json' @{
    fields = $fields
    params = @{ REGISTER_SONET_EVENT = 'N' }
  }
  if ($null -ne $created.result -and [string]$created.result) {
    return [string]$created.result
  }
  throw 'Bitrix no devolvio ID de compania.'
}

function Ensure-BitrixContact([string]$webhookBase, [string]$nombre, $companyId, [string]$nit) {
  $nombre = ([string]$nombre).Trim()
  if (-not $nombre) { return $null }

  # Contacto = nombre del cliente (como PROVEXPRESS en las otras cotizaciones)
  $filter = @{ NAME = $nombre }
  if ($companyId) { $filter.COMPANY_ID = $companyId }
  $found = Invoke-BitrixRest $webhookBase 'crm.contact.list.json' @{
    filter = $filter
    select = @('ID', 'NAME', 'LAST_NAME', 'COMPANY_ID')
  }
  $existing = Get-BitrixFirstId $found
  if ($existing) { return $existing }

  $fields = @{
    NAME = $nombre
    LAST_NAME = ''
    OPENED = 'Y'
    TYPE_ID = 'CLIENT'
  }
  if ($companyId) { $fields.COMPANY_ID = $companyId }
  if ($nit) { $fields.COMMENTS = ('NIT: ' + $nit) }

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
  $n = Normalize-Nit $nit
  $list = New-Object System.Collections.Generic.List[string]
  if ($n) { [void]$list.Add($n) }
  $digits = ($n -replace '[^\d]', '')
  if ($digits -and $list -notcontains $digits) { [void]$list.Add($digits) }
  # Sin ceros a la izquierda (en Bitrix a veces guardan 830121927 vs 0830121927)
  $noZeros = $digits.TrimStart('0')
  if ($noZeros -and $list -notcontains $noZeros) { [void]$list.Add($noZeros) }
  if ($digits -match '^(\d+)-(\d)$') {
    $base = $Matches[1]
    if ($list -notcontains $base) { [void]$list.Add($base) }
  } elseif ($digits.Length -ge 7) {
    # Con DV tipico colombiano si solo vienen digitos
  }
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
  # Si la cotización ya trae vendedor (p.ej. cotizador del asesor), respetarlo.
  $forcedAssigned = $null
  if ($null -ne $quote.assigned_by_id -and [string]$quote.assigned_by_id -ne '') {
    $forcedAssigned = [string]$quote.assigned_by_id
  }
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
      source = 'quote'
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

  $companyId = $null
  $contactId = $null
  try {
    $companyId = Ensure-BitrixCompany $cfg.webhook_base $nit $nombre
    $contactId = Ensure-BitrixContact $cfg.webhook_base $nombre $companyId $nit
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

  $fields = @{
    STAGE_ID = [string]$cfg.stage_id
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

  if ($action -eq 'register') {
    if (-not $nombre -or $nombre.Length -lt 2) {
      Send-Json $response @{ ok = $false; error = 'Ingresa un nombre valido (minimo 2 caracteres).' } 400
      return
    }
    if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido. Usa solo numeros (opcional digito de verificacion).' } 400
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
      password = $password
      created_at = (Get-Date).ToString('o')
    })))
    Write-Users $users.ToArray()
    Send-Json $response @{ ok = $true; nit = $nit; nombre = $nombre; message = 'Registro exitoso.' }
    return
  }

  if ($action -eq 'login') {
    $loginId = Normalize-AsesorCodigo ([string]$body.nit)
    if (-not $loginId) { $loginId = $nit }
    if (-not $loginId -or -not $password) {
      Send-Json $response @{ ok = $false; error = 'Ingresa usuario y contrasena.' } 400
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
    if ($nit -eq '03166122778') { $role = 'admin' }
    Send-Json $response @{ ok = $true; nit = [string]$found.nit; nombre = $foundNombre; role = $role; message = 'Sesion iniciada.' }
    return
  }

  if ($action -eq 'register_asesor') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if ($adminNit -ne '03166122778') {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $codigo = Normalize-AsesorCodigo ([string]$body.codigo)
    if (-not $codigo) { $codigo = Normalize-AsesorCodigo ([string]$body.nit) }
    $asesorPass = [string]$body.password
    $asesorNombre = ([string]$body.nombre).Trim()
    if (-not $codigo) {
      Send-Json $response @{ ok = $false; error = 'Codigo de vendedor invalido. Usa V1, V2, V31, etc.' } 400
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

  if ($action -eq 'list_asesores') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if ($adminNit -ne '03166122778') {
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
    Send-Json $response @{ ok = $true; asesores = @($safe.ToArray()); count = $safe.Count }
    return
  }

  if ($action -eq 'delete_asesor') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if ($adminNit -ne '03166122778') {
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
    $clientesList = Get-AsesorClientesMerged $codigo
    $clientes = New-Object System.Collections.ArrayList
    foreach ($row in (As-ObjectList $clientesList)) {
      if ($null -ne $row) { [void]$clientes.Add($row) }
    }
    Send-Json $response @{
      ok = $true
      codigo = $codigo
      clientes = $clientes
      count = $clientes.Count
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
    $filtro = ([string]$body.filtro).Trim().ToLowerInvariant()
    if (-not $filtro) { $filtro = ([string]$body.estado).Trim().ToLowerInvariant() }
    if (-not $filtro) { $filtro = 'historial' }
    $bundle = Get-QuotesForAsesor $codigo $filtro
    $safe = New-Object System.Collections.ArrayList
    foreach ($row in (As-ObjectList $bundle.quotes)) {
      if ($null -ne $row) { [void]$safe.Add($row) }
    }
    Send-Json $response @{
      ok = $true
      quotes = $safe
      count = $safe.Count
      count_nuevas = [int]$bundle.count_nuevas
      count_historial = [int]$bundle.count_historial
      filtro = $filtro
      role = 'asesor'
      codigo = $codigo
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
      Send-Json $response @{ ok = $false; error = 'Estado inválido. Usa cotizado, seguimiento o vendido.' } 400
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

    $labels = @{ cotizado = 'Cotizado'; seguimiento = 'Seguimiento'; vendido = 'Vendido' }
    $label = $labels[$estado]
    $bundle = Get-QuotesForAsesor $codigo 'all'
    Send-Json $response @{
      ok = $true
      message = 'Estado actualizado a ' + $label + '.'
      quote_id = $quoteId
      asesor_estado = $estado
      count_nuevas = [int]$bundle.count_nuevas
      count_historial = [int]$bundle.count_historial
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

    $quotes = New-Object System.Collections.Generic.List[object]
    $updatedQuote = $null
    $isNew = -not $quoteId

    if ($isNew) {
      # Cotizar desde Mis clientes: crear cotización nueva ya en historial (cotizado).
      $nitSet = Get-AsesorNitSet $codigo
      if (-not (Test-NitInSet $clientNit $nitSet)) {
        Send-Json $response @{ ok = $false; error = 'Ese cliente no está asignado a tu código de vendedor.' } 403
        return
      }
      if (-not $clientNombre) { $clientNombre = $clientNit }
      $quoteId = (Get-Date).ToString('yyyyMMddHHmmssffffff') + '-' + $clientNit
      foreach ($q in (As-ObjectList (Read-Quotes))) {
        if ($null -ne $q) { [void]$quotes.Add($q) }
      }
      $updatedQuote = [ordered]@{
        id = $quoteId
        nit = $clientNit
        nombre = $clientNombre
        created_at = (Get-Date).ToString('o')
        trm = $body.trm
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
      [void]$quotes.Add($updatedQuote)
    } else {
      $owned = Get-QuotesForAsesor $codigo 'all'
      $allowed = $false
      foreach ($row in (As-ObjectList $owned.quotes)) {
        if ([string]$row.id -eq $quoteId) { $allowed = $true; break }
      }
      if (-not $allowed) {
        Send-Json $response @{ ok = $false; error = 'Cotización no encontrada para este asesor.' } 404
        return
      }

      foreach ($q in (As-ObjectList (Read-Quotes))) {
        if ($null -eq $q) { continue }
        if ([string]$q.id -ne $quoteId) {
          [void]$quotes.Add($q)
          continue
        }
        $copy = [ordered]@{}
        foreach ($p in $q.PSObject.Properties) { $copy[$p.Name] = $p.Value }
        if ($clientNit) { $copy['nit'] = $clientNit }
        if ($clientNombre) { $copy['nombre'] = $clientNombre }
        $copy['trm'] = $body.trm
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
        $updatedQuote = $copy
        [void]$quotes.Add($copy)
      }
      if ($null -eq $updatedQuote) {
        Send-Json $response @{ ok = $false; error = 'Cotización no encontrada.' } 404
        return
      }
    }
    Write-Quotes $quotes.ToArray()

    $bitrix = Send-BitrixDeal $updatedQuote
    if ($bitrix.ok) {
      $changed = $false
      if ($bitrix.assigned_by_id) {
        $updatedQuote['assigned_by_id'] = $bitrix.assigned_by_id
        $resolved = Resolve-AsesorCodigoFromBitrixId $bitrix.assigned_by_id
        if ($resolved) { $updatedQuote['seller_codigo'] = $resolved }
        $changed = $true
      }
      if ($bitrix.seller_name) {
        $updatedQuote['seller_name'] = [string]$bitrix.seller_name
        $changed = $true
      }
      if ($changed) {
        $rewritten = New-Object System.Collections.Generic.List[object]
        foreach ($q in $quotes) {
          if ([string]$q.id -eq $quoteId) { [void]$rewritten.Add($updatedQuote) }
          else { [void]$rewritten.Add($q) }
        }
        Write-Quotes $rewritten.ToArray()
      }
    }

    $message = 'Cotización terminada y movida al historial.'
    if ($bitrix.ok) {
      $message = 'Cotización terminada, enviada a Bitrix (negocio #' + $bitrix.deal_id + ') y marcada como Cotizado.'
      if ($bitrix.seller_name) { $message = $message + ' Responsable: ' + [string]$bitrix.seller_name + '.' }
    } elseif (-not $bitrix.skipped) {
      $message = 'Cotización marcada como Cotizado, pero Bitrix falló: ' + [string]$bitrix.error
    }

    $bundle = Get-QuotesForAsesor $codigo 'all'
    Send-Json $response @{
      ok = $true
      message = $message
      quote_id = $quoteId
      bitrix = $bitrix
      count_nuevas = [int]$bundle.count_nuevas
      count_historial = [int]$bundle.count_historial
    }
    return
  }

  if ($action -eq 'list') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if ($adminNit -ne '03166122778') {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $safe = @()
    foreach ($u in (Read-Users)) {
      $safe += [ordered]@{
        nit = [string]$u.nit
        nombre = ([string]$u.nombre).Trim()
        created_at = [string]$u.created_at
      }
    }
    Send-Json $response @{ ok = $true; users = $safe; count = $safe.Count }
    return
  }

  if ($action -eq 'delete') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if ($adminNit -ne '03166122778') {
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
    $users = New-Object System.Collections.Generic.List[object]
    $removed = $false
    foreach ($u in (Read-Users)) {
      if ((Normalize-Nit ([string]$u.nit)) -eq $nit) {
        $removed = $true
        continue
      }
      $users.Add($u)
    }
    if (-not $removed) {
      Send-Json $response @{ ok = $false; error = 'Usuario no encontrado.' } 404
      return
    }
    Write-Users $users.ToArray()
    Send-Json $response @{ ok = $true; message = 'Usuario eliminado.'; nit = $nit }
    return
  }

  if ($action -eq 'upsert') {
    $adminNit = Normalize-Nit ([string]$body.admin_nit)
    if ($adminNit -ne '03166122778') {
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
    if (-not $nit -or $nit -notmatch '^\d{6,15}(-\d)?$') {
      Send-Json $response @{ ok = $false; error = 'NIT invalido.' } 400
      return
    }
    $users = Read-Users
    $found = $null
    foreach ($u in $users) {
      if ((Normalize-Nit ([string]$u.nit)) -eq $nit) {
        $found = $u
        break
      }
    }
    if (-not $found) {
      Send-Json $response @{ ok = $false; error = 'Usuario no registrado.' } 403
      return
    }
    if (-not $nombre) { $nombre = ([string]$found.nombre).Trim() }
    $items = @()
    if ($null -ne $body.items) { $items = @($body.items) }
    if ($items.Count -eq 0) {
      Send-Json $response @{ ok = $false; error = 'La cotizacion no tiene productos.' } 400
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

    $quote = [ordered]@{
      id = $quoteId
      nit = $nit
      nombre = $nombre
      created_at = (Get-Date).ToString('o')
      trm = $body.trm
      items = $items
      totals = $(if ($null -ne $body.totals) { $body.totals } else { @{} })
      seller_codigo = $sellerCodigo
      assigned_by_id = $sellerAssigned
      seller_name = $sellerName
      asesor_estado = 'nueva'
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
      if ($changed) {
        $quotes[$quotes.Count - 1] = $quote
        Write-Quotes $quotes.ToArray()
      }
    }
    $message = 'Cotizacion guardada.'
    if ($bitrix.ok) {
      $message = 'Cotizacion guardada y enviada a Bitrix (negocio #' + $bitrix.deal_id + ').'
      if ($bitrix.seller_name) {
        $message = $message + ' Responsable: ' + [string]$bitrix.seller_name + '.'
      }
      if ($bitrix.seller_missing -and $bitrix.seller_warning) {
        $message = $message + ' Aviso: ' + [string]$bitrix.seller_warning
      }
      if ($bitrix.PSObject.Properties.Name -contains 'products_ok' -and $bitrix.products_ok -eq $false -and $bitrix.error) {
        $message = $message + ' Productos/MARCA: ' + [string]$bitrix.error
      }
    } elseif (-not $bitrix.skipped) {
      $message = 'Cotizacion guardada, pero Bitrix fallo: ' + [string]$bitrix.error
    }

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
    if ($adminNit -ne '03166122778') {
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
    if ($adminNit -ne '03166122778') {
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
    if ($adminNit -ne '03166122778') {
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
    if ($adminNit -ne '03166122778') {
      Send-Json $response @{ ok = $false; error = 'No autorizado.' } 403
      return
    }
    $safe = @()
    $sorted = @(Read-Quotes) | Sort-Object { [string]$_.created_at } -Descending
    foreach ($q in $sorted) {
      if ($null -eq $q) { continue }
      $seller = Resolve-QuoteSellerLabel $q
      $safe += [ordered]@{
        id = [string]$q.id
        nit = [string]$q.nit
        nombre = [string]$q.nombre
        created_at = [string]$q.created_at
        trm = $q.trm
        items = $(if ($null -ne $q.items) { @($q.items) } else { @() })
        totals = $(if ($null -ne $q.totals) { $q.totals } else { @{} })
        seller_codigo = [string]$seller.seller_codigo
        assigned_by_id = [string]$seller.assigned_by_id
        seller_name = [string]$seller.seller_name
        seller_label = [string]$seller.seller_label
        asesor_estado = (Get-QuoteAsesorEstado $q)
      }
    }
    Send-Json $response @{ ok = $true; quotes = $safe; count = $safe.Count }
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
    if ($adminNit -ne '03166122778') {
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
  $bytes = [System.IO.File]::ReadAllBytes($full)
  $response.StatusCode = 200
  $response.ContentType = Get-Mime $full
  $response.Headers.Add('Cache-Control', 'no-store')
  $response.Headers.Add('Access-Control-Allow-Origin', '*')
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
  Write-Host "No se pudo iniciar el servidor en $Prefix"
  Write-Host $_.Exception.Message
  Write-Host "Prueba cerrar otro programa en el puerto $Port o ejecutar como administrador una vez."
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
