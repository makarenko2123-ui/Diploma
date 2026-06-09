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
    window.clearTimeout(showAIToast._hideTimer);
    showAIToast._timer = window.setTimeout(() => {
      toast.classList.remove('show');
      showAIToast._hideTimer = window.setTimeout(() => { toast.hidden = true; }, 250);
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
  readingRuler: null,
  largeTargetLevel: 0,
  declutter: null,
  reduceTransparency: null,
  zoomLevel: 0,
  simplifyLayout: false,
  oneColumn: false,
  searchAssist: false,
  lowData: false
};

export function initAIAdapt({ a11y } = {}){
  const CONTRAST_MISS_COUNT = 5;
  const CONTRAST_TAB_COUNT = 3;
  const CONTRAST_SIGNAL_WINDOW_MS = 45000;
  const FEED_READING_TIME_MS = 30000;
  const FEED_READING_EXIT_TIME_MS = 10000;
  const SHARP_SCROLL_DISTANCE = 200;
  const SHARP_SCROLL_SPEED = 1.55;
  const SHARP_SCROLL_REDUCE_COUNT = 6;
  const SHARP_SCROLL_DECLUTTER_COUNT = 8;
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
    coarse: window.matchMedia?.('(pointer: coarse)'),
    dark: window.matchMedia?.('(prefers-color-scheme: dark)')
  };
  const sources = {
    system: {},
    zoom: {},
    misses: {},
    keyboard: {},
    contrast: {},
    reading: {},
    feedReading: {},
    scroll: {},
    forms: {},
    search: {},
    network: {},
    returning: {}
  };

  let missTimes = [];
  let missTimer = 0;
  let lastMissInput = { x: 0, y: 0, time: 0, source: '' };
  let tabCount = 0;
  let tabTimes = [];
  let feedInteractionTimes = [];
  let feedVisibleSince = 0;
  let feedReadingExitSince = 0;
  let feedReadingTimer = 0;
  let sharpScrollTimes = [];
  let lastScroll = { y: window.scrollY || 0, time: performance.now() };
  let wheelScroll = { delta: 0, direction: 0, startedAt: 0, lastAt: 0 };
  let lastSharpInput = { direction: 0, time: 0 };
  let motionPauseTimer = 0;
  let zoomMonitorTimer = 0;
  let zoomMonitorStopTimer = 0;
  let articleEl = null;
  let articleScrollEl = null;
  let articleOpenedAt = 0;
  let articleNavigationCount = 0;
  let currentArticleId = '';
  let readingCurrentEl = null;
  let touchGesture = { active: false, startY: 0, startedAt: 0, inArticle: false };
  let taskFocusTimer = 0;
  let invalidTimes = [];
  let lastInvalidInput = { el: null, time: 0 };
  let emptySearchAttempts = [];
  let lastEmptySearch = { query: '', time: 0 };
  const articlePositions = new Map();
  let lastZoomLevel = 0;
  let lastMode = null;
  let autoSuppressed = !!a11y?.isAutoPaused?.();
  let baseDpr = window.devicePixelRatio || 1;
  let baseVisualScale = window.visualViewport?.scale || 1;
  let lastZoomFingerprint = '';
  let pendingZoomLevel = 0;
  let pendingZoomSince = performance.now();
  const decisionCache = new Map();

  function isSmart(){
    return mode() === 'auto';
  }

  function isEnabled(){
    return mode() !== 'off';
  }

  function isOverlayOpen(){
    return document.body?.classList.contains('dialog-open') || false;
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
      theme: sources.contrast.theme || sources.system.theme || null,
      textScale: maxNumber('textScale'),
      lineHeight: maxNumber('lineHeight'),
      letterSpaceEm: maxNumber('letterSpaceEm'),
      columnWidth: sources.reading.columnWidth || sources.feedReading.columnWidth || sources.returning.columnWidth || sources.zoom.columnWidth || null,
      underlineLinks: anyTrue('underlineLinks') ? true : null,
      thickFocus: anyTrue('thickFocus') ? true : null,
      reduceMotion: anyTrue('reduceMotion') ? true : null,
      readingMode: anyTrue('readingMode') ? true : null,
      readingRuler: anyTrue('readingRuler') ? true : null,
      largeTargetLevel: Math.max(0, ...Object.values(sources).map((source) => Number(source.largeTargetLevel || 0))),
      declutter: anyTrue('declutter') ? true : null,
      reduceTransparency: anyTrue('reduceTransparency') ? true : null,
      zoomLevel: Number(sources.zoom.zoomLevel || 0),
      simplifyLayout: anyTrue('simplifyLayout'),
      oneColumn: anyTrue('oneColumn'),
      searchAssist: anyTrue('searchAssist'),
      lowData: anyTrue('lowData')
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
      visualScale / baseVisualScale
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
        columnWidth: 'narrow',
        simplifyLayout: true,
        oneColumn: true
      };
    }
    if (level === 2){
      return {
        zoomLevel: 2,
        columnWidth: 'narrow',
        simplifyLayout: true,
        oneColumn: true
      };
    }
    if (level === 1){
      return {
        zoomLevel: 1,
        columnWidth: 'narrow'
      };
    }
    return {};
  }

  function handleZoomChange(){
    syncVisualViewport();
    if (!isEnabled() || autoSuppressed) return;

    const factor = getZoomFactor();
    const level = zoomLevelFromFactor(factor);
    const now = performance.now();
    if (level !== pendingZoomLevel){
      pendingZoomLevel = level;
      pendingZoomSince = now;
      return;
    }
    if (now - pendingZoomSince < 180) return;
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
      viewport?.height || window.innerHeight || 1
    ].join('|');
  }

  function pollZoom(){
    const fingerprint = getZoomFingerprint();
    if (fingerprint === lastZoomFingerprint){
      if (pendingZoomLevel !== lastZoomLevel) handleZoomChange();
      return;
    }
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

  function resetZoomBaseline(){
    baseDpr = window.devicePixelRatio || 1;
    baseVisualScale = window.visualViewport?.scale || 1;
    lastZoomFingerprint = '';
    lastZoomLevel = 0;
    pendingZoomLevel = 0;
    pendingZoomSince = performance.now();
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
    const dark = !!media.dark?.matches;
    const patch = {
      theme: forced ? 'high-contrast' : (dark ? 'dark' : null),
      underlineLinks: forced || contrast,
      thickFocus: forced || contrast,
      reduceMotion: motion,
      reduceTransparency: transparency || forced,
      declutter: transparency,
      largeTargetLevel: 0
    };
    const hasAdjustments = Object.values(patch).some((value) => value === true || value === 'high-contrast' || value === 'dark' || value === 1);

    setSource(
      'system',
      patch,
      hasAdjustments ? 'враховано системні налаштування доступності.' : '',
      { toast: announce && hasAdjustments }
    );
  }

  function applyNetworkPrefs({ announce = false } = {}){
    if (!isEnabled() || autoSuppressed){
      setSource('network', {});
      return;
    }

    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const effectiveType = String(connection?.effectiveType || '').toLowerCase();
    const constrained = !!connection?.saveData || ['slow-2g', '2g'].includes(effectiveType);

    setSource(
      'network',
      constrained ? {
        lowData: true,
        reduceMotion: true,
        declutter: true,
        simplifyLayout: true
      } : {},
      constrained ? 'через повільне з’єднання або економію даних прибрано важкі візуальні елементи.' : '',
      { toast: announce && constrained }
    );
  }

  function pruneMisses(now = performance.now()){
    missTimes = missTimes.filter((time) => now - time <= CONTRAST_SIGNAL_WINDOW_MS);
    return missTimes.length;
  }

  function pruneTabs(now = performance.now()){
    tabTimes = tabTimes.filter((time) => now - time <= CONTRAST_SIGNAL_WINDOW_MS);
    return tabTimes.length;
  }

  function syncContrastAssist(){
    if (!isSmart() || autoSuppressed){
      setSource('contrast', {});
      return;
    }

    const needsContrast =
      pruneMisses() >= CONTRAST_MISS_COUNT &&
      pruneTabs() >= CONTRAST_TAB_COUNT;

    setSource(
      'contrast',
      needsContrast ? {
        theme: 'high-contrast',
        underlineLinks: true,
        thickFocus: true
      } : {},
      needsContrast
        ? 'після частих промахів і пошуку елементів клавіатурою увімкнено висококонтрастну тему.'
        : ''
    );
  }

  function scheduleMissPrune(){
    window.clearTimeout(missTimer);
    missTimer = 0;
    if (!missTimes.length) return;

    const delay = Math.max(100, CONTRAST_SIGNAL_WINDOW_MS + 20 - (performance.now() - missTimes[0]));
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

    if (count >= 8){
      setSource('misses', {
        largeTargetLevel: 3,
        thickFocus: true
      }, `після ${count} промахів збільшено цілі до 60 × 60px і максимально виділено елементи керування.`);
    }else if (count >= 5){
      setSource('misses', {
        largeTargetLevel: 2,
        thickFocus: true
      }, `після ${count} промахів збільшено цілі до 54 × 54px і посилено фокус.`);
    }else if (count >= 3){
      setSource('misses', {
        largeTargetLevel: 1
      }, `після ${count} промахів збільшено цілі до 48 × 48px.`);
    }else{
      setSource('misses', {});
    }
    syncContrastAssist();
    scheduleMissPrune();
  }

  function handlePotentialMiss(e, source = 'click'){
    if (!isSmart() || autoSuppressed || isOverlayOpen() || e.defaultPrevented) return;
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
      setSource('contrast', {});
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
    syncContrastAssist();
  }

  function isFeedVisible(){
    const cards = document.getElementById('cards');
    if (!cards || !cards.getClientRects().length) return false;

    const rect = cards.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  }

  function hasRecentFeedEngagement(now = performance.now()){
    feedInteractionTimes = feedInteractionTimes.filter((time) => now - time <= FEED_READING_TIME_MS + 5000);
    return feedInteractionTimes.length >= 2;
  }

  function canCountFeedReading(now = performance.now()){
    return (
      isSmart() &&
      !autoSuppressed &&
      !isOverlayOpen() &&
      document.visibilityState !== 'hidden' &&
      isFeedVisible() &&
      hasRecentFeedEngagement(now)
    );
  }

  function stopFeedReadingTimer(){
    window.clearInterval(feedReadingTimer);
    feedReadingTimer = 0;
    feedVisibleSince = 0;
    feedReadingExitSince = 0;
  }

  function clearFeedReadingAssist(reason){
    if (!sources.feedReading.readingMode) return;

    setSource('feedReading', {}, reason || '');
    feedInteractionTimes = [];
    stopFeedReadingTimer();
  }

  function syncFeedReadingExit(now = performance.now()){
    if (document.visibilityState === 'hidden' || articleEl || isFeedVisible()){
      feedReadingExitSince = 0;
      return;
    }

    if (!feedReadingExitSince){
      feedReadingExitSince = now;
      return;
    }
    if (now - feedReadingExitSince < FEED_READING_EXIT_TIME_MS) return;

    clearFeedReadingAssist(
      'після переходу до іншого розділу повернуто звичайний режим сторінки.'
    );
  }

  function syncFeedReadingAssist(){
    if (sources.feedReading.readingMode){
      syncFeedReadingExit();
      return;
    }

    const now = performance.now();
    if (!canCountFeedReading(now)){
      feedVisibleSince = 0;
      if (!feedInteractionTimes.length) stopFeedReadingTimer();
      return;
    }

    if (!feedVisibleSince){
      feedVisibleSince = now;
      return;
    }
    if (now - feedVisibleSince < FEED_READING_TIME_MS) return;

    setSource('feedReading', {
      readingMode: true,
      readingRuler: true,
      lineHeight: 1.75,
      columnWidth: 'narrow',
      reduceMotion: true,
      oneColumn: true
    }, 'після тривалого активного перегляду стрічки увімкнено комфортний режим читання.');
    feedVisibleSince = 0;
    feedReadingExitSince = 0;
  }

  function noteFeedEngagement(e){
    const hasElementTarget = e?.target instanceof Element;
    const fromCards = hasElementTarget && !!e.target.closest('#cards');
    if (hasElementTarget && !fromCards) return;
    if (!fromCards && !isFeedVisible()) return;
    if (!isSmart() || autoSuppressed || isOverlayOpen()) return;

    const now = performance.now();
    const lastTime = feedInteractionTimes.at(-1) || 0;
    if (now - lastTime >= 250) feedInteractionTimes.push(now);

    if (!feedReadingTimer){
      feedReadingTimer = window.setInterval(syncFeedReadingAssist, 500);
    }
    syncFeedReadingAssist();
  }

  function handleFeedReadingIntentChange(e){
    if (!sources.feedReading.readingMode || autoSuppressed || articleEl) return;

    const target = e?.target instanceof Element ? e.target : null;
    if (!target || target.closest('#cards, .news-dialog, #ai-indicator')) return;

    clearFeedReadingAssist('після переходу до іншої дії повернуто звичайний режим сторінки.');
  }

  function enableReadingAssist(reason){
    if (!isSmart() || autoSuppressed || sources.reading.readingMode) return;

    setSource('reading', {
      readingMode: true,
      readingRuler: true,
      lineHeight: 1.75,
      letterSpaceEm: 0.005,
      columnWidth: 'narrow',
      reduceMotion: true
    }, `увімкнено комфортне читання: ${reason}.`);
    syncReadingCurrent();
  }

  function setReadingCurrent(el){
    if (readingCurrentEl === el) return;
    readingCurrentEl?.classList.remove('a11y-reading-current');
    readingCurrentEl = el || null;
    readingCurrentEl?.classList.add('a11y-reading-current');
  }

  function syncReadingCurrent(){
    if (!articleScrollEl) return;
    const candidates = Array.from(articleScrollEl.querySelectorAll('#news-dialog-content p'));
    if (!candidates.length) return;

    const scrollRect = articleScrollEl.getBoundingClientRect();
    const readingLine = scrollRect.top + (scrollRect.height * 0.38);
    const nearest = candidates.reduce((best, el) => {
      const rect = el.getBoundingClientRect();
      const center = rect.top + (rect.height / 2);
      const distance = Math.abs(center - readingLine);
      return !best || distance < best.distance ? { el, distance } : best;
    }, null);

    setReadingCurrent(nearest?.el);
  }

  function handleArticlePointer(e){
    if (e.pointerType && e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
    setReadingCurrent(e.target.closest?.('#news-dialog-content p, #news-dialog-title'));
  }

  function handleArticleTouchStart(e){
    setReadingCurrent(e.target.closest?.('#news-dialog-content p, #news-dialog-title'));
  }

  function handleArticleScroll(){
    if (!articleScrollEl) return;
    syncReadingCurrent();
    if (!isSmart() || autoSuppressed) return;

    const available = Math.max(1, articleScrollEl.scrollHeight - articleScrollEl.clientHeight);
    const progress = articleScrollEl.scrollTop / available;
    const readingTime = performance.now() - articleOpenedAt;
    if (progress >= 0.25 && readingTime >= 5000){
      enableReadingAssist('тривале читання та прокручування статті');
    }
  }

  function openArticle(dialog, item){
    articleScrollEl?.removeEventListener('scroll', handleArticleScroll);
    articleEl = dialog || document.getElementById('news-dialog');
    articleScrollEl = articleEl?.querySelector('.news-dialog-body') || null;
    articleOpenedAt = performance.now();
    articleNavigationCount = 0;
    currentArticleId = String(item?.id || '');
    articleScrollEl?.addEventListener('scroll', handleArticleScroll, { passive: true });
    articleScrollEl?.addEventListener('pointerup', handleArticlePointer, { passive: true });
    articleScrollEl?.addEventListener('touchstart', handleArticleTouchStart, { passive: true });
    syncReadingCurrent();

    const savedProgress = articlePositions.get(currentArticleId);
    if (Number.isFinite(savedProgress) && savedProgress > 0.05 && savedProgress < 0.95){
      requestAnimationFrame(() => {
        if (!articleScrollEl || currentArticleId !== String(item?.id || '')) return;
        setSource('returning', {
          readingRuler: true,
          columnWidth: 'narrow'
        }, 'повернуто до попереднього місця у повторно відкритій статті.');
        const available = Math.max(0, articleScrollEl.scrollHeight - articleScrollEl.clientHeight);
        articleScrollEl.scrollTop = available * savedProgress;
        syncReadingCurrent();
      });
    }else{
      setSource('returning', {});
    }
  }

  function closeArticle(){
    const available = articleScrollEl
      ? Math.max(0, articleScrollEl.scrollHeight - articleScrollEl.clientHeight)
      : 0;
    const progress = available > 0 ? articleScrollEl.scrollTop / available : 0;

    if (currentArticleId && progress >= 0.05 && progress < 0.95){
      articlePositions.set(currentArticleId, progress);
    }else if (currentArticleId && progress >= 0.95){
      articlePositions.delete(currentArticleId);
    }

    articleScrollEl?.removeEventListener('scroll', handleArticleScroll);
    articleScrollEl?.removeEventListener('pointerup', handleArticlePointer);
    articleScrollEl?.removeEventListener('touchstart', handleArticleTouchStart);
    articleScrollEl = null;
    articleEl = null;
    articleOpenedAt = 0;
    articleNavigationCount = 0;
    currentArticleId = '';
    setReadingCurrent(null);
    setSource('reading', {});
    setSource('returning', {});
  }

  function handleSelection(){
    if (!articleEl || !isSmart() || autoSuppressed) return;

    const selection = document.getSelection?.();
    const text = selection?.toString()?.trim() || '';
    const anchor = selection?.anchorNode;
    if (text.length > 80 && anchor && articleEl.contains(anchor)){
      enableReadingAssist('виділено великий фрагмент тексту');
    }
  }

  function isTypingControl(el){
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    return ['email', 'password', 'search', 'tel', 'text', 'url'].includes(el.type);
  }

  function handleTaskFocusIn(e){
    if (isOverlayOpen()){
      handleTaskFocusOut();
      return;
    }

    if (!isTypingControl(e.target)){
      handleTaskFocusOut();
      return;
    }
    if (!isEnabled()) return;
    window.clearTimeout(taskFocusTimer);
    document.body.classList.add('a11y-task-focus');
  }

  function handleTaskFocusOut(){
    window.clearTimeout(taskFocusTimer);
    taskFocusTimer = window.setTimeout(() => {
      if (!isTypingControl(document.activeElement)){
        document.body.classList.remove('a11y-task-focus');
      }
    }, 80);
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

    if (duplicate || !isSmart() || autoSuppressed || isOverlayOpen()) return;

    pauseMotionBriefly();
    lastSharpInput = { direction, time: now };
    sharpScrollTimes = sharpScrollTimes.filter((time) => now - time <= 8000);
    sharpScrollTimes.push(now);

    if (sharpScrollTimes.length >= SHARP_SCROLL_DECLUTTER_COUNT){
      setSource('scroll', {
        reduceMotion: true,
        declutter: true,
        readingRuler: true
      }, 'після серії різких прокручувань зменшено рух і прибрано зайвий інформаційний шум.');
    }else if (sharpScrollTimes.length >= SHARP_SCROLL_REDUCE_COUNT){
      setSource('scroll', {
        reduceMotion: true
      }, 'після серії різких прокручувань стабільно зменшено рух.');
    }
  }

  function handleSharpScroll(){
    const now = performance.now();
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    const distance = Math.abs(y - lastScroll.y);
    const elapsed = Math.max(1, now - lastScroll.time);
    const direction = Math.sign(y - lastScroll.y) || 1;
    lastScroll = { y, time: now };

    if (media.coarse?.matches) return;
    if (distance < SHARP_SCROLL_DISTANCE || distance / elapsed <= SHARP_SCROLL_SPEED) return;

    registerSharpScroll(direction);
  }

  function handleTouchStart(e){
    const touch = e.touches?.[0];
    if (!touch) return;
    const inArticle = !!e.target.closest?.('.news-dialog-body');

    if (isOverlayOpen() && !inArticle){
      touchGesture = { active: false, startY: 0, startedAt: 0, inArticle: false };
      return;
    }

    touchGesture = {
      active: true,
      startY: touch.clientY,
      startedAt: performance.now(),
      inArticle
    };
    if (touchGesture.inArticle) handleArticleTouchStart(e);
  }

  function handleTouchEnd(e){
    if (!touchGesture.active) return;
    const touch = e.changedTouches?.[0];
    const elapsed = performance.now() - touchGesture.startedAt;
    const distance = touch ? touchGesture.startY - touch.clientY : 0;
    const inArticle = touchGesture.inArticle;
    touchGesture.active = false;

    if (inArticle){
      syncReadingCurrent();
      if (Math.abs(distance) >= 120 && performance.now() - articleOpenedAt >= 5000){
        enableReadingAssist('після тривалого читання виконано вертикальний свайп у статті');
      }
      return;
    }

    if (Math.abs(distance) < SHARP_SCROLL_DISTANCE || elapsed > 750) return;
    registerSharpScroll(Math.sign(distance) || 1);
  }

  function handleWheelScroll(e){
    if (isOverlayOpen()) return;

    if (e.ctrlKey || e.metaKey) return;

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

    if (wheelScroll.delta >= SHARP_SCROLL_DISTANCE && wheelScroll.delta / elapsed > SHARP_SCROLL_SPEED){
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
    const errorId = `${id}__ai_error`;
    let error = document.getElementById(errorId);

    if (!error){
      error = document.createElement('div');
      error.id = errorId;
      error.className = 'a11y-field-error';
      error.setAttribute('role', 'alert');
      error.dataset.aiError = 'true';
      (el.closest('.field') || el.parentElement || el).appendChild(error);
    }

    error.textContent = message;
    if (!el.hasAttribute('aria-invalid')){
      el.setAttribute('aria-invalid', 'true');
      el.dataset.aiInvalid = 'true';
    }
    const describedBy = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    describedBy.add(error.id);
    el.setAttribute('aria-describedby', Array.from(describedBy).join(' '));
  }

  function clearInlineErrors(el){
    const describedIds = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const retainedIds = [];

    describedIds.forEach((id) => {
      const node = document.getElementById(id);
      if (node?.dataset.aiError === 'true') node.remove();
      else retainedIds.push(id);
    });

    if (retainedIds.length) el.setAttribute('aria-describedby', retainedIds.join(' '));
    else el.removeAttribute('aria-describedby');
    if (el.dataset.aiInvalid === 'true'){
      el.removeAttribute('aria-invalid');
      delete el.dataset.aiInvalid;
    }
  }

  function registerInvalidInput(el){
    if (!isSmart() || autoSuppressed) return;

    const now = performance.now();
    if (lastInvalidInput.el === el && now - lastInvalidInput.time < 600) return;

    lastInvalidInput = { el, time: now };
    invalidTimes = invalidTimes.filter((time) => now - time <= 30000);
    invalidTimes.push(now);

    if (invalidTimes.length >= 2){
      setSource('forms', {
        largeTargetLevel: 1,
        thickFocus: true
      }, 'після повторних помилок форми збільшено поля та посилено фокус.');
    }
  }

  function handleSearchCommitted(e){
    if (!isSmart() || autoSuppressed) return;

    const query = String(e.detail?.query || '').trim();
    const resultCount = Number(e.detail?.resultCount);
    const now = performance.now();

    if (!query || resultCount > 0){
      emptySearchAttempts = [];
      lastEmptySearch = { query: '', time: 0 };
      setSource('search', {});
      return;
    }

    if (query === lastEmptySearch.query && now - lastEmptySearch.time < 1000) return;
    lastEmptySearch = { query, time: now };
    emptySearchAttempts = emptySearchAttempts.filter((time) => now - time <= 60000);
    emptySearchAttempts.push(now);

    if (emptySearchAttempts.length >= 2){
      setSource('search', {
        searchAssist: true
      }, 'після повторних безрезультатних пошуків виділено поле та показано коротку підказку.');
    }
  }

  function clearAutoState({ suppress = false } = {}){
    articleScrollEl?.removeEventListener('scroll', handleArticleScroll);
    articleEl = null;
    articleScrollEl = null;
    articleOpenedAt = 0;
    articleNavigationCount = 0;
    currentArticleId = '';
    setReadingCurrent(null);
    touchGesture = { active: false, startY: 0, startedAt: 0, inArticle: false };
    missTimes = [];
    window.clearTimeout(missTimer);
    missTimer = 0;
    tabCount = 0;
    tabTimes = [];
    feedInteractionTimes = [];
    stopFeedReadingTimer();
    sharpScrollTimes = [];
    invalidTimes = [];
    lastInvalidInput = { el: null, time: 0 };
    emptySearchAttempts = [];
    lastEmptySearch = { query: '', time: 0 };
    articlePositions.clear();
    lastMissInput = { x: 0, y: 0, time: 0, source: '' };
    wheelScroll = { delta: 0, direction: 0, startedAt: 0, lastAt: 0 };
    lastSharpInput = { direction: 0, time: 0 };
    window.clearTimeout(motionPauseTimer);
    motionPauseTimer = 0;
    window.clearTimeout(taskFocusTimer);
    taskFocusTimer = 0;
    document.body.classList.remove('a11y-task-focus');
    document.body.classList.remove('motion-paused');
    decisionCache.clear();
    clearSources();
    autoSuppressed = suppress;
    lastZoomLevel = zoomLevelFromFactor(getZoomFactor());
  }

  function restartAutoState(){
    clearAutoState();
    if (!isEnabled()) return;

    applySystemPrefs();
    applyNetworkPrefs();
    handleZoomChange();
  }

  function handleModeChange(force = false, { preserveSuppression = false } = {}){
    const next = mode();
    if (!force && next === lastMode) return;
    const wasSuppressed = autoSuppressed;
    lastMode = next;
    clearAutoState({ suppress: preserveSuppression && wasSuppressed });
    if (!isEnabled() || autoSuppressed) return;

    applySystemPrefs();
    applyNetworkPrefs();
    handleZoomChange();
  }

  Object.values(media).forEach((query) => {
    query?.addEventListener?.('change', () => {
      if (autoSuppressed) return;
      applySystemPrefs({ announce: true });
    });
  });

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  connection?.addEventListener?.('change', () => {
    if (autoSuppressed) return;
    applyNetworkPrefs({ announce: true });
  });
  window.addEventListener('online', () => applyNetworkPrefs({ announce: true }));

  document.addEventListener('pointerup', (e) => {
    if (e.isPrimary === false || (Number.isFinite(e.button) && e.button !== 0)) return;
    handlePotentialMiss(e, 'pointerup');
    handleFeedReadingIntentChange(e);
    noteFeedEngagement(e);
  }, true);
  document.addEventListener('click', (e) => {
    handleFeedReadingIntentChange(e);
    if (e.detail === 0) return;
    handlePotentialMiss(e, 'click');
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && isSmart() && !autoSuppressed && !isOverlayOpen()){
      tabCount += 1;
      tabTimes.push(performance.now());
      syncKeyboardAssist();
    }

    if (articleEl && articleScrollEl && ['ArrowDown', 'PageDown', ' '].includes(e.key)){
      const target = e.target instanceof Element ? e.target : document.activeElement;
      const interactiveTarget = target?.closest?.(
        'button, a[href], input, textarea, select, summary, [contenteditable]:not([contenteditable="false"])'
      );
      if (interactiveTarget || !target || !articleEl.contains(target)) return;

      const before = articleScrollEl.scrollTop;
      window.setTimeout(() => {
        if (!articleScrollEl || Math.abs(articleScrollEl.scrollTop - before) < 1) return;
        articleNavigationCount += 1;
        if (articleNavigationCount >= 3 && performance.now() - articleOpenedAt >= 2500){
          enableReadingAssist('послідовно використано клавіатуру для читання статті');
        }
      }, 0);
    }
  }, true);
  document.querySelectorAll('input, textarea').forEach((control) => {
    control.addEventListener('focus', handleTaskFocusIn);
    control.addEventListener('blur', handleTaskFocusOut);
  });
  document.addEventListener('focus', handleTaskFocusIn, true);
  document.addEventListener('focusin', (e) => {
    handleFeedReadingIntentChange(e);
    noteFeedEngagement(e);
  }, true);
  document.addEventListener('input', handleTaskFocusIn, true);
  document.addEventListener('input', handleFeedReadingIntentChange, true);
  document.addEventListener('selectionchange', handleSelection);
  document.addEventListener('news:dialog-opened', (e) => openArticle(e.detail?.dialog, e.detail?.item));
  document.addEventListener('news:dialog-closed', closeArticle);
  document.addEventListener('news:search-committed', handleSearchCommitted);
  document.addEventListener('a11y:auto-clear', () => clearAutoState({ suppress: true }));
  document.addEventListener('a11y:auto-resume', restartAutoState);
  document.addEventListener('a11y:reset-all', restartAutoState);
  document.addEventListener('change', (e) => {
    if (e.target?.id === 'ai-mode') handleModeChange();
  });

  window.addEventListener('scroll', handleSharpScroll, { passive: true });
  window.addEventListener('scroll', noteFeedEngagement, { passive: true });
  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', () => {
    touchGesture.active = false;
    touchGesture.inArticle = false;
  }, { passive: true });
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
  document.addEventListener('invalid', (e) => {
    if (!isEnabled()) return;
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    ensureInlineError(el, el.validationMessage || 'Перевірте це поле.');
    registerInvalidInput(el);
  }, true);
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (!el.checkValidity()){
      return;
    }
    clearInlineErrors(el);
    if (!document.querySelector('[aria-invalid="true"]')){
      invalidTimes = [];
      setSource('forms', {});
    }
  }, true);

  const observer = new MutationObserver(() => handleModeChange());
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-ai-mode'] });

  syncVisualViewport();
  lastZoomFingerprint = getZoomFingerprint();
  window.setInterval(pollZoom, 800);
  handleModeChange(true, { preserveSuppression: true });

  return {
    notify: showAIToast,
    reset: restartAutoState
  };
}
