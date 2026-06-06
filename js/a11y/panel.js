const KEY = 'a11y.settings.v4';
const LEGACY_KEY = 'a11y.settings.v3';

const MANUAL_KEYS = [
  'fontfam',
  'simpleFont',
  'textScale',
  'lineHeight',
  'letterSpaceEm',
  'columnWidth',
  'theme',
  'underlineLinks',
  'thickFocus',
  'focusAlways',
  'reduceMotion',
  'readingMode',
  'largeTargets',
  'declutter'
];

const DEFAULTS = {
  fontfam: 'hyperlegible',
  simpleFont: false,
  textScale: 100,
  lineHeight: 1.6,
  letterSpaceEm: 0,
  columnWidth: 'comfortable',
  theme: 'default',
  underlineLinks: false,
  thickFocus: false,
  focusAlways: false,
  reduceMotion: false,
  readingMode: false,
  largeTargets: false,
  declutter: false,
  aiMode: 'auto',
  ttsRate: 1,
  manual: Object.fromEntries(MANUAL_KEYS.map((key) => [key, false]))
};

const AUTO_DEFAULTS = {
  theme: null,
  textScale: null,
  lineHeight: null,
  letterSpaceEm: null,
  columnWidth: null,
  underlineLinks: null,
  thickFocus: null,
  reduceMotion: null,
  readingMode: null,
  readingRuler: null,
  largeTargetLevel: 0,
  declutter: null,
  reduceTransparency: null,
  zoomLevel: 0,
  simplifyLayout: false,
  oneColumn: false
};

const COLUMN_WIDTHS = {
  narrow: '640px',
  comfortable: '68ch',
  wide: '78ch'
};

function cloneDefaults(){
  return {
    ...DEFAULTS,
    manual: { ...DEFAULTS.manual }
  };
}

function cloneAutoDefaults(){
  return { ...AUTO_DEFAULTS };
}

function clamp(n, min, max, fallback = min){
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeState(raw){
  const source = raw || {};
  const state = {
    ...cloneDefaults(),
    ...source,
    manual: { ...DEFAULTS.manual, ...(source.manual || {}) }
  };

  state.fontfam = ['system', 'hyperlegible'].includes(state.fontfam) ? state.fontfam : DEFAULTS.fontfam;
  state.theme = ['default', 'dark', 'high-contrast', 'sepia'].includes(state.theme) ? state.theme : DEFAULTS.theme;
  state.columnWidth = Object.hasOwn(COLUMN_WIDTHS, state.columnWidth) ? state.columnWidth : DEFAULTS.columnWidth;
  state.aiMode = ['auto', 'gentle', 'off'].includes(state.aiMode) ? state.aiMode : DEFAULTS.aiMode;
  state.textScale = clamp(state.textScale, 90, 140, DEFAULTS.textScale);
  state.lineHeight = clamp(state.lineHeight, 1.4, 2, DEFAULTS.lineHeight);
  state.letterSpaceEm = clamp(state.letterSpaceEm, 0, 0.12, DEFAULTS.letterSpaceEm);
  state.ttsRate = clamp(state.ttsRate, 0.7, 1.4, DEFAULTS.ttsRate);

  [
    'simpleFont',
    'underlineLinks',
    'thickFocus',
    'focusAlways',
    'reduceMotion',
    'readingMode',
    'largeTargets',
    'declutter'
  ].forEach((key) => {
    state[key] = !!state[key];
  });

  MANUAL_KEYS.forEach((key) => {
    state.manual[key] = !!state.manual[key];
  });

  return state;
}

function migrateLegacy(raw){
  if (!raw) return null;

  const levels = [100, 107, 114, 122, 132];
  const level = clamp(raw.userLevel, 0, 4, 0);
  const manual = { ...DEFAULTS.manual };

  if (raw.userSetTheme) manual.theme = true;
  if (raw.userSetTypography){
    manual.fontfam = true;
    manual.letterSpaceEm = true;
    manual.textScale = true;
  }
  if (raw.userSetMotion) manual.reduceMotion = true;
  if (raw.userSetFocus){
    manual.thickFocus = true;
    manual.focusAlways = true;
  }
  if (raw.userSetLinks) manual.underlineLinks = true;

  return {
    ...cloneDefaults(),
    fontfam: raw.fontfam,
    textScale: levels[level] || 100,
    lineHeight: 1.6 + (level * 0.08),
    letterSpaceEm: raw.letterSpaceEm,
    theme: raw.theme,
    underlineLinks: raw.underlineLinks,
    thickFocus: raw.thickFocus,
    focusAlways: raw.focusAlways,
    reduceMotion: raw.reduceMotion,
    largeTargets: level > 0,
    aiMode: raw.aiMode,
    ttsRate: raw.ttsRate,
    manual
  };
}

function load(){
  try{
    const saved = localStorage.getItem(KEY);
    if (saved) return sanitizeState(JSON.parse(saved));

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) return sanitizeState(migrateLegacy(JSON.parse(legacy)));
  }catch{}

  return sanitizeState(cloneDefaults());
}

