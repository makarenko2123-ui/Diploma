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
  if (misses >= 8) return 4;
  if (misses >= 5) return 3;
  if (misses >= 2) return 2;
  return 0;
}

export function initAIAdapt({ a11y } = {}){
  if (mode() === 'off') return { notify: showAIToast };

  const SUBSCRIBE_FORM_ID = 'subscribe-form';

  let lastClickAt = 0;
  let lastContrastToastAt = 0;
  let lastZoomLevel = 0;
  let lastSelToastAt = 0;
  let lastMotionToastAt = 0;
  let lastFastAt = 0;
  let fastScrollHits = 0;
  let motionReduced = false;
  let missTimes = [];
  let activeReadMs = 0;
  let readingAnchorAt = null;
  let longReadFired = false;
  let sawTab = false;
  let tabCount = 0;
  let lastActivate = performance.now();
  let lastY = window.scrollY || 0;
  let lastT = performance.now();

  const INTERACTIVE_SEL =
    'button, a, input, select, textarea, [role="button"], .nav-pill, .ui-control';

  function currentState(){
    return a11y?.getState?.() || {};
  }

  function enableReadingMode(){
    document.body.classList.add('a11y-reading-ruler', 'a11y-declutter');
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

  function setReducedMotion(enabled, source = 'auto'){
    if (source === 'auto' && a11y?.setAIState){
      a11y.setAIState({ reduceMotion: enabled });
      return;
    }
    document.body.classList.toggle('reduce-motion', enabled);
  }

  function applySystemPrefs(){
    const st = currentState();

    try{
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduce && !st.userSetMotion){
        a11y?.setAIState?.({ reduceMotion: true });
        showAIToast('AI: врахував системне налаштування зменшення руху.', 4500);
      }
    }catch{}

    try{
      const more = window.matchMedia?.('(prefers-contrast: more)').matches;
      const forced = window.matchMedia?.('(forced-colors: active)').matches;
      if ((more || forced) && !st.userSetTheme){
        a11y?.setAIState?.({ theme: 'high-contrast' });
        if (!st.userSetLinks) a11y?.setAIState?.({ underlineLinks: true });
        showAIToast('AI: увімкнув високий контраст за системними налаштуваннями.', 5200);
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
    document.body.classList.add('focus-thick');
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

    if (worst < 4.5){
      if (!st.userSetLinks) a11y?.setAIState?.({ underlineLinks: true });
      a11y?.setAIState?.({ theme: 'high-contrast' });

      const t = performance.now();
      if (t - lastContrastToastAt > 60000){
        lastContrastToastAt = t;
        showAIToast('AI: підсилив контраст і видимість посилань.', 6000);
      }
    }
  }

  const baseDPR = window.devicePixelRatio || 1;
  const baseVV = window.visualViewport?.scale || 1;

  function getZoomFactor(){
    const dpr = window.devicePixelRatio || 1;
    const vv = window.visualViewport?.scale || 1;
    return Math.max(dpr / baseDPR, vv / baseVV);
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
    missTimes = missTimes.filter((x) => (t - x) <= 30000);
    return missTimes.length;
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

  document.addEventListener('click', (e) => {
    if (mode() === 'off') return;

    const btn = e.target.closest('button, [role="button"], .ui-control');
    if (btn){
      const t = performance.now();
      if (t - lastClickAt < 280){
        e.preventDefault();
        return;
      }
      lastClickAt = t;
      return;
    }

    const header = e.target.closest('.site-header');
    if (!header) return;

    const near = nearestInteractiveWithin(e.clientX, e.clientY, header, 30);
    if (!near) return;

    const missCount = pushMiss();
    const targetLevel = levelFromMisses(missCount);

    if (mode() === 'gentle'){
      document.body.classList.add('a11y-hover-glow');
      document.body.classList.toggle('a11y-emphasize-click', missCount >= 2);
      document.body.classList.toggle('focus-thick', missCount >= 3);
      if (missCount === 2) showAIToast('AI: підсвітив елементи - схоже на промахи.', 5000);
      return;
    }

    const st = currentState();
    a11y?.setAILevels?.({ aiLevelMiss: targetLevel });
    document.body.classList.toggle('a11y-emphasize-click', targetLevel >= 2);
    document.body.classList.toggle('underline-links', targetLevel >= 2);
    document.body.classList.toggle('focus-thick', missCount >= 4);
    if (!st.userSetMotion){
      document.body.classList.toggle('reduce-motion', missCount >= 4);
    }

    if (targetLevel >= 2){
      document.body.classList.add('a11y-hover-glow');
      showAIToast(`AI: промахи (${missCount}/30с) - рівень ${targetLevel}.`, 5200);
    }
  }, true);

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#a11y-reset');
    if (!btn) return;
    disableReadingMode();
    motionReduced = false;
    fastScrollHits = 0;
    resetLongReadTracking();
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
      document.body.classList.add('focus-thick');
      showAIToast('AI: підсилив фокус для керування клавіатурою.');
    }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (mode() === 'off') return;

    if (e.key === 'Enter' || e.key === ' ') lastActivate = performance.now();
    if (e.key !== 'Tab') return;

    tabCount++;
    if (mode() === 'auto' && tabCount >= 8 && (performance.now() - lastActivate) > 6000){
      document.body.classList.add('a11y-hover-glow', 'a11y-emphasize-click', 'focus-thick');
      showAIToast('AI: підсилив навігацію для клавіатури.', 5000);
      tabCount = 0;
    }
  }, { passive: true });

  if (mode() === 'auto' || mode() === 'gentle'){
    document.body.classList.add('a11y-hover-glow');
  }

  try{
    if (mode() === 'auto' && window.matchMedia?.('(pointer: coarse)').matches){
      const st = currentState();
      const next = Math.max(Number(st.aiLevelMiss ?? 0), 1);
      a11y?.setAILevels?.({ aiLevelMiss: next });
    }
  }catch{}

  window.addEventListener('scroll', () => {
    if (mode() === 'off') return;

    const y = window.scrollY || document.documentElement.scrollTop;
    if (y < 200){
      resetLongReadTracking();
    }else if (!longReadFired){
      resumeLongReadTracking();
      const elapsed = getLongReadElapsed();
      if (elapsed > 45000){
        longReadFired = true;

        if (mode() === 'auto'){
          enableReadingMode();
          const st = currentState();
          const next = Math.max(Number(st.aiLevelRead ?? 0), 2);
          a11y?.setAILevels?.({ aiLevelRead: next });
          showAIToast('AI: увімкнув режим читабельності для довгого читання.', 6000);
        }else if (mode() === 'gentle'){
          enableGentleReadingMode();
          document.body.classList.add('measure-all');
          showAIToast('AI: м\'яко підсилив читабельність для довгого читання.', 5000);
        }
      }
    }

    const t = performance.now();
    const dy = Math.abs(y - lastY);
    const dt = Math.max(16, t - lastT);
    const speed = dy / dt;
    const st = currentState();

    if (!st.userSetMotion){
      const isFast = speed > 2.8 && dy > 180;
      if (isFast){
        if (t - lastFastAt < 1200) fastScrollHits++;
        else fastScrollHits = 1;
        lastFastAt = t;
      }else if (t - lastFastAt > 1600){
        fastScrollHits = 0;
      }

      if (!motionReduced && fastScrollHits >= 3){
        motionReduced = true;

        if (mode() === 'auto') setReducedMotion(true, 'auto');
        else if (mode() === 'gentle') setReducedMotion(true, 'gentle');

        if (t - lastMotionToastAt > 30000){
          lastMotionToastAt = t;
          showAIToast(
            mode() === 'auto'
              ? 'AI: зменшив анімації через різкий скрол.'
              : 'AI: м\'яко зменшив анімації через різкий скрол.',
            4500
          );
        }
      }
    }

    lastY = y;
    lastT = t;
  }, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden'){
      pauseLongReadTracking();
      return;
    }

    if ((window.scrollY || document.documentElement.scrollTop) >= 200){
      resumeLongReadTracking();
    }else{
      resetLongReadTracking();
    }
  });

  window.addEventListener('pagehide', pauseLongReadTracking, { passive: true });
  window.addEventListener('pageshow', () => {
    if ((window.scrollY || document.documentElement.scrollTop) >= 200){
      resumeLongReadTracking();
    }else{
      resetLongReadTracking();
    }
  }, { passive: true });

  document.addEventListener('selectionchange', () => {
    if (mode() === 'off') return;

    const sel = document.getSelection?.();
    const txt = sel?.toString()?.trim() || '';
    if (txt.length < 12) return;

    if (mode() === 'auto'){
      enableReadingMode();
      const st = currentState();
      const next = Math.max(Number(st.aiLevelRead ?? 0), 2);
      a11y?.setAILevels?.({ aiLevelRead: next });
    }else if (mode() === 'gentle'){
      enableGentleReadingMode();
    }

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

  setTimeout(checkContrastAndAdapt, 350);
  window.addEventListener('resize', () => { try { checkContrastAndAdapt(); } catch {} }, { passive: true });
  window.addEventListener('resize', handleZoomChange, { passive: true });
  window.visualViewport?.addEventListener('resize', handleZoomChange);
  window.visualViewport?.addEventListener('scroll', handleZoomChange);
  handleZoomChange();
  applySystemPrefs();

  const ticker = document.getElementById('ticker-track');
  const tickerWrap = document.querySelector('.ticker');
  const isTickerPausedByUser = () => ticker?.dataset?.userPaused === 'true';
  const pauseTicker = () => { if (ticker) ticker.style.animationPlayState = 'paused'; };
  const playTicker = () => {
    if (!ticker || isTickerPausedByUser()) return;
    ticker.style.animationPlayState = 'running';
  };

  if (ticker && tickerWrap){
    tickerWrap.addEventListener('mouseenter', pauseTicker);
    tickerWrap.addEventListener('mouseleave', playTicker);
  }

  document.addEventListener('visibilitychange', () => {
    if (!ticker) return;
    if (document.visibilityState === 'hidden') pauseTicker();
    else playTicker();
  });

  resetLongReadTracking();

  return { notify: showAIToast };
}
