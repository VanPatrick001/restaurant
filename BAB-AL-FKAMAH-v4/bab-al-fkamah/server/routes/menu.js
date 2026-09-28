// Menu : catégories (prix commun), plats (traductions, photos), menus composés, classement intelligent
const router = require('express').Router();
const { q, one, tx } = require('../db');
const { h, fail, need, broadcast, log } = require('../core');
const { saveImage, deleteImage } = require('../lib');

const parse = s => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const trad = (b, base = {}) => {
  const t = { ...base };
  for (const l of ['fr', 'en', 'ar']) if (b?.[l] !== undefined) t[l] = String(b[l]).trim().slice(0, 120);
  return JSON.stringify(t);
};

// Carte complète + score d'usage : popularité récente (décroissance 14 j) + habitudes du serveur + heure de la journée
router.get('/menu', need('menu.voir', 'commande.creer', 'facture.voir'), h(async (req, res) => {
  const categories = (await q('SELECT * FROM categories ORDER BY ordre, nom')).map(c => ({ ...c, traductions: parse(c.traductions) }));
  const plats = await q(`SELECT p.*, c.prix_defaut, COALESCE(p.prix, c.prix_defaut) AS prix_carte, (p.prix IS NOT NULL) AS prix_perso,
      mp.prix_special, (mp.plat_id IS NOT NULL) AS du_jour
    FROM plats p JOIN categories c ON c.id=p.categorie_id
    LEFT JOIN menus m ON m.est_du_jour = 1 LEFT JOIN menu_plats mp ON mp.menu_id = m.id AND mp.plat_id = p.id
    ORDER BY c.ordre, p.id`);
  const usage = await q(`SELECT l.plat_id,
      SUM(l.quantite * EXP(-TIMESTAMPDIFF(HOUR, f.created_at, NOW()) / 336)) AS pop,
      SUM(CASE WHEN f.serveur_id = ? THEN l.quantite * EXP(-TIMESTAMPDIFF(HOUR, f.created_at, NOW()) / 336) ELSE 0 END) AS perso,
      SUM(CASE WHEN ABS(HOUR(f.created_at) - HOUR(NOW())) <= 1 THEN l.quantite ELSE 0 END) AS heure,
      SUM(CASE WHEN f.created_at >= NOW() - INTERVAL 30 DAY THEN l.quantite ELSE 0 END) AS qte30
    FROM facture_lignes l JOIN factures f ON f.id = l.facture_id
    WHERE f.created_at >= NOW() - INTERVAL 60 DAY AND f.statut <> 'SUPPRIMEE' AND l.plat_id IS NOT NULL GROUP BY l.plat_id`, [req.user.id]);
  const u = Object.fromEntries(usage.map(r => [r.plat_id, r]));
  const max = k => Math.max(1, ...usage.map(r => Number(r[k]) || 0));
  const [mp, ms, mh] = [max('pop'), max('perso'), max('heure')];
  for (const p of plats) {
    const r = u[p.id] || {};
    p.traductions = parse(p.traductions);
    p.du_jour = !!p.du_jour; p.disponible = !!p.disponible; p.prix_perso = !!p.prix_perso;
    p.prix_effectif = p.du_jour && p.prix_special != null ? Number(p.prix_special) : Number(p.prix_carte);
    p.ventes_30j = Number(r.qte30) || 0;
    p.score = Math.round(100 * ((Number(r.pop) || 0) / mp + 0.6 * (Number(r.perso) || 0) / ms + 0.4 * (Number(r.heure) || 0) / mh)) / 100;
  }
  res.json({ categories, plats });
}));

// Suggestions : « souvent commandé avec » (60 derniers jours)
router.get('/suggestions', need('menu.voir', 'commande.creer', 'facture.voir'), h(async (req, res) => {
  const ids = String(req.query.plats || '').split(',').map(Number).filter(Boolean);
  if (!ids.length) return res.json({ associes: [] });
  const associes = await q(`SELECT l2.plat_id AS id, COUNT(DISTINCT l2.facture_id) AS score
    FROM facture_lignes l1 JOIN facture_lignes l2 ON l2.facture_id = l1.facture_id AND l2.plat_id <> l1.plat_id
    JOIN factures f ON f.id = l1.facture_id JOIN plats p ON p.id = l2.plat_id AND p.disponible = 1
    WHERE l1.plat_id IN (?) AND l2.plat_id NOT IN (?) AND f.created_at >= NOW() - INTERVAL 60 DAY
    GROUP BY l2.plat_id ORDER BY score DESC LIMIT 5`, [ids, ids]);
  res.json({ associes });
}));

