// BAB AL FKAMAH — serveur principal (API + interface web)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const { authenticate, sseHandler, HttpError, langOf } = require('./core');
const { t } = require('./i18n');
const { pool } = require('./db');
const { publicConfig } = require('./routes/divers');
const jobs = require('./jobs');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '8mb' })); // photos envoyées en base64 (déjà réduites par l'interface)

const PUBLIC = path.join(__dirname, '..', 'public');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '7d' }));

// Manifeste dynamique : nom et logo définis par l'administrateur
app.get('/manifest.json', async (req, res) => {
  const c = await publicConfig().catch(() => ({ nom: 'BAB AL FKAMAH', logo: '' }));
  const icone = c.logo || '/icons/icon-512.png';
  res.json({
    name: c.nom, short_name: c.nom.length > 14 ? c.nom.split(' ').slice(-1)[0] : c.nom, start_url: '/', scope: '/', display: 'standalone',
    background_color: '#f6f4f0', theme_color: '#1c1917', lang: c.langue_defaut,
    icons: [{ src: c.logo || '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: icone, sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
  });
});
app.use(express.static(PUBLIC));

// ---------------- API ----------------
app.get('/api/sante', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, db: 'ok' }); } catch (e) { res.status(500).json({ ok: false, db: e.message }); }
});
app.get('/api/config', async (req, res, next) => { try { res.json(await publicConfig()); } catch (e) { next(e); } });
app.use('/api/auth', require('./routes/auth'));
app.get('/api/events', authenticate, sseHandler);
app.use('/api', authenticate, require('./routes/commandes'));
app.use('/api', authenticate, require('./routes/factures'));
app.use('/api', authenticate, require('./routes/menu'));
app.use('/api', authenticate, require('./routes/utilisateurs'));
app.use('/api', authenticate, require('./routes/divers'));
app.use('/api', (req, res) => res.status(404).json({ error: t(langOf(req), 'route_inconnue') }));

// Application monopage
app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

// Erreurs : message dans la langue de l'utilisateur
app.use((err, req, res, next) => {
  const lang = langOf(req);
  if (err instanceof HttpError) return res.status(err.status).json({ error: t(lang, err.key, err.params), code: err.key });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: t(lang, 'image_trop_lourde') });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: t(lang, 'doublon') });
  if (err.code === 'ER_ROW_IS_REFERENCED_2') return res.status(409).json({ error: t(lang, 'reference') });
  console.error(err);
  res.status(500).json({ error: t(lang, 'erreur_serveur') + ' ' + err.message });
});

const PORT = Number(process.env.PORT || 3000);
const VIRTUEL = /virtualbox|vbox|vmware|vmnet|vethernet|hyper-v|wsl|docker|loopback|tap|tun|zerotier|tailscale|hamachi|bluetooth/i;
app.listen(PORT, '0.0.0.0', () => {
  const reelles = [], virtuelles = [];
  for (const [nom, adrs] of Object.entries(os.networkInterfaces())) {
    for (const a of adrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      (VIRTUEL.test(nom) ? virtuelles : reelles).push({ nom, ip: a.address });
    }
  }
  console.log('\n🍽️  BAB AL FKAMAH démarré');
  console.log(`   Sur ce PC           : http://localhost:${PORT}`);
  (reelles.length ? reelles : virtuelles).forEach(r => console.log(`   Sur téléphone/Wi-Fi : http://${r.ip}:${PORT}   (${r.nom})`));
  if (reelles.length && virtuelles.length) console.log(`   (adresses virtuelles ignorées : ${virtuelles.map(v => v.ip).join(', ')})`);
  jobs.demarrer();
});

// Port 80 : pour ouvrir simplement http://rest.babfkamah.com
const PORT_WEB = Number(process.env.PORT_WEB ?? 80);
if (PORT_WEB && PORT_WEB !== PORT) {
  require('http').createServer(app).on('error', e => {
    if (e.code === 'EADDRINUSE') console.log(`   ⚠️  Port ${PORT_WEB} occupé (Apache/XAMPP, IIS…) : le nom de domaine fonctionnera avec « :${PORT} »`);
    else if (e.code === 'EACCES') console.log(`   ⚠️  Port ${PORT_WEB} refusé : lancez en administrateur (demarrer-tout.bat)`);
  }).listen(PORT_WEB, '0.0.0.0', () => console.log(`   Nom de domaine      : http://${process.env.DNS_DOMAINE || 'rest.babfkamah.com'}`));
}

// HTTPS optionnel (certs/key.pem + certs/cert.pem) — nécessaire pour la biométrie hors « localhost »
const certDir = path.join(__dirname, '..', 'certs');
if (fs.existsSync(path.join(certDir, 'key.pem')) && fs.existsSync(path.join(certDir, 'cert.pem'))) {
  const HPORT = Number(process.env.HTTPS_PORT || 3443);
  require('https').createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, app)
    .listen(HPORT, '0.0.0.0', () => console.log(`   HTTPS               : https://localhost:${HPORT}`));
}
