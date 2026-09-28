/* =====================================================================
   Prise de commande et factures (même écran) : les plats d'abord,
   les informations client ensuite (facultatives), commentaire et
   précision par article, validation (+ impression), encaissement Cash / Visa
   ===================================================================== */
'use strict';

const STATUT = { BROUILLON: ['st.brouillon', 'warn'], VALIDEE: ['st.validee', 'info'], PAYEE: ['st.payee', 'ok'], ANNULEE: ['st.annulee', 'bad'], SUPPRIMEE: ['st.supprimee', 'bad'], A_PAYER: ['st.a_payer', 'info'] };
const CUISINE = { EN_ATTENTE: ['cu.attente', '', '⏳'], EN_PREPARATION: ['cu.prepa', 'warn', '🔥'], PRETE: ['cu.prete', 'ok', '✅'], SERVIE: ['cu.servie', '', '🍽️'] };
const LIVR = { DISPONIBLE: ['lv.disponible', 'warn', '📦'], ACCEPTEE: ['lv.acceptee', 'info', '🛵'], EN_ROUTE: ['lv.en_route', 'info', '🚗'], LIVREE: ['lv.livree', 'ok', '✅'] };
const SVC_ICO = { SUR_PLACE: '🪑', EMPORTER: '🥡', LIVRAISON: '🛵' };
const badgeStatut = s => STATUT[s] ? `<span class="badge ${STATUT[s][1]}">${t(STATUT[s][0])}</span>` : '';
const badgeCuisine = s => CUISINE[s] ? `<span class="badge ${CUISINE[s][1]}">${CUISINE[s][2]} ${t(CUISINE[s][0])}</span>` : '';
const badgeLivr = s => LIVR[s] ? `<span class="badge ${LIVR[s][1]}">${LIVR[s][2]} ${t(LIVR[s][0])}</span>` : '';
const estRouge = f => f && (f.statut === 'A_PAYER' || f.facture_statut === 'A_PAYER') && minutesSince(f.facture_at || f.created_at) >= S.config.delai_rouge;

function lieu(c) {
  const code = c.emplacement || c.emplacement_code;
  if (c.type_service === 'SUR_PLACE') return `🪑 ${code || t('sans_table')}`;
  if (c.type_service === 'EMPORTER') return `🥡 ${c.client_nom || [c.voiture_couleur, c.voiture_immat].filter(Boolean).join(' ') || t('svc.EMPORTER')}`;
  return `🛵 ${c.client_nom || t('svc.LIVRAISON')}`;
}
const lieuTexte = c => lieu(c).replace(/^\S+\s/, '');

async function loadMenu(force) {
  if (!S.menu || force) S.menu = await GET('/menu');
  return S.menu;
}

// ------------------------------------------------------------------ vues
async function vCommande(el, id) {
  await loadMenu();
  if (!id || id === 'new') {
    const qy = S.route.query;
    S.doc = { kind: 'nouvelle', data: { id: null, numero: t('nouvelle_commande'), statut: 'BROUILLON', type_service: qy.type || 'SUR_PLACE',
      emplacement_id: qy.table ? Number(qy.table) : null, emplacement: qy.code || null, serveur_id: Number(qy.serveur) || S.user.id,
      serveur_nom: qy.serveur_nom || S.user.nom_complet, lignes: [], total: 0, nb_articles: 0 } };
  } else {
    const c = await GET('/commandes/' + id);
    if (c.statut !== 'BROUILLON' && c.facture_id) { history.replaceState(null, '', '#/facture/' + c.facture_id); return vFacture(el, c.facture_id); }
    S.doc = { kind: 'commande', data: c };
  }
  renderPOS(el);
}
async function vFacture(el, id) {
  await loadMenu();
  S.doc = { kind: 'facture', data: await GET('/factures/' + id) };
  renderPOS(el);
}

function caps() {
  const { kind, data: d } = S.doc;
  const mien = d.serveur_id === S.user.id || can('commande.voir_toutes', 'commande.gerer_toutes');
  if (kind === 'nouvelle') return { add: can('commande.creer'), remove: true, infos: false, svc: true, mien: true };
  if (kind === 'commande') {
    if (d.statut !== 'BROUILLON' || !mien) return { add: false, remove: false, infos: false, svc: false, mien };
    return { add: can('commande.ajouter_article'), remove: can('commande.retirer_article'), infos: true, svc: true, mien };
  }
  const voit = mien || d.livreur_id === S.user.id;
  const edit = voit && ((d.statut === 'A_PAYER' && can('facture.modifier')) || (d.statut === 'PAYEE' && can('facture.modifier_reglee')));
  return { add: edit, remove: edit, infos: edit, svc: false, mien };
}

function renderPOS(el) {
  const d = S.doc.data, k = caps();
  const titre = S.doc.kind === 'facture' ? `${d.numero} · ${d.commande_numero}` : `${d.numero}`;
  setTitle(titre, `${t('svc.' + d.type_service)} — ${d.serveur_nom}`,
    `<button class="btn sm" id="back">← <span class="hide-m">${t('retour')}</span></button>`);
  $('#back').onclick = () => (history.length > 1 ? history.back() : go(S.lastList || home()));
  if (!S.pos.tab) S.pos.tab = 'top';
  el.innerHTML = `
    <div class="pos">
      <div class="pos-menu" ${k.add ? '' : 'style="display:none"'}>
        <div class="search"><input class="input" id="pos-q" placeholder="${t('rechercher_plat')}" value="${esc(S.pos.q)}" autocomplete="off"></div>
        <div class="tabs" id="pos-tabs"></div><div id="pos-sugg"></div><div class="dish-grid" id="pos-grid"></div>
      </div>
      <div class="card ticket" id="ticket"></div>
      ${k.add ? '' : '<div class="card" id="c-info-side"></div>'}
    </div>
    <button class="btn primary cart-fab ${k.add ? '' : 'hidden'}" id="cart-fab"></button>`;
  if (!k.add) {
    $('.pos', el).style.gridTemplateColumns = 'minmax(0,560px) 1fr';
    const tk = $('#ticket', el);
    tk.classList.add('open'); tk.style.position = 'static'; tk.style.transform = 'none'; tk.style.maxHeight = 'none';
    renderInfoSide();
  }
  renderPosTabs(); renderGrid(); renderTicket(); loadSuggestions();
  $('#pos-q', el)?.addEventListener('input', e => { S.pos.q = e.target.value; renderGrid(); });
  $('#cart-fab', el).onclick = () => openSheet(true);
}

