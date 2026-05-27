const KEY = 'a11y.settings.v3';

const DEFAULTS = {
  fontfam: 'hyperlegible',
  letterSpaceEm: 0,
  userLevel: 0,
  aiLevel: 0,
  aiLevelZoom: 0,
  aiLevelMiss: 0,
  aiLevelRead: 0,
  theme: 'default',
  underlineLinks: false,
  thickFocus: false,
  measureGlobal: true,
  focusAlways: false,
  reduceMotion: false,
  aiMode: 'auto',
  userSetTheme: false,
  userSetTypography: false,
  userSetMotion: false,
  userSetFocus: false,
  userSetLinks: false,
  ttsRate: 1
};

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if (!raw) return sanitizeState(DEFAULTS);
    const parsed = JSON.parse(raw);
    return sanitizeState({ ...DEFAULTS, ...parsed });
  }catch{
    return sanitizeState(DEFAULTS);
  }
}

function save(state){
  localStorage.setItem(KEY, JSON.stringify(state));
}

function clamp(n, min, max, fallback = min){
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeState(s){
  const out = { ...DEFAULTS, ...(s || {}) };

  out.fontfam = (out.fontfam === 'system' || out.fontfam === 'hyperlegible') ? out.fontfam : DEFAULTS.fontfam;
  out.theme = (['default', 'dark', 'high-contrast', 'sepia'].includes(out.theme)) ? out.theme : DEFAULTS.theme;
  out.aiMode = (['auto', 'gentle', 'off'].includes(out.aiMode)) ? out.aiMode : DEFAULTS.aiMode;

  out.userLevel = clamp(out.userLevel, 0, 4, 0);
  out.aiLevel = clamp(out.aiLevel, 0, 4, 0);
  out.aiLevelZoom = clamp(out.aiLevelZoom, 0, 4, 0);
  out.aiLevelMiss = clamp(out.aiLevelMiss, 0, 4, 0);
  out.aiLevelRead = clamp(out.aiLevelRead, 0, 4, 0);
  out.letterSpaceEm = clamp(out.letterSpaceEm, 0, 0.08, 0);
  out.ttsRate = clamp(out.ttsRate, 0.5, 2, 1);

  out.underlineLinks = !!out.underlineLinks;
  out.thickFocus = !!out.thickFocus;
  out.measureGlobal = !!out.measureGlobal;
  out.focusAlways = !!out.focusAlways;
  out.reduceMotion = !!out.reduceMotion;

  out.userSetTheme = !!out.userSetTheme;
  out.userSetTypography = !!out.userSetTypography;
  out.userSetMotion = !!out.userSetMotion;
  out.userSetFocus = !!out.userSetFocus;
  out.userSetLinks = !!out.userSetLinks;

  return out;
}

function applyState(state){
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;

  const effectiveLevel = Math.max(
    Number(state.userLevel ?? 0),
    Number(state.aiLevel ?? 0),
    Number(state.aiMode === 'auto' ? (state.aiLevelMiss ?? 0) : 0),
    Number(state.aiMode === 'auto' ? (state.aiLevelRead ?? 0) : 0)
  );

  const lvl = Math.max(0, Math.min(4, effectiveLevel));

  root.classList.remove('a11y-l0', 'a11y-l1', 'a11y-l2', 'a11y-l3', 'a11y-l4');
  root.classList.add(`a11y-l${lvl}`);

  root.style.setProperty('--font', state.fontfam === 'system' ? 'var(--font-system)' : 'var(--font-hyper)');
  root.style.setProperty('--letter-space-base', `${state.letterSpaceEm}em`);

  body.classList.remove('theme-default', 'theme-dark', 'theme-high-contrast', 'theme-sepia');
  body.classList.add(`theme-${state.theme}`);

  body.classList.toggle('underline-links', !!state.underlineLinks);
  body.classList.toggle('focus-thick', !!state.thickFocus);
  body.classList.toggle('measure-all', !!state.measureGlobal);
  body.classList.toggle('focus-always', !!state.focusAlways);
  body.classList.toggle('reduce-motion', !!state.reduceMotion);
  const motionPref = state.reduceMotion
    ? (state.userSetMotion ? 'user' : 'auto')
    : (state.userSetMotion ? 'allow' : 'system');

  body.dataset.motionPref = motionPref;
  root.dataset.motionPref = motionPref;

  body.dataset.aiMode = state.aiMode;
  body.dataset.zoomAssist = String(Number(state.aiLevelZoom ?? 0));

  const rate = document.getElementById('tts-rate');
  if (rate) rate.value = String(state.ttsRate);
}

function setRangeValueText(input, text){
  if (!input) return;
  input.setAttribute('aria-valuetext', text);
}

function syncSharedOverlayState(backdrop){
  const body = document.body;
  if (!body) return;

  const hasPanel = body.dataset.a11yPanelOpen === 'true';
  const hasNewsDialog = body.dataset.newsDialogOpen === 'true';
  const shouldLock = hasPanel || hasNewsDialog;

  body.classList.toggle('dialog-open', shouldLock);
  if (backdrop) backdrop.hidden = !shouldLock;
}

function trapFocus(panel){
  const sel = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const isVisible = (el) => {
    if (!el) return false;
    if (el.hasAttribute('hidden')) return false;

    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;

    return el.getClientRects().length > 0;
  };

  function onKey(e){
    if (e.key !== 'Tab') return;

    const items = Array.from(panel.querySelectorAll(sel))
      .filter((el) => isVisible(el) && el.tabIndex >= 0);

    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];

    if (e.shiftKey && document.activeElement === first){
      e.preventDefault();
      last.focus();
    }else if (!e.shiftKey && document.activeElement === last){
      e.preventDefault();
      first.focus();
    }
  }

  panel.addEventListener('keydown', onKey);
  return () => panel.removeEventListener('keydown', onKey);
}

