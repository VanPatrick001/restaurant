// Factures (autonomes et conservées), encaissement Cash / Visa, livraisons, Deleted bills
const router = require('express').Router();
const { q, one, tx } = require('../db');
const { h, fail, need, notify, usersWith, broadcast, log, param } = require('../core');
const { platPrix, aed, round2, champsClient } = require('../lib');

const F_SELECT = `SELECT f.*, c.statut_cuisine, c.statut AS commande_statut, c.emplacement_id, c.prete_at,
    (SELECT COUNT(*) FROM facture_modifications m WHERE m.facture_id=f.id) AS nb_modifs,
    (SELECT COALESCE(SUM(l.quantite),0) FROM facture_lignes l WHERE l.facture_id=f.id) AS nb_articles
  FROM factures f LEFT JOIN commandes c ON c.id=f.commande_id`;

async function getFacture(id) {
  const f = await one(F_SELECT + ' WHERE f.id=?', [id]);
  if (!f) fail(404, 'facture_introuvable');
  f.lignes = await q('SELECT * FROM facture_lignes WHERE facture_id=? ORDER BY id', [id]);
  f.modifications = await q('SELECT * FROM facture_modifications WHERE facture_id=? ORDER BY id DESC', [id]);
  return f;
}
const tous = req => req.can('commande.voir_toutes') || req.can('commande.gerer_toutes');
const canSee = (req, f) => tous(req) || f.serveur_id === req.user.id || (f.livreur_id && f.livreur_id === req.user.id);

function checkEdit(req, f) {
  if (!canSee(req, f)) fail(403, 'facture_autre_serveur');
  if (f.statut === 'A_PAYER') { if (!req.can('facture.modifier')) fail(403, 'perm', { code: 'facture.modifier' }); return; }
  if (f.statut === 'PAYEE') { if (!req.can('facture.modifier_reglee')) fail(403, 'facture_reglee_protegee'); return; }
  fail(400, 'facture_non_modifiable');
}

// Recopie les lignes de la facture vers la commande (écran cuisine)
async function miroirCommande(f, ajout) {
  if (!f.commande_id) return;
  await tx(async t => {
    await t.q('DELETE FROM commande_lignes WHERE commande_id=?', [f.commande_id]);
    await t.q(`INSERT INTO commande_lignes (commande_id, plat_id, libelle, prix_unitaire, quantite, note)
               SELECT ?, plat_id, libelle, prix_unitaire, quantite, note FROM facture_lignes WHERE facture_id=?`, [f.commande_id, f.id]);
    if (ajout) await t.q("UPDATE commandes SET statut_cuisine='EN_ATTENTE', prete_at=NULL WHERE id=? AND statut_cuisine IN ('PRETE','SERVIE')", [f.commande_id]);
  });
}

// Après modification : recalcul, historique, notifications
async function apresModif(req, f, action, details, ajout = false) {
  const st = await one('SELECT COALESCE(SUM(prix_unitaire*quantite),0) AS t FROM facture_lignes WHERE facture_id=?', [f.id]);
  const nouveau = round2(Math.max(0, st.t - f.remise));
  await q('UPDATE factures SET sous_total=?, montant_total=? WHERE id=?', [round2(st.t), nouveau, f.id]);
  await q(`INSERT INTO facture_modifications (facture_id, utilisateur_id, utilisateur_nom, action, details, ancien_total, nouveau_total) VALUES (?,?,?,?,?,?,?)`,
    [f.id, req.user.id, req.user.nom_complet, action, details, f.montant_total, nouveau]);
  await log(req.user, 'FACTURE_MODIF', f.numero, `${action} : ${details}`);
  await miroirCommande(f, ajout);
  const p = { facture: f.numero, par: req.user.nom_complet, details, total: aed(nouveau) };
  const lien = `facture:${f.id}`;
  if (f.serveur_id && req.user.id !== f.serveur_id) await notify([f.serveur_id], { type: 'FACTURE_MODIFIEE', cle: 'facture_modifiee', params: p, lien });
  if (f.statut === 'A_PAYER' && !req.can('facture.payer')) {
    await notify((await usersWith('facture.payer')).filter(id => id !== req.user.id), { type: 'FACTURE_MODIFIEE', cle: 'facture_modifiee', params: p, lien });
  }
  if (f.statut === 'PAYEE' && f.caissier_id && f.caissier_id !== req.user.id) {
    await notify([f.caissier_id], { type: 'FACTURE_MODIFIEE', cle: 'facture_reglee_modifiee', params: p, lien });
  }
  broadcast('refresh', { scope: 'commandes', id: f.commande_id });
}

