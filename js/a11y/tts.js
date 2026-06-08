function getReadableText(el){
  return (el?.innerText || el?.textContent || '').trim();
}

export function extractReadableTextFromCard(cardEl){
  if (!cardEl) return '';

  const title = getReadableText(cardEl.querySelector('h3 a, h3, h2, .card-title, .news-title, [data-title]'));
  const excerpt = getReadableText(cardEl.querySelector('.card-body p.measure, p, .excerpt, .card-excerpt, [data-excerpt]'));
  const timeEl = cardEl.querySelector('time');
  const date = getReadableText(timeEl) || timeEl?.getAttribute('datetime') || '';

  return [title, excerpt, date].filter(Boolean).join('. ');
}

function pickVoice(voices, preferredName){
  if (!voices.length) return null;
  if (preferredName){
    const exact = voices.find((voice) => voice.name === preferredName);
    if (exact) return exact;
  }

  return voices.find((voice) => (voice.lang || '').toLowerCase().startsWith('uk'))
    || voices.find((voice) => (voice.lang || '').toLowerCase().includes('ua'))
    || voices[0];
}

export function initTTS(){
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const synth = supported ? window.speechSynthesis : null;
  const voiceSelect = document.getElementById('tts-voice');
  const panelRate = document.getElementById('tts-rate');
  const playerRate = document.getElementById('tts-player-rate');
  const sampleBtn = document.getElementById('tts-sample');
  const player = document.getElementById('tts-player');
  const status = document.getElementById('tts-status');
  const pauseBtn = document.getElementById('tts-pause');
  const resumeBtn = document.getElementById('tts-resume');
  const stopBtn = document.getElementById('tts-stop');
  const live = document.getElementById('a11y-live');
  const SETTINGS_KEYS = ['a11y.settings.v4', 'a11y.settings.v3'];

  let voices = [];
  let currentText = '';
  let interruptors = [];
  let playbackState = 'idle';
  let activeUtterance = null;

  function readSavedRate(){
    for (const key of SETTINGS_KEYS){
      try{
        const raw = localStorage.getItem(key);
        const rate = Number(raw ? JSON.parse(raw)?.ttsRate : NaN);
        if (Number.isFinite(rate)) return Math.max(0.7, Math.min(1.4, rate));
      }catch{}
    }
    return 1;
  }

  function announce(text){
    if (!live || !text) return;
    live.textContent = '';
    window.setTimeout(() => { live.textContent = text; }, 20);
  }

  function setRate(rate, { emit = false, restartActive = true } = {}){
    const next = Math.max(0.7, Math.min(1.4, Number(rate) || 1));
    if (panelRate) panelRate.value = String(next);
    if (playerRate) playerRate.value = String(next);

    const valueText = `Швидкість ${Math.round(next * 100)} відсотків`;
    panelRate?.setAttribute('aria-valuetext', valueText);
    playerRate?.setAttribute('aria-valuetext', valueText);

    if (emit){
      document.dispatchEvent(new CustomEvent('tts:rate-change', { detail: { rate: next } }));
    }
    if (restartActive && currentText && playbackState !== 'idle'){
      const text = currentText;
      speak(text, { announceStart: false });
      announce('Швидкість змінено. Озвучення перезапущено.');
    }
  }

  function updatePlayer(nextState, message){
    playbackState = nextState;
    document.body?.classList.toggle('tts-active', nextState !== 'idle');
    if (player) player.hidden = nextState === 'idle';
    if (status) status.textContent = message || (nextState === 'paused' ? 'Призупинено' : 'Відтворюється');
    if (pauseBtn) pauseBtn.disabled = nextState !== 'speaking';
    if (resumeBtn) resumeBtn.disabled = nextState !== 'paused';
    if (stopBtn) stopBtn.disabled = nextState === 'idle';
  }

  function syncReadButtons(){
    document.querySelectorAll('[data-tts-read]').forEach((button) => {
      const selector = button.getAttribute('data-tts-source');
      const card = selector ? document.querySelector(selector) : null;
      const text = card ? extractReadableTextFromCard(card) : '';
      button.setAttribute('aria-pressed', String(!!text && text === currentText && playbackState !== 'idle'));
    });
  }

  function loadVoices(){
    if (!supported) return;
    voices = synth.getVoices() || [];
    if (!voiceSelect) return;

    const previous = voiceSelect.value;
    voiceSelect.textContent = '';
    voices.forEach((voice) => {
      const option = document.createElement('option');
      option.value = voice.name || '';
      option.textContent = `${voice.name || 'Voice'} (${voice.lang || 'und'})`;
      voiceSelect.appendChild(option);
    });

    const preferred = previous || pickVoice(voices)?.name;
    if (preferred) voiceSelect.value = preferred;
  }

  function clearInterruptors(){
    interruptors.forEach(({ target, type, handler, options }) => {
      target.removeEventListener(type, handler, options);
    });
    interruptors = [];
  }

  function stop({ announceStop = false } = {}){
    if (!supported) return false;
    clearInterruptors();
    activeUtterance = null;
    synth.cancel();
    currentText = '';
    updatePlayer('idle', 'Зупинено');
    syncReadButtons();
    if (announceStop) announce('Озвучення зупинено.');
    return true;
  }

  function pause(){
    if (!supported || playbackState !== 'speaking') return false;
    synth.pause();
    updatePlayer('paused', 'Призупинено');
    announce('Озвучення призупинено.');
    return true;
  }

  function resume(){
    if (!supported || playbackState !== 'paused') return false;
    synth.resume();
    updatePlayer('speaking', 'Відтворюється');
    announce('Озвучення продовжено.');
    return true;
  }

  function bindInterruptors(){
    clearInterruptors();
    const onVisibilityChange = () => {
      if (document.hidden && playbackState !== 'idle') stop({ announceStop: true });
    };

    interruptors = [
      { target: document, type: 'visibilitychange', handler: onVisibilityChange }
    ].filter(({ target }) => target);

    interruptors.forEach(({ target, type, handler, options }) => {
      target.addEventListener(type, handler, options);
    });
  }

  function speak(text, { announceStart = true } = {}){
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!supported || !normalized) return false;

    if (!voices.length) loadVoices();
    stop();
    currentText = normalized;

    const utterance = new SpeechSynthesisUtterance(normalized);
    const voice = pickVoice(voices, voiceSelect?.value);
    if (voice) utterance.voice = voice;
    utterance.lang = 'uk-UA';
    utterance.rate = Number(panelRate?.value || playerRate?.value || 1);
    activeUtterance = utterance;
    utterance.onstart = () => {
      if (activeUtterance !== utterance) return;
      updatePlayer('speaking', 'Відтворюється');
      syncReadButtons();
    };
    utterance.onend = () => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      clearInterruptors();
      currentText = '';
      updatePlayer('idle', 'Завершено');
      syncReadButtons();
    };
    utterance.onerror = () => {
      if (activeUtterance !== utterance) return;
      activeUtterance = null;
      clearInterruptors();
      currentText = '';
      updatePlayer('idle', 'Не вдалося відтворити');
      syncReadButtons();
    };

    bindInterruptors();
    updatePlayer('speaking', 'Запуск...');
    synth.speak(utterance);
    if (announceStart) announce('Озвучення розпочато.');
    return true;
  }

  function toggle(text){
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!supported || !normalized) return false;

    if (normalized === currentText && playbackState !== 'idle'){
      return stop({ announceStop: true });
    }
    return speak(normalized);
  }

  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-tts-read]');
    if (!button) return;

    const selector = button.getAttribute('data-tts-source');
    const source = selector ? document.querySelector(selector) : null;
    const card = source?.closest?.('[data-news-item], .card') || button.closest('[data-news-item], .card');
    const text = card ? extractReadableTextFromCard(card) : getReadableText(source);
    if (text) toggle(text);
  });

  sampleBtn?.addEventListener('click', () => {
    speak('Привіт! Це приклад озвучення. Швидкість і голос можна змінити в налаштуваннях доступності.');
  });
  pauseBtn?.addEventListener('click', pause);
  resumeBtn?.addEventListener('click', resume);
  stopBtn?.addEventListener('click', () => stop({ announceStop: true }));
  panelRate?.addEventListener('input', () => setRate(panelRate.value));
  playerRate?.addEventListener('input', () => setRate(playerRate.value, { emit: true }));
  voiceSelect?.addEventListener('change', () => {
    if (!currentText || playbackState === 'idle') return;
    const text = currentText;
    speak(text, { announceStart: false });
    announce('Голос змінено. Озвучення перезапущено.');
  });

  if (supported){
    setRate(readSavedRate(), { restartActive: false });
    loadVoices();
    synth.addEventListener?.('voiceschanged', loadVoices);
  }else{
    if (voiceSelect){
      const option = document.createElement('option');
      option.textContent = 'Недоступно у цьому браузері';
      voiceSelect.replaceChildren(option);
    }
    [voiceSelect, panelRate, playerRate, sampleBtn, pauseBtn, resumeBtn, stopBtn].forEach((control) => {
      if (control) control.disabled = true;
    });
  }

  updatePlayer('idle', supported ? 'Зупинено' : 'Недоступно');

  return {
    supported,
    speak,
    stop,
    pause,
    resume,
    toggle,
    isSpeaking: () => playbackState !== 'idle',
    extractReadableTextFromCard
  };
}
