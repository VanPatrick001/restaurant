// Tâches automatiques (toutes les minutes) :
//  • commande en cuisine depuis plus de 30 min → alerte au patron, au serveur et aux cuisiniers
//  • facture non payée depuis plus de 2 h → alerte à la caisse, au patron et au serveur
//  • chaque matin (5 h par défaut) → réinitialisation de la table des commandes
//  • chaque jour → suppression des factures plus anciennes que la durée de conservation (365 j par défaut)
const { q } = require('./db');
const { param, setParam, notify, usersWith, usersWithRole, broadcast, log } = require('./core');
const { dateLocale, aed } = require('./lib');

async function alertesCuisine() {
  const delai = Number(await param('delai_cuisine_alerte_min', 30));
  const rows = await q(`SELECT c.id, c.numero, c.serveur_id, c.type_service, e.code AS emplacement,
      (SELECT f.id FROM factures f WHERE f.commande_id=c.id AND f.statut<>'SUPPRIMEE' LIMIT 1) AS facture_id
    FROM commandes c LEFT JOIN emplacements e ON e.id=c.emplacement_id
    WHERE c.statut IN ('VALIDEE','PAYEE') AND c.statut_cuisine IN ('EN_ATTENTE','EN_PREPARATION') AND c.alerte_cuisine=0
      AND c.validee_at < NOW() - INTERVAL ? MINUTE`, [delai]);
  if (!rows.length) return;
  const cuisiniers = await usersWith('cuisine.statut');
  const patrons = await usersWithRole('PATRON');
  for (const c of rows) {
    await q('UPDATE commandes SET alerte_cuisine=1 WHERE id=?', [c.id]);
    await notify([c.serveur_id, ...cuisiniers, ...patrons], {
      type: 'ALERTE', cle: 'cuisine_retard', son: 'alerte',
      params: { numero: c.numero, lieu: c.emplacement || c.type_service, m: delai }, lien: 'cuisine'
    });
  }
  broadcast('refresh', { scope: 'commandes' });
}

async function alertesImpayes() {
  const delai = Number(await param('delai_facture_rouge_min', 120));
  const rows = await q(`SELECT id, numero, serveur_id, montant_total, emplacement_code, type_service FROM factures
    WHERE statut='A_PAYER' AND alerte_impaye=0 AND created_at < NOW() - INTERVAL ? MINUTE`, [delai]);
  if (!rows.length) return;
  const caisse = await usersWith('facture.payer');
  const patrons = await usersWithRole('PATRON');
  for (const f of rows) {
    await q('UPDATE factures SET alerte_impaye=1 WHERE id=?', [f.id]);
    await notify([f.serveur_id, ...caisse, ...patrons], {
      type: 'ALERTE', cle: 'facture_impayee', son: 'alerte',
      params: { facture: f.numero, lieu: f.emplacement_code || f.type_service, montant: aed(f.montant_total), h: Math.round(delai / 6) / 10 }, lien: `facture:${f.id}`
    });
  }
  broadcast('refresh', { scope: 'commandes' });
}

// Vide la table des commandes, sauf les commandes validées dont la facture n'est pas encore réglée
async function reinitialiserCommandes(user = null) {
  const r = await q(`DELETE FROM commandes WHERE id NOT IN (
      SELECT commande_id FROM (SELECT commande_id FROM factures WHERE statut='A_PAYER' AND commande_id IS NOT NULL) AS x)`);
  await q('DELETE FROM notifications WHERE created_at < NOW() - INTERVAL 14 DAY');
  await setParam('derniere_reinitialisation', dateLocale(new Date()));
  await log(user, 'REINITIALISATION', 'commandes', `${r.affectedRows}`);
  broadcast('refresh', { scope: 'commandes' });
  return { supprimees: r.affectedRows };
}

// Supprime les factures (et le journal) plus anciens que la durée de conservation
async function purgerFactures(user = null) {
  const jours = Math.max(30, Number(await param('retention_factures_jours', 365)));
  const r = await q('DELETE FROM factures WHERE created_at < NOW() - INTERVAL ? DAY', [jours]);
  await q('DELETE FROM journal WHERE created_at < NOW() - INTERVAL ? DAY', [jours]);
  await setParam('derniere_purge', dateLocale(new Date()));
  if (r.affectedRows || user) await log(user, 'PURGE_FACTURES', `> ${jours} j`, `${r.affectedRows}`);
  return { supprimees: r.affectedRows, jours };
}

async function tick() {
  try {
    await alertesCuisine();
    await alertesImpayes();
    const maintenant = new Date();
    const aujourdhui = dateLocale(maintenant);
    const H = Number(await param('heure_reinitialisation', 5));
    if (maintenant.getHours() >= H && (await param('derniere_reinitialisation', '')) !== aujourdhui) await reinitialiserCommandes();
    if ((await param('derniere_purge', '')) !== aujourdhui) await purgerFactures();
  } catch (e) { console.error('Tâche automatique :', e.message); }
}

function demarrer() {
  setTimeout(tick, 5000);
  setInterval(tick, 60000);
}

module.exports = { demarrer, tick, reinitialiserCommandes, purgerFactures, alertesCuisine, alertesImpayes };
