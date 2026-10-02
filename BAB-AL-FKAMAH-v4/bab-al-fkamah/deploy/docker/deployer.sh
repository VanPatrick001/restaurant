#!/usr/bin/env bash
# Déploiement Docker — exécuté SUR le serveur par GitHub Actions à chaque mise à jour.
# Usage : bash deployer.sh <IMAGE> <IP_PUBLIQUE> <UTILISATEUR_GHCR> <JETON_GHCR>
set -euo pipefail
IMAGE="$1"; IP="$2"; GH_USER="$3"; GH_TOKEN="$4"
cd "$(dirname "$0")"

# 1. Première fois : installer Docker et créer le .env
if ! command -v docker >/dev/null || [ ! -f .env ]; then
  sudo bash ./installer-serveur.sh "$IP"
fi

# 2. Indiquer la nouvelle image à utiliser
sed -i '/^IMAGE=/d' .env && echo "IMAGE=$IMAGE" >> .env

# 3. Télécharger la nouvelle image (registre privé GitHub) et relancer
echo "$GH_TOKEN" | sudo docker login ghcr.io -u "$GH_USER" --password-stdin
sudo docker compose -f docker-compose.prod.yml pull app
sudo docker compose -f docker-compose.prod.yml up -d --remove-orphans
sudo docker logout ghcr.io >/dev/null
sudo docker image prune -f >/dev/null

# 4. Vérifier que l'application répond (2 min max : la base peut s'initialiser au 1er lancement)
for i in $(seq 1 60); do
  if sudo docker compose -f docker-compose.prod.yml exec -T app wget -qO- http://127.0.0.1:3000/api/sante 2>/dev/null | grep -q '"ok":true'; then
    echo "✅ Application en ligne : https://$(grep ^SITE_ADRESSE= .env | cut -d= -f2)"
    exit 0
  fi
  sleep 2
done
echo "❌ L'application ne répond pas. Derniers journaux :"
sudo docker compose -f docker-compose.prod.yml logs --tail=50 app
exit 1
