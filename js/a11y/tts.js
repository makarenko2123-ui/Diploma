function getTextFromSelector(selector){
  const el = document.querySelector(selector);
  if (!el) return '';
  return (el.innerText || el.textContent || '').trim();
}

function getReadableText(el){
  return (el?.innerText || el?.textContent || '').trim();
}

export function extractReadableTextFromCard(cardEl){
  if (!cardEl) return '';

  const title =
    getReadableText(cardEl.querySelector('h3 a, h3, h2, .card-title, .news-title, [data-title]'));

  const excerpt =
    getReadableText(cardEl.querySelector('.card-body p.measure, p, .excerpt, .card-excerpt, [data-excerpt]'));

  const timeEl = cardEl.querySelector('time');
  const date =
    (getReadableText(timeEl) || timeEl?.getAttribute('datetime') || '').trim();

  return [title, excerpt, date].filter(Boolean).join('. ');
}

function pickVoice(voices, preferredName){
  if (!voices.length) return null;
  if (preferredName){
    const exact = voices.find((v) => v.name === preferredName);
    if (exact) return exact;
  }
  return voices.find((v) => (v.lang || '').toLowerCase().startsWith('uk'))
      || voices.find((v) => (v.lang || '').toLowerCase().includes('ua'))
      || voices[0];
}

export function initTTS(){
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  const voiceSelect = document.getElementById('tts-voice');
  const rateRange = document.getElementById('tts-rate');
  const sampleBtn = document.getElementById('tts-sample');
  const SETTINGS_KEY = 'a11y.settings.v3';

  function readSavedRate(){
    try{
      const raw = localStorage.getItem(SETTINGS_KEY);
      const s = raw ? JSON.parse(raw) : null;
      const n = Number(s?.ttsRate);
      return Number.isFinite(n) ? n : 1;
    }catch{
      return 1;
    }
  }

  let voices = [];
  let currentText = '';
  let activeInterruptors = [];
  const isSpeakingNow = () =>
    supported && (window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused);

  if (rateRange) rateRange.value = String(readSavedRate());

  function loadVoices(){
    if (!supported) return;
    voices = window.speechSynthesis.getVoices() || [];
    if (!voiceSelect) return;

    const prev = voiceSelect.value || '';

    voiceSelect.textContent = '';
    for (const v of voices){
      const opt = document.createElement('option');
      opt.value = v.name || '';
      opt.textContent = `${v.name || 'Voice'} (${v.lang || 'und'})`;
      voiceSelect.appendChild(opt);
    }

    const preferred = prev || pickVoice(voices)?.name || '';
    if (preferred) voiceSelect.value = preferred;
  }

  function ensureVoicesLoaded(){
    if (!supported) return;
    if (!voices.length) loadVoices();
  }

  function clearSpeechSideEffects(){
    for (const { target, type, handler } of activeInterruptors){
      target.removeEventListener(type, handler);
    }
    activeInterruptors = [];
  }

  function stop(){
    if (!supported) return false;
    clearSpeechSideEffects();
    currentText = '';
    window.speechSynthesis.cancel();
    return true;
  }

  function bindInterruptors(){
    clearSpeechSideEffects();

    const interrupt = () => {
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused){
        stop();
      }
    };

    const keyboardScrollKeys = new Set([
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
      'Spacebar'
    ]);

    const handleKeydown = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (keyboardScrollKeys.has(e.key)) interrupt();
    };

    activeInterruptors = [
      { target: window, type: 'scroll', handler: interrupt, options: { passive: true } },
      { target: window, type: 'wheel', handler: interrupt, options: { passive: true } },
      { target: window, type: 'touchmove', handler: interrupt, options: { passive: true } },
      { target: window, type: 'keydown', handler: handleKeydown }
    ];

    for (const { target, type, handler, options } of activeInterruptors){
      target.addEventListener(type, handler, options);
    }
  }

  function speak(text){
    const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!supported || !normalizedText) return false;

    ensureVoicesLoaded();
    stop();
    currentText = normalizedText;

    const u = new SpeechSynthesisUtterance(normalizedText);

    const rate = rateRange ? Number(rateRange.value) : 1;
    u.rate = Number.isFinite(rate) ? rate : 1;

    const selected = voiceSelect ? voiceSelect.value : '';
    const v = pickVoice(voices, selected);
    if (v) u.voice = v;
    u.lang = v?.lang || 'uk-UA';
    bindInterruptors();

    u.onend = () => {
      clearSpeechSideEffects();
      currentText = '';
    };
    u.onerror = () => {
      clearSpeechSideEffects();
      currentText = '';
    };

    window.setTimeout(() => {
      window.speechSynthesis.speak(u);
    }, 0);

    return true;
  }

  function toggle(text){
    const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!supported || !normalizedText) return false;

    if (isSpeakingNow() && normalizedText === currentText) {
      stop();
      return true;
    }

    return speak(normalizedText);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tts-read]');
    if (!btn) return;

    const src = btn.getAttribute('data-tts-source');
    const srcEl = src ? document.querySelector(src) : null;
    const card = srcEl?.closest?.('[data-news-item], .card') || btn.closest('[data-news-item], .card');

    const text = card
      ? extractReadableTextFromCard(card)
      : (srcEl ? getReadableText(srcEl) : '');

    if (!text) return;
    toggle(text);
  });

  sampleBtn?.addEventListener('click', () => {
    speak('Привіт! Це приклад озвучення. Швидкість і голос можна змінити в налаштуваннях.');
  });

  if (supported){
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }else{
    if (voiceSelect) voiceSelect.innerHTML = '<option>Недоступно у цьому браузері</option>';
    if (sampleBtn) sampleBtn.disabled = true;
  }

  return {
    supported,
    speak,
    stop,
    toggle,
    isSpeaking: isSpeakingNow,
    getTextFromSelector,
    extractReadableTextFromCard
  };
}