export function initA11yPanel({ tts } = {}){
  const fab = document.getElementById('a11y-toggle');
  const panel = document.getElementById('a11y-panel');
  const backdrop = document.getElementById('backdrop');
  const close1 = document.getElementById('a11y-close');
  const close2 = document.getElementById('a11y-close2');
  const reset = document.getElementById('a11y-reset');
  const live = document.getElementById('a11y-live');
  const a11yLevel = document.getElementById('a11y-level');

  const fontRadios = Array.from(document.querySelectorAll('input[name="fontfam"]'));
  const letterspace = document.getElementById('letterspace');
  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
  const allPanelRadios = [...fontRadios, ...themeRadios];
  const underlineLinks = document.getElementById('underline-links');
  const thickFocus = document.getElementById('thick-focus');
  const measureGlobal = document.getElementById('measure-global');
  const focusAlways = document.getElementById('focus-always');
  const reduceMotion = document.getElementById('reduce-motion');
  const aiMode = document.getElementById('ai-mode');
  const ttsRate = document.getElementById('tts-rate');

  let state = load();
  let untrap = null;

  function announce(text){
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 20);
  }

  function syncUI(){
    fontRadios.forEach((r) => { r.checked = r.value === state.fontfam; });
    allPanelRadios.forEach((r) => { r.tabIndex = 0; });
    if (letterspace) letterspace.value = String(state.letterSpaceEm);
    if (a11yLevel) a11yLevel.value = String(state.userLevel ?? 0);
    setRangeValueText(a11yLevel, `Рівень ${state.userLevel ?? 0} з 4`);
    setRangeValueText(
      letterspace,
      Number(state.letterSpaceEm) > 0
        ? `Інтервал між літерами ${Math.round(Number(state.letterSpaceEm) * 100)} відсотків em`
        : 'Стандартний інтервал між літерами'
    );

    themeRadios.forEach((r) => { r.checked = r.value === state.theme; });

    if (underlineLinks) underlineLinks.checked = !!state.underlineLinks;
    if (thickFocus) thickFocus.checked = !!state.thickFocus;
    if (measureGlobal) measureGlobal.checked = !!state.measureGlobal;
    if (focusAlways) focusAlways.checked = !!state.focusAlways;
    if (reduceMotion) reduceMotion.checked = !!state.reduceMotion;

    if (aiMode) aiMode.value = state.aiMode;
    if (ttsRate) ttsRate.value = String(state.ttsRate);
    setRangeValueText(ttsRate, `Швидкість ${Number(state.ttsRate).toFixed(2).replace(/\.00$/, '')}`);
  }

  function commit(patch, announceText, { source = 'user' } = {}){
    const next = { ...patch };

    if (source === 'user'){
      if ('theme' in patch) next.userSetTheme = true;
      if ('letterSpaceEm' in patch || 'fontfam' in patch) next.userSetTypography = true;
      if ('reduceMotion' in patch) next.userSetMotion = true;
      if ('thickFocus' in patch || 'focusAlways' in patch) next.userSetFocus = true;
      if ('underlineLinks' in patch) next.userSetLinks = true;
    }

    state = sanitizeState({ ...state, ...next });
    applyState(state);
    save(state);
    syncUI();
    if (announceText) announce(announceText);
  }

  function open(){
    if (!panel || !backdrop) return;
    panel.hidden = false;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    document.body.dataset.a11yPanelOpen = 'true';
    syncSharedOverlayState(backdrop);

    fab?.setAttribute('aria-expanded', 'true');
    syncUI();

    untrap = trapFocus(panel);

    const title = document.getElementById('a11y-title');
    const focusEl = title || panel;

    if (focusEl && !focusEl.hasAttribute('tabindex')) {
      focusEl.setAttribute('tabindex', '-1');
    }
    focusEl?.focus?.();
  }

  function close(){
    if (!panel || !backdrop) return;
    panel.hidden = true;
    document.body.dataset.a11yPanelOpen = 'false';
    syncSharedOverlayState(backdrop);

    fab?.setAttribute('aria-expanded', 'false');

    if (untrap){ untrap(); untrap = null; }
    fab?.focus();
  }

  fab?.addEventListener('click', open);
  close1?.addEventListener('click', close);
  close2?.addEventListener('click', close);
  backdrop?.addEventListener('click', (e) => {
    if (!panel || panel.hidden) return;
    e.stopImmediatePropagation();
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel && !panel.hidden){
      e.stopImmediatePropagation();
      close();
    }
  });

  panel?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const p = btn.getAttribute('data-preset');

    if (p === 'reading'){
      commit({
        userLevel: 2,
        measureGlobal: true,
        letterSpaceEm: 0.02
      }, 'Увімкнено пресет "Легке читання".');
    }else if (p === 'vision'){
      commit({
        theme: 'high-contrast',
        userLevel: 3,
        thickFocus: true,
        underlineLinks: true,
        measureGlobal: true
      }, 'Увімкнено пресет "Слабкий зір".');
    }else if (p === 'keyboard'){
      commit({
        thickFocus: true,
        focusAlways: false,
        underlineLinks: true
      }, 'Увімкнено пресет "Клавіатура".');
    }else if (p === 'focus'){
      commit({
        reduceMotion: true,
        measureGlobal: true,
        underlineLinks: false
      }, 'Увімкнено пресет "Концентрація".');
    }
  });

  fontRadios.forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    commit({ fontfam: r.value }, 'Змінено шрифт.');
  }));

  letterspace?.addEventListener('input', () => commit({ letterSpaceEm: Number(letterspace.value) }));
  a11yLevel?.addEventListener('input', () => commit(
    { userLevel: Number(a11yLevel.value) },
    `Рівень збільшення: ${a11yLevel.value}.`
  ));

  themeRadios.forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    commit({ theme: r.value }, 'Змінено тему.');
  }));

  underlineLinks?.addEventListener('change', () => commit({ underlineLinks: underlineLinks.checked }));
  thickFocus?.addEventListener('change', () => commit({ thickFocus: thickFocus.checked }));
  measureGlobal?.addEventListener('change', () => commit({ measureGlobal: measureGlobal.checked }));
  focusAlways?.addEventListener('change', () => commit({ focusAlways: focusAlways.checked }));
  reduceMotion?.addEventListener('change', () => commit({ reduceMotion: reduceMotion.checked }));

  aiMode?.addEventListener('change', () => commit({ aiMode: aiMode.value }, 'Змінено режим AI.'));

  ttsRate?.addEventListener('input', () => {
    commit({ ttsRate: Number(ttsRate.value) });
  });

  reset?.addEventListener('click', () => {
    state = { ...DEFAULTS, userSetMotion: true };
    applyState(state);
    save(state);
    syncUI();
    announce('Налаштування скинуто.');
    tts?.stop?.();
    document.dispatchEvent(new CustomEvent('a11y:reset-all'));
  });

  applyState(state);
  syncUI();

  return {
    open,
    close,
    getState: () => ({ ...state }),
    setState: (next) => commit(next, null, { source: 'user' }),
    setAILevels: (patch) => commit(patch, null, { source: 'ai' }),
    setAIState: (patch) => commit(patch, null, { source: 'ai' })
  };
}
