// =====================================================================
//  RESTO MANAGER — Serveur DNS local
//  Fait pointer rest.babfkamah.com vers ce PC pour tous les appareils du Wi-Fi.
//  Toutes les autres adresses (google.com, whatsapp…) sont transmises à un DNS
//  public : Internet continue de fonctionner normalement.
//  Aucune dépendance. Lancement : serveur-dns.bat (en administrateur, port 53).
// =====================================================================
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const dgram = require('dgram');
const net = require('net');
const os = require('os');

const DOMAINE = (process.env.DNS_DOMAINE || 'rest.babfkamah.com').toLowerCase().replace(/\.$/, '');
const AMONT = (process.env.DNS_AMONT || '8.8.8.8,1.1.1.1').split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.DNS_PORT || 53);
const TTL = 60;
const VIRTUEL = /virtualbox|vbox|vmware|vmnet|vethernet|hyper-v|wsl|docker|loopback|tap|tun|zerotier|tailscale|hamachi|bluetooth/i;

// Adresse IP de ce PC sur le Wi-Fi (recalculée à chaque requête : suit un changement d'IP)
function ipDuPC() {
  if (process.env.DNS_IP) return process.env.DNS_IP;
  const reelles = [], autres = [];
  for (const [nom, adrs] of Object.entries(os.networkInterfaces())) {
    for (const a of adrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      (VIRTUEL.test(nom) ? autres : reelles).push(a.address);
    }
  }
  const prio = ip => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return [...reelles.sort((a, b) => prio(a) - prio(b)), ...autres][0] || '127.0.0.1';
}

// Lecture du nom demandé dans la question DNS
function lireQuestion(msg) {
  let i = 12;
  const labels = [];
  while (i < msg.length) {
    const len = msg[i];
    if (len === 0) { i++; break; }
    if (len & 0xc0) return null; // compression inattendue dans une question
    labels.push(msg.slice(i + 1, i + 1 + len).toString('ascii'));
    i += 1 + len;
  }
  if (i + 4 > msg.length) return null;
  return { nom: labels.join('.').toLowerCase(), type: msg.readUInt16BE(i), fin: i + 4 };
}

function estNotreDomaine(nom) {
  return nom === DOMAINE || nom.endsWith('.' + DOMAINE);
}

// Réponse faite par ce PC pour rest.babfkamah.com
function repondre(msg, q) {
  const ip = ipDuPC();
  const avecReponse = q.type === 1 || q.type === 255; // A ou ANY (AAAA → réponse vide, le téléphone utilise alors l'IPv4)
  const entete = Buffer.alloc(12);
  entete.writeUInt16BE(msg.readUInt16BE(0), 0);
  entete.writeUInt16BE(0x8400 | (msg.readUInt16BE(2) & 0x0100) | 0x0080, 2); // réponse, autoritaire, RD copié, RA
  entete.writeUInt16BE(1, 4);
  entete.writeUInt16BE(avecReponse ? 1 : 0, 6);
  const question = msg.slice(12, q.fin);
  if (!avecReponse) return Buffer.concat([entete, question]);
  const rr = Buffer.alloc(16);
  rr.writeUInt16BE(0xc00c, 0);   // nom = pointeur vers la question
  rr.writeUInt16BE(1, 2);        // type A
  rr.writeUInt16BE(1, 4);        // classe IN
  rr.writeUInt32BE(TTL, 6);
  rr.writeUInt16BE(4, 10);
  ip.split('.').forEach((o, k) => rr.writeUInt8(Number(o), 12 + k));
  return Buffer.concat([entete, question, rr]);
}

// ---------------- UDP ----------------
const serveur = dgram.createSocket('udp4');
const amont = dgram.createSocket('udp4');
const enAttente = new Map(); // id amont -> { rinfo, idOrigine, essai, msg, timer }
let compteur = Math.floor(Math.random() * 65535);

function transmettre(entree, id) {
  const copie = Buffer.from(entree.msg);
  copie.writeUInt16BE(id, 0);
  amont.send(copie, 53, AMONT[entree.essai % AMONT.length]);
  entree.timer = setTimeout(() => {
    if (!enAttente.has(id)) return;
    if (entree.essai + 1 < AMONT.length * 2) { entree.essai++; transmettre(entree, id); }
    else enAttente.delete(id);
  }, 2000);
}

serveur.on('message', (msg, rinfo) => {
  if (msg.length < 12) return;
  const q = lireQuestion(msg);
  if (q && estNotreDomaine(q.nom)) {
    serveur.send(repondre(msg, q), rinfo.port, rinfo.address);
    if (q.type === 1) console.log(`${new Date().toLocaleTimeString('fr-FR')}  ${rinfo.address} → ${q.nom} = ${ipDuPC()}`);
    return;
  }
  compteur = (compteur + 1) & 0xffff;
  const id = compteur;
  const entree = { rinfo, idOrigine: msg.readUInt16BE(0), essai: 0, msg };
  enAttente.set(id, entree);
  transmettre(entree, id);
});

amont.on('message', rep => {
  if (rep.length < 12) return;
  const id = rep.readUInt16BE(0);
  const e = enAttente.get(id);
  if (!e) return;
  clearTimeout(e.timer);
  enAttente.delete(id);
  rep.writeUInt16BE(e.idOrigine, 0);
  serveur.send(rep, e.rinfo.port, e.rinfo.address);
});

serveur.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Le port ${PORT} est déjà utilisé par un autre programme.`);
    console.error('   Souvent : le « Partage de connexion Internet » (point d\'accès mobile Windows).');
    console.error('   Solution : désactivez le point d\'accès mobile, ou tapez en administrateur :  net stop SharedAccess\n');
  } else if (err.code === 'EACCES') {
    console.error('\n❌ Accès refusé au port 53 : lancez serveur-dns.bat en ADMINISTRATEUR (clic droit → Exécuter en tant qu\'administrateur).\n');
  } else console.error('Erreur DNS :', err.message);
  process.exit(1);
});

serveur.bind(PORT, '0.0.0.0', () => {
  console.log('\n🌐 Serveur DNS Resto Manager démarré');
  console.log(`   ${DOMAINE}  →  ${ipDuPC()}   (ce PC)`);
  console.log(`   Autres sites transmis à : ${AMONT.join(', ')}`);
  console.log(`\n   ➜ Réglez le DNS de la box (ou des téléphones) sur : ${ipDuPC()}`);
  console.log(`   ➜ Puis ouvrez sur le téléphone : http://${DOMAINE}\n`);
  console.log('   Laissez cette fenêtre ouverte. Journal des connexions :');
});

// ---------------- TCP (réponses volumineuses) : relais simple vers le DNS public ----------------
net.createServer(client => {
  const up = net.connect(53, AMONT[0]);
  client.pipe(up).pipe(client);
  const fin = () => { client.destroy(); up.destroy(); };
  client.on('error', fin); up.on('error', fin);
}).on('error', () => { /* TCP facultatif */ }).listen(PORT, '0.0.0.0');

module.exports = { lireQuestion, repondre, estNotreDomaine, ipDuPC };