// ---------- Catégories (prix par défaut commun à tous leurs plats) ----------
router.post('/categories', need('menu.categorie_gerer'), h(async (req, res) => {
  const { nom, icone = '🍽️', ordre = 99, prix_defaut = 0, traductions = {} } = req.body;
  if (!nom) fail(400, 'nom_requis');
  const r = await q('INSERT INTO categories (nom, traductions, icone, prix_defaut, ordre) VALUES (?,?,?,?,?)',
    [String(nom).trim(), trad(traductions), icone, Number(prix_defaut) || 0, Number(ordre) || 99]);
  await log(req.user, 'CATEGORIE_AJOUT', nom);
  broadcast('refresh', { scope: 'menu' });
  res.status(201).json({ id: r.insertId });
}));
router.put('/categories/:id', need('menu.categorie_gerer'), h(async (req, res) => {
  const c = await one('SELECT * FROM categories WHERE id=?', [req.params.id]);
  if (!c) fail(404, 'categorie_introuvable');
  const b = req.body;
  await q('UPDATE categories SET nom=?, traductions=?, icone=?, prix_defaut=?, ordre=? WHERE id=?',
    [b.nom ?? c.nom, trad(b.traductions, parse(c.traductions)), b.icone ?? c.icone, b.prix_defaut !== undefined ? Number(b.prix_defaut) || 0 : c.prix_defaut,
      b.ordre !== undefined ? Number(b.ordre) : c.ordre, c.id]);
  // Option : appliquer le prix de la catégorie à tous ses plats (supprime les prix personnalisés)
  if (b.appliquer_a_tous) await q('UPDATE plats SET prix=NULL WHERE categorie_id=?', [c.id]);
  await log(req.user, 'CATEGORIE_MODIF', b.nom ?? c.nom, b.prix_defaut !== undefined ? `prix ${b.prix_defaut}` : '');
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));
router.delete('/categories/:id', need('menu.categorie_gerer'), h(async (req, res) => {
  const n = await one('SELECT COUNT(*) n FROM plats WHERE categorie_id=?', [req.params.id]);
  if (n.n) fail(400, 'categorie_non_vide');
  await q('DELETE FROM categories WHERE id=?', [req.params.id]);
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));

// ---------- Plats ----------
router.post('/plats', need('menu.item_ajouter'), h(async (req, res) => {
  const { categorie_id, nom, description = '', prix = null, temps_preparation = 15, traductions = {} } = req.body;
  if (!categorie_id || !nom) fail(400, 'plat_champs_requis');
  const r = await q('INSERT INTO plats (categorie_id, nom, traductions, description, prix, temps_preparation) VALUES (?,?,?,?,?,?)',
    [categorie_id, String(nom).trim(), trad(traductions), description, prix === '' || prix === null ? null : Number(prix), Number(temps_preparation) || 15]);
  await log(req.user, 'PLAT_AJOUT', nom);
  broadcast('refresh', { scope: 'menu' });
  res.status(201).json({ id: r.insertId });
}));
router.put('/plats/:id', need('menu.item_modifier'), h(async (req, res) => {
  const p = await one('SELECT * FROM plats WHERE id=?', [req.params.id]);
  if (!p) fail(404, 'plat_introuvable');
  const b = req.body;
  const prix = b.prix === undefined ? p.prix : (b.prix === '' || b.prix === null ? null : Number(b.prix));
  await q('UPDATE plats SET categorie_id=?, nom=?, traductions=?, description=?, prix=?, disponible=?, temps_preparation=? WHERE id=?',
    [b.categorie_id ?? p.categorie_id, b.nom ?? p.nom, trad(b.traductions, parse(p.traductions)), b.description ?? p.description, prix,
      b.disponible === undefined ? p.disponible : (b.disponible ? 1 : 0), Number(b.temps_preparation ?? p.temps_preparation) || 15, p.id]);
  await log(req.user, 'PLAT_MODIF', p.nom, JSON.stringify({ ...b, traductions: undefined }).slice(0, 200));
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));
// Seuls le patron et l'administrateur suppriment un plat (fonctionnalité menu.item_supprimer)
router.delete('/plats/:id', need('menu.item_supprimer'), h(async (req, res) => {
  const p = await one('SELECT nom, image FROM plats WHERE id=?', [req.params.id]);
  if (!p) fail(404, 'plat_introuvable');
  await q('DELETE FROM plats WHERE id=?', [req.params.id]);
  deleteImage(p.image);
  await log(req.user, 'PLAT_SUPPR', p.nom);
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));
router.post('/plats/:id/image', need('menu.images'), h(async (req, res) => {
  const p = await one('SELECT id, nom, image FROM plats WHERE id=?', [req.params.id]);
  if (!p) fail(404, 'plat_introuvable');
  const url = saveImage(req.body.data, 'plats', `plat${p.id}`);
  await q('UPDATE plats SET image=? WHERE id=?', [url, p.id]);
  deleteImage(p.image);
  await log(req.user, 'PLAT_PHOTO', p.nom);
  broadcast('refresh', { scope: 'menu' });
  res.json({ image: url });
}));
router.delete('/plats/:id/image', need('menu.images'), h(async (req, res) => {
  const p = await one('SELECT image FROM plats WHERE id=?', [req.params.id]);
  if (p?.image) { deleteImage(p.image); await q('UPDATE plats SET image=NULL WHERE id=?', [req.params.id]); }
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));

// ---------- Menus composés / menu du jour ----------
router.get('/menus', need('menu.voir'), h(async (req, res) => {
  const menus = await q(`SELECT m.*, u.nom_complet AS auteur FROM menus m LEFT JOIN utilisateurs u ON u.id=m.cree_par ORDER BY m.est_du_jour DESC, m.created_at DESC`);
  for (const m of menus) {
    m.plats = await q(`SELECT mp.plat_id, mp.prix_special, COALESCE(p.prix, c.prix_defaut) AS prix, p.nom, p.traductions, p.image, c.icone
                       FROM menu_plats mp JOIN plats p ON p.id=mp.plat_id JOIN categories c ON c.id=p.categorie_id WHERE mp.menu_id=? ORDER BY c.ordre, p.id`, [m.id]);
    m.plats.forEach(p => { p.traductions = parse(p.traductions); });
    m.est_du_jour = !!m.est_du_jour;
  }
  res.json(menus);
}));
async function savePlats(t, menuId, plats) {
  await t.q('DELETE FROM menu_plats WHERE menu_id=?', [menuId]);
  for (const p of plats || []) await t.q('INSERT INTO menu_plats (menu_id, plat_id, prix_special) VALUES (?,?,?)',
    [menuId, p.plat_id, p.prix_special === '' || p.prix_special == null ? null : Number(p.prix_special)]);
}
router.post('/menus', need('menu.creer'), h(async (req, res) => {
  const { nom, date_menu = null, plats = [] } = req.body;
  if (!nom) fail(400, 'nom_requis');
  const id = await tx(async t => {
    const r = await t.q('INSERT INTO menus (nom, date_menu, cree_par) VALUES (?,?,?)', [nom, date_menu || null, req.user.id]);
    await savePlats(t, r.insertId, plats);
    return r.insertId;
  });
  await log(req.user, 'MENU_CREE', nom);
  broadcast('refresh', { scope: 'menu' });
  res.status(201).json({ id });
}));
router.put('/menus/:id', h(async (req, res) => {
  const m = await one('SELECT * FROM menus WHERE id=?', [req.params.id]);
  if (!m) fail(404, 'menu_introuvable');
  if (!(req.can('menu.modifier') || (m.est_du_jour && req.can('menu.du_jour_modifier')))) fail(403, 'perm', { code: 'menu.modifier' });
  const { nom = m.nom, date_menu = m.date_menu, plats } = req.body;
  await tx(async t => {
    await t.q('UPDATE menus SET nom=?, date_menu=? WHERE id=?', [nom, date_menu || null, m.id]);
    if (plats) await savePlats(t, m.id, plats);
  });
  await log(req.user, m.est_du_jour ? 'MENU_DU_JOUR_MODIF' : 'MENU_MODIF', nom);
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));
router.post('/menus/:id/du-jour', need('menu.du_jour_modifier'), h(async (req, res) => {
  await tx(async t => {
    await t.q('UPDATE menus SET est_du_jour=0');
    await t.q('UPDATE menus SET est_du_jour=1, date_menu=CURDATE() WHERE id=?', [req.params.id]);
  });
  await log(req.user, 'MENU_DU_JOUR', 'menu #' + req.params.id);
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));
router.delete('/menus/:id', need('menu.modifier'), h(async (req, res) => {
  await q('DELETE FROM menus WHERE id=?', [req.params.id]);
  broadcast('refresh', { scope: 'menu' });
  res.json({ ok: true });
}));

module.exports = router;
