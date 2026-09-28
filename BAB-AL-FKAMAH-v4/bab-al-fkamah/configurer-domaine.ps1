# BAB AL FKAMAH - prepare ce PC a servir http://rest.babfkamah.com sur le Wi-Fi
$ErrorActionPreference = 'SilentlyContinue'
$dossier = Split-Path -Parent $MyInvocation.MyCommand.Path
$domaine = 'rest.babfkamah.com'
$envFile = Join-Path $dossier '.env'
if (Test-Path $envFile) {
  $l = Select-String -Path $envFile -Pattern '^\s*DNS_DOMAINE\s*=\s*(.+)$' | Select-Object -First 1
  if ($l) { $domaine = $l.Matches[0].Groups[1].Value.Trim() }
}
Write-Host ""
Write-Host "=== Configuration du nom de domaine $domaine ===" -ForegroundColor Cyan

# 1. Pare-feu : DNS (53), site web (80) et application (3000)
Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like '*node.exe' } | Get-NetFirewallRule |
  Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' } | Remove-NetFirewallRule
Remove-NetFirewallRule -DisplayName 'BAB AL FKAMAH'
Remove-NetFirewallRule -DisplayName 'BAB AL FKAMAH DNS (UDP)'
Remove-NetFirewallRule -DisplayName 'BAB AL FKAMAH DNS (TCP)'
New-NetFirewallRule -DisplayName 'BAB AL FKAMAH' -Direction Inbound -Protocol TCP -LocalPort 80,3000,3443 -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'BAB AL FKAMAH DNS (UDP)' -Direction Inbound -Protocol UDP -LocalPort 53 -Action Allow -Profile Any | Out-Null
New-NetFirewallRule -DisplayName 'BAB AL FKAMAH DNS (TCP)' -Direction Inbound -Protocol TCP -LocalPort 53 -Action Allow -Profile Any | Out-Null
Write-Host "[OK] Pare-feu : ports 53 (DNS), 80 et 3000 autorises" -ForegroundColor Green

# 2. Wi-Fi / Ethernet en reseau Prive
Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback' } |
  ForEach-Object { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private }
Write-Host "[OK] Reseau Wi-Fi en mode Prive" -ForegroundColor Green

# 3. Ce PC lui-meme reconnait le nom de domaine (fichier hosts)
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
if (-not (Select-String -Path $hosts -Pattern ([regex]::Escape($domaine)) -Quiet)) {
  Add-Content -Path $hosts -Value "`r`n127.0.0.1`t$domaine`t# BAB AL FKAMAH" -Encoding ASCII
  Write-Host "[OK] $domaine ajoute au fichier hosts de ce PC" -ForegroundColor Green
} else { Write-Host "[OK] $domaine deja present dans le fichier hosts" -ForegroundColor Green }
ipconfig /flushdns | Out-Null

# 4. Adresse IP a declarer comme DNS dans la box
$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
  $_.InterfaceAlias -notmatch 'vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback' } | Select-Object -First 1
Write-Host ""
if ($ip) {
  Write-Host ("  Adresse de ce PC sur le Wi-Fi : {0}  ({1})" -f $ip.IPAddress, $ip.InterfaceAlias) -ForegroundColor Yellow
  Write-Host ("  -> Dans la box : DNS principal = {0}  (voir le guide, section Nom de domaine)" -f $ip.IPAddress) -ForegroundColor Yellow
}
Write-Host ("  -> Sur les telephones : http://{0}" -f $domaine) -ForegroundColor Yellow
Write-Host ""
