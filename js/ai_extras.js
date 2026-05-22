function storageKey(){
  const p = location.pathname || '/';
  return `np:readpos:${p}`;
}

export function initAIExtras({ notify } = {}){
  initReadPosition({ notify });
  initA11yAuditUI({ notify });
  initTTSAutoPause({ notify });
}

function initReadPosition({ notify } = {}){
  const key = storageKey();

  try{
    const raw = localStorage.getItem(key);
    const y = raw ? Number(raw) : 0;
    const hasHash = !!location.hash;
    const navType = performance.getEntriesByType?.('navigation')?.[0]?.type;
    const isBackForward = navType === 'back_forward';

    if (!hasHash && !isBackForward && Number.isFinite(y) && y > 120){
      setTimeout(() => {
        window.scrollTo(0, y);
        notify?.('AI: повернув до місця читання.', 3500);
      }, 120);
    }
  }catch{}

  let t = 0;
  window.addEventListener('scroll', () => {
    const y = Math.round(window.scrollY || 0);

    if (y < 40){
      try{ localStorage.removeItem(key); }catch{}
      return;
    }

    const now = performance.now();
    if (now - t < 500) return;
    t = now;

    try{
      localStorage.setItem(key, String(y));
    }catch{}
  }, { passive: true });
}

function initA11yAuditUI({ notify } = {}){
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#a11y-audit');
    if (!btn) return;

    const results = runMiniAudit();
    renderAudit(results, { notify });
  }, true);
}