// ---------------- LISTE / HISTORIQUE (filtres jour, semaine, mois, 3 mois, calendrier) ----------------
router.get('/factures', need('facture.voir'), h(async (req, res) => {
  const where = [], params = [];
  if (!tous(req)) { where.push('f.serveur_id = ?'); params.push(req.user.id); }
  if (req.query.statut) { const st = String(req.query.statut).split(','); where.push(`f.statut IN (${st.map(() => '?').join(',')})`); params.push(...st); }
  else where.push("f.statut <> 'SUPPRIMEE'");
  if (req.query.du) { where.push('f.created_at >= ?'); params.push(req.query.du + ' 00:00:00'); }
  if (req.query.au) { where.push('f.created_at <= ?'); params.push(req.query.au + ' 23:59:59'); }
  if (req.query.type) { where.push('f.type_service = ?'); params.push(req.query.type); }
  if (req.query.mode) { where.push('f.mode_paiement = ?'); params.push(req.query.mode); }
  if (req.query.serveur) { where.push('f.serveur_id = ?'); params.push(Number(req.query.serveur)); }
  if (req.query.q) {
    const k = `%${req.query.q}%`;
    where.push('(f.numero LIKE ? OR f.commande_numero LIKE ? OR f.client_nom LIKE ? OR f.client_tel LIKE ? OR f.emplacement_code LIKE ? OR f.serveur_nom LIKE ? OR f.caissier_nom LIKE ?)');
    params.push(k, k, k, k, k, k, k);
  }
  const rows = await q(F_SELECT + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    " ORDER BY f.statut='A_PAYER' DESC, f.created_at DESC LIMIT " + Math.min(5000, Number(req.query.limite) || 1000), params);
  res.json(rows);
}));

router.get('/factures/:id', need('facture.voir', 'livraison.voir_disponibles', 'cuisine.voir'), h(async (req, res) => {
  const f = await getFacture(req.params.id);
  if (!canSee(req, f) && !req.can('facture.payer') && !req.can('livraison.voir_disponibles')) fail(403, 'acces_refuse');
  res.json(f);
}));

// ---------------- ARTICLES D'UNE FACTURE ----------------
router.post('/factures/:id/lignes', h(async (req, res) => {
  const f = await getFacture(req.params.id);
  checkEdit(req, f);
  const p = await platPrix(req.body.plat_id);
  const qte = Math.max(1, Number(req.body.quantite) || 1);
  const note = req.body.note ? String(req.body.note).slice(0, 200) : null;
  const ex = f.lignes.find(l => l.plat_id === p.id && !l.note && !note);
  if (ex) await q('UPDATE facture_lignes SET quantite=quantite+? WHERE id=?', [qte, ex.id]);
  else await q('INSERT INTO facture_lignes (facture_id, plat_id, libelle, prix_unitaire, quantite, note) VALUES (?,?,?,?,?,?)', [f.id, p.id, p.nom, p.prix, qte, note]);
  await apresModif(req, f, 'AJOUT', `+${qte} × ${p.nom}`, true);
  res.json(await getFacture(f.id));
}));

