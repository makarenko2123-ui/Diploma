import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserCandidates = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);
const browserPath = browserCandidates.find(existsSync);
const profileDir = mkdtempSync(join(tmpdir(), 'diploma-smoke-'));
const failures = [];
const pageErrors = [];
let browser = null;
let server = null;
let cdp = null;

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function startServer(){
  const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf'
  };

  server = createServer((request, response) => {
    let pathname = '';
    try{
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    }catch{
      response.writeHead(400);
      response.end('Bad Request');
      return;
    }
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = resolve(root, relativePath);
    const isInsideRoot = filePath === root || filePath.startsWith(`${root}${sep}`);

    if (!isInsideRoot){
      response.writeHead(403);
      response.end('Forbidden');
      return;
    }

    try{
      const body = readFileSync(filePath);
      response.setHeader('Content-Type', contentTypes[extname(filePath)] || 'application/octet-stream');
      response.end(body);
    }catch{
      response.writeHead(404);
      response.end('Not found');
    }
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveServer(server.address().port));
  });
}

function getFreePort(){
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function waitForBrowserTarget(port){
  for (let attempt = 0; attempt < 80; attempt += 1){
    try{
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    }catch{}

    await delay(100);
  }

  throw new Error('Timed out while waiting for the headless browser.');
}

async function connectCdp(webSocketUrl){
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  await new Promise((resolveSocket, reject) => {
    socket.addEventListener('open', resolveSocket, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.id){
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }

    const eventListeners = listeners.get(message.method) || [];
    eventListeners.forEach((listener) => listener(message.params));
  });

  function send(method, params = {}){
    return new Promise((resolveMessage, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve: resolveMessage, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function on(method, listener){
    const eventListeners = listeners.get(method) || [];
    eventListeners.push(listener);
    listeners.set(method, eventListeners);
  }

  function once(method, timeoutMs = 8000){
    return new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}.`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timeout);
        const eventListeners = listeners.get(method) || [];
        listeners.set(method, eventListeners.filter((entry) => entry !== listener));
        resolveEvent(params);
      };
      on(method, listener);
    });
  }

  async function evaluate(fn, ...args){
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (result.exceptionDetails){
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    }

    return result.result.value;
  }

  return { socket, send, on, once, evaluate };
}

async function waitFor(check, message, timeoutMs = 3000){
  const started = Date.now();
  while (Date.now() - started < timeoutMs){
    if (await cdp.evaluate(check)) return;
    await delay(40);
  }
  throw new Error(message);
}

async function load(url){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
  await waitFor(
    () => document.querySelectorAll('[data-news-item]').length > 0,
    'News cards did not render.'
  );
}

async function reload(){
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.reload', { ignoreCache: true });
  await loaded;
}

async function tapPoint(x, y){
  const point = { x: Math.round(x), y: Math.round(y), id: 1, radiusX: 2, radiusY: 2, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await delay(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(80);
}

async function tapSelector(selector){
  const point = await cdp.evaluate((targetSelector) => {
    const el = document.querySelector(targetSelector);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
  }, selector);
  assert.ok(point, `Touch target not found: ${selector}`);
  await tapPoint(point.x, point.y);
}

async function swipe(from, to, durationMs = 280, steps = 6){
  const start = { x: Math.round(from.x), y: Math.round(from.y), id: 1, radiusX: 4, radiusY: 4, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  for (let index = 1; index <= steps; index += 1){
    const progress = index / steps;
    const point = {
      x: Math.round(from.x + ((to.x - from.x) * progress)),
      y: Math.round(from.y + ((to.y - from.y) * progress)),
      id: 1,
      radiusX: 4,
      radiusY: 4,
      force: 1
    };
    await delay(Math.max(16, Math.round(durationMs / steps)));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await delay(180);
}

async function run(name, test){
  try{
    await test();
    console.log(`PASS ${name}`);
  }catch(error){
    failures.push(`${name}: ${error.message}`);
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

try{
  assert.ok(browserPath, 'Install Edge or Chrome, or set BROWSER_PATH.');
  const sitePort = await startServer();

  await run('server rejects malformed encoded URLs', async () => {
    const response = await fetch(`http://127.0.0.1:${sitePort}/%E0%A4%A`);
    assert.equal(response.status, 400);
    assert.equal(await response.text(), 'Bad Request');
  });

  await run('privacy-sensitive resources are self-hosted', async () => {
    const sourceFiles = [
      'index.html',
      'js/news-data.js',
      'css/base.css',
      'css/themes.css'
    ];
    const externalReferences = sourceFiles.flatMap((file) => {
      const source = readFileSync(resolve(root, file), 'utf8');
      return Array.from(source.matchAll(/https:\/\//g), () => file);
    });
    const requiredAssets = [
      'assets/fonts/atkinson-hyperlegible-400.ttf',
      'assets/fonts/atkinson-hyperlegible-700.ttf',
      'assets/images/hero-mountains.jpg',
      ...Array.from({ length: 20 }, (_, index) => `assets/images/news-${String(index + 1).padStart(2, '0')}.jpg`)
    ];

    assert.deepEqual(externalReferences, []);
    assert.equal(requiredAssets.every((file) => existsSync(resolve(root, file))), true);
  });

  const debugPort = await getFreePort();

  browser = spawn(browserPath, [
    '--headless=new',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-background-networking',
    '--no-default-browser-check',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ], { stdio: 'ignore' });

  const webSocketUrl = await waitForBrowserTarget(debugPort);
  cdp = await connectCdp(webSocketUrl);
  await Promise.all([
    cdp.send('Page.enable'),
    cdp.send('Runtime.enable'),
    cdp.send('Log.enable')
  ]);
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    pageErrors.push(exceptionDetails.exception?.description || exceptionDetails.text);
  });
  cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') pageErrors.push(args.map((arg) => arg.value || arg.description).join(' '));
  });

  const url = `http://127.0.0.1:${sitePort}/`;
  await load(url);

  await run('initial render', async () => {
    const state = await cdp.evaluate(() => ({
      cards: document.querySelectorAll('[data-news-item]').length,
      duplicates: Array.from(document.querySelectorAll('[id]'))
        .map((node) => node.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index),
      brokenReferences: Array.from(document.querySelectorAll('[aria-controls], [aria-describedby], [aria-labelledby], label[for], a[href^="#"]'))
        .flatMap((node) => {
          const values = [
            node.getAttribute('aria-controls'),
            node.getAttribute('aria-describedby'),
            node.getAttribute('aria-labelledby'),
            node.getAttribute('for'),
            node.matches('a[href^="#"]') ? node.getAttribute('href')?.slice(1) : ''
          ].filter(Boolean).flatMap((value) => value.split(/\s+/));
          return values.filter((id) => !document.getElementById(id));
        }),
      title: document.title,
      zoomAssist: document.body.dataset.zoomAssist,
      liveRegions: Array.from(document.querySelectorAll('[aria-live]'), (node) => node.id),
      toastHiddenFromAT: document.getElementById('ai-indicator').getAttribute('aria-hidden'),
      toastLive: document.getElementById('ai-indicator').hasAttribute('aria-live'),
      hero: {
        src: document.querySelector('.hero-media img').getAttribute('src'),
        alt: document.querySelector('.hero-media img').alt,
        width: document.querySelector('.hero-media img').getAttribute('width'),
        height: document.querySelector('.hero-media img').getAttribute('height')
      },
      cardImagesHaveDimensions: Array.from(document.querySelectorAll('[data-news-item] img'))
        .every((image) => image.getAttribute('width') === '1200' && image.getAttribute('height') === '675'),
      policies: {
        referrer: document.querySelector('meta[name="referrer"]')?.content,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content
      },
      externalResources: performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /^https?:/i.test(name) && new URL(name).origin !== location.origin),
      defaultTheme: {
        colorScheme: getComputedStyle(document.body).colorScheme,
        background: getComputedStyle(document.body).backgroundColor
      },
      cardDates: Array.from(document.querySelectorAll('#cards time'), (time) => time.dateTime)
    }));
    assert.equal(state.cards, 20);
    assert.deepEqual(state.duplicates, []);
    assert.deepEqual(state.brokenReferences, []);
    assert.match(state.title, /NewsPortal/);
    assert.equal(state.zoomAssist, '0');
    assert.equal(state.liveRegions.filter((id) => id === 'a11y-live').length, 1);
    assert.equal(state.toastHiddenFromAT, 'true');
    assert.equal(state.toastLive, false);
    assert.deepEqual(state.hero, {
      src: 'assets/images/hero-mountains.jpg',
      alt: 'Засніжені гори під зоряним небом',
      width: '1600',
      height: '1068'
    });
    assert.equal(state.cardImagesHaveDimensions, true);
    assert.equal(state.policies.referrer, 'no-referrer');
    assert.match(state.policies.csp, /default-src 'self'/);
    assert.match(state.policies.csp, /connect-src 'none'/);
    assert.deepEqual(state.externalResources, []);
    assert.deepEqual(state.defaultTheme, { colorScheme: 'light', background: 'rgb(243, 246, 251)' });
    assert.equal(state.cardDates[0], '2026-04-08');
    assert.equal(state.cardDates.at(-1), '2026-03-20');
  });

  await run('filters and search', async () => {
    await cdp.evaluate(() => document.querySelector('#nav-filters [data-filter="tech"]').click());
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 4, 'Tech filter did not render four cards.');
    await cdp.evaluate(() => {
      const search = document.getElementById('news-search');
      search.value = '\u0444\u0456\u0448\u0438\u043d\u0433';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 1, 'Search did not narrow results.');
    await cdp.evaluate(() => document.getElementById('clear-filters').click());
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 20, 'Clear filters did not restore all cards.');
    assert.equal(await cdp.evaluate(() => document.getElementById('clear-filters').hidden), true);
  });

  await run('all categories and trends keep browser shortcuts available', async () => {
    const counts = await cdp.evaluate(() => {
      const result = {};
      ['politics', 'tech', 'sport', 'world', 'culture', 'all'].forEach((filter) => {
        document.querySelector(`#nav-filters [data-filter="${filter}"]`).click();
        result[filter] = document.querySelectorAll('[data-news-item]').length;
      });
      return result;
    });
    assert.deepEqual(counts, { politics: 4, tech: 4, sport: 4, world: 4, culture: 4, all: 20 });

    const state = await cdp.evaluate(() => {
      const trend = document.querySelector('[data-trend="кібербезпека"]');
      trend.click();
      const activeTrend = {
        query: document.getElementById('news-search').value,
        clearVisible: !document.getElementById('clear-filters').hidden
      };
      trend.click();
      const numericShortcutAllowed = document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '3',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
      return {
        activeTrend,
        queryAfterToggle: document.getElementById('news-search').value,
        cardsAfterShortcut: document.querySelectorAll('[data-news-item]').length,
        allPressed: document.querySelector('#nav-filters [data-filter="all"]').getAttribute('aria-pressed'),
        numericShortcutAllowed
      };
    });
    assert.deepEqual(state, {
      activeTrend: { query: 'кібербезпека', clearVisible: true },
      queryAfterToggle: '',
      cardsAfterShortcut: 20,
      allPressed: 'true',
      numericShortcutAllowed: true
    });
    await cdp.evaluate(() => document.getElementById('clear-filters').click());
  });

  await run('ticker exposes one accessible copy and a persistent pause control', async () => {
    const paused = await cdp.evaluate(() => {
      const button = document.getElementById('ticker-toggle');
      button.click();
      document.querySelector('.ticker').dispatchEvent(new PointerEvent('pointerleave', {
        bubbles: true,
        pointerType: 'mouse'
      }));
      document.getElementById('clear-filters').click();
      const titles = Array.from(document.querySelectorAll('#ticker-accessible-list li'), (item) => item.textContent.trim());
      return {
        accessibleCount: titles.length,
        uniqueAccessibleCount: new Set(titles).size,
        visualCount: document.querySelectorAll('#ticker-track .ticker-item').length,
        visualHidden: document.querySelector('.ticker-viewport').getAttribute('aria-hidden'),
        pressed: button.getAttribute('aria-pressed'),
        userPaused: document.getElementById('ticker-track').dataset.userPaused
      };
    });
    assert.deepEqual(paused, {
      accessibleCount: 10,
      uniqueAccessibleCount: 10,
      visualCount: 20,
      visualHidden: 'true',
      pressed: 'true',
      userPaused: 'true'
    });
    await cdp.evaluate(() => document.getElementById('ticker-toggle').click());
    assert.equal(await cdp.evaluate(() => document.getElementById('ticker-toggle').getAttribute('aria-pressed')), 'false');
  });

  await run('repeated ticker pauses stay local to the ticker', async () => {
    const state = await cdp.evaluate(() => {
      const button = document.getElementById('ticker-toggle');
      button.click();
      button.click();
      button.click();
      const result = {
        tickerPaused: button.getAttribute('aria-pressed'),
        globalMotionReduced: document.body.classList.contains('reduce-motion')
      };
      button.click();
      return result;
    });
    assert.deepEqual(state, { tickerPaused: 'true', globalMotionReduced: false });
  });

  await run('debounced keyed search preserves matching card and focus', async () => {
    const immediate = await cdp.evaluate(() => {
      const card = document.querySelector('[data-news-item]');
      const trigger = card.querySelector('[data-open-news]');
      const search = document.getElementById('news-search');
      window.__preservedNewsCard = card;
      trigger.focus();
      search.value = trigger.textContent.trim();
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        cards: document.querySelectorAll('[data-news-item]').length,
        focused: document.activeElement === trigger
      };
    });
    assert.deepEqual(immediate, { cards: 20, focused: true });
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 1, 'Debounced search did not settle.');
    const settled = await cdp.evaluate(() => {
      const card = document.querySelector('[data-news-item]');
      return {
        sameCard: card === window.__preservedNewsCard,
        focusPreserved: document.activeElement === card.querySelector('[data-open-news]'),
        inertCards: document.querySelectorAll('#cards .card[inert]').length
      };
    });
    assert.deepEqual(settled, { sameCard: true, focusPreserved: true, inertCards: 0 });
    await cdp.evaluate(() => {
      delete window.__preservedNewsCard;
      document.getElementById('clear-filters').click();
    });
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 20, 'Keyed search cleanup failed.');
  });

  await run('repeated empty searches enable and clear search assistance', async () => {
    const state = await cdp.evaluate(() => {
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      const search = document.getElementById('news-search');

      search.value = 'запит-без-результату-один';
      search.dispatchEvent(new Event('change', { bubbles: true }));
      const afterFirst = document.body.classList.contains('a11y-search-assist');

      search.value = 'запит-без-результату-два';
      search.dispatchEvent(new Event('change', { bubbles: true }));
      const hint = document.getElementById('search-assist-hint');
      const afterSecond = document.body.classList.contains('a11y-search-assist');
      const hintVisible = getComputedStyle(hint).display !== 'none';

      search.value = 'фішинг';
      search.dispatchEvent(new Event('change', { bubbles: true }));
      const afterSuccess = document.body.classList.contains('a11y-search-assist');

      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      return { afterFirst, afterSecond, hintVisible, afterSuccess };
    });

    assert.deepEqual(state, {
      afterFirst: false,
      afterSecond: true,
      hintVisible: true,
      afterSuccess: false
    });
  });

  await run('guided news scenario', async () => {
    await cdp.evaluate(() => document.querySelector('[data-focus="security"]').click());
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 1, 'Security scenario did not narrow results.');
    const state = await cdp.evaluate(() => ({
      active: document.querySelector('[data-focus="security"]').getAttribute('aria-pressed'),
      query: document.getElementById('news-search').value
    }));
    assert.equal(state.active, 'true');
    assert.equal(state.query, '\u0444\u0456\u0448\u0438\u043d\u0433');
    await cdp.evaluate(() => document.getElementById('clear-filters').click());
  });

  await run('quick accessibility actions', async () => {
    const state = await cdp.evaluate(() => {
      document.querySelector('[data-qa="readable"]').click();
      const readable = {
        readingMode: document.body.classList.contains('a11y-reading-mode'),
        textScale: getComputedStyle(document.documentElement).getPropertyValue('--font-size-base').trim()
      };
      document.querySelector('[data-qa="contrast"]').click();
      const highContrast = document.body.classList.contains('theme-high-contrast');
      document.querySelector('[data-qa="tts"]').click();
      const ttsSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
      const playerOpen = !document.getElementById('tts-player').hidden;
      const ttsControlsDisabled = [
        document.getElementById('tts-voice'),
        document.getElementById('tts-rate'),
        document.getElementById('tts-player-rate'),
        document.getElementById('tts-sample')
      ].every((control) => control.disabled);
      document.getElementById('tts-stop').click();

      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      return { readable, highContrast, ttsSupported, playerOpen, ttsControlsDisabled };
    });
    assert.deepEqual(state.readable, { readingMode: true, textScale: '115%' });
    assert.equal(state.highContrast, true);
    assert.equal(state.ttsControlsDisabled, !state.ttsSupported);
    if (!state.ttsSupported) assert.equal(state.playerOpen, false);
  });

  await run('news dialog', async () => {
    const state = await cdp.evaluate(() => {
      document.querySelector('[data-open-news]').click();
      return {
        bodyLocked: document.body.classList.contains('dialog-open'),
        rootLocked: document.documentElement.classList.contains('dialog-open'),
        dialogOpen: !document.getElementById('news-dialog').hidden,
        backdropOpen: !document.getElementById('backdrop').hidden,
        mainInert: document.getElementById('main').inert,
        tickerInert: document.querySelector('.ticker').inert,
        paragraphs: document.querySelectorAll('#news-dialog-content p').length
      };
    });
    assert.deepEqual(state, {
      bodyLocked: true,
      rootLocked: true,
      dialogOpen: true,
      backdropOpen: true,
      mainInert: true,
      tickerInert: true,
      paragraphs: 3
    });

    const isolatedState = await cdp.evaluate(() => {
      const filterBefore = document.querySelector('[data-filter].active')?.getAttribute('data-filter');
      const targetLevelBefore = document.body.dataset.targetLevel;
      for (let index = 0; index < 4; index += 1){
        document.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 20,
          isPrimary: true
        }));
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: '4' }));
      return {
        filterBefore,
        filterAfter: document.querySelector('[data-filter].active')?.getAttribute('data-filter'),
        targetLevelBefore,
        targetLevelAfter: document.body.dataset.targetLevel
      };
    });
    assert.equal(isolatedState.filterAfter, isolatedState.filterBefore, JSON.stringify(isolatedState));
    assert.equal(isolatedState.targetLevelAfter, isolatedState.targetLevelBefore, JSON.stringify(isolatedState));

    const articleState = await cdp.evaluate(() => {
      const body = document.querySelector('.news-dialog-body');
      const content = document.getElementById('news-dialog-content');
      const lastParagraph = content.lastElementChild;
      body.scrollTop = body.scrollHeight;
      const bodyRect = body.getBoundingClientRect();
      const paragraphRect = lastParagraph.getBoundingClientRect();
      return {
        contentText: content.textContent.trim(),
        scrollable: body.scrollHeight > body.clientHeight,
        lastParagraphReachable: paragraphRect.bottom <= bodyRect.bottom + 2
      };
    });
    assert.ok(articleState.contentText.length > 180);
    assert.equal(articleState.lastParagraphReachable, true);
    await cdp.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(await cdp.evaluate(() => document.getElementById('news-dialog').hidden), true);
    assert.deepEqual(await cdp.evaluate(() => ({
      rootLocked: document.documentElement.classList.contains('dialog-open'),
      mainInert: document.getElementById('main').inert,
      tickerInert: document.querySelector('.ticker').inert
    })), { rootLocked: false, mainInert: false, tickerInert: false });
    const backdropClosed = await cdp.evaluate(() => {
      document.querySelector('[data-open-news]').click();
      document.getElementById('backdrop').click();
      return document.getElementById('news-dialog').hidden;
    });
    assert.equal(backdropClosed, true);
  });

  await run('reopening an unfinished article restores its reading position', async () => {
    const initial = await cdp.evaluate(() => {
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      const trigger = document.querySelector('[data-open-news]');
      trigger.click();
      const body = document.querySelector('.news-dialog-body');
      const available = Math.max(0, body.scrollHeight - body.clientHeight);
      body.scrollTop = available * 0.45;
      body.dispatchEvent(new Event('scroll'));
      const progress = available > 0 ? body.scrollTop / available : 0;
      document.getElementById('news-dialog-close').click();
      trigger.click();
      return { scrollable: available > 0, progress };
    });

    await delay(120);
    const restored = await cdp.evaluate(() => {
      const body = document.querySelector('.news-dialog-body');
      const available = Math.max(1, body.scrollHeight - body.clientHeight);
      return {
        progress: body.scrollTop / available,
        ruler: document.body.classList.contains('a11y-reading-ruler'),
        narrow: getComputedStyle(document.documentElement).getPropertyValue('--measure-base').trim()
      };
    });
    await cdp.evaluate(() => {
      document.getElementById('news-dialog-close').click();
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
    });

    assert.equal(initial.scrollable, true, JSON.stringify(initial));
    assert.ok(initial.progress > 0.2, JSON.stringify(initial));
    assert.ok(restored.progress > 0.2, JSON.stringify(restored));
    assert.equal(restored.ruler, true, JSON.stringify(restored));
    assert.equal(restored.narrow, '640px', JSON.stringify(restored));
  });

  await run('only one modal stays open and focus returns', async () => {
    const state = await cdp.evaluate(() => {
      const trigger = document.querySelector('[data-open-news]');
      trigger.click();
      document.getElementById('a11y-toggle').click();
      const panelReplacedDialog = {
        panelOpen: !document.getElementById('a11y-panel').hidden,
        dialogOpen: !document.getElementById('news-dialog').hidden
      };

      trigger.click();
      const dialogReplacedPanel = {
        panelOpen: !document.getElementById('a11y-panel').hidden,
        dialogOpen: !document.getElementById('news-dialog').hidden
      };

      document.getElementById('news-dialog-close').click();
      return {
        panelReplacedDialog,
        dialogReplacedPanel,
        focusReturned: document.activeElement === trigger,
        bodyLocked: document.body.classList.contains('dialog-open'),
        backdropOpen: !document.getElementById('backdrop').hidden
      };
    });
    assert.deepEqual(state, {
      panelReplacedDialog: { panelOpen: true, dialogOpen: false },
      dialogReplacedPanel: { panelOpen: false, dialogOpen: true },
      focusReturned: true,
      bodyLocked: false,
      backdropOpen: false
    });
  });

  await run('readability mode requires meaningful reading intent', async () => {
    const pointerState = await cdp.evaluate(() => {
      document.querySelector('[data-open-news]').click();
      const content = document.getElementById('news-dialog-content');
      content.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, button: 0 }));
      return document.body.classList.contains('a11y-reading-mode');
    });
    assert.equal(pointerState, false);

    const state = await cdp.evaluate(() => {
      const content = document.getElementById('news-dialog-content');
      const range = document.createRange();
      range.selectNodeContents(content);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return {
        readingMode: document.body.classList.contains('a11y-reading-mode'),
        readingRuler: document.body.classList.contains('a11y-reading-ruler')
      };
    });
    assert.deepEqual(state, { readingMode: true, readingRuler: true });
    await cdp.evaluate(() => document.getElementById('news-dialog-close').click());
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('a11y-reading-mode')), false);
  });

  await run('keyboard reading intent requires article scroll and ignores controls', async () => {
    await cdp.evaluate(() => document.querySelector('[data-open-news]').click());
    await delay(2600);
    const state = await cdp.evaluate(async () => {
      const close = document.getElementById('news-dialog-close');
      const body = document.querySelector('.news-dialog-body');
      close.focus();
      for (let index = 0; index < 3; index += 1){
        close.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      const afterControls = document.body.classList.contains('a11y-reading-mode');

      body.scrollTop = 0;
      body.focus();
      for (let index = 0; index < 3; index += 1){
        body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
        body.scrollTop += 30;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      return {
        afterControls,
        afterRealScroll: document.body.classList.contains('a11y-reading-mode'),
        scrollTop: body.scrollTop
      };
    });
    assert.equal(state.afterControls, false, JSON.stringify(state));
    assert.equal(state.afterRealScroll, true, JSON.stringify(state));
    assert.ok(state.scrollTop > 0, JSON.stringify(state));
    await cdp.evaluate(() => document.getElementById('news-dialog-close').click());
  });

  await run('accessibility panel and reset', async () => {
    await cdp.evaluate(() => document.getElementById('a11y-toggle').click());
    assert.equal(await cdp.evaluate(() => document.getElementById('a11y-panel').hidden), false);
    await cdp.evaluate(() => {
      const radio = document.querySelector('input[name="theme"][value="dark"]');
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
    });
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('theme-default')), true);
    assert.equal(await cdp.evaluate(() => document.getElementById('a11y-panel').hidden), false);
    await cdp.evaluate(() => document.getElementById('a11y-close2').click());
  });

  await run('keyboard shortcuts, focus trap, and reset confirmation', async () => {
    const shortcutState = await cdp.evaluate(() => {
      const email = document.getElementById('email');
      const panel = document.getElementById('a11y-panel');
      email.focus();
      email.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
      email.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true, cancelable: true }));
      const editableShortcutIgnored = document.activeElement === email && panel.hidden;
      email.blur();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
      const searchFocused = document.activeElement === document.getElementById('news-search');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true }));

      const items = Array.from(panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.hidden && el.tabIndex >= 0 && el.getClientRects().length > 0);
      const first = items[0];
      const last = items[items.length - 1];
      first.focus();
      first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      const wrappedToLast = last === document.activeElement;

      document.getElementById('a11y-reset').click();
      const armedText = document.getElementById('a11y-reset').textContent.trim();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.getElementById('a11y-toggle').click();

      return {
        editableShortcutIgnored,
        searchFocused,
        wrappedToLast,
        armedText,
        resetTextAfterReopen: document.getElementById('a11y-reset').textContent.trim()
      };
    });
    assert.equal(shortcutState.editableShortcutIgnored, true);
    assert.equal(shortcutState.searchFocused, true);
    assert.equal(shortcutState.wrappedToLast, true);
    assert.match(shortcutState.armedText, /Підтвердити/);
    assert.equal(shortcutState.resetTextAfterReopen, 'Скинути всі налаштування');
    await cdp.evaluate(() => document.getElementById('a11y-close2').click());
  });

  await run('all accessibility presets keep the layout usable', async () => {
    const states = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const result = {};
      const expectedClasses = {
        reading: ['a11y-reading-mode', 'reduce-motion'],
        vision: ['theme-high-contrast', 'focus-thick', 'underline-links'],
        keyboard: ['focus-thick', 'focus-always', 'underline-links'],
        focus: ['a11y-reading-mode', 'reduce-motion', 'a11y-declutter']
      };

      Object.entries(expectedClasses).forEach(([preset, classes]) => {
        document.querySelector(`[data-preset="${preset}"]`).click();
        const panel = document.getElementById('a11y-panel');
        result[preset] = {
          classes: classes.every((className) => document.body.classList.contains(className)),
          pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          panelOverflow: panel.scrollWidth > panel.clientWidth + 1
        };
        document.getElementById('a11y-reset').click();
        document.getElementById('a11y-reset').click();
      });
      document.getElementById('a11y-close2').click();
      return result;
    });

    Object.values(states).forEach((state) => {
      assert.equal(state.classes, true);
      assert.equal(state.pageOverflow, false);
      assert.equal(state.panelOverflow, false);
    });
  });

  await run('auto adaptation resumes after reset and reaches third target level', async () => {
    const dispatchMisses = async (count) => cdp.evaluate((missCount) => {
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      const init = {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: rect.left - 6,
        clientY: rect.top + (rect.height / 2)
      };
      for (let index = 0; index < missCount; index++){
        document.dispatchEvent(new PointerEvent('pointerup', init));
      }
    }, count);
    const resetAll = async () => cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
    });

    await dispatchMisses(3);
    assert.equal(await cdp.evaluate(() => document.body.dataset.targetLevel), '1');
    await dispatchMisses(2);
    assert.equal(await cdp.evaluate(() => document.body.dataset.targetLevel), '2');

    await resetAll();
    await dispatchMisses(8);
    assert.equal(await cdp.evaluate(() => document.body.dataset.targetLevel), '3');
    const panelSizing = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const radio = document.querySelector('#a11y-panel input[type="radio"]').getBoundingClientRect();
      const reset = document.getElementById('a11y-reset').getBoundingClientRect();
      const panel = document.getElementById('a11y-panel');
      const result = {
        radioWidth: radio.width,
        radioHeight: radio.height,
        resetHeight: reset.height,
        overflows: panel.scrollWidth > panel.clientWidth + 1
      };
      document.getElementById('a11y-close2').click();
      return result;
    });
    assert.ok(panelSizing.radioWidth <= 24 && panelSizing.radioHeight <= 24);
    assert.ok(panelSizing.resetHeight <= 48);
    assert.equal(panelSizing.overflows, false);
    assert.equal(
      await cdp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true
    );

    await resetAll();
    assert.equal(await cdp.evaluate(() => document.body.dataset.targetLevel), '0');
  });

  await run('combined visual difficulty signals enable high contrast', async () => {
    const state = await cdp.evaluate(() => {
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      const miss = {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: rect.left - 6,
        clientY: rect.top + (rect.height / 2)
      };
      for (let index = 0; index < 5; index += 1){
        document.dispatchEvent(new PointerEvent('pointerup', miss));
      }
      const highContrastAfterMissesOnly = document.body.classList.contains('theme-high-contrast');

      for (let index = 0; index < 3; index += 1){
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      }

      const result = {
        highContrastAfterMissesOnly,
        highContrast: document.body.classList.contains('theme-high-contrast'),
        thickFocus: document.body.classList.contains('focus-thick'),
        underlinedLinks: document.body.classList.contains('underline-links')
      };
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      return result;
    });

    assert.deepEqual(state, {
      highContrastAfterMissesOnly: false,
      highContrast: true,
      thickFocus: true,
      underlinedLinks: true
    });
  });

  await run('active feed viewing enables and later clears reading mode', async () => {
    await cdp.evaluate(() => {
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      document.getElementById('cards').scrollIntoView({ block: 'center', behavior: 'instant' });
      window.dispatchEvent(new Event('scroll'));
    });
    await delay(320);
    await cdp.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await delay(30600);

    const enabled = await cdp.evaluate(() => ({
        readingMode: document.body.classList.contains('a11y-reading-mode'),
        oneColumn: document.body.classList.contains('a11y-one-column'),
        reducedMotion: document.body.classList.contains('reduce-motion')
    }));

    assert.deepEqual(enabled, {
      readingMode: true,
      oneColumn: true,
      reducedMotion: true
    });

    await cdp.evaluate(() => document.getElementById('news-search').focus());
    await delay(150);

    const restored = await cdp.evaluate(() => {
      const result = {
        readingMode: document.body.classList.contains('a11y-reading-mode'),
        oneColumn: document.body.classList.contains('a11y-one-column'),
        reducedMotion: document.body.classList.contains('reduce-motion')
      };
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      window.scrollTo(0, 0);
      return result;
    });

    assert.deepEqual(restored, {
      readingMode: false,
      oneColumn: false,
      reducedMotion: false
    });
  });

  await run('undo pauses automatic adaptations until explicit resume', async () => {
    const state = await cdp.evaluate(() => {
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      const miss = {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: rect.left - 6,
        clientY: rect.top + (rect.height / 2)
      };
      const dispatchMisses = () => {
        for (let index = 0; index < 3; index++) document.dispatchEvent(new PointerEvent('pointerup', miss));
      };
      dispatchMisses();
      const before = document.body.dataset.targetLevel;
      document.getElementById('a11y-toggle').click();
      const enabledBefore = !document.getElementById('auto-undo').disabled;
      document.getElementById('auto-undo').click();
      const after = document.body.dataset.targetLevel;
      const disabledAfter = document.getElementById('auto-undo').disabled;
      const pausedLabel = document.getElementById('auto-undo').textContent.trim();
      document.getElementById('a11y-close2').click();
      dispatchMisses();
      const whilePaused = document.body.dataset.targetLevel;
      document.getElementById('a11y-toggle').click();
      document.getElementById('auto-undo').click();
      document.getElementById('a11y-close2').click();
      dispatchMisses();
      const afterResume = document.body.dataset.targetLevel;
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      return { before, enabledBefore, after, disabledAfter, pausedLabel, whilePaused, afterResume };
    });
    assert.equal(state.before, '1', JSON.stringify(state));
    assert.equal(state.enabledBefore, true, JSON.stringify(state));
    assert.equal(state.after, '0', JSON.stringify(state));
    assert.equal(state.disabledAfter, false, JSON.stringify(state));
    assert.match(state.pausedLabel, /Відновити/);
    assert.equal(state.whilePaused, '0', JSON.stringify(state));
    assert.equal(state.afterResume, '1', JSON.stringify(state));
  });

  await run('paused automatic adaptation survives reload', async () => {
    await cdp.evaluate(() => {
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      const miss = {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: rect.left - 6,
        clientY: rect.top + (rect.height / 2)
      };
      for (let index = 0; index < 3; index++) document.dispatchEvent(new PointerEvent('pointerup', miss));
      document.getElementById('a11y-toggle').click();
      document.getElementById('auto-undo').click();
      document.getElementById('a11y-close2').click();
    });
    await reload();
    await waitFor(() => document.body.dataset.targetLevel === '0', 'Paused auto adaptation was not restored after reload.');
    const state = await cdp.evaluate(() => {
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      const miss = {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: rect.left - 6,
        clientY: rect.top + (rect.height / 2)
      };
      for (let index = 0; index < 3; index++) document.dispatchEvent(new PointerEvent('pointerup', miss));
      const whilePaused = document.body.dataset.targetLevel;
      document.getElementById('a11y-toggle').click();
      const pausedLabel = document.getElementById('auto-undo').textContent.trim();
      document.getElementById('auto-undo').click();
      document.getElementById('a11y-close2').click();
      for (let index = 0; index < 3; index++) document.dispatchEvent(new PointerEvent('pointerup', miss));
      const afterResume = document.body.dataset.targetLevel;
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      return { whilePaused, pausedLabel, afterResume };
    });
    assert.equal(state.whilePaused, '0', JSON.stringify(state));
    assert.match(state.pausedLabel, /Відновити/);
    assert.equal(state.afterResume, '1', JSON.stringify(state));
  });

  await run('mini accessibility audit', async () => {
    const summary = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-audit').click();
      return {
        hidden: document.getElementById('a11y-audit-results').hidden,
        text: document.getElementById('a11y-audit-results').textContent.trim()
      };
    });
    assert.equal(summary.hidden, false);
    assert.match(summary.text, /\u0420\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442/);
    assert.match(summary.text, /WCAG-/);
    console.log(`INFO mini audit: ${summary.text.split(/\s+/).slice(0, 4).join(' ')}`);
    await cdp.evaluate(() => document.getElementById('a11y-close2').click());
  });

  await run('mini accessibility audit stays clean across themes', async () => {
    const results = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const themes = ['default', 'dark', 'high-contrast', 'sepia'];
      const summaries = {};
      themes.forEach((theme) => {
        const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('a11y-audit').click();
        const box = document.getElementById('a11y-audit-results');
        const issues = Array.from(box.querySelectorAll('[data-audit-jump]')).map((button) => {
          button.click();
          const element = document.querySelector('.a11y-outline-issue');
          return element ? {
            tag: element.tagName,
            id: element.id,
            className: element.className,
            text: element.textContent.trim().slice(0, 80),
            color: getComputedStyle(element).color,
            background: getComputedStyle(element).backgroundColor,
            fgVariable: getComputedStyle(element).getPropertyValue('--fg').trim(),
            bodyClass: document.body.className
          } : null;
        }).filter(Boolean);
        summaries[theme] = { text: box.textContent.trim(), issues };
      });
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      return summaries;
    });
    Object.entries(results).forEach(([theme, summary]) => {
      assert.match(summary.text, /WCAG-/, `${theme}: ${JSON.stringify(summary.issues)}`);
    });
  });

  await run('audit jump restores temporary tabindex', async () => {
    const state = await cdp.evaluate(() => {
      const image = document.createElement('img');
      image.id = 'audit-tabindex-probe';
      image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
      image.style.cssText = 'display:block;width:40px;height:40px';
      document.getElementById('main').appendChild(image);

      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-audit').click();
      const jump = Array.from(document.querySelectorAll('[data-audit-jump]'))
        .find((button) => button.closest('li')?.textContent.includes('alt'));
      jump?.click();
      const during = image.getAttribute('tabindex');
      document.querySelector('[data-audit-clear]')?.click();
      const after = image.getAttribute('tabindex');
      image.remove();
      document.getElementById('a11y-close2').click();
      return { foundJump: !!jump, during, after };
    });
    assert.deepEqual(state, { foundJump: true, during: '-1', after: null });
  });

  await run('subscription validation', async () => {
    const invalid = await cdp.evaluate(() => {
      const email = document.getElementById('email');
      email.value = 'bad';
      document.getElementById('subscribe-form').requestSubmit();
      return {
        emailInvalid: email.getAttribute('aria-invalid'),
        emailError: document.getElementById('email-error').textContent,
        aiError: document.getElementById('email__ai_error')?.dataset.aiError,
        describedBy: email.getAttribute('aria-describedby')
      };
    });
    assert.equal(invalid.emailInvalid, 'true');
    assert.ok(invalid.emailError);
    assert.equal(invalid.aiError, 'true');
    assert.match(invalid.describedBy, /email-error/);
    assert.match(invalid.describedBy, /email__ai_error/);

    await delay(650);
    const repeatedInvalid = await cdp.evaluate(() => {
      document.getElementById('subscribe-form').requestSubmit();
      return {
        aiErrors: document.querySelectorAll('[data-ai-error]').length,
        appError: document.getElementById('email-error').textContent,
        targetLevel: document.body.dataset.targetLevel
      };
    });
    assert.equal(repeatedInvalid.aiErrors, 1);
    assert.ok(repeatedInvalid.appError);
    assert.equal(repeatedInvalid.targetLevel, '1');

    const validState = await cdp.evaluate(() => {
      const email = document.getElementById('email');
      email.value = 'demo@example.com';
      email.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('subscribe-form').requestSubmit();
      return {
        message: document.getElementById('form-message').textContent,
        targetLevel: document.body.dataset.targetLevel,
        aiErrors: document.querySelectorAll('[data-ai-error]').length,
        describedBy: email.getAttribute('aria-describedby')
      };
    });
    assert.match(validState.message, /\u0414\u044f\u043a\u0443\u0454\u043c\u043e/);
    assert.equal(validState.targetLevel, '0');
    assert.equal(validState.aiErrors, 0);
    assert.doesNotMatch(validState.describedBy, /__ai_error/);
  });

  await run('large-target mode keeps paragraph links inline', async () => {
    const state = await cdp.evaluate(() => {
      const previous = document.body.dataset.targetLevel;
      const paragraph = document.createElement('p');
      const link = document.createElement('a');
      link.href = '#main';
      link.textContent = 'x';
      paragraph.append('Текст ', link, ' далі.');
      document.getElementById('main').appendChild(paragraph);
      document.body.dataset.targetLevel = '3';
      const style = getComputedStyle(link);
      const result = {
        display: style.display,
        minWidth: style.minWidth,
        width: link.getBoundingClientRect().width
      };
      paragraph.remove();
      document.body.dataset.targetLevel = previous;
      return result;
    });
    assert.equal(state.display, 'inline', JSON.stringify(state));
    assert.ok(state.width < 60, JSON.stringify(state));
  });

  await run('empty search state and image fallback', async () => {
    await cdp.evaluate(() => {
      const search = document.getElementById('news-search');
      search.value = 'рядок-якого-точно-немає';
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 0, 'Empty search did not settle.');
    const emptyState = await cdp.evaluate(() => ({
        cards: document.querySelectorAll('[data-news-item]').length,
        status: document.getElementById('cards').textContent.trim(),
        clearVisible: !document.getElementById('clear-filters').hidden
    }));
    assert.equal(emptyState.cards, 0);
    assert.match(emptyState.status, /Немає новин/);
    assert.equal(emptyState.clearVisible, true);

    await cdp.evaluate(() => document.getElementById('clear-filters').click());
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 20, 'Clear filters did not leave the empty state.');
    const fallbackApplied = await cdp.evaluate(() => {
      const img = document.querySelector('[data-news-item] img');
      img.dispatchEvent(new Event('error'));
      return img.src.startsWith('data:image/svg+xml');
    });
    assert.equal(fallbackApplied, true);
  });

  await run('manual settings and valid filters persist', async () => {
    await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const theme = document.querySelector('input[name="theme"][value="sepia"]');
      theme.checked = true;
      theme.dispatchEvent(new Event('change', { bubbles: true }));
      const scale = document.getElementById('text-scale');
      scale.value = '125';
      scale.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('a11y-close2').click();
      document.querySelector('#nav-filters [data-filter="tech"]').click();
      const search = document.getElementById('news-search');
      search.value = 'фішинг';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      search.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await reload();
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 1, 'Saved filter and query were not restored.');
    const state = await cdp.evaluate(() => ({
      sepia: document.body.classList.contains('theme-sepia'),
      textScale: getComputedStyle(document.documentElement).getPropertyValue('--font-size-base').trim(),
      query: document.getElementById('news-search').value,
      techPressed: document.querySelector('#nav-filters [data-filter="tech"]').getAttribute('aria-pressed')
    }));
    assert.deepEqual(state, { sepia: true, textScale: '125%', query: 'фішинг', techPressed: 'true' });
    await cdp.evaluate(() => {
      document.getElementById('clear-filters').click();
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
    });
  });

  await run('corrupt saved accessibility settings fall back safely', async () => {
    await cdp.evaluate(() => localStorage.setItem('a11y.settings.v4', '{broken-json'));
    await reload();
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 20, 'Page did not recover from corrupt accessibility settings.');
    const state = await cdp.evaluate(() => ({
      themeDefault: document.body.classList.contains('theme-default'),
      scale: getComputedStyle(document.documentElement).getPropertyValue('--font-size-base').trim(),
      aiMode: document.body.dataset.aiMode
    }));
    assert.deepEqual(state, { themeDefault: true, scale: '100%', aiMode: 'auto' });
  });

  await run('reduced motion also disables scripted smooth scrolling', async () => {
    const state = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const reduce = document.getElementById('reduce-motion');
      reduce.checked = true;
      reduce.dispatchEvent(new Event('change', { bubbles: true }));
      document.getElementById('a11y-close2').click();

      const cards = document.getElementById('cards');
      const originalIntoView = cards.scrollIntoView;
      let guidedBehavior = null;
      cards.scrollIntoView = (options) => { guidedBehavior = options?.behavior || null; };
      document.querySelector('[data-focus="security"]').click();
      cards.scrollIntoView = originalIntoView;

      const originalScrollTo = window.scrollTo;
      let topBehavior = null;
      window.scrollTo = (options) => { topBehavior = options?.behavior || null; };
      document.getElementById('back-to-top').click();
      window.scrollTo = originalScrollTo;

      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      document.getElementById('clear-filters').click();

      return { guidedBehavior, topBehavior };
    });
    assert.deepEqual(state, { guidedBehavior: 'auto', topBehavior: 'auto' });
  });

  await run('sharp scrolling uses the raised six-action threshold', async () => {
    await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
    });
    await delay(250);
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('reduce-motion')), false);

    for (let index = 0; index < 5; index += 1){
      await cdp.evaluate((direction) => {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: direction * 240 }));
      }, index % 2 === 0 ? 1 : -1);
      await delay(220);
    }
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('reduce-motion')), false);

    await cdp.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: -240 })));
    await waitFor(() => document.body.classList.contains('reduce-motion'), 'Sixth sharp scroll did not enable motion reduction.');
    await cdp.evaluate(() => document.dispatchEvent(new CustomEvent('a11y:reset-all')));
  });

  await run('TTS rate controls stay synchronized and reset safely', async () => {
    const state = await cdp.evaluate(() => {
      const playerRate = document.getElementById('tts-player-rate');
      playerRate.value = '1.25';
      playerRate.dispatchEvent(new Event('input', { bubbles: true }));
      const saved = JSON.parse(localStorage.getItem('a11y.settings.v4'));
      const result = {
        panelRate: document.getElementById('tts-rate').value,
        playerValueText: playerRate.getAttribute('aria-valuetext'),
        savedRate: saved.ttsRate
      };
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      return result;
    });
    assert.deepEqual(state, {
      panelRate: '1.25',
      playerValueText: 'Швидкість 125 відсотків',
      savedRate: 1.25
    });
  });

  await run('TTS ignores scrolling and handles active rate changes', async () => {
    const state = await cdp.evaluate(() => {
      const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
      const controls = [
        document.getElementById('tts-voice'),
        document.getElementById('tts-rate'),
        document.getElementById('tts-player-rate'),
        document.getElementById('tts-sample')
      ];

      document.getElementById('tts-sample').click();
      const activeBeforeScroll = !document.getElementById('tts-player').hidden;
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
      window.dispatchEvent(new TouchEvent('touchmove', { bubbles: true }));
      const openAfterScroll = !document.getElementById('tts-player').hidden;
      const rate = document.getElementById('tts-player-rate');
      rate.value = '1.2';
      rate.dispatchEvent(new Event('input', { bubbles: true }));
      const openAfterRate = !document.getElementById('tts-player').hidden;
      document.getElementById('tts-stop').click();

      return {
        supported,
        activeBeforeScroll,
        openAfterScroll,
        openAfterRate,
        unsupportedControlsDisabled: controls.every((control) => control.disabled)
      };
    });
    if (state.activeBeforeScroll){
      assert.equal(state.openAfterScroll, true, JSON.stringify(state));
      assert.equal(state.openAfterRate, true, JSON.stringify(state));
    }else if (!state.supported){
      assert.equal(state.unsupportedControlsDisabled, true, JSON.stringify(state));
    }else{
      assert.equal(state.unsupportedControlsDisabled, false, JSON.stringify(state));
    }
  });

  await run('invalid saved filter fallback', async () => {
    await cdp.evaluate(() => localStorage.setItem('news-filter', 'not-a-category'));
    await reload();
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 20, 'Invalid saved filter hid all cards.');
    assert.equal(await cdp.evaluate(() => localStorage.getItem('news-filter')), 'all');
  });

  await run('slow connection enables and clears low-data adaptation', async () => {
    const state = await cdp.evaluate(() => {
      const hadOwnConnection = Object.hasOwn(navigator, 'connection');
      const originalConnection = navigator.connection;

      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: true, effectiveType: '2g' }
      });
      window.dispatchEvent(new Event('online'));

      const constrained = {
        lowData: document.body.classList.contains('a11y-low-data'),
        reduced: document.body.classList.contains('reduce-motion'),
        heroHidden: getComputedStyle(document.querySelector('.hero-media')).display === 'none',
        simplified: document.body.classList.contains('a11y-simplified-layout')
      };

      Object.defineProperty(navigator, 'connection', {
        configurable: true,
        value: { saveData: false, effectiveType: '4g' }
      });
      window.dispatchEvent(new Event('online'));
      const cleared = !document.body.classList.contains('a11y-low-data');

      if (hadOwnConnection){
        Object.defineProperty(navigator, 'connection', {
          configurable: true,
          value: originalConnection
        });
      }else{
        delete navigator.connection;
      }
      window.dispatchEvent(new Event('online'));

      return { constrained, cleared };
    });

    assert.deepEqual(state, {
      constrained: {
        lowData: true,
        reduced: true,
        heroHidden: true,
        simplified: true
      },
      cleared: true
    });
  });

  await run('system accessibility preferences and manual priority', async () => {
    await cdp.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-color-scheme', value: 'dark' },
        { name: 'prefers-reduced-motion', value: 'reduce' }
      ]
    });
    await waitFor(
      () => document.body.classList.contains('theme-dark') && document.body.classList.contains('reduce-motion'),
      'System preferences were not applied.'
    );

    const manualPriority = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const sepia = document.querySelector('input[name="theme"][value="sepia"]');
      sepia.checked = true;
      sepia.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        sepia: document.body.classList.contains('theme-sepia'),
        dark: document.body.classList.contains('theme-dark'),
        reduced: document.body.classList.contains('reduce-motion')
      };
    });
    assert.deepEqual(manualPriority, { sepia: true, dark: false, reduced: true });

    await cdp.evaluate(() => {
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
    });
    await waitFor(() => document.body.classList.contains('theme-dark'), 'Reset did not resume system theme adaptation.');

    await cdp.send('Emulation.setEmulatedMedia', { media: 'screen', features: [] });
    await waitFor(
      () => document.body.classList.contains('theme-default') && !document.body.classList.contains('reduce-motion'),
      'Clearing system preferences did not restore defaults.'
    );
  });

  await run('mobile resize does not fake browser zoom', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await delay(350);
    assert.equal(await cdp.evaluate(() => document.body.dataset.zoomAssist), '0');
    assert.equal(await cdp.evaluate(() => document.body.dataset.targetLevel), '0');
    await tapSelector('#menu-toggle');
    assert.equal(await cdp.evaluate(() => document.getElementById('mobile-menu').hidden), false);
    const focusLeaveState = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').focus();
      return document.getElementById('mobile-menu').hidden;
    });
    assert.equal(focusLeaveState, true, 'Mobile disclosure trapped focus instead of closing.');
    await tapSelector('#menu-toggle');
    const escapeState = await cdp.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        hidden: document.getElementById('mobile-menu').hidden,
        focusReturned: document.activeElement === document.getElementById('menu-toggle')
      };
    });
    assert.deepEqual(escapeState, { hidden: true, focusReturned: true });
    await tapSelector('#menu-toggle');
    await tapSelector('#mobile-menu [data-filter="sport"]');
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 4, 'Mobile menu filter did not render four cards.');
    assert.equal(await cdp.evaluate(() => document.getElementById('mobile-menu').hidden), true);
    assert.equal(
      await cdp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true
    );
    await cdp.evaluate(() => document.getElementById('clear-filters').click());
  });

  await run('real touch controls and outside menu close work', async () => {
    await tapSelector('#menu-toggle');
    assert.equal(await cdp.evaluate(() => document.getElementById('mobile-menu').hidden), false, 'Touch did not open mobile menu.');
    await tapSelector('#a11y-toggle');
    assert.equal(await cdp.evaluate(() => document.getElementById('mobile-menu').hidden), true, 'Opening accessibility panel did not close mobile menu.');
    assert.equal(await cdp.evaluate(() => document.getElementById('a11y-panel').hidden), false, 'Touch did not open accessibility panel.');
    await tapSelector('[data-preset="reading"]');
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('a11y-reading-mode')), true, 'Touch did not apply reading preset.');
    await tapSelector('#a11y-close2');

    await cdp.evaluate(() => {
      const trigger = document.querySelector('[data-open-news]');
      trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await delay(250);
    await tapSelector('[data-open-news]');
    assert.equal(await cdp.evaluate(() => document.getElementById('news-dialog').hidden), false, 'Touch did not open news dialog.');
    await cdp.evaluate(() => {
      const paragraph = document.querySelector('#news-dialog-content p');
      paragraph.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await delay(180);
    await tapSelector('#news-dialog-content p');
    assert.equal(await cdp.evaluate(() => !!document.querySelector('#news-dialog-content .a11y-reading-current')), true, 'Touch did not select the current reading paragraph.');
    await tapSelector('#news-dialog-close');

    const overlayState = await cdp.evaluate(() => ({
      toastPointerEvents: getComputedStyle(document.getElementById('ai-indicator')).pointerEvents,
      dialogClosed: document.getElementById('news-dialog').hidden,
      panelClosed: document.getElementById('a11y-panel').hidden
    }));
    assert.deepEqual(overlayState, { toastPointerEvents: 'none', dialogClosed: true, panelClosed: true });

    await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      window.scrollTo(0, 0);
    });
  });

  await run('mobile touch misses and swipes adapt without false repeats', async () => {
    const missPoint = await cdp.evaluate(() => {
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      return { x: rect.left - 7, y: rect.top + (rect.height / 2) };
    });
    await tapPoint(missPoint.x, missPoint.y);
    await tapPoint(missPoint.x, missPoint.y);
    await tapPoint(missPoint.x, missPoint.y);
    assert.equal(await cdp.evaluate(() => document.body.dataset.targetLevel), '1');

    await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      window.scrollTo(0, 0);
    });
    await swipe({ x: 195, y: 720 }, { x: 195, y: 260 });
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('reduce-motion')), false);
    await delay(240);
    await swipe({ x: 195, y: 720 }, { x: 195, y: 260 });
    await delay(240);
    await swipe({ x: 195, y: 720 }, { x: 195, y: 260 });
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('reduce-motion')), false);
    for (let index = 0; index < 3; index += 1){
      await delay(240);
      await swipe({ x: 195, y: 720 }, { x: 195, y: 260 });
      if (await cdp.evaluate(() => document.body.classList.contains('reduce-motion'))) break;
    }
    await waitFor(() => document.body.classList.contains('reduce-motion'), 'Repeated deliberate mobile swipes did not enable motion reduction.');

    await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
      window.scrollTo(0, 0);
    });
  });

  await run('mobile sepia controls remain visible and panel targets are touch-sized', async () => {
    const state = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const sepia = document.querySelector('input[name="theme"][value="sepia"]');
      sepia.checked = true;
      sepia.dispatchEvent(new Event('change', { bubbles: true }));
      const label = document.querySelector('#a11y-panel fieldset label').getBoundingClientRect();
      const action = document.getElementById('a11y-close2').getBoundingClientRect();
      document.getElementById('a11y-close2').click();
      const burgerStyle = getComputedStyle(document.getElementById('menu-toggle'));
      const clearStyle = getComputedStyle(document.getElementById('clear-filters'));
      return {
        labelHeight: label.height,
        actionHeight: action.height,
        burgerBackground: burgerStyle.backgroundColor,
        burgerForeground: burgerStyle.getPropertyValue('--fg').trim(),
        clearBackground: clearStyle.backgroundColor,
        surface: burgerStyle.getPropertyValue('--surface').trim()
      };
    });
    assert.ok(state.labelHeight >= 44);
    assert.ok(state.actionHeight >= 48);
    assert.notEqual(state.burgerBackground, 'rgba(15, 23, 42, 0.6)');
    assert.notEqual(state.clearBackground, 'rgba(15, 23, 42, 0.6)');

    await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-reset').click();
      document.getElementById('a11y-close2').click();
    });
  });

  await run('mobile reading mode activates after meaningful touch reading', async () => {
    await cdp.evaluate(() => {
      if (!document.getElementById('news-dialog').hidden) document.getElementById('news-dialog-close').click();
      if (!document.getElementById('a11y-panel').hidden) document.getElementById('a11y-close2').click();
    });
    await waitFor(
      () => !document.querySelector('#cards .card[inert]'),
      'News cards did not finish their focus-safe entrance animation.'
    );
    await cdp.evaluate(() => {
      const trigger = document.querySelector('[data-open-news]');
      trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await delay(250);
    await waitFor(() => {
      const trigger = document.querySelector('[data-open-news]');
      const rect = trigger.getBoundingClientRect();
      const centerX = rect.left + (rect.width / 2);
      const centerY = rect.top + (rect.height / 2);
      return document.elementFromPoint(centerX, centerY)?.closest?.('[data-open-news]') === trigger;
    }, 'Mobile news trigger did not become tappable.');
    await tapSelector('[data-open-news]');
    assert.equal(await cdp.evaluate(() => document.getElementById('news-dialog').hidden), false, 'Touch did not open article for mobile reading test.');
    await delay(5100);
    const swipeArea = await cdp.evaluate(() => {
      const rect = document.querySelector('.news-dialog-body').getBoundingClientRect();
      return {
        from: { x: rect.left + (rect.width / 2), y: rect.bottom - 35 },
        to: { x: rect.left + (rect.width / 2), y: rect.top + 70 }
      };
    });
    await swipe(swipeArea.from, swipeArea.to, 420, 8);
    await delay(500);
    const state = await cdp.evaluate(() => {
      const body = document.querySelector('.news-dialog-body');
      return {
        readingMode: document.body.classList.contains('a11y-reading-mode'),
        progress: body.scrollTop / Math.max(1, body.scrollHeight - body.clientHeight),
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
        clientHeight: body.clientHeight,
        dialogOpen: !document.getElementById('news-dialog').hidden,
        ruler: document.body.classList.contains('a11y-reading-ruler'),
        currentParagraph: !!document.querySelector('#news-dialog-content .a11y-reading-current')
      };
    });
    assert.equal(state.readingMode, true, JSON.stringify(state));
    assert.deepEqual({
      ruler: state.ruler,
      currentParagraph: state.currentParagraph
    }, {
      ruler: true,
      currentParagraph: true
    });
    await tapSelector('#news-dialog-close');
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('a11y-reading-mode')), false);
  });

  await run('mobile pinch zoom adapts the visual viewport', async () => {
    const baseFontSize = await cdp.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
    await waitFor(() => document.body.dataset.zoomAssist === '2', 'Mobile page-scale zoom did not enable level-two assistance.');
    await cdp.evaluate(() => document.getElementById('a11y-toggle').click());
    const state = await cdp.evaluate(() => {
      const panel = document.getElementById('a11y-panel');
      const rect = panel.getBoundingClientRect();
      return {
        panelOpen: !panel.hidden,
        panelFitsVisualWidth: rect.width <= window.visualViewport.width + 1,
        panelNoHorizontalOverflow: panel.scrollWidth <= panel.clientWidth + 1,
        rootFontSize: getComputedStyle(document.documentElement).fontSize,
        targetLevel: document.body.dataset.targetLevel,
        scale: window.visualViewport.scale
      };
    });
    await cdp.evaluate(() => document.getElementById('a11y-close2').click());

    const flowState = await cdp.evaluate(() => {
      const main = document.getElementById('main').getBoundingClientRect();
      document.querySelector('[data-open-news]').click();
      const dialog = document.getElementById('news-dialog').getBoundingClientRect();
      const state = {
        mainFitsVisualWidth: main.width <= window.visualViewport.width + 1,
        mainStartsAtVisualLeft: Math.abs(main.left - window.visualViewport.offsetLeft) <= 1,
        dialogFitsVisualWidth: dialog.width <= window.visualViewport.width + 1,
        dialogInsideVisualViewport:
          dialog.left >= window.visualViewport.offsetLeft - 1 &&
          dialog.right <= window.visualViewport.offsetLeft + window.visualViewport.width + 1
      };
      document.getElementById('news-dialog-close').click();
      return state;
    });

    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
    await waitFor(() => document.body.dataset.zoomAssist === '0', 'Mobile page-scale reset did not clear zoom assistance.');
    assert.equal(state.panelOpen, true, JSON.stringify(state));
    assert.equal(state.panelFitsVisualWidth, true, JSON.stringify(state));
    assert.equal(state.panelNoHorizontalOverflow, true, JSON.stringify(state));
    assert.equal(state.rootFontSize, baseFontSize, JSON.stringify(state));
    assert.equal(state.targetLevel, '0', JSON.stringify(state));
    assert.ok(state.scale >= 1.45, JSON.stringify(state));
    assert.deepEqual(flowState, {
      mainFitsVisualWidth: true,
      mainStartsAtVisualLeft: true,
      dialogFitsVisualWidth: true,
      dialogInsideVisualViewport: true
    }, JSON.stringify(flowState));
  });

  await run('mobile landscape keeps core controls reachable', async () => {
    await cdp.evaluate(() => {
      const panel = document.getElementById('a11y-panel');
      const dialog = document.getElementById('news-dialog');
      if (panel && !panel.hidden) document.getElementById('a11y-close2').click();
      if (dialog && !dialog.hidden) document.getElementById('news-dialog-close').click();
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 844,
      height: 390,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { angle: 90, type: 'landscapePrimary' }
    });
    await delay(300);
    await cdp.evaluate(() => document.getElementById('a11y-toggle').click());
    const panelState = await cdp.evaluate(() => {
      const panel = document.getElementById('a11y-panel');
      const actions = panel.querySelector('.panel-actions').getBoundingClientRect();
      return {
        open: !panel.hidden,
        actionsVisible: actions.top >= -1 && actions.bottom <= window.innerHeight + 1,
        noHorizontalOverflow: panel.scrollWidth <= panel.clientWidth + 1
      };
    });
    if (panelState.open) await cdp.evaluate(() => document.getElementById('a11y-close2').click());
    assert.deepEqual(panelState, { open: true, actionsVisible: true, noHorizontalOverflow: true }, JSON.stringify(panelState));

    await cdp.evaluate(() => {
      const trigger = document.querySelector('[data-open-news]');
      trigger.scrollIntoView({ block: 'center' });
    });
    await delay(100);
    await cdp.evaluate(() => document.querySelector('[data-open-news]').click());
    const dialogState = await cdp.evaluate(() => {
      const dialog = document.getElementById('news-dialog');
      const close = document.getElementById('news-dialog-close').getBoundingClientRect();
      return {
        open: !dialog.hidden,
        closeVisible: close.top >= -1 && close.bottom <= window.innerHeight + 1,
        bodyScrollable: document.querySelector('.news-dialog-body').scrollHeight > document.querySelector('.news-dialog-body').clientHeight
      };
    });
    if (dialogState.open) await cdp.evaluate(() => document.getElementById('news-dialog-close').click());
    assert.deepEqual(dialogState, { open: true, closeVisible: true, bodyScrollable: true }, JSON.stringify(dialogState));

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { angle: 0, type: 'portraitPrimary' }
    });
    await delay(250);
  });

  await run('synthetic zoom gestures do not fake browser zoom', async () => {
    await cdp.evaluate(() => {
      window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100 }));
      window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100 }));
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '+' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '-' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '0' }));
    });
    await delay(500);
    const state = await cdp.evaluate(() => ({
      zoomAssist: document.body.dataset.zoomAssist,
      oneColumn: document.body.classList.contains('a11y-one-column'),
      visualScale: window.visualViewport?.scale || 1
    }));
    assert.equal(state.zoomAssist, '0', JSON.stringify(state));
    assert.equal(state.oneColumn, false, JSON.stringify(state));
    assert.ok(state.visualScale <= 1.01, JSON.stringify(state));
  });

  await run('very narrow mobile panel and news dialog stay usable', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320,
      height: 568,
      deviceScaleFactor: 1,
      mobile: true
    });
    await delay(250);
    const state = await cdp.evaluate(() => {
      document.getElementById('a11y-toggle').click();
      const panel = document.getElementById('a11y-panel');
      const panelRect = panel.getBoundingClientRect();
      const actionsRect = panel.querySelector('.panel-actions').getBoundingClientRect();
      const panelState = {
        insideViewport: panelRect.left >= -1 && panelRect.right <= window.innerWidth + 1,
        actionsVisible: actionsRect.top >= -1 && actionsRect.bottom <= window.innerHeight + 1,
        noHorizontalOverflow: panel.scrollWidth <= panel.clientWidth + 1
      };
      document.getElementById('a11y-close2').click();

      document.querySelector('[data-open-news]').click();
      const dialog = document.getElementById('news-dialog');
      const dialogRect = dialog.getBoundingClientRect();
      const dialogState = {
        insideViewport: dialogRect.left >= -1 && dialogRect.right <= window.innerWidth + 1,
        heightFits: dialogRect.height <= window.innerHeight + 1,
        noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1
      };
      document.getElementById('news-dialog-close').click();

      return {
        panelState,
        dialogState,
        pageNoHorizontalOverflow: document.documentElement.scrollWidth <= window.innerWidth + 1
      };
    });
    assert.deepEqual(state, {
      panelState: { insideViewport: true, actionsVisible: true, noHorizontalOverflow: true },
      dialogState: { insideViewport: true, heightFits: true, noHorizontalOverflow: true },
      pageNoHorizontalOverflow: true
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
  });

  await run('typing temporarily pauses motion', async () => {
    const preActive = await cdp.evaluate(() => {
      document.activeElement?.blur?.();
      document.dispatchEvent(new CustomEvent('a11y:reset-all'));
      return document.activeElement?.id || document.activeElement?.tagName;
    });
    assert.notEqual(preActive, 'news-search');
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('reduce-motion')), false);
    const focusState = await cdp.evaluate(() => {
      const search = document.getElementById('news-search');
      search.focus();
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        active: document.activeElement?.id,
        mode: document.body.dataset.aiMode,
        paused: document.body.classList.contains('a11y-task-focus')
      };
    });
    assert.equal(focusState.paused, true, JSON.stringify(focusState));
    await cdp.evaluate(() => {
      const toggle = document.getElementById('a11y-toggle');
      toggle.focus();
      toggle.dispatchEvent(new FocusEvent('focus'));
    });
    await delay(120);
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('a11y-task-focus')), false);
  });

  await run('gentle AI mode ignores behavioral guesses', async () => {
    const state = await cdp.evaluate(() => {
      const mode = document.getElementById('ai-mode');
      mode.value = 'gentle';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      const initialTarget = document.body.dataset.targetLevel;
      const rect = document.getElementById('a11y-toggle').getBoundingClientRect();
      const miss = {
        bubbles: true,
        isPrimary: true,
        button: 0,
        clientX: rect.left - 6,
        clientY: rect.top + (rect.height / 2)
      };
      for (let index = 0; index < 8; index++) document.dispatchEvent(new PointerEvent('pointerup', miss));

      document.querySelector('[data-open-news]').click();
      const content = document.getElementById('news-dialog-content');
      const range = document.createRange();
      range.selectNodeContents(content);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));

      const result = {
        initialTarget,
        targetAfterMisses: document.body.dataset.targetLevel,
        readingMode: document.body.classList.contains('a11y-reading-mode')
      };
      document.getElementById('news-dialog-close').click();
      mode.value = 'auto';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      return result;
    });
    assert.equal(state.targetAfterMisses, state.initialTarget);
    assert.equal(state.readingMode, false);
  });

  await run('AI off disables scroll adaptation', async () => {
    const state = await cdp.evaluate(() => {
      const mode = document.getElementById('ai-mode');
      mode.value = 'off';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      const search = document.getElementById('news-search');
      search.focus();
      search.dispatchEvent(new Event('input', { bubbles: true }));
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 500 }));
      return {
        motionPaused: document.body.classList.contains('motion-paused'),
        taskPaused: document.body.classList.contains('a11y-task-focus')
      };
    });
    assert.deepEqual(state, { motionPaused: false, taskPaused: false });
  });

  await run('runtime errors', async () => {
    assert.deepEqual(pageErrors, []);
  });
}finally{
  try{ cdp?.socket.close(); }catch{}
  try{ browser?.kill(); }catch{}
  try{ server?.close(); }catch{}
  try{ rmSync(profileDir, { recursive: true, force: true }); }catch{}
}

if (failures.length){
  console.error(`\n${failures.length} smoke test(s) failed.`);
  process.exitCode = 1;
}else{
  console.log('\nAll smoke tests passed.');
}
