// Outils communs : prix, montants, images, fenêtre de service
const fs = require('fs');
const path = require('path');
const { q, one } = require('./db');
const { fail, param } = require('./core');

const UPLOADS = path.join(__dirname, '..', 'uploads');

// Prix appliqué : prix spécial du menu du jour > prix du plat > prix par défaut de la catégorie
const PLAT_PRIX = `SELECT p.id, p.nom, p.disponible,
    COALESCE((SELECT mp.prix_special FROM menu_plats mp JOIN menus m ON m.id=mp.menu_id
              WHERE m.est_du_jour=1 AND mp.plat_id=p.id AND mp.prix_special IS NOT NULL LIMIT 1), p.prix, c.prix_defaut) AS prix
  FROM plats p JOIN categories c ON c.id=p.categorie_id WHERE p.id = ?`;

async function platPrix(id) {
  const p = await one(PLAT_PRIX, [id]);
  if (!p) fail(404, 'plat_introuvable');
  if (!p.disponible) fail(400, 'plat_indisponible', { nom: p.nom });
  return p;
}

const aed = n => `${Number(n || 0).toFixed(2)} AED`;
const round2 = n => Math.round(Number(n || 0) * 100) / 100;

// Début du service en cours (heure de réinitialisation, 5 h par défaut)
async function debutService() {
  const H = Number(await param('heure_reinitialisation', 5));
  const d = new Date();
  const debut = new Date(d.getFullYear(), d.getMonth(), d.getDate(), H, 0, 0);
  if (d < debut) debut.setDate(debut.getDate() - 1);
  return debut;
}
const dateLocale = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Enregistre une image envoyée en data-URL (déjà redimensionnée par l'interface)
function saveImage(dataUrl, dossier, prefixe) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) fail(400, 'image_invalide');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) fail(400, 'image_trop_lourde');
  const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
  const dir = path.join(UPLOADS, dossier);
  fs.mkdirSync(dir, { recursive: true });
  const nom = `${prefixe}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, nom), buf);
  return `/uploads/${dossier}/${nom}`;
}
function deleteImage(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const f = path.join(UPLOADS, url.replace(/^\/uploads\//, ''));
  if (f.startsWith(UPLOADS)) fs.promises.unlink(f).catch(() => {});
}

const CLIENT_CHAMPS = ['client_nom', 'client_tel', 'client_whatsapp', 'voiture_couleur', 'voiture_immat', 'adresse', 'localisation', 'commentaire'];
function champsClient(b, base = {}) {
  const o = {};
  for (const k of CLIENT_CHAMPS) {
    const v = b[k] !== undefined ? b[k] : base[k];
    o[k] = v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, k === 'commentaire' ? 500 : 255);
  }
  return o;
}

module.exports = { PLAT_PRIX, platPrix, aed, round2, debutService, dateLocale, saveImage, deleteImage, UPLOADS, CLIENT_CHAMPS, champsClient, q };