router.patch('/factures/:id/lignes/:lid', h(async (req, res) => {
  const f = await getFacture(req.params.id);
  checkEdit(req, f);
  const l = f.lignes.find(x => x.id === Number(req.params.lid));
  if (!l) fail(404, 'article_introuvable');
  const qte = req.body.quantite === undefined ? l.quantite : Math.max(0, Number(req.body.quantite));
  const note = req.body.note !== undefined ? (String(req.body.note).trim().slice(0, 200) || null) : l.note;
  if (qte === 0) await q('DELETE FROM facture_lignes WHERE id=?', [l.id]);
  else await q('UPDATE facture_lignes SET quantite=?, note=? WHERE id=?', [qte, note, l.id]);
  const action = qte === 0 ? 'RETRAIT' : qte !== l.quantite ? 'QUANTITE' : 'PRECISION';
  const det = action === 'PRECISION' ? `${l.libelle} : « ${note || ''} »` : `${l.libelle} : ${l.quantite} → ${qte}`;
  await apresModif(req, f, action, det, qte > l.quantite || action === 'PRECISION');
  res.json(await getFacture(f.id));
}));

router.delete('/factures/:id/lignes/:lid', h(async (req, res) => {
  const f = await getFacture(req.params.id);
  checkEdit(req, f);
  const l = f.lignes.find(x => x.id === Number(req.params.lid));
  if (!l) fail(404, 'article_introuvable');
  await q('DELETE FROM facture_lignes WHERE id=?', [l.id]);
  await apresModif(req, f, 'RETRAIT', `−${l.quantite} × ${l.libelle}`);
  res.json(await getFacture(f.id));
}));

// Informations client / commentaire (facultatifs) sur une facture déjà enregistrée
router.patch('/factures/:id', h(async (req, res) => {
  const f = await getFacture(req.params.id);
  checkEdit(req, f);
  const cl = champsClient(req.body || {}, f);
  await q(`UPDATE factures SET client_nom=?, client_tel=?, client_whatsapp=?, voiture_couleur=?, voiture_immat=?, adresse=?, localisation=?, commentaire=? WHERE id=?`,
    [cl.client_nom, cl.client_tel, cl.client_whatsapp, cl.voiture_couleur, cl.voiture_immat, cl.adresse, cl.localisation, cl.commentaire, f.id]);
  if (f.commande_id) await q(`UPDATE commandes SET client_nom=?, client_tel=?, client_whatsapp=?, voiture_couleur=?, voiture_immat=?, adresse=?, localisation=?, commentaire=? WHERE id=?`,
    [cl.client_nom, cl.client_tel, cl.client_whatsapp, cl.voiture_couleur, cl.voiture_immat, cl.adresse, cl.localisation, cl.commentaire, f.commande_id]);
  broadcast('refresh', { scope: 'commandes', id: f.commande_id });
  res.json(await getFacture(f.id));
}));

// ---------------- ENCAISSEMENT (Cash ou Visa) ----------------
router.post('/factures/:id/payer', need('facture.payer'), h(async (req, res) => {
  const f = await getFacture(req.params.id);
  if (f.statut !== 'A_PAYER') fail(400, 'facture_pas_a_payer');
  const mode = req.body.mode_paiement;
  if (!['CASH', 'VISA'].includes(mode)) fail(400, 'mode_invalide');
  const recu = mode === 'CASH' && req.body.montant_recu !== undefined && req.body.montant_recu !== '' ? round2(req.body.montant_recu) : Number(f.montant_total);
  if (recu < Number(f.montant_total)) fail(400, 'montant_insuffisant', { recu: aed(recu), total: aed(f.montant_total) });
  await tx(async t => {
    // Le nom de la personne qui encaisse est conservé sur la facture
    await t.q(`UPDATE factures SET statut='PAYEE', caissier_id=?, caissier_nom=?, mode_paiement=?, montant_recu=?, monnaie_rendue=?, payee_at=NOW() WHERE id=?`,
      [req.user.id, req.user.nom_complet, mode, recu, round2(recu - f.montant_total), f.id]);
    if (f.commande_id) await t.q("UPDATE commandes SET statut='PAYEE' WHERE id=?", [f.commande_id]);
  });
  if (f.serveur_id && f.serveur_id !== req.user.id) {
    await notify([f.serveur_id], { type: 'PAIEMENT', cle: 'facture_reglee', params: { facture: f.numero, montant: aed(f.montant_total), par: req.user.nom_complet, mode }, lien: `facture:${f.id}` });
  }
  await log(req.user, 'FACTURE_PAYEE', f.numero, `${mode} ${aed(f.montant_total)}`);
  broadcast('refresh', { scope: 'commandes', id: f.commande_id });
  res.json(await getFacture(f.id));
}));

