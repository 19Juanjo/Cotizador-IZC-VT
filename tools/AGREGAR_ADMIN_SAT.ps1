# Agrega/actualiza Admin SAT en data\usuarios.json SIN borrar clientes.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$path = Join-Path $Root 'data\usuarios.json'
if (-not (Test-Path -LiteralPath $path)) { throw "No existe $path" }

$raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
$users = @()
if ($raw -and $raw.Trim()) {
  $parsed = $raw | ConvertFrom-Json
  if ($parsed -is [System.Array]) { $users = @($parsed) } else { $users = @($parsed) }
}

# Hash verificado para contraseña: *Adm1m$AT.
$hash = 'pbkdf2$' + '100000$' + 'aq2JTweq0oOWeTmPNHlKyA==$' + 'dOX/HWA1cMhzrCrUyE03xWlPrkIM0SbQ2QkdmgwnMc4='
$found = $false
for ($i = 0; $i -lt $users.Count; $i++) {
  $key = ([string]$users[$i].nit -replace '[\s.]', '').ToUpperInvariant()
  if ($key -eq 'SAT' -or $key -eq 'ADMINSAT') {
    $users[$i] | Add-Member -NotePropertyName nit -NotePropertyValue 'SAT' -Force
    $users[$i] | Add-Member -NotePropertyName nombre -NotePropertyValue 'Admin SAT' -Force
    $users[$i] | Add-Member -NotePropertyName password_hash -NotePropertyValue $hash -Force
    $users[$i] | Add-Member -NotePropertyName role -NotePropertyValue 'sat' -Force
    if (-not $users[$i].PSObject.Properties['created_at'] -or -not $users[$i].created_at) {
      $users[$i] | Add-Member -NotePropertyName created_at -NotePropertyValue ((Get-Date).ToString('o')) -Force
    }
    $found = $true
    break
  }
}
if (-not $found) {
  $users += [pscustomobject]@{
    nit = 'SAT'
    nombre = 'Admin SAT'
    password_hash = $hash
    role = 'sat'
    created_at = (Get-Date).ToString('o')
  }
}

$bak = $path + '.bak-' + (Get-Date -Format 'yyyyMMdd_HHmmss')
Copy-Item -LiteralPath $path -Destination $bak -Force
$json = $users | ConvertTo-Json -Depth 8
if (-not $json.Trim().StartsWith('[')) { $json = "[$json]" }
[System.IO.File]::WriteAllText($path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Write-Host ("OK. Usuarios totales: {0}" -f $users.Count)
Write-Host ("Backup: {0}" -f $bak)
Write-Host 'Admin SAT listo. Usuario: Admin SAT (o SAT). Clave: *Adm1m$AT.'
