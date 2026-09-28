// Compte, salle, tableau de bord, notifications, journal, paramètres (nom, logo, délais, conservation)
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { q, one } = require('../db');
const { h, fail, need, log, broadcast, param, params, setParam } = require('../core');
const { saveImage, deleteImage, aed, dateLocale } = require('../lib');
const jobs = require('../jobs');

// ---------------- MON COMPTE ----------------
router.get('/me', h(async (req, res) => res.json(req.user)));
router.put('/me/langue', h(async (req, res) => {
  const l = String(req.body.langue || '');
  if (!['fr', 'en', 'ar'].includes(l)) fail(400, 'langue_invalide');
  await q('UPDATE utilisateurs SET langue=? WHERE id=?', [l, req.user.id]);
  res.json({ ok: true });
}));
router.post('/me/password', h(async (req, res) => {
  const { ancien, nouveau } = req.body;
  const u = await one('SELECT password_hash FROM utilisateurs WHERE id=?', [req.user.id]);
  if (!(await bcrypt.compare(ancien || '', u.password_hash))) fail(400, 'ancien_mdp');
  if (!nouveau || nouveau.length < 6) fail(400, 'mdp_court');
  await q('UPDATE utilisateurs SET password_hash=? WHERE id=?', [await bcrypt.hash(nouveau, 10), req.user.id]);
  await log(req.user, 'MOT_DE_PASSE', 'compte');
  res.json({ ok: true });
}));
router.post('/me/photo', h(async (req, res) => {
  const url = saveImage(req.body.data, 'profils', `u${req.user.id}`);
  await q('UPDATE utilisateurs SET photo=? WHERE id=?', [url, req.user.id]);
  deleteImage(req.user.photo);
  res.json({ photo: url });
}));
router.delete('/me/photo', h(async (req, res) => {
  deleteImage(req.user.photo);
  await q('UPDATE utilisateurs SET photo=NULL WHERE id=?', [req.user.id]);
  res.json({ ok: true });
}));
router.get('/me/biometrie', h(async (req, res) => {
  res.json(await q('SELECT id, appareil, created_at FROM identifiants_biometriques WHERE utilisateur_id=? ORDER BY id DESC', [req.user.id]));
}));
router.delete('/me/biometrie/:id', h(async (req, res) => {
  await q('DELETE FROM identifiants_biometriques WHERE id=? AND utilisateur_id=?', [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

// ---------------- SALLE ----------------
router.get('/salle', need('salle.voir', 'commande.creer'), h(async (req, res) => {
  const zones = await q('SELECT * FROM zones ORDER BY ordre');
  const emps = await q(`SELECT e.*, c.id AS commande_id, c.numero, c.statut AS commande_statut, c.statut_cuisine, c.created_at AS depuis,
      c.nb_couverts, c.serveur_id, s.nom_complet AS serveur_nom, f.id AS facture_id, f.created_at AS facture_at, f.montant_total,
      (SELECT COALESCE(SUM(l.prix_unitaire*l.quantite),0) FROM commande_lignes l WHERE l.commande_id=c.id) AS montant
    FROM emplacements e
    LEFT JOIN commandes c ON c.id = (SELECT c2.id FROM commandes c2 WHERE c2.emplacement_id=e.id AND c2.statut IN ('BROUILLON','VALIDEE') ORDER BY c2.created_at DESC LIMIT 1)
    LEFT JOIN utilisateurs s ON s.id=c.serveur_id
    LEFT JOIN factures f ON f.commande_id=c.id AND f.statut='A_PAYER'
    WHERE e.actif=1 ORDER BY e.zone_id, e.id`);
  zones.forEach(z => { z.emplacements = emps.filter(e => e.zone_id === z.id); });
  res.json(zones);
}));
router.post('/emplacements', need('salle.gerer'), h(async (req, res) => {
  const { zone_id, code, places = 4 } = req.body;
  if (!zone_id || !code) fail(400, 'zone_code_requis');
  const ex = await one('SELECT id, actif FROM emplacements WHERE code=?', [code.trim().toUpperCase()]);
  if (ex && !ex.actif) await q('UPDATE emplacements SET actif=1, zone_id=?, places=? WHERE id=?', [zone_id, places, ex.id]);
  else await q('INSERT INTO emplacements (zone_id, code, places) VALUES (?,?,?)', [zone_id, code.trim().toUpperCase(), places]);
  await log(req.user, 'EMPLACEMENT_AJOUT', code);
  broadcast('refresh', { scope: 'salle' });
  res.status(201).json({ ok: true });
}));
router.delete('/emplacements/:id', need('salle.gerer'), h(async (req, res) => {
  await q('UPDATE emplacements SET actif=0 WHERE id=?', [req.params.id]);
  broadcast('refresh', { scope: 'salle' });
  res.json({ ok: true });
}));
router.post('/zones', need('salle.gerer'), h(async (req, res) => {
  const { code, nom, famille } = req.body;
  if (!code || !nom || !famille) fail(400, 'zone_code_requis');
  await q('INSERT INTO zones (code, nom, famille, ordre) VALUES (?,?,?,99)', [code.toUpperCase(), nom, famille]);
  broadcast('refresh', { scope: 'salle' });
  res.status(201).json({ ok: true });
}));

// ---------------- TABLEAU DE BORD (période au choix) ----------------
function periode(req) {
  const du = /^\d{4}-\d{2}-\d{2}$/.test(req.query.du || '') ? req.query.du : dateLocale(new Date());
  const au = /^\d{4}-\d{2}-\d{2}$/.test(req.query.au || '') ? req.query.au : du;
  return [du + ' 00:00:00', au + ' 23:59:59'];
}
router.get('/dashboard', need('rapport.voir'), h(async (req, res) => {
  const P = periode(req);
  const W = "f.statut='PAYEE' AND f.payee_at BETWEEN ? AND ?";
  const kpi = await one(`SELECT COALESCE(SUM(f.montant_total),0) AS ca, COUNT(*) AS nb, COALESCE(AVG(f.montant_total),0) AS panier,
      COALESCE(SUM(CASE WHEN f.mode_paiement='CASH' THEN f.montant_total END),0) AS cash, COALESCE(SUM(CASE WHEN f.mode_paiement='VISA' THEN f.montant_total END),0) AS visa
    FROM factures f WHERE ${W}`, P);
  const delaiRouge = Number(await param('delai_facture_rouge_min', 120));
  const attente = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(montant_total),0) AS montant, SUM(created_at < NOW() - INTERVAL ? MINUTE) AS rouges FROM factures WHERE statut='A_PAYER'`, [delaiRouge]);
  const enCours = await one(`SELECT COUNT(*) AS n FROM commandes WHERE statut='BROUILLON'`);
  const occupees = await one(`SELECT COUNT(DISTINCT emplacement_id) AS n FROM commandes WHERE statut IN ('BROUILLON','VALIDEE') AND emplacement_id IS NOT NULL`);
  const totalTables = await one('SELECT COUNT(*) n FROM emplacements WHERE actif=1');
  const delaiCuisine = Number(await param('delai_cuisine_alerte_min', 30));
  const retard = await q(`SELECT numero FROM commandes WHERE statut IN ('VALIDEE','PAYEE') AND statut_cuisine IN ('EN_ATTENTE','EN_PREPARATION') AND validee_at < NOW() - INTERVAL ? MINUTE`, [delaiCuisine]);
  const grp = (col, extra = '') => q(`SELECT ${col} AS label, SUM(f.montant_total) AS montant, COUNT(*) AS n FROM factures f WHERE ${W} ${extra} GROUP BY ${col} ORDER BY montant DESC`, P);
  const parType = await grp('f.type_service');
  const parZone = await grp('f.zone_nom', 'AND f.zone_nom IS NOT NULL');
  const parServeur = await grp('f.serveur_nom');
  const parCaissier = await grp('f.caissier_nom');
  const parMode = await grp('f.mode_paiement');
  const parLivreur = await q(`SELECT f.livreur_nom AS label, COUNT(*) AS n, SUM(f.montant_total) AS montant FROM factures f
      WHERE f.type_service='LIVRAISON' AND f.statut_livraison='LIVREE' AND f.livree_at BETWEEN ? AND ? GROUP BY f.livreur_nom ORDER BY n DESC`, P);
  const topPlats = await q(`SELECT l.plat_id, l.libelle AS label, SUM(l.quantite) AS n, SUM(l.quantite*l.prix_unitaire) AS montant
      FROM facture_lignes l JOIN factures f ON f.id=l.facture_id WHERE ${W} GROUP BY l.plat_id, l.libelle ORDER BY n DESC LIMIT 10`, P);
  const parHeure = await q(`SELECT HOUR(f.payee_at) AS h, SUM(f.montant_total) AS montant FROM factures f WHERE ${W} GROUP BY HOUR(f.payee_at) ORDER BY h`, P);
  const parJour = await q(`SELECT DATE_FORMAT(f.payee_at, '%Y-%m-%d') AS jour, SUM(f.montant_total) AS montant, COUNT(*) AS n FROM factures f WHERE ${W} GROUP BY jour ORDER BY jour`, P);
  const modifs = await one(`SELECT COUNT(*) n FROM facture_modifications WHERE created_at BETWEEN ? AND ?`, P);
  const supprimees = await one(`SELECT COUNT(*) n, COALESCE(SUM(montant_total),0) m FROM factures WHERE statut='SUPPRIMEE' AND supprime_at BETWEEN ? AND ?`, P);
  const indispo = await q('SELECT nom, traductions FROM plats WHERE disponible=0');

  // Assistant : indications calculées (clé de texte + paramètres, traduites par l'interface)
  const alertes = [];
  if (attente.rouges > 0) alertes.push({ niveau: 'alerte', cle: 'a_impayes_rouges', p: { n: attente.rouges, h: Math.round(delaiRouge / 60 * 10) / 10 } });
  else if (attente.n > 0) alertes.push({ niveau: 'info', cle: 'a_attente', p: { n: attente.n, montant: aed(attente.montant) } });
  if (retard.length) alertes.push({ niveau: 'alerte', cle: 'a_cuisine_retard', p: { m: delaiCuisine, liste: retard.map(r => r.numero).join(', ') } });
  if (modifs.n >= 5) alertes.push({ niveau: 'alerte', cle: 'a_modifs', p: { n: modifs.n } });
  if (supprimees.n > 0) alertes.push({ niveau: 'alerte', cle: 'a_supprimees', p: { n: supprimees.n, montant: aed(supprimees.m) } });
  if (indispo.length) alertes.push({ niveau: 'info', cle: 'a_indispo', p: { liste: indispo.map(p => p.nom).join(', ') } });
  if (parServeur.length > 1) alertes.push({ niveau: 'ok', cle: 'a_meilleur', p: { nom: parServeur[0].label } });
  if (topPlats.length) alertes.push({ niveau: 'ok', cle: 'a_top', p: { nom: topPlats[0].label, n: topPlats[0].n } });
  res.json({ du: P[0].slice(0, 10), au: P[1].slice(0, 10), kpi, attente, enCours: enCours.n, occupees: occupees.n, totalTables: totalTables.n,
    retard: retard.length, parType, parZone, parServeur, parCaissier, parMode, parLivreur, topPlats, parHeure, parJour, modifs: modifs.n, supprimees, alertes });
}));

// ---------------- NOTIFICATIONS ----------------
router.get('/notifications', h(async (req, res) => {
  const rows = await q('SELECT * FROM notifications WHERE utilisateur_id=? ORDER BY id DESC LIMIT 60', [req.user.id]);
  rows.forEach(r => { try { r.params = JSON.parse(r.params || '{}'); } catch { r.params = {}; } });
  res.json(rows);
}));
router.post('/notifications/lu', h(async (req, res) => {
  if (req.body.id) await q('UPDATE notifications SET lu=1 WHERE id=? AND utilisateur_id=?', [req.body.id, req.user.id]);
  else await q('UPDATE notifications SET lu=1 WHERE utilisateur_id=?', [req.user.id]);
  res.json({ ok: true });
}));

// ---------------- JOURNAL (période au choix) ----------------
router.get('/journal', need('journal.voir'), h(async (req, res) => {
  const P = periode(req);
  res.json(await q('SELECT * FROM journal WHERE created_at BETWEEN ? AND ? ORDER BY id DESC LIMIT 2000', P));
}));

// ---------------- PARAMÈTRES ----------------
const CLES_ADMIN = ['restaurant_nom', 'whatsapp_indicatif', 'retention_factures_jours', 'heure_reinitialisation', 'langue_defaut'];
const CLES_CUISINE = ['cuisine_recap_heures', 'delai_cuisine_alerte_min', 'delai_facture_rouge_min'];
router.get('/parametres', need('parametres.gerer', 'parametres.cuisine'), h(async (req, res) => {
  res.json(await params());
}));
router.put('/parametres', need('parametres.gerer', 'parametres.cuisine'), h(async (req, res) => {
  const b = req.body || {};
  for (const [k, v] of Object.entries(b)) {
    if (CLES_ADMIN.includes(k)) { if (!req.can('parametres.gerer')) fail(403, 'perm', { code: 'parametres.gerer' }); }
    else if (CLES_CUISINE.includes(k)) { if (!req.can('parametres.cuisine') && !req.can('parametres.gerer')) fail(403, 'perm', { code: 'parametres.cuisine' }); }
    else continue;
    const num = ['whatsapp_indicatif', 'retention_factures_jours', 'heure_reinitialisation', 'cuisine_recap_heures', 'delai_cuisine_alerte_min', 'delai_facture_rouge_min'];
    if (num.includes(k) && !/^\d+$/.test(String(v))) fail(400, 'valeur_invalide', { cle: k });
    if (k === 'heure_reinitialisation' && Number(v) > 23) fail(400, 'valeur_invalide', { cle: k });
    if (k === 'retention_factures_jours' && Number(v) < 30) fail(400, 'retention_min');
    if (k === 'restaurant_nom' && !String(v).trim()) fail(400, 'nom_requis');
    await setParam(k, String(v).trim().slice(0, 120));
    await log(req.user, 'PARAMETRE', k, String(v).slice(0, 120));
  }
  broadcast('config', await publicConfig());
  res.json(await params());
}));
router.post('/parametres/logo', need('parametres.gerer'), h(async (req, res) => {
  const ancien = await param('restaurant_logo', '');
  const url = saveImage(req.body.data, 'logo', 'logo');
  await setParam('restaurant_logo', url);
  deleteImage(ancien);
  await log(req.user, 'PARAMETRE', 'restaurant_logo');
  broadcast('config', await publicConfig());
  res.json({ logo: url });
}));
router.delete('/parametres/logo', need('parametres.gerer'), h(async (req, res) => {
  deleteImage(await param('restaurant_logo', ''));
  await setParam('restaurant_logo', '');
  broadcast('config', await publicConfig());
  res.json({ ok: true });
}));
// Actions manuelles (admin) : réinitialisation des commandes, purge des vieilles factures
router.post('/parametres/reinitialiser', need('parametres.gerer'), h(async (req, res) => {
  res.json(await jobs.reinitialiserCommandes(req.user));
}));
router.post('/parametres/purger', need('parametres.gerer'), h(async (req, res) => {
  res.json(await jobs.purgerFactures(req.user));
}));

async function publicConfig() {
  const p = await params();
  return {
    nom: p.restaurant_nom || 'BAB AL FKAMAH', logo: p.restaurant_logo || '', devise: p.devise || 'AED',
    indicatif: p.whatsapp_indicatif || '971', delai_rouge: Number(p.delai_facture_rouge_min || 120),
    delai_cuisine: Number(p.delai_cuisine_alerte_min || 30), recap_heures: Number(p.cuisine_recap_heures || 12),
    langue_defaut: p.langue_defaut || 'fr', heure_reinit: Number(p.heure_reinitialisation || 5)
  };
}

module.exports = router;
module.exports.publicConfig = publicConfig;
