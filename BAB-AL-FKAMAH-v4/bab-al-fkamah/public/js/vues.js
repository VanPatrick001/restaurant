/* =====================================================================
   Vues de service : salle, commandes, emporter & livraison, livreur,
   caisse / historique / Deleted bills, cuisine (3 commandes côte à côte + récap)
   ===================================================================== */
'use strict';

// ------------------------------------------------------------------ filtre de période (historique)
const PERIODES = { jour: 0, semaine: 6, mois: 29, trois_mois: 89 };
function plage(st) {
  if (st.p === 'perso' && st.du) return { du: st.du, au: st.au || st.du };
  const au = new Date(), du = new Date();
  du.setDate(du.getDate() - (PERIODES[st.p] ?? 0));
  return { du: isoDate(du), au: isoDate(au) };
}
function periodeHtml(st) {
  const r = plage(st);
  return `<div class="period">${Object.keys(PERIODES).map(k => `<button class="tab ${st.p === k ? 'active' : ''}" data-per="${k}">${t('per.' + k)}</button>`).join('')}
    <button class="tab ${st.p === 'perso' ? 'active' : ''}" data-per="perso">📅 ${t('per.perso')}</button>
    ${st.p === 'perso' ? `<input class="input" type="date" id="per-du" value="${r.du}"> → <input class="input" type="date" id="per-au" value="${r.au}">` : `<span class="small muted">${dateCourte(r.du)}${r.du !== r.au ? ' → ' + dateCourte(r.au) : ''}</span>`}</div>`;
}
function bindPeriode(root, st, apres) {
  $$('[data-per]', root).forEach(b => b.onclick = () => { st.p = b.dataset.per; if (st.p === 'perso' && !st.du) { const r = plage({ p: 'semaine' }); st.du = r.du; st.au = r.au; } apres(); });
  $('#per-du', root)?.addEventListener('change', e => { st.du = e.target.value; apres(); });
  $('#per-au', root)?.addEventListener('change', e => { st.au = e.target.value; apres(); });
}

