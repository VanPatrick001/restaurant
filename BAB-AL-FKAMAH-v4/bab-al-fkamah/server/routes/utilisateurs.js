// Utilisateurs (photo de profil), rôles (bouton Défaut), groupes et fonctionnalités attribuables
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { q, one, tx } = require('../db');
const { h, fail, need, log, notify, permissionsOf } = require('../core');
const { saveImage, deleteImage } = require('../lib');

const isAdmin = req => req.user.role === 'ADMIN';
async function target(id) {
  const u = await one(`SELECT u.*, r.code AS role FROM utilisateurs u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.supprime_at IS NULL`, [id]);
  if (!u) fail(404, 'utilisateur_introuvable');
  return u;
}
function protectAdmin(req, u) { if (u.role === 'ADMIN' && !isAdmin(req)) fail(403, 'admin_protege'); }

router.get('/fonctionnalites', need('utilisateur.voir', 'groupe.gerer', 'role.fonctionnalites'), h(async (req, res) => {
  res.json(await q('SELECT * FROM fonctionnalites ORDER BY module, id'));
}));

router.get('/utilisateurs', need('utilisateur.voir'), h(async (req, res) => {
  res.json(await q(`SELECT u.id, u.username, u.nom_complet, u.telephone, u.photo, u.langue, u.actif, u.role_id, u.derniere_connexion, u.created_at,
      r.code AS role, r.libelle AS role_libelle, r.couleur AS role_couleur,
      (SELECT GROUP_CONCAT(g.nom SEPARATOR ', ') FROM groupe_membres gm JOIN groupes g ON g.id=gm.groupe_id WHERE gm.utilisateur_id=u.id) AS groupes,
      (SELECT COUNT(*) FROM identifiants_biometriques b WHERE b.utilisateur_id=u.id) AS nb_biometrie,
      (SELECT COUNT(*) FROM utilisateur_fonctionnalites uf WHERE uf.utilisateur_id=u.id) AS nb_exceptions
    FROM utilisateurs u JOIN roles r ON r.id=u.role_id WHERE u.supprime_at IS NULL ORDER BY r.id, u.nom_complet`));
}));

router.post('/utilisateurs', need('utilisateur.creer'), h(async (req, res) => {
  const { username, password, nom_complet, telephone = null, role_id, langue = 'fr' } = req.body;
  if (!username || !password || !nom_complet || !role_id) fail(400, 'utilisateur_champs_requis');
  if (String(password).length < 6) fail(400, 'mdp_court');
  const role = await one('SELECT code FROM roles WHERE id=?', [role_id]);
  if (!role) fail(400, 'role_invalide');
  if (role.code === 'ADMIN' && !isAdmin(req)) fail(403, 'admin_seul_admin');
  const uname = String(username).trim().toLowerCase();
  if (await one('SELECT id FROM utilisateurs WHERE username=?', [uname])) fail(409, 'identifiant_existe');
  const r = await q('INSERT INTO utilisateurs (username, password_hash, nom_complet, telephone, role_id, langue, cree_par) VALUES (?,?,?,?,?,?,?)',
    [uname, await bcrypt.hash(password, 10), nom_complet.trim(), telephone, role_id, ['fr', 'en', 'ar'].includes(langue) ? langue : 'fr', req.user.id]);
  await log(req.user, 'UTILISATEUR_CREE', uname, role.code);
  res.status(201).json({ id: r.insertId });
}));

router.put('/utilisateurs/:id', need('utilisateur.modifier'), h(async (req, res) => {
  const u = await target(req.params.id);
  protectAdmin(req, u);
  const { nom_complet = u.nom_complet, telephone = u.telephone, actif = u.actif, password } = req.body;
  if (u.id === req.user.id && !actif) fail(400, 'auto_desactivation');
  await q('UPDATE utilisateurs SET nom_complet=?, telephone=?, actif=? WHERE id=?', [nom_complet, telephone, actif ? 1 : 0, u.id]);
  if (password) {
    if (String(password).length < 6) fail(400, 'mdp_court');
    await q('UPDATE utilisateurs SET password_hash=? WHERE id=?', [await bcrypt.hash(password, 10), u.id]);
  }
  await log(req.user, 'UTILISATEUR_MODIF', u.username, password ? 'mot de passe' : '');
  res.json({ ok: true });
}));

router.post('/utilisateurs/:id/photo', need('utilisateur.modifier'), h(async (req, res) => {
  const u = await target(req.params.id);
  protectAdmin(req, u);
  const url = saveImage(req.body.data, 'profils', `u${u.id}`);
  await q('UPDATE utilisateurs SET photo=? WHERE id=?', [url, u.id]);
  deleteImage(u.photo);
  res.json({ photo: url });
}));

