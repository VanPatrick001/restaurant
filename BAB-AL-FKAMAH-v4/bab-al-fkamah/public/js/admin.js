/* =====================================================================
   Menu (photos, traductions, prix par catégorie), tableau de bord,
   utilisateurs, groupes, rôles, journal, paramètres, mon compte
   ===================================================================== */
'use strict';

// ------------------------------------------------------------------ MENU
async function vMenu(el) {
  const menu = await loadMenu(true);
  S.menuTab = S.menuTab || 'carte';
  S.menuCat = S.menuCat || 'all';
  setTitle(t('nav.menu'), t('menu_sous', { p: menu.plats.length, c: menu.categories.length }),
    [can('menu.categorie_gerer') && S.menuTab === 'carte' ? `<button class="btn" id="add-cat">+ ${t('categorie')}</button>` : '',
     can('menu.item_ajouter') && S.menuTab === 'carte' ? `<button class="btn primary" id="add-plat">+ ${t('plat')}</button>` : '',
     can('menu.creer') && S.menuTab === 'menus' ? `<button class="btn primary" id="add-menu">+ ${t('nouveau_menu')}</button>` : ''].join(''));
  el.innerHTML = `<div class="tabs"><button class="tab ${S.menuTab === 'carte' ? 'active' : ''}" data-t="carte">📖 ${t('la_carte')}</button>
    <button class="tab ${S.menuTab === 'menus' ? 'active' : ''}" data-t="menus">🌟 ${t('menus_du_jour')}</button></div><div id="menu-body"></div>`;
  $$('[data-t]', el).forEach(b => b.onclick = () => { S.menuTab = b.dataset.t; vMenu(el); });
  $('#add-cat')?.addEventListener('click', () => catModal());
  $('#add-plat')?.addEventListener('click', () => platModal());
  $('#add-menu')?.addEventListener('click', () => menuModal());
  if (S.menuTab === 'carte') renderCarte($('#menu-body', el)); else renderMenus($('#menu-body', el));
}
function renderCarte(box) {
  const { categories, plats } = S.menu;
  const cats = S.menuCat === 'all' ? categories : categories.filter(c => String(c.id) === S.menuCat);
  const autres = p => ['fr', 'en', 'ar'].filter(l => l !== S.lang && p.traductions?.[l]).map(l => p.traductions[l]).join(' · ');
  box.innerHTML = `
    <div class="row" style="margin-bottom:12px"><div class="search grow" style="margin:0"><input class="input" id="mq" placeholder="${t('rechercher')}"></div>
      <select class="input" id="mcat" style="width:auto"><option value="all">${t('toutes_categories')}</option>${categories.map(c => `<option value="${c.id}" ${String(c.id) === S.menuCat ? 'selected' : ''}>${c.icone} ${esc(tr(c))}</option>`).join('')}</select></div>
    ${cats.map(cat => {
      const items = plats.filter(p => p.categorie_id === cat.id);
      return `<div class="card"><div class="card-head"><h2>${cat.icone} ${esc(tr(cat))} <span class="muted small">(${items.length})</span></h2>
        <span class="badge accent" title="${t('prix_defaut_aide')}">${t('prix_defaut')} : ${money(cat.prix_defaut)}</span>
        ${can('menu.categorie_gerer') ? `<button class="btn sm" data-ecat="${cat.id}">✏️</button>` : ''}
        ${can('menu.item_ajouter') ? `<button class="btn sm" data-addin="${cat.id}">+ ${t('ajouter')}</button>` : ''}</div>
        <div class="table-wrap"><table class="tbl"><tbody>${items.map(p => `<tr data-nm="${esc(norm([p.nom, ...Object.values(p.traductions || {})].join(' ')))}">
          <td style="width:62px"><div class="thumb ${can('menu.images') ? 'edit' : ''}" data-img="${p.id}" style="${p.image ? `background-image:url('${esc(p.image)}')` : ''}" title="${t('photo')}">${p.image ? '' : '📷'}</div></td>
          <td><b>${esc(tr(p))}</b> ${p.du_jour ? `<span class="badge accent">🌟 ${t('du_jour')}</span>` : ''}${p.ventes_30j ? ` <span class="badge" title="${t('ventes_30j')}">🔥 ${p.ventes_30j}</span>` : ''}
            <div class="small muted">${esc(autres(p))}</div></td>
          <td class="hide-m small muted">⏱ ${p.temps_preparation} min</td>
          <td class="num" style="white-space:nowrap">${p.prix_perso ? `<b>${money(p.prix_carte)}</b>` : `<span class="muted" title="${t('prix_categorie')}">${money(p.prix_carte)}</span>`}</td>
          <td style="width:60px">${can('menu.item_modifier') ? `<label class="switch" title="${t('disponible')}"><input type="checkbox" data-dispo="${p.id}" ${p.disponible ? 'checked' : ''}><span></span></label>` : (p.disponible ? `<span class="badge ok">${t('dispo')}</span>` : `<span class="badge bad">${t('epuise')}</span>`)}</td>
          <td style="width:90px;white-space:nowrap;text-align:end">${can('menu.item_modifier') ? `<button class="btn sm ghost" data-edit="${p.id}">✏️</button>` : ''}${can('menu.item_supprimer') ? `<button class="btn sm ghost" data-del="${p.id}">🗑️</button>` : ''}</td>
        </tr>`).join('') || `<tr><td class="muted">${t('aucun_plat')}</td></tr>`}</tbody></table></div></div>`;
    }).join('')}`;
  $('#mcat', box).onchange = e => { S.menuCat = e.target.value; renderCarte(box); };
  $('#mq', box).oninput = e => { const q = norm(e.target.value); $$('tr[data-nm]', box).forEach(r => r.classList.toggle('hidden', !r.dataset.nm.includes(q))); };
  $$('[data-dispo]', box).forEach(i => i.onchange = () => act(() => PUT('/plats/' + i.dataset.dispo, { disponible: i.checked }), i.checked ? t('plat_dispo') : t('plat_epuise')));
  $$('[data-edit]', box).forEach(b => b.onclick = () => platModal(S.menu.plats.find(p => String(p.id) === b.dataset.edit)));
  $$('[data-addin]', box).forEach(b => b.onclick = () => platModal({ categorie_id: Number(b.dataset.addin) }));
  $$('[data-ecat]', box).forEach(b => b.onclick = () => catModal(S.menu.categories.find(c => String(c.id) === b.dataset.ecat)));
  $$('[data-img]', box).forEach(b => b.onclick = () => { if (can('menu.images')) photoPlat(S.menu.plats.find(p => String(p.id) === b.dataset.img)); });
  $$('[data-del]', box).forEach(b => b.onclick = async () => {
    const p = S.menu.plats.find(x => String(x.id) === b.dataset.del);
    if (await confirmBox(t('suppr_plat_q', { nom: esc(tr(p)) }), { danger: true, ok: t('supprimer') }) && await act(() => DEL('/plats/' + p.id), t('plat_supprime'))) vMenu($('#content'));
  });
}
async function photoPlat(p) {
  const m = modal({
    title: `📷 ${esc(tr(p))}`,
    body: `<div class="img-drop" id="drop" style="${p.image ? `background-image:url('${esc(p.image)}')` : ''}">${p.image ? '' : t('choisir_photo')}</div><p class="small muted">${t('photo_aide')}</p>`,
    foot: `${p.image ? `<button class="btn danger" id="rm">${t('retirer_photo')}</button><span class="spacer"></span>` : ''}<button class="btn" data-close>${t('fermer')}</button><button class="btn primary" id="pick">📷 ${t('importer_photo')}</button>`
  });
  const choisir = async () => {
    const data = await choisirImage({ max: 900 });
    if (!data) return;
    if (await act(() => POST(`/plats/${p.id}/image`, { data }), t('photo_ok'))) { m.close(); vMenu($('#content')); }
  };
  $('#pick', m.el).onclick = choisir; $('#drop', m.el).onclick = choisir;
  $('#rm', m.el)?.addEventListener('click', async () => { if (await act(() => DEL(`/plats/${p.id}/image`))) { m.close(); vMenu($('#content')); } });
}
function tradFields(o = {}, label) {
  return `<div class="grid2" style="grid-template-columns:repeat(3,1fr)">${['fr', 'en', 'ar'].map(l => `<label class="field"><span>${label} (${l.toUpperCase()})</span>
    <input class="input" name="tr_${l}" value="${esc(o.traductions?.[l] || '')}" ${l === 'ar' ? 'dir="rtl"' : ''}></label>`).join('')}</div>`;
}
function lireTrad(d) { const o = {}; for (const l of ['fr', 'en', 'ar']) o[l] = d['tr_' + l] || ''; return o; }
function platModal(p = {}) {
  const neu = !p.id;
  const cat = S.menu.categories.find(c => c.id === p.categorie_id) || S.menu.categories[0];
  const m = modal({
    title: neu ? t('nouveau_plat') : `${t('modifier')} — ${esc(tr(p))}`, wide: true,
    body: `<form id="fp">
      <label class="field"><span>${t('categorie')}</span><select class="input" name="categorie_id">${S.menu.categories.map(c => `<option value="${c.id}" data-prix="${c.prix_defaut}" ${c.id === (p.categorie_id || cat.id) ? 'selected' : ''}>${c.icone} ${esc(tr(c))}</option>`).join('')}</select></label>
      <label class="field"><span>${t('nom_reference')}</span><input class="input" name="nom" value="${esc(p.nom || '')}" required></label>
      ${tradFields(p, t('nom'))}
      <label class="field"><span>${t('description')}</span><input class="input" name="description" value="${esc(p.description || '')}"></label>
      <div class="grid2"><label class="field"><span>${t('prix_aed')}</span><input class="input" name="prix" type="number" min="0" step="0.5" value="${p.prix_perso ? p.prix_carte : ''}" placeholder="${t('prix_vide', { p: money(cat.prix_defaut) })}" id="pp"></label>
      <label class="field"><span>${t('temps_prep')}</span><input class="input" name="temps_preparation" type="number" min="1" value="${p.temps_preparation ?? 15}"></label></div>
      <p class="small muted" style="margin-top:-6px">💡 ${t('prix_categorie_aide')}</p>
      ${neu ? '' : `<label class="row"><label class="switch"><input type="checkbox" name="disponible" ${p.disponible ? 'checked' : ''}><span></span></label> ${t('disponible')}</label>`}
    </form>`,
    foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${neu ? t('ajouter_menu') : t('enregistrer')}</button>`
  });
  const sel = $('[name=categorie_id]', m.el);
  sel.onchange = () => { $('#pp', m.el).placeholder = t('prix_vide', { p: money(sel.selectedOptions[0].dataset.prix) }); };
  $('#ok', m.el).onclick = async () => {
    const d = formData($('#fp', m.el));
    const body = { categorie_id: d.categorie_id, nom: d.nom, description: d.description, prix: d.prix === '' ? null : d.prix, temps_preparation: d.temps_preparation, traductions: lireTrad(d) };
    if (!neu) body.disponible = d.disponible;
    const r = await act(() => neu ? POST('/plats', body) : PUT('/plats/' + p.id, body), neu ? t('plat_ajoute') : t('plat_modifie'));
    if (r) { m.close(); await vMenu($('#content')); if (neu && can('menu.images') && await confirmBox(t('ajouter_photo_q'), { ok: '📷 ' + t('importer_photo') })) photoPlat(S.menu.plats.find(x => x.id === r.id)); }
  };
}
function catModal(c = {}) {
  const icons = ['🥩', '🍗', '🍚', '🍳', '🫓', '🥤', '🐟', '🥗', '🍰', '☕', '🍹', '🍲', '🍛', '🥘', '🌶️', '🍽️'];
  const m = modal({
    title: c.id ? t('modifier_categorie') : t('nouvelle_categorie'), wide: true,
    body: `<form id="fc"><label class="field"><span>${t('nom_reference')}</span><input class="input" name="nom" value="${esc(c.nom || '')}" required></label>
      ${tradFields(c, t('nom'))}
      <input type="hidden" name="icone" value="${esc(c.icone || '🍽️')}">
      <span class="small muted" style="font-weight:600">${t('icone')}</span><div class="row" style="margin:6px 0 10px">${icons.map(i => `<button type="button" class="btn icon-btn ${i === c.icone ? 'primary' : ''}" data-i="${i}">${i}</button>`).join('')}</div>
      <div class="grid2"><label class="field"><span>${t('prix_defaut')} (AED)</span><input class="input" name="prix_defaut" type="number" step="0.5" min="0" value="${c.prix_defaut ?? ''}"></label>
      <label class="field"><span>${t('ordre')}</span><input class="input" name="ordre" type="number" value="${c.ordre ?? 99}"></label></div>
      ${c.id ? `<label class="row" style="margin-bottom:8px"><input type="checkbox" name="appliquer_a_tous" style="width:20px;height:20px;accent-color:var(--accent)"> ${t('appliquer_tous')}</label>` : ''}</form>`,
    foot: `${c.id ? `<button class="btn danger" id="del">${t('supprimer')}</button><span class="spacer"></span>` : ''}<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('enregistrer')}</button>`
  });
  $$('[data-i]', m.el).forEach(b => b.onclick = () => { $('[name=icone]', m.el).value = b.dataset.i; $$('[data-i]', m.el).forEach(x => x.classList.toggle('primary', x === b)); });
  $('#ok', m.el).onclick = async () => {
    const d = formData($('#fc', m.el));
    const body = { nom: d.nom, icone: d.icone, prix_defaut: d.prix_defaut || 0, ordre: d.ordre, traductions: lireTrad(d), appliquer_a_tous: !!d.appliquer_a_tous };
    if (await act(() => c.id ? PUT('/categories/' + c.id, body) : POST('/categories', body), t('enregistre'))) { m.close(); vMenu($('#content')); }
  };
  $('#del', m.el)?.addEventListener('click', async () => { if (await act(() => DEL('/categories/' + c.id), t('supprime'))) { m.close(); vMenu($('#content')); } });
}
async function renderMenus(box) {
  const menus = await GET('/menus');
  box.innerHTML = menus.length ? `<div class="cards">${menus.map(m => {
    const edit = can('menu.modifier') || (m.est_du_jour && can('menu.du_jour_modifier'));
    return `<div class="card" style="${m.est_du_jour ? 'border:2px solid var(--accent)' : ''}">
      <div class="row"><h2 class="grow">${esc(m.nom)}</h2>${m.est_du_jour ? `<span class="badge accent">🌟 ${t('menu_du_jour')}</span>` : ''}</div>
      <div class="small muted" style="margin:2px 0 10px">${t('n_plats', { n: m.plats.length })}${m.auteur ? ' · ' + esc(m.auteur) : ''}</div>
      <div style="max-height:220px;overflow:auto">${m.plats.map(p => `<div class="row small" style="padding:4px 0;border-bottom:1px solid #f4f1ec"><span class="grow">${p.icone} ${esc(tr(p))}</span>
        <span class="num">${p.prix_special != null ? `<s class="muted">${money(p.prix)}</s> <b>${money(p.prix_special)}</b>` : money(p.prix)}</span></div>`).join('') || '—'}</div>
      <div class="row" style="margin-top:12px">${edit ? `<button class="btn sm" data-me="${m.id}">✏️ ${t('modifier')}</button>` : ''}
        ${!m.est_du_jour && can('menu.du_jour_modifier') ? `<button class="btn sm primary" data-mj="${m.id}">🌟 ${t('definir_du_jour')}</button>` : ''}
        ${can('menu.modifier') && !m.est_du_jour ? `<button class="btn sm ghost" data-md="${m.id}">🗑️</button>` : ''}</div></div>`;
  }).join('')}</div>` : `<div class="card empty"><div class="big">🌟</div>${t('aucun_menu')}</div>`;
  $$('[data-me]', box).forEach(b => b.onclick = () => menuModal(menus.find(m => String(m.id) === b.dataset.me)));
  $$('[data-mj]', box).forEach(b => b.onclick = async () => { if (await act(() => POST(`/menus/${b.dataset.mj}/du-jour`), t('menu_jour_ok'))) { S.menu = null; await loadMenu(); renderMenus(box); } });
  $$('[data-md]', box).forEach(b => b.onclick = async () => { if (await confirmBox(t('suppr_menu_q'), { danger: true, ok: t('supprimer') }) && await act(() => DEL('/menus/' + b.dataset.md))) renderMenus(box); });
}
function menuModal(menu = { plats: [] }) {
  const sel = new Map(menu.plats.map(p => [p.plat_id, p.prix_special]));
  const m = modal({
    title: menu.id ? `${t('modifier')} — ${esc(menu.nom)}` : t('nouveau_menu'), wide: true,
    body: `<div class="grid2"><label class="field"><span>${t('nom_menu')}</span><input class="input" id="mn" value="${esc(menu.nom || '')}"></label>
      <label class="field"><span>${t('date_facultative')}</span><input class="input" id="md" type="date" value="${menu.date_menu ? String(menu.date_menu).slice(0, 10) : ''}"></label></div>
      <p class="small muted" style="margin-top:0">${t('cocher_plats')}</p>
      ${S.menu.categories.map(c => `<h3 style="margin:12px 0 4px">${c.icone} ${esc(tr(c))}</h3>${S.menu.plats.filter(p => p.categorie_id === c.id).map(p => `
        <div class="feat"><input type="checkbox" data-p="${p.id}" ${sel.has(p.id) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)">
          <div class="txt">${esc(tr(p))} <small>${money(p.prix_carte)}</small></div>
          <input class="input" data-sp="${p.id}" type="number" step="0.5" placeholder="${t('prix_special')}" value="${sel.get(p.id) ?? ''}" style="width:130px;min-height:36px"></div>`).join('')}`).join('')}`,
    foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('enregistrer')}</button>`
  });
  $('#ok', m.el).onclick = async () => {
    const plats = $$('[data-p]:checked', m.el).map(i => ({ plat_id: Number(i.dataset.p), prix_special: $(`[data-sp="${i.dataset.p}"]`, m.el).value }));
    const body = { nom: $('#mn', m.el).value || t('menu'), date_menu: $('#md', m.el).value || null, plats };
    if (await act(() => menu.id ? PUT('/menus/' + menu.id, body) : POST('/menus', body), t('enregistre'))) { m.close(); S.menu = null; vMenu($('#content')); }
  };
}

