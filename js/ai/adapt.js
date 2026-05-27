function mode(){
  return (document.body?.dataset?.aiMode || 'auto').toLowerCase();
}

function showAIToast(text, timeoutMs = 4500){
  const el = document.getElementById('ai-indicator');
  if (!el) return;

  const textEl = el.querySelector('.ai-text');
  if (textEl) textEl.textContent = text;

  el.hidden = false;
  el.classList.add('show');

  window.clearTimeout(showAIToast._t);
  showAIToast._t = window.setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, timeoutMs);
}

function levelFromMisses(misses){
  if (misses >= 10) return 4;
  if (misses >= 7) return 3;
  if (misses >= 4) return 2;
  if (misses >= 2) return 1;
  return 0;
}

export function initAIAdapt({ a11y } = {}){
  const SUBSCRIBE_FORM_ID = 'subscribe-form';
  const INTERACTIVE_HIT_SEL =
    'button, a[href], input, select, textarea, label, summary, [role="button"], .backdrop';
  const MISS_SCOPE_SEL = [
    '.site-header',
    '.mobile-menu',
    '.hero-card',
    '.hero-actions',
    '.news-focus',
    '.news-tools',
    '.news-list',
    '.subscribe-panel',
    '.a11y-panel',
    '.panel-actions',
    '.panel-body',
    '.news-dialog',
    '.trending',
    '.quick-actions',
    '.card'
  ].join(', ');

  let lastZoomLevel = 0;
  let lastSelToastAt = 0;
  let lastMissLevel = 0;
  let missTimes = [];
  let missDecayTimer = 0;
  let activeReadMs = 0;
  let readingAnchorAt = null;
  let longReadFired = false;
  let readAssistFromSelection = false;
  let readAssistFromLongRead = false;
  let sawTab = false;
  let tabCount = 0;
  let lastActivate = performance.now();
  let lastGoodHitAt = 0;
  let lastMode = null;
  const baseLayoutWidth = Math.max(document.documentElement?.clientWidth || window.innerWidth || 1, 1);
  const baseVisualWidth = Math.max(window.visualViewport?.width || window.innerWidth || baseLayoutWidth, 1);
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const hoverCapable = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
  const missWindowMs = coarsePointer ? 45000 : 30000;
  let lastPointerType = coarsePointer ? 'touch' : 'mouse';

  const INTERACTIVE_SEL =
    'button, a[href], input, select, textarea, label, [role="button"], .backdrop';

  function currentState(){
    return a11y?.getState?.() || {};
  }

  function currentMode(){
    return mode();
  }

  function canAutoAdjustFocus(){
    const st = currentState();
    return !st.userSetFocus && !st.thickFocus;
  }

  function clearMissDecayTimer(){
    if (missDecayTimer){
      window.clearTimeout(missDecayTimer);
      missDecayTimer = 0;
    }
  }

  function pruneMisses(now = performance.now()){
    missTimes = missTimes.filter((x) => (now - x) <= missWindowMs);
    return missTimes.length;
  }

  function missLevelFromCount(count){
    if (coarsePointer){
      if (count >= 8) return 4;
      if (count >= 6) return 3;
      if (count >= 4) return 2;
      if (count >= 2) return 1;
      return 0;
    }
    return levelFromMisses(count);
  }

  function enableReadingMode(){
    document.body.classList.add('a11y-reading-ruler');
  }

  function enableGentleReadingMode(){
    document.body.classList.add('a11y-reading-ruler');
  }

  function disableReadingMode(){
    document.body.classList.remove('a11y-reading-ruler', 'a11y-declutter');
  }

  function resetLongReadTracking(){
    activeReadMs = 0;
    readingAnchorAt = document.visibilityState === 'visible' ? performance.now() : null;
    longReadFired = false;
  }

  function pauseLongReadTracking(){
    if (readingAnchorAt === null) return;
    activeReadMs += performance.now() - readingAnchorAt;
    readingAnchorAt = null;
  }

  function resumeLongReadTracking(){
    if (readingAnchorAt !== null || document.visibilityState !== 'visible') return;
    readingAnchorAt = performance.now();
  }

  function getLongReadElapsed(){
    if (readingAnchorAt === null) return activeReadMs;
    return activeReadMs + (performance.now() - readingAnchorAt);
  }

  function syncReadAssist({ announceText = '' } = {}){
    const active = readAssistFromSelection || readAssistFromLongRead;
    const st = currentState();

    if (!active){
      disableReadingMode();
      if (Number(st.aiLevelRead ?? 0) !== 0){
        a11y?.setAILevels?.({ aiLevelRead: 0 });
      }
      return;
    }

    if (currentMode() === 'auto'){
      enableReadingMode();
      const next = Math.max(Number(st.aiLevelRead ?? 0), 2);
      if (next !== Number(st.aiLevelRead ?? 0)){
        a11y?.setAILevels?.({ aiLevelRead: next });
      }
    }else if (currentMode() === 'gentle'){
      enableGentleReadingMode();
      if (Number(st.aiLevelRead ?? 0) !== 0){
        a11y?.setAILevels?.({ aiLevelRead: 0 });
      }
    }else{
      disableReadingMode();
      if (Number(st.aiLevelRead ?? 0) !== 0){
        a11y?.setAILevels?.({ aiLevelRead: 0 });
      }
      return;
    }

    if (announceText){
      showAIToast(announceText, currentMode() === 'auto' ? 6000 : 5000);
    }
  }

  function scheduleMissDecay(){
    clearMissDecayTimer();
    const missCount = pruneMisses();
    if (!missCount) return;

    const oldest = missTimes[0];
    const now = performance.now();
    const delay = Math.max(250, missWindowMs - (now - oldest) + 20);
    missDecayTimer = window.setTimeout(() => {
      syncMissAssist({ announce: false });
    }, delay);
  }

  function syncMissAssist({ announce = true } = {}){
    const st = currentState();
    const missCount = pruneMisses();
    const targetLevel = missLevelFromCount(missCount);

    if (currentMode() === 'off'){
      if (Number(st.aiLevelMiss ?? 0) !== 0){
        a11y?.setAILevels?.({ aiLevelMiss: 0 });
      }
      document.body.classList.remove('a11y-emphasize-click', 'a11y-hover-glow');
      if (canAutoAdjustFocus()){
        document.body.classList.remove('focus-thick');
      }
      lastMissLevel = 0;
      clearMissDecayTimer();
      return 0;
    }

    if (currentMode() === 'gentle'){
      if (hoverCapable){
        document.body.classList.toggle('a11y-hover-glow', missCount >= 3);
      }
      document.body.classList.toggle('a11y-emphasize-click', missCount >= 3);
      if (canAutoAdjustFocus()){
        document.body.classList.toggle('focus-thick', missCount >= 5);
      }
      if (announce && missCount === 3 && lastMissLevel < 2){
        showAIToast('AI: підсвітив елементи, бо схоже на кілька промахів поспіль.', 5000);
      }
      lastMissLevel = targetLevel;
      scheduleMissDecay();
      return targetLevel;
    }

    if (Number(st.aiLevelMiss ?? 0) !== targetLevel){
      a11y?.setAILevels?.({ aiLevelMiss: targetLevel });
    }

    document.body.classList.toggle('a11y-emphasize-click', targetLevel >= 2);
    if (hoverCapable){
      document.body.classList.toggle('a11y-hover-glow', targetLevel >= 2);
    }
    if (canAutoAdjustFocus()){
      document.body.classList.toggle('focus-thick', missCount >= 6);
    }

    if (announce && targetLevel > lastMissLevel && targetLevel >= 2){
      showAIToast(`AI: зафіксував кілька промахів (${missCount}/${Math.round(missWindowMs / 1000)}с) і м'яко підсилив інтерфейс.`, 5200);
    }

    lastMissLevel = targetLevel;
    scheduleMissDecay();
    return targetLevel;
  }

  function settleMissesAfterSuccess(){
    if (!missTimes.length) return;

    const now = performance.now();
    if (now - lastGoodHitAt < 700) return;
    lastGoodHitAt = now;

    pruneMisses(now);
    if (!missTimes.length){
      syncMissAssist({ announce: false });
      return;
    }

    missTimes.shift();
    syncMissAssist({ announce: false });
  }

  function resolveMissScope(target){
    return target?.closest?.(MISS_SCOPE_SEL)
      || document.querySelector('#main')
      || document.body;
  }

  function getMissRadius(){
    if (lastPointerType === 'touch' || lastPointerType === 'pen') return 30;
    return coarsePointer ? 28 : 22;
  }

  function applySystemPrefs(){
    const st = currentState();

    try{
      const more = window.matchMedia?.('(prefers-contrast: more)').matches;
      const forced = window.matchMedia?.('(forced-colors: active)').matches;
      if (forced && !st.userSetTheme){
        a11y?.setAIState?.({ theme: 'high-contrast' });
        if (!st.userSetLinks) a11y?.setAIState?.({ underlineLinks: true });
        showAIToast('AI: увімкнув високий контраст за системними налаштуваннями.', 5200);
      }else if (more){
        const patch = {};
        if (!st.userSetLinks) patch.underlineLinks = true;
        if (canAutoAdjustFocus()) patch.thickFocus = true;
        if (Object.keys(patch).length){
          a11y?.setAIState?.(patch);
        }
      }
    }catch{}

    try{
      const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
      if (dark && mode() === 'auto' && !st.userSetTheme){
        a11y?.setAIState?.({ theme: 'dark' });
      }
    }catch{}
  }

  function ensureInlineError(el, msg){
    if (!el || !msg) return;

    const id = el.id || (el.id = `fld_${Math.random().toString(36).slice(2, 9)}`);
    const errId = `${id}__err`;
    let err = document.getElementById(errId);

    if (!err){
      err = document.createElement('div');
      err.id = errId;
      err.className = 'a11y-field-error';
      err.setAttribute('role', 'status');
      err.setAttribute('aria-live', 'polite');

      const wrap = el.closest?.('.field, .form-row, .input-row, label') || el.parentElement;
      if (wrap?.tagName === 'LABEL' && wrap.parentElement){
        wrap.insertAdjacentElement('afterend', err);
      }else{
        const host = wrap || el.parentElement || el;
        host.appendChild(err);
      }
    }

    err.textContent = msg;

    const desc = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!desc.includes(errId)){
      desc.push(errId);
      el.setAttribute('aria-describedby', desc.join(' '));
    }

    el.setAttribute('aria-invalid', 'true');
  }

  function messageFromValidity(el){
    const v = el?.validity;
    if (!v) return 'Перевір це поле.';
    if (v.valueMissing) return 'Це поле обов\'язкове.';
    if (v.typeMismatch){
      if (el.type === 'email') return 'Введи коректну електронну пошту.';
      if (el.type === 'url') return 'Введи коректне посилання.';
      return 'Неправильний формат.';
    }
    if (v.tooShort) return `Занадто коротко (мінімум ${el.minLength}).`;
    if (v.tooLong) return `Занадто довго (максимум ${el.maxLength}).`;
    if (v.patternMismatch) return 'Формат не відповідає вимогам.';
    if (v.rangeUnderflow) return `Значення має бути не менше ${el.min}.`;
    if (v.rangeOverflow) return `Значення має бути не більше ${el.max}.`;
    if (v.badInput) return 'Неправильне значення.';
    return el.validationMessage || 'Перевір це поле.';
  }

  function focusFirstInvalid(form){
    const first = form.querySelector(':invalid');
    if (!first) return false;

    try { first.focus({ preventScroll: true }); } catch { try { first.focus(); } catch {} }
    try { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {}

    const msg = messageFromValidity(first);
    ensureInlineError(first, msg);
    if (canAutoAdjustFocus()){
      document.body.classList.add('focus-thick');
    }
    showAIToast(`AI: помилка у формі - ${msg}`, 5200);
    return true;
  }

  function srgbToLin(c){
    c /= 255;
    return c <= 0.04045 ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relLuminance(rgb){
    const [r, g, b] = rgb.map(srgbToLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function parseRgb(str){
    const m = str.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    return parts.length >= 3 ? parts.slice(0, 3) : null;
  }

  function contrastRatio(fgRgb, bgRgb){
    const l1 = relLuminance(fgRgb);
    const l2 = relLuminance(bgRgb);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function resolveOpaqueBackground(el){
    let node = el;
    while (node){
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return parseRgb(bg);
      node = node.parentElement;
    }
    return parseRgb(getComputedStyle(document.body).backgroundColor);
  }

  function checkContrastAndAdapt(){
    if (mode() !== 'auto') return;

    const st = currentState();
    if (st.userSetTheme) return;

    const nodes = Array.from(document.querySelectorAll(
      '.site-header a, .site-header button, #main a, #main button, .nav-pill, .btn-outline, .btn-primary'
    ))
      .filter((el) => el.getClientRects().length)
      .slice(0, 50);

    let worst = Infinity;

    for (const el of nodes){
      const cs = getComputedStyle(el);
      const fg = parseRgb(cs.color);
      const bg = resolveOpaqueBackground(el);
      if (!fg || !bg) continue;

      worst = Math.min(worst, contrastRatio(fg, bg));
    }

    void worst;
  }

  const baseDPR = window.devicePixelRatio || 1;
  const baseVV = window.visualViewport?.scale || 1;

  function getZoomFactor(){
    const dpr = window.devicePixelRatio || 1;
    const vv = window.visualViewport?.scale || 1;
    const layoutWidth = Math.max(document.documentElement?.clientWidth || window.innerWidth || 1, 1);
    const visualWidth = Math.max(window.visualViewport?.width || window.innerWidth || layoutWidth, 1);
    const layoutFactor = baseLayoutWidth / layoutWidth;
    const visualFactor = baseVisualWidth / visualWidth;

    if (coarsePointer){
      if (window.visualViewport){
        return Math.max(1, vv / baseVV);
      }
      return Math.max(1, layoutFactor);
    }

    return Math.max(dpr / baseDPR, vv / baseVV, layoutFactor, visualFactor);
  }

  function levelFromZoomFactor(z){
    if (z >= 1.6) return 4;
    if (z >= 1.35) return 3;
    if (z >= 1.15) return 2;
    if (z >= 1.05) return 1;
    return 0;
  }

  function handleZoomChange(){
    if (mode() !== 'auto') return;

    const z = getZoomFactor();
    const lvl = levelFromZoomFactor(z);
    if (lvl === lastZoomLevel) return;

    const prev = lastZoomLevel;
    lastZoomLevel = lvl;
    a11y?.setAILevels?.({ aiLevelZoom: lvl });

    if (lvl > prev){
      showAIToast(`AI: zoom x${z.toFixed(2)} - адаптував макет і розміри елементів.`, 5200);
    }
  }

  function pushMiss(){
    const t = performance.now();
    missTimes.push(t);
    return pruneMisses(t);
  }

  function nearestInteractiveWithin(x, y, root, maxDist = 28){
    const candidates = Array.from(root.querySelectorAll(INTERACTIVE_SEL))
      .filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length);

    let best = null;
    let bestD = Infinity;

    for (const el of candidates){
      const r = el.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
      const dy = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      const d = Math.hypot(dx, dy);
      if (d < bestD){
        bestD = d;
        best = el;
      }
    }

    return bestD <= maxDist ? { el: best, dist: bestD } : null;
  }

  document.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    lastPointerType = e.pointerType || lastPointerType;
  }, true);

  document.addEventListener('click', (e) => {
    if (currentMode() === 'off') return;
    if (e.defaultPrevented || e.detail === 0) return;

    const hit = e.target.closest(INTERACTIVE_HIT_SEL);
    if (hit){
      settleMissesAfterSuccess();
      return;
    }

    const scope = resolveMissScope(e.target);
    const near = nearestInteractiveWithin(e.clientX, e.clientY, scope, getMissRadius());
    if (!near) return;

    pushMiss();
    syncMissAssist({ announce: true });
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#a11y-reset');
    if (!btn) return;
    readAssistFromSelection = false;
    readAssistFromLongRead = false;
    disableReadingMode();
    resetLongReadTracking();
    syncReadAssist();
  }, true);

  document.addEventListener('submit', (e) => {
    if (mode() !== 'auto') return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === SUBSCRIBE_FORM_ID) return;
    if (!form.checkValidity()){
      e.preventDefault();
      focusFirstInvalid(form);
    }
  }, true);

  document.addEventListener('invalid', (e) => {
    if (mode() !== 'auto') return;
    e.preventDefault();
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (el.form?.id === SUBSCRIBE_FORM_ID) return;
    ensureInlineError(el, messageFromValidity(el));
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return;
    if (el.form?.id === SUBSCRIBE_FORM_ID) return;
    if (!el.checkValidity()) return;

    el.removeAttribute('aria-invalid');
    const errId = (el.getAttribute('aria-describedby') || '').split(/\s+/).find((x) => x.endsWith('__err'));
    if (!errId) return;

    document.getElementById(errId)?.remove();
    const desc = (el.getAttribute('aria-describedby') || '')
      .split(/\s+/)
      .filter(Boolean)
      .filter((x) => x !== errId);

    if (desc.length) el.setAttribute('aria-describedby', desc.join(' '));
    else el.removeAttribute('aria-describedby');
  }, true);

  window.addEventListener('keydown', (e) => {
    if (mode() === 'off') return;
    if (e.key === 'Tab' && !sawTab){
      sawTab = true;
      if (canAutoAdjustFocus()){
        document.body.classList.add('focus-thick');
      }
      showAIToast('AI: підсилив фокус для керування клавіатурою.');
    }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (mode() === 'off') return;

    if (e.key === 'Enter' || e.key === ' ') lastActivate = performance.now();
    if (e.key !== 'Tab') return;

    tabCount++;
    if (mode() === 'auto' && tabCount >= 8 && (performance.now() - lastActivate) > 6000){
      document.body.classList.add('a11y-hover-glow', 'a11y-emphasize-click');
      if (canAutoAdjustFocus()){
        document.body.classList.add('focus-thick');
      }
      showAIToast('AI: підсилив навігацію для клавіатури.', 5000);
      tabCount = 0;
    }
  }, { passive: true });

  window.addEventListener('scroll', () => {
    if (mode() === 'off') return;

    const y = window.scrollY || document.documentElement.scrollTop;
    if (y < 200){
      if (readAssistFromLongRead){
        readAssistFromLongRead = false;
        syncReadAssist();
      }
      resetLongReadTracking();
    }else if (!longReadFired){
      resumeLongReadTracking();
      const elapsed = getLongReadElapsed();
      if (elapsed > 45000){
        longReadFired = true;

        if (mode() === 'auto'){
          readAssistFromLongRead = true;
          syncReadAssist();
          showAIToast('AI: увімкнув режим читабельності для довгого читання.', 6000);
        }else if (mode() === 'gentle'){
          readAssistFromLongRead = true;
          syncReadAssist();
          showAIToast('AI: м\'яко підсилив читабельність для довгого читання.', 5000);
        }
      }
    }
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden'){
      pauseLongReadTracking();
      return;
    }

    if ((window.scrollY || document.documentElement.scrollTop) >= 200){
      resumeLongReadTracking();
    }else{
      readAssistFromLongRead = false;
      syncReadAssist();
      resetLongReadTracking();
    }
  });

  window.addEventListener('pagehide', pauseLongReadTracking, { passive: true });
  window.addEventListener('pageshow', () => {
    if ((window.scrollY || document.documentElement.scrollTop) >= 200){
      resumeLongReadTracking();
    }else{
      readAssistFromLongRead = false;
      syncReadAssist();
      resetLongReadTracking();
    }
  }, { passive: true });

  document.addEventListener('selectionchange', () => {
    if (mode() === 'off') return;

    const sel = document.getSelection?.();
    const txt = sel?.toString()?.trim() || '';
    readAssistFromSelection = txt.length >= 12;

    if (!readAssistFromSelection){
      syncReadAssist();
      return;
    }

    syncReadAssist();

    const t = performance.now();
    if (t - lastSelToastAt > 15000){
      lastSelToastAt = t;
      showAIToast(
        mode() === 'auto'
          ? 'AI: увімкнув читабельність під час роботи з текстом.'
          : 'AI: м\'яко підсилив читабельність під час роботи з текстом.',
        5500
      );
    }
  });

  function clearAutoAssistState(){
    const st = currentState();
    const patch = {};

    if (Number(st.aiLevel ?? 0) !== 0) patch.aiLevel = 0;
    if (Number(st.aiLevelZoom ?? 0) !== 0) patch.aiLevelZoom = 0;
    if (Number(st.aiLevelMiss ?? 0) !== 0) patch.aiLevelMiss = 0;
    if (Number(st.aiLevelRead ?? 0) !== 0) patch.aiLevelRead = 0;
    if (!st.userSetMotion && st.reduceMotion) patch.reduceMotion = false;

    if (!Object.keys(patch).length) return;
    a11y?.setAIState?.(patch);
  }

  function handleModeChange(force = false){
    const nextMode = currentMode();
    if (!force && nextMode === lastMode) return;
    lastMode = nextMode;

    resetAIState();

    if (nextMode !== 'auto'){
      clearAutoAssistState();
      return;
    }

    clearAutoAssistState();
    applySystemPrefs();
    handleZoomChange();
    syncMissAssist({ announce: false });
    readAssistFromSelection = (document.getSelection ? (document.getSelection()?.toString()?.trim() || '') : '').length >= 12;
    syncReadAssist();
  }

  setTimeout(checkContrastAndAdapt, 350);
  window.addEventListener('resize', () => { try { checkContrastAndAdapt(); } catch {} }, { passive: true });
  window.addEventListener('resize', handleZoomChange, { passive: true });
  window.visualViewport?.addEventListener('resize', handleZoomChange);
  window.visualViewport?.addEventListener('scroll', handleZoomChange);

  const modeObserver = new MutationObserver(() => handleModeChange());
  modeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ai-mode'] });
  handleModeChange(true);

  const ticker = document.getElementById('ticker-track');
  const isTickerPausedByUser = () => ticker?.dataset?.userPaused === 'true';
  const pauseTicker = () => {
    if (!ticker) return;
    ticker.dataset.aiPaused = 'true';
    ticker.dispatchEvent(new CustomEvent('ticker:pause'));
  };
  const playTicker = () => {
    if (!ticker || isTickerPausedByUser()) return;
    ticker.dataset.aiPaused = 'false';
    ticker.dispatchEvent(new CustomEvent('ticker:resume'));
  };

  document.addEventListener('visibilitychange', () => {
    if (!ticker) return;
    if (document.visibilityState === 'hidden') pauseTicker();
    else playTicker();
  });

  function resetAIState(){
    const body = document.body;
    if (!body) return;

    lastZoomLevel = 0;
    lastSelToastAt = 0;
    lastMissLevel = 0;
    missTimes = [];
    clearMissDecayTimer();
    readAssistFromSelection = false;
    readAssistFromLongRead = false;
    sawTab = false;
    tabCount = 0;
    lastActivate = performance.now();

    body.classList.remove('a11y-reading-ruler', 'a11y-declutter', 'a11y-emphasize-click', 'a11y-hover-glow');
    if (!currentState().thickFocus){
      body.classList.remove('focus-thick');
    }
    if (Number(currentState().aiLevelMiss ?? 0) !== 0){
      a11y?.setAILevels?.({ aiLevelMiss: 0 });
    }
    if (Number(currentState().aiLevelRead ?? 0) !== 0){
      a11y?.setAILevels?.({ aiLevelRead: 0 });
    }
    resetLongReadTracking();
  }

  document.addEventListener('a11y:reset-all', resetAIState);

  resetLongReadTracking();

  return { notify: showAIToast, reset: resetAIState };
}
