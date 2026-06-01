function mode(){
  return (document.body?.dataset?.aiMode || 'auto').toLowerCase();
}

function showAIToast(text, timeoutMs = 4500){
  const toast = document.getElementById('ai-indicator');
  const live = document.getElementById('a11y-live');
  if (!text) return;

  if (toast){
    const textEl = toast.querySelector('.ai-text');
    if (textEl) textEl.textContent = text;
    toast.hidden = false;
    toast.classList.add('show');

    window.clearTimeout(showAIToast._timer);
    showAIToast._timer = window.setTimeout(() => {
      toast.classList.remove('show');
      window.setTimeout(() => { toast.hidden = true; }, 250);
    }, timeoutMs);
  }

  if (live){
    live.textContent = '';
    window.setTimeout(() => { live.textContent = text; }, 20);
  }
}

const EMPTY_AUTO = {
  theme: null,
  textScale: null,
  lineHeight: null,
  letterSpaceEm: null,
  columnWidth: null,
  underlineLinks: null,
  thickFocus: null,
  reduceMotion: null,
  readingMode: null,
  largeTargetLevel: 0,
  declutter: null,
  reduceTransparency: null,
  zoomLevel: 0,
  simplifyLayout: false,
  oneColumn: false
};

export function initAIAdapt({ a11y } = {}){
  const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    'label',
    'summary',
    '[role="button"]',
    '[role="switch"]',
    '[tabindex]:not([tabindex="-1"])',
    '[data-ai-click-target]',
    '.backdrop'
  ].join(',');
  const media = {
    motion: window.matchMedia?.('(prefers-reduced-motion: reduce)'),
    contrast: window.matchMedia?.('(prefers-contrast: more)'),
    forced: window.matchMedia?.('(forced-colors: active)'),
    transparency: window.matchMedia?.('(prefers-reduced-transparency: reduce)'),
    coarse: window.matchMedia?.('(pointer: coarse)')
  };
  const sources = {
    system: {},
    zoom: {},
    misses: {},
    keyboard: {},
    reading: {},
    scroll: {}
  };

  let missTimes = [];
  let missTimer = 0;
  let lastMissInput = { x: 0, y: 0, time: 0, source: '' };
  let tabCount = 0;
  let sharpScrollTimes = [];
  let lastScroll = { y: window.scrollY || 0, time: performance.now() };
  let wheelScroll = { delta: 0, direction: 0, startedAt: 0, lastAt: 0 };
  let lastSharpInput = { direction: 0, time: 0 };
  let motionPauseTimer = 0;
  let zoomMonitorTimer = 0;
  let zoomMonitorStopTimer = 0;
  let articleTimer = 0;
  let articleEl = null;
  let articleScrollEl = null;
  let lastZoomLevel = 0;
  let lastMode = null;
  let autoSuppressed = false;
  let baseDpr = window.devicePixelRatio || 1;
  let baseVisualScale = window.visualViewport?.scale || 1;
  let gestureZoomFactor = 1;
  let lastZoomFingerprint = '';
  const decisionCache = new Map();

  function isSmart(){
    return mode() === 'auto';
  }

  function isEnabled(){
    return mode() !== 'off';
  }

  function maxNumber(key){
    const values = Object.values(sources)
      .map((source) => Number(source[key]))
      .filter((value) => Number.isFinite(value) && value > 0);

    return values.length ? Math.max(...values) : null;
  }

  function anyTrue(key){
    return Object.values(sources).some((source) => source[key] === true);
  }

  function combineSources(){
    return {
      ...EMPTY_AUTO,
      theme: sources.system.theme || null,
      textScale: maxNumber('textScale'),
      lineHeight: maxNumber('lineHeight'),
      letterSpaceEm: maxNumber('letterSpaceEm'),
      columnWidth: sources.reading.columnWidth || sources.zoom.columnWidth || null,
      underlineLinks: anyTrue('underlineLinks') ? true : null,
      thickFocus: anyTrue('thickFocus') ? true : null,
      reduceMotion: anyTrue('reduceMotion') ? true : null,
      readingMode: anyTrue('readingMode') ? true : null,
      largeTargetLevel: Math.max(0, ...Object.values(sources).map((source) => Number(source.largeTargetLevel || 0))),
      declutter: anyTrue('declutter') ? true : null,
      reduceTransparency: anyTrue('reduceTransparency') ? true : null,
      zoomLevel: Number(sources.zoom.zoomLevel || 0),
      simplifyLayout: anyTrue('simplifyLayout'),
      oneColumn: anyTrue('oneColumn')
    };
  }

  function syncAutoState(){
    a11y?.replaceAIState?.(combineSources());
  }

  function recordDecision(key, message, { toast = true } = {}){
    if (!message || decisionCache.get(key) === message) return;
    decisionCache.set(key, message);
    a11y?.recordAutoDecision?.(message);
    if (toast) showAIToast(`AI: ${message}`, 5200);
  }

  function setSource(name, patch, decision = '', options = {}){
    const next = { ...(patch || {}) };
    if (JSON.stringify(sources[name]) === JSON.stringify(next)) return false;
    sources[name] = next;
    syncAutoState();
    if (decision) recordDecision(name, decision, options);
    return true;
  }

  function clearSources(){
    Object.keys(sources).forEach((name) => {
      sources[name] = {};
    });
    a11y?.replaceAIState?.({ ...EMPTY_AUTO });
  }

  function syncVisualViewport(){
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = (viewport?.scale || 1) > 1.01
      ? Math.max(0, window.innerWidth - width - left)
      : 0;
    const bottom = Math.max(0, window.innerHeight - height - top);

    root.style.setProperty('--vv-width', `${Math.round(width)}px`);
    root.style.setProperty('--vv-height', `${Math.round(height)}px`);
    root.style.setProperty('--vv-left', `${Math.round(left)}px`);
    root.style.setProperty('--vv-top', `${Math.round(top)}px`);
    root.style.setProperty('--vv-right', `${Math.round(right)}px`);
    root.style.setProperty('--vv-bottom', `${Math.round(bottom)}px`);
    root.style.setProperty('--vv-center-x', `${Math.round(left + (width / 2))}px`);
    root.style.setProperty('--vv-center-y', `${Math.round(top + (height / 2))}px`);
    root.style.setProperty('--vv-dialog-height', `${Math.round(height * 0.88)}px`);
  }

  function getZoomFactor(){
    const dpr = window.devicePixelRatio || 1;
    const viewport = window.visualViewport;
    const visualScale = viewport?.scale || 1;

    return Math.max(
      1,
      dpr / baseDpr,
      visualScale / baseVisualScale,
      gestureZoomFactor
    );
  }

  function zoomLevelFromFactor(factor){
    if (factor >= 1.75) return 3;
    if (factor >= 1.35) return 2;
    if (factor >= 1.12) return 1;
    return 0;
  }

  function patchForZoom(level){
    if (level >= 3){
      return {
        zoomLevel: 3,
        textScale: 120,
        lineHeight: 1.85,
        columnWidth: 'narrow',
        largeTargetLevel: 2,
        simplifyLayout: true,
        oneColumn: true
      };
    }
    if (level === 2){
      return {
        zoomLevel: 2,
        textScale: 115,
        lineHeight: 1.75,
        columnWidth: 'narrow',
        largeTargetLevel: 1,
        simplifyLayout: true
      };
    }
    if (level === 1){
      return {
        zoomLevel: 1,
        textScale: 105,
        columnWidth: 'narrow',
        largeTargetLevel: 1
      };
    }
    return {};
  }

  function handleZoomChange(){
    syncVisualViewport();
    if (!isEnabled() || autoSuppressed) return;

    const factor = getZoomFactor();
    const level = zoomLevelFromFactor(factor);
    if (level === lastZoomLevel && Number(sources.zoom.zoomLevel || 0) === level) return;

    lastZoomLevel = level;
    const message = level
      ? `адаптовано інтерфейс до масштабу ${Math.round(factor * 100)}%.`
      : 'повернуто стандартне компонування після зменшення масштабу.';

    setSource('zoom', patchForZoom(level), message, { toast: level > 0 });
  }

  function getZoomFingerprint(){
    const viewport = window.visualViewport;
    return [
      window.devicePixelRatio || 1,
      document.documentElement.clientWidth || window.innerWidth || 1,
      viewport?.scale || 1,
      viewport?.width || window.innerWidth || 1,
      viewport?.height || window.innerHeight || 1,
      gestureZoomFactor
    ].join('|');
  }

  function pollZoom(){
    const fingerprint = getZoomFingerprint();
    if (fingerprint === lastZoomFingerprint) return;
    lastZoomFingerprint = fingerprint;
    handleZoomChange();
  }

  function startZoomMonitor(durationMs = 2200){
    pollZoom();
    if (!zoomMonitorTimer){
      zoomMonitorTimer = window.setInterval(pollZoom, 120);
    }

    window.clearTimeout(zoomMonitorStopTimer);
    zoomMonitorStopTimer = window.setTimeout(() => {
      window.clearInterval(zoomMonitorTimer);
      zoomMonitorTimer = 0;
      pollZoom();
    }, durationMs);
  }

  function updateGestureZoom(deltaY){
    const magnitude = Math.min(120, Math.abs(Number(deltaY) || 0));
    if (!magnitude) return;

    const step = 1 + Math.min(0.18, magnitude * 0.002);
    gestureZoomFactor = deltaY < 0
      ? Math.min(4, gestureZoomFactor * step)
      : Math.max(1, gestureZoomFactor / step);

    startZoomMonitor();
  }

  function resetZoomBaseline(){
    baseDpr = window.devicePixelRatio || 1;
    baseVisualScale = window.visualViewport?.scale || 1;
    gestureZoomFactor = 1;
    lastZoomFingerprint = '';
    lastZoomLevel = 0;
    setSource('zoom', {});
    syncVisualViewport();
  }

  function applySystemPrefs({ announce = false } = {}){
    if (!isEnabled() || autoSuppressed){
      setSource('system', {});
      return;
    }

    const forced = !!media.forced?.matches;
    const contrast = !!media.contrast?.matches;
    const motion = !!media.motion?.matches;
    const transparency = !!media.transparency?.matches;
    const coarse = !!media.coarse?.matches;
    const patch = {
      theme: forced ? 'high-contrast' : null,
      underlineLinks: forced || contrast,
      thickFocus: forced || contrast,
      reduceMotion: motion,
      reduceTransparency: transparency || forced,
      declutter: transparency,
      largeTargetLevel: coarse ? 1 : 0
    };
    const hasAdjustments = Object.values(patch).some((value) => value === true || value === 'high-contrast' || value === 1);

    setSource(
      'system',
      patch,
      hasAdjustments ? 'враховано системні налаштування доступності.' : '',
      { toast: announce && hasAdjustments }
    );
  }

  function pruneMisses(now = performance.now()){
    missTimes = missTimes.filter((time) => now - time <= 45000);
    return missTimes.length;
  }

  function scheduleMissPrune(){
    window.clearTimeout(missTimer);
    missTimer = 0;
    if (!missTimes.length) return;

    const delay = Math.max(100, 45020 - (performance.now() - missTimes[0]));
    missTimer = window.setTimeout(syncMissAssist, delay);
  }

  function nearestInteractiveWithin(x, y, radius = 38){
    const candidates = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR))
      .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
    let nearest = null;
    let distance = Infinity;

    candidates.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const dx = x < rect.left ? rect.left - x : (x > rect.right ? x - rect.right : 0);
      const dy = y < rect.top ? rect.top - y : (y > rect.bottom ? y - rect.bottom : 0);
      const current = Math.hypot(dx, dy);
      if (current < distance){
        distance = current;
        nearest = el;
      }
    });

    return distance <= radius ? { el: nearest, distance } : null;
  }

  function syncMissAssist(){
    const count = pruneMisses();
    if (!isSmart() || autoSuppressed){
      setSource('misses', {});
      return;
    }

    if (count >= 5){
      setSource('misses', {
        largeTargetLevel: 2,
        thickFocus: true
      }, `після ${count} промахів збільшено цілі до 60 × 60px і посилено фокус.`);
    }else if (count >= 3){
      setSource('misses', {
        largeTargetLevel: 1
      }, `після ${count} промахів збільшено цілі до 52 × 52px.`);
    }else{
      setSource('misses', {});
    }
    scheduleMissPrune();
  }

  function handlePotentialMiss(e, source = 'click'){
    if (!isSmart() || autoSuppressed || e.defaultPrevented) return;
    if (e.target.closest?.(INTERACTIVE_SELECTOR)) return;
    if (!nearestInteractiveWithin(e.clientX, e.clientY)) return;

    const now = performance.now();
    const duplicate =
      source === 'click' &&
      lastMissInput.source === 'pointerup' &&
      now - lastMissInput.time < 420 &&
      Math.hypot(e.clientX - lastMissInput.x, e.clientY - lastMissInput.y) < 6;

    if (duplicate) return;
    lastMissInput = { x: e.clientX, y: e.clientY, time: now, source };
    missTimes.push(performance.now());
    syncMissAssist();
  }

  function syncKeyboardAssist(){
    if (!isSmart() || autoSuppressed){
      setSource('keyboard', {});
      return;
    }

    if (tabCount >= 7){
      setSource('keyboard', {
        thickFocus: true,
        underlineLinks: true,
        largeTargetLevel: 1
      }, 'після 7 натискань Tab підкреслено посилання та збільшено зони взаємодії.');
    }else if (tabCount >= 3){
      setSource('keyboard', {
        thickFocus: true
      }, 'після 3 натискань Tab посилено keyboard-focus.');
    }
  }

  function clearArticleTimer(){
    window.clearTimeout(articleTimer);
    articleTimer = 0;
  }

  function enableReadingAssist(reason){
    if (!isSmart() || autoSuppressed || sources.reading.readingMode) return;

    setSource('reading', {
      readingMode: true,
      textScale: 115,
      lineHeight: 1.85,
      letterSpaceEm: 0.01,
      columnWidth: 'narrow',
      reduceMotion: true
    }, `увімкнено комфортне читання: ${reason}.`);
  }

  function handleArticleScroll(){
    if (!articleScrollEl || !isSmart() || autoSuppressed) return;

    const available = Math.max(1, articleScrollEl.scrollHeight - articleScrollEl.clientHeight);
    if (articleScrollEl.scrollTop / available >= 0.3){
      enableReadingAssist('прочитано понад 30% статті');
    }
  }

  function openArticle(dialog){
    clearArticleTimer();
    articleScrollEl?.removeEventListener('scroll', handleArticleScroll);
    articleEl = dialog || document.getElementById('news-dialog');
    articleScrollEl = articleEl?.querySelector('.news-dialog-body') || null;
    articleScrollEl?.addEventListener('scroll', handleArticleScroll, { passive: true });
    articleTimer = window.setTimeout(() => {
      enableReadingAssist('стаття відкрита понад 12 секунд');
    }, 12000);
  }

  function closeArticle(){
    clearArticleTimer();
    articleScrollEl?.removeEventListener('scroll', handleArticleScroll);
    articleScrollEl = null;
    articleEl = null;
    setSource('reading', {});
  }

  function handleSelection(){
    if (!articleEl || !isSmart() || autoSuppressed) return;

    const selection = document.getSelection?.();
    const text = selection?.toString()?.trim() || '';
    const anchor = selection?.anchorNode;
    if (text.length > 100 && anchor && articleEl.contains(anchor)){
      enableReadingAssist('виділено понад 100 символів');
    }
  }

  function pauseMotionBriefly(){
    document.body.classList.add('motion-paused');
    window.clearTimeout(motionPauseTimer);
    motionPauseTimer = window.setTimeout(() => {
      document.body.classList.remove('motion-paused');
    }, 1300);
  }

  function registerSharpScroll(direction){
    const now = performance.now();

    const duplicate =
      now - lastSharpInput.time < 180 &&
      direction === lastSharpInput.direction;

    if (duplicate || !isSmart() || autoSuppressed) return;

    pauseMotionBriefly();
    lastSharpInput = { direction, time: now };
    sharpScrollTimes = sharpScrollTimes.filter((time) => now - time <= 8000);
    sharpScrollTimes.push(now);

    if (sharpScrollTimes.length >= 3){
      setSource('scroll', {
        reduceMotion: true
      }, 'після трьох різких прокручувань стабільно зменшено рух.');
    }
  }

  function handleSharpScroll(){
    const now = performance.now();
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const distance = Math.abs(y - lastScroll.y);
    const elapsed = Math.max(1, now - lastScroll.time);
    const direction = Math.sign(y - lastScroll.y) || 1;
    lastScroll = { y, time: now };

    if (distance < 180 || distance / elapsed <= 1.45) return;

    registerSharpScroll(direction);
  }

  function handleWheelScroll(e){
    if (e.ctrlKey || e.metaKey){
      updateGestureZoom(e.deltaY);
      return;
    }

    const now = performance.now();
    const direction = Math.sign(e.deltaY);
    if (!direction) return;

    if (
      now - wheelScroll.lastAt > 180 ||
      direction !== wheelScroll.direction
    ){
      wheelScroll = {
        delta: 0,
        direction,
        startedAt: now,
        lastAt: now
      };
    }

    wheelScroll.delta += Math.abs(e.deltaY);
    wheelScroll.lastAt = now;
    const elapsed = Math.max(1, now - wheelScroll.startedAt);

    if (wheelScroll.delta >= 180 && wheelScroll.delta / elapsed > 1.45){
      registerSharpScroll(direction);
      wheelScroll = {
        delta: 0,
        direction,
        startedAt: now,
        lastAt: now
      };
    }
  }

  function ensureInlineError(el, message){
    if (!el || !message) return;

    const id = el.id || (el.id = `field_${Math.random().toString(36).slice(2, 9)}`);
    const errorId = `${id}__error`;
    let error = document.getElementById(errorId);

    if (!error){
      error = document.createElement('div');
      error.id = errorId;
      error.className = 'a11y-field-error';
      error.setAttribute('role', 'alert');
      (el.closest('.field') || el.parentElement || el).appendChild(error);
    }

    error.textContent = message;
    el.setAttribute('aria-invalid', 'true');
    const describedBy = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    describedBy.add(errorId);
    el.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
  }

  function clearAutoState({ suppress = false } = {}){
    clearArticleTimer();
    articleScrollEl?.removeEventListener('scroll', handleArticleScroll);
    articleEl = null;
    articleScrollEl = null;
    missTimes = [];
    window.clearTimeout(missTimer);
    missTimer = 0;
    tabCount = 0;
    sharpScrollTimes = [];
    lastMissInput = { x: 0, y: 0, time: 0, source: '' };
    wheelScroll = { delta: 0, direction: 0, startedAt: 0, lastAt: 0 };
    lastSharpInput = { direction: 0, time: 0 };
    window.clearTimeout(motionPauseTimer);
    motionPauseTimer = 0;
    document.body.classList.remove('motion-paused');
    decisionCache.clear();
    clearSources();
    autoSuppressed = suppress;
    lastZoomLevel = zoomLevelFromFactor(getZoomFactor());
  }

  function handleModeChange(force = false){
    const next = mode();
    if (!force && next === lastMode) return;
    lastMode = next;
    clearAutoState();
    autoSuppressed = false;
    if (!isEnabled()) return;

    applySystemPrefs();
    handleZoomChange();
  }

  Object.values(media).forEach((query) => {
    query?.addEventListener?.('change', () => {
      autoSuppressed = false;
      applySystemPrefs({ announce: true });
    });
  });

  document.addEventListener('pointerup', (e) => {
    if (e.isPrimary === false || (Number.isFinite(e.button) && e.button !== 0)) return;
    handlePotentialMiss(e, 'pointerup');
  }, true);
  document.addEventListener('click', (e) => {
    if (e.detail === 0) return;
    handlePotentialMiss(e, 'click');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || !isSmart() || autoSuppressed) return;
    tabCount += 1;
    syncKeyboardAssist();
  }, true);
  document.addEventListener('selectionchange', handleSelection);
  document.addEventListener('news:dialog-opened', (e) => openArticle(e.detail?.dialog));
  document.addEventListener('news:dialog-closed', closeArticle);
  document.addEventListener('a11y:auto-clear', () => clearAutoState({ suppress: true }));
  document.addEventListener('a11y:reset-all', () => clearAutoState({ suppress: true }));

  window.addEventListener('scroll', handleSharpScroll, { passive: true });
  window.addEventListener('resize', () => startZoomMonitor(), { passive: true });
  window.addEventListener('orientationchange', () => {
    window.setTimeout(resetZoomBaseline, 250);
  }, { passive: true });
  window.visualViewport?.addEventListener('resize', () => startZoomMonitor(), { passive: true });
  window.visualViewport?.addEventListener('scroll', () => {
    syncVisualViewport();
    pollZoom();
  }, { passive: true });

  window.addEventListener('wheel', handleWheelScroll, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;

    if (e.key === '0'){
      gestureZoomFactor = 1;
      startZoomMonitor();
    }else if (e.key === '+' || e.key === '='){
      gestureZoomFactor = Math.min(4, gestureZoomFactor * 1.1);
      startZoomMonitor();
    }else if (e.key === '-'){
      gestureZoomFactor = Math.max(1, gestureZoomFactor / 1.1);
      startZoomMonitor();
    }
  }, { passive: true });

  document.addEventListener('invalid', (e) => {
    if (!isEnabled()) return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    ensureInlineError(el, el.validationMessage || 'Перевірте це поле.');
  }, true);
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (!el.checkValidity()){
      return;
    }
    el.removeAttribute('aria-invalid');
    const error = document.getElementById(`${el.id}__error`);
    if (error) error.remove();
  }, true);

  const observer = new MutationObserver(() => handleModeChange());
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ai-mode'] });

  syncVisualViewport();
  lastZoomFingerprint = getZoomFingerprint();
  window.setInterval(pollZoom, 800);
  handleModeChange(true);

  return {
    notify: showAIToast,
    reset: () => clearAutoState({ suppress: true })
  };
}