function renderInfoSide() {
  const box = $('#c-info-side');
  if (!box) return;
  const d = S.doc.data;
  box.innerHTML = `<h2 style="margin-bottom:10px">${t('informations')}</h2>${infoList(d)}
    ${d.modifications?.length ? `<h3 style="margin:16px 0 6px">${t('historique_modifs')}</h3>${histList(d.modifications)}` : ''}`;
}
function infoList(d) {
  const rows = [[t('service'), `${SVC_ICO[d.type_service]} ${t('svc.' + d.type_service)}`]];
  const code = d.emplacement || d.emplacement_code;
  if (code) rows.push([t('table'), `${code}${d.zone || d.zone_nom ? ' (' + (d.zone || d.zone_nom) + ')' : ''}`]);
  if (d.nb_couverts) rows.push([t('couverts'), d.nb_couverts]);
  if (d.voiture_couleur || d.voiture_immat) rows.push([t('voiture'), `${d.voiture_couleur || ''} ${d.voiture_immat || ''}`]);
  if (d.client_nom) rows.push([t('client'), d.client_nom]);
  if (d.client_tel) rows.push([t('telephone'), `<a href="tel:${esc(d.client_tel)}">${esc(d.client_tel)}</a>`]);
  const wa = d.client_whatsapp || d.client_tel;
  if (wa) rows.push(['WhatsApp', `<a href="${esc(waLien(wa))}" target="_blank" rel="noopener">💬 ${esc(wa)}</a>`]);
  if (d.adresse) rows.push([t('adresse'), d.adresse]);
  if (d.localisation) rows.push([t('localisation'), `<a href="${esc(mapLien(d.localisation))}" target="_blank" rel="noopener">📍 ${esc(d.localisation)}</a>`]);
  if (d.commentaire) rows.push([t('commentaire'), d.commentaire]);
  rows.push([t('serveur'), d.serveur_nom]);
  if (d.caissier_nom) rows.push([t('encaisse_par'), d.caissier_nom]);
  if (d.livreur_nom) rows.push([t('livreur'), d.livreur_nom]);
  rows.push([t('ouverte_a'), hhmm(d.created_at)]);
  if (d.payee_at) rows.push([t('payee_a'), `${dateTime(d.payee_at)} · ${t('mode.' + d.mode_paiement)}`]);
  const safe = v => (typeof v === 'string' && v.startsWith('<')) ? v : esc(v);
  return `<dl class="info-list">${rows.map(([a, b]) => `<dt>${a}</dt><dd>${safe(b)}</dd>`).join('')}</dl>`;
}
function histList(mods) {
  return mods.map(m => `<div class="small" style="padding:6px 0;border-bottom:1px solid #f1ede7"><b>${esc(m.utilisateur_nom)}</b> · ${dateTime(m.created_at)}<br>
    ${t('modif.' + m.action, {}, m.action)} — ${esc(m.details)} <span class="muted">(${money(m.ancien_total)} → ${money(m.nouveau_total)})</span></div>`).join('');
}

// ------------------------------------------------------------------ menu (classement intelligent)
function renderPosTabs() {
  const box = $('#pos-tabs');
  if (!box) return;
  const m = S.menu;
  const tabs = [['top', '⭐ ' + t('pour_vous')], ...(m.plats.some(p => p.du_jour) ? [['jour', '🌟 ' + t('menu_du_jour')]] : []),
    ...m.categories.map(c => [String(c.id), `${c.icone} ${tr(c)}`])];
  box.innerHTML = tabs.map(([k, l]) => `<button class="tab ${S.pos.tab === k ? 'active' : ''}" data-k="${k}">${esc(l)}</button>`).join('');
  $$('.tab', box).forEach(b => b.onclick = () => { S.pos.tab = b.dataset.k; S.pos.q = ''; const q = $('#pos-q'); if (q) q.value = ''; renderPosTabs(); renderGrid(); });
}
function renderGrid() {
  const grid = $('#pos-grid');
  if (!grid) return;
  let list = S.menu.plats.filter(p => p.disponible || S.pos.tab !== 'top');
  const q = norm(S.pos.q);
  const parScore = (a, b) => b.score - a.score || a.id - b.id;
  if (q) list = list.filter(p => norm([p.nom, ...Object.values(p.traductions || {}), p.description].join(' ')).includes(q)).sort(parScore);
  else if (S.pos.tab === 'jour') list = list.filter(p => p.du_jour);
  else if (S.pos.tab === 'top') list = [...list].sort(parScore).slice(0, 12);
  else list = list.filter(p => String(p.categorie_id) === S.pos.tab).sort(parScore); // les plus utilisés en premier
  const qty = {};
  for (const l of S.doc.data.lignes || []) qty[l.plat_id] = (qty[l.plat_id] || 0) + l.quantite;
  grid.innerHTML = list.map(p => `<div class="dish ${p.disponible ? '' : 'off'} ${p.image ? 'has-ph' : ''}" data-id="${p.id}">
      ${p.image ? `<div class="ph" style="background-image:url('${esc(p.image)}')"></div>` : ''}
      ${qty[p.id] ? `<span class="qty">${qty[p.id]}</span>` : (p.du_jour && S.pos.tab !== 'jour' ? '<span class="tag">🌟</span>' : '')}
      <div class="nm">${esc(tr(p))}</div>${p.description ? `<div class="ds">${esc(p.description)}</div>` : ''}
      <div class="pr">${!p.disponible ? t('epuise') : p.du_jour && p.prix_special != null ? `${money(p.prix_special)} <s class="muted small" style="font-weight:500">${money(p.prix_carte)}</s>` : money(p.prix_effectif)}</div></div>`).join('')
    || `<div class="empty" style="grid-column:1/-1"><div class="big">🔎</div>${t('aucun_resultat')}</div>`;
  $$('.dish', grid).forEach(dd => dd.onclick = () => ajouterPlat(Number(dd.dataset.id), dd));
}
let suggTimer;
function loadSuggestions() {
  clearTimeout(suggTimer);
  suggTimer = setTimeout(async () => {
    const box = $('#pos-sugg');
    if (!box || !caps().add) return;
    const ids = [...new Set((S.doc.data.lignes || []).map(l => l.plat_id).filter(Boolean))];
    if (!ids.length) { box.innerHTML = ''; return; }
    const s = await GET('/suggestions?plats=' + ids.join(',')).catch(() => null);
    const plats = (s?.associes || []).map(a => S.menu.plats.find(p => p.id === a.id)).filter(Boolean);
    box.innerHTML = plats.length ? `<div class="small muted" style="font-weight:600;margin-bottom:4px">💡 ${t('souvent_avec')}</div>
      <div class="suggest">${plats.map(p => `<button class="chip" data-id="${p.id}">+ ${esc(tr(p))} · ${money(p.prix_effectif)}</button>`).join('')}</div>` : '';
    $$('.chip', box).forEach(ch => ch.onclick = () => ajouterPlat(Number(ch.dataset.id)));
  }, 250);
}

