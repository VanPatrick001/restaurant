# BAB AL FKAMAH - autorise les telephones du Wi-Fi a se connecter (port 3000)
Write-Host ""
Write-Host "=== Ouverture de l'acces reseau pour BAB AL FKAMAH ===" -ForegroundColor Cyan

# 1. Supprimer les regles qui BLOQUENT Node.js (creees quand la fenetre du pare-feu a ete refusee)
$bloquees = Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
  Where-Object { $_.Program -like '*node.exe' } | Get-NetFirewallRule |
  Where-Object { $_.Action -eq 'Block' -and $_.Direction -eq 'Inbound' }
if ($bloquees) { $bloquees | Remove-NetFirewallRule; Write-Host "[OK] Regles de blocage Node.js supprimees : $($bloquees.Count)" -ForegroundColor Green }
else { Write-Host "[OK] Aucune regle de blocage Node.js" -ForegroundColor Green }

# 2. Autoriser le port 3000 (et 3443 pour HTTPS) sur tous les types de reseau
Remove-NetFirewallRule -DisplayName 'BAB AL FKAMAH' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'BAB AL FKAMAH' -Direction Inbound -Protocol TCP -LocalPort 3000,3443 -Action Allow -Profile Any | Out-Null
Write-Host "[OK] Port 3000 autorise dans le pare-feu Windows" -ForegroundColor Green

# 3. Passer le Wi-Fi / Ethernet reel en reseau Prive (pas les cartes virtuelles)
Get-NetConnectionProfile | Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback' } | ForEach-Object {
  try { Set-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex -NetworkCategory Private -ErrorAction Stop
        Write-Host "[OK] Reseau '$($_.Name)' ($($_.InterfaceAlias)) passe en Prive" -ForegroundColor Green }
  catch { Write-Host "[!] Impossible de modifier '$($_.Name)' : $($_.Exception.Message)" -ForegroundColor Yellow }
}

# 4. Afficher la bonne adresse a saisir sur le telephone
Write-Host ""
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
  $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and
  $_.InterfaceAlias -notmatch 'vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback' }
foreach ($ip in $ips) { Write-Host ("Sur le telephone, ouvrez :  http://{0}:3000   ({1})" -f $ip.IPAddress, $ip.InterfaceAlias) -ForegroundColor Yellow }
Write-Host ""
Write-Host "Termine. Relancez le serveur (node server/index.js) puis testez sur le telephone." -ForegroundColor Cyan