function save(state){
  try{
    localStorage.setItem(KEY, JSON.stringify(state));
  }catch{}
}

function sanitizeAutoState(raw){
  const auto = { ...cloneAutoDefaults(), ...(raw || {}) };

  auto.theme = auto.theme === null || ['default', 'dark', 'high-contrast', 'sepia'].includes(auto.theme)
    ? auto.theme
    : null;
  auto.columnWidth = auto.columnWidth === null || Object.hasOwn(COLUMN_WIDTHS, auto.columnWidth)
    ? auto.columnWidth
    : null;
  auto.textScale = auto.textScale === null ? null : clamp(auto.textScale, 90, 140, 100);
  auto.lineHeight = auto.lineHeight === null ? null : clamp(auto.lineHeight, 1.4, 2, 1.6);
  auto.letterSpaceEm = auto.letterSpaceEm === null ? null : clamp(auto.letterSpaceEm, 0, 0.12, 0);
  auto.largeTargetLevel = Math.round(clamp(auto.largeTargetLevel, 0, 3, 0));
  auto.zoomLevel = Math.round(clamp(auto.zoomLevel, 0, 3, 0));

  ['underlineLinks', 'thickFocus', 'reduceMotion', 'readingMode', 'readingRuler', 'declutter', 'reduceTransparency'].forEach((key) => {
    if (auto[key] !== null) auto[key] = !!auto[key];
  });
  ['simplifyLayout', 'oneColumn'].forEach((key) => {
    auto[key] = !!auto[key];
  });

  return auto;
}

function countAutoChanges(auto){
  return Object.entries(auto).reduce((count, [key, value]) => {
    if (key === 'largeTargetLevel' || key === 'zoomLevel') return count + (value > 0 ? 1 : 0);
    if (key === 'simplifyLayout' || key === 'oneColumn') return count + (value ? 1 : 0);
    return count + (value !== null && value !== false ? 1 : 0);
  }, 0);
}

function pickValue(state, auto, key){
  if (state.manual[key]) return state[key];
  return auto[key] ?? state[key];
}

function getEffectiveState(state, auto){
  const largeTargetLevel = state.manual.largeTargets
    ? (state.largeTargets ? 1 : 0)
    : Math.max(state.largeTargets ? 1 : 0, Number(auto.largeTargetLevel || 0));

  return {
    fontfam: state.simpleFont ? 'hyperlegible' : state.fontfam,
    textScale: pickValue(state, auto, 'textScale'),
    lineHeight: pickValue(state, auto, 'lineHeight'),
    letterSpaceEm: pickValue(state, auto, 'letterSpaceEm'),
    columnWidth: pickValue(state, auto, 'columnWidth'),
    theme: pickValue(state, auto, 'theme'),
    underlineLinks: pickValue(state, auto, 'underlineLinks'),
    thickFocus: pickValue(state, auto, 'thickFocus'),
    focusAlways: state.focusAlways,
    reduceMotion: pickValue(state, auto, 'reduceMotion'),
    readingMode: pickValue(state, auto, 'readingMode'),
    readingRuler: !!auto.readingRuler,
    declutter: pickValue(state, auto, 'declutter'),
    reduceTransparency: !!auto.reduceTransparency,
    largeTargetLevel,
    zoomLevel: Number(auto.zoomLevel || 0),
    simplifyLayout: !!auto.simplifyLayout,
    oneColumn: !!auto.oneColumn
  };
}

