// Connexion : identifiant + mot de passe, ou biométrie (empreinte / visage) via WebAuthn
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const { q, one } = require('../db');
const { h, fail, signToken, loadUser, authenticate, log, param } = require('../core');

const challenges = new Map(); // clé -> { challenge, expires }

function rpInfo(req) {
  const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
  const rpID = new URL(origin).hostname;
  return { origin, rpID };
}
function saveChallenge(key, challenge) {
  challenges.set(key, { challenge, expires: Date.now() + 5 * 60000 });
}
function takeChallenge(key) {
  const c = challenges.get(key);
  challenges.delete(key);
  if (!c || c.expires < Date.now()) fail(400, 'bio_expire');
  return c.challenge;
}

async function finishLogin(res, userId, methode) {
  const user = await loadUser(userId);
  if (!user) fail(401, 'compte_inactif');
  await q('UPDATE utilisateurs SET derniere_connexion = NOW() WHERE id = ?', [userId]);
  await log(user, 'CONNEXION', 'session', methode);
  res.json({ token: signToken(user), user });
}

// ---------- Mot de passe ----------
router.post('/login', h(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) fail(400, 'login_requis');
  const u = await one('SELECT id, password_hash, actif FROM utilisateurs WHERE username = ? AND supprime_at IS NULL',
    [String(username).trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) fail(401, 'login_incorrect');
  if (!u.actif) fail(403, 'compte_desactive');
  await finishLogin(res, u.id, 'mot de passe');
}));

// ---------- Biométrie : enregistrement (utilisateur déjà connecté) ----------
router.post('/webauthn/register/options', authenticate, h(async (req, res) => {
  const { rpID } = rpInfo(req);
  const existing = await q('SELECT credential_id, transports FROM identifiants_biometriques WHERE utilisateur_id = ?', [req.user.id]);
  const options = await generateRegistrationOptions({
    rpName: await param('restaurant_nom', 'BAB AL FKAMAH'),
    rpID,
    userName: req.user.username,
    userDisplayName: req.user.nom_complet,
    userID: new TextEncoder().encode(String(req.user.id)),
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.credential_id, transports: c.transports ? c.transports.split(',') : undefined })),
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }
  });
  saveChallenge('reg:' + req.user.id, options.challenge);
  res.json(options);
}));

router.post('/webauthn/register/verify', authenticate, h(async (req, res) => {
  const { origin, rpID } = rpInfo(req);
  const expectedChallenge = takeChallenge('reg:' + req.user.id);
  const verification = await verifyRegistrationResponse({
    response: req.body.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true
  });
  if (!verification.verified) fail(400, 'bio_echec');
  const { credential } = verification.registrationInfo;
  await q(`INSERT INTO identifiants_biometriques (utilisateur_id, credential_id, public_key, compteur, transports, appareil)
           VALUES (?,?,?,?,?,?)`, [
    req.user.id, credential.id, Buffer.from(credential.publicKey).toString('base64url'), credential.counter,
    (credential.transports || []).join(','), String(req.body.appareil || 'Appareil').slice(0, 120)
  ]);
  await log(req.user, 'BIOMETRIE_AJOUT', 'utilisateur', req.body.appareil || '');
  res.json({ ok: true });
}));

// ---------- Biométrie : connexion ----------
router.post('/webauthn/login/options', h(async (req, res) => {
  const { rpID } = rpInfo(req);
  let allowCredentials = [];
  const username = (req.body?.username || '').trim().toLowerCase();
  if (username) {
    const creds = await q(`SELECT b.credential_id, b.transports FROM identifiants_biometriques b
                           JOIN utilisateurs u ON u.id = b.utilisateur_id WHERE u.username = ?`, [username]);
    if (!creds.length) fail(404, 'bio_aucune');
    allowCredentials = creds.map(c => ({ id: c.credential_id, transports: c.transports ? c.transports.split(',') : undefined }));
  }
  const options = await generateAuthenticationOptions({ rpID, allowCredentials, userVerification: 'required' });
  const key = crypto.randomUUID();
  saveChallenge('auth:' + key, options.challenge);
  res.json({ ...options, challengeKey: key });
}));

router.post('/webauthn/login/verify', h(async (req, res) => {
  const { origin, rpID } = rpInfo(req);
  const { response, challengeKey } = req.body || {};
  const expectedChallenge = takeChallenge('auth:' + challengeKey);
  const cred = await one('SELECT * FROM identifiants_biometriques WHERE credential_id = ?', [response?.id]);
  if (!cred) fail(401, 'bio_inconnu');
  const verification = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    credential: {
      id: cred.credential_id,
      publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')),
      counter: Number(cred.compteur),
      transports: cred.transports ? cred.transports.split(',') : undefined
    }
  });
  if (!verification.verified) fail(401, 'bio_refus');
  await q('UPDATE identifiants_biometriques SET compteur = ? WHERE id = ?', [verification.authenticationInfo.newCounter, cred.id]);
  await finishLogin(res, cred.utilisateur_id, 'biométrie');
}));

module.exports = router;