// ------------------------------------------------------------------ TABLEAU DE BORD
async function vDashboard(el) {
  S.dashPer = S.dashPer || { p: 'jour' };
  const r = plage(S.dashPer);
  const d = await GET(`/dashboard?du=${r.du}&au=${r.au}`);
  setTitle(t('nav.dashboard'), `${dateCourte(r.du)}${r.du !== r.au ? ' → ' + dateCourte(r.au) : ''}`);
  const bars = (rows, fmt = x => money(x.montant), val = x => Number(x.montant), label = x => x.label) => {
    const max = Math.max(1, ...rows.map(val));
    return rows.length ? `<div class="bars">${rows.map(x => `<div class="bar"><span class="lb" title="${esc(label(x))}">${esc(label(x) || '—')}</span>
      <div class="track"><div class="fill" style="width:${val(x) / max * 100}%"></div></div><span class="num small"><b>${fmt(x)}</b></span></div>`).join('')}</div>` : `<div class="muted small">${t('pas_donnees')}</div>`;
  };
  // Série : par heure (un jour) ou par jour (période)
  let serie;
  if (r.du === r.au) { serie = []; for (let h = 8; h <= 23; h++) serie.push({ l: String(h), v: Number(d.parHeure.find(x => x.h === h)?.montant || 0) }); }
  else {
    serie = [];
    const cur = new Date(r.du), fin = new Date(r.au);
    while (cur <= fin && serie.length < 120) { const k = isoDate(cur); serie.push({ l: k.slice(5), v: Number(d.parJour.find(x => x.jour === k)?.montant || 0) }); cur.setDate(cur.getDate() + 1); }
  }
  const maxS = Math.max(1, ...serie.map(s => s.v));
  const pas = Math.ceil(serie.length / 16);
  el.innerHTML = `
    ${periodeHtml(S.dashPer)}
    <div class="kpis">
      <div class="kpi"><div class="lbl">${t('chiffre_affaires')}</div><div class="val">${money(d.kpi.ca)}</div><div class="sub">💵 ${money(d.kpi.cash)} · 💳 ${money(d.kpi.visa)}</div></div>
      <div class="kpi"><div class="lbl">${t('factures_reglees')}</div><div class="val">${num(d.kpi.nb)}</div><div class="sub">${t('panier_moyen')} ${money(d.kpi.panier)}</div></div>
      <div class="kpi" style="${d.attente.rouges ? 'box-shadow:0 0 0 2px var(--bad),var(--shadow)' : ''}"><div class="lbl">${t('a_encaisser')}</div><div class="val" style="color:var(--info)">${money(d.attente.montant)}</div><div class="sub">${t('n_factures', { n: d.attente.n })}${d.attente.rouges ? ` · <b style="color:var(--bad)">⏱ ${d.attente.rouges}</b>` : ''}</div></div>
      <div class="kpi"><div class="lbl">${t('occupation')}</div><div class="val">${d.occupees}/${d.totalTables}</div><div class="sub">${t('n_brouillons', { n: d.enCours })}${d.retard ? ` · <b style="color:var(--bad)">🔥 ${d.retard}</b>` : ''}</div></div>
    </div>
    ${d.alertes.length ? `<div class="card"><div class="card-head"><h2>🤖 ${t('assistant')}</h2></div>${d.alertes.map(a => `<div class="alert ${a.niveau}"><span>${{ info: 'ℹ️', alerte: '⚠️', ok: '🏆' }[a.niveau]}</span><span>${esc(t('al.' + a.cle, a.p))}</span></div>`).join('')}</div>` : ''}
    <div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:14px">
      <div class="card" style="grid-column:1/-1"><h2>${t(r.du === r.au ? 'ventes_heure' : 'ventes_jour')}</h2><div class="vbars">${serie.map((s, i) => `<div class="vb" title="${s.l} : ${money(s.v)}"><div class="col-bar" style="height:${s.v / maxS * 100}%"></div><small>${i % pas ? '' : s.l}</small></div>`).join('')}</div></div>
      <div class="card"><h2 style="margin-bottom:12px">🍽️ ${t('plats_plus_vendus')}</h2>${bars(d.topPlats, x => `${x.n}×`, x => Number(x.n), x => platNom(x.plat_id, x.label))}</div>
      <div class="card"><h2 style="margin-bottom:12px">🙋 ${t('ca_serveur')}</h2>${bars(d.parServeur)}</div>
      <div class="card"><h2 style="margin-bottom:12px">💰 ${t('ca_caissier')}</h2>${bars(d.parCaissier)}</div>
      <div class="card"><h2 style="margin-bottom:12px">📍 ${t('ca_zone')}</h2>${bars(d.parZone)}</div>
      <div class="card"><h2 style="margin-bottom:12px">🧭 ${t('ca_service')}</h2>${bars(d.parType, undefined, undefined, x => t('svc.' + x.label))}</div>
      <div class="card"><h2 style="margin-bottom:12px">💳 ${t('modes_paiement')}</h2>${bars(d.parMode, undefined, undefined, x => t('mode.' + x.label))}</div>
      <div class="card"><h2 style="margin-bottom:12px">🛵 ${t('livraisons_livreur')}</h2>${bars(d.parLivreur, x => `${x.n}`, x => Number(x.n))}</div>
    </div>`;
  bindPeriode(el, S.dashPer, softRender);
}