router.post('/factures/:id/remise', need('facture.remise'), h(async (req, res) => {
  const f = await getFacture(req.params.id);
  checkEdit(req, f);
  const remise = round2(Math.max(0, Math.min(Number(req.body.remise) || 0, f.sous_total)));
  await q('UPDATE factures SET remise=? WHERE id=?', [remise, f.id]);
  await apresModif(req, { ...f, remise }, 'REMISE', `${aed(remise)}${req.body.motif ? ' (' + String(req.body.motif).slice(0, 100) + ')' : ''}`);
  res.json(await getFacture(f.id));
}));

// ---------------- SUPPRESSION → DELETED BILLS ----------------
router.delete('/factures/:id', need('facture.supprimer', 'facture.supprimer_reglee'), h(async (req, res) => {
  const f = await getFacture(req.params.id);
  if (f.statut === 'SUPPRIMEE') fail(400, 'deja_supprimee');
  if (f.statut === 'PAYEE' && !req.can('facture.supprimer_reglee')) fail(403, 'facture_reglee_manager');
  if (f.statut !== 'PAYEE' && !req.can('facture.supprimer')) fail(403, 'perm', { code: 'facture.supprimer' });
  const motif = String(req.body?.motif || '').trim().slice(0, 255) || null;
  await tx(async t => {
    await t.q(`UPDATE factures SET statut_avant_suppression=statut, statut='SUPPRIMEE', supprime_at=NOW(), supprime_par=?, supprime_par_nom=?, motif_suppression=? WHERE id=?`,
      [req.user.id, req.user.nom_complet, motif, f.id]);
    if (f.commande_id) await t.q("UPDATE commandes SET statut_avant_suppression=statut, statut='SUPPRIMEE', supprime_at=NOW(), supprime_par=?, supprime_par_nom=? WHERE id=?",
      [req.user.id, req.user.nom_complet, f.commande_id]);
  });
  const dest = [f.serveur_id, ...(await usersWith('corbeille.vider'))].filter(id => id && id !== req.user.id);
  await notify(dest, { type: 'SUPPRESSION', cle: 'element_supprime', params: { numero: f.numero, montant: aed(f.montant_total), par: req.user.nom_complet, motif: motif || '' }, lien: 'caisse:corbeille' });
  await log(req.user, 'SUPPRESSION', f.numero, `${f.statut} ${aed(f.montant_total)}${motif ? ' — ' + motif : ''}`);
  broadcast('refresh', { scope: 'commandes', id: f.commande_id });
  res.json({ ok: true });
}));

router.get('/corbeille', need('corbeille.voir'), h(async (req, res) => {
  const factures = await q(F_SELECT + " WHERE f.statut='SUPPRIMEE' ORDER BY f.supprime_at DESC LIMIT 1000");
  factures.forEach(f => { f.kind = 'facture'; f.total = Number(f.montant_total); });
  const cmds = await q(`SELECT c.*, e.code AS emplacement_code, s.nom_complet AS serveur_nom,
      (SELECT COALESCE(SUM(l.prix_unitaire*l.quantite),0) FROM commande_lignes l WHERE l.commande_id=c.id) AS total
    FROM commandes c LEFT JOIN emplacements e ON e.id=c.emplacement_id JOIN utilisateurs s ON s.id=c.serveur_id
    WHERE c.statut='SUPPRIMEE' AND NOT EXISTS (SELECT 1 FROM factures f WHERE f.commande_id=c.id) ORDER BY c.supprime_at DESC`);
  cmds.forEach(c => { c.kind = 'commande'; c.total = Number(c.total); });
  res.json([...factures, ...cmds].sort((a, b) => new Date(b.supprime_at) - new Date(a.supprime_at)));
}));

