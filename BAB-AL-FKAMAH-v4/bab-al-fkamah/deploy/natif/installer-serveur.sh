#!/usr/bin/env bash
# Préparation UNIQUE d'un serveur Ubuntu (AWS EC2) pour BAB AL FKAMAH SANS Docker :
# Node.js 22, MariaDB, Caddy (HTTPS automatique) et un service systemd.
# Lancé automatiquement par deployer.sh au premier déploiement.
# Usage : sudo bash installer-serveur.sh <IP_PUBLIQUE>
set -euo pipefail
IP="${1:?Adresse IP publique du serveur manquante}"
UTIL="${SUDO_USER:-ubuntu}"
APP="/home/$UTIL/bab-al-fkamah/app"
SITE="${IP//./-}.sslip.io"
gen() { tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1"; }

echo "==> Fuseau horaire Asia/Dubai"
timedatectl set-timezone Asia/Dubai || true

echo "==> Mémoire d'échange (swap 2 Go)"
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> Node.js 22"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

echo "==> MariaDB (base de données)"
DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server
systemctl enable --now mariadb

echo "==> Caddy (serveur web + HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<CADDY
# BAB AL FKAMAH — HTTPS automatique (Let's Encrypt)
$SITE {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy && systemctl reload caddy || systemctl restart caddy

echo "==> Configuration secrète (.env) et compte MySQL"
mkdir -p "$APP"
if [ ! -f "$APP/.env" ]; then
  DBPASS=$(gen 24)
  mysql -e "CREATE USER IF NOT EXISTS 'resto'@'localhost' IDENTIFIED BY '$DBPASS';
            GRANT ALL PRIVILEGES ON bab_al_fkamah.* TO 'resto'@'localhost'; FLUSH PRIVILEGES;"
  cat > "$APP/.env" <<ENV
# Généré automatiquement le $(date) — NE PAS PARTAGER
PORT=3000
PORT_WEB=0
DB_HOST=localhost
DB_PORT=3306
DB_USER=resto
DB_PASSWORD=$DBPASS
DB_NAME=bab_al_fkamah
JWT_SECRET=$(gen 48)
ENV
  chmod 600 "$APP/.env"
fi

echo "==> Service systemd (démarrage automatique + relance en cas de panne)"
cat > /etc/systemd/system/bab-al-fkamah.service <<UNIT
[Unit]
Description=BAB AL FKAMAH - gestion de restaurant
After=network.target mariadb.service
Wants=mariadb.service

[Service]
User=$UTIL
WorkingDirectory=$APP
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=TZ=Asia/Dubai

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable bab-al-fkamah
chown -R "$UTIL:$UTIL" "/home/$UTIL/bab-al-fkamah"
echo "==> Serveur prêt : https://$SITE"