function applyState(state, auto){
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;

  const effective = getEffectiveState(state, auto);
  root.style.setProperty('--font', effective.fontfam === 'system' ? 'var(--font-system)' : 'var(--font-hyper)');
  root.style.setProperty('--font-size-base', `${effective.textScale}%`);
  root.style.setProperty('--line-base', String(effective.lineHeight));
  root.style.setProperty('--letter-space-base', `${effective.letterSpaceEm}em`);
  root.style.setProperty('--measure-base', COLUMN_WIDTHS[effective.columnWidth] || COLUMN_WIDTHS.comfortable);

  body.classList.remove('theme-default', 'theme-dark', 'theme-high-contrast', 'theme-sepia');
  body.classList.add(`theme-${effective.theme}`);
  body.classList.toggle('underline-links', !!effective.underlineLinks);
  body.classList.toggle('focus-thick', !!effective.thickFocus);
  body.classList.toggle('focus-always', !!effective.focusAlways);
  body.classList.toggle('reduce-motion', !!effective.reduceMotion);
  body.classList.toggle('a11y-reading-mode', !!effective.readingMode);
  body.classList.toggle('a11y-reading-ruler', !!effective.readingRuler);
  body.classList.toggle('a11y-declutter', !!effective.declutter);
  body.classList.toggle('a11y-reduce-transparency', !!effective.reduceTransparency);
  body.classList.toggle('a11y-simplified-layout', !!effective.simplifyLayout);
  body.classList.toggle('a11y-one-column', !!effective.oneColumn);

  body.dataset.aiMode = state.aiMode;
  body.dataset.targetLevel = String(effective.largeTargetLevel);
  body.dataset.zoomAssist = String(effective.zoomLevel);

  const motionPref = effective.reduceMotion
    ? (state.manual.reduceMotion ? 'user' : 'auto')
    : (state.manual.reduceMotion ? 'allow' : 'system');

  body.dataset.motionPref = motionPref;
  root.dataset.motionPref = motionPref;
}

function setRangeValueText(input, text){
  input?.setAttribute('aria-valuetext', text);
}

function syncSharedOverlayState(backdrop){
  const body = document.body;
  if (!body) return;

  const shouldLock =
    body.dataset.a11yPanelOpen === 'true' ||
    body.dataset.newsDialogOpen === 'true';

  body.classList.toggle('dialog-open', shouldLock);
  if (backdrop) backdrop.hidden = !shouldLock;
}

function trapFocus(panel){
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function getItems(){
    return Array.from(panel.querySelectorAll(selector))
      .filter((el) => !el.hidden && el.tabIndex >= 0 && el.getClientRects().length > 0);
  }

  function onKeydown(e){
    if (e.key !== 'Tab') return;

    const items = getItems();
    if (!items.length) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (!items.includes(active)){
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }

    if (e.shiftKey && active === first){
      e.preventDefault();
      last.focus();
    }else if (!e.shiftKey && active === last){
      e.preventDefault();
      first.focus();
    }
  }

  panel.addEventListener('keydown', onKeydown);
  return () => panel.removeEventListener('keydown', onKeydown);
}

