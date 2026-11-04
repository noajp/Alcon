#!/usr/bin/env node
// Alcon runner — lends your own computer's browser to your Alcon AI runs.
//
//   cd sdk/node/runner && npm install
//   ALCON_RELAY=https://<project>.supabase.co/functions/v1/asset-relay \
//   ALCON_SPACE=<Space id> node alcon-runner.mjs
//
// It announces itself to the Space through the asset relay (kind ai_agent,
// capability "browser"). Accept it in Alcon › Settings › Customize ›
// Connected assets; from then on, AI runs started by the person who accepted
// it may ask it to open, read and click pages. It asks the relay for work and
// answers; nothing on this computer is reachable from outside.
//
// The browser is Google Chrome with a profile of its own (~/.alcon/browser),
// visible on screen so you can watch what the AI does. It shares no cookies
// or logins with your everyday Chrome; sign in there only to sites you want
// the AI to see as you. Read-only by default: a page navigation that sends a
// form (anything but GET) is stopped. Start with --allow-writes to lift that.
//
// Options (environment or flags):
//   ALCON_RELAY / --relay       the relay URL                       required
//   ALCON_SPACE / --space       the Space id                        first run only
//   ALCON_NAME  / --name        the runner's name (default: "<host>'s browser")
//   --headless                  no visible window
//   --allow-writes              let pages submit forms
//   --browser chromium          use Playwright's bundled Chromium instead of Google Chrome
//   --isolated --shell          this runner is a disposable VM (e.g. a Vercel Sandbox):
//                               it also runs shell commands and reads/writes files.
//                               Never pass these on a computer someone works on.
//   ALCON_HOME                  where token and profile live (default ~/.alcon)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname, platform } from 'node:os';
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const RELAY = (opt('relay') ?? process.env.ALCON_RELAY ?? '').replace(/\/+$/, '');
const SPACE = opt('space') ?? process.env.ALCON_SPACE ?? '';
const NAME = opt('name') ?? process.env.ALCON_NAME ?? `${hostname().split('.')[0]}'s browser`;
const HOME = process.env.ALCON_HOME ?? join(homedir(), '.alcon');
const STATE = join(HOME, 'runner.json');
const PROFILE = join(HOME, 'browser');
const HEADLESS = flag('headless');
const BROWSER = opt('browser') ?? 'chrome';
const ISOLATED = flag('isolated');
const SHELL = ISOLATED && flag('shell');
/** Where shell commands run and relative file paths point. */
const WORKDIR = process.env.ALCON_WORKDIR ?? join(HOME, 'work');
const ALLOW_WRITES = flag('allow-writes');
const VERSION = '0.1.0';

const log = (...m) => console.error(`[alcon-runner ${new Date().toLocaleTimeString()}]`, ...m);
if (!RELAY) { log('ALCON_RELAY (or --relay) is required'); process.exit(1); }

const manifest = {
  runner: 'alcon-runner', version: VERSION, capabilities: SHELL ? ['browser', 'shell', 'files'] : ['browser'],
  host: hostname(), platform: platform(), read_only: !ALLOW_WRITES, headless: HEADLESS, isolated: ISOLATED,
};

