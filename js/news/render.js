let _all = [];
let _mount = null;
let _filter = 'all';
let _query = '';

const VALID_FILTERS = new Set(['all', 'politics', 'tech', 'sport', 'world', 'culture']);

const CATEGORY_FALLBACK = {
  tech: { bg: '#0f172a', accent: '#38bdf8', label: 'Технології', glyph: '◈' },
  politics: { bg: '#1f2937', accent: '#f59e0b', label: 'Політика', glyph: '▣' },
  sport: { bg: '#052e16', accent: '#22c55e', label: 'Спорт', glyph: '◉' },
  world: { bg: '#172554', accent: '#60a5fa', label: 'Світ', glyph: '◎' },
  culture: { bg: '#3b0764', accent: '#f472b6', label: 'Культура', glyph: '✦' }
};

function escapeHTML(str){
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(iso){
  try{
    return new Intl.DateTimeFormat('uk-UA', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      timeZone: 'UTC'
    })
      .format(new Date(iso));
  }catch{
    return iso;
  }
}

function escapeSvgText(str){
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function buildFallbackImage(item){
  const theme = CATEGORY_FALLBACK[item.category] || CATEGORY_FALLBACK.world;
  const title = escapeSvgText(item.title || theme.label);
  const excerpt = escapeSvgText(item.excerpt || '');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" role="img" aria-label="${title}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${theme.bg}" />
          <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0.85" />
        </linearGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#bg)" />
      <circle cx="1030" cy="150" r="130" fill="${theme.accent}" fill-opacity="0.14" />
      <circle cx="180" cy="540" r="150" fill="#ffffff" fill-opacity="0.08" />
      <text x="90" y="160" fill="#ffffff" fill-opacity="0.92" font-size="42" font-family="Arial, sans-serif">${theme.label}</text>
      <text x="90" y="250" fill="#ffffff" fill-opacity="0.95" font-size="96" font-family="Arial, sans-serif">${theme.glyph}</text>
      <foreignObject x="90" y="300" width="1020" height="250">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;color:#ffffff;">
          <div style="font-size:48px;font-weight:700;line-height:1.18;">${title}</div>
          <div style="margin-top:18px;font-size:24px;line-height:1.45;color:rgba(255,255,255,0.84);">${excerpt}</div>
        </div>
      </foreignObject>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function attachImageFallbacks(items){
  if (!_mount) return;

  _mount.querySelectorAll('[data-news-item]').forEach((card) => {
    const id = card.getAttribute('id');
    const item = items.find((entry) => entry.id === id);
    const img = card.querySelector('img');
    if (!item || !img) return;
    if (img.dataset.fallbackSrc) return;

    const fallbackSrc = buildFallbackImage(item);
    img.dataset.fallbackSrc = fallbackSrc;

    img.addEventListener('error', () => {
      if (img.dataset.fallbackApplied === 'true') return;
      img.dataset.fallbackApplied = 'true';
      img.src = fallbackSrc;
    }, { once: true });
  });
}

function normalizeFilter(filter){
  return VALID_FILTERS.has(filter) ? filter : 'all';
}

function matches(item){
  if (_filter !== 'all' && item.category !== _filter) return false;
  if (!_query) return true;

  const q = _query.toLowerCase();
  const blob = `${item.title} ${item.excerpt} ${(item.tags || []).join(' ')} ${item.categoryLabel}`.toLowerCase();
  return blob.includes(q);
}

function cardSignature(item){
  return JSON.stringify([
    item.id,
    item.title,
    item.excerpt,
    item.category,
    item.categoryLabel,
    item.dateISO,
    item.minutes,
    item.image,
    item.imageAlt
  ]);
}

function cardMarkup(item){
  const id = escapeHTML(item.id);
  const title = escapeHTML(item.title);
  const excerpt = escapeHTML(item.excerpt);
  const cat = escapeHTML(item.categoryLabel || item.category);
  const dateText = escapeHTML(formatDate(item.dateISO));
  const dateISO = escapeHTML(item.dateISO || '');
  const minutes = Number(item.minutes);
  const minutesText = Number.isFinite(minutes) && minutes > 0 ? `${minutes} хв` : '';
  const img = escapeHTML(item.image || '');
  const imgAlt = escapeHTML(item.imageAlt || item.title || '');

  return `
    <article class="card glass visible" role="listitem" id="${id}" data-news-item data-category="${escapeHTML(item.category)}">
      <div class="card-media">
        ${img ? `<img src="${img}" alt="${imgAlt}" width="1200" height="675" loading="lazy" decoding="async">` : ''}
        <button class="card-tts-btn ui-control"
                type="button"
                aria-label="Озвучити новину: ${title}"
                title="Прослухати новину"
                data-tts-read
                data-tts-source="#${id}">🔊</button>
      </div>

      <div class="card-body">
        <div class="meta">
          <span class="nav-pill ui-control" style="pointer-events:none; opacity:.9;">${cat}</span>
          <span aria-hidden="true">•</span>
          <time datetime="${dateISO}">${dateText}</time>
          ${minutesText ? `<span aria-hidden="true">•</span><span>${escapeHTML(minutesText)}</span>` : ''}
        </div>

        <h3 class="measure">
          <button
            class="news-link news-link-btn ui-control"
            type="button"
            aria-label="Відкрити новину: ${title}"
            data-open-news="${id}"
          >${title}</button>
        </h3>

        <p class="measure">${excerpt}</p>
      </div>
    </article>
  `;
}

function createCard(item){
  const template = document.createElement('template');
  template.innerHTML = cardMarkup(item).trim();
  const card = template.content.firstElementChild;
  card.dataset.newsSignature = cardSignature(item);
  return card;
}

function reconcileCards(items){
  const existing = new Map(
    Array.from(_mount.querySelectorAll('[data-news-item]'), (card) => [card.id, card])
  );
  const desiredIds = new Set(items.map((item) => String(item.id)));

  Array.from(_mount.children).forEach((child) => {
    if (!child.matches('[data-news-item]') || !desiredIds.has(child.id)) child.remove();
  });

  items.forEach((item, index) => {
    const id = String(item.id);
    const signature = cardSignature(item);
    let card = existing.get(id);

    if (!card || card.dataset.newsSignature !== signature){
      const replacement = createCard(item);
      if (card?.isConnected) card.replaceWith(replacement);
      card = replacement;
    }

    const currentAtIndex = _mount.children[index];
    if (currentAtIndex !== card) _mount.insertBefore(card, currentAtIndex || null);
  });

  if (!items.length){
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.setAttribute('role', 'status');
    empty.textContent = 'Немає новин для цього фільтра або пошуку.';
    _mount.replaceChildren(empty);
  }
}

function render(){
  if (!_mount) return;

  const items = _all.filter(matches);
  const live = document.getElementById('a11y-live');

  if (live){
    const msg = _query
      ? `Знайдено ${items.length} новин за запитом "${_query}".`
      : `Показано ${items.length} новин.`;

    live.textContent = '';
    setTimeout(() => { live.textContent = msg; }, 10);
  }

  reconcileCards(items);
  attachImageFallbacks(items);
}

export function renderNews(mountEl, items){
  _mount = mountEl;
  _all = Array.isArray(items) ? items : [];
  render();
}

export function getNewsById(id){
  return _all.find((item) => item.id === id) || null;
}

export function setNewsFilter(filter){
  setNewsState({ filter });
}

export function setNewsQuery(q){
  setNewsState({ query: q });
}

export function setNewsState({ filter = _filter, query = _query } = {}){
  const nextFilter = normalizeFilter(filter);
  const nextQuery = String(query || '').trim();
  const changed = nextFilter !== _filter || nextQuery !== _query;

  _filter = nextFilter;
  _query = nextQuery;
  if (changed) render();
  saveFilterState(_filter, _query);
}

export function getFilterState(){
  return { filter: _filter, query: _query };
}

function saveFilterState(filter, query){
  try{
    localStorage.setItem('news-filter', filter);
    localStorage.setItem('news-query', query);
  }catch{}
}

export function loadSavedFilterState(){
  try{
    const savedFilter = localStorage.getItem('news-filter') || 'all';
    const filter = normalizeFilter(savedFilter);
    const query = localStorage.getItem('news-query') || '';
    if (filter !== savedFilter) localStorage.setItem('news-filter', filter);
    return { filter, query };
  }catch{
    return { filter: 'all', query: '' };
  }
}
