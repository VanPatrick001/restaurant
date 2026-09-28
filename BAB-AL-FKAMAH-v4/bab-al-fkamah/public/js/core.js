/* =====================================================================
   BAB AL FKAMAH — noyau de l'interface : état, langue, API, modales,
   structure par rôle, navigation, temps réel, connexion
   ===================================================================== */
'use strict';

const S = {
  token: null, user: null, config: { nom: 'BAB AL FKAMAH', logo: '', devise: 'AED', delai_rouge: 120, delai_cuisine: 30, recap_heures: 12, indicatif: '971' },
  lang: 'fr', menu: null, notifs: [], unread: 0, es: null,
  route: { name: '', args: [], query: {} }, pos: { tab: null, q: '' }, installPrompt: null
};

// ------------------------------------------------------------------ utilitaires
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const can = (...codes) => !!S.user && (S.user.role === 'ADMIN' || codes.some(c => S.user.permissions.includes(c)));
const initials = n => String(n || '?').split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const minutesSince = d => Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
const locale = () => ({ fr: 'fr-FR', en: 'en-GB', ar: 'ar-AE-u-nu-latn' }[S.lang]);
const money = n => new Intl.NumberFormat(locale(), { style: 'currency', currency: S.config.devise || 'AED', minimumFractionDigits: 2 }).format(Number(n || 0));
const num = n => new Intl.NumberFormat(locale()).format(Number(n || 0));
const hhmm = d => d ? new Date(d).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) : '';
const dateTime = d => d ? new Date(d).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const dateCourte = d => d ? new Date(d).toLocaleDateString(locale(), { day: '2-digit', month: 'short' }) : '';
const duree = m => m < 60 ? t('duree.min', { m }) : t('duree.h', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') });
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } }
};
const avatar = (u, cls = '') => `<div class="avatar ${cls}" style="background:${esc(u.role_couleur || 'var(--accent)')}">${u.photo ? `<img src="${esc(u.photo)}" alt="">` : initials(u.nom_complet)}</div>`;
const logoHtml = () => S.config.logo ? `<img src="${esc(S.config.logo)}" alt="">` : '🍽️';

// Noms traduits (plats, catégories, rôles, fonctionnalités)
const tr = o => (o?.traductions && (o.traductions[S.lang] || o.traductions.en || o.traductions.fr)) || o?.nom || '';
function platNom(platId, fallback) {
  const p = S.menu?.plats.find(x => x.id === platId);
  return p ? tr(p) : (fallback || '');
}
const roleNom = code => t('role.' + code, {}, code);
const featNom = f => t('f.' + f.code, {}, f.libelle);
const moduleNom = m => t('mod.' + m, {}, m);

// WhatsApp : lien wa.me à partir du numéro du client (indicatif du pays ajouté si besoin)
function waNumero(tel) {
  let d = String(tel || '').replace(/[^\d+]/g, '');
  if (!d) return '';
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  const ind = String(S.config.indicatif || '971');
  if (d.startsWith(ind)) return d;
  if (d.startsWith('0')) d = d.slice(1);
  return ind + d;
}
const waLien = (tel, texte = '') => `https://wa.me/${waNumero(tel)}${texte ? '?text=' + encodeURIComponent(texte) : ''}`;
const mapLien = loc => /^https?:\/\//.test(loc) ? loc : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}`;

// ------------------------------------------------------------------ langue
function setLang(l, save = true) {
  if (!['fr', 'en', 'ar'].includes(l)) l = 'fr';
  S.lang = l;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  store.set('lang', l);
  window.VKB?.setLang?.(l);
  if (save && S.user) PUT('/me/langue', { langue: l }).catch(() => {});
}
function langSwitch(id = '') {
  return `<div class="lang-switch" ${id ? `id="${id}"` : ''} role="group" aria-label="Language">${['fr', 'en', 'ar'].map(l =>
    `<button type="button" data-lang="${l}" class="${S.lang === l ? 'on' : ''}">${{ fr: 'FR', en: 'EN', ar: 'عربي' }[l]}</button>`).join('')}</div>`;
}
function bindLangSwitch(root, after) {
  $$('[data-lang]', root).forEach(b => b.onclick = () => { setLang(b.dataset.lang); after(); });
}

