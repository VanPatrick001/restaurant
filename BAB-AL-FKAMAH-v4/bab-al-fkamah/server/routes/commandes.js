// Commandes du service (brouillons, validation → facture), cuisine, récapitulatif
const router = require('express').Router();
const { q, one, tx } = require('../db');
const { h, fail, need, notify, usersWith, usersWithRole, broadcast, log, param, permissionsOf } = require('../core');
const { platPrix, aed, round2, debutService, champsClient } = require('../lib');

const TYPES = ['SUR_PLACE', 'EMPORTER', 'LIVRAISON'];

const CMD_SELECT = `
  SELECT c.*, e.code AS emplacement, z.nom AS zone, s.nom_complet AS serveur_nom,
    f.id AS facture_id, f.numero AS facture_numero, f.statut AS facture_statut, f.montant_total, f.remise,
    f.created_at AS facture_at, f.caissier_nom, f.livreur_id, f.livreur_nom, f.statut_livraison,
    (SELECT COALESCE(SUM(l.prix_unitaire*l.quantite),0) FROM commande_lignes l WHERE l.commande_id=c.id) AS sous_total,
    (SELECT COALESCE(SUM(l.quantite),0) FROM commande_lignes l WHERE l.commande_id=c.id) AS nb_articles
  FROM commandes c
  LEFT JOIN emplacements e ON e.id = c.emplacement_id
  LEFT JOIN zones z ON z.id = e.zone_id
  JOIN utilisateurs s ON s.id = c.serveur_id
  LEFT JOIN factures f ON f.commande_id = c.id AND f.statut <> 'SUPPRIMEE'`;

const total = c => (c.facture_id ? Number(c.montant_total) : round2(c.sous_total));

async function getCommande(id) {
  const c = await one(CMD_SELECT + ' WHERE c.id = ?', [id]);
  if (!c) fail(404, 'commande_introuvable');
  c.lignes = await q('SELECT * FROM commande_lignes WHERE commande_id = ? ORDER BY id', [id]);
  c.total = total(c);
  return c;
}

const gereTout = req => req.can('commande.gerer_toutes');
const canSee = (req, c) => req.can('commande.voir_toutes') || gereTout(req) || c.serveur_id === req.user.id;

async function serveurCible(req, id) {
  if (!id || Number(id) === req.user.id) return req.user.id;
  if (!gereTout(req)) fail(403, 'manager_seul_attribuer');
  const u = await one('SELECT id FROM utilisateurs WHERE id=? AND actif=1 AND supprime_at IS NULL', [id]);
  if (!u) fail(400, 'serveur_introuvable');
  return u.id;
}

// Brouillon uniquement : le contenu d'une commande validée se modifie sur sa facture
function checkBrouillon(req, c, kind) {
  if (!canSee(req, c)) fail(403, 'commande_autre_serveur');
  if (c.statut === 'SUPPRIMEE') fail(400, 'commande_supprimee');
  if (c.statut === 'ANNULEE') fail(400, 'commande_annulee');
  if (c.statut !== 'BROUILLON') fail(409, 'commande_deja_validee', { facture: c.facture_numero || '' });
  const code = kind === 'add' ? 'commande.ajouter_article' : 'commande.retirer_article';
  if (!req.can(code)) fail(403, 'perm', { code });
}

async function tableLibre(emplacementId, saufId = 0) {
  if (!emplacementId) return;
  const o = await one(`SELECT c.id, c.numero FROM commandes c WHERE c.emplacement_id=? AND c.id<>? AND c.statut IN ('BROUILLON','VALIDEE')`, [emplacementId, saufId]);
  if (o) fail(409, 'table_occupee', { numero: o.numero });
}

// Numéro du jour (#1, #2…) depuis la dernière réinitialisation
async function numeroDuJour(t) {
  const debut = await debutService();
  const r = await t.one('SELECT COUNT(*) AS n FROM commandes WHERE created_at >= ?', [debut]);
  return '#' + (r.n + 1);
}