export function initA11yPanel({ tts } = {}){
  const fab = document.getElementById('a11y-toggle');
  const panel = document.getElementById('a11y-panel');
  const backdrop = document.getElementById('backdrop');
  const closeButtons = [
    document.getElementById('a11y-close'),
    document.getElementById('a11y-close2')
  ];
  const reset = document.getElementById('a11y-reset');
  const undoAuto = document.getElementById('auto-undo');
  const live = document.getElementById('a11y-live');

  const fontRadios = Array.from(document.querySelectorAll('input[name="fontfam"]'));
  const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'));
  const controls = {
    simpleFont: document.getElementById('simple-font'),
    textScale: document.getElementById('text-scale'),
    lineHeight: document.getElementById('line-height'),
    letterSpaceEm: document.getElementById('letterspace'),
    columnWidth: document.getElementById('column-width'),
    underlineLinks: document.getElementById('underline-links'),
    thickFocus: document.getElementById('thick-focus'),
    focusAlways: document.getElementById('focus-always'),
    reduceMotion: document.getElementById('reduce-motion'),
    readingMode: document.getElementById('reading-mode'),
    largeTargets: document.getElementById('large-targets'),
    declutter: document.getElementById('declutter'),
    aiMode: document.getElementById('ai-mode'),
    ttsRate: document.getElementById('tts-rate')
  };

  let state = load();
  let autoState = sanitizeAutoState(AUTO_DEFAULTS);
  let autoLog = [];
  let untrap = null;
  let resetArmed = false;
  let resetTimer = 0;

  function disarmReset(){
    resetArmed = false;
    window.clearTimeout(resetTimer);
    resetTimer = 0;
    if (reset) reset.textContent = 'Скинути всі налаштування';
  }

  function announce(text){
    if (!live || !text) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 20);
  }

  function syncUI(){
    fontRadios.forEach((radio) => {
      radio.checked = radio.value === state.fontfam;
    });
    themeRadios.forEach((radio) => {
      radio.checked = radio.value === state.theme;
    });

    Object.entries(controls).forEach(([key, control]) => {
      if (!control) return;
      if (control.type === 'checkbox') control.checked = !!state[key];
      else control.value = String(state[key]);
    });

    const textPercent = Math.round(state.textScale);
    const linePercent = Math.round(state.lineHeight * 100);
    const letterPercent = Math.round(state.letterSpaceEm * 100);
    document.getElementById('text-scale-value').textContent = `${textPercent}%`;
    document.getElementById('line-height-value').textContent = `${linePercent}%`;
    document.getElementById('letterspace-value').textContent = `${letterPercent}%`;
    setRangeValueText(controls.textScale, `Розмір тексту ${textPercent} відсотків`);
    setRangeValueText(controls.lineHeight, `Міжрядковий інтервал ${linePercent} відсотків`);
    setRangeValueText(controls.letterSpaceEm, letterPercent
      ? `Інтервал між літерами ${letterPercent} відсотків em`
      : 'Стандартний інтервал між літерами');
    setRangeValueText(controls.ttsRate, `Швидкість ${Math.round(state.ttsRate * 100)} відсотків`);
  }

  function syncAutoUI(){
    const count = countAutoChanges(autoState);
    const activity = document.getElementById('auto-activity');
    const countEl = document.getElementById('auto-count');
    const list = document.getElementById('auto-log-list');

    if (activity){
      activity.dataset.active = String(count > 0);
      activity.textContent = count > 0 ? 'Автоадаптація активна' : 'Автоадаптація неактивна';
    }
    if (countEl) countEl.textContent = `Авто-змін: ${count}`;
    if (undoAuto) undoAuto.disabled = count === 0;
    if (list){
      list.innerHTML = autoLog.length
        ? autoLog.map((item) => `<li>${item}</li>`).join('')
        : '<li>Автоматичних рішень ще немає.</li>';
    }
  }

  function applyAndSync(){
    applyState(state, autoState);
    syncUI();
    syncAutoUI();
  }

  function markManual(next, patch){
    Object.keys(patch).forEach((key) => {
      if (MANUAL_KEYS.includes(key)) next.manual[key] = true;
    });
  }

  function commit(patch, announceText = '', { source = 'user' } = {}){
    const next = sanitizeState({
      ...state,
      ...patch,
      manual: { ...state.manual }
    });

    if (source === 'user') markManual(next, patch);
    state = next;
    save(state);
    applyAndSync();
    if (announceText) announce(announceText);
  }

  function recordAutoDecision(message){
    if (!message) return;
    const stamp = new Intl.DateTimeFormat('uk-UA', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(new Date());

    autoLog = [`${stamp}: ${message}`, ...autoLog].slice(0, 6);
    syncAutoUI();
  }

  function replaceAIState(next, { decision = '' } = {}){
    autoState = sanitizeAutoState(next);
    applyState(state, autoState);
    syncAutoUI();
    if (decision) recordAutoDecision(decision);
  }

  function setAIState(patch, { decision = '' } = {}){
    replaceAIState({ ...autoState, ...patch }, { decision });
  }

  function clearAutoChanges({ announceChange = true, dispatch = true } = {}){
    autoState = sanitizeAutoState(AUTO_DEFAULTS);
    applyState(state, autoState);
    if (announceChange){
      recordAutoDecision('Автоматичні зміни скасовано користувачем.');
      announce('Автоматичні зміни скасовано.');
    }else{
      syncAutoUI();
    }
    if (dispatch) document.dispatchEvent(new CustomEvent('a11y:auto-clear'));
  }

  function open(){
    if (!panel || !backdrop) return;
    document.dispatchEvent(new CustomEvent('a11y:panel-opening'));
    panel.hidden = false;
    document.body.dataset.a11yPanelOpen = 'true';
    syncSharedOverlayState(backdrop);
    fab?.setAttribute('aria-expanded', 'true');
    untrap?.();
    untrap = trapFocus(panel);
    applyAndSync();
    document.getElementById('a11y-title')?.focus();
  }

  function close({ restoreFocus = true } = {}){
    if (!panel || !backdrop) return;
    panel.hidden = true;
    document.body.dataset.a11yPanelOpen = 'false';
    syncSharedOverlayState(backdrop);
    fab?.setAttribute('aria-expanded', 'false');
    untrap?.();
    untrap = null;
    disarmReset();
    if (restoreFocus) fab?.focus();
  }

  function applyPreset(name){
    if (name === 'reading'){
      commit({
        textScale: 115,
        lineHeight: 1.85,
        letterSpaceEm: 0.01,
        columnWidth: 'narrow',
        readingMode: true,
        reduceMotion: true
      }, 'Увімкнено профіль "Комфортне читання".');
    }else if (name === 'vision'){
      commit({
        theme: 'high-contrast',
        textScale: 130,
        lineHeight: 1.85,
        largeTargets: true,
        thickFocus: true,
        underlineLinks: true,
        simpleFont: true
      }, 'Увімкнено профіль "Слабкий зір".');
    }else if (name === 'focus'){
      commit({
        columnWidth: 'narrow',
        readingMode: true,
        reduceMotion: true,
        declutter: true
      }, 'Увімкнено профіль "Концентрація".');
    }else if (name === 'keyboard'){
      commit({
        thickFocus: true,
        focusAlways: true,
        underlineLinks: true,
        largeTargets: true
      }, 'Увімкнено профіль "Клавіатурна навігація".');
    }
  }

  fab?.addEventListener('click', open);
  closeButtons.forEach((button) => button?.addEventListener('click', () => close()));
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
    const preset = e.target.closest('[data-preset]')?.getAttribute('data-preset');
    if (preset) applyPreset(preset);
  });

  fontRadios.forEach((radio) => radio.addEventListener('change', () => {
    if (radio.checked) commit({ fontfam: radio.value }, 'Змінено шрифт.');
  }));
  themeRadios.forEach((radio) => radio.addEventListener('change', () => {
    if (radio.checked) commit({ theme: radio.value }, 'Змінено тему.');
  }));

  [
    'simpleFont',
    'underlineLinks',
    'thickFocus',
    'focusAlways',
    'reduceMotion',
    'readingMode',
    'largeTargets',
    'declutter'
  ].forEach((key) => {
    controls[key]?.addEventListener('change', () => commit({ [key]: controls[key].checked }));
  });

  controls.textScale?.addEventListener('input', () => commit({ textScale: Number(controls.textScale.value) }));
  controls.lineHeight?.addEventListener('input', () => commit({ lineHeight: Number(controls.lineHeight.value) }));
  controls.letterSpaceEm?.addEventListener('input', () => commit({ letterSpaceEm: Number(controls.letterSpaceEm.value) }));
  controls.columnWidth?.addEventListener('change', () => commit({ columnWidth: controls.columnWidth.value }));
  controls.aiMode?.addEventListener('change', () => commit(
    { aiMode: controls.aiMode.value },
    `Режим автоматичної адаптації: ${controls.aiMode.options[controls.aiMode.selectedIndex]?.text || controls.aiMode.value}.`
  ));
  controls.ttsRate?.addEventListener('input', () => commit({ ttsRate: Number(controls.ttsRate.value) }));

  document.addEventListener('tts:rate-change', (e) => {
    commit({ ttsRate: Number(e.detail?.rate) || 1 });
  });

  undoAuto?.addEventListener('click', () => clearAutoChanges());

  reset?.addEventListener('click', () => {
    if (!resetArmed){
      resetArmed = true;
      reset.textContent = 'Підтвердити скидання';
      announce('Щоб скинути всі налаштування, натисніть кнопку ще раз.');
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        disarmReset();
      }, 6000);
      return;
    }

    disarmReset();
    state = sanitizeState(cloneDefaults());
    autoState = sanitizeAutoState(AUTO_DEFAULTS);
    autoLog = [];
    save(state);
    applyAndSync();
    tts?.stop?.();
    announce('Усі налаштування доступності скинуто.');
    document.dispatchEvent(new CustomEvent('a11y:reset-all'));
  });

  applyAndSync();

  return {
    open,
    close,
    getState: () => ({
      ...state,
      manual: { ...state.manual },
      auto: { ...autoState },
      effective: getEffectiveState(state, autoState),
      userSetTheme: state.manual.theme,
      userSetTypography: state.manual.textScale || state.manual.lineHeight || state.manual.letterSpaceEm,
      userSetMotion: state.manual.reduceMotion,
      userSetFocus: state.manual.thickFocus || state.manual.focusAlways,
      userSetLinks: state.manual.underlineLinks
    }),
    setState: (next) => commit(next, '', { source: 'user' }),
    setAILevels: (patch) => setAIState(patch),
    setAIState,
    replaceAIState,
    recordAutoDecision,
    clearAutoChanges
  };
}