// ------------------------------------------------------------------ SALLE
async function vSalle(el) {
  const zones = await GET('/salle');
  const tous = zones.flatMap(z => z.emplacements);
  const libres = tous.filter(e => !e.commande_id).length;
  setTitle(t('nav.salle'), t('salle.libres', { n: libres, total: tous.length }),
    can('commande.creer') ? `<button class="btn primary" id="new-any">+ <span class="hide-m">${t('nouvelle_commande')}</span></button>
      <button class="btn" id="new-emp">🥡 <span class="hide-m">${t('svc.EMPORTER')}</span></button><button class="btn" id="new-liv">🛵 <span class="hide-m">${t('svc.LIVRAISON')}</span></button>` : '');
  el.innerHTML = `
    <div class="row" style="margin-bottom:14px"><div class="legend grow">
      <span><i style="background:#bbf7d0"></i>${t('lg.libre')}</span><span><i style="background:#fcd34d"></i>${t('lg.en_cours')}</span>
      <span><i style="background:#93c5fd"></i>${t('lg.a_payer')}</span><span><i style="background:#22c55e"></i>${t('lg.pret')}</span>
      <span><i style="background:#dc2626"></i>${t('lg.rouge', { h: S.config.delai_rouge / 60 })}</span></div>
      ${can('salle.gerer') ? `<button class="btn sm" id="gerer">⚙️ ${t('gerer_emplacements')}</button>` : ''}</div>
    ${zones.map(z => `<section class="zone"><div class="zone-head"><h2>${esc(z.nom)}</h2><span class="fam">${esc(z.famille)}</span>
      <span class="muted small">${t('n_libres', { n: z.emplacements.filter(e => !e.commande_id).length, total: z.emplacements.length })}</span></div>
      <div class="tables">${z.emplacements.map(tile).join('') || '<div class="muted">—</div>'}</div></section>`).join('')}`;
  $$('.tile', el).forEach(x => x.onclick = () => onTable(tous.find(e => String(e.id) === x.dataset.id)));
  $('#new-any')?.addEventListener('click', nouvelleCommande);
  $('#new-emp')?.addEventListener('click', () => go('commande/new?type=EMPORTER'));
  $('#new-liv')?.addEventListener('click', () => go('commande/new?type=LIVRAISON'));
  $('#gerer', el)?.addEventListener('click', () => gererSalle(zones));
}
function tile(e) {
  let cls = 'libre', state = `<span class="badge ok">${t('lg.libre')}</span>`, meta = t('n_places', { n: e.places }), extra = '';
  if (e.commande_id) {
    const rouge = e.facture_id && minutesSince(e.facture_at) >= S.config.delai_rouge;
    if (rouge) { cls = 'rouge'; state = `<span class="badge rouge">⏱ ${t('lg.impaye')}</span>`; }
    else if (e.statut_cuisine === 'PRETE' && e.commande_statut === 'VALIDEE') { cls = 'prete'; state = `<span class="badge ok">✅ ${t('lg.pret')}</span>`; }
    else if (e.commande_statut === 'VALIDEE') { cls = 'validee'; state = `<span class="badge info">${t('lg.a_payer')}</span>`; }
    else { cls = 'brouillon'; state = `<span class="badge warn">${t('lg.en_cours')}</span>`; }
    const since = e.facture_at || e.depuis;
    extra = e.facture_id ? `data-since="${esc(e.facture_at)}" data-limite="${S.config.delai_rouge}" data-cls="rouge"` : '';
    meta = `<b style="color:var(--ink)">${money(e.facture_id ? e.montant_total : e.montant)}</b> · <span class="minuteur">${duree(minutesSince(since))}</span><br>${esc((e.serveur_nom || '').split(' ')[0])}${e.nb_couverts ? ` · ${t('n_pers', { n: e.nb_couverts })}` : ''}`;
  }
  return `<div class="tile ${cls} ${e.code === 'VVIP' ? 'vip' : ''}" data-id="${e.id}" ${extra}><div class="code">${esc(e.code)}</div><div class="state">${state}</div><div class="meta">${meta}</div></div>`;
}
function onTable(e) {
  if (e.commande_id) {
    if (can('commande.voir_toutes', 'commande.gerer_toutes') || e.serveur_id === S.user.id || can('facture.payer')) return go(e.facture_id ? 'facture/' + e.facture_id : 'commande/' + e.commande_id);
    return toast(t('table_servie_par', { nom: e.serveur_nom }), '', '🙋');
  }
  if (!can('commande.creer')) return toast(t('lg.libre'), '', '🪑');
  go(`commande/new?type=SUR_PLACE&table=${e.id}&code=${encodeURIComponent(e.code)}`);
}
function nouvelleCommande() {
  const m = modal({ title: '+ ' + t('nouvelle_commande'),
    body: `<div class="service-grid">${Object.keys(SVC_ICO).map(k => `<button class="service" data-s="${k}"><span class="e">${SVC_ICO[k]}</span><b>${t('svc.' + k)}</b></button>`).join('')}</div>
      <p class="small muted" style="margin-bottom:0">💡 ${t('plats_dabord')}</p>` });
  $$('[data-s]', m.el).forEach(b => b.onclick = () => { m.close(); go('commande/new?type=' + b.dataset.s); });
}
function gererSalle(zones) {
  const m = modal({
    title: t('gerer_emplacements'), wide: true,
    body: `<form id="f-emp" class="row" style="align-items:flex-end;margin-bottom:14px">
        <label class="field grow" style="margin:0"><span>${t('zone')}</span><select class="input" name="zone_id">${zones.map(z => `<option value="${z.id}">${esc(z.nom)}</option>`).join('')}</select></label>
        <label class="field" style="margin:0;width:120px"><span>${t('code')}</span><input class="input" name="code" placeholder="VIP6" required></label>
        <label class="field" style="margin:0;width:90px"><span>${t('places')}</span><input class="input" name="places" type="number" value="4" min="1"></label>
        <button class="btn primary">${t('ajouter')}</button></form>
      ${zones.map(z => `<h3 style="margin:10px 0 6px">${esc(z.nom)}</h3><div class="row">${z.emplacements.map(e => `<span class="badge" style="padding:.35rem .6rem">${esc(e.code)} <a href="#" data-del="${e.id}" style="color:var(--bad);text-decoration:none">✕</a></span>`).join('')}</div>`).join('')}`
  });
  $('#f-emp', m.el).onsubmit = async ev => { ev.preventDefault(); if (await act(() => POST('/emplacements', formData(ev.target)), t('ajoute'))) { m.close(); softRender(); } };
  $$('[data-del]', m.el).forEach(a => a.onclick = async ev => {
    ev.preventDefault();
    if (await confirmBox(t('retirer_emplacement_q'), { danger: true, ok: t('retirer') })) { await act(() => DEL('/emplacements/' + a.dataset.del)); m.close(); softRender(); }
  });
}