router.post('/corbeille/:kind/:id/restaurer', need('corbeille.restaurer'), h(async (req, res) => {
  const { kind, id } = req.params;
  if (kind === 'facture') {
    const f = await one("SELECT * FROM factures WHERE id=? AND statut='SUPPRIMEE'", [id]);
    if (!f) fail(404, 'introuvable_corbeille');
    await q(`UPDATE factures SET statut=COALESCE(statut_avant_suppression,'A_PAYER'), statut_avant_suppression=NULL, supprime_at=NULL, supprime_par=NULL,
             supprime_par_nom=NULL, motif_suppression=NULL WHERE id=?`, [f.id]);
    if (f.commande_id) await q("UPDATE commandes SET statut=COALESCE(statut_avant_suppression,'VALIDEE'), statut_avant_suppression=NULL, supprime_at=NULL WHERE id=?", [f.commande_id]);
    await log(req.user, 'RESTAURATION', f.numero);
  } else {
    const c = await one("SELECT * FROM commandes WHERE id=? AND statut='SUPPRIMEE'", [id]);
    if (!c) fail(404, 'introuvable_corbeille');
    await q(`UPDATE commandes SET statut=COALESCE(statut_avant_suppression,'BROUILLON'), statut_avant_suppression=NULL, supprime_at=NULL, supprime_par=NULL,
             supprime_par_nom=NULL, motif_suppression=NULL WHERE id=?`, [c.id]);
    await log(req.user, 'RESTAURATION', c.numero);
  }
  broadcast('refresh', { scope: 'commandes' });
  res.json({ ok: true });
}));

// Suppression définitive : manager uniquement (corbeille.vider)
router.delete('/corbeille/:kind/:id', need('corbeille.vider'), h(async (req, res) => {
  const { kind, id } = req.params;
  const r = kind === 'facture'
    ? await q("DELETE FROM factures WHERE id=? AND statut='SUPPRIMEE'", [id])
    : await q("DELETE FROM commandes WHERE id=? AND statut='SUPPRIMEE'", [id]);
  if (!r.affectedRows) fail(404, 'introuvable_corbeille');
  await log(req.user, 'SUPPRESSION_DEFINITIVE', `${kind} #${id}`);
  broadcast('refresh', { scope: 'commandes' });
  res.json({ ok: true });
}));
router.delete('/corbeille', need('corbeille.vider'), h(async (req, res) => {
  const a = await q("DELETE FROM factures WHERE statut='SUPPRIMEE'");
  const b = await q("DELETE FROM commandes WHERE statut='SUPPRIMEE'");
  await log(req.user, 'CORBEILLE_VIDEE', 'Deleted bills', `${a.affectedRows + b.affectedRows}`);
  broadcast('refresh', { scope: 'commandes' });
  res.json({ ok: true, supprimes: a.affectedRows + b.affectedRows });
}));

// ---------------- LIVRAISONS ----------------
const L_SELECT = F_SELECT.replace('FROM factures f', `,
    (SELECT GROUP_CONCAT(CONCAT(l.quantite,'× ',l.libelle) SEPARATOR ', ') FROM facture_lignes l WHERE l.facture_id=f.id) AS resume
  FROM factures f`);

