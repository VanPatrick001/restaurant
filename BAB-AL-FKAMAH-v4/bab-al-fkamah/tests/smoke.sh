#!/usr/bin/env bash
# Tests de fumée : vérifient que l'application démarre et que les fonctions clés répondent.
# Usage : bash tests/smoke.sh [URL]   (par défaut http://127.0.0.1:3000)
set -uo pipefail
URL="${1:-http://127.0.0.1:3000}"
ECHECS=0
ok()   { echo "  ✅ $1"; }
ko()   { echo "  ❌ $1"; ECHECS=$((ECHECS+1)); }
json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const o=JSON.parse(d);console.log(eval('o'+process.argv[1]))}catch(e){console.log('')}})" "$1"; }

echo "Tests de fumée sur $URL"
# 1. Attendre que le serveur réponde (30 s max)
for i in $(seq 1 30); do curl -fs "$URL/api/sante" >/dev/null && break; sleep 1; done

# 2. Santé + base de données
[ "$(curl -s "$URL/api/sante" | json .db)" = "ok" ] && ok "Serveur et base de données" || ko "Serveur ou base de données indisponible"

# 3. Page d'accueil
curl -fs "$URL/" | grep -qi "<html" && ok "Page d'accueil servie" || ko "Page d'accueil absente"

# 4. Mauvais mot de passe refusé
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{"username":"admin","password":"faux"}' "$URL/api/auth/login")
[ "$CODE" = "401" ] && ok "Mauvais mot de passe refusé (401)" || ko "Mauvais mot de passe : code $CODE au lieu de 401"

# 5. Connexion admin
TOKEN=$(curl -s -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' "$URL/api/auth/login" | json .token)
[ -n "$TOKEN" ] && ok "Connexion admin" || ko "Connexion admin impossible"
AUTH="Authorization: Bearer $TOKEN"

# 6. Menu (50 plats par défaut)
NB=$(curl -s -H "$AUTH" "$URL/api/menu" | json .plats.length)
[ "${NB:-0}" -ge 1 ] && ok "Menu : $NB plats" || ko "Menu vide ou inaccessible"

# 7. Plan de salle (VIP1..VIP5, FZ…, SA…)
NB=$(curl -s -H "$AUTH" "$URL/api/salle" | json '.reduce((n,z)=>n+z.emplacements.length,0)')
[ "${NB:-0}" -ge 1 ] && ok "Plan de salle : $NB emplacements" || ko "Plan de salle inaccessible"

# 8. Accès refusé sans connexion
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/menu")
[ "$CODE" = "401" ] && ok "API protégée sans connexion (401)" || ko "API non protégée : code $CODE"

echo
if [ "$ECHECS" -eq 0 ]; then echo "Tous les tests sont passés."; else echo "$ECHECS test(s) en échec."; exit 1; fi