router.delete('/utilisateurs/:id', need('utilisateur.supprimer'), h(async (req, res) => {
  const u = await target(req.params.id);
  protectAdmin(req, u);
  if (u.id === req.user.id) fail(400, 'auto_suppression');
  await q(`UPDATE utilisateurs SET supprime_at=NOW(), actif=0, username=CONCAT(username,'#supprime',id) WHERE id=?`, [u.id]);
  await q('DELETE FROM identifiants_biometriques WHERE utilisateur_id=?', [u.id]);
  await log(req.user, 'UTILISATEUR_SUPPR', u.username, u.role);
  res.json({ ok: true });
}));

router.put('/utilisateurs/:id/role', need('utilisateur.changer_role'), h(async (req, res) => {
  const u = await target(req.params.id);
  protectAdmin(req, u);
  const role = await one('SELECT * FROM roles WHERE id=?', [req.body.role_id]);
  if (!role) fail(400, 'role_invalide');
  if (role.code === 'ADMIN' && !isAdmin(req)) fail(403, 'admin_seul_admin');
  if (u.id === req.user.id) fail(400, 'auto_role');
  await q('UPDATE utilisateurs SET role_id=? WHERE id=?', [role.id, u.id]);
  await log(req.user, 'ROLE_CHANGE', u.username, `${u.role} → ${role.code}`);
  await notify([u.id], { type: 'COMPTE', cle: 'role_change', params: { role: role.code } });
  res.json({ ok: true });
}));

router.get('/utilisateurs/:id/fonctionnalites', need('utilisateur.voir'), h(async (req, res) => {
  const u = await target(req.params.id);
  const all = await q('SELECT * FROM fonctionnalites ORDER BY module, id');
  const viaRole = new Set((await q('SELECT fonctionnalite_id id FROM role_fonctionnalites WHERE role_id=?', [u.role_id])).map(r => r.id));
  const viaGroupe = {};
  (await q(`SELECT gf.fonctionnalite_id id, g.nom FROM groupe_fonctionnalites gf JOIN groupes g ON g.id=gf.groupe_id
            JOIN groupe_membres gm ON gm.groupe_id=g.id WHERE gm.utilisateur_id=?`, [u.id])).forEach(r => { (viaGroupe[r.id] ||= []).push(r.nom); });
  const indiv = {};
  (await q('SELECT fonctionnalite_id id, accorde FROM utilisateur_fonctionnalites WHERE utilisateur_id=?', [u.id])).forEach(r => { indiv[r.id] = r.accorde ? 'accorde' : 'retire'; });
  const eff = new Set(await permissionsOf(u.id, u.role));
  res.json({
    utilisateur: { id: u.id, nom_complet: u.nom_complet, role: u.role },
    fonctionnalites: all.map(f => ({ ...f, via_role: viaRole.has(f.id) || u.role === 'ADMIN', via_groupes: viaGroupe[f.id] || [], individuel: indiv[f.id] || 'defaut', actif: eff.has(f.code) }))
  });
}));

router.put('/utilisateurs/:id/fonctionnalites', need('utilisateur.fonctionnalites'), h(async (req, res) => {
  const u = await target(req.params.id);
  protectAdmin(req, u);
  const { fonctionnalite_id, etat } = req.body;
  const f = await one('SELECT * FROM fonctionnalites WHERE id=?', [fonctionnalite_id]);
  if (!f) fail(404, 'fonctionnalite_inconnue');
  if (etat === 'defaut') await q('DELETE FROM utilisateur_fonctionnalites WHERE utilisateur_id=? AND fonctionnalite_id=?', [u.id, f.id]);
  else if (['accorde', 'retire'].includes(etat)) {
    await q(`INSERT INTO utilisateur_fonctionnalites (utilisateur_id, fonctionnalite_id, accorde, attribue_par) VALUES (?,?,?,?)
             ON DUPLICATE KEY UPDATE accorde=VALUES(accorde), attribue_par=VALUES(attribue_par)`, [u.id, f.id, etat === 'accorde' ? 1 : 0, req.user.id]);
  } else fail(400, 'etat_invalide');
  await log(req.user, 'FONCTIONNALITE_USER', u.username, `${f.code} : ${etat}`);
  if (etat !== 'defaut') await notify([u.id], { type: 'COMPTE', cle: etat === 'accorde' ? 'fonct_accordee' : 'fonct_retiree', params: { code: f.code } });
  res.json({ ok: true });
}));

// Bouton « Défaut » (utilisateur) : supprime ses exceptions individuelles
router.post('/utilisateurs/:id/fonctionnalites/defaut', need('utilisateur.fonctionnalites'), h(async (req, res) => {
  const u = await target(req.params.id);
  protectAdmin(req, u);
  const r = await q('DELETE FROM utilisateur_fonctionnalites WHERE utilisateur_id=?', [u.id]);
  await log(req.user, 'FONCTIONNALITE_USER', u.username, `défaut (${r.affectedRows})`);
  if (r.affectedRows) await notify([u.id], { type: 'COMPTE', cle: 'droits_defaut', params: {} });
  res.json({ ok: true, retirees: r.affectedRows });
}));