// ---------------- LISTE (service en cours) ----------------
router.get('/commandes', need('commande.voir_miennes', 'commande.voir_toutes', 'livraison.voir'), h(async (req, res) => {
  const where = ["c.statut <> 'SUPPRIMEE'"], params = [];
  const tous = req.can('commande.voir_toutes') || gereTout(req);
  const emportLivr = req.query.type && req.query.type !== 'SUR_PLACE' && req.can('livraison.voir');
  if ((!tous && !emportLivr) || req.query.miennes === '1') { where.push('c.serveur_id = ?'); params.push(req.user.id); }
  if (req.query.statut) { const st = String(req.query.statut).split(','); where.push(`c.statut IN (${st.map(() => '?').join(',')})`); params.push(...st); }
  if (req.query.type) { where.push('c.type_service = ?'); params.push(req.query.type); }
  const rows = await q(CMD_SELECT + ' WHERE ' + where.join(' AND ') + ' ORDER BY c.created_at DESC LIMIT 500', params);
  rows.forEach(r => { r.total = total(r); });
  res.json(rows);
}));

router.get('/commandes/:id', need('commande.voir_miennes', 'commande.voir_toutes', 'facture.voir', 'cuisine.voir'), h(async (req, res) => {
  const c = await getCommande(req.params.id);
  if (!canSee(req, c) && !req.can('cuisine.voir') && !req.can('facture.payer')) fail(403, 'acces_refuse');
  res.json(c);
}));

