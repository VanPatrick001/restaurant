# BAB AL FKAMAH — CI/CD et déploiement sur AWS

## Vue d'ensemble

```
git push ──▶ GitHub ──▶ CI (tests) ──✅──▶ CD ──▶ Serveur AWS EC2 ──▶ https://xx-xx-xx-xx.sslip.io
                                        │
                     DEPLOY_MODE=docker ├─▶ image Docker → ghcr.io → docker compose (MariaDB + app + Caddy)
                     DEPLOY_MODE=natif  └─▶ rsync du code → npm ci → systemd (Node + MariaDB + Caddy)
```

| Fichier | Rôle |
|---|---|
| `.github/workflows/ci.yml` | **CI** : à chaque push, installe, vérifie la syntaxe, crée une base de test, démarre l'app, lance `tests/smoke.sh` |
| `.github/workflows/deploy-docker.yml` | **CD Docker** : construit l'image, l'envoie sur ghcr.io, la lance sur EC2 |
| `.github/workflows/deploy-natif.yml` | **CD sans Docker** : copie le code sur EC2, `npm ci`, redémarre le service |
| `tests/smoke.sh` | Tests de fumée (santé, connexion, menu, salle, sécurité) |
| `deploy/docker/*` | Compose de production, installation unique et script de déploiement du serveur Docker |
| `deploy/natif/*` | Installation unique (Node 22, MariaDB, Caddy, systemd) et script de déploiement sans Docker |
| `deploy/Caddyfile` | HTTPS automatique (Let's Encrypt) pour l'adresse gratuite sslip.io |

## Réglages GitHub (Settings du dépôt)

**Secrets** (Settings → Secrets and variables → Actions → *Secrets*) :
- `EC2_HOST` : adresse IP publique (Elastic IP) du serveur, ex. `3.120.45.67`
- `EC2_USER` : `ubuntu`
- `EC2_SSH_KEY` : contenu complet du fichier `.pem` téléchargé à la création du serveur

**Variable** (onglet *Variables*) :
- `DEPLOY_MODE` : `docker` **ou** `natif` (un seul mode par serveur ; vide = pas de déploiement)

## Réglages AWS

- Instance **Ubuntu 24.04**, architecture **x86_64**, au moins 1 Go de RAM (t3.micro / t3.small)
- Groupe de sécurité : ports **22** (SSH), **80** et **443** ouverts ; **ne pas** ouvrir 3000 ni 3306
- **Elastic IP** associée à l'instance (l'adresse ne change plus au redémarrage)

## Adresse de l'application

Sans nom de domaine : `https://<IP avec des tirets>.sslip.io`, ex. `https://3-120-45-67.sslip.io`.
sslip.io est un service gratuit qui renvoie l'IP contenue dans le nom ; Caddy obtient le certificat HTTPS tout seul.

## Bon à savoir

- La base est créée avec les données de démonstration **au premier déploiement uniquement**, ensuite elle n'est
  plus jamais touchée. **Changez immédiatement les mots de passe des comptes de démonstration.**
- Les secrets du serveur (mots de passe MySQL, JWT) sont générés sur le serveur, dans `~/bab-al-fkamah/.env`
  (Docker) ou `~/bab-al-fkamah/app/.env` (sans Docker). Ils ne passent jamais par GitHub.
- Journaux : `sudo docker compose -f ~/bab-al-fkamah/docker-compose.prod.yml logs -f app` (Docker)
  ou `sudo journalctl -u bab-al-fkamah -f` (sans Docker).
