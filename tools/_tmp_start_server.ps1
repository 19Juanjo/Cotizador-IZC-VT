$ErrorActionPreference = 'Continue'
$out = 'C:\IZC Server\tools\_start_test.out.txt'
$err = 'C:\IZC Server\tools\_start_test.err.txt'
Remove-Item $out,$err -ErrorAction SilentlyContinue
try {
  Set-Location 'C:\IZC Server\tools'
  & '.\servidor_local.ps1' -Port 8080 -NoBrowser *>&1 |
    ForEach-Object {
      $_ | Out-File -FilePath $out -Append -Encoding utf8
      $_
    }
} catch {
  ($_ | Out-String) | Out-File -FilePath $err -Encoding utf8
  throw
}