// ------------------------------------------------------------------ actions sur le document
async function ajouterPlat(platId, node) {
  node?.animate?.([{ transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 160 });
  const { kind, data: d } = S.doc;
  let r;
  if (kind === 'nouvelle') {
    r = await act(() => POST('/commandes', { type_service: d.type_service, emplacement_id: d.emplacement_id, serveur_id: d.serveur_id, lignes: [{ plat_id: platId, quantite: 1 }] }));
    if (r) { S.doc = { kind: 'commande', data: r }; history.replaceState(null, '', '#/commande/' + r.id); setTitle(r.numero, `${t('svc.' + r.type_service)} — ${r.serveur_nom}`, $('#page-actions').innerHTML); $('#back').onclick = () => go(S.lastList || home()); }
  } else if (kind === 'commande') r = await act(() => POST(`/commandes/${d.id}/lignes`, { plat_id: platId, quantite: 1 }));
  else r = await act(() => POST(`/factures/${d.id}/lignes`, { plat_id: platId, quantite: 1 }));
  if (r && kind !== 'nouvelle') S.doc.data = r;
  if (r) { renderTicket(); renderGrid(); loadSuggestions(); }
}
async function majLigne(l, champs) {
  const { kind, data: d } = S.doc;
  const base = kind === 'commande' ? `/commandes/${d.id}/lignes/${l.id}` : `/factures/${d.id}/lignes/${l.id}`;
  const r = await act(() => champs.quantite === 0 ? DEL(base) : PATCH(base, champs));
  if (r) { S.doc.data = r; renderTicket(); renderGrid(); renderInfoSide(); }
}
async function majInfos(champs) {
  const { kind, data: d } = S.doc;
  if (kind === 'nouvelle') { Object.assign(d, champs); renderTicket(); return; }
  const r = await act(() => kind === 'commande' ? PATCH(`/commandes/${d.id}`, champs)
    : (champs.emplacement_id !== undefined || champs.serveur_id !== undefined) && d.commande_id ? PATCH(`/commandes/${d.commande_id}`, champs).then(() => GET('/factures/' + d.id))
    : PATCH(`/factures/${d.id}`, champs));
  if (r) { S.doc.data = r; renderTicket(); renderInfoSide(); }
  return r;
}
async function refreshDoc(evt = {}) {
  if (!S.doc || S.doc.kind === 'nouvelle' || $('.overlay')) return;
  const d = S.doc.data;
  const cid = S.doc.kind === 'commande' ? d.id : d.commande_id;
  if (evt.id && cid && String(evt.id) !== String(cid) && evt.scope !== 'livraisons') return;
  try {
    if (S.doc.kind === 'commande') {
      const c = await GET('/commandes/' + d.id);
      if (c.statut !== 'BROUILLON' && c.facture_id) return go('facture/' + c.facture_id);
      S.doc.data = c;
    } else S.doc.data = await GET('/factures/' + d.id);
    if (document.activeElement?.closest('#ticket')) return;
    renderTicket(); renderGrid(); renderInfoSide();
  } catch { /* supprimée entre-temps */ }
}

// ------------------------------------------------------------------ ticket
function renderTicket() {
  const tk = $('#ticket');
  if (!tk) return;
  const { kind, data: d } = S.doc;
  const k = caps();
  const lignes = d.lignes || [];
  const nb = lignes.reduce((s, l) => s + l.quantite, 0);
  const total = kind === 'facture' ? Number(d.montant_total) : lignes.reduce((s, l) => s + l.prix_unitaire * l.quantite, 0);
  const sousTotal = kind === 'facture' ? Number(d.sous_total) : total;
  const rouge = kind === 'facture' && d.statut === 'A_PAYER';
  const infosVisibles = kind !== 'nouvelle' && nb > 0;
  const autreServeur = kind === 'facture' && k.infos && d.serveur_id !== S.user.id;
  const code = d.emplacement || d.emplacement_code;
  tk.innerHTML = `
    <div class="ticket-head">
      <div class="row"><h2 class="grow">${esc(kind === 'facture' ? d.numero : d.numero)}</h2>
        ${kind === 'facture' ? badgeStatut(d.statut) : kind === 'commande' ? badgeStatut(d.statut) : ''}
        ${d.statut_cuisine && kind === 'facture' && d.commande_id ? badgeCuisine(d.statut_cuisine) : ''}</div>
      <div class="small muted" style="margin-top:4px">${esc(lieu(d))}${d.nb_couverts ? ` · ${t('n_pers', { n: d.nb_couverts })}` : ''} · ${esc(d.serveur_nom)}
        ${kind === 'facture' ? ` · ${esc(d.commande_numero)}` : ''}</div>
      ${rouge ? `<div class="alert ${estRouge(d) ? 'rouge' : 'info'} small" style="margin:8px 0 0" data-since="${esc(d.created_at)}" data-limite="${S.config.delai_rouge}" data-cls="rouge">
        <span>⏱</span><span>${t('attente_paiement')} <b class="minuteur">${duree(minutesSince(d.created_at))}</b></span></div>` : ''}
      ${k.svc ? `<div class="svc">${Object.keys(SVC_ICO).map(s => `<button data-svc="${s}" class="${d.type_service === s ? 'on' : ''}">${SVC_ICO[s]} ${t('svc.' + s)}</button>`).join('')}</div>` : ''}
      <div class="row" style="gap:6px;margin-top:8px">
        ${d.type_service === 'SUR_PLACE' && (k.svc || (kind === 'facture' && k.infos && d.commande_id)) ? `<button class="btn sm" id="t-table">🪑 ${code ? esc(code) : t('choisir_table')}</button>` : ''}
        ${can('commande.gerer_toutes') && kind !== 'facture' && !['SUPPRIMEE', 'ANNULEE'].includes(d.statut) ? `<button class="btn sm" id="t-serv">👤 ${esc(d.serveur_nom)}</button>` : ''}
      </div>
      ${autreServeur ? `<div class="alert alerte small" style="margin:10px 0 0"><span>✏️</span><span>${t('modif_notifie', { nom: d.serveur_nom })}</span></div>` : ''}
    </div>
    <div class="ticket-lines">${lignes.length ? lignes.map(l => `
      <div class="line" data-id="${l.id}">
        <div><div class="lb">${esc(platNom(l.plat_id, l.libelle))}</div><div class="pu">${money(l.prix_unitaire)} × ${l.quantite}</div>
          ${k.remove || k.add ? `<button class="prec" data-note>✎ ${l.note ? t('modifier_precision') : t('ajouter_precision')}</button>` : ''}</div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><div class="tt">${money(l.prix_unitaire * l.quantite)}</div>
          ${k.add || k.remove ? `<div class="stepper"><button data-dec ${k.remove ? '' : 'disabled'}>−</button><span>${l.quantite}</span><button data-inc ${k.add ? '' : 'disabled'}>+</button></div>` : ''}</div>
        ${l.note ? `<div class="nt">📝 ${esc(l.note)}</div>` : ''}
      </div>`).join('') : `<div class="empty"><div class="big">🍽️</div>${t('touchez_plat')}</div>`}
    </div>
    ${infosVisibles ? `
    <div class="comment-box"><textarea class="input" id="t-comment" placeholder="💬 ${t('commentaire_commande')}" ${k.infos ? '' : 'readonly'}>${esc(d.commentaire || '')}</textarea></div>
    <details class="infos" id="t-infos" ${(d.type_service !== 'SUR_PLACE' && !d.client_tel && !d.voiture_immat && k.infos) || S.infosOuvertes ? 'open' : ''}>
      <summary>👤 ${t('infos_client')} <span class="muted small" style="font-weight:500">(${t('facultatif')})</span></summary>
      ${champsClientHtml(d, !k.infos)}
    </details>` : kind === 'nouvelle' ? `<div class="small muted" style="padding:6px 18px">💡 ${t('plats_dabord')}</div>` : ''}
    <div class="ticket-foot">
      ${Number(d.remise) > 0 ? `<div class="row small"><span class="grow muted">${t('sous_total')}</span><span class="num">${money(sousTotal)}</span></div>
        <div class="row small" style="margin-bottom:6px"><span class="grow muted">${t('remise')}</span><span class="num">− ${money(d.remise)}</span></div>` : ''}
      <div class="total-row"><span class="muted">${t('n_articles', { n: nb })}</span><b>${money(total)}</b></div>
      ${kind === 'facture' && d.statut === 'PAYEE' ? `<div class="small muted" style="margin:-4px 0 10px">${t('payee_par', { mode: t('mode.' + d.mode_paiement), nom: d.caissier_nom, h: hhmm(d.payee_at) })}${Number(d.monnaie_rendue) > 0 ? ` · ${t('rendu')} ${money(d.monnaie_rendue)}` : ''}</div>` : ''}
      ${kind === 'facture' && d.type_service === 'LIVRAISON' ? livraisonBloc(d) : ''}
      <div style="display:grid;gap:8px">${actionsTicket(nb)}</div>
    </div>`;
  const fab = $('#cart-fab');
  if (fab) fab.innerHTML = `<span>🧾 ${t('n_articles', { n: nb })}</span><b>${money(total)} ›</b>`;
  $$('.line', tk).forEach(row => {
    const l = lignes.find(x => String(x.id) === row.dataset.id);
    $('[data-inc]', row)?.addEventListener('click', () => majLigne(l, { quantite: l.quantite + 1 }));
    $('[data-dec]', row)?.addEventListener('click', async () => {
      if (l.quantite - 1 < 1 && !(await confirmBox(t('retirer_q', { nom: esc(platNom(l.plat_id, l.libelle)) }), { ok: t('retirer'), danger: true }))) return;
      majLigne(l, { quantite: l.quantite - 1 });
    });
    $('[data-note]', row)?.addEventListener('click', () => precisionModal(l));
  });
  $$('[data-svc]', tk).forEach(b => b.onclick = () => { if (b.dataset.svc !== d.type_service) majInfos({ type_service: b.dataset.svc }); });
  $('#t-table', tk)?.addEventListener('click', () => choisirTable());
  $('#t-serv', tk)?.addEventListener('click', choisirServeur);
  const cm = $('#t-comment', tk);
  if (cm && k.infos) cm.onchange = () => majInfos({ commentaire: cm.value });
  const det = $('#t-infos', tk);
  if (det) {
    det.ontoggle = () => { S.infosOuvertes = det.open; };
    if (k.infos) $$('[name]', det).forEach(i => i.onchange = () => majInfos({ [i.name]: i.value }));
  }
  bindActions(tk);
}
function champsClientHtml(d, ro) {
  const f = (name, label, type = 'text', ph = '') => `<label class="field"><span>${label}</span><input class="input" name="${name}" type="${type}" value="${esc(d[name] || '')}" placeholder="${esc(ph)}" ${ro ? 'readonly' : ''}></label>`;
  const tel = f('client_tel', '📞 ' + t('telephone'), 'tel', '05X XXX XXXX');
  const wa = f('client_whatsapp', '💬 WhatsApp', 'tel', t('wa_meme_tel'));
  const nom = f('client_nom', t('nom_client'));
  if (d.type_service === 'EMPORTER') return `<div class="grid2">${f('voiture_couleur', '🚗 ' + t('couleur_voiture'))}${f('voiture_immat', t('immatriculation'), 'text', 'DXB A 12345')}${nom}${tel}</div>${wa}`;
  if (d.type_service === 'LIVRAISON') return `<div class="grid2">${nom}${tel}</div>${wa}${f('adresse', '🏠 ' + t('adresse'))}${f('localisation', '📍 ' + t('localisation'), 'text', t('localisation_ph'))}`;
  return `<div class="grid2">${nom}${tel}</div>`;
}
function livraisonBloc(d) {
  const tel = d.client_whatsapp || d.client_tel;
  return `<div class="card" style="box-shadow:none;background:#faf8f5;padding:10px 12px;margin-bottom:10px">
    <div class="row"><b class="grow">🛵 ${t('livraison')}</b>${badgeLivr(d.statut_livraison)}</div>
    <div class="small muted" style="margin:4px 0 8px">${d.livreur_nom ? t('livreur') + ' : ' + esc(d.livreur_nom) : t('aucun_livreur')}</div>
    <div class="row" style="gap:6px">
      ${tel ? `<a class="btn sm wa" href="${esc(waLien(tel, t('wa_message', { resto: S.config.nom, numero: d.commande_numero })))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}
      ${d.client_tel ? `<a class="btn sm" href="tel:${esc(d.client_tel)}">📞</a>` : ''}
      ${d.localisation ? `<a class="btn sm" href="${esc(mapLien(d.localisation))}" target="_blank" rel="noopener">📍</a>` : ''}
      ${can('livraison.assigner') && d.statut_livraison !== 'LIVREE' ? `<button class="btn sm" data-a="liv-assigner">👤 ${t('assigner')}</button>` : ''}
      ${can('livraison.retirer') && d.livreur_id && d.statut_livraison !== 'LIVREE' ? `<button class="btn sm danger" data-a="liv-retirer">${t('retirer_livreur')}</button>` : ''}
      ${can('livraison.assigner') && d.livreur_id && d.statut_livraison !== 'LIVREE' ? `<button class="btn sm" data-a="liv-livree">✅ ${t('marquer_livree')}</button>` : ''}
    </div></div>`;
}
function actionsTicket(nb) {
  const { kind, data: d } = S.doc;
  const k = caps();
  const b = [];
  const vide = nb ? '' : 'disabled';
  const ligne = arr => arr.length ? `<div class="row" style="display:grid;grid-template-columns:repeat(${arr.length},1fr)">${arr.join('')}</div>` : '';
  if (kind !== 'facture' && d.statut === 'BROUILLON' && k.mien) {
    if (can('commande.valider')) {
      b.push(`<button class="btn primary lg" data-a="valider" ${vide}>✓ ${t('valider_envoyer')}</button>`);
      if (can('facture.imprimer')) b.push(`<button class="btn lg" data-a="valider-imprimer" ${vide} style="border-color:var(--accent);color:var(--accent)">✓ ${t('valider_imprimer')}</button>`);
    }
    if (kind === 'commande') {
      const r = [];
      if (can('commande.annuler')) r.push(`<button class="btn danger" data-a="annuler">${t('annuler')}</button>`);
      if (can('commande.supprimer') && (d.serveur_id === S.user.id || can('commande.gerer_toutes'))) r.push(`<button class="btn danger" data-a="supprimer">🗑️ ${t('supprimer')}</button>`);
      b.push(ligne(r));
    }
  }
  if (kind === 'facture') {
    if (d.statut === 'A_PAYER' && can('facture.payer')) b.push(`<button class="btn primary lg" data-a="payer">💰 ${t('encaisser')} ${money(d.montant_total)}</button>`);
    if (d.statut === 'A_PAYER' && !can('facture.payer')) b.push(`<div class="alert info small" style="margin:0"><span>🧾</span><span>${t('envoyee_caisse')}</span></div>`);
    if (d.commande_id && d.statut_cuisine === 'PRETE' && d.type_service !== 'LIVRAISON' && ((can('commande.marquer_servie') && k.mien) || can('cuisine.statut')))
      b.push(`<button class="btn" data-a="servie">🍽️ ${t(d.type_service === 'EMPORTER' ? 'marquer_remise' : 'marquer_servie')}</button>`);
    if (['A_PAYER', 'PAYEE'].includes(d.statut)) {
      const r = [];
      if (can('facture.remise') && k.infos) r.push(`<button class="btn" data-a="remise">🏷️ ${t('remise')}</button>`);
      if (can('facture.imprimer')) r.push(`<button class="btn" data-a="imprimer">🖨️ ${t('imprimer')}</button>`);
      if (d.modifications?.length) r.push(`<button class="btn" data-a="histo">🕘 ${d.modifications.length}</button>`);
      b.push(ligne(r));
      if ((d.statut === 'A_PAYER' && can('facture.supprimer')) || (d.statut === 'PAYEE' && can('facture.supprimer_reglee')))
        b.push(`<button class="btn danger sm" data-a="supprimer">🗑️ ${t('supprimer_facture')}</button>`);
    }
  }
  if (d.statut === 'SUPPRIMEE') {
    b.push(`<div class="alert alerte small" style="margin:0"><span>🗑️</span><span>${t('dans_corbeille', { nom: esc(d.supprime_par_nom || '?'), date: dateTime(d.supprime_at) })}${d.motif_suppression ? ' · ' + esc(d.motif_suppression) : ''}</span></div>`);
    const r = [];
    if (can('corbeille.restaurer')) r.push(`<button class="btn" data-a="restaurer">↩️ ${t('restaurer')}</button>`);
    if (can('corbeille.vider')) r.push(`<button class="btn danger solid" data-a="purger">${t('supprimer_definitivement')}</button>`);
    b.push(ligne(r));
  }
  if (d.statut === 'ANNULEE') b.push(`<div class="alert alerte small" style="margin:0">${t('commande_annulee')}</div>`);
  return b.join('');
}
function bindActions(tk) {
  const { kind, data: d } = S.doc;
  $$('[data-a]', tk).forEach(btn => btn.onclick = async () => {
    const a = btn.dataset.a;
    if (a === 'valider' || a === 'valider-imprimer') await valider(a === 'valider-imprimer');
    else if (a === 'annuler') {
      if (await confirmBox(t('annuler_commande_q'), { danger: true, ok: t('oui_annuler') }) && await act(() => POST(`/commandes/${d.id}/annuler`), t('commande_annulee'))) go(S.lastList || home());
    } else if (a === 'supprimer') { if (await deleteBox()) go(S.lastList || home()); }
    else if (a === 'payer') payModal(d);
    else if (a === 'servie') { if (await act(() => PATCH(`/commandes/${d.commande_id}/cuisine`, { statut_cuisine: 'SERVIE' }), t('c_est_note'))) refreshDoc(); }
    else if (a === 'imprimer') printTicket(d);
    else if (a === 'histo') modal({ title: `${t('historique_modifs')} — ${esc(d.numero)}`, body: histList(d.modifications) });
    else if (a === 'remise') remiseModal(d);
    else if (a === 'restaurer') { if (await act(() => POST(`/corbeille/${kind === 'facture' ? 'facture' : 'commande'}/${d.id}/restaurer`), t('restaure'))) refreshDoc(); }
    else if (a === 'purger') {
      if (await confirmBox(t('suppr_def_q', { n: esc(d.numero) }), { danger: true, ok: t('supprimer_definitivement') })
        && await act(() => DEL(`/corbeille/${kind === 'facture' ? 'facture' : 'commande'}/${d.id}`), t('supprime_def'))) go('caisse');
    } else if (a === 'liv-assigner') assignerLivreur(d, refreshDoc);
    else if (a === 'liv-retirer') { if (await confirmBox(t('retirer_livreur_q', { nom: esc(d.livreur_nom) })) && await act(() => POST(`/livraisons/${d.id}/retirer`), t('livreur_retire'))) refreshDoc(); }
    else if (a === 'liv-livree') { if (await act(() => POST(`/livraisons/${d.id}/livree`), t('livraison_ok'))) refreshDoc(); }
  });
}
async function assignerLivreur(f, apres) {
  const livreurs = await GET('/livreurs');
  const m = modal({
    title: `🛵 ${t('assigner_livreur')} — ${esc(f.commande_numero || f.numero)}`,
    body: livreurs.length ? `<div style="display:grid;gap:8px">${livreurs.map(u => `<button class="pay-mode ${u.id === f.livreur_id ? 'active' : ''}" data-l="${u.id}">
      ${avatar({ ...u, role_couleur: '#4d7c0f' })}<span style="text-align:start"><b>${esc(u.nom_complet)}</b><br><small class="muted">${t('n_en_cours', { n: u.en_cours })}</small></span></button>`).join('')}</div>`
      : `<div class="empty">${t('aucun_livreur_compte')}</div>`
  });
  $$('[data-l]', m.el).forEach(b => b.onclick = async () => {
    if (await act(() => POST(`/livraisons/${f.id}/assigner`, { livreur_id: Number(b.dataset.l) }), t('livreur_assigne'))) { m.close(); apres?.(); }
  });
}

async function valider(imprimer) {
  const { kind, data: d } = S.doc;
  if (kind !== 'commande') return;
  if (d.type_service === 'SUR_PLACE' && !d.emplacement_id) { if (!(await choisirTable())) return; }
  const c = S.doc.data;
  if (c.type_service === 'LIVRAISON' && !c.client_tel && !c.adresse && !(await confirmBox(t('livraison_sans_infos')))) return;
  const r = await act(() => POST(`/commandes/${c.id}/valider`));
  if (!r) return;
  toast(t('validee_ok', { f: r.facture_numero }), 'ok');
  openSheet(false);
  if (imprimer) printTicket(await GET('/factures/' + r.facture_id));
  go(S.lastList && S.lastList !== 'commande' ? S.lastList : home());
}

function choisirTable() {
  return new Promise(async resolve => {
    let fini = false;
    const zones = await GET('/salle');
    const d = S.doc.data;
    const cid = S.doc.kind === 'commande' ? d.id : d.commande_id;
    const m = modal({
      title: '🪑 ' + t('choisir_table'), wide: true,
      body: zones.map(z => `<h3 style="margin:10px 0 6px">${esc(z.nom)}</h3><div class="row">${z.emplacements.map(e => {
        const occ = e.commande_id && e.commande_id !== cid;
        return `<button class="btn ${e.id === d.emplacement_id ? 'primary' : ''}" data-e="${e.id}" data-code="${esc(e.code)}" ${occ ? 'disabled' : ''} style="min-width:76px">${esc(e.code)}${occ ? ' •' : ''}</button>`;
      }).join('')}</div>`).join(''),
      onClose: () => { if (!fini) resolve(false); }
    });
    $$('[data-e]', m.el).forEach(b => b.onclick = async () => {
      const r = await majInfos({ emplacement_id: Number(b.dataset.e), ...(S.doc.kind === 'nouvelle' ? { emplacement: b.dataset.code } : {}) });
      if (r !== undefined || S.doc.kind === 'nouvelle') { fini = true; m.close(); resolve(true); }
    });
  });
}
async function serveurSelect(current) {
  S.serveurs = S.serveurs || await GET('/serveurs').catch(() => []);
  return `<div style="display:grid;gap:8px">${S.serveurs.map(u => `<button class="pay-mode ${u.id === current ? 'active' : ''}" data-s="${u.id}" data-nom="${esc(u.nom_complet)}">
    ${avatar(u)}<span style="text-align:start"><b>${esc(u.nom_complet)}</b>${u.id === S.user.id ? ` (${t('moi')})` : ''}<br><small class="muted">${roleNom(u.role)}</small></span></button>`).join('')}</div>`;
}
async function choisirServeur() {
  const d = S.doc.data;
  const m = modal({ title: '👤 ' + t('attribuer_serveur'), body: await serveurSelect(d.serveur_id) });
  $$('[data-s]', m.el).forEach(b => b.onclick = async () => {
    await majInfos({ serveur_id: Number(b.dataset.s), ...(S.doc.kind === 'nouvelle' ? { serveur_nom: b.dataset.nom } : {}) });
    m.close();
  });
}
function precisionModal(l) {
  const presets = t('precisions_rapides').split('|');
  const m = modal({
    title: `✎ ${t('precision')} — ${esc(platNom(l.plat_id, l.libelle))}`,
    body: `<div class="row" style="margin-bottom:10px">${presets.map(p => `<button class="chip" data-p="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <textarea class="input" id="note-in" placeholder="${t('precision_ph')}">${esc(l.note || '')}</textarea>`,
    foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('enregistrer')}</button>`
  });
  $$('[data-p]', m.el).forEach(b => b.onclick = () => { const i = $('#note-in', m.el); i.value = i.value ? `${i.value}, ${b.dataset.p}` : b.dataset.p; });
  $('#ok', m.el).onclick = async () => { m.close(); await majLigne(l, { note: $('#note-in', m.el).value }); };
}
function deleteBox() {
  return new Promise(resolve => {
    let done = false;
    const { kind, data: d } = S.doc;
    const motifs = t('motifs_suppression').split('|');
    const m = modal({
      title: `🗑️ ${t('supprimer')} ${esc(d.numero)}`,
      body: `<p style="margin-top:0">${t(can('corbeille.vider') ? 'suppr_info_manager' : 'suppr_info')}</p>
        <div class="row" style="margin-bottom:10px">${motifs.map(x => `<button class="chip" data-m="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <label class="field"><span>${t('motif')}</span><input class="input" id="motif"></label>`,
      foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn danger solid" id="ok">${t('supprimer')}</button>`,
      onClose: () => { if (!done) resolve(false); }
    });
    $$('[data-m]', m.el).forEach(b => b.onclick = () => { $('#motif', m.el).value = b.dataset.m; });
    $('#ok', m.el).onclick = async () => {
      const url = kind === 'facture' ? `/factures/${d.id}` : `/commandes/${d.id}`;
      if (await act(() => DEL(url, { motif: $('#motif', m.el).value }), t('place_corbeille'))) { done = true; m.close(); resolve(true); }
    };
  });
}
function remiseModal(f) {
  const m = modal({
    title: '🏷️ ' + t('appliquer_remise'),
    body: `<div class="row" style="margin-bottom:10px">${[5, 10, 15, 20].map(p => `<button class="btn sm" data-p="${p}">${p} %</button>`).join('')}</div>
      <label class="field"><span>${t('montant_remise')}</span><input class="input" id="rem" type="number" step="0.5" min="0" value="${f.remise || 0}"></label>
      <label class="field"><span>${t('motif')}</span><input class="input" id="motif"></label>`,
    foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('appliquer')}</button>`
  });
  $$('[data-p]', m.el).forEach(b => b.onclick = () => { $('#rem', m.el).value = (f.sous_total * b.dataset.p / 100).toFixed(2); });
  $('#ok', m.el).onclick = async () => {
    const r = await act(() => POST(`/factures/${f.id}/remise`, { remise: $('#rem', m.el).value, motif: $('#motif', m.el).value }), t('remise_ok'));
    if (r) { S.doc.data = r; m.close(); renderTicket(); }
  };
}

// ------------------------------------------------------------------ encaissement (Cash ou Visa)
function payModal(f) {
  let mode = 'CASH';
  const total = Number(f.montant_total);
  const arr = v => Math.ceil(total / v) * v;
  const quick = [...new Set([total, arr(5), arr(10), arr(50), arr(100), 200, 500].filter(v => v >= total))].slice(0, 6);
  const m = modal({
    title: `💰 ${t('encaisser')} ${esc(f.numero)}`,
    body: `<div style="text-align:center;margin:4px 0 16px"><div class="muted small">${t('a_payer')}</div>
        <div style="font-size:2.3rem;font-weight:850;letter-spacing:-.02em" class="num">${money(total)}</div>
        <div class="small muted">${esc(lieuTexte(f))} · ${t('serveur')} : ${esc(f.serveur_nom)}</div></div>
      <div class="pay-modes"><button class="pay-mode active" data-m="CASH">💵 ${t('mode.CASH')}</button><button class="pay-mode" data-m="VISA">💳 ${t('mode.VISA')}</button></div>
      <div id="cash"><label class="field"><span>${t('montant_recu')}</span><input class="input num" id="recu" type="number" step="0.5" inputmode="decimal" value="${total}" style="font-size:1.2rem;font-weight:700"></label>
        <div class="quick">${quick.map(v => `<button class="btn sm" data-v="${v}">${money(v)}</button>`).join('')}</div>
        <div class="change" id="change"></div></div>`,
    foot: `<button class="btn" data-close>${t('annuler')}</button>${can('facture.imprimer') ? `<button class="btn lg" id="pay-print">✓ ${t('payer_imprimer')}</button>` : ''}<button class="btn primary lg" id="pay">✓ ${t('confirmer_paiement')}</button>`
  });
  const recu = $('#recu', m.el);
  const upd = () => {
    const d = Number(recu.value || 0) - total, ch = $('#change', m.el);
    ch.textContent = d >= 0 ? t('monnaie_rendre', { m: money(d) }) : t('il_manque', { m: money(-d) });
    ch.classList.toggle('neg', d < 0);
  };
  upd();
  recu.oninput = upd;
  $$('[data-v]', m.el).forEach(b => b.onclick = () => { recu.value = b.dataset.v; upd(); });
  $$('.pay-mode', m.el).forEach(b => b.onclick = () => {
    mode = b.dataset.m;
    $$('.pay-mode', m.el).forEach(x => x.classList.toggle('active', x === b));
    $('#cash', m.el).classList.toggle('hidden', mode !== 'CASH');
  });
  const payer = async imprimer => {
    const r = await act(() => POST(`/factures/${f.id}/payer`, { mode_paiement: mode, montant_recu: mode === 'CASH' ? recu.value : total }));
    if (!r) return;
    m.close();
    if (S.doc?.kind === 'facture' && S.doc.data.id === r.id) { S.doc.data = r; renderTicket(); renderInfoSide(); }
    if (imprimer) printTicket(r);
    const ok = modal({
      title: '✅ ' + t('paiement_ok'),
      body: `<p><b>${esc(r.numero)}</b> — ${money(r.montant_total)} (${t('mode.' + r.mode_paiement)})</p>
        ${Number(r.monnaie_rendue) > 0 ? `<div class="change">${t('rendre', { m: money(r.monnaie_rendue) })}</div>` : ''}
        <p class="small muted">${t('serveur')} : ${esc(r.serveur_nom)} · ${t('encaisse_par')} : ${esc(r.caissier_nom)}</p>`,
      foot: `${can('facture.imprimer') && !imprimer ? `<button class="btn" id="pr">🖨️ ${t('imprimer')}</button>` : ''}<button class="btn primary" data-close>${t('terminer')}</button>`,
      onClose: () => { if (S.route.name === 'facture') go('caisse'); }
    });
    $('#pr', ok.el)?.addEventListener('click', () => printTicket(r));
  };
  $('#pay', m.el).onclick = () => payer(false);
  $('#pay-print', m.el)?.addEventListener('click', () => payer(true));
}

// ------------------------------------------------------------------ ticket imprimé (dans la langue choisie)
function printTicket(f) {
  const lignes = (f.lignes || []).map(l => `<tr><td>${l.quantite} × ${esc(platNom(l.plat_id, l.libelle))}${l.note ? `<br><small>(${esc(l.note)})</small>` : ''}</td><td class="r">${money(l.prix_unitaire * l.quantite)}</td></tr>`).join('');
  const paye = f.statut === 'PAYEE';
  $('#print-area').innerHTML = `
    ${S.config.logo ? `<img src="${esc(S.config.logo)}" alt="">` : ''}
    <div class="c"><b style="font-size:15px">${esc(S.config.nom)}</b><br>${t(paye ? 'ticket_acquitte' : 'ticket_addition')}</div><hr>
    <div>${esc(f.numero || '')} · ${esc(f.commande_numero || '')}<br>${dateTime(f.payee_at || f.created_at)}<br>${esc(lieuTexte(f))} — ${t('svc.' + f.type_service)}</div><hr>
    <table>${lignes}</table><hr>
    <table>${Number(f.remise) > 0 ? `<tr><td>${t('sous_total')}</td><td class="r">${money(f.sous_total)}</td></tr><tr><td>${t('remise')}</td><td class="r">-${money(f.remise)}</td></tr>` : ''}
      <tr><td><b>${t('total')}</b></td><td class="r"><b>${money(f.montant_total)}</b></td></tr>
      ${paye ? `<tr><td>${t('mode.' + f.mode_paiement)}</td><td class="r">${money(f.montant_recu)}</td></tr>${Number(f.monnaie_rendue) > 0 ? `<tr><td>${t('rendu')}</td><td class="r">${money(f.monnaie_rendue)}</td></tr>` : ''}` : ''}</table><hr>
    ${f.commentaire ? `<div>${esc(f.commentaire)}</div><hr>` : ''}
    <div>${t('serveur')} : ${esc(f.serveur_nom)}${f.caissier_nom ? `<br>${t('encaisse_par')} : ${esc(f.caissier_nom)}` : ''}${f.livreur_nom ? `<br>${t('livreur')} : ${esc(f.livreur_nom)}` : ''}</div><hr>
    <div class="c">${t('merci')}</div>`;
  $('#print-area').dir = S.lang === 'ar' ? 'rtl' : 'ltr';
  setTimeout(() => {
    if (window.RestoDesktop?.print) window.RestoDesktop.print();
    else if (window.RestoAndroid?.print) window.RestoAndroid.print();
    else window.print();
  }, S.config.logo ? 250 : 0);
}

function openSheet(open) {
  const tk = $('#ticket');
  if (!tk || window.innerWidth > 860) return;
  $('.sheet-backdrop')?.remove();
  tk.classList.toggle('open', open);
  if (open) {
    const b = document.createElement('div');
    b.className = 'sheet-backdrop';
    b.onclick = () => openSheet(false);
    document.body.appendChild(b);
  }
}
