import { NEWS } from './news-data.js';
import { renderNews, setNewsFilter, setNewsQuery, setNewsState, getFilterState, loadSavedFilterState, getNewsById } from './news/render.js';
import { initNav } from './ui/nav.js';
import { initBackToTop } from './ui/back-to-top.js';
import { initA11yPanel } from './a11y/panel.js';
import { initTTS, extractReadableTextFromCard } from './a11y/tts.js';
import { initAIAdapt } from './ai/adapt.js';
import { initAIExtras } from './ai_extras.js';

function ready(fn){
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

function escapeHTML(str){
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

ready(() => {
  const tts = initTTS();
  const a11y = initA11yPanel({ tts });
  const ai = initAIAdapt({ a11y });

  initAIExtras({ notify: ai?.notify });

  const tickerTrack = document.getElementById('ticker-track');
  const tickerSection = document.querySelector('.ticker');
  const search = document.getElementById('news-search');
  const clearFiltersBtn = document.getElementById('clear-filters');
  const form = document.getElementById('subscribe-form');
  const formMessage = document.getElementById('form-message');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const pageBackdrop = document.getElementById('backdrop');
  const newsDialog = document.getElementById('news-dialog');
  const newsDialogClose = document.getElementById('news-dialog-close');
  const newsDialogTitle = document.getElementById('news-dialog-title');
  const newsDialogMeta = document.getElementById('news-dialog-meta');
  const newsDialogExcerpt = document.getElementById('news-dialog-excerpt');
  const newsDialogImage = document.getElementById('news-dialog-image');
  const newsDialogTags = document.getElementById('news-dialog-tags');
  const tickerController = createTickerController(tickerTrack);
  let currentTrend = null;
  let lastDialogTrigger = null;

  function syncSharedOverlayState(){
    const body = document.body;
    if (!body) return;

    const hasPanel = body.dataset.a11yPanelOpen === 'true';
    const hasNewsDialog = body.dataset.newsDialogOpen === 'true';
    const shouldLock = hasPanel || hasNewsDialog;

    body.classList.toggle('dialog-open', shouldLock);
    if (pageBackdrop) pageBackdrop.hidden = !shouldLock;
  }

  syncStickyOffsets();

  if ('ResizeObserver' in window) {
    const header = document.querySelector('.site-header');
    if (header) {
      const resizeObserver = new ResizeObserver(() => syncStickyOffsets());
      resizeObserver.observe(header);
    }
  } else {
    window.addEventListener('resize', syncStickyOffsets, { passive: true });
  }

  function setScenarioActive(activeFocus = ''){
    document.querySelectorAll('[data-focus]').forEach((el) => {
      const isActive = el.getAttribute('data-focus') === activeFocus;
      el.setAttribute('aria-pressed', String(isActive));
      el.classList.toggle('active', isActive);
    });
  }

  function applyFilterUI(filter){
    document.querySelectorAll('[data-filter]').forEach((el) => {
      const active = el.getAttribute('data-filter') === filter;
      el.classList.toggle('active', active);
      el.setAttribute('aria-pressed', String(active));
      el.removeAttribute('aria-current');
    });
  }

  function resetExperienceState(){
    currentTrend = null;
    if (search) search.value = '';
    setScenarioActive('');
    applyFilterUI('all');
    setNewsState({ filter: 'all', query: '' });
    ensureTickerRunning(true);
  }

  function ensureTickerRunning(restart = false){
    tickerController?.resume({ restart });
  }

  function updateClearFiltersVisibility(){
    if (!clearFiltersBtn) return;

    const { filter, query } = getFilterState();
    const hasScenario = !!document.querySelector('[data-focus].active');
    const hasActiveFilter = currentTrend !== null || filter !== 'all' || !!query || hasScenario;
    clearFiltersBtn.hidden = !hasActiveFilter;
  }

  function renderTicker(items){
    const headlines = (Array.isArray(items) ? items : [])
      .slice(0, 10)
      .map((item) => item?.title)
      .filter(Boolean);

    tickerController?.setItems(headlines);
  }

  function clearFormErrors(){
    if (emailError) emailError.textContent = '';
    if (passwordError) passwordError.textContent = '';
    email?.removeAttribute('aria-invalid');
    password?.removeAttribute('aria-invalid');
  }

  function showFieldError(input, errorEl, message){
    if (!input || !errorEl) return;
    input.setAttribute('aria-invalid', 'true');
    errorEl.textContent = message;
    input.focus();
  }

  function getDialogFocusable(){
    if (!newsDialog) return [];
    return Array.from(newsDialog.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0);
  }

  function closeNewsDialog({ restoreFocus = true } = {}){
    if (!newsDialog) return;
    newsDialog.hidden = true;
    document.body.dataset.newsDialogOpen = 'false';
    syncSharedOverlayState();
    document.dispatchEvent(new CustomEvent('news:dialog-closed'));
    if (restoreFocus) lastDialogTrigger?.focus?.();
  }

  function openNewsDialog(item, trigger){
    if (!newsDialog || !item || !newsDialogTitle || !newsDialogMeta || !newsDialogExcerpt || !newsDialogImage || !newsDialogTags) return;

    lastDialogTrigger = trigger || document.activeElement;
    newsDialogTitle.textContent = item.title;
    newsDialogMeta.textContent = `${item.categoryLabel} • ${item.minutes} хв • ${new Intl.DateTimeFormat('uk-UA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(item.dateISO))}`;
    newsDialogExcerpt.textContent = (item.content || [item.excerpt]).join(' ');
    newsDialogImage.src = item.image || '';
    newsDialogImage.alt = item.imageAlt || item.title;
    newsDialogTags.innerHTML = (item.tags || [])
      .map((tag) => `<span class="nav-pill">${escapeHTML(tag)}</span>`)
      .join('');

    newsDialog.hidden = false;
    document.body.dataset.newsDialogOpen = 'true';
    syncSharedOverlayState();
    document.dispatchEvent(new CustomEvent('news:dialog-opened', {
      detail: { dialog: newsDialog, item }
    }));
    newsDialogClose?.focus();
  }

  const savedState = loadSavedFilterState();
  setNewsState(savedState);
  const mount = document.getElementById('cards');
  if (mount) renderNews(mount, NEWS);
  renderTicker(NEWS);

  if (search) search.value = savedState.query;
  applyFilterUI(savedState.filter);

  initNav({
    initialFilter: savedState.filter,
    onFilter: (filter) => {
      currentTrend = null;
      setScenarioActive('');
      setNewsFilter(filter);
      updateClearFiltersVisibility();
    }
  });

  initBackToTop();

  const heroBtn = document.getElementById('hero-tts');
  const heroArticle = document.getElementById('hero-article');

  if (heroBtn && heroArticle){
    heroBtn.addEventListener('click', () => {
      const h1 = heroArticle.querySelector('h1');
      const meta = heroArticle.querySelector('.meta');
      const text = [
        (h1?.innerText || '').trim(),
        (meta?.innerText || '').trim()
      ].filter(Boolean).join('. ');

      if (text) tts.speak(text);
    });
  }

  if (search){
    search.addEventListener('input', () => {
      currentTrend = null;
      setScenarioActive('');
      setNewsQuery(search.value);
      updateClearFiltersVisibility();
    });
  }

  document.addEventListener('click', (e) => {
    const openNewsBtn = e.target.closest('[data-open-news]');
    if (openNewsBtn) {
      const item = getNewsById(openNewsBtn.getAttribute('data-open-news'));
      if (item) openNewsDialog(item, openNewsBtn);
      return;
    }

    const trendBtn = e.target.closest('[data-trend]');
    if (!trendBtn) return;

    const query = trendBtn.getAttribute('data-trend') || '';
    if (currentTrend === query){
      resetExperienceState();
      updateClearFiltersVisibility();
      return;
    }

    currentTrend = query;
    setScenarioActive('');
    if (search) search.value = query;
    setNewsQuery(query);
    updateClearFiltersVisibility();
  });

  clearFiltersBtn?.addEventListener('click', () => {
    resetExperienceState();
    updateClearFiltersVisibility();
  });

  newsDialogClose?.addEventListener('click', () => {
    closeNewsDialog();
  });

  pageBackdrop?.addEventListener('click', () => {
    if (!newsDialog?.hidden) {
      closeNewsDialog();
    }
  });

  document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-filter]');
    if (!filterBtn) return;

    currentTrend = null;
    setScenarioActive('');
    updateClearFiltersVisibility();
  });

  document.addEventListener('click', (e) => {
    const focusBtn = e.target.closest('[data-focus]');
    if (!focusBtn) return;

    const focus = focusBtn.getAttribute('data-focus');
    if (!focus) return;

    const focusMap = {
      security: { filter: 'tech', query: 'фішинг' },
      work: { filter: 'all', query: 'економіка' },
      explain: { filter: 'world', query: 'пояснення' }
    };

    const target = focusMap[focus];
    if (!target) return;

    currentTrend = null;
    setScenarioActive(focus);
    applyFilterUI(target.filter);
    if (search) search.value = target.query;
    setNewsState(target);
    updateClearFiltersVisibility();

    document.getElementById('cards')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    ai?.notify?.('AI: підібрав матеріали за вибраним сценарієм.', 4200);
  });

  document.addEventListener('a11y:reset-all', () => {
    if (newsDialog && !newsDialog.hidden) closeNewsDialog({ restoreFocus: false });
    resetExperienceState();
    syncSharedOverlayState();
    ai?.reset?.();
    ensureTickerRunning(true);
    updateClearFiltersVisibility();
  });

  document.addEventListener('click', (e) => {
    const qaBtn = e.target.closest('[data-qa]');
    if (!qaBtn) return;

    const qa = qaBtn.getAttribute('data-qa');

    if (qa === 'readable'){
      const st = a11y.getState();
      a11y.setState({
        textScale: Math.max(st.textScale ?? 100, 115),
        lineHeight: Math.max(st.lineHeight ?? 1.6, 1.8),
        columnWidth: 'narrow',
        readingMode: true
      });
      return;
    }

    if (qa === 'contrast'){
      a11y.setState({ theme: 'high-contrast' });
      return;
    }

    if (qa === 'tts'){
      const firstCard = document.querySelector('#cards [data-news-item]');
      if (!firstCard) return;

      const text = extractReadableTextFromCard(firstCard);
      if (text) tts.toggle(text);
    }
  });

  if (form && formMessage && email && password) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      clearFormErrors();
      formMessage.textContent = '';
      formMessage.style.color = '';
      formMessage.style.opacity = '1';

      if (!email.value || !email.checkValidity()) {
        showFieldError(email, emailError, 'Будь ласка, введіть коректну електронну пошту.');
        formMessage.textContent = 'Перевірте форму та виправте помилки.';
        formMessage.style.color = '#b00020';
        return;
      }

      if (!password.value || !password.checkValidity()) {
        showFieldError(password, passwordError, 'Пароль має містити мінімум 6 символів.');
        formMessage.textContent = 'Перевірте форму та виправте помилки.';
        formMessage.style.color = '#b00020';
        return;
      }

      formMessage.textContent = 'Дякуємо за підписку!';
      formMessage.style.color = '#2e7d32';
      form.reset();
      clearFormErrors();

      setTimeout(() => {
        formMessage.style.opacity = '0.7';
      }, 100);
    });

    [email, password].forEach((input) => {
      input.addEventListener('input', () => {
        if (input === email && emailError) emailError.textContent = '';
        if (input === password && passwordError) passwordError.textContent = '';
        input.removeAttribute('aria-invalid');
        formMessage.textContent = '';
        formMessage.style.color = '';
        formMessage.style.opacity = '1';
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      search?.focus();
    }

    if (e.key === 'Escape') {
      if (newsDialog && !newsDialog.hidden) {
        closeNewsDialog();
        return;
      }

      const panel = document.getElementById('a11y-panel');
      if (panel && !panel.hidden) a11y.close();
    }

    if (newsDialog && !newsDialog.hidden && e.key === 'Tab') {
      const items = getDialogFocusable();
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      const panel = document.getElementById('a11y-panel');
      if (panel && panel.hidden) a11y.open();
    }

    if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '6') {
      e.preventDefault();
      const filters = ['all', 'politics', 'tech', 'sport', 'world', 'culture'];
      const filterIndex = parseInt(e.key, 10) - 1;

      if (filters[filterIndex]) {
        currentTrend = null;
        setScenarioActive('');
        setNewsFilter(filters[filterIndex]);
        applyFilterUI(filters[filterIndex]);
        updateClearFiltersVisibility();
      }
    }

  });

  updateClearFiltersVisibility();

  const canHoverTicker = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
  if (canHoverTicker){
    tickerSection?.addEventListener('pointerenter', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      tickerController?.pause('user');
    });
    tickerSection?.addEventListener('pointerleave', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      tickerController?.resume();
    });
  }
  tickerTrack?.addEventListener('ticker:pause', () => tickerController?.pause('ai'));
  tickerTrack?.addEventListener('ticker:resume', () => tickerController?.resume());
});