// ---------------- RÔLES ----------------
router.get('/roles', h(async (req, res) => {
  const roles = await q('SELECT * FROM roles ORDER BY id');
  for (const r of roles) {
    r.fonctionnalites = (await q('SELECT fonctionnalite_id id FROM role_fonctionnalites WHERE role_id=?', [r.id])).map(x => x.id);
    r.defaut = (await q('SELECT fonctionnalite_id id FROM role_fonctionnalites_defaut WHERE role_id=?', [r.id])).map(x => x.id);
    r.nb_utilisateurs = (await one('SELECT COUNT(*) n FROM utilisateurs WHERE role_id=? AND supprime_at IS NULL', [r.id])).n;
  }
  res.json(roles);
}));
router.put('/roles/:id/fonctionnalites', need('role.fonctionnalites'), h(async (req, res) => {
  const role = await one('SELECT * FROM roles WHERE id=?', [req.params.id]);
  if (!role) fail(404, 'role_invalide');
  if (role.code === 'ADMIN') fail(400, 'admin_tout');
  const ids = (req.body.fonctionnalite_ids || []).map(Number);
  await tx(async t => {
    await t.q('DELETE FROM role_fonctionnalites WHERE role_id=?', [role.id]);
    for (const id of ids) await t.q('INSERT INTO role_fonctionnalites VALUES (?,?)', [role.id, id]);
  });
  await log(req.user, 'ROLE_FONCTIONNALITES', role.code, `${ids.length}`);
  res.json({ ok: true });
}));
async function resetRole(role) {
  if (role.code === 'ADMIN') return;
  await tx(async t => {
    await t.q('DELETE FROM role_fonctionnalites WHERE role_id=?', [role.id]);
    await t.q('INSERT INTO role_fonctionnalites SELECT role_id, fonctionnalite_id FROM role_fonctionnalites_defaut WHERE role_id=?', [role.id]);
  });
}
router.post('/roles/:id/defaut', need('role.fonctionnalites'), h(async (req, res) => {
  const role = await one('SELECT * FROM roles WHERE id=?', [req.params.id]);
  if (!role) fail(404, 'role_invalide');
  await resetRole(role);
  await log(req.user, 'ROLE_DEFAUT', role.code);
  res.json({ ok: true });
}));
router.post('/roles-defaut', need('role.fonctionnalites'), h(async (req, res) => {
  for (const role of await q('SELECT * FROM roles')) await resetRole(role);
  await log(req.user, 'ROLE_DEFAUT', '*');
  res.json({ ok: true });
}));

// ---------------- GROUPES ----------------
router.get('/groupes', need('groupe.gerer', 'groupe.fonctionnalites', 'utilisateur.voir'), h(async (req, res) => {
  const groupes = await q('SELECT * FROM groupes ORDER BY nom');
  for (const g of groupes) {
    g.membres = (await q('SELECT utilisateur_id id FROM groupe_membres WHERE groupe_id=?', [g.id])).map(x => x.id);
    g.fonctionnalites = (await q('SELECT fonctionnalite_id id FROM groupe_fonctionnalites WHERE groupe_id=?', [g.id])).map(x => x.id);
  }
  res.json(groupes);
}));
router.post('/groupes', need('groupe.gerer'), h(async (req, res) => {
  const { nom, description = '' } = req.body;
  if (!nom) fail(400, 'nom_requis');
  const r = await q('INSERT INTO groupes (nom, description) VALUES (?,?)', [nom.trim(), description]);
  await log(req.user, 'GROUPE_CREE', nom);
  res.status(201).json({ id: r.insertId });
}));
router.put('/groupes/:id', need('groupe.gerer', 'groupe.fonctionnalites'), h(async (req, res) => {
  const g = await one('SELECT * FROM groupes WHERE id=?', [req.params.id]);
  if (!g) fail(404, 'groupe_introuvable');
  const { nom, description, membres, fonctionnalites } = req.body;
  if ((nom !== undefined || description !== undefined || membres) && !req.can('groupe.gerer')) fail(403, 'perm', { code: 'groupe.gerer' });
  if (fonctionnalites && !req.can('groupe.fonctionnalites')) fail(403, 'perm', { code: 'groupe.fonctionnalites' });
  await tx(async t => {
    await t.q('UPDATE groupes SET nom=?, description=? WHERE id=?', [nom ?? g.nom, description ?? g.description, g.id]);
    if (membres) { await t.q('DELETE FROM groupe_membres WHERE groupe_id=?', [g.id]); for (const id of membres) await t.q('INSERT INTO groupe_membres VALUES (?,?)', [g.id, id]); }
    if (fonctionnalites) { await t.q('DELETE FROM groupe_fonctionnalites WHERE groupe_id=?', [g.id]); for (const id of fonctionnalites) await t.q('INSERT INTO groupe_fonctionnalites VALUES (?,?)', [g.id, id]); }
  });
  await log(req.user, 'GROUPE_MODIF', g.nom);
  res.json({ ok: true });
}));
router.delete('/groupes/:id', need('groupe.gerer'), h(async (req, res) => {
  await q('DELETE FROM groupes WHERE id=?', [req.params.id]);
  await log(req.user, 'GROUPE_SUPPR', '#' + req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
