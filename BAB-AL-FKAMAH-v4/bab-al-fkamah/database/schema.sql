-- =====================================================================
--  BAB AL FKAMAH — Gestion de restaurant — Schéma MySQL 8 / MariaDB 10.6+ (v4)
--  Encodage utf8mb4 (français, anglais, arabe)
--  ⚠️ Ce script SUPPRIME puis RECRÉE la base bab_al_fkamah.
-- =====================================================================
DROP DATABASE IF EXISTS bab_al_fkamah;
CREATE DATABASE bab_al_fkamah CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bab_al_fkamah;

-- ---------------------------------------------------------------------
-- 1. PARAMÈTRES (nom, logo, devise, délais, purges…)
-- ---------------------------------------------------------------------
CREATE TABLE parametres (
  cle         VARCHAR(60) PRIMARY KEY,
  valeur      TEXT,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 2. UTILISATEURS, RÔLES, GROUPES, FONCTIONNALITÉS
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  code         VARCHAR(30)  NOT NULL UNIQUE,   -- ADMIN, PATRON, CAISSIER, SERVEUR, CUISINIER, LIVREUR
  libelle      VARCHAR(60)  NOT NULL,
  couleur      VARCHAR(9)   NOT NULL DEFAULT '#0f766e',
  description  VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE fonctionnalites (             -- chaque action est une fonctionnalité
  id       INT AUTO_INCREMENT PRIMARY KEY,
  code     VARCHAR(60)  NOT NULL UNIQUE,
  module   VARCHAR(40)  NOT NULL,
  libelle  VARCHAR(160) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE role_fonctionnalites (
  role_id INT NOT NULL, fonctionnalite_id INT NOT NULL,
  PRIMARY KEY (role_id, fonctionnalite_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (fonctionnalite_id) REFERENCES fonctionnalites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Valeurs d'origine de chaque rôle (bouton « Défaut »)
CREATE TABLE role_fonctionnalites_defaut (
  role_id INT NOT NULL, fonctionnalite_id INT NOT NULL,
  PRIMARY KEY (role_id, fonctionnalite_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (fonctionnalite_id) REFERENCES fonctionnalites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE utilisateurs (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  username           VARCHAR(80)  NOT NULL UNIQUE,
  password_hash      VARCHAR(100) NOT NULL,
  nom_complet        VARCHAR(120) NOT NULL,
  telephone          VARCHAR(30),
  photo              VARCHAR(255) NULL,          -- /uploads/profils/…
  langue             VARCHAR(5)   NOT NULL DEFAULT 'fr',
  role_id            INT NOT NULL,
  actif              TINYINT(1) NOT NULL DEFAULT 1,
  cree_par           INT NULL,
  derniere_connexion DATETIME NULL,
  supprime_at        DATETIME NULL,              -- suppression logique
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (cree_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE utilisateur_fonctionnalites (   -- accorde=1 ajout, accorde=0 retrait
  utilisateur_id INT NOT NULL, fonctionnalite_id INT NOT NULL,
  accorde TINYINT(1) NOT NULL DEFAULT 1, attribue_par INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (utilisateur_id, fonctionnalite_id),
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE,
  FOREIGN KEY (fonctionnalite_id) REFERENCES fonctionnalites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE groupes (
  id INT AUTO_INCREMENT PRIMARY KEY, nom VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255), created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE groupe_membres (
  groupe_id INT NOT NULL, utilisateur_id INT NOT NULL, PRIMARY KEY (groupe_id, utilisateur_id),
  FOREIGN KEY (groupe_id) REFERENCES groupes(id) ON DELETE CASCADE,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE groupe_fonctionnalites (
  groupe_id INT NOT NULL, fonctionnalite_id INT NOT NULL, PRIMARY KEY (groupe_id, fonctionnalite_id),
  FOREIGN KEY (groupe_id) REFERENCES groupes(id) ON DELETE CASCADE,
  FOREIGN KEY (fonctionnalite_id) REFERENCES fonctionnalites(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE identifiants_biometriques (      -- empreinte / visage (WebAuthn)
  id INT AUTO_INCREMENT PRIMARY KEY, utilisateur_id INT NOT NULL,
  credential_id VARCHAR(512) NOT NULL UNIQUE, public_key TEXT NOT NULL,
  compteur BIGINT NOT NULL DEFAULT 0, transports VARCHAR(120), appareil VARCHAR(120),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 3. SALLE
-- ---------------------------------------------------------------------
CREATE TABLE zones (
  id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE,
  nom VARCHAR(60) NOT NULL, famille VARCHAR(30) NOT NULL, ordre INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE emplacements (
  id INT AUTO_INCREMENT PRIMARY KEY, zone_id INT NOT NULL, code VARCHAR(20) NOT NULL UNIQUE,
  places INT NOT NULL DEFAULT 4, actif TINYINT(1) NOT NULL DEFAULT 1,
  FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 4. MENU (traductions FR/EN/AR, prix par catégorie, images)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nom          VARCHAR(60) NOT NULL UNIQUE,
  traductions  TEXT NULL,                       -- {"fr":"…","en":"…","ar":"…"}
  icone        VARCHAR(10) NOT NULL DEFAULT '🍽️',
  prix_defaut  DECIMAL(12,2) NOT NULL DEFAULT 0, -- prix commun à tous les plats de la catégorie
  ordre        INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE plats (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  categorie_id       INT NOT NULL,
  nom                VARCHAR(120) NOT NULL,
  traductions        TEXT NULL,
  description        VARCHAR(255),
  prix               DECIMAL(12,2) NULL,        -- NULL = prix par défaut de la catégorie
  image              VARCHAR(255) NULL,         -- /uploads/plats/…
  disponible         TINYINT(1) NOT NULL DEFAULT 1,
  temps_preparation  INT NOT NULL DEFAULT 15,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categorie_id) REFERENCES categories(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE menus (
  id INT AUTO_INCREMENT PRIMARY KEY, nom VARCHAR(100) NOT NULL, date_menu DATE NULL,
  est_du_jour TINYINT(1) NOT NULL DEFAULT 0, cree_par INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cree_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB;
CREATE TABLE menu_plats (
  menu_id INT NOT NULL, plat_id INT NOT NULL, prix_special DECIMAL(12,2) NULL,
  PRIMARY KEY (menu_id, plat_id),
  FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE,
  FOREIGN KEY (plat_id) REFERENCES plats(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 5. COMMANDES DU JOUR (réinitialisées chaque matin, 5 h par défaut)
-- ---------------------------------------------------------------------
CREATE TABLE commandes (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  numero           VARCHAR(20) NOT NULL,           -- n° du jour (#1, #2…) remis à zéro chaque matin
  type_service     ENUM('SUR_PLACE','EMPORTER','LIVRAISON') NOT NULL,
  emplacement_id   INT NULL,
  nb_couverts      INT NULL,
  -- informations client : toutes FACULTATIVES, saisies après les plats
  client_nom       VARCHAR(120) NULL,
  client_tel       VARCHAR(30)  NULL,
  client_whatsapp  VARCHAR(30)  NULL,
  voiture_couleur  VARCHAR(40)  NULL,
  voiture_immat    VARCHAR(30)  NULL,
  adresse          VARCHAR(255) NULL,
  localisation     VARCHAR(255) NULL,
  commentaire      VARCHAR(500) NULL,           -- commentaire général de la commande
  statut           ENUM('BROUILLON','VALIDEE','PAYEE','ANNULEE','SUPPRIMEE') NOT NULL DEFAULT 'BROUILLON',
  statut_cuisine   ENUM('EN_ATTENTE','EN_PREPARATION','PRETE','SERVIE') NOT NULL DEFAULT 'EN_ATTENTE',
  alerte_cuisine   TINYINT(1) NOT NULL DEFAULT 0, -- alerte « plus de 30 min en cuisine » envoyée
  supprime_at      DATETIME NULL,
  supprime_par     INT NULL,
  supprime_par_nom VARCHAR(120) NULL,
  motif_suppression VARCHAR(255) NULL,
  statut_avant_suppression VARCHAR(20) NULL,
  serveur_id       INT NOT NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  validee_at       DATETIME NULL,
  prete_at         DATETIME NULL,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (emplacement_id) REFERENCES emplacements(id) ON DELETE SET NULL,
  FOREIGN KEY (serveur_id) REFERENCES utilisateurs(id)
) ENGINE=InnoDB;

-- Articles de la commande (recopiés dans facture_lignes à la validation, puis synchronisés)
CREATE TABLE commande_lignes (
  id INT AUTO_INCREMENT PRIMARY KEY, commande_id INT NOT NULL, plat_id INT NULL,
  libelle VARCHAR(120) NOT NULL, prix_unitaire DECIMAL(12,2) NOT NULL, quantite INT NOT NULL DEFAULT 1,
  note VARCHAR(200) NULL,                        -- précision pour la cuisine
  ajoute_par INT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE CASCADE,
  FOREIGN KEY (plat_id) REFERENCES plats(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 6. FACTURES (autonomes : conservées après la réinitialisation des commandes,
--    effacées automatiquement après la durée de conservation — 365 jours par défaut)
-- ---------------------------------------------------------------------
CREATE TABLE factures (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  numero              VARCHAR(24) NOT NULL UNIQUE,
  commande_id         INT NULL,                  -- NULL après la réinitialisation quotidienne
  commande_numero     VARCHAR(20) NOT NULL,
  type_service        ENUM('SUR_PLACE','EMPORTER','LIVRAISON') NOT NULL,
  emplacement_code    VARCHAR(20) NULL,
  zone_nom            VARCHAR(60) NULL,
  nb_couverts         INT NULL,
  client_nom          VARCHAR(120) NULL,
  client_tel          VARCHAR(30)  NULL,
  client_whatsapp     VARCHAR(30)  NULL,
  voiture_couleur     VARCHAR(40)  NULL,
  voiture_immat       VARCHAR(30)  NULL,
  adresse             VARCHAR(255) NULL,
  localisation        VARCHAR(255) NULL,
  commentaire         VARCHAR(500) NULL,
  sous_total          DECIMAL(12,2) NOT NULL DEFAULT 0,
  remise              DECIMAL(12,2) NOT NULL DEFAULT 0,
  montant_total       DECIMAL(12,2) NOT NULL DEFAULT 0,
  statut              ENUM('A_PAYER','PAYEE','ANNULEE','SUPPRIMEE') NOT NULL DEFAULT 'A_PAYER',
  statut_avant_suppression VARCHAR(20) NULL,
  -- noms conservés tels quels, même si le compte est modifié ou supprimé ensuite
  serveur_id          INT NULL,  serveur_nom  VARCHAR(120) NOT NULL,
  caissier_id         INT NULL,  caissier_nom VARCHAR(120) NULL,     -- personne qui a encaissé
  livreur_id          INT NULL,  livreur_nom  VARCHAR(120) NULL,
  statut_livraison    ENUM('DISPONIBLE','ACCEPTEE','EN_ROUTE','LIVREE') NULL,
  livraison_acceptee_at DATETIME NULL,
  livree_at           DATETIME NULL,
  mode_paiement       ENUM('CASH','VISA') NULL,     -- espèces ou carte Visa
  montant_recu        DECIMAL(12,2) NULL,
  monnaie_rendue      DECIMAL(12,2) NULL,
  alerte_impaye       TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- = validation de la commande
  payee_at            DATETIME NULL,
  supprime_at         DATETIME NULL,
  supprime_par        INT NULL, supprime_par_nom VARCHAR(120) NULL,
  motif_suppression   VARCHAR(255) NULL,
  FOREIGN KEY (commande_id) REFERENCES commandes(id) ON DELETE SET NULL,
  FOREIGN KEY (serveur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  FOREIGN KEY (caissier_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  FOREIGN KEY (livreur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL,
  FOREIGN KEY (supprime_par) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE facture_lignes (
  id INT AUTO_INCREMENT PRIMARY KEY, facture_id INT NOT NULL, plat_id INT NULL,
  libelle VARCHAR(120) NOT NULL, prix_unitaire DECIMAL(12,2) NOT NULL, quantite INT NOT NULL DEFAULT 1,
  note VARCHAR(200) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (facture_id) REFERENCES factures(id) ON DELETE CASCADE,
  FOREIGN KEY (plat_id) REFERENCES plats(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE facture_modifications (
  id INT AUTO_INCREMENT PRIMARY KEY, facture_id INT NOT NULL,
  utilisateur_id INT NULL, utilisateur_nom VARCHAR(120) NOT NULL,
  action VARCHAR(40) NOT NULL, details VARCHAR(500),
  ancien_total DECIMAL(12,2), nouveau_total DECIMAL(12,2),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (facture_id) REFERENCES factures(id) ON DELETE CASCADE,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- 7. NOTIFICATIONS (clé de texte + paramètres : affichées dans la langue de chacun) ET JOURNAL
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY, utilisateur_id INT NOT NULL,
  type VARCHAR(30) NOT NULL DEFAULT 'INFO',
  titre VARCHAR(160) NOT NULL, message VARCHAR(300), params TEXT, lien VARCHAR(120),
  lu TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE journal (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, utilisateur_id INT NULL, utilisateur_nom VARCHAR(120) NULL,
  action VARCHAR(40) NOT NULL, cible VARCHAR(80), details VARCHAR(500),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (utilisateur_id) REFERENCES utilisateurs(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE INDEX idx_fact_date    ON factures(created_at);
CREATE INDEX idx_fact_serveur ON factures(serveur_id, created_at);
CREATE INDEX idx_cmd_statut   ON commandes(statut, created_at);
CREATE INDEX idx_fact_statut  ON factures(statut, created_at);
CREATE INDEX idx_fact_liv     ON factures(type_service, statut_livraison);
CREATE INDEX idx_fl_plat      ON facture_lignes(plat_id);
CREATE INDEX idx_notif_user   ON notifications(utilisateur_id, lu);
CREATE INDEX idx_journal_date ON journal(created_at);