router.get('/livraisons', need('livraison.voir_disponibles', 'livraison.voir'), h(async (req, res) => {
  const onglet = req.query.onglet || 'disponibles';
  const base = "f.type_service='LIVRAISON' AND f.statut IN ('A_PAYER','PAYEE')";
  let rows;
  if (onglet === 'disponibles') rows = await q(L_SELECT + ` WHERE ${base} AND f.statut_livraison='DISPONIBLE' ORDER BY f.created_at`);
  else if (onglet === 'miennes') rows = await q(L_SELECT + ` WHERE ${base} AND f.livreur_id=? AND f.statut_livraison IN ('ACCEPTEE','EN_ROUTE') ORDER BY f.livraison_acceptee_at`, [req.user.id]);
  else if (onglet === 'livrees') rows = await q(L_SELECT + ` WHERE ${base} AND f.livreur_id=? AND f.statut_livraison='LIVREE' AND f.livree_at >= NOW() - INTERVAL 24 HOUR ORDER BY f.livree_at DESC`, [req.user.id]);
  else { // toutes (vue caissier / patron)
    if (!req.can('livraison.voir')) fail(403, 'perm', { code: 'livraison.voir' });
    rows = await q(L_SELECT + ` WHERE ${base} AND f.created_at >= NOW() - INTERVAL 24 HOUR ORDER BY f.statut_livraison='LIVREE', f.created_at DESC`);
  }
  const compte = await one(`SELECT
      SUM(f.statut_livraison='DISPONIBLE') AS disponibles,
      SUM(f.livreur_id=? AND f.statut_livraison IN ('ACCEPTEE','EN_ROUTE')) AS miennes,
      SUM(f.livreur_id=? AND f.statut_livraison='LIVREE' AND f.livree_at >= NOW() - INTERVAL 24 HOUR) AS livrees
    FROM factures f WHERE ${base}`, [req.user.id, req.user.id]);
  res.json({ livraisons: rows, compte, indicatif: await param('whatsapp_indicatif', '971') });
}));

async function getLivraison(id) {
  const f = await one("SELECT * FROM factures WHERE id=? AND type_service='LIVRAISON'", [id]);
  if (!f) fail(404, 'livraison_introuvable');
  if (!['A_PAYER', 'PAYEE'].includes(f.statut)) fail(400, 'livraison_indisponible');
  return f;
}

router.post('/livraisons/:id/accepter', need('livraison.accepter'), h(async (req, res) => {
  const f = await getLivraison(req.params.id);
  const r = await q(`UPDATE factures SET livreur_id=?, livreur_nom=?, statut_livraison='ACCEPTEE', livraison_acceptee_at=NOW()
                     WHERE id=? AND statut_livraison='DISPONIBLE'`, [req.user.id, req.user.nom_complet, f.id]);
  if (!r.affectedRows) fail(409, 'livraison_deja_prise');
  const dest = [f.serveur_id, ...(await usersWith('livraison.assigner'))].filter(id => id && id !== req.user.id);
  await notify(dest, { type: 'LIVRAISON', cle: 'livraison_acceptee', params: { numero: f.commande_numero, livreur: req.user.nom_complet }, lien: `facture:${f.id}` });
  await log(req.user, 'LIVRAISON_ACCEPTEE', f.numero);
  broadcast('refresh', { scope: 'livraisons' });
  res.json({ ok: true });
}));

router.post('/livraisons/:id/en-route', need('livraison.marquer_livree'), h(async (req, res) => {
  const f = await getLivraison(req.params.id);
  if (f.livreur_id !== req.user.id) fail(403, 'livraison_pas_a_vous');
  await q("UPDATE factures SET statut_livraison='EN_ROUTE' WHERE id=?", [f.id]);
  if (f.commande_id) await q("UPDATE commandes SET statut_cuisine='SERVIE' WHERE id=?", [f.commande_id]);
  broadcast('refresh', { scope: 'livraisons' });
  res.json({ ok: true });
}));