function runMiniAudit(){
  const issues = [];
  const isVisible = (el) => !!(el && el.getClientRects && el.getClientRects().length);
  const isAriaHidden = (el) => !!el.closest?.('[aria-hidden="true"]');
  const addIssue = (type, msg, el) => issues.push({ type, msg, el });

  const srgbToLin = (c) => {
    c /= 255;
    return c <= 0.04045 ? (c / 12.92) : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const relLuminance = (rgb) => {
    const [r, g, b] = rgb.map(srgbToLin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parseRgb = (str) => {
    const m = str.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    return parts.length >= 3 ? parts.slice(0, 3) : null;
  };
  const contrastRatio = (fgRgb, bgRgb) => {
    const l1 = relLuminance(fgRgb);
    const l2 = relLuminance(bgRgb);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };
  const getAccessibleName = (el) => {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby){
      return labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() || '')
        .join(' ')
        .trim();
    }

    return (el.textContent || '').trim();
  };
  const getLinkedLabel = (el) => {
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) return wrappingLabel;

    if (el.id){
      const safeId = window.CSS?.escape ? window.CSS.escape(el.id) : el.id.replace(/"/g, '\\"');
      const explicitLabel = document.querySelector(`label[for="${safeId}"]`);
      if (explicitLabel) return explicitLabel;
    }

    const labelledby = el.getAttribute('aria-labelledby');
    if (!labelledby) return null;
    return labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .find(Boolean) || null;
  };
  const resolveOpaqueBackground = (el) => {
    let node = el;
    while (node){
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return parseRgb(bg);
      node = node.parentElement;
    }
    return parseRgb(getComputedStyle(document.body).backgroundColor);
  };

  document.querySelectorAll('img').forEach((img) => {
    if (!isVisible(img) || isAriaHidden(img)) return;
    if (img.getAttribute('alt') === null){
      addIssue('img-alt', 'Зображення без alt.', img);
    }
  });

  document.querySelectorAll('button, a, [role="button"]').forEach((el) => {
    if (!isVisible(el) || isAriaHidden(el) || el.hasAttribute('disabled')) return;
    if (!getAccessibleName(el)){
      addIssue('name', 'Кнопка або посилання без доступної назви.', el);
    }
  });

  if (!document.querySelector('h1')){
    addIssue('h1', 'На сторінці немає h1.', document.querySelector('#main') || document.body);
  }

  document.querySelectorAll('button, a, .ui-control, [role="button"]').forEach((el) => {
    if (!isVisible(el) || isAriaHidden(el) || el.hasAttribute('disabled')) return;
    const r = el.getBoundingClientRect();
    if (r.width && r.height && (r.width < 36 || r.height < 36)){
      addIssue('target', 'Замалий інтерактивний елемент (<36px).', el);
    }
  });

  document.querySelectorAll('input, select, textarea').forEach((el) => {
    if (!isVisible(el) || isAriaHidden(el)) return;
    if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.type === 'reset') return;
    if (!getLinkedLabel(el) && !el.getAttribute('aria-label')){
      addIssue('label', 'Поле форми без пов\'язаного label або aria-label.', el);
    }
  });

  let previousLevel = 0;
  document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    if (!isVisible(el) || isAriaHidden(el)) return;
    const level = Number(el.tagName.slice(1));
    if (previousLevel && level > previousLevel + 1){
      addIssue('heading-order', `Порушений порядок заголовків: ${el.tagName} після h${previousLevel}.`, el);
    }
    previousLevel = level;
  });

  document.querySelectorAll('[tabindex]').forEach((el) => {
    if (!isVisible(el) || isAriaHidden(el)) return;
    const value = Number(el.getAttribute('tabindex'));
    if (Number.isFinite(value) && value > 0){
      addIssue('tabindex', 'Знайдено tabindex > 0. Це часто ламає природний tab order.', el);
    }
  });

  document.querySelectorAll('p, li, a, button, label, input, select, textarea, h1, h2, h3, h4').forEach((el) => {
    if (!isVisible(el) || isAriaHidden(el)) return;
    const text = (el.textContent || '').trim();
    if (!text && !(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;

    const cs = getComputedStyle(el);
    const fg = parseRgb(cs.color);
    const bg = resolveOpaqueBackground(el);
    if (!fg || !bg) return;

    const ratio = contrastRatio(fg, bg);
    if (ratio < 4.5){
      addIssue('contrast', `Низький контраст тексту (${ratio.toFixed(2)}:1).`, el);
    }
  });

  return issues.slice(0, 30);
}

function renderAudit(issues, { notify } = {}){
  const box = document.getElementById('a11y-audit-results');
  if (!box) return;

  document.querySelectorAll('.a11y-outline-issue').forEach((el) => el.classList.remove('a11y-outline-issue'));

  box.hidden = false;

  if (!issues.length){
    box.innerHTML = '<h3>Результат</h3><div>Критичних проблем не знайдено.</div>';
    notify?.('AI: аудит, проблем не знайдено.', 3500);
    return;
  }

  const itemsHtml = issues.map((it, i) => (
    `<li class="audit-item">
      ${escapeHtml(it.msg)}
      <button type="button" class="btn-outline ui-control" data-audit-jump="${i}" style="margin-left:8px;">
        Показати
      </button>
    </li>`
  )).join('');

  box.innerHTML = `
    <h3>Результат: знайдено ${issues.length}</h3>
    <ul>${itemsHtml}</ul>
    <div class="audit-actions">
      <button type="button" class="btn-outline ui-control" data-audit-clear>Очистити підсвітку</button>
    </div>
  `;

  box.onclick = (e) => {
    const jump = e.target.closest('[data-audit-jump]');
    const clear = e.target.closest('[data-audit-clear]');

    if (clear){
      document.querySelectorAll('.a11y-outline-issue').forEach((el) => el.classList.remove('a11y-outline-issue'));
      return;
    }

    if (jump){
      const idx = Number(jump.getAttribute('data-audit-jump'));
      const issue = issues[idx];
      if (!issue?.el) return;

      document.querySelectorAll('.a11y-outline-issue').forEach((el) => el.classList.remove('a11y-outline-issue'));
      issue.el.classList.add('a11y-outline-issue');

      try{ issue.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }catch{}
      try{
        if (issue.el && typeof issue.el.focus === 'function'){
          if (!issue.el.matches('a[href], button, input, select, textarea, [tabindex]')){
            issue.el.setAttribute('tabindex', '-1');
          }
          issue.el.focus({ preventScroll: true });
        }
      }catch{}
    }
  };

  notify?.(`AI: аудит, знайдено ${issues.length} пунктів.`, 4500);
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initTTSAutoPause({ notify } = {}){
  if (!('speechSynthesis' in window)) return;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (speechSynthesis.speaking || speechSynthesis.pending)){
      speechSynthesis.cancel();
      notify?.('AI: озвучку зупинено, вкладка неактивна.', 3500);
    }
  });
}