// ------------------------------------------------------------------ API
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Lang': S.lang, ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (res.status === 401 && S.token && !path.startsWith('/auth')) { logout(true); throw new Error(data?.error || t('session_expiree')); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}
const GET = p => api(p);
const POST = (p, b = {}) => api(p, { method: 'POST', body: b });
const PUT = (p, b = {}) => api(p, { method: 'PUT', body: b });
const PATCH = (p, b = {}) => api(p, { method: 'PATCH', body: b });
const DEL = (p, b) => api(p, { method: 'DELETE', body: b });
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, 'ok'); return r; }
  catch (e) { toast(e.message, 'bad'); return undefined; }
}

// ------------------------------------------------------------------ toasts, sons, modales
function toast(msg, type = '', icon) {
  const ic = icon || { ok: '✅', bad: '⚠️', notif: '🔔' }[type] || 'ℹ️';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${ic}</span><div>${esc(msg)}</div>`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, type === 'bad' ? 5000 : 4000);
}
let audioCtx;
// Sons : pret (commande prête), livraison, alerte (retard), info
function son(type = 'info') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const motifs = { info: [[880, 0, .25]], pret: [[988, 0, .18], [1319, .22, .35]], livraison: [[784, 0, .15], [988, .18, .15], [1175, .36, .3]], alerte: [[440, 0, .3], [330, .35, .5]] };
    for (const [f, debut, d] of motifs[type] || motifs.info) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.frequency.value = f;
      const t0 = audioCtx.currentTime + debut;
      g.gain.setValueAtTime(0.18, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
      o.start(t0); o.stop(t0 + d);
    }
    navigator.vibrate?.(type === 'alerte' ? [300, 120, 300] : type === 'info' ? 120 : [150, 80, 150]);
  } catch { /* audio indisponible */ }
}
document.addEventListener('pointerdown', () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume?.(); } catch { /* */ } }, { once: true });

function modal({ title, body = '', foot = '', wide = false, onClose }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost icon-btn" data-close aria-label="${t('fermer')}">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  const close = () => { ov.remove(); onClose?.(); };
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(ov);
  const esc_ = e => { if (e.key === 'Escape' && document.body.lastElementChild === ov) { close(); document.removeEventListener('keydown', esc_); } };
  document.addEventListener('keydown', esc_);
  setTimeout(() => $('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), textarea', ov)?.focus(), 60);
  return { el: ov, close, body: $('.modal-body', ov) };
}
function confirmBox(text, { ok = t('confirmer'), danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = modal({ title: t('confirmation'), body: `<p>${text}</p>`,
      foot: `<button class="btn" data-close>${t('annuler')}</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${ok}</button>`,
      onClose: () => { if (!done) resolve(false); } });
    $('[data-ok]', m.el).onclick = () => { done = true; m.close(); resolve(true); };
  });
}
function formData(el) {
  const o = {};
  $$('[name]', el).forEach(i => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
  return o;
}

// Choix d'une image → redimensionnée dans le navigateur → data-URL (JPEG ou PNG)
function choisirImage({ max = 800, png = false } = {}) {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => { toast(t('image_illisible'), 'bad'); resolve(null); };
      img.src = URL.createObjectURL(f);
    };
    inp.click();
  });
}

// ------------------------------------------------------------------ navigation par rôle
const ROUTES = {
  dashboard:    { icon: '📊', perm: ['rapport.voir'], render: () => vDashboard, live: true },
  salle:        { icon: '🪑', perm: ['salle.voir', 'commande.creer'], render: () => vSalle, live: true },
  commandes:    { icon: '🧾', perm: ['commande.voir_miennes', 'commande.voir_toutes', 'commande.gerer_toutes'], render: () => vCommandes, live: true },
  emporter:     { icon: '🛵', perm: ['livraison.voir'], render: () => vEmporter, live: true },
  livraisons:   { icon: '🛵', perm: ['livraison.voir_disponibles'], render: () => vLivraisons, live: true },
  caisse:       { icon: '💰', perm: ['facture.voir'], render: () => vCaisse, live: true },
  cuisine:      { icon: '👨‍🍳', perm: ['cuisine.voir'], render: () => vCuisine, live: true },
  menu:         { icon: '📖', perm: ['menu.voir'], render: () => vMenu },
  utilisateurs: { icon: '👥', perm: ['utilisateur.voir'], render: () => vUtilisateurs },
  groupes:      { icon: '🧩', perm: ['groupe.gerer', 'groupe.fonctionnalites'], render: () => vGroupes },
  roles:        { icon: '🛡️', perm: ['role.fonctionnalites'], render: () => vRoles },
  journal:      { icon: '📜', perm: ['journal.voir'], render: () => vJournal },
  parametres:   { icon: '🔧', perm: ['parametres.gerer', 'parametres.cuisine'], render: () => vParametres },
  compte:       { icon: '⚙️', perm: [], render: () => vCompte },
  commande:     { hidden: true, perm: ['commande.creer', 'commande.voir_miennes', 'commande.voir_toutes'], render: () => vCommande },
  facture:      { hidden: true, perm: ['facture.voir', 'livraison.voir_disponibles'], render: () => vFacture }
};
const ORDER = {
  ADMIN: ['dashboard', 'salle', 'caisse', 'cuisine', 'commandes', 'emporter', 'menu', 'utilisateurs', 'groupes', 'roles', 'parametres', 'journal', 'compte'],
  PATRON: ['dashboard', 'salle', 'caisse', 'commandes', 'emporter', 'cuisine', 'menu', 'utilisateurs', 'groupes', 'roles', 'parametres', 'journal', 'compte'],
  CAISSIER: ['caisse', 'emporter', 'commandes', 'salle', 'menu', 'compte'],
  SERVEUR: ['salle', 'commandes', 'emporter', 'caisse', 'menu', 'compte'],
  CUISINIER: ['cuisine', 'menu', 'compte'],
  LIVREUR: ['livraisons', 'compte']
};
const routeLabel = k => k === 'caisse' && !can('facture.payer') ? t('nav.factures') : t('nav.' + k);
function navItems() {
  const order = ORDER[S.user.role] || [];
  const extra = Object.keys(ROUTES).filter(k => !order.includes(k));
  return [...order, ...extra].filter(k => !ROUTES[k].hidden && (ROUTES[k].perm.length === 0 || can(...ROUTES[k].perm)))
    .filter(k => !(k === 'livraisons' && can('livraison.voir') && S.user.role !== 'LIVREUR'));
}
const home = () => navItems()[0] || 'compte';
const go = path => { location.hash = '#/' + path; };

// ------------------------------------------------------------------ démarrage
async function boot() {
  S.config = { ...S.config, ...(await GET('/config').catch(() => ({}))) };
  setLang(store.get('lang') || S.config.langue_defaut || 'fr', false);
  S.token = store.get('token');
  if (S.token) { try { S.user = await GET('/me'); } catch { S.token = null; store.del('token'); } }
  if (!S.user) return vLogin();
  startApp();
}
function startApp() {
  document.documentElement.style.setProperty('--accent', S.user.role_couleur || '#0f766e');
  renderShell();
  connectEvents();
  loadNotifs();
  refreshCounts();
  if (can('menu.voir', 'commande.creer', 'facture.voir')) loadMenu().catch(() => {});
  window.onhashchange = render;
  render();
  clearInterval(S.clockTimer);
  S.clockTimer = setInterval(() => {
    const c = $('#clock'); if (c) c.textContent = hhmm(new Date());
    tickMinuteurs();
  }, 20000);
  clearInterval(S.liveTimer);
  S.liveTimer = setInterval(() => { if (ROUTES[S.route.name]?.live && !$('.overlay') && !document.activeElement?.matches('input,textarea,select')) softRender(); }, 60000);
}
function logout(expired) {
  S.es?.close();
  S.token = null; S.user = null; S.menu = null; S.serveurs = null;
  document.documentElement.classList.remove('force-landscape');
  store.del('token');
  window.onhashchange = null;
  history.replaceState(null, '', '/');
  vLogin();
  if (expired) toast(t('session_expiree'), 'bad');
}

// Minuteurs (cuisine, factures en attente) mis à jour sans recharger
function tickMinuteurs() {
  $$('[data-since]').forEach(el => {
    const m = minutesSince(el.dataset.since);
    const tm = $('.minuteur', el) || (el.classList.contains('minuteur') ? el : null);
    if (tm) tm.textContent = duree(m);
    const lim = Number(el.dataset.limite || 0);
    if (lim) el.classList.toggle(el.dataset.cls || 'rouge', m >= lim);
  });
}

// ------------------------------------------------------------------ CONNEXION
function vLogin() {
  const last = store.get('lastUser') || '';
  const bioOk = window.SimpleWebAuthnBrowser?.browserSupportsWebAuthn?.() && window.isSecureContext;
  document.title = S.config.nom;
  $('#root').innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <div class="login-langs">${langSwitch('lg')}</div>
    <div class="login-logo">${logoHtml()}</div>
    <h1>${esc(S.config.nom)}</h1>
    <p class="muted" style="margin:.3rem 0 1.4rem">${t('login.sous_titre')}</p>
    <form id="login-form" autocomplete="on">
      <label class="field"><span>${t('login.utilisateur')}</span>
        <input class="input" name="username" autocomplete="username" autocapitalize="none" value="${esc(last)}" required></label>
      <label class="field"><span>${t('login.mdp')}</span>
        <div class="row" style="flex-wrap:nowrap"><input class="input grow" type="password" name="password" autocomplete="current-password" required>
        <button type="button" class="btn icon-btn" id="eye" aria-label="${t('login.voir_mdp')}">👁️</button></div></label>
      <button class="btn primary lg block" type="submit">${t('login.connexion')}</button>
    </form>
    <div class="divider">${t('ou')}</div>
    <button class="btn block bio-btn" id="bio" ${bioOk ? '' : 'disabled'}><span class="ico">🔐</span><span><b>${t('login.bio')}</b><br>
      <small class="muted">${bioOk ? t('login.bio_aide') : t('login.bio_https')}</small></span></button>
    <label class="row" style="margin-top:14px;justify-content:center;gap:.6rem;cursor:pointer">
      <label class="switch"><input type="checkbox" id="vkb-login" ${window.VKB?.enabled() ? 'checked' : ''}><span></span></label>⌨️ ${t('clavier_tactile')}</label>
    <div class="login-hint">${t('login.demo')}<br>
      ${[['admin', 'admin123'], ['patron', 'patron123'], ['caisse', 'caisse123'], ['serveur1', 'serveur123'], ['cuisine', 'cuisine123'], ['livreur1', 'livreur123']]
        .map(([u, p]) => `<code data-u="${u}" data-p="${p}">${u}</code>`).join(' ')}</div>
  </div></div>`;
  const f = $('#login-form');
  bindLangSwitch($('#root'), vLogin);
  $('#eye').onclick = () => { const i = $('[name=password]', f); i.type = i.type === 'password' ? 'text' : 'password'; };
  $$('.login-hint code').forEach(c => c.onclick = () => { f.username.value = c.dataset.u; f.password.value = c.dataset.p; });
  $('#vkb-login').onchange = e => { window.VKB?.setEnabled(e.target.checked); (last ? f.password : f.username).focus(); };
  if (last) f.password.focus(); else f.username.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = $('button[type=submit]', f); btn.disabled = true;
    try { onLogged(await POST('/auth/login', { username: f.username.value, password: f.password.value })); }
    catch (err) { toast(err.message, 'bad'); btn.disabled = false; }
  };
  $('#bio').onclick = async () => {
    try {
      const { challengeKey, ...optionsJSON } = await POST('/auth/webauthn/login/options', { username: f.username.value.trim() });
      const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON });
      onLogged(await POST('/auth/webauthn/login/verify', { response, challengeKey }));
    } catch (err) { toast(err.name === 'NotAllowedError' ? t('bio_annulee') : err.message, 'bad'); }
  };
}
function onLogged(r) {
  S.token = r.token; S.user = r.user;
  store.set('token', r.token);
  store.set('lastUser', r.user.username);
  // La langue choisie sur l'écran de connexion est conservée et enregistrée pour ce compte
  setLang(S.lang, true);
  history.replaceState(null, '', '/#/' + home());
  startApp();
  toast(t('bonjour', { nom: r.user.nom_complet.split(' ')[0] }), 'ok');
}

