// Authentification, permissions, paramètres, notifications temps réel, journal, erreurs traduites
const jwt = require('jsonwebtoken');
const { q, one } = require('./db');
const { t } = require('./i18n');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

class HttpError extends Error {
  constructor(status, key, params = {}) { super(key); this.status = status; this.key = key; this.params = params; }
}
const fail = (status, key, params) => { throw new HttpError(status, key, params); };
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Langue de la requête : en-tête X-Lang (fr | en | ar)
function langOf(req) {
  const l = String(req.headers['x-lang'] || req.query.lang || '').slice(0, 2).toLowerCase();
  return ['fr', 'en', 'ar'].includes(l) ? l : 'fr';
}

// ---------------- Paramètres (cache) ----------------
let cacheParams = null;
async function params() {
  if (!cacheParams) {
    cacheParams = {};
    for (const r of await q('SELECT cle, valeur FROM parametres')) cacheParams[r.cle] = r.valeur;
  }
  return cacheParams;
}
async function param(cle, defaut) {
  const p = await params();
  return p[cle] === undefined || p[cle] === null || p[cle] === '' ? defaut : p[cle];
}
async function setParam(cle, valeur) {
  await q('INSERT INTO parametres (cle, valeur) VALUES (?,?) ON DUPLICATE KEY UPDATE valeur=VALUES(valeur)', [cle, String(valeur ?? '')]);
  cacheParams = null;
}

// ---------------- Droits ----------------
// Fonctionnalités effectives = rôle ∪ groupes ∪ ajouts individuels − retraits individuels (admin : tout)
async function permissionsOf(userId, roleCode) {
  if (roleCode === 'ADMIN') return (await q('SELECT code FROM fonctionnalites')).map(r => r.code);
  const rows = await q(`
    SELECT f.code FROM fonctionnalites f
    WHERE (f.id IN (SELECT rf.fonctionnalite_id FROM role_fonctionnalites rf JOIN utilisateurs u ON u.role_id = rf.role_id WHERE u.id = ?)
        OR f.id IN (SELECT gf.fonctionnalite_id FROM groupe_fonctionnalites gf JOIN groupe_membres gm ON gm.groupe_id = gf.groupe_id WHERE gm.utilisateur_id = ?)
        OR f.id IN (SELECT fonctionnalite_id FROM utilisateur_fonctionnalites WHERE utilisateur_id = ? AND accorde = 1))
      AND f.id NOT IN (SELECT fonctionnalite_id FROM utilisateur_fonctionnalites WHERE utilisateur_id = ? AND accorde = 0)`,
  [userId, userId, userId, userId]);
  return rows.map(r => r.code);
}

async function loadUser(id) {
  const u = await one(`SELECT u.id, u.username, u.nom_complet, u.telephone, u.photo, u.langue, u.actif, u.role_id,
      r.code AS role, r.libelle AS role_libelle, r.couleur AS role_couleur
    FROM utilisateurs u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.supprime_at IS NULL`, [id]);
  if (!u || !u.actif) return null;
  u.permissions = await permissionsOf(u.id, u.role);
  return u;
}

const signToken = user => jwt.sign({ id: user.id }, SECRET, { expiresIn: '14h' });

async function authenticate(req, res, next) {
  try {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : req.query.token;
    if (!token) fail(401, 'auth_requise');
    let payload;
    try { payload = jwt.verify(token, SECRET); } catch { fail(401, 'session_expiree'); }
    const user = await loadUser(payload.id);
    if (!user) fail(401, 'compte_inactif');
    req.user = user;
    req.can = code => user.role === 'ADMIN' || user.permissions.includes(code);
    next();
  } catch (e) { next(e); }
}

const need = (...codes) => (req, res, next) =>
  codes.some(c => req.can(c)) ? next() : next(new HttpError(403, 'perm', { code: codes.join(' | ') }));

// ---------------- Temps réel (SSE) ----------------
const clients = new Map(); // userId -> Set(res)
function sseHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const uid = req.user.id;
  if (!clients.has(uid)) clients.set(uid, new Set());
  clients.get(uid).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.get(uid)?.delete(res); });
}
function push(userId, event, data) {
  for (const res of clients.get(userId) || []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data) { for (const uid of clients.keys()) push(uid, event, data); }

// Notification : clé de texte + paramètres → affichée dans la langue de chaque utilisateur
// son : 'pret' (plat prêt), 'livraison', 'alerte' ou 'info'
async function notify(userIds, { type = 'INFO', cle, params: p = {}, lien = null, son = 'info' }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  for (const id of ids) {
    const r = await q('INSERT INTO notifications (utilisateur_id, type, titre, message, params, lien) VALUES (?,?,?,?,?,?)',
      [id, type, cle, t('fr', 'n_' + cle, p).slice(0, 300), JSON.stringify(p), lien]);
    push(id, 'notification', { id: r.insertId, type, titre: cle, params: p, lien, son, created_at: new Date() });
  }
}

// Utilisateurs actifs ayant une fonctionnalité donnée (ou un rôle)
async function usersWith(code) {
  const users = await q(`SELECT u.id, r.code AS role FROM utilisateurs u JOIN roles r ON r.id=u.role_id WHERE u.actif=1 AND u.supprime_at IS NULL`);
  const out = [];
  for (const u of users) if ((await permissionsOf(u.id, u.role)).includes(code)) out.push(u.id);
  return out;
}
async function usersWithRole(...codes) {
  return (await q(`SELECT u.id FROM utilisateurs u JOIN roles r ON r.id=u.role_id WHERE u.actif=1 AND u.supprime_at IS NULL AND r.code IN (?)`, [codes])).map(r => r.id);
}

async function log(user, action, cible, details = '') {
  await q('INSERT INTO journal (utilisateur_id, utilisateur_nom, action, cible, details) VALUES (?,?,?,?,?)',
    [user?.id || null, user?.nom_complet || 'Système', action, String(cible ?? '').slice(0, 80), String(details ?? '').slice(0, 500)]);
}

module.exports = {
  HttpError, fail, h, langOf, params, param, setParam, permissionsOf, loadUser, signToken, authenticate, need,
  sseHandler, push, broadcast, notify, usersWith, usersWithRole, log
};