function loadState() {
  try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return null; }
}
function saveState(s) {
  mkdirSync(HOME, { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

async function relay(path, body, token) {
  const res = await fetch(`${RELAY}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(json?.error?.message ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function announce() {
  const state = loadState();
  if (state?.token) {
    const r = await relay('/hello', { token: state.token, name: NAME, kind: 'ai_agent', manifest });
    log(`Connected as "${NAME}" (${r.status}).`);
    if (r.status !== 'active') log('Waiting to be accepted in Alcon › Settings › Customize › Connected assets.');
    return state.token;
  }
  if (!SPACE) { log('First run: ALCON_SPACE (or --space) is required.'); process.exit(1); }
  const r = await relay('/hello', { space: SPACE, name: NAME, kind: 'ai_agent', manifest });
  saveState({ token: r.token, asset_id: r.asset_id, space: SPACE });
  log(`Announced "${NAME}" to the Space. Accept it in Alcon › Settings › Customize › Connected assets.`);
  return r.token;
}

// ── The browser ──────────────────────────────────────────────────────────────

let context;
let page;

async function browser() {
  if (page && !page.isClosed()) return page;
  if (!context) {
    mkdirSync(PROFILE, { recursive: true });
    context = await chromium.launchPersistentContext(PROFILE, {
      ...(BROWSER === 'chrome' ? { channel: 'chrome' } : {}), headless: HEADLESS, viewport: { width: 1280, height: 900 }, locale: 'ja-JP',
    });
    if (!ALLOW_WRITES) {
      // Read-only: a navigation that would send a form is stopped. Pages
      // still load and run their own scripts (searches that fetch data work).
      await context.route('**/*', (route) => {
        const req = route.request();
        if (req.isNavigationRequest() && req.method() !== 'GET' && req.method() !== 'HEAD') {
          // Only the page's own submissions are worth a line; trackers in
          // hidden frames are stopped quietly.
          if (req.frame() === req.frame().page()?.mainFrame()) log(`Stopped a ${req.method()} to ${req.url()} (read-only)`);
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
    }
    context.on('close', () => { context = undefined; page = undefined; });
  }
  page = context.pages()[0] ?? await context.newPage();
  return page;
}

async function settle(p) {
  await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await p.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
}

/** The page as the agent reads it: where it is, its text, its links. */
async function snapshot(p, note) {
  const data = await p.evaluate(() => {
    const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
    const text = (document.body?.innerText ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const seen = new Set();
    const links = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const label = clean(a.innerText || a.getAttribute('aria-label') || a.title);
      const href = a.href;
      if (!label || !href.startsWith('http') || seen.has(href)) continue;
      const r = a.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      seen.add(href);
      links.push({ text: label.slice(0, 80), href });
      if (links.length >= 150) break;
    }
    return { title: document.title, text: text.slice(0, 20000), links };
  });
  return { url: p.url(), ...data, ...(note ? { note } : {}) };
}

async function clickText(p, text) {
  const candidates = [
    p.getByRole('link', { name: text }), p.getByRole('button', { name: text }), p.getByRole('tab', { name: text }),
    p.getByText(text, { exact: true }), p.getByText(text),
  ];
  for (const c of candidates) {
    const el = c.first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 8000 });
      return true;
    }
  }
  return false;
}

async function fieldFor(p, field) {
  const candidates = [p.getByLabel(field), p.getByPlaceholder(field), p.getByRole('textbox', { name: field }), p.getByRole('searchbox', { name: field }), p.getByRole('combobox', { name: field })];
  for (const c of candidates) {
    const el = c.first();
    if (await el.count() > 0 && await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

// ── The machine (only on an isolated runner) ─────────────────────────────────

const SHELL_TIMEOUT_MS = 40_000;
const MAX_OUT = 20_000;

/** Runs a bash command in the work directory; long work belongs in the background. */
function runShell(command, timeoutS) {
  return new Promise((done) => {
    const limit = Math.min(Math.max(Number(timeoutS) || 30, 1) * 1000, SHELL_TIMEOUT_MS);
    const child = spawn('bash', ['-lc', String(command)], { cwd: WORKDIR, env: process.env });
    let out = '', err = '';
    child.stdout.on('data', (d) => { if (out.length < MAX_OUT) out += d; });
    child.stderr.on('data', (d) => { if (err.length < MAX_OUT) err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); err += `\n(stopped after ${limit / 1000}s; run long work in the background with nohup … & and check on it)`; }, limit);
    child.on('close', (code) => { clearTimeout(timer); done({ exit_code: code, stdout: out.slice(0, MAX_OUT), stderr: err.slice(0, MAX_OUT), cwd: WORKDIR }); });
  });
}

const fileAt = (p) => resolve(WORKDIR, String(p ?? ''));

const MACHINE = {
  async shell({ command, timeout_s }) {
    await mkdir(WORKDIR, { recursive: true });
    return runShell(command, timeout_s);
  },
  async write_file({ path, content }) {
    const target = fileAt(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, String(content ?? ''));
    return { path: target, bytes: Buffer.byteLength(String(content ?? '')) };
  },
  async read_file({ path }) {
    const target = fileAt(path);
    const text = await readFile(target, 'utf8');
    return { path: target, content: text.slice(0, 60_000), truncated: text.length > 60_000 };
  },
};

const TOOLS = {
  ...(SHELL ? MACHINE : {}),
  async open({ url }) {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('url must start with http(s)://');
    const p = await browser();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(p);
    return snapshot(p);
  },
  async read() {
    return snapshot(await browser());
  },
  async click({ text }) {
    const p = await browser();
    if (!(await clickText(p, String(text ?? '')))) return snapshot(p, `「${text}」が見つかりませんでした`);
    await settle(p);
    return snapshot(p);
  },
  async type({ field, text, submit }) {
    const p = await browser();
    const el = await fieldFor(p, String(field ?? ''));
    if (!el) return snapshot(p, `入力欄「${field}」が見つかりませんでした`);
    await el.fill(String(text ?? ''));
    if (submit) { await el.press('Enter'); await settle(p); }
    return snapshot(p);
  },
  async back() {
    const p = await browser();
    await p.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await settle(p);
    return snapshot(p);
  },
};

// ── The loop ─────────────────────────────────────────────────────────────────

async function main() {
  let token = await announce();
  log(`Read-only: ${!ALLOW_WRITES}. Waiting for work…`);
  let backoff = 1000;
  while (true) {
    try {
      const { call } = await relay('/calls/next', {}, token);
      backoff = 1000;
      if (!call) continue;
      const tool = TOOLS[call.tool];
      log(`${call.tool} ${JSON.stringify(call.input).slice(0, 120)}`);
      try {
        if (!tool) throw new Error(`unknown tool: ${call.tool}`);
        const result = await tool(call.input ?? {});
        await relay(`/calls/${call.id}/result`, { ok: true, result }, token);
      } catch (e) {
        log(`  failed: ${e.message}`);
        await relay(`/calls/${call.id}/result`, { ok: false, error: e.message }, token).catch(() => {});
      }
    } catch (e) {
      if (e.status === 403) { log('This runner was revoked in Alcon. Stopping.'); process.exit(1); }
      if (e.status === 401) { log('The token is not known any more; announcing again.'); saveState({}); token = await announce(); continue; }
      log(`Relay unreachable (${e.message}); retrying.`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

process.on('SIGINT', async () => { await context?.close().catch(() => {}); process.exit(0); });
main();