function syncStickyOffsets(){
  const header = document.querySelector('.site-header');
  if (!header) return;

  const height = Math.ceil(header.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--header-offset', `${height}px`);
}

function createTickerController(track){
  if (!track) return null;

  const mediaQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const viewport = track.parentElement;
  let frameId = 0;
  let lastTs = 0;
  let offset = 0;
  let cycleWidth = 0;
  let pausedByUser = false;
  let pausedByAI = false;
  const speedPxPerSec = 42;

  function shouldReduceMotion(){
    const pref = document.body.dataset.motionPref;
    if (pref === 'allow') return false;
    if (pref === 'user' || pref === 'auto' || pref === 'gentle') return true;
    return document.body.classList.contains('reduce-motion') || !!mediaQuery?.matches;
  }

  function shouldPauseMotion(){
    return document.body.classList.contains('motion-paused');
  }

  function stop(){
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    lastTs = 0;
  }

  function applyTransform(){
    track.style.transform = `translate3d(${offset}px, 0, 0)`;
  }

  function recalc(){
    cycleWidth = track.scrollWidth / 2;
    if (!Number.isFinite(cycleWidth) || cycleWidth <= 0){
      offset = 0;
      track.style.transform = 'translate3d(0, 0, 0)';
      return false;
    }

    offset = cycleWidth ? -((-offset) % cycleWidth) : 0;
    applyTransform();
    return true;
  }

  function tick(ts){
    if (shouldPauseMotion() || shouldReduceMotion() || pausedByUser || pausedByAI || document.hidden){
      stop();
      return;
    }

    if (!lastTs) lastTs = ts;
    const delta = Math.min(64, ts - lastTs);
    lastTs = ts;

    offset -= (speedPxPerSec * delta) / 1000;
    if (cycleWidth > 0 && -offset >= cycleWidth){
      offset += cycleWidth;
    }

    applyTransform();
    frameId = requestAnimationFrame(tick);
  }

  function start(){
    if (frameId || !recalc() || shouldPauseMotion() || shouldReduceMotion() || pausedByUser || pausedByAI || document.hidden){
      if (shouldReduceMotion()){
        offset = 0;
        track.style.transform = 'translate3d(0, 0, 0)';
      }
      return;
    }

    frameId = requestAnimationFrame(tick);
  }

  function requestRestart(){
    stop();
    requestAnimationFrame(start);
  }

  function setItems(items){
    const headlines = Array.isArray(items) ? items.filter(Boolean) : [];

    if (!headlines.length){
      stop();
      track.innerHTML = '';
      track.style.transform = 'translate3d(0, 0, 0)';
      cycleWidth = 0;
      return;
    }

    const htmlOnce = headlines.map((title) => `
      <div class="ticker-item" role="listitem">
        <span class="ticker-dot" aria-hidden="true">•</span>
        <span>${escapeHTML(title)}</span>
      </div>
    `).join('');

    track.innerHTML = htmlOnce + htmlOnce;
    offset = 0;
    requestRestart();
  }

  function resume({ restart = false } = {}){
    pausedByUser = false;
    pausedByAI = false;
    track.dataset.userPaused = 'false';
    track.dataset.aiPaused = 'false';

    if (restart){
      offset = 0;
      stop();
    }

    start();
  }

  function pause(source = 'user'){
    if (source === 'ai') {
      pausedByAI = true;
      track.dataset.aiPaused = 'true';
    } else {
      pausedByUser = true;
      track.dataset.userPaused = 'true';
    }

    stop();
  }

  const observer = new MutationObserver(() => {
    if (shouldPauseMotion()){
      stop();
      return;
    }

    if (shouldReduceMotion()){
      stop();
      offset = 0;
      track.style.transform = 'translate3d(0, 0, 0)';
      return;
    }

    start();
  });

  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

  if ('ResizeObserver' in window){
    const resizeObserver = new ResizeObserver(() => requestRestart());
    resizeObserver.observe(track);
    if (viewport) resizeObserver.observe(viewport);
  }

  window.addEventListener('resize', () => {
    requestRestart();
  }, { passive: true });

  window.visualViewport?.addEventListener('resize', requestRestart);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  mediaQuery?.addEventListener?.('change', () => {
    requestRestart();
  });

  document.fonts?.ready?.then?.(() => requestRestart());

  return { pause, resume, setItems };
}
