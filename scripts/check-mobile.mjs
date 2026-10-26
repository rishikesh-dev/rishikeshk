#!/usr/bin/env node
// Checks the built site in a real 390 CSS-pixel viewport using Firefox headless
// and Marionette. The site is loaded in a same-origin iframe so media queries
// see exactly 390px, which headless Firefox's own minimum window width prevents.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { connect as netConnect } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const wrapper = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#888}
  iframe{display:block;width:390px;height:2600px;border:0;background:#E9DBBE}
</style></head>
<body><iframe id="site" src="/" title="portfolio"></iframe></body></html>`;

const server = createServer(async (request, response) => {
  if (request.url === '/__mobile-test.html') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(wrapper);
    return;
  }
  let pathname = decodeURIComponent((request.url ?? '/').split('?')[0]);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = join(dist, pathname);
  try {
    const data = await readFile(file);
    response.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
    response.end(data);
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), 'portfolio-firefox-'));
writeFileSync(join(profile, 'user.js'), 'user_pref("browser.shell.checkDefaultBrowser", false);\n');
const firefox = spawn(
  'firefox',
  ['--headless', '--marionette', '--no-remote', '--width', '900', '--height', '900', '--profile', profile],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
firefox.stderr.on('data', (chunk) => {
  const text = String(chunk);
  if (!/channel error|RenderCompositor|Running in headless mode/i.test(text)) process.stderr.write(text);
});

let socket;
let buffer = Buffer.alloc(0);
const queued = [];
const waiting = [];
let nextId = 1;

function connect() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    const attempt = () => {
      const connection = netConnect({ host: '127.0.0.1', port: 2828 });
      connection.once('connect', () => resolve(connection));
      connection.once('error', () => {
        connection.destroy();
        if (Date.now() > deadline) reject(new Error('Marionette did not start'));
        else setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

function receive() {
  return new Promise((resolve) => {
    if (queued.length) resolve(queued.shift());
    else waiting.push(resolve);
  });
}

function send(name, params = {}) {
  const json = JSON.stringify([0, nextId, name, params]);
  nextId += 1;
  socket.write(`${Buffer.byteLength(json)}:${json}`);
  return receive();
}

try {
  socket = await connect();
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const colon = buffer.indexOf(58);
      if (colon < 0) break;
      const length = Number(buffer.subarray(0, colon).toString());
      if (!Number.isFinite(length) || buffer.length < colon + 1 + length) break;
      const payload = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
      buffer = buffer.subarray(colon + 1 + length);
      if (waiting.length) waiting.shift()(payload);
      else queued.push(payload);
    }
  });
  await receive();
  const session = await send('WebDriver:NewSession', { capabilities: { alwaysMatch: {} } });
  assert.equal(session[2], null, JSON.stringify(session[2]));

  const navigation = await send('WebDriver:Navigate', { url: `${origin}/__mobile-test.html` });
  assert.equal(navigation[2], null, JSON.stringify(navigation[2]));

  const script = `
    const frame = document.getElementById('site');
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || doc.readyState !== 'complete' || !doc.getElementById('menu')) {
      return { ready: false };
    }
    const viewport = doc.documentElement.clientWidth;
    const overflow = [...doc.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > viewport + 1;
      })
      .map((element) => element.tagName.toLowerCase() + '.' + String(element.className || ''))
      .slice(0, 12);
    const menu = doc.getElementById('menu');
    const links = doc.getElementById('links');
    const before = win.getComputedStyle(links).display;
    menu.click();
    return {
      ready: true,
      innerWidth: win.innerWidth,
      viewport,
      scrollWidth: doc.documentElement.scrollWidth,
      bodyScrollWidth: doc.body.scrollWidth,
      overflow,
      menuVisible: win.getComputedStyle(menu).display !== 'none',
      linksBefore: before,
      linksAfter: win.getComputedStyle(links).display,
      navOpen: doc.getElementById('nav').classList.contains('open'),
      expanded: menu.getAttribute('aria-expanded'),
    };
  `;

  let result = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await send('WebDriver:ExecuteScript', { script, args: [] });
    assert.equal(response[2], null, JSON.stringify(response[2]));
    if (response[3]?.value?.ready) {
      result = response[3].value;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(result, 'iframe did not finish loading');
  assert.equal(result.innerWidth, 390, `expected a 390px viewport, got ${result.innerWidth}`);
  assert.ok(result.scrollWidth <= result.viewport + 1, `horizontal overflow: ${result.scrollWidth} > ${result.viewport}`);
  assert.ok(result.bodyScrollWidth <= result.viewport + 1, `body overflow: ${result.bodyScrollWidth} > ${result.viewport}`);
  assert.deepEqual(result.overflow, [], `elements past the right edge: ${result.overflow.join(', ')}`);
  assert.equal(result.menuVisible, true, 'mobile menu button is hidden');
  assert.equal(result.linksBefore, 'none', 'desktop navigation is visible at 390px');
  assert.equal(result.linksAfter, 'flex', 'mobile navigation did not open');
  assert.equal(result.navOpen, true, 'mobile nav did not get its open class');
  assert.equal(result.expanded, 'true', 'menu aria-expanded was not updated');

  console.log('  ✓ 390px viewport has no horizontal overflow');
  console.log('  ✓ mobile menu opens and updates aria-expanded');
  console.log(JSON.stringify(result));
} finally {
  try {
    await send('WebDriver:DeleteSession');
  } catch {}
  socket?.end();
  firefox.kill('SIGKILL');
  await new Promise((resolve) => server.close(resolve));
}
