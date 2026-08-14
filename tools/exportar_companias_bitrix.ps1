# Exporta Companias de Bitrix a data/bitrix_companias.json
# Usa el webhook de data/bitrix.json
# En Bitrix REST la consulta va por POST (crm.company.fields + crm.company.list)


$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$BitrixFile = Join-Path $Root 'data\bitrix.json'
$OutFile = Join-Path $Root 'data\bitrix_companias.json'

$cfg = Get-Content $BitrixFile -Raw -Encoding UTF8 | ConvertFrom-Json
$base = ([string]$cfg.webhook_base).TrimEnd('/') + '/'
if (-not $base -or $base -eq '/') { throw 'Falta webhook_base en data/bitrix.json' }

Write-Host "Webhook OK. Exportando companias..."

# 1) Campos - estructura de Companias
$fieldsResp = Invoke-RestMethod -Method Post -Uri ($base + 'crm.company.fields.json') -TimeoutSec 60
$fields = $fieldsResp.result

# 2) Listar companias
$all = New-Object System.Collections.Generic.List[object]
$start = 0
do {
  $form = @{
    'start' = "$start"
    'order[ID]' = 'ASC'
  }
  $i = 0
  foreach ($name in @(
      'ID','TITLE','ASSIGNED_BY_ID','COMPANY_TYPE','INDUSTRY','EMPLOYEES','REVENUE','CURRENCY_ID',
      'OPENED','DATE_CREATE','DATE_MODIFY','CREATED_BY_ID','MODIFY_BY_ID','COMMENTS',
      'PHONE','EMAIL','WEB','IM','ADDRESS','REG_ADDRESS','BANKING_DETAILS','LOGO',
      'IS_MY_COMPANY','LEAD_ID','ORIGINATOR_ID','ORIGIN_ID','ORIGIN_VERSION',
      'UTM_SOURCE','UTM_MEDIUM','UTM_CAMPAIGN','UTM_CONTENT','UTM_TERM'
    )) {
    $form["select[$i]"] = $name
    $i++
  }
  foreach ($p in $fields.PSObject.Properties) {
    if ($p.Name -like 'UF_*') {
      $form["select[$i]"] = $p.Name
      $i++
    }
  }

  $page = Invoke-RestMethod -Method Post -Uri ($base + 'crm.company.list.json') `
    -Body $form -ContentType 'application/x-www-form-urlencoded; charset=utf-8' -TimeoutSec 90

  foreach ($row in @($page.result)) {
    if ($null -ne $row) { $all.Add($row) }
  }

  if ($null -ne $page.next) { $start = [int]$page.next } else { $start = -1 }
  Write-Host "fetched=$($all.Count) next=$start"
} while ($start -ge 0)

# 3) Armar arrays: fields + companies
$fieldArray = @()
foreach ($p in $fields.PSObject.Properties) {
  $fieldArray += [ordered]@{
    name = $p.Name
    title = $p.Value.title
    type = $p.Value.type
    isRequired = $p.Value.isRequired
    isReadOnly = $p.Value.isReadOnly
    isMultiple = $p.Value.isMultiple
    isDynamic = $p.Value.isDynamic
  }
}

$payload = [ordered]@{
  exported_at = (Get-Date).ToString('o')
  source = 'crm.company.list + crm.company.fields'
  portal = 'vis.bitrix24.com'
  total_companies = $all.Count
  fields = $fieldArray
  companies = $all
}

$json = $payload | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($OutFile, $json, [System.Text.UTF8Encoding]::new($false))
Write-Host "OK -> $OutFile"
Write-Host "companies=$($all.Count) fields=$($fieldArray.Count)"
