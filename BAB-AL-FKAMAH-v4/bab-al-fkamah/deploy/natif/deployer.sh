#!/usr/bin/env bash
# Déploiement SANS Docker — exécuté SUR le serveur par GitHub Actions après l'envoi du code.
# Usage : bash deployer.sh <IP_PUBLIQUE>
set -euo pipefail
IP="$1"
APP="$HOME/bab-al-fkamah/app"
cd "$APP"

# 1. Première fois : installer Node.js, MariaDB, Caddy, le service…
if [ ! -f /etc/systemd/system/bab-al-fkamah.service ] || [ ! -f .env ]; then
  sudo bash deploy/natif/installer-serveur.sh "$IP"
fi

# 2. Dépendances de production
npm ci --omit=dev --no-audit --no-fund

# 3. Base vide (tout premier déploiement) → schéma + données de départ. Jamais ensuite.
NB=$(sudo mysql -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='bab_al_fkamah'")
if [ "$NB" = "0" ]; then
  echo "==> Initialisation de la base de données"
  sudo mysql < database/schema.sql
  sudo mysql < database/seed.sql
fi
mkdir -p uploads/plats uploads/profils uploads/logo

# 4. Redémarrer l'application et vérifier qu'elle répond
sudo systemctl restart bab-al-fkamah
for i in $(seq 1 30); do
  if curl -fs http://127.0.0.1:3000/api/sante | grep -q '"ok":true'; then
    echo "✅ Application en ligne : https://${IP//./-}.sslip.io"; exit 0
  fi
  sleep 2
done
echo "❌ L'application ne répond pas. Derniers journaux :"
sudo journalctl -u bab-al-fkamah -n 50 --no-pager
exit 1