// ---------------- CRÉATION (les plats d'abord, les infos client ensuite et facultatives) ----------------
router.post('/commandes', need('commande.creer'), h(async (req, res) => {
  const b = req.body || {};
  const type = TYPES.includes(b.type_service) ? b.type_service : 'SUR_PLACE';
  const emplacement_id = type === 'SUR_PLACE' ? Number(b.emplacement_id) || null : null;
  await tableLibre(emplacement_id);
  const serveurId = await serveurCible(req, b.serveur_id);
  const cl = champsClient(b);
  const lignes = Array.isArray(b.lignes) ? b.lignes : [];
  const prix = [];
  for (const l of lignes) prix.push({ ...(await platPrix(l.plat_id)), quantite: Math.max(1, Number(l.quantite) || 1), note: l.note ? String(l.note).slice(0, 200) : null });
  const id = await tx(async t => {
    const numero = await numeroDuJour(t);
    const r = await t.q(`INSERT INTO commandes (numero, type_service, emplacement_id, nb_couverts, client_nom, client_tel, client_whatsapp,
        voiture_couleur, voiture_immat, adresse, localisation, commentaire, serveur_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [numero, type, emplacement_id, Number(b.nb_couverts) || null, cl.client_nom, cl.client_tel, cl.client_whatsapp, cl.voiture_couleur,
      cl.voiture_immat, cl.adresse, cl.localisation, cl.commentaire, serveurId]);
    for (const p of prix) {
      await t.q('INSERT INTO commande_lignes (commande_id, plat_id, libelle, prix_unitaire, quantite, note, ajoute_par) VALUES (?,?,?,?,?,?,?)',
        [r.insertId, p.id, p.nom, p.prix, p.quantite, p.note, req.user.id]);
    }
    return r.insertId;
  });
  const c = await getCommande(id);
  await log(req.user, 'COMMANDE_CREEE', c.numero, type + (serveurId !== req.user.id ? ` → ${c.serveur_nom}` : ''));
  if (serveurId !== req.user.id) await notify([serveurId], { type: 'COMMANDE', cle: 'commande_pour_vous', params: { numero: c.numero, par: req.user.nom_complet }, lien: `commande:${id}` });
  broadcast('refresh', { scope: 'commandes' });
  res.status(201).json(c);
}));

// Informations : service, table, couverts, client (facultatif), commentaire, serveur
router.patch('/commandes/:id', h(async (req, res) => {
  const c = await getCommande(req.params.id);
  const b = req.body || {};
  if (['SUPPRIMEE', 'ANNULEE'].includes(c.statut)) fail(400, 'commande_supprimee');
  if (!canSee(req, c)) fail(403, 'commande_autre_serveur');
  const peutInfos = c.statut === 'BROUILLON' ? req.can('commande.ajouter_article') || req.can('commande.creer')
    : c.facture_statut === 'PAYEE' ? req.can('facture.modifier_reglee') : req.can('facture.modifier') || req.can('commande.creer');
  if (!peutInfos) fail(403, 'perm', { code: 'facture.modifier' });
  let serveurId = c.serveur_id;
  if (b.serveur_id && Number(b.serveur_id) !== c.serveur_id) {
    if (!gereTout(req)) fail(403, 'manager_seul_attribuer');
    serveurId = await serveurCible(req, b.serveur_id);
  }
  const type = c.statut === 'BROUILLON' && TYPES.includes(b.type_service) ? b.type_service : c.type_service;
  let emplacement_id = type === 'SUR_PLACE' ? (b.emplacement_id !== undefined ? Number(b.emplacement_id) || null : c.emplacement_id) : null;
  if (emplacement_id !== c.emplacement_id) await tableLibre(emplacement_id, c.id);
  const cl = champsClient(b, c);
  await q(`UPDATE commandes SET type_service=?, emplacement_id=?, nb_couverts=?, client_nom=?, client_tel=?, client_whatsapp=?, voiture_couleur=?,
           voiture_immat=?, adresse=?, localisation=?, commentaire=?, serveur_id=? WHERE id=?`,
  [type, emplacement_id, b.nb_couverts !== undefined ? Number(b.nb_couverts) || null : c.nb_couverts, cl.client_nom, cl.client_tel, cl.client_whatsapp,
    cl.voiture_couleur, cl.voiture_immat, cl.adresse, cl.localisation, cl.commentaire, serveurId, c.id]);
  if (c.facture_id) {
    const e = emplacement_id ? await one('SELECT e.code, z.nom FROM emplacements e JOIN zones z ON z.id=e.zone_id WHERE e.id=?', [emplacement_id]) : null;
    const sn = serveurId !== c.serveur_id ? (await one('SELECT nom_complet FROM utilisateurs WHERE id=?', [serveurId])).nom_complet : null;
    await q(`UPDATE factures SET emplacement_code=?, zone_nom=?, client_nom=?, client_tel=?, client_whatsapp=?, voiture_couleur=?, voiture_immat=?,
             adresse=?, localisation=?, commentaire=? ${sn ? ', serveur_id=?, serveur_nom=?' : ''} WHERE id=?`,
    [e?.code || null, e?.nom || null, cl.client_nom, cl.client_tel, cl.client_whatsapp, cl.voiture_couleur, cl.voiture_immat, cl.adresse,
      cl.localisation, cl.commentaire, ...(sn ? [serveurId, sn] : []), c.facture_id]);
  }
  if (serveurId !== c.serveur_id) {
    await log(req.user, 'COMMANDE_REATTRIBUEE', c.numero, `${c.serveur_nom} → #${serveurId}`);
    await notify([serveurId, c.serveur_id], { type: 'COMMANDE', cle: 'commande_reattribuee', params: { numero: c.numero, par: req.user.nom_complet }, lien: `commande:${c.id}` });
  }
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json(await getCommande(c.id));
}));

// ---------------- ARTICLES (brouillon) ----------------
router.post('/commandes/:id/lignes', h(async (req, res) => {
  const c = await getCommande(req.params.id);
  checkBrouillon(req, c, 'add');
  const p = await platPrix(req.body.plat_id);
  const qte = Math.max(1, Number(req.body.quantite) || 1);
  const note = req.body.note ? String(req.body.note).slice(0, 200) : null;
  const existante = c.lignes.find(l => l.plat_id === p.id && !l.note && !note);
  if (existante) await q('UPDATE commande_lignes SET quantite = quantite + ? WHERE id = ?', [qte, existante.id]);
  else await q('INSERT INTO commande_lignes (commande_id, plat_id, libelle, prix_unitaire, quantite, note, ajoute_par) VALUES (?,?,?,?,?,?,?)',
    [c.id, p.id, p.nom, p.prix, qte, note, req.user.id]);
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json(await getCommande(c.id));
}));

router.patch('/commandes/:id/lignes/:ligneId', h(async (req, res) => {
  const c = await getCommande(req.params.id);
  const l = c.lignes.find(x => x.id === Number(req.params.ligneId));
  if (!l) fail(404, 'article_introuvable');
  const qte = req.body.quantite === undefined ? l.quantite : Math.max(0, Number(req.body.quantite));
  checkBrouillon(req, c, qte > l.quantite ? 'add' : 'remove');
  if (qte === 0) await q('DELETE FROM commande_lignes WHERE id = ?', [l.id]);
  else await q('UPDATE commande_lignes SET quantite = ?, note = ? WHERE id = ?',
    [qte, req.body.note !== undefined ? (String(req.body.note).trim().slice(0, 200) || null) : l.note, l.id]);
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json(await getCommande(c.id));
}));

router.delete('/commandes/:id/lignes/:ligneId', h(async (req, res) => {
  const c = await getCommande(req.params.id);
  const l = c.lignes.find(x => x.id === Number(req.params.ligneId));
  if (!l) fail(404, 'article_introuvable');
  checkBrouillon(req, c, 'remove');
  await q('DELETE FROM commande_lignes WHERE id = ?', [l.id]);
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json(await getCommande(c.id));
}));

// ---------------- VALIDATION → FACTURE ----------------
router.post('/commandes/:id/valider', need('commande.valider'), h(async (req, res) => {
  const c = await getCommande(req.params.id);
  if (!canSee(req, c)) fail(403, 'commande_autre_serveur');
  if (c.statut !== 'BROUILLON') fail(409, 'commande_deja_validee', { facture: c.facture_numero || '' });
  if (!c.lignes.length) fail(400, 'commande_vide');
  if (c.type_service === 'SUR_PLACE' && !c.emplacement_id) fail(400, 'table_requise');
  const fid = await tx(async t => {
    await t.q("UPDATE commandes SET statut='VALIDEE', validee_at=NOW(), statut_cuisine='EN_ATTENTE', alerte_cuisine=0 WHERE id=?", [c.id]);
    const st = round2(c.sous_total);
    const r = await t.q(`INSERT INTO factures (numero, commande_id, commande_numero, type_service, emplacement_code, zone_nom, nb_couverts,
        client_nom, client_tel, client_whatsapp, voiture_couleur, voiture_immat, adresse, localisation, commentaire,
        sous_total, montant_total, statut, serveur_id, serveur_nom, statut_livraison)
      VALUES ('TMP',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'A_PAYER',?,?,?)`,
    [c.id, c.numero, c.type_service, c.emplacement, c.zone, c.nb_couverts, c.client_nom, c.client_tel, c.client_whatsapp,
      c.voiture_couleur, c.voiture_immat, c.adresse, c.localisation, c.commentaire, st, st, c.serveur_id, c.serveur_nom,
      c.type_service === 'LIVRAISON' ? 'DISPONIBLE' : null]);
    await t.q('UPDATE factures SET numero=? WHERE id=?', ['FAC-' + String(r.insertId).padStart(6, '0'), r.insertId]);
    for (const l of c.lignes) {
      await t.q('INSERT INTO facture_lignes (facture_id, plat_id, libelle, prix_unitaire, quantite, note) VALUES (?,?,?,?,?,?)',
        [r.insertId, l.plat_id, l.libelle, l.prix_unitaire, l.quantite, l.note]);
    }
    return r.insertId;
  });
  const f = await one('SELECT numero, montant_total FROM factures WHERE id=?', [fid]);
  const lieu = c.type_service === 'SUR_PLACE' ? c.emplacement : c.type_service;
  const p = { facture: f.numero, numero: c.numero, lieu, montant: aed(f.montant_total), serveur: c.serveur_nom, n: c.nb_articles };
  await notify(await usersWith('facture.payer'), { type: 'FACTURE', cle: 'facture_nouvelle', params: p, lien: `facture:${fid}` });
  await notify(await usersWith('cuisine.statut'), { type: 'CUISINE', cle: 'cuisine_nouvelle', params: p, lien: 'cuisine' });
  if (c.type_service === 'LIVRAISON') {
    await notify(await usersWith('livraison.accepter'), { type: 'LIVRAISON', cle: 'livraison_nouvelle', params: { ...p, adresse: c.adresse || '' }, lien: 'livraisons', son: 'livraison' });
  }
  await log(req.user, 'COMMANDE_VALIDEE', c.numero, `${f.numero} ${aed(f.montant_total)}`);
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json({ ...(await getCommande(c.id)), facture_id: fid });
}));

router.post('/commandes/:id/annuler', need('commande.annuler'), h(async (req, res) => {
  const c = await getCommande(req.params.id);
  if (!canSee(req, c)) fail(403, 'commande_autre_serveur');
  if (c.statut !== 'BROUILLON') fail(409, 'commande_deja_validee', { facture: c.facture_numero || '' });
  await q("UPDATE commandes SET statut='ANNULEE' WHERE id=?", [c.id]);
  await log(req.user, 'COMMANDE_ANNULEE', c.numero, req.body?.motif || '');
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json({ ok: true });
}));

// Suppression d'un brouillon → Deleted bills (jusqu'à la réinitialisation du matin)
router.delete('/commandes/:id', need('commande.supprimer'), h(async (req, res) => {
  const c = await getCommande(req.params.id);
  if (!['BROUILLON', 'ANNULEE'].includes(c.statut)) fail(409, 'supprimer_via_facture', { facture: c.facture_numero || '' });
  if (c.serveur_id !== req.user.id && !gereTout(req)) fail(403, 'supprimer_serveur_ou_manager');
  const motif = String(req.body?.motif || '').trim().slice(0, 255) || null;
  await q(`UPDATE commandes SET statut_avant_suppression=statut, statut='SUPPRIMEE', supprime_at=NOW(), supprime_par=?, supprime_par_nom=?, motif_suppression=? WHERE id=?`,
    [req.user.id, req.user.nom_complet, motif, c.id]);
  const dest = [c.serveur_id, ...(await usersWith('corbeille.vider'))].filter(id => id !== req.user.id);
  await notify(dest, { type: 'SUPPRESSION', cle: 'element_supprime', params: { numero: c.numero, montant: aed(c.total), par: req.user.nom_complet, motif: motif || '' }, lien: 'caisse:corbeille' });
  await log(req.user, 'SUPPRESSION', c.numero, `${aed(c.total)}${motif ? ' — ' + motif : ''}`);
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json({ ok: true });
}));

router.get('/serveurs', need('commande.gerer_toutes'), h(async (req, res) => {
  const users = await q(`SELECT u.id, u.nom_complet, u.photo, r.code AS role, r.libelle AS role_libelle FROM utilisateurs u JOIN roles r ON r.id=u.role_id
                         WHERE u.actif=1 AND u.supprime_at IS NULL ORDER BY r.code='SERVEUR' DESC, u.nom_complet`);
  const out = [];
  for (const u of users) if ((await permissionsOf(u.id, u.role)).includes('commande.creer')) out.push(u);
  res.json(out);
}));

// ---------------- CUISINE ----------------
router.get('/cuisine', need('cuisine.voir'), h(async (req, res) => {
  const rows = await q(CMD_SELECT + ` WHERE c.statut IN ('VALIDEE','PAYEE') AND c.statut_cuisine <> 'SERVIE' ORDER BY c.validee_at ASC`);
  for (const r of rows) {
    r.lignes = await q(`SELECT l.plat_id, l.libelle, l.quantite, l.note, p.temps_preparation FROM commande_lignes l
                        LEFT JOIN plats p ON p.id=l.plat_id WHERE l.commande_id=? ORDER BY l.id`, [r.id]);
    r.temps_prevu = Math.max(0, ...r.lignes.map(l => l.temps_preparation || 0));
  }
  res.json({ commandes: rows, delai: Number(await param('delai_cuisine_alerte_min', 30)) });
}));

// Récapitulatif des N dernières heures (12 h par défaut, réglable par l'admin et le patron)
router.get('/cuisine/recap', need('cuisine.recap', 'cuisine.voir'), h(async (req, res) => {
  const heures = Math.max(1, Math.min(72, Number(req.query.heures) || Number(await param('cuisine_recap_heures', 12))));
  const cmds = await q(CMD_SELECT + ` WHERE c.statut IN ('VALIDEE','PAYEE') AND c.validee_at >= NOW() - INTERVAL ? HOUR ORDER BY c.validee_at DESC`, [heures]);
  for (const r of cmds) r.lignes = await q('SELECT plat_id, libelle, quantite, note FROM commande_lignes WHERE commande_id=?', [r.id]);
  const articles = await q(`SELECT l.plat_id, l.libelle, SUM(l.quantite) AS quantite FROM commande_lignes l JOIN commandes c ON c.id=l.commande_id
      WHERE c.statut IN ('VALIDEE','PAYEE') AND c.validee_at >= NOW() - INTERVAL ? HOUR GROUP BY l.plat_id, l.libelle ORDER BY quantite DESC`, [heures]);
  const duree = await one(`SELECT AVG(TIMESTAMPDIFF(MINUTE, validee_at, prete_at)) AS m FROM commandes WHERE prete_at IS NOT NULL AND validee_at >= NOW() - INTERVAL ? HOUR`, [heures]);
  res.json({ heures, commandes: cmds, articles, duree_moyenne: duree?.m ? Math.round(duree.m) : null });
}));

router.patch('/commandes/:id/cuisine', h(async (req, res) => {
  const c = await getCommande(req.params.id);
  const s = req.body.statut_cuisine;
  if (!['EN_ATTENTE', 'EN_PREPARATION', 'PRETE', 'SERVIE'].includes(s)) fail(400, 'statut_invalide');
  const ok = req.can('cuisine.statut') || (s === 'SERVIE' && req.can('commande.marquer_servie') && canSee(req, c));
  if (!ok) fail(403, 'perm', { code: 'cuisine.statut' });
  await q(`UPDATE commandes SET statut_cuisine=? ${s === 'PRETE' ? ', prete_at=NOW()' : ''} WHERE id=?`, [s, c.id]);
  if (s === 'PRETE') {
    const lieu = c.type_service === 'SUR_PLACE' ? c.emplacement : (c.client_nom || c.voiture_immat || c.type_service);
    const p = { numero: c.numero, lieu };
    await notify([c.serveur_id], { type: 'CUISINE', cle: 'commande_prete', params: p, lien: c.facture_id ? `facture:${c.facture_id}` : `commande:${c.id}`, son: 'pret' });
    if (c.type_service === 'LIVRAISON') {
      const dest = c.livreur_id ? [c.livreur_id] : await usersWith('livraison.accepter');
      await notify(dest, { type: 'LIVRAISON', cle: 'livraison_prete', params: { ...p, adresse: c.adresse || '' }, lien: 'livraisons', son: 'livraison' });
    }
  }
  broadcast('refresh', { scope: 'commandes', id: c.id });
  res.json({ ok: true });
}));

module.exports = router;
module.exports.getCommande = getCommande;
