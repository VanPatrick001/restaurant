# BAB AL FKAMAH — Gestion de restaurant (v4)

Application complète de gestion de restaurant : **serveur sur un PC du restaurant + base MySQL**,
utilisable depuis **l'application PC Windows**, **l'application Android (APK)** ou n'importe quel navigateur.
Interface en **3 langues (Français, English, العربية)**, modifiable à tout moment, monnaie **AED**,
paiements **Cash** et **Visa** uniquement.

| Rôle | Ce qu'il voit |
|---|---|
| **Admin** | Tout ; seul à créer les comptes ; nom et logo du restaurant, durées de conservation |
| **Patron (manager)** | Tableau de bord, tous les droits des serveurs sur toutes les commandes, factures réglées, Deleted bills, droits des utilisateurs et groupes |
| **Caissier** | Caisse : encaissement Cash/Visa, modification des factures non réglées, suppression, attribution / retrait des livreurs |
| **Serveur** | Plan de salle, prise de commande, emporter, livraison, validation (+ impression) |
| **Cuisinier** | Écran cuisine (3 commandes côte à côte, paysage), récapitulatif, construction du menu |
| **Livreur** *(nouveau)* | Commandes à livrer, acceptation, WhatsApp client, itinéraire, « Livrée » |

---

## 1. Contenu du dossier

```
bab-al-fkamah/
├── dist/
│   ├── BAB-AL-FKAMAH.apk                 ← application Android (Android 7 → 15)
│   └── BAB-AL-FKAMAH-PC-Windows.zip      ← application PC Windows (à décompresser)
├── database/
│   ├── schema.sql                        ← structure MySQL (⚠️ recrée la base bab_al_fkamah)
│   ├── seed.sql                          ← données de départ : rôles, droits, comptes, tables, menu, historique de démo
│   └── creer-utilisateur.sql             ← compte MySQL « resto » utilisé par l'application
├── server/                               ← serveur Node.js (API, temps réel, tâches automatiques, DNS)
├── public/                               ← interface (FR/EN/AR, installable comme application)
├── desktop/                              ← sources de l'application PC (Electron) + lanceur Edge léger
├── android/                              ← sources de l'APK, clé de signature, script de reconstruction
├── Dockerfile, docker-compose.yml        ← installation par Docker (option)
├── requirements.txt                      ← prérequis logiciels et bibliothèques
├── demarrer.bat / demarrer.sh            ← lance l'application
├── demarrer-tout.bat                     ← lance l'application + le DNS rest.babfkamah.com (recommandé)
├── serveur-dns.bat                       ← lance uniquement le DNS
├── installer-base.bat                    ← crée/recrée la base avec les données de départ
├── configurer-domaine.ps1                ← pare-feu (53, 80, 3000), Wi-Fi « Privé », fichier hosts
├── ouvrir-acces-reseau.bat / .ps1        ← débloque l'accès des téléphones (pare-feu)
└── .env.example                          ← configuration à copier en .env
```

---

## 2. Installation du PC serveur (Windows)