// ------------------------------------------------------------------ COMMANDES DU SERVICE
async function vCommandes(el) {
  S.cmdTab = S.cmdTab || 'BROUILLON';
  const all = await GET('/commandes');
  const counts = s => all.filter(c => c.statut === s).length;
  const list = all.filter(c => S.cmdTab === 'TOUTES' || c.statut === S.cmdTab);
  setTitle(can('commande.voir_toutes', 'commande.gerer_toutes') ? t('nav.commandes') : t('mes_commandes'), t('service_en_cours', { n: all.length }),
    can('commande.creer') ? `<button class="btn primary" id="new-any">+ <span class="hide-m">${t('nouvelle_commande')}</span></button>` : '');
  el.innerHTML = `<div class="tabs">${[['BROUILLON', 'st.brouillon'], ['VALIDEE', 'st.validee'], ['PAYEE', 'st.payee'], ['TOUTES', 'toutes']]
      .map(([k, l]) => `<button class="tab ${S.cmdTab === k ? 'active' : ''}" data-k="${k}">${t(l)}<span class="n">${k === 'TOUTES' ? all.length : counts(k)}</span></button>`).join('')}</div>
    ${list.length ? `<div class="cards">${list.map(cmdCard).join('')}</div>` : `<div class="card empty"><div class="big">🧾</div>${t('aucune_commande')}</div>`}
    <p class="small muted">🔄 ${t('reinit_info', { h: S.config.heure_reinit })} ${can('facture.voir') ? t('historique_dans_factures') : ''}</p>`;
  $$('.tab', el).forEach(b => b.onclick = () => { S.cmdTab = b.dataset.k; softRender(); });
  $('#new-any')?.addEventListener('click', nouvelleCommande);
  $$('[data-go]', el).forEach(c => c.onclick = () => go(c.dataset.go));
}
function cmdCard(c) {
  const rouge = c.facture_statut === 'A_PAYER' && minutesSince(c.facture_at) >= S.config.delai_rouge;
  return `<div class="card ${rouge ? 'rouge' : ''}" data-go="${c.facture_id ? 'facture/' + c.facture_id : 'commande/' + c.id}" style="cursor:pointer"
      ${c.facture_statut === 'A_PAYER' ? `data-since="${esc(c.facture_at)}" data-limite="${S.config.delai_rouge}" data-cls="rouge"` : ''}>
    <div class="row"><b class="grow">${esc(lieu(c))}</b>${rouge ? `<span class="badge rouge">⏱ ${t('lg.impaye')}</span>` : badgeStatut(c.statut)}</div>
    <div class="small muted" style="margin:4px 0 10px">${esc(c.numero)} · ${hhmm(c.created_at)} · ${esc(c.serveur_nom)}${c.facture_numero ? ' · ' + esc(c.facture_numero) : ''}</div>
    <div class="row"><span class="grow">${c.statut !== 'BROUILLON' ? badgeCuisine(c.statut_cuisine) : `<span class="small muted">${t('n_articles', { n: c.nb_articles })}</span>`}
      ${c.type_service === 'LIVRAISON' && c.statut_livraison ? ' ' + badgeLivr(c.statut_livraison) : ''}</span>
      <b class="num" style="font-size:1.1rem">${money(c.total)}</b></div></div>`;
}

// ------------------------------------------------------------------ EMPORTER & LIVRAISON (caisse / serveur / patron)
async function vEmporter(el) {
  S.empTab = S.empTab || 'LIVRAISON';
  let rows;
  if (S.empTab === 'LIVRAISON') rows = (await GET('/livraisons?onglet=toutes')).livraisons;
  else rows = (await GET('/commandes?type=EMPORTER')).filter(c => c.statut !== 'ANNULEE');
  setTitle(t('nav.emporter'), t('n_en_cours_liste', { n: rows.length }),
    can('commande.creer') ? `<button class="btn primary" id="new">+ ${t('svc.' + S.empTab)}</button>` : '');
  el.innerHTML = `<div class="tabs"><button class="tab ${S.empTab === 'LIVRAISON' ? 'active' : ''}" data-k="LIVRAISON">🛵 ${t('livraisons')}</button>
      <button class="tab ${S.empTab === 'EMPORTER' ? 'active' : ''}" data-k="EMPORTER">🥡 ${t('svc.EMPORTER')}</button></div>
    ${rows.length ? `<div class="cards">${rows.map(r => S.empTab === 'LIVRAISON' ? livCardGestion(r) : cmdCard(r)).join('')}</div>` : `<div class="card empty"><div class="big">${S.empTab === 'LIVRAISON' ? '🛵' : '🥡'}</div>${t('rien')}</div>`}`;
  $$('.tab', el).forEach(b => b.onclick = () => { S.empTab = b.dataset.k; softRender(); });
  $('#new')?.addEventListener('click', () => go('commande/new?type=' + S.empTab));
  $$('[data-go]', el).forEach(c => c.onclick = e => { if (!e.target.closest('a,button')) go(c.dataset.go); });
  $$('[data-assign]', el).forEach(b => b.onclick = () => assignerLivreur(rows.find(r => String(r.id) === b.dataset.assign), softRender));
  $$('[data-retirer]', el).forEach(b => b.onclick = async () => { if (await act(() => POST(`/livraisons/${b.dataset.retirer}/retirer`), t('livreur_retire'))) softRender(); });
}
function livCardGestion(f) {
  const tel = f.client_whatsapp || f.client_tel;
  const rouge = f.statut === 'A_PAYER' && minutesSince(f.created_at) >= S.config.delai_rouge;
  return `<div class="card ${rouge ? 'rouge' : ''}" data-go="facture/${f.id}" style="cursor:pointer">
    <div class="row"><h2 class="grow">${esc(f.commande_numero)} · ${esc(f.client_nom || t('client'))}</h2>${badgeLivr(f.statut_livraison)}</div>
    <div class="small muted" style="margin:2px 0 8px">${esc(f.numero)} · ${hhmm(f.created_at)} · ${esc(f.serveur_nom)}</div>
    <div class="small">${esc(f.resume || '')}</div>
    <dl class="liv-meta">${f.adresse ? `<dt>🏠</dt><dd>${esc(f.adresse)}</dd>` : ''}${f.livreur_nom ? `<dt>🛵</dt><dd>${esc(f.livreur_nom)}</dd>` : ''}</dl>
    <div class="row" style="margin-top:10px">${f.statut_cuisine ? badgeCuisine(f.statut_cuisine) : ''} ${badgeStatut(f.statut)}<span class="spacer"></span><b class="num">${money(f.montant_total)}</b></div>
    <div class="row" style="margin-top:10px;gap:6px">
      ${tel ? `<a class="btn sm wa" href="${esc(waLien(tel))}" target="_blank" rel="noopener">💬</a>` : ''}
      ${can('livraison.assigner') && f.statut_livraison !== 'LIVREE' ? `<button class="btn sm" data-assign="${f.id}">👤 ${t('assigner')}</button>` : ''}
      ${can('livraison.retirer') && f.livreur_id && f.statut_livraison !== 'LIVREE' ? `<button class="btn sm danger" data-retirer="${f.id}">${t('retirer_livreur')}</button>` : ''}
    </div></div>`;
}