// ------------------------------------------------------------------ STRUCTURE
function renderShell() {
  const items = navItems();
  const more = items.length > 5;
  const mob = more ? items.slice(0, 4) : items.slice(0, 5);
  document.title = S.config.nom;
  $('#root').innerHTML = `
  <div class="app">
    <aside class="side">
      <div class="brand"><div class="logo">${logoHtml()}</div><div><b>${esc(S.config.nom)}</b><small>${t('espace', { role: roleNom(S.user.role) })}</small></div></div>
      <nav class="nav">${items.map(k => `<a href="#/${k}" data-nav="${k}"><span class="ico">${ROUTES[k].icon}</span>${routeLabel(k)}<span class="count hidden" data-count="${k}"></span></a>`).join('')}</nav>
      <div class="side-user">${avatar(S.user)}
        <div class="who"><b>${esc(S.user.nom_complet)}</b><small>${roleNom(S.user.role)}</small></div>
        <button class="btn sm" id="logout" title="${t('deconnexion')}">⏻</button></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="title"><h1 id="page-title"></h1><small id="page-sub"></small></div>
        <div class="row" id="page-actions"></div>
        <span class="clock" id="clock">${hhmm(new Date())}</span>
        <span class="hide-m">${langSwitch('top-lang')}</span>
        <button class="btn icon-btn vkb-toggle ${window.VKB?.enabled() ? 'on' : ''}" data-vkb-toggle id="vkb-t" title="${t('clavier_tactile')}">⌨️</button>
        <button class="btn icon-btn bell" id="bell" aria-label="${t('notifications')}">🔔<span class="dot hidden" id="bell-dot"></span></button>
        <button class="btn icon-btn show-m" id="m-user" aria-label="${t('nav.compte')}" style="padding:0;border:0;overflow:hidden">${avatar(S.user)}</button>
      </header>
      <main class="content" id="content"></main>
    </div>
    <nav class="mobile-nav">${mob.map(k => `<a href="#/${k}" data-nav="${k}"><span class="ico">${ROUTES[k].icon}</span><span class="count hidden" data-count="${k}"></span><span>${t('navc.' + k, {}, routeLabel(k))}</span></a>`).join('')}
      ${more ? `<a href="#" id="m-more"><span class="ico">☰</span><span>${t('plus')}</span></a>` : ''}</nav>
  </div>`;
  $('#logout').onclick = async () => { if (await confirmBox(t('deconnexion_q'))) logout(); };
  $('#bell').onclick = toggleNotifs;
  $('#vkb-t').onclick = () => { window.VKB?.toggle(); toast(window.VKB?.enabled() ? t('clavier_on') : t('clavier_off'), '', '⌨️'); };
  bindLangSwitch($('.topbar'), relangue);
  $('#m-user').onclick = () => mobileMenu(items);
  $('#m-more')?.addEventListener('click', e => { e.preventDefault(); mobileMenu(items.slice(4)); });
}
function relangue() { renderShell(); updateBell(); refreshCounts(); render(); }
function mobileMenu(items) {
  const m = modal({
    title: `${esc(S.user.nom_complet)} <span class="badge accent">${roleNom(S.user.role)}</span>`,
    body: `<div style="margin-bottom:12px">${langSwitch('mm-lang')}</div><div style="display:grid;gap:6px">${items.map(k => `<a class="btn block" style="justify-content:flex-start" href="#/${k}">${ROUTES[k].icon} ${routeLabel(k)}</a>`).join('')}
      <button class="btn block danger" id="mm-out" style="justify-content:flex-start">⏻ ${t('deconnexion')}</button></div>`
  });
  bindLangSwitch(m.el, () => { m.close(); relangue(); });
  $$('a', m.el).forEach(a => a.addEventListener('click', () => m.close()));
  $('#mm-out', m.el).onclick = async () => { m.close(); if (await confirmBox(t('deconnexion_q'))) logout(); };
}
function setTitle(title, sub = '', actions = '') {
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  $('#page-actions').innerHTML = actions;
  document.title = `${title} · ${S.config.nom}`;
}

