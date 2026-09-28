/* =====================================================================
   Clavier tactile intégré (AZERTY / QWERTY / arabe + pavé numérique)
   Pour les ordinateurs à écran tactile sans clavier physique.
   Activable / désactivable : bouton ⌨️ (barre du haut, écran de connexion, Mon compte).
   Le choix est mémorisé sur l'appareil.
   ===================================================================== */
(function () {
  'use strict';
  const KEY = 'vkb';
  let on = false;
  try { on = localStorage.getItem(KEY) === 'on'; } catch { /* stockage indisponible */ }
  let target = null, shift = 0, page = 'alpha'; // shift : 0 = minuscules, 1 = une majuscule, 2 = verrouillé

  // Dispositions : AZERTY (français), QWERTY (anglais), arabe ; symboles ; pavé numérique
  const ALPHA = {
    fr: [['1','2','3','4','5','6','7','8','9','0'], ['a','z','e','r','t','y','u','i','o','p'], ['q','s','d','f','g','h','j','k','l','m'],
         ['{shift}','w','x','c','v','b','n',"'",'{bksp}'], ['{sym}','é','è','à','{space}','.','-','{enter}','{close}']],
    en: [['1','2','3','4','5','6','7','8','9','0'], ['q','w','e','r','t','y','u','i','o','p'], ['a','s','d','f','g','h','j','k','l','@'],
         ['{shift}','z','x','c','v','b','n','m','{bksp}'], ['{sym}',',','{space}','.','-','{enter}','{close}']],
    ar: [['١','٢','٣','٤','٥','٦','٧','٨','٩','٠'], ['ض','ص','ث','ق','ف','غ','ع','ه','خ','ح','ج'], ['ش','س','ي','ب','ل','ا','ت','ن','م','ك','ط'],
         ['ئ','ء','ؤ','ر','ى','ة','و','ز','ظ','د','{bksp}'], ['{sym}','أ','إ','آ','{space}','.','{enter}','{close}']]
  };
  let langue = 'fr';
  try { langue = localStorage.getItem('lang') || 'fr'; } catch { /* */ }
  const PAGES = {
    get alpha() { return ALPHA[langue] || ALPHA.fr; },
    sym: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
      ['@', '#', '&', '"', '(', ')', '!', '?', ':', ';'],
      ['+', '=', '/', '*', '%', '_', '€', '$', ',', '«'],
      ['{abc}', 'ê', 'ç', 'ù', 'â', 'ô', 'î', 'ë', '{bksp}'],
      ['{abc}', ',', '{space}', '.', '{enter}', '{close}']
    ],
    num: [
      ['7', '8', '9', '{bksp}'],
      ['4', '5', '6', '+'],
      ['1', '2', '3', '.'],
      ['00', '0', '000', '{enter}'],
      ['{abc}', '{space}', '{close}']
    ]
  };
  const ESPACE = { fr: 'espace', en: 'space', ar: 'مسافة' };
  const ABC = { fr: 'ABC', en: 'ABC', ar: 'أبج' };
  const LABEL = { '{shift}': '⇧', '{bksp}': '⌫', '{sym}': '?123', get '{abc}'() { return ABC[langue] || 'ABC'; }, get '{space}'() { return ESPACE[langue] || 'espace'; }, '{enter}': '↵ OK', '{close}': '⌄' };

  const panel = document.createElement('div');
  panel.className = 'vkb';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Keyboard');
  panel.dir = 'ltr';
  document.body.appendChild(panel);

  const isField = el => !!el && !el.disabled && !el.readOnly && (el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && ['text', 'password', 'search', 'email', 'tel', 'number', 'url', ''].includes(el.type)));
  const numeric = el => el.type === 'number' || el.type === 'tel' || el.inputMode === 'numeric';

  function render() {
    const rows = PAGES[page];
    panel.className = `vkb vkb-${page}`;
    panel.innerHTML = rows.map(r => `<div class="vkb-row">${r.map(k => {
      const special = k.startsWith('{');
      let lbl = special ? LABEL[k] : (shift ? k.toUpperCase() : k);
      const cls = special ? `vkb-k vkb-${k.slice(1, -1)}${k === '{shift}' && shift ? ' on' : ''}${k === '{shift}' && shift === 2 ? ' lock' : ''}` : 'vkb-k';
      return `<button type="button" class="${cls}" data-k="${k.replace(/"/g, '&quot;')}">${lbl.replace(/</g, '&lt;')}</button>`;
    }).join('')}</div>`).join('');
  }

  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); }
  function sel(el) { try { return [el.selectionStart, el.selectionEnd]; } catch { return [null, null]; } }
  function insert(txt) {
    const el = target;
    if (!el) return;
    const [s, e] = sel(el);
    if (s == null) el.value += txt;
    else el.setRangeText(txt, s, e, 'end');
    fire(el);
  }
  function backspace() {
    const el = target;
    if (!el) return;
    const [s, e] = sel(el);
    if (s == null) el.value = el.value.slice(0, -1);
    else if (s !== e) el.setRangeText('', s, e, 'end');
    else if (s > 0) el.setRangeText('', s - 1, s, 'end');
    fire(el);
  }
  function enter() {
    const el = target;
    if (!el) return;
    if (el.tagName === 'TEXTAREA') return insert('\n');
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const f = el.form;
    if (f) { f.requestSubmit ? f.requestSubmit() : f.submit(); }
    hide();
  }

  function press(k) {
    if (k === '{shift}') { shift = (shift + 1) % 3; return render(); }
    if (k === '{bksp}') return backspace();
    if (k === '{enter}') return enter();
    if (k === '{close}') { hide(); target?.blur(); return; }
    if (k === '{sym}') { page = 'sym'; return render(); }
    if (k === '{abc}') { page = 'alpha'; return render(); }
    if (k === '{space}') return insert(' ');
    insert(shift ? k.toUpperCase() : k);
    if (shift === 1) { shift = 0; render(); }
  }

  // Les touches ne doivent pas retirer le focus du champ
  ['mousedown', 'pointerdown', 'touchstart'].forEach(ev => panel.addEventListener(ev, e => { if (e.target.closest('.vkb-k')) e.preventDefault(); }, { passive: false }));
  panel.addEventListener('click', e => {
    const b = e.target.closest('.vkb-k');
    if (!b) return;
    b.classList.add('hit'); setTimeout(() => b.classList.remove('hit'), 90);
    press(b.dataset.k);
  });
  // Appui long sur ⌫ : effacement continu
  let rep;
  panel.addEventListener('pointerdown', e => {
    if (!e.target.closest('.vkb-bksp')) return;
    rep = setTimeout(function loop() { backspace(); rep = setTimeout(loop, 70); }, 450);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => panel.addEventListener(ev, () => clearTimeout(rep)));

  function show(el) {
    target = el;
    page = numeric(el) ? 'num' : 'alpha';
    shift = (el.type === 'text' && !el.value && /nom|client|livreur|adresse|motif/i.test(el.name || el.id || '')) ? 1 : 0;
    render();
    panel.hidden = false;
    document.body.classList.add('vkb-open');
    document.documentElement.style.setProperty('--vkb-h', panel.offsetHeight + 'px');
    setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
  }
  function hide() {
    panel.hidden = true;
    document.body.classList.remove('vkb-open');
    target = null;
  }
  function suppressNative(el) {
    if (!el.dataset.vkbIm) el.dataset.vkbIm = el.getAttribute('inputmode') || '-';
    el.setAttribute('inputmode', 'none');
  }
  function restoreNative() {
    document.querySelectorAll('[data-vkb-im]').forEach(el => {
      if (el.dataset.vkbIm === '-') el.removeAttribute('inputmode'); else el.setAttribute('inputmode', el.dataset.vkbIm);
      delete el.dataset.vkbIm;
    });
  }

  document.addEventListener('focusin', e => {
    if (!on || !isField(e.target)) return;
    suppressNative(e.target);
    show(e.target);
  });
  document.addEventListener('pointerdown', e => {
    // Toucher un champ déjà actif rouvre le clavier s'il a été fermé
    if (on && isField(e.target) && panel.hidden && document.activeElement === e.target) show(e.target);
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => { if (!isField(document.activeElement)) hide(); }, 80);
  });

  function setEnabled(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* stockage indisponible */ }
    if (on) { const a = document.activeElement; if (isField(a)) { suppressNative(a); show(a); } }
    else { hide(); restoreNative(); }
    document.querySelectorAll('[data-vkb-toggle]').forEach(b => b.classList.toggle('on', on));
    document.dispatchEvent(new CustomEvent('vkb-change', { detail: on }));
  }

  // Change la disposition du clavier avec la langue de l'application
  function setLang(l) { langue = ALPHA[l] ? l : 'fr'; if (!panel.hidden) render(); }
  window.VKB = { enabled: () => on, setEnabled, toggle: () => setEnabled(!on), hide, setLang };
})();