router.post('/livraisons/:id/livree', need('livraison.marquer_livree', 'livraison.assigner'), h(async (req, res) => {
  const f = await getLivraison(req.params.id);
  if (f.livreur_id !== req.user.id && !req.can('livraison.assigner')) fail(403, 'livraison_pas_a_vous');
  if (!f.livreur_id) fail(400, 'livraison_non_assignee');
  await q("UPDATE factures SET statut_livraison='LIVREE', livree_at=NOW() WHERE id=?", [f.id]);
  if (f.commande_id) await q("UPDATE commandes SET statut_cuisine='SERVIE' WHERE id=?", [f.commande_id]);
  const dest = [f.serveur_id, ...(await usersWith('facture.payer'))].filter(id => id && id !== req.user.id);
  await notify(dest, { type: 'LIVRAISON', cle: 'livraison_effectuee', params: { numero: f.commande_numero, livreur: f.livreur_nom, montant: aed(f.montant_total), paye: f.statut === 'PAYEE' ? 1 : 0 }, lien: `facture:${f.id}` });
  await log(req.user, 'LIVRAISON_EFFECTUEE', f.numero, f.livreur_nom);
  broadcast('refresh', { scope: 'livraisons' });
  res.json({ ok: true });
}));

// Le livreur ne peut pas se retirer une livraison : caissier, patron et admin seulement
router.post('/livraisons/:id/retirer', need('livraison.retirer'), h(async (req, res) => {
  const f = await getLivraison(req.params.id);
  if (!f.livreur_id) fail(400, 'livraison_non_assignee');
  await q("UPDATE factures SET livreur_id=NULL, livreur_nom=NULL, statut_livraison='DISPONIBLE', livraison_acceptee_at=NULL WHERE id=?", [f.id]);
  await notify([f.livreur_id], { type: 'LIVRAISON', cle: 'livraison_retiree', params: { numero: f.commande_numero, par: req.user.nom_complet }, lien: 'livraisons' });
  await notify((await usersWith('livraison.accepter')).filter(id => id !== f.livreur_id), { type: 'LIVRAISON', cle: 'livraison_nouvelle', params: { numero: f.commande_numero, adresse: f.adresse || '' }, lien: 'livraisons', son: 'livraison' });
  await log(req.user, 'LIVRAISON_RETIREE', f.numero, f.livreur_nom);
  broadcast('refresh', { scope: 'livraisons' });
  res.json({ ok: true });
}));

router.post('/livraisons/:id/assigner', need('livraison.assigner'), h(async (req, res) => {
  const f = await getLivraison(req.params.id);
  const u = await one('SELECT id, nom_complet FROM utilisateurs WHERE id=? AND actif=1 AND supprime_at IS NULL', [req.body.livreur_id]);
  if (!u) fail(400, 'livreur_introuvable');
  await q("UPDATE factures SET livreur_id=?, livreur_nom=?, statut_livraison='ACCEPTEE', livraison_acceptee_at=NOW() WHERE id=?", [u.id, u.nom_complet, f.id]);
  await notify([u.id], { type: 'LIVRAISON', cle: 'livraison_assignee', params: { numero: f.commande_numero, adresse: f.adresse || '', par: req.user.nom_complet }, lien: 'livraisons', son: 'livraison' });
  if (f.livreur_id && f.livreur_id !== u.id) await notify([f.livreur_id], { type: 'LIVRAISON', cle: 'livraison_retiree', params: { numero: f.commande_numero, par: req.user.nom_complet }, lien: 'livraisons' });
  await log(req.user, 'LIVRAISON_ASSIGNEE', f.numero, u.nom_complet);
  broadcast('refresh', { scope: 'livraisons' });
  res.json({ ok: true });
}));

router.get('/livreurs', need('livraison.assigner'), h(async (req, res) => {
  res.json(await q(`SELECT u.id, u.nom_complet, u.photo, u.telephone,
      (SELECT COUNT(*) FROM factures f WHERE f.livreur_id=u.id AND f.statut_livraison IN ('ACCEPTEE','EN_ROUTE')) AS en_cours
    FROM utilisateurs u JOIN roles r ON r.id=u.role_id WHERE r.code='LIVREUR' AND u.actif=1 AND u.supprime_at IS NULL ORDER BY en_cours, u.nom_complet`));
}));

module.exports = router;