async function render() {
  if (!S.user) return;
  const [chemin, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [name, ...args] = chemin.split('/').filter(Boolean);
  let key = ROUTES[name] ? name : home();
  if (ROUTES[key].perm.length && !can(...ROUTES[key].perm)) key = home();
  S.route = { name: key, args, query: Object.fromEntries(new URLSearchParams(qs)) };
  $$('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === key || (!!ROUTES[key].hidden && a.dataset.nav === S.lastList)));
  $('.notif-panel')?.remove(); $('.sheet-backdrop')?.remove();
  if (!ROUTES[key].hidden) S.lastList = key;
  document.body.dataset.route = key;
  applyLandscape();
  const el = $('#content');
  el.innerHTML = `<div class="empty"><div class="big">⏳</div>${t('chargement')}</div>`;
  try { await ROUTES[key].render()(el, ...args); }
  catch (e) { el.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(e.message)}</div>`; }
}
async function softRender() {
  const y = window.scrollY, r = ROUTES[S.route.name];
  if (!r) return;
  try { await r.render()($('#content'), ...S.route.args); window.scrollTo(0, y); } catch { /* ignoré */ }
}

// ------------------------------------------------------------------ TEMPS RÉEL + NOTIFICATIONS
function connectEvents() {
  S.es?.close();
  const es = new EventSource('/api/events?token=' + encodeURIComponent(S.token));
  S.es = es;
  es.addEventListener('notification', e => {
    const n = JSON.parse(e.data);
    n.lu = 0;
    S.notifs.unshift(n); S.unread++;
    updateBell();
    toast(notifTexte(n), 'notif', notifIcon(n.type));
    son(n.son || 'info');
    if (n.type === 'COMPTE') {
      GET('/me').then(u => { S.user = u; relangue(); }).catch(() => {});
    }
  });
  es.addEventListener('config', e => {
    S.config = { ...S.config, ...JSON.parse(e.data) };
    if (S.route.name !== 'parametres') relangue();
  });
  let tm;
  es.addEventListener('refresh', e => {
    const d = JSON.parse(e.data);
    clearTimeout(tm);
    tm = setTimeout(() => {
      refreshCounts();
      if (d.scope === 'menu') { S.menu = null; if (can('menu.voir', 'commande.creer', 'facture.voir')) loadMenu().catch(() => {}); }
      const r = S.route.name;
      if (r === 'commande' || r === 'facture') { refreshDoc(d); return; }
      if (ROUTES[r]?.live || (r === 'menu' && d.scope === 'menu')) {
        if ($('.overlay') || document.activeElement?.matches('input,textarea,select')) return;
        softRender();
      }
    }, 350);
  });
}
const notifIcon = tp => ({ FACTURE: '🧾', FACTURE_MODIFIEE: '✏️', PAIEMENT: '💰', CUISINE: '👨‍🍳', COMPTE: '👤', LIVRAISON: '🛵', ALERTE: '🚨', SUPPRESSION: '🗑️', COMMANDE: '📋' }[tp] || '🔔');
function notifTexte(n) {
  const p = { ...(n.params || {}) };
  if (p.role) p.role = roleNom(p.role);
  if (p.code) p.code = t('f.' + p.code, {}, p.code);
  if (p.lieu && ['SUR_PLACE', 'EMPORTER', 'LIVRAISON'].includes(p.lieu)) p.lieu = t('svc.' + p.lieu);
  if (p.mode) p.mode = t('mode.' + p.mode);
  return t('n.' + n.titre, p, n.message || n.titre);
}
async function loadNotifs() {
  S.notifs = await GET('/notifications').catch(() => []);
  S.unread = S.notifs.filter(n => !n.lu).length;
  updateBell();
}
function updateBell() {
  const d = $('#bell-dot');
  if (!d) return;
  d.textContent = S.unread > 9 ? '9+' : S.unread;
  d.classList.toggle('hidden', !S.unread);
}
function suivreLien(l) {
  if (!l) return;
  if (l.startsWith('commande:')) go('commande/' + l.split(':')[1]);
  else if (l.startsWith('facture:')) go('facture/' + l.split(':')[1]);
  else if (l === 'caisse:corbeille') { S.caisseTab = 'CORBEILLE'; go('caisse'); }
  else if (l === 'livraisons' && !can('livraison.voir_disponibles')) go('emporter');
  else if (ROUTES[l]) go(l);
}
function toggleNotifs() {
  const ex = $('.notif-panel');
  if (ex) return ex.remove();
  const p = document.createElement('div');
  p.className = 'card notif-panel';
  p.innerHTML = `<div class="row" style="padding:4px 6px 8px"><h2 class="grow">${t('notifications')}</h2><button class="btn sm" id="n-all">${t('tout_lu')}</button></div>
    ${S.notifs.length ? S.notifs.map(n => `<div class="notif ${n.lu ? '' : 'unread'}" data-id="${n.id}" data-lien="${esc(n.lien || '')}">
      <span class="e">${notifIcon(n.type)}</span><div><div>${esc(notifTexte(n))}</div><div class="small muted">${dateTime(n.created_at)}</div></div></div>`).join('')
      : `<div class="empty">${t('aucune_notif')}</div>`}`;
  document.body.appendChild(p);
  $('#n-all', p).onclick = async () => { await POST('/notifications/lu'); S.notifs.forEach(n => { n.lu = 1; }); S.unread = 0; updateBell(); p.remove(); };
  $$('.notif', p).forEach(el => el.onclick = () => {
    const n = S.notifs.find(x => String(x.id) === el.dataset.id);
    if (n && !n.lu) { n.lu = 1; S.unread = Math.max(0, S.unread - 1); updateBell(); POST('/notifications/lu', { id: n.id }); }
    p.remove();
    suivreLien(el.dataset.lien);
  });
  setTimeout(() => document.addEventListener('click', function off(e) { if (!p.contains(e.target) && e.target.id !== 'bell') { p.remove(); document.removeEventListener('click', off); } }), 0);
}
async function refreshCounts() {
  const set = (k, n) => $$(`[data-count="${k}"]`).forEach(el => { el.textContent = n; el.classList.toggle('hidden', !n); });
  try {
    if (can('facture.payer')) set('caisse', (await GET('/factures?statut=A_PAYER')).length);
    if (can('cuisine.voir')) set('cuisine', (await GET('/cuisine')).commandes.filter(c => c.statut_cuisine === 'EN_ATTENTE').length);
    if (can('livraison.voir_disponibles') && S.user.role === 'LIVREUR') set('livraisons', (await GET('/livraisons?onglet=disponibles')).compte.disponibles || 0);
    if (can('commande.voir_miennes') && !can('commande.voir_toutes')) {
      set('commandes', (await GET('/commandes?statut=VALIDEE,PAYEE&miennes=1')).filter(c => c.statut_cuisine === 'PRETE').length);
    }
  } catch { /* ignoré */ }
}

// ------------------------------------------------------------------ Paysage (écran cuisine)
async function kitchenFullscreen() {
  try { await document.documentElement.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); document.documentElement.classList.remove('force-landscape'); }
  catch { applyLandscape(); }
}
function landscapeWanted() {
  const pref = store.get('kLandscape');
  return (pref === null ? S.user?.role === 'CUISINIER' : pref === 'on') && S.route.name === 'cuisine';
}
function applyLandscape() {
  document.documentElement.classList.toggle('force-landscape', !!(S.user && landscapeWanted() && window.innerHeight > window.innerWidth));
}
window.addEventListener('resize', () => applyLandscape());