### Prérequis
1. **Node.js 22 LTS** : https://nodejs.org
2. **MySQL 8** (https://dev.mysql.com/downloads/installer/) ou **XAMPP / WAMP** (MariaDB 10.6+)

### Étape 1 — Configuration
Copiez `.env.example` en `.env` (les scripts `.bat` le font automatiquement) et renseignez au minimum :
```
DB_USER=resto
DB_PASSWORD=resto_pass
DB_ADMIN_USER=root          ← compte MySQL qui crée la base
DB_ADMIN_PASSWORD=          ← son mot de passe (vide sous XAMPP)
JWT_SECRET=une-longue-phrase-secrete-unique
```

### Étape 2 — Base de données (au choix)
- **Automatique** : double-clic sur **`installer-base.bat`** (ou `npm install` puis `npm run init-db`).
- **phpMyAdmin / MySQL Workbench** : importez `database/schema.sql`, puis `database/seed.sql`, puis `database/creer-utilisateur.sql`.
- **Ligne de commande** :
  ```bash
  mysql -u root -p < database/schema.sql
  mysql -u root -p < database/seed.sql
  mysql -u root -p < database/creer-utilisateur.sql
  ```
> ⚠️ `schema.sql` **supprime et recrée** la base `bab_al_fkamah` : ne le relancez jamais sur la base réelle.
> Le compte `resto` / `resto_pass` doit exister (`creer-utilisateur.sql`) ; changez ce mot de passe en production (et dans `.env`).

### Étape 3 — Lancement
- **`demarrer-tout.bat`** (recommandé) : application + serveur DNS, en administrateur. Au premier lancement, il ouvre le
  pare-feu (ports 53, 80, 3000), passe le Wi-Fi en réseau Privé et ajoute `rest.babfkamah.com` au fichier hosts.
- **`demarrer.bat`** : application seule (accès par l'adresse IP : `http://192.168.x.x:3000`).

La console affiche les adresses utilisables. Sur le PC serveur : `http://localhost:3000` ou `http://rest.babfkamah.com`.

### Installation par Docker (option)
```bash
docker compose up -d --build              # MySQL 8 + application → http://localhost  (port 80) et :3000
docker compose --profile dns up -d        # + serveur DNS rest.babfkamah.com (Linux, réseau de l'hôte)
```
La base est créée et remplie automatiquement au premier démarrage. Variables modifiables :
`DB_ROOT_PASSWORD`, `DB_PASSWORD`, `JWT_SECRET` (fichier `.env` à côté de `docker-compose.yml`).
Les photos (plats, profils, logo) sont conservées dans le volume `uploads`. Fuseau horaire : Asia/Dubai.

---

## 3. Nom de domaine http://rest.babfkamah.com

Le PC devient le **DNS du Wi-Fi** : il répond `rest.babfkamah.com → adresse du PC` et transmet toutes les autres
demandes à Google / Cloudflare (Internet fonctionne normalement). L'application écoute aussi sur le **port 80**.

**Deux réglages indispensables dans la box :**
1. **Adresse fixe pour le PC** : *DHCP → réservation d'adresse / bail statique* (ex. `192.168.1.101`).
2. **DNS principal = adresse du PC** (*DHCP / LAN*), DNS secondaire vide. Redémarrez le Wi-Fi des téléphones.
   Ou téléphone par téléphone : Wi-Fi → Modifier → Options avancées → IP statique → **DNS 1 = adresse du PC**.

Sur Android : **Paramètres → Connexions → DNS privé** sur « Automatique » ou « Désactivé ».

> Port 80 occupé → arrêtez Apache (XAMPP) / IIS. Port 53 occupé → désactivez le point d'accès mobile Windows.
> Si le PC est éteint alors que la box pointe vers lui, les appareils du Wi-Fi perdent Internet : rallumez le PC
> ou remettez le DNS automatique dans la box.
> Les téléphones ne se connectent pas ? Lancez **`ouvrir-acces-reseau.bat`** (supprime les blocages du pare-feu).

---

## 4. Applications

### Android — `dist/BAB-AL-FKAMAH.apk`
- Android 7.0 minimum, conçue pour les appareils récents (Android 14/15). Taille ≈ 65 Ko.
- Installation : copiez l'APK sur le téléphone → ouvrez-le → autorisez « applications inconnues » →
  si Play Protect avertit : **« Installer quand même »**.
- L'appli ouvre directement `http://rest.babfkamah.com`. Serveur introuvable → écran d'aide (FR/EN/AR) avec champ
  **Adresse du serveur** (ex. `http://192.168.1.101:3000`), mémorisé. À changer plus tard : **Mon compte → 🌐 Adresse du serveur**.
- Photos (plats, profils) depuis l'appareil photo ou la galerie, impression par le service d'impression Android,
  liens WhatsApp / appel / Google Maps ouverts dans les applis du téléphone, sons de notification.
- Mise à jour par-dessus l'ancienne version (même clé de signature que la v3).

### PC Windows — `dist/BAB-AL-FKAMAH-PC-Windows.zip`
- Décompressez (ex. `C:\BAB AL FKAMAH`) puis lancez **`BAB AL FKAMAH.exe`** (clic droit → Envoyer vers → Bureau).
- Même écran de connexion que l'APK ; case **« Impression directe »** pour imprimer les tickets sans fenêtre
  sur l'imprimante par défaut (idéal pour la caisse).
- Raccourcis : **F5** recharger, **F11** plein écran, **Ctrl+Maj+S** adresse du serveur, **Ctrl + / −** zoom.
- Alternative très légère : `desktop/BAB AL FKAMAH (Edge).bat` (ouvre l'application en fenêtre dédiée avec Edge).
- Écran tactile : clavier intégré activable (bouton ⌨️).

### iPhone / autres
Safari → `http://rest.babfkamah.com` → Partager → **« Sur l'écran d'accueil »**.

---

## 5. Comptes de démonstration

| Utilisateur | Mot de passe | Rôle | Nom |
|---|---|---|---|
| `admin` | `admin123` | Admin | Administrateur |
| `patron` | `patron123` | Patron | Omar Saleh |
| `caisse` | `caisse123` | Caissier | Aisha Rahman |
| `serveur1` | `serveur123` | Serveur (groupe « Chefs de rang ») | Karim Nasser |
| `serveur2` | `serveur123` | Serveur | Yousef Ali |
| `cuisine` | `cuisine123` | Cuisinier | Hassan Mahdi |
| `livreur1` | `livreur123` | Livreur | Salem Obaid |
| `livreur2` | `livreur123` | Livreur | Rashid Khan |

**Changez tous ces mots de passe avant la mise en service.** La base contient aussi ~560 factures de démonstration
sur 90 jours (pour le tableau de bord et l'apprentissage du menu) : pour démarrer à vide, l'admin peut les supprimer
en réduisant temporairement la conservation des factures (Paramètres) ou en vidant les tables `factures` / `facture_lignes`.

Connexion : **identifiant + mot de passe**, ou **empreinte digitale / visage** (Mon compte → activer sur cet appareil ;
nécessite `localhost` ou HTTPS, voir `HTTPS_PORT` et dossier `certs/`).

---

## 6. Langues

- Sélecteur **FR · EN · عربي** sur l'écran de connexion et dans la barre du haut : le changement est **immédiat**,
  sans recharger, et mémorisé par utilisateur (Mon compte) ; langue par défaut réglable par l'admin.
- En arabe, toute l'interface passe **de droite à gauche** ; le clavier tactile suit la langue (AZERTY / QWERTY / arabe).
- Les plats et catégories ont un nom dans chaque langue (Menu → ✏️). Les messages d'erreur, notifications,
  tickets imprimés et le journal suivent la langue de l'utilisateur.

---

## 7. Zones et types de service

| Famille | Emplacements |
|---|---|
| VIP | **VVIP** (une salle, une table) · VIP 2 : **VIP1, VIP2, VIP3, VIP4, VIP5** |
| FREE AIR ZONE | FZA1, FZA2, FZB1, FZB2, FZC1, FZC4 |
| SALLE | SA1, SA2, SA3, SA4, SVIP |

Modifiables dans **Salle → Gérer les emplacements**.

### Prise de commande (nouvel ordre)
1. On choisit le service (**Sur place / À emporter / Livraison**) et on **ajoute directement les plats**.
2. Les informations client sont **facultatives et saisies ensuite** (bloc « Informations client ») :
   - À emporter : couleur + immatriculation de la voiture, **ou** nom + téléphone (commande par téléphone) ;
   - Livraison : nom, téléphone, adresse, localisation (repère, lien Google Maps ou GPS).
3. **Commentaire** sur la commande et **précision** sur chaque article (✎ : « sans piment », « bien cuit »…),
   visibles en cuisine et sur le ticket.
4. **✓ Valider** ou **✓ Valider + 🖨️ Imprimer** → la facture part en caisse, la commande en cuisine,
   et pour une livraison, les livreurs sont prévenus (son).

---

## 8. Menu

Menu par défaut (50 plats, noms FR/EN/AR) avec **prix par défaut par catégorie** — chaque plat peut avoir son propre prix :

| Catégorie | Prix par défaut | Plats |
|---|---|---|
| Meat (Viande) | 45 AED | Meat mandi, madhbi, boorma, kabsa, madfoun, haneeth, mohammer, moqalqal, Quarter meat, Half meat, Entire meat |
| Chicken (Poulet) | 25 AED | Chicken mandi, madhbi, madfoun, zurbian, biryani, kabsa, mohammer, moqalqal, shawaya |
| Rice (Riz) | 10 AED | Rice mandi, White rice, Bokari rice |
| Light meals | 12 AED | Lahsa, Shakshouka, Fried egg, Omelette, Foul, Foul + cheese, Beans, Beans + tuna, Beans + tuna + cheese, Tuna, Tuna + cheese, Saltah, Saltah + tuna, Fahsah meat, Crevette |
| Bread (Pain) | 2 AED | Roshrosh, Moulawa, Rotub |
| Drinks (Boissons) | 3 AED | Coca, Miranda, Pepsi, Pepsi diet, Coca zero, Sprite, Mountain Dew, Big coca, Big pepsi |

> ⚠️ **Les prix sont provisoires** : modifiez-les dans **Menu → ✏️ catégorie** (prix par défaut, option
> « appliquer à tous les plats ») ou plat par plat (prix vide = prix de la catégorie).
> Orthographes corrigées : « Omelette », « Mountain Dew ». Les noms arabes sont des propositions, modifiables.

- **Photo par plat** (📷 sur la vignette) : appareil photo ou fichier, redimensionnée automatiquement.
- Le cuisinier ajoute / modifie les plats, catégories et menus ; **seuls le patron et l'admin peuvent supprimer un plat**.
- Menu du jour (prix spéciaux) modifiable par le cuisinier et le serveur. Plat « épuisé » en un clic.

### Menu intelligent
L'onglet **⭐ Pour vous** et l'ordre des plats s'adaptent tout seuls : popularité récente (les ventes récentes comptent
plus), **habitudes de chaque serveur**, et **heure de la journée** (petit-déjeuner ≠ dîner). Les catégories les plus
utilisées passent en premier, et la suggestion « souvent pris avec » propose les accompagnements habituellement
commandés avec les plats du ticket (calculée sur les 60 derniers jours).

---

## 9. Livreurs (nouveau rôle)

1. Une commande **Livraison** validée apparaît chez tous les livreurs (onglet **Disponibles**) avec un **son**.
2. Le livreur **✋ Accepte** : la commande lui est **attribuée** et disparaît chez les autres
   (si deux livreurs acceptent en même temps, un seul l'obtient).
3. **Il ne peut pas se désattribuer** : seuls le **caissier, le patron et l'admin** peuvent retirer ou réattribuer une livraison
   (Emporter & livraison ou fiche facture → 🛵).
4. Sur chaque carte : **WhatsApp** (lien généré depuis le numéro du client, indicatif +971 réglable, message prérempli),
   **📞 Appeler**, **🧭 Itinéraire** (Google Maps), **🚀 En route**, puis **✅ Livrée**.
5. Quand la cuisine marque la commande **Prête**, le livreur attribué (ou tous les livreurs) reçoit une notification sonore.
6. Onglets : Disponibles · Mes livraisons · Livrées ; le nom du livreur est inscrit sur la facture et le ticket.

---

## 10. Caisse, factures et alertes

- Paiement **💵 Cash** (montants rapides, monnaie à rendre calculée) ou **💳 Visa** ; **Payer + 🖨️ Imprimer**.
- Chaque facture porte le **nom du serveur**, et après encaissement **le nom de la personne qui a encaissé** (conservé
  même si le compte est supprimé), ainsi que le livreur le cas échéant.
- Toute modification d'une facture par une autre personne **notifie le serveur concerné** et est historisée.
- Facture réglée : modifiable seulement par le patron / l'admin (`facture.modifier_reglee`).
- **🔴 Facture validée non payée depuis plus de 2 h** : ligne et tuile en rouge, alerte au caissier et au patron (durée réglable).
- **🔴 Commande en cuisine depuis plus de 30 min** : carte rouge + notification au **patron, au serveur concerné et au cuisinier** (réglable).
- **Commande prête** : son pour le serveur ; pour une livraison, son pour les livreurs.
- **Deleted bills** : toute suppression demande un motif ; restauration / suppression définitive réservées au manager.
- **Historique** (Caisse, Tableau de bord, Journal) : filtres **Aujourd'hui · Semaine · Mois · 3 mois · Calendrier personnalisé**,
  recherche, export CSV.

### Conservation automatique (Paramètres, admin)
| Élément | Règle par défaut | Réglage |
|---|---|---|
| Factures | Toutes enregistrées en base ; **supprimées après 1 an** | Durée en jours (admin) |
| Commandes | Gardées ~12 h ; **table des commandes remise à zéro chaque matin à 5 h** (sauf commandes dont la facture n'est pas payée) ; numérotation #1, #2… repart chaque jour | Heure (admin) |
| Récapitulatif cuisine | **12 dernières heures** | Admin et patron |

Les factures sont indépendantes des commandes : la remise à zéro du matin n'efface aucune facture.

---

## 11. Rôles, groupes et fonctionnalités

**Chaque action est une fonctionnalité** (54 au total), attribuable à un rôle, à un groupe ou à une personne :
```
droits = rôle + groupes + ajouts individuels − retraits individuels      (l'admin a tout)
```
- **Rôles & droits** : matrice + bouton **↺ Défaut** par rôle ;
- **Utilisateurs → Droits** : Défaut / Accordée / Retirée par fonctionnalité, bouton **↺ Défaut** ;
- **Groupes** : ex. « Chefs de rang » autorise les remises.

| Module | Fonctionnalités |
|---|---|
| Commandes | creer, ajouter_article, retirer_article, valider, annuler, supprimer, marquer_servie, voir_miennes, voir_toutes, gerer_toutes |
| Factures | voir, payer, modifier, modifier_reglee, remise, imprimer, supprimer, supprimer_reglee |
| Deleted bills | voir, restaurer, vider |
| Livraison | voir, voir_disponibles, accepter, marquer_livree, assigner, retirer |
| Cuisine | voir, statut, recap |
| Menu | voir, item_ajouter, item_modifier, item_supprimer, images, categorie_gerer, creer, modifier, du_jour_modifier |
| Salle | voir, gerer |
| Utilisateurs | voir, creer, modifier, supprimer, changer_role, fonctionnalites · groupe.gerer, groupe.fonctionnalites · role.fonctionnalites |
| Pilotage / Paramètres | rapport.voir, journal.voir · parametres.gerer, parametres.cuisine |

Règles clés : seul l'admin crée les comptes ; le patron supprime tout compte sauf l'admin, change les rôles et les droits ;
personne sauf l'admin ne touche à un administrateur ; suppression de compte logique (historique conservé) ;
toutes les actions sensibles sont inscrites au **journal**.

---

## 12. Personnalisation (admin)

**Paramètres** : nom du restaurant (par défaut **BAB AL FKAMAH**) et **logo** (écran de connexion, barre, tickets,
icône de l'application installée), langue par défaut, indicatif WhatsApp, délais d'alerte, récapitulatif cuisine,
conservation des factures, heure de remise à zéro, boutons « remettre à zéro maintenant » / « purger maintenant ».
**Mon compte** (chaque utilisateur) : **photo de profil**, langue, mot de passe, biométrie, clavier tactile, préférences de l'appareil.

---

## 13. Reconstruire les applications (développeurs)

- **APK** : `android/construire-apk.sh` (Java 11+, apktool 2.9.3, uber-apk-signer). Augmentez `versionCode` dans
  `android/app/apktool.yml`. **Conservez `android/bab-al-fkamah.jks` et `signature-LISEZMOI.txt`** : sans eux,
  impossible d'installer une mise à jour par-dessus l'application existante.
- **PC** : `desktop/construire-pc.sh` (télécharge Electron win32-x64, applique icône et nom).
  En développement : `cd desktop && npm install && npm start`.
- Les mises à jour du serveur (dossiers `server/`, `public/`) ne nécessitent **ni nouvel APK ni nouvelle application PC**.