// ------------------------------------------------------------------ UTILISATEURS
async function vUtilisateurs(el) {
  const [users, roles] = await Promise.all([GET('/utilisateurs'), GET('/roles')]);
  S.roles = roles;
  setTitle(t('nav.utilisateurs'), t('n_comptes', { n: users.length }), can('utilisateur.creer') ? `<button class="btn primary" id="add">+ ${t('utilisateur')}</button>` : '');
  el.innerHTML = `<div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="tbl">
    <thead><tr><th>${t('utilisateur')}</th><th>${t('role')}</th><th class="hide-m">${t('groupes')}</th><th class="hide-m">${t('derniere_connexion')}</th><th></th></tr></thead>
    <tbody>${users.map(u => {
      const locked = u.role === 'ADMIN' && S.user.role !== 'ADMIN', self = u.id === S.user.id;
      return `<tr><td><div class="row" style="flex-wrap:nowrap">${avatar(u)}<div><b>${esc(u.nom_complet)}</b> ${u.actif ? '' : `<span class="badge bad">${t('inactif')}</span>`}${u.nb_biometrie ? ' 🔐' : ''}
          <div class="small muted">@${esc(u.username)}${u.telephone ? ' · ' + esc(u.telephone) : ''} · ${u.langue.toUpperCase()}</div></div></div></td>
        <td><span class="badge" style="background:${u.role_couleur}1f;color:${u.role_couleur}">${roleNom(u.role)}</span>${u.nb_exceptions ? ` <span class="badge warn">+${u.nb_exceptions}</span>` : ''}</td>
        <td class="hide-m small">${esc(u.groupes || '—')}</td><td class="hide-m small muted">${u.derniere_connexion ? dateTime(u.derniere_connexion) : t('jamais')}</td>
        <td style="text-align:end;white-space:nowrap"><button class="btn sm" data-f="${u.id}">🧩<span class="hide-m"> ${t('droits')}</span></button>
          ${!locked && can('utilisateur.modifier') ? `<button class="btn sm ghost" data-e="${u.id}">✏️</button>` : ''}
          ${!locked && !self && can('utilisateur.changer_role') ? `<button class="btn sm ghost" data-r="${u.id}">🔁</button>` : ''}
          ${!locked && !self && can('utilisateur.supprimer') ? `<button class="btn sm ghost" data-d="${u.id}">🗑️</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div></div>`;
  const find = id => users.find(u => String(u.id) === id);
  $('#add')?.addEventListener('click', () => userModal());
  $$('[data-e]', el).forEach(b => b.onclick = () => userModal(find(b.dataset.e)));
  $$('[data-f]', el).forEach(b => b.onclick = () => featuresModal(find(b.dataset.f)));
  $$('[data-r]', el).forEach(b => b.onclick = () => {
    const u = find(b.dataset.r);
    const m = modal({ title: `${t('changer_role')} — ${esc(u.nom_complet)}`,
      body: `<div style="display:grid;gap:8px">${roles.filter(r => r.code !== 'ADMIN' || S.user.role === 'ADMIN').map(r => `<label class="pay-mode ${r.id === u.role_id ? 'active' : ''}">
        <input type="radio" name="role" value="${r.id}" ${r.id === u.role_id ? 'checked' : ''} style="accent-color:${r.couleur}"><span><b style="color:${r.couleur}">${roleNom(r.code)}</b><br><small class="muted" style="font-weight:500">${t('roled.' + r.code)}</small></span></label>`).join('')}</div>`,
      foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('changer_role')}</button>` });
    $$('[name=role]', m.el).forEach(i => i.onchange = () => $$('.pay-mode', m.el).forEach(l => l.classList.toggle('active', $('input', l).checked)));
    $('#ok', m.el).onclick = async () => { if (await act(() => PUT(`/utilisateurs/${u.id}/role`, { role_id: $('[name=role]:checked', m.el).value }), t('role_modifie'))) { m.close(); softRender(); } };
  });
  $$('[data-d]', el).forEach(b => b.onclick = async () => {
    const u = find(b.dataset.d);
    if (await confirmBox(t('suppr_compte_q', { nom: esc(u.nom_complet) }), { danger: true, ok: t('supprimer') }) && await act(() => DEL('/utilisateurs/' + u.id), t('compte_supprime'))) softRender();
  });
}
function userModal(u) {
  const neu = !u;
  const gen = () => Math.random().toString(36).slice(2, 6) + Math.floor(1000 + Math.random() * 9000);
  const m = modal({
    title: neu ? t('nouvel_utilisateur') : `${t('modifier')} — ${esc(u.nom_complet)}`,
    body: `<form id="fu">
      ${neu ? '' : `<div class="row" style="margin-bottom:12px">${avatar(u, 'lg')}<button type="button" class="btn sm" id="ph">📷 ${t('changer_photo')}</button></div>`}
      <label class="field"><span>${t('nom_complet')}</span><input class="input" name="nom_complet" value="${esc(u?.nom_complet)}" required></label>
      <div class="grid2">${neu ? `<label class="field"><span>${t('login.utilisateur')}</span><input class="input" name="username" autocapitalize="none" required></label>` : ''}
        <label class="field"><span>${t('telephone')}</span><input class="input" name="telephone" type="tel" value="${esc(u?.telephone)}"></label></div>
      ${neu ? `<div class="grid2"><label class="field"><span>${t('role')}</span><select class="input" name="role_id">${S.roles.filter(r => r.code !== 'ADMIN' || S.user.role === 'ADMIN').map(r => `<option value="${r.id}" ${r.code === 'SERVEUR' ? 'selected' : ''}>${roleNom(r.code)}</option>`).join('')}</select></label>
        <label class="field"><span>${t('langue')}</span><select class="input" name="langue">${['fr', 'en', 'ar'].map(l => `<option value="${l}" ${l === S.lang ? 'selected' : ''}>${t('lang.' + l)}</option>`).join('')}</select></label></div>` : ''}
      <label class="field"><span>${neu ? t('login.mdp') : t('nouveau_mdp_vide')}</span>
        <div class="row" style="flex-wrap:nowrap"><input class="input grow" name="password" ${neu ? 'required' : ''} minlength="6"><button type="button" class="btn" id="gen">🎲</button></div></label>
      ${neu ? '' : `<label class="row"><label class="switch"><input type="checkbox" name="actif" ${u.actif ? 'checked' : ''}><span></span></label> ${t('compte_actif')}</label>`}</form>`,
    foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${neu ? t('creer_compte') : t('enregistrer')}</button>`
  });
  $('#gen', m.el).onclick = () => { $('[name=password]', m.el).value = gen(); };
  $('#ph', m.el)?.addEventListener('click', async () => {
    const data = await choisirImage({ max: 320 });
    if (data && await act(() => POST(`/utilisateurs/${u.id}/photo`, { data }), t('photo_ok'))) { m.close(); softRender(); }
  });
  $('#ok', m.el).onclick = async () => {
    const d = formData($('#fu', m.el));
    if (!neu && !d.password) delete d.password;
    const r = await act(() => neu ? POST('/utilisateurs', d) : PUT('/utilisateurs/' + u.id, d), neu ? t('compte_cree') : t('utilisateur_modifie'));
    if (r) {
      m.close(); softRender();
      if (neu) modal({ title: '✅ ' + t('compte_cree'), body: `<p>${t('transmettre_ids', { nom: esc(d.nom_complet) })}</p><div class="card" style="background:#faf8f5;box-shadow:none"><dl class="info-list"><dt>${t('login.utilisateur')}</dt><dd>${esc(d.username.toLowerCase())}</dd><dt>${t('login.mdp')}</dt><dd>${esc(d.password)}</dd></dl></div>` });
    }
  };
}
async function featuresModal(u) {
  const editable = can('utilisateur.fonctionnalites') && u.role !== 'ADMIN';
  const m = modal({ title: `${t('fonctionnalites')} — ${esc(u.nom_complet)}`, wide: true, body: `<div class="empty">${t('chargement')}</div>` });
  const load = async () => {
    const d = await GET(`/utilisateurs/${u.id}/fonctionnalites`);
    const mods = [...new Set(d.fonctionnalites.map(f => f.module))];
    const nbExc = d.fonctionnalites.filter(f => f.individuel !== 'defaut').length;
    m.body.innerHTML = `
      ${editable ? `<div class="row" style="margin-bottom:10px"><span class="grow small muted">${t('n_exceptions', { n: nbExc })}</span><button class="btn" id="u-def" ${nbExc ? '' : 'disabled'}>↺ ${t('defaut_utilisateur')}</button></div>` : ''}
      <div class="alert info small"><span>ℹ️</span><span>${t('role')} <b>${roleNom(u.role)}</b> · ${t('n_actives', { n: d.fonctionnalites.filter(f => f.actif).length })}. ${u.role === 'ADMIN' ? t('admin_tout') : t('fonct_aide')}</span></div>
      ${mods.map(mod => `<div class="feat-module"><h3>${esc(moduleNom(mod))}</h3>${d.fonctionnalites.filter(f => f.module === mod).map(f => `
        <div class="feat"><span style="font-size:1.1rem">${f.actif ? '🟢' : '⚪'}</span>
          <div class="txt">${esc(featNom(f))} ${f.via_role ? `<span class="badge">${t('role')}</span>` : ''} ${f.via_groupes.map(g => `<span class="badge info">${esc(g)}</span>`).join(' ')}<small>${esc(f.code)}</small></div>
          ${editable ? `<div class="seg" data-f="${f.id}"><button class="${f.individuel === 'defaut' ? 'on-d' : ''}" data-e="defaut">${t('defaut')}</button>
            <button class="${f.individuel === 'accorde' ? 'on-a' : ''}" data-e="accorde">${t('accorder')}</button><button class="${f.individuel === 'retire' ? 'on-r' : ''}" data-e="retire">${t('retirer')}</button></div>` : ''}
        </div>`).join('')}</div>`).join('')}`;
    $('#u-def', m.body)?.addEventListener('click', async () => { if (await act(() => POST(`/utilisateurs/${u.id}/fonctionnalites/defaut`), t('droits_defaut_ok'))) await load(); });
    $$('.seg button', m.body).forEach(b => b.onclick = async () => {
      const y = m.body.scrollTop;
      if (await act(() => PUT(`/utilisateurs/${u.id}/fonctionnalites`, { fonctionnalite_id: b.parentElement.dataset.f, etat: b.dataset.e }))) { await load(); m.body.scrollTop = y; }
    });
  };
  await load();
  $('[data-close]', m.el).addEventListener('click', () => softRender());
}

// ------------------------------------------------------------------ GROUPES
async function vGroupes(el) {
  const [groupes, users, feats] = await Promise.all([GET('/groupes'), GET('/utilisateurs'), GET('/fonctionnalites')]);
  setTitle(t('nav.groupes'), t('groupes_sous'), can('groupe.gerer') ? `<button class="btn primary" id="add">+ ${t('groupe')}</button>` : '');
  el.innerHTML = groupes.length ? `<div class="cards">${groupes.map(g => `<div class="card"><h2>🧩 ${esc(g.nom)}</h2><p class="small muted" style="margin:4px 0 12px">${esc(g.description || '')}</p>
      <div class="small" style="margin-bottom:6px"><b>${g.membres.length}</b> ${t('membres')}</div>
      <div class="row" style="gap:4px;margin-bottom:10px">${g.membres.map(id => users.find(u => u.id === id)).filter(Boolean).map(u => `<span class="badge">${esc(u.nom_complet)}</span>`).join('') || '—'}</div>
      <div class="small" style="margin-bottom:6px"><b>${g.fonctionnalites.length}</b> ${t('fonctionnalites').toLowerCase()}</div>
      <div class="row" style="gap:4px">${g.fonctionnalites.map(id => feats.find(f => f.id === id)).filter(Boolean).map(f => `<span class="badge info">${esc(featNom(f))}</span>`).join('') || '—'}</div>
      <div class="row" style="margin-top:14px">${can('groupe.gerer') ? `<button class="btn sm" data-m="${g.id}">👥 ${t('membres')}</button>` : ''}${can('groupe.fonctionnalites') ? `<button class="btn sm" data-f="${g.id}">🧩 ${t('fonctionnalites')}</button>` : ''}
        ${can('groupe.gerer') ? `<button class="btn sm ghost" data-e="${g.id}">✏️</button><button class="btn sm ghost" data-d="${g.id}">🗑️</button>` : ''}</div></div>`).join('')}</div>`
    : `<div class="card empty"><div class="big">🧩</div>${t('aucun_groupe')}</div>`;
  const find = id => groupes.find(g => String(g.id) === id);
  const edit = g => {
    const m = modal({ title: g ? t('modifier_groupe') : t('nouveau_groupe'),
      body: `<form id="fg"><label class="field"><span>${t('nom')}</span><input class="input" name="nom" value="${esc(g?.nom)}" required></label>
        <label class="field"><span>${t('description')}</span><input class="input" name="description" value="${esc(g?.description)}"></label></form>`,
      foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('enregistrer')}</button>` });
    $('#ok', m.el).onclick = async () => { const d = formData($('#fg', m.el)); if (await act(() => g ? PUT('/groupes/' + g.id, d) : POST('/groupes', d), t('enregistre'))) { m.close(); softRender(); } };
  };
  const checklist = (title, items, selected, grouped) => modal({ title, wide: grouped,
    body: grouped ? [...new Set(items.map(i => i.module))].map(mod => `<div class="feat-module"><h3>${esc(moduleNom(mod))}</h3>${items.filter(i => i.module === mod).map(i => `
        <label class="feat"><input type="checkbox" value="${i.id}" ${selected.includes(i.id) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"><div class="txt">${esc(featNom(i))}<small>${esc(i.code)}</small></div></label>`).join('')}</div>`).join('')
      : items.map(i => `<label class="feat"><input type="checkbox" value="${i.id}" ${selected.includes(i.id) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"><div class="txt">${esc(i.nom_complet)}<small>${roleNom(i.role)}</small></div></label>`).join(''),
    foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn primary" id="ok">${t('enregistrer')}</button>` });
  $('#add')?.addEventListener('click', () => edit());
  $$('[data-e]', el).forEach(b => b.onclick = () => edit(find(b.dataset.e)));
  $$('[data-m]', el).forEach(b => b.onclick = () => { const g = find(b.dataset.m); const m = checklist(`${t('membres')} — ${esc(g.nom)}`, users, g.membres);
    $('#ok', m.el).onclick = async () => { if (await act(() => PUT('/groupes/' + g.id, { membres: $$('input:checked', m.el).map(i => Number(i.value)) }), t('enregistre'))) { m.close(); softRender(); } }; });
  $$('[data-f]', el).forEach(b => b.onclick = () => { const g = find(b.dataset.f); const m = checklist(`${t('fonctionnalites')} — ${esc(g.nom)}`, feats, g.fonctionnalites, true);
    $('#ok', m.el).onclick = async () => { if (await act(() => PUT('/groupes/' + g.id, { fonctionnalites: $$('input:checked', m.el).map(i => Number(i.value)) }), t('enregistre'))) { m.close(); softRender(); } }; });
  $$('[data-d]', el).forEach(b => b.onclick = async () => { if (await confirmBox(t('suppr_groupe_q'), { danger: true, ok: t('supprimer') }) && await act(() => DEL('/groupes/' + b.dataset.d), t('supprime'))) softRender(); });
}

// ------------------------------------------------------------------ RÔLES (matrice + Défaut)
async function vRoles(el) {
  const [roles, feats] = await Promise.all([GET('/roles'), GET('/fonctionnalites')]);
  const diff = r => r.code !== 'ADMIN' && (r.fonctionnalites.length !== r.defaut.length || r.fonctionnalites.some(id => !r.defaut.includes(id)));
  setTitle(t('nav.roles'), t('roles_sous'), `<button class="btn" id="def-all" ${roles.some(diff) ? '' : 'disabled'}>↺ ${t('defaut')} <span class="hide-m">(${t('tous_roles')})</span></button>`);
  const mods = [...new Set(feats.map(f => f.module))];
  el.innerHTML = `<div class="alert info small"><span>ℹ️</span><span>${t('roles_aide')} <span class="def-mark">▢</span></span></div>
    <div class="card" style="padding:6px 8px"><div class="table-wrap"><table class="tbl matrix">
    <thead><tr><th>${t('fonctionnalite')}</th>${roles.map(r => `<th class="c" style="color:${r.couleur}">${roleNom(r.code)}<div class="small muted" style="text-transform:none;font-weight:500">${t('n_pers', { n: r.nb_utilisateurs })}</div>
      ${r.code === 'ADMIN' ? `<div class="small muted" style="text-transform:none">${t('toujours_tout')}</div>` : `<button class="btn sm" data-def="${r.id}" style="margin-top:4px" ${diff(r) ? '' : 'disabled'}>↺ ${t('defaut')}</button>`}</th>`).join('')}</tr></thead>
    <tbody>${mods.map(mod => `<tr><td colspan="${roles.length + 1}" style="background:#faf8f5;font-weight:800;font-size:.78rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">${esc(moduleNom(mod))}</td></tr>
      ${feats.filter(f => f.module === mod).map(f => `<tr><td>${esc(featNom(f))}<div class="small muted" style="font-family:ui-monospace,monospace">${esc(f.code)}</div></td>
        ${roles.map(r => { const on = r.code === 'ADMIN' || r.fonctionnalites.includes(f.id); const ch = r.code !== 'ADMIN' && on !== r.defaut.includes(f.id);
          return `<td class="c ${ch ? 'changed' : ''}"><input type="checkbox" data-r="${r.id}" data-f="${f.id}" ${on ? 'checked' : ''} ${r.code === 'ADMIN' ? 'disabled' : ''}></td>`; }).join('')}</tr>`).join('')}`).join('')}
    </tbody></table></div></div>`;
  $$('input[data-r]', el).forEach(i => i.onchange = async () => {
    const rid = i.dataset.r, r = roles.find(x => String(x.id) === rid);
    const ids = $$(`input[data-r="${rid}"]:checked`, el).map(x => Number(x.dataset.f));
    if (await act(() => PUT(`/roles/${rid}/fonctionnalites`, { fonctionnalite_ids: ids }), t('role_maj', { r: roleNom(r.code) }))) softRender(); else i.checked = !i.checked;
  });
  $$('[data-def]', el).forEach(b => b.onclick = async () => {
    const r = roles.find(x => String(x.id) === b.dataset.def);
    if (await confirmBox(t('defaut_role_q', { r: roleNom(r.code) }), { ok: '↺ ' + t('retablir') }) && await act(() => POST(`/roles/${r.id}/defaut`), t('defaut_ok'))) softRender();
  });
  $('#def-all')?.addEventListener('click', async () => { if (await confirmBox(t('defaut_tous_q'), { ok: '↺ ' + t('retablir') }) && await act(() => POST('/roles-defaut'), t('defaut_ok'))) softRender(); });
}

// ------------------------------------------------------------------ JOURNAL
async function vJournal(el) {
  S.jPer = S.jPer || { p: 'jour' };
  const r = plage(S.jPer);
  const rows = await GET(`/journal?du=${r.du}&au=${r.au}`);
  setTitle(t('nav.journal'), t('n_actions', { n: rows.length }));
  el.innerHTML = `${periodeHtml(S.jPer)}<div class="card" style="padding:6px 8px"><div class="search" style="margin:6px"><input class="input" id="jq" placeholder="${t('filtrer')}"></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>${t('date')}</th><th>${t('utilisateur')}</th><th>${t('action')}</th><th>${t('cible')}</th><th class="hide-m">${t('details')}</th></tr></thead>
    <tbody>${rows.map(j => `<tr data-s="${esc(norm([j.utilisateur_nom, j.action, j.cible, j.details].join(' ')))}"><td class="small" style="white-space:nowrap">${dateTime(j.created_at)}</td>
      <td>${esc(j.utilisateur_nom || '—')}</td><td><span class="badge">${esc(t('act.' + j.action, {}, j.action))}</span></td><td>${esc(j.cible || '')}</td><td class="hide-m small muted">${esc(j.details || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
  bindPeriode(el, S.jPer, softRender);
  $('#jq', el).oninput = e => { const q = norm(e.target.value); $$('tr[data-s]', el).forEach(x => x.classList.toggle('hidden', !x.dataset.s.includes(q))); };
}

// ------------------------------------------------------------------ PARAMÈTRES
async function vParametres(el) {
  const p = await GET('/parametres');
  const admin = can('parametres.gerer'), cuisine = admin || can('parametres.cuisine');
  setTitle(t('nav.parametres'), t('parametres_sous'));
  const champ = (cle, label, aide, type = 'number', dis = false) => `<div class="set-row"><div class="txt">${label}<small>${aide}</small></div>
    <input class="input" name="${cle}" type="${type}" value="${esc(p[cle] ?? '')}" ${dis ? 'disabled' : ''}></div>`;
  el.innerHTML = `<div class="set-grid">
    <div class="card"><h2 style="margin-bottom:10px">🏪 ${t('restaurant')}</h2>
      <div class="row" style="align-items:flex-start;gap:16px;margin-bottom:10px">
        <div class="img-drop logo" id="logo" style="${S.config.logo ? `background-image:url('${esc(S.config.logo)}')` : ''}">${S.config.logo ? '' : '🍽️'}</div>
        <div class="grow"><p class="small muted" style="margin-top:0">${t('logo_aide')}</p>${admin ? `<button class="btn sm" id="logo-pick">📷 ${t('changer_logo')}</button> ${S.config.logo ? `<button class="btn sm danger" id="logo-rm">${t('retirer')}</button>` : ''}` : ''}</div></div>
      <form id="f-resto">
        <label class="field"><span>${t('nom_restaurant')}</span><input class="input" name="restaurant_nom" value="${esc(p.restaurant_nom || '')}" ${admin ? '' : 'disabled'}></label>
        <div class="grid2"><label class="field"><span>${t('langue_defaut')}</span><select class="input" name="langue_defaut" ${admin ? '' : 'disabled'}>${['fr', 'en', 'ar'].map(l => `<option value="${l}" ${p.langue_defaut === l ? 'selected' : ''}>${t('lang.' + l)}</option>`).join('')}</select></label>
          <label class="field"><span>${t('indicatif_wa')}</span><input class="input" name="whatsapp_indicatif" value="${esc(p.whatsapp_indicatif || '971')}" ${admin ? '' : 'disabled'}></label></div>
        <p class="small muted">💱 ${t('devise_info')}</p>
        ${admin ? `<button class="btn primary">${t('enregistrer')}</button>` : ''}</form></div>
    <div class="card"><h2 style="margin-bottom:6px">👨‍🍳 ${t('cuisine_alertes')}</h2><form id="f-cuis">
      ${champ('cuisine_recap_heures', t('p.recap'), t('p.recap_aide'), 'number', !cuisine)}
      ${champ('delai_cuisine_alerte_min', t('p.delai_cuisine'), t('p.delai_cuisine_aide'), 'number', !cuisine)}
      ${champ('delai_facture_rouge_min', t('p.delai_rouge'), t('p.delai_rouge_aide'), 'number', !cuisine)}
      ${cuisine ? `<button class="btn primary" style="margin-top:12px">${t('enregistrer')}</button>` : ''}</form></div>
    <div class="card"><h2 style="margin-bottom:6px">🗄️ ${t('donnees')}</h2><form id="f-data">
      ${champ('retention_factures_jours', t('p.retention'), t('p.retention_aide'), 'number', !admin)}
      ${champ('heure_reinitialisation', t('p.heure_reinit'), t('p.heure_reinit_aide'), 'number', !admin)}
      <p class="small muted">${t('p.derniere', { r: p.derniere_reinitialisation || '—', p: p.derniere_purge || '—' })}</p>
      ${admin ? `<div class="row"><button class="btn primary">${t('enregistrer')}</button><button type="button" class="btn" id="reinit">🔄 ${t('reinit_maintenant')}</button><button type="button" class="btn" id="purge">🧹 ${t('purger_maintenant')}</button></div>` : ''}</form></div>
  </div>`;
  const save = async (form, extra) => {
    const d = formData(form);
    Object.keys(d).forEach(k => { if ($(`[name=${k}]`, form)?.disabled) delete d[k]; });
    const r = await act(() => PUT('/parametres', d), t('enregistre'));
    if (r) { S.config = { ...S.config, ...(await GET('/config')) }; extra?.(); relangue(); }
  };
  $('#f-resto', el).onsubmit = e => { e.preventDefault(); save(e.target); };
  $('#f-cuis', el).onsubmit = e => { e.preventDefault(); save(e.target); };
  $('#f-data', el).onsubmit = e => { e.preventDefault(); save(e.target); };
  const pickLogo = async () => {
    if (!admin) return;
    const data = await choisirImage({ max: 512, png: true });
    if (data && await act(() => POST('/parametres/logo', { data }), t('logo_ok'))) { S.config = { ...S.config, ...(await GET('/config')) }; relangue(); }
  };
  $('#logo-pick', el)?.addEventListener('click', pickLogo); $('#logo', el).onclick = pickLogo;
  $('#logo-rm', el)?.addEventListener('click', async () => { if (await act(() => DEL('/parametres/logo'))) { S.config.logo = ''; relangue(); } });
  $('#reinit', el)?.addEventListener('click', async () => { if (await confirmBox(t('reinit_q'), { danger: true, ok: t('reinit_maintenant') })) { const r = await act(() => POST('/parametres/reinitialiser')); if (r) { toast(t('reinit_ok', { n: r.supprimees }), 'ok'); softRender(); } } });
  $('#purge', el)?.addEventListener('click', async () => { if (await confirmBox(t('purge_q', { j: p.retention_factures_jours }), { danger: true, ok: t('purger_maintenant') })) { const r = await act(() => POST('/parametres/purger')); if (r) toast(t('purge_ok', { n: r.supprimees }), 'ok'); } });
}

// ------------------------------------------------------------------ MON COMPTE
async function vCompte(el) {
  const bios = await GET('/me/biometrie');
  const bioOk = window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn?.() && window.isSecureContext;
  setTitle(t('nav.compte'), roleNom(S.user.role));
  el.innerHTML = `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><div class="row">${avatar(S.user, 'lg')}<div><h2>${esc(S.user.nom_complet)}</h2><div class="muted">@${esc(S.user.username)} · <span class="badge accent">${roleNom(S.user.role)}</span></div></div></div>
      <div class="row" style="margin-top:12px"><button class="btn sm" id="ph">📷 ${t('changer_photo')}</button>${S.user.photo ? `<button class="btn sm ghost" id="ph-rm">${t('retirer')}</button>` : ''}
        <button class="btn sm" id="myf">🧩 ${t('mes_fonctionnalites')}</button></div>
      <div style="margin-top:14px">${langSwitch('cpt-lang')}</div>
      <div class="row" style="margin-top:12px">${S.installPrompt ? `<button class="btn sm primary" id="install">📲 ${t('installer_app')}</button>` : ''}
        ${window.RestoAndroid || window.RestoDesktop ? `<button class="btn sm" id="srv">🌐 ${t('adresse_serveur')}</button>` : ''}
        <button class="btn sm danger show-m" id="out2">⏻ ${t('deconnexion')}</button></div></div>
    <div class="card"><h2 style="margin-bottom:6px">🔐 ${t('login.bio')}</h2><p class="small muted" style="margin-top:0">${t('bio_explication')}</p>
      ${bios.map(b => `<div class="row" style="padding:6px 0;border-bottom:1px solid #f4f1ec"><span class="grow">📱 ${esc(b.appareil)}<br><small class="muted">${dateTime(b.created_at)}</small></span><button class="btn sm ghost" data-rb="${b.id}">${t('retirer')}</button></div>`).join('')}
      <button class="btn primary" id="bio-add" style="margin-top:10px" ${bioOk ? '' : 'disabled'}>+ ${t('activer_appareil')}</button>
      ${bioOk ? '' : `<p class="small" style="color:var(--warn)">${t('login.bio_https')}</p>`}</div>
    <div class="card"><h2 style="margin-bottom:10px">🖥️ ${t('prefs_appareil')}</h2>
      <label class="feat" style="cursor:pointer"><div class="txt">⌨️ ${t('clavier_tactile')}<small>${t('clavier_aide')}</small></div><label class="switch"><input type="checkbox" id="p-vkb" ${window.VKB?.enabled() ? 'checked' : ''}><span></span></label></label>
      ${can('cuisine.voir') ? `<label class="feat" style="cursor:pointer"><div class="txt">🔄 ${t('paysage_auto')}<small>${t('paysage_aide')}</small></div><label class="switch"><input type="checkbox" id="p-land" ${(store.get('kLandscape') ?? (S.user.role === 'CUISINIER' ? 'on' : 'off')) === 'on' ? 'checked' : ''}><span></span></label></label>` : ''}</div>
    <div class="card"><h2 style="margin-bottom:10px">🔑 ${t('changer_mdp')}</h2><form id="fpw">
      <label class="field"><span>${t('mdp_actuel')}</span><input class="input" type="password" name="ancien" autocomplete="current-password" required></label>
      <label class="field"><span>${t('nouveau_mdp')}</span><input class="input" type="password" name="nouveau" autocomplete="new-password" minlength="6" required></label>
      <button class="btn primary">${t('mettre_a_jour')}</button></form></div></div>`;
  bindLangSwitch(el, relangue);
  $('#fpw', el).onsubmit = async e => { e.preventDefault(); if (await act(() => POST('/me/password', formData(e.target)), t('mdp_modifie'))) e.target.reset(); };
  $('#out2', el).onclick = async () => { if (await confirmBox(t('deconnexion_q'))) logout(); };
  $('#install', el)?.addEventListener('click', () => { S.installPrompt.prompt(); S.installPrompt = null; });
  $('#srv', el)?.addEventListener('click', () => (window.RestoAndroid || window.RestoDesktop).reglages());
  $('#p-vkb', el).onchange = e => window.VKB?.setEnabled(e.target.checked);
  $('#p-land', el)?.addEventListener('change', e => store.set('kLandscape', e.target.checked ? 'on' : 'off'));
  $('#ph', el).onclick = async () => { const data = await choisirImage({ max: 320 }); if (data) { const r = await act(() => POST('/me/photo', { data }), t('photo_ok')); if (r) { S.user.photo = r.photo; relangue(); } } };
  $('#ph-rm', el)?.addEventListener('click', async () => { if (await act(() => DEL('/me/photo'))) { S.user.photo = null; relangue(); } });
  $('#myf', el).onclick = async () => {
    const all = await GET('/fonctionnalites').catch(() => null);
    const list = all ? all.filter(f => S.user.permissions.includes(f.code)) : [];
    const mods = {}; list.forEach(f => { (mods[f.module] ||= []).push(f); });
    modal({ title: t('mes_fonctionnalites'), body: Object.entries(mods).map(([m, fs]) => `<div class="feat-module"><h3>${esc(moduleNom(m))}</h3>${fs.map(f => `<div class="feat">🟢<div class="txt">${esc(featNom(f))}<small>${esc(f.code)}</small></div></div>`).join('')}</div>`).join('') || S.user.permissions.join(', ') });
  };
  $$('[data-rb]', el).forEach(b => b.onclick = async () => { if (await act(() => DEL('/me/biometrie/' + b.dataset.rb), t('retire'))) softRender(); });
  $('#bio-add', el).onclick = async () => {
    try {
      const optionsJSON = await POST('/auth/webauthn/register/options');
      const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON });
      await POST('/auth/webauthn/register/verify', { response, appareil: deviceName() });
      toast(t('bio_ok'), 'ok'); softRender();
    } catch (e) { toast(e.name === 'InvalidStateError' ? t('bio_deja') : e.name === 'NotAllowedError' ? t('bio_annulee') : e.message, 'bad'); }
  };
}
function deviceName() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'Mac' : 'Device';
  const model = (ua.match(/Android [\d.]+; ([^;)]+)/) || [])[1];
  return model ? `${os} — ${model}` : os;
}

// ------------------------------------------------------------------ démarrage
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); S.installPrompt = e; });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
window.go = go;
boot();
