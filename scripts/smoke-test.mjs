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
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml'
  };

  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
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
      title: document.title,
      zoomAssist: document.body.dataset.zoomAssist
    }));
    assert.equal(state.cards, 20);
    assert.deepEqual(state.duplicates, []);
    assert.match(state.title, /NewsPortal/);
    assert.equal(state.zoomAssist, '0');
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

  await run('news dialog', async () => {
    const state = await cdp.evaluate(() => {
      document.querySelector('[data-open-news]').click();
      return {
        bodyLocked: document.body.classList.contains('dialog-open'),
        dialogOpen: !document.getElementById('news-dialog').hidden,
        backdropOpen: !document.getElementById('backdrop').hidden
      };
    });
    assert.deepEqual(state, { bodyLocked: true, dialogOpen: true, backdropOpen: true });
    await cdp.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(await cdp.evaluate(() => document.getElementById('news-dialog').hidden), true);
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
    console.log(`INFO mini audit: ${summary.text.split(/\s+/).slice(0, 4).join(' ')}`);
    await cdp.evaluate(() => document.getElementById('a11y-close2').click());
  });

  await run('subscription validation', async () => {
    const invalid = await cdp.evaluate(() => {
      const email = document.getElementById('email');
      const password = document.getElementById('password');
      email.value = 'bad';
      password.value = '123';
      document.getElementById('subscribe-form').requestSubmit();
      return {
        emailInvalid: email.getAttribute('aria-invalid'),
        emailError: document.getElementById('email-error').textContent
      };
    });
    assert.equal(invalid.emailInvalid, 'true');
    assert.ok(invalid.emailError);

    const validMessage = await cdp.evaluate(() => {
      const email = document.getElementById('email');
      const password = document.getElementById('password');
      email.value = 'demo@example.com';
      password.value = '123456';
      document.getElementById('subscribe-form').requestSubmit();
      return document.getElementById('form-message').textContent;
    });
    assert.match(validMessage, /\u0414\u044f\u043a\u0443\u0454\u043c\u043e/);
  });

  await run('invalid saved filter fallback', async () => {
    await cdp.evaluate(() => localStorage.setItem('news-filter', 'not-a-category'));
    await reload();
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 20, 'Invalid saved filter hid all cards.');
    assert.equal(await cdp.evaluate(() => localStorage.getItem('news-filter')), 'all');
  });

  await run('mobile resize does not fake browser zoom', async () => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await delay(350);
    assert.equal(await cdp.evaluate(() => document.body.dataset.zoomAssist), '0');
    await cdp.evaluate(() => document.getElementById('menu-toggle').click());
    assert.equal(await cdp.evaluate(() => document.getElementById('mobile-menu').hidden), false);
    await cdp.evaluate(() => document.querySelector('#mobile-menu [data-filter="sport"]').click());
    await waitFor(() => document.querySelectorAll('[data-news-item]').length === 4, 'Mobile menu filter did not render four cards.');
    assert.equal(await cdp.evaluate(() => document.getElementById('mobile-menu').hidden), true);
    assert.equal(
      await cdp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      true
    );
  });

  await run('browser zoom gesture still adapts layout', async () => {
    await cdp.evaluate(() => window.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100 })));
    await waitFor(() => document.body.dataset.zoomAssist === '1', 'Zoom gesture did not enable level-one assistance.');
    await cdp.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: '0' })));
    await waitFor(() => document.body.dataset.zoomAssist === '0', 'Zoom reset did not restore the standard layout.');
  });

  await run('AI off disables scroll adaptation', async () => {
    await cdp.evaluate(() => {
      const mode = document.getElementById('ai-mode');
      mode.value = 'off';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: 500 }));
    });
    assert.equal(await cdp.evaluate(() => document.body.classList.contains('motion-paused')), false);
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
