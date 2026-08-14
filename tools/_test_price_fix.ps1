# Prueba de formato/parseo de precios (script de diagnostico).
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { ([string]$_.CommandLine) -like '*servidor_local.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
& "C:\IZC\tools\servidor_control.ps1" -Action restart | Out-Null
Start-Sleep -Seconds 3

# Show how PRICE is encoded
$unit = 1145.04
$priceStr = ([double]$unit).ToString('0.00', [System.Globalization.CultureInfo]::InvariantCulture)
Write-Output ('priceStr=' + $priceStr)

$bodyObj = @{
  action = 'save_quote'
  nit = '03166122778'
  nombre = 'Oscar'
  trm = 3300
  items = @(
    @{
      sku = '4031'
      name = 'SCANER BALANZA IMAGER DATALOGIC MAGELLAN 9300I'
      qty = 1
      currency = 'USD'
      usd = 962.22
      usdIva = 1145.04
      cop = 3175333
      copIva = 3778646
      totalUsd = 962.22
      totalUsdIva = 1145.04
      totalCop = 3175333
      totalCopIva = 3778646
    }
  )
  totals = @{ qty = 1; usd = 962.22; usdIva = 1145.04; cop = 3175333; copIva = 3778646; hasUsd = $true; hasCop = $false }
}
$res = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/auth' -ContentType 'application/json; charset=utf-8' -Body ($bodyObj | ConvertTo-Json -Depth 6 -Compress) -TimeoutSec 90
Write-Output ('deal_id=' + $res.bitrix.deal_id + ' marca=' + $res.bitrix.marca_id + ' products_ok=' + $res.bitrix.products_ok + ' err=' + $res.bitrix.error)
if ($res.bitrix.deal_id) {
  $cfg = Get-Content 'C:\IZC\data\bitrix.json' -Raw | ConvertFrom-Json
  $base = ([string]$cfg.webhook_base).TrimEnd('/') + '/'
  $pr = Invoke-RestMethod -Method Post -Uri ($base + 'crm.deal.productrows.get.json') -Body @{ id = [string]$res.bitrix.deal_id } -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 20
  foreach ($row in @($pr.result)) {
    Write-Output ('product=' + $row.PRODUCT_NAME + ' price=' + $row.PRICE + ' qty=' + $row.QUANTITY)
  }
  Write-Output ('UF_MARCA=' + (Invoke-RestMethod -Method Post -Uri ($base + 'crm.deal.get.json') -Body @{ id = [string]$res.bitrix.deal_id } -ContentType 'application/x-www-form-urlencoded').result.UF_CRM_1749499637)
}
