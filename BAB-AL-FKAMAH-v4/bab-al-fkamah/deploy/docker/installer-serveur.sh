#!/usr/bin/env bash
# Préparation UNIQUE d'un serveur Ubuntu (AWS EC2) pour BAB AL FKAMAH avec Docker.
# Lancé automatiquement par deployer.sh si Docker n'est pas encore installé.
# Usage : sudo bash installer-serveur.sh <IP_PUBLIQUE>
set -euo pipefail
IP="${1:?Adresse IP publique du serveur manquante}"
UTIL="${SUDO_USER:-ubuntu}"
DOSSIER="/home/$UTIL/bab-al-fkamah"

echo "==> Fuseau horaire Asia/Dubai"
timedatectl set-timezone Asia/Dubai || true

echo "==> Mémoire d'échange (swap 2 Go, utile sur les petits serveurs)"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Installation de Docker"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 curl
systemctl enable --now docker
usermod -aG docker "$UTIL" || true

echo "==> Fichier de configuration secret (.env)"
mkdir -p "$DOSSIER/database"
if [ ! -f "$DOSSIER/.env" ]; then
  gen() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }
  cat > "$DOSSIER/.env" <<ENV
# Généré automatiquement le $(date) — NE PAS PARTAGER
DB_ROOT_PASSWORD=$(gen 24)
DB_PASSWORD=$(gen 24)
JWT_SECRET=$(gen 48)
SITE_ADRESSE=${IP//./-}.sslip.io
IMAGE=
ENV
  chmod 600 "$DOSSIER/.env"
fi
chown -R "$UTIL:$UTIL" "$DOSSIER"
echo "==> Serveur prêt."