// ------------------------------------------------------------------ LIVREUR
async function vLivraisons(el) {
  S.livTab = S.livTab || 'disponibles';
  const d = await GET('/livraisons?onglet=' + S.livTab);
  S.config.indicatif = d.indicatif || S.config.indicatif;
  const c = d.compte || {};
  setTitle(t('nav.livraisons'), t('bonjour', { nom: S.user.nom_complet.split(' ')[0] }));
  el.innerHTML = `<div class="tabs">${[['disponibles', '📦 ' + t('lv.a_prendre'), c.disponibles], ['miennes', '🛵 ' + t('lv.miennes'), c.miennes], ['livrees', '✅ ' + t('lv.livrees'), c.livrees]]
      .map(([k, l, n]) => `<button class="tab ${S.livTab === k ? 'active' : ''}" data-k="${k}">${l}<span class="n">${n || 0}</span></button>`).join('')}</div>
    ${d.livraisons.length ? `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${d.livraisons.map(livCard).join('')}</div>`
      : `<div class="card empty"><div class="big">${S.livTab === 'disponibles' ? '📦' : S.livTab === 'miennes' ? '🛵' : '✅'}</div>${t('lv.vide_' + S.livTab)}</div>`}`;
  $$('.tab', el).forEach(b => b.onclick = () => { S.livTab = b.dataset.k; softRender(); });
  $$('[data-acc]', el).forEach(b => b.onclick = async () => { if (await act(() => POST(`/livraisons/${b.dataset.acc}/accepter`), t('lv.acceptee_ok'))) { S.livTab = 'miennes'; softRender(); } });
  $$('[data-route]', el).forEach(b => b.onclick = async () => { if (await act(() => POST(`/livraisons/${b.dataset.route}/en-route`))) softRender(); });
  $$('[data-done]', el).forEach(b => b.onclick = async () => {
    if (await confirmBox(t('lv.confirmer_livree'), { ok: '✅ ' + t('lv.livree_btn') }) && await act(() => POST(`/livraisons/${b.dataset.done}/livree`), t('livraison_ok'))) softRender();
  });
}
function livCard(f) {
  const tel = f.client_whatsapp || f.client_tel;
  const msg = t('wa_message', { resto: S.config.nom, numero: f.commande_numero });
  const mine = f.livreur_id === S.user.id;
  return `<div class="card liv-card">
    <div class="row"><h2 class="grow">${esc(f.commande_numero)}</h2>${f.statut_cuisine ? badgeCuisine(f.statut_cuisine) : ''} ${badgeLivr(f.statut_livraison)}</div>
    <div class="small muted" data-since="${esc(f.created_at)}">${t('depuis')} <span class="minuteur">${duree(minutesSince(f.created_at))}</span></div>
    <dl class="liv-meta">
      <dt>👤</dt><dd>${esc(f.client_nom || '—')}</dd>
      ${f.adresse ? `<dt>🏠</dt><dd>${esc(f.adresse)}</dd>` : ''}
      ${f.localisation ? `<dt>📍</dt><dd><a href="${esc(mapLien(f.localisation))}" target="_blank" rel="noopener">${esc(f.localisation)}</a></dd>` : ''}
      ${f.commentaire ? `<dt>💬</dt><dd>${esc(f.commentaire)}</dd>` : ''}
      <dt>🍽️</dt><dd class="small">${esc(f.resume || '')}</dd>
    </dl>
    <div class="row" style="margin-top:12px"><span class="grow">${f.statut === 'PAYEE' ? `<span class="badge ok">${t('st.payee')}</span>` : `<span class="badge warn">💵 ${t('lv.a_encaisser')}</span>`}</span>
      <span class="big-amount">${money(f.montant_total)}</span></div>
    <div class="liv-actions">
      ${S.livTab === 'disponibles' ? `<button class="btn primary lg" data-acc="${f.id}" style="grid-column:1/-1">✋ ${t('lv.accepter')}</button>` : ''}
      ${mine && tel ? `<a class="btn wa" href="${esc(waLien(tel, msg))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      ${mine && f.client_tel ? `<a class="btn" href="tel:${esc(f.client_tel)}">📞 ${t('appeler')}</a>` : ''}
      ${mine && (f.localisation || f.adresse) ? `<a class="btn" href="${esc(mapLien(f.localisation || f.adresse))}" target="_blank" rel="noopener">🗺️ ${t('itineraire')}</a>` : ''}
      ${mine && f.statut_livraison === 'ACCEPTEE' ? `<button class="btn" data-route="${f.id}">🚗 ${t('lv.en_route')}</button>` : ''}
      ${mine && ['ACCEPTEE', 'EN_ROUTE'].includes(f.statut_livraison) ? `<button class="btn primary" data-done="${f.id}" style="grid-column:1/-1">✅ ${t('lv.livree_btn')}</button>` : ''}
      ${f.statut_livraison === 'LIVREE' ? `<span class="small muted">✅ ${dateTime(f.livree_at)}</span>` : ''}
    </div>
    ${mine && ['ACCEPTEE', 'EN_ROUTE'].includes(f.statut_livraison) ? `<p class="small muted" style="margin:10px 0 0">🔒 ${t('lv.pas_retirer')}</p>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ CAISSE / FACTURES / HISTORIQUE / DELETED BILLS
async function vCaisse(el) {
  S.caisseTab = S.caisseTab || (can('facture.payer') ? 'A_PAYER' : 'TOUTES');
  if (S.caisseTab === 'CORBEILLE' && !can('corbeille.voir')) S.caisseTab = 'A_PAYER';
  S.per = S.per || { p: 'jour' };
  const r = plage(S.per);
  const qs = `du=${r.du}&au=${r.au}${S.caisseQ ? '&q=' + encodeURIComponent(S.caisseQ) : ''}`;
  const [aPayer, periode, corbeille] = await Promise.all([
    GET('/factures?statut=A_PAYER'), GET('/factures?' + qs), can('corbeille.voir') ? GET('/corbeille') : []]);
  const payees = periode.filter(f => f.statut === 'PAYEE');
  const somme = (arr, m) => arr.filter(f => !m || f.mode_paiement === m).reduce((s, f) => s + Number(f.montant_total), 0);
  const rouges = aPayer.filter(estRouge);
  const list = S.caisseTab === 'A_PAYER' ? aPayer : S.caisseTab === 'PAYEE' ? payees : periode;
  setTitle(can('facture.payer') ? t('nav.caisse') : t('nav.factures'), can('commande.voir_toutes') ? t('toutes_factures') : t('mes_factures'),
    (S.caisseTab === 'CORBEILLE' && can('corbeille.vider') && corbeille.length ? `<button class="btn danger" id="vider">🗑️ ${t('vider_corbeille')}</button>` : '') +
    (S.caisseTab !== 'CORBEILLE' ? `<button class="btn" id="csv">⬇️ <span class="hide-m">CSV</span></button>` : ''));
  const tabs = [['A_PAYER', t('a_encaisser'), aPayer.length], ['PAYEE', t('st.payee'), payees.length], ['TOUTES', t('toutes'), periode.length]];
  if (can('corbeille.voir')) tabs.push(['CORBEILLE', '🗑️ Deleted bills', corbeille.length]);
  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="lbl">${t('a_encaisser')}</div><div class="val" style="color:var(--info)">${money(somme(aPayer))}</div><div class="sub">${t('n_factures', { n: aPayer.length })}</div></div>
      <div class="kpi" style="${rouges.length ? 'box-shadow:0 0 0 2px var(--bad),var(--shadow)' : ''}"><div class="lbl">⏱ ${t('impayees_plus', { h: S.config.delai_rouge / 60 })}</div><div class="val" style="color:${rouges.length ? 'var(--bad)' : 'inherit'}">${rouges.length}</div><div class="sub">${money(somme(rouges))}</div></div>
      <div class="kpi"><div class="lbl">${t('encaisse_periode')}</div><div class="val" style="color:var(--ok)">${money(somme(payees))}</div><div class="sub">${t('n_factures', { n: payees.length })}</div></div>
      <div class="kpi"><div class="lbl">💵 ${t('mode.CASH')} · 💳 ${t('mode.VISA')}</div><div class="val" style="font-size:1.15rem">${money(somme(payees, 'CASH'))}<br>${money(somme(payees, 'VISA'))}</div></div>
    </div>
    ${S.caisseTab !== 'A_PAYER' && S.caisseTab !== 'CORBEILLE' ? periodeHtml(S.per) : ''}
    <div class="row" style="margin-bottom:10px"><div class="tabs grow" style="margin:0">${tabs.map(([k, l, n]) => `<button class="tab ${S.caisseTab === k ? 'active' : ''}" data-k="${k}">${l}<span class="n">${n}</span></button>`).join('')}</div>
      ${S.caisseTab !== 'CORBEILLE' ? `<div class="search" style="margin:0;min-width:220px"><input class="input" id="cq" placeholder="${t('rechercher_facture')}" value="${esc(S.caisseQ || '')}"></div>` : ''}</div>
    ${S.caisseTab === 'CORBEILLE' ? corbeilleHtml(corbeille) : facturesTable(list)}`;
  $$('[data-k]', el).forEach(b => b.onclick = () => { S.caisseTab = b.dataset.k; softRender(); });
  bindPeriode(el, S.per, softRender);
  const cq = $('#cq', el);
  if (cq) { let tm; cq.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { S.caisseQ = cq.value.trim(); softRender().then(() => { const i = $('#cq'); i?.focus(); i?.setSelectionRange(i.value.length, i.value.length); }); }, 400); }; }
  $$('[data-f]', el).forEach(rw => rw.onclick = e => { if (!e.target.closest('button')) go('facture/' + rw.dataset.f); });
  $('#csv')?.addEventListener('click', () => exportCsv(list, `factures_${r.du}_${r.au}.csv`));
  $$('[data-rest]', el).forEach(b => b.onclick = async () => { if (await act(() => POST(`/corbeille/${b.dataset.kind}/${b.dataset.rest}/restaurer`), t('restaure'))) softRender(); });
  $$('[data-purge]', el).forEach(b => b.onclick = async () => {
    if (await confirmBox(t('suppr_def_q', { n: '' }), { danger: true, ok: t('supprimer_definitivement') }) && await act(() => DEL(`/corbeille/${b.dataset.kind}/${b.dataset.purge}`), t('supprime_def'))) softRender();
  });
  $('#vider')?.addEventListener('click', async () => {
    if (await confirmBox(t('vider_q', { n: corbeille.length }), { danger: true, ok: t('tout_supprimer') }) && await act(() => DEL('/corbeille'), t('corbeille_videe'))) softRender();
  });
}
function facturesTable(list) {
  if (!list.length) return `<div class="card empty"><div class="big">${S.caisseTab === 'A_PAYER' ? '🎉' : '🧾'}</div>${t(S.caisseTab === 'A_PAYER' ? 'aucune_attente' : 'aucune_facture')}</div>`;
  return `<div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="tbl">
    <thead><tr><th>${t('facture')}</th><th>${t('service')}</th><th class="hide-m">${t('serveur')}</th><th class="hide-m">${t('encaisse_par')}</th><th class="hide-m">${t('date')}</th><th>${t('montant')}</th><th>${t('statut')}</th></tr></thead>
    <tbody>${list.map(f => {
      const rouge = estRouge(f);
      return `<tr class="click ${rouge ? 'rouge' : ''}" data-f="${f.id}" ${f.statut === 'A_PAYER' ? `data-since="${esc(f.created_at)}" data-limite="${S.config.delai_rouge}" data-cls="rouge"` : ''}>
      <td><b>${esc(f.numero)}</b> <span class="small muted">${esc(f.commande_numero)}</span>${f.nb_modifs ? ` <span class="badge warn" title="${t('modifiee')}">✏️ ${f.nb_modifs}</span>` : ''}</td>
      <td>${esc(lieu(f))}</td><td class="hide-m">${esc(f.serveur_nom)}</td><td class="hide-m">${esc(f.caissier_nom || '—')}</td>
      <td class="hide-m small">${dateTime(f.payee_at || f.created_at)}</td><td class="num"><b>${money(f.montant_total)}</b></td>
      <td>${f.statut === 'PAYEE' ? `<span class="badge ok">${f.mode_paiement === 'VISA' ? '💳' : '💵'} ${t('st.payee')}</span>` : f.statut === 'A_PAYER'
        ? `<span class="badge ${rouge ? 'rouge' : 'info'}">${rouge ? '⏱ ' : ''}${t('st.a_payer')} · <span class="minuteur">${duree(minutesSince(f.created_at))}</span></span>` : badgeStatut(f.statut)}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
}
function corbeilleHtml(rows) {
  if (!rows.length) return `<div class="card empty"><div class="big">🗑️</div>${t('corbeille_vide')}</div>`;
  return `<div class="alert info small"><span>ℹ️</span><span>${t(can('corbeille.vider') ? 'corbeille_info_manager' : 'corbeille_info')}</span></div>
    <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="tbl">
    <thead><tr><th>N°</th><th>${t('service')}</th><th class="hide-m">${t('serveur')}</th><th>${t('montant')}</th><th class="hide-m">${t('etat_avant')}</th><th>${t('supprimee_par')}</th><th class="hide-m">${t('motif')}</th><th></th></tr></thead>
    <tbody>${rows.map(c => `<tr class="click" data-f="${c.kind === 'facture' ? c.id : ''}">
      <td><b>${esc(c.numero)}</b><div class="small muted">${t(c.kind === 'facture' ? 'facture' : 'commande')}</div></td>
      <td>${esc(lieu(c))}</td><td class="hide-m">${esc(c.serveur_nom)}</td><td class="num"><b>${money(c.total)}</b></td>
      <td class="hide-m">${badgeStatut(c.statut_avant_suppression)}</td>
      <td>${esc(c.supprime_par_nom || '—')}<div class="small muted">${dateTime(c.supprime_at)}</div></td>
      <td class="hide-m small">${esc(c.motif_suppression || '—')}</td>
      <td style="white-space:nowrap;text-align:end">${can('corbeille.restaurer') ? `<button class="btn sm" data-kind="${c.kind}" data-rest="${c.id}">↩️<span class="hide-m"> ${t('restaurer')}</span></button>` : ''}
        ${can('corbeille.vider') ? `<button class="btn sm danger" data-kind="${c.kind}" data-purge="${c.id}">🗑️</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
function exportCsv(list, nom) {
  const cols = [['numero', t('facture')], ['commande_numero', 'N°'], ['created_at', t('date')], ['type_service', t('service')], ['emplacement_code', t('table')],
    ['client_nom', t('client')], ['serveur_nom', t('serveur')], ['caissier_nom', t('encaisse_par')], ['livreur_nom', t('livreur')], ['statut', t('statut')],
    ['mode_paiement', t('mode_paiement')], ['remise', t('remise')], ['montant_total', t('montant') + ' (AED)']];
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.map(c => cell(c[1])).join(';'), ...list.map(f => cols.map(([k]) => cell(k === 'created_at' ? dateTime(f[k]) : f[k])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nom; a.click();
}

// ------------------------------------------------------------------ CUISINE (côte à côte, paysage, récap)
async function vCuisine(el) {
  S.kFiltre = S.kFiltre || 'EN_COURS';
  S.kParEcran = Number(store.get('kParEcran') || 3);
  if (S.kFiltre === 'RECAP') return vRecap(el);
  const d = await GET('/cuisine');
  const delai = d.delai || S.config.delai_cuisine;
  const enCours = d.commandes.filter(c => c.statut_cuisine !== 'PRETE');
  const pretes = d.commandes.filter(c => c.statut_cuisine === 'PRETE');
  const shown = S.kFiltre === 'EN_COURS' ? enCours : pretes;
  setTitle(t('nav.cuisine'), t('cuisine_sous', { a: enCours.length, b: pretes.length }), cuisineActions());
  el.innerHTML = `
    <div class="row" style="margin-bottom:10px">${cuisineTabs(enCours.length, pretes.length)}
      <span class="small muted" id="k-pos"></span>
      <button class="btn icon-btn" id="k-prev">${S.lang === 'ar' ? '▶' : '◀'}</button><button class="btn icon-btn" id="k-next">${S.lang === 'ar' ? '◀' : '▶'}</button></div>
    ${shown.length ? `<div class="kstrip" id="kstrip" style="--k:${S.kParEcran}">${shown.map(c => kCard(c, delai)).join('')}</div>`
      : `<div class="card empty"><div class="big">👨‍🍳</div>${t(S.kFiltre === 'PRETE' ? 'aucune_prete' : 'aucune_en_cours')}</div>`}`;
  bindCuisine(el);
  const strip = $('#kstrip', el);
  const pos = () => {
    if (!strip) { $('#k-pos').textContent = ''; return; }
    const w = strip.clientWidth / S.kParEcran, first = Math.round(Math.abs(strip.scrollLeft) / w) + 1;
    $('#k-pos').textContent = t('x_sur_y', { a: first, b: Math.min(shown.length, first + S.kParEcran - 1), n: shown.length });
  };
  const dir = S.lang === 'ar' ? -1 : 1;
  $('#k-prev').onclick = () => strip?.scrollBy({ left: -strip.clientWidth * dir, behavior: 'smooth' });
  $('#k-next').onclick = () => strip?.scrollBy({ left: strip.clientWidth * dir, behavior: 'smooth' });
  strip?.addEventListener('scroll', () => requestAnimationFrame(pos));
  pos();
  $$('[data-st]', el).forEach(b => b.onclick = async () => { if (await act(() => PATCH(`/commandes/${b.dataset.id}/cuisine`, { statut_cuisine: b.dataset.st }))) softRender(); });
}
function cuisineTabs(a, b) {
  return `<div class="tabs grow" style="margin:0">${[['EN_COURS', '🔥 ' + t('cu.en_cours'), a], ['PRETE', '✅ ' + t('cu.pretes'), b], ['RECAP', '📋 ' + t('recap'), null]]
    .map(([k, l, n]) => `<button class="tab ${S.kFiltre === k ? 'active' : ''}" data-kf="${k}">${l}${n != null ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;
}
function cuisineActions() {
  return `<div class="tabs hide-m" style="margin:0">${[2, 3, 4].map(n => `<button class="tab ${S.kParEcran === n ? 'active' : ''}" data-n="${n}" title="${t('par_ecran')}">${n}</button>`).join('')}</div>
    <button class="btn sm ${landscapeWanted() ? 'primary' : ''}" id="k-rot" title="${t('paysage_auto')}">🔄<span class="hide-m"> ${t('paysage_auto')}</span></button>
    <button class="btn sm" id="k-land">⛶<span class="hide-m"> ${t('plein_ecran')}</span></button>`;
}
function bindCuisine(el) {
  $$('[data-kf]', el).forEach(b => b.onclick = () => { S.kFiltre = b.dataset.kf; softRender(); });
  $$('#page-actions [data-n]').forEach(b => b.onclick = () => { store.set('kParEcran', b.dataset.n); softRender(); });
  $('#k-land').onclick = kitchenFullscreen;
  $('#k-rot').onclick = () => { store.set('kLandscape', landscapeWanted() ? 'off' : 'on'); applyLandscape(); softRender(); };
}
function kCard(c, delai) {
  const m = minutesSince(c.validee_at || c.created_at);
  const cls = c.statut_cuisine === 'PRETE' ? 'okk' : m >= delai ? 'late' : m >= delai * 0.7 ? 'soon' : '';
  const next = { EN_ATTENTE: ['EN_PREPARATION', '🔥 ' + t('cu.commencer')], EN_PREPARATION: ['PRETE', '✅ ' + t('cu.prete')], PRETE: ['SERVIE', '🍽️ ' + t('cu.servie')] }[c.statut_cuisine];
  return `<div class="kcard ${cls}" data-since="${esc(c.validee_at || c.created_at)}" ${c.statut_cuisine !== 'PRETE' ? `data-limite="${delai}" data-cls="late"` : ''}>
    <div class="khead"><div class="row"><b class="grow" style="font-size:1.15rem">${esc(lieu(c))}</b><span class="timer minuteur">${duree(m)}</span></div>
      <div class="row small" style="margin-top:4px"><span class="grow muted">${esc(c.numero)} · ${esc(c.serveur_nom)}</span>${badgeCuisine(c.statut_cuisine)}</div>
      <div class="small muted">${t('prevu', { m: c.temps_prevu })}</div></div>
    <ul class="klines">${c.lignes.map(l => `<li><b>${l.quantite}×</b><span>${esc(platNom(l.plat_id, l.libelle))}${l.note ? `<br><span class="small" style="color:var(--warn);font-weight:700">📝 ${esc(l.note)}</span>` : ''}</span></li>`).join('')}</ul>
    ${c.commentaire ? `<div class="small" style="color:var(--warn);font-weight:700;padding:0 14px 8px">💬 ${esc(c.commentaire)}</div>` : ''}
    ${can('cuisine.statut') && next ? `<div class="kfoot"><button class="btn lg block ${c.statut_cuisine === 'EN_PREPARATION' ? 'primary' : ''}" data-id="${c.id}" data-st="${next[0]}">${next[1]}</button></div>` : ''}
  </div>`;
}
async function vRecap(el) {
  S.recapH = S.recapH || S.config.recap_heures;
  const d = await GET('/cuisine/recap?heures=' + S.recapH);
  setTitle(t('nav.cuisine'), t('recap_sous', { h: d.heures, n: d.commandes.length }), cuisineActions());
  const maxQ = Math.max(1, ...d.articles.map(a => Number(a.quantite)));
  el.innerHTML = `
    <div class="row" style="margin-bottom:10px">${cuisineTabs(null, null)}</div>
    <div class="period">${[4, 8, 12, 24].map(h => `<button class="tab ${Number(S.recapH) === h ? 'active' : ''}" data-h="${h}">${t('n_heures', { n: h })}</button>`).join('')}
      <span class="small muted">${t('recap_defaut', { h: S.config.recap_heures })}${can('parametres.cuisine', 'parametres.gerer') ? ` · <a href="#/parametres">${t('modifier')}</a>` : ''}</span></div>
    <div class="kpis">
      <div class="kpi"><div class="lbl">${t('commandes')}</div><div class="val">${d.commandes.length}</div></div>
      <div class="kpi"><div class="lbl">${t('articles')}</div><div class="val">${d.articles.reduce((s, a) => s + Number(a.quantite), 0)}</div></div>
      <div class="kpi"><div class="lbl">${t('duree_moyenne')}</div><div class="val">${d.duree_moyenne != null ? duree(d.duree_moyenne) : '—'}</div></div>
    </div>
    <div class="recap-grid">
      <div class="card"><h2 style="margin-bottom:12px">🍽️ ${t('total_par_plat')}</h2><div class="bars">${d.articles.map(a => `<div class="bar"><span class="lb">${esc(platNom(a.plat_id, a.libelle))}</span>
        <div class="track"><div class="fill" style="width:${a.quantite / maxQ * 100}%"></div></div><b class="num">${a.quantite}</b></div>`).join('') || `<div class="muted">—</div>`}</div></div>
      <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="tbl"><thead><tr><th>N°</th><th>${t('service')}</th><th>${t('validee')}</th><th>${t('prete')}</th><th>${t('articles')}</th></tr></thead>
        <tbody>${d.commandes.map(c => `<tr><td><b>${esc(c.numero)}</b></td><td>${esc(lieu(c))}</td><td class="small">${hhmm(c.validee_at)}</td>
          <td class="small">${c.prete_at ? hhmm(c.prete_at) + ` <span class="muted">(${duree(Math.round((new Date(c.prete_at) - new Date(c.validee_at)) / 60000))})</span>` : badgeCuisine(c.statut_cuisine)}</td>
          <td class="small">${c.lignes.map(l => `${l.quantite}× ${esc(platNom(l.plat_id, l.libelle))}`).join(', ')}</td></tr>`).join('')}</tbody></table></div></div>
    </div>`;
  bindCuisine(el);
  $$('[data-h]', el).forEach(b => b.onclick = () => { S.recapH = Number(b.dataset.h); softRender(); });
}
