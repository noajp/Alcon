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
// One exception, by design: a sign_in call carries a credential pair the
// server released for this page's origin alone; its submit on that origin
// is let through while the fill is armed, and the pair is held in memory
// only for the fill — never logged, never written anywhere.
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
const VERSION = '0.2.0';

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
          // The one write a read-only runner lets through: a sign-in
          // submit on the credential's own origin, while a sign-in fill
          // is armed (see sign_in below). Origin-exact and time-boxed;
          // everything else is stopped as before.
          if (signInAllowance && Date.now() <= signInAllowance.until && originOfUrl(req.url()) === signInAllowance.origin) {
            return route.continue();
          }
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

/** The canonical origin of a URL (scheme://host[:port], default port
 *  dropped, host lowercased — the URL parser's own rules, which are the
 *  server's normalize rules too). Null for anything not http(s). */
const originOfUrl = (u) => {
  try {
    const x = new URL(u);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.origin : null;
  } catch { return null; }
};

/** The asset token, once announced — wall reports ride it. */
let assetToken = null;

/** A sign-in fill in progress: { origin, until } while armed. The
 *  read-only route gate lets a submit through only for this origin,
 *  only until this moment. */
let signInAllowance = null;

const wallReportedAt = new Map();

/** Tell the Space a login wall stands on this origin (an asset event —
 *  the server raises the capture ask from the runner's reports).
 *  Best-effort and throttled: a wall is one fact per origin, not one
 *  per page read. */
function reportWall(origin) {
  if (!assetToken || !origin) return;
  const last = wallReportedAt.get(origin) ?? 0;
  if (Date.now() - last < 10 * 60_000) return;
  wallReportedAt.set(origin, Date.now());
  relay('/events', { events: [{ kind: 'login_wall', summary: `ログイン画面を検出: ${origin}`, payload: { origin } }] }, assetToken)
    .catch(() => {});
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
    // A login wall: a password field a person could actually type
    // into. Reported as the page's own origin — a server-side fact
    // about where this browser stands, never anything the model said.
    let loginWall = null;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      for (const pw of document.querySelectorAll('input[type="password"]')) {
        const r = pw.getBoundingClientRect();
        const s = getComputedStyle(pw);
        if (r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && !pw.disabled) { loginWall = location.origin; break; }
      }
    }
    return { title: document.title, text: text.slice(0, 20000), links, loginWall };
  });
  const { loginWall, ...rest } = data;
  if (loginWall) reportWall(loginWall);
  return { url: p.url(), ...rest, ...(loginWall ? { login_wall: loginWall } : {}), ...(note ? { note } : {}) };
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

/** The first match of a locator a person could actually use. */
async function firstVisible(locator) {
  const n = await locator.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = locator.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

/** The page's password field: the current-password one when the page
 *  says which it is, else the (single, visible) password input. */
async function passwordField(p) {
  for (const sel of ['input[type="password"][autocomplete="current-password"]', 'input[type="password"]']) {
    const el = await firstVisible(p.locator(sel));
    if (el) return el;
  }
  return null;
}

/** The field a sign-in name goes in: the page's own username/email
 *  signals first, then the text input sharing the password's form. */
async function usernameField(p, passEl) {
  for (const sel of ['input[autocomplete="username"]', 'input[autocomplete="email"]', 'input[type="email"]']) {
    const el = await firstVisible(p.locator(sel));
    if (el) return el;
  }
  if (passEl) {
    const inForm = await firstVisible(p.locator('form').filter({ has: passEl }).locator('input[type="text"], input:not([type])'));
    if (inForm) return inForm;
  }
  return firstVisible(p.locator('input[type="text"]'));
}

/** Submit the login form: its own submit control when it has one,
 *  else Enter in the password field, which is how the form expects it. */
async function submitLogin(p, passEl) {
  const btn = await firstVisible(p.locator('form:has(input[type="password"]) :is(button[type="submit"], input[type="submit"])'));
  if (btn) { await btn.click({ timeout: 6000 }); return; }
  await passEl.press('Enter');
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
    // Whether the field is a password field, detected from the DOM:
    // the server masks the step's text on this report, so a value
    // typed into one never lands in the run's record.
    const password_field = await el.evaluate((e) => e.type === 'password' || e.autocomplete === 'current-password' || e.autocomplete === 'new-password')
      .catch(() => false);
    await el.fill(String(text ?? ''));
    if (submit) { await el.press('Enter'); await settle(p); }
    return { ...(await snapshot(p)), password_field };
  },
  /**
   * Sign in with a pair the server released for this page's origin.
   * The input is { origin, pair }: the origin the server resolved
   * from this browser's own report, and the pair, which exists in
   * this process only for this fill. Every refusal is a result, not
   * a throw, and no result, log or error ever carries the pair.
   */
  async sign_in({ origin, pair }) {
    const p = await browser();
    if (!pair || typeof pair.username !== 'string' || !pair.username || typeof pair.password !== 'string' || !pair.password) {
      return { ...(await snapshot(p)), signed_in: false, reason: 'no_pair' };
    }
    // The fill-time leg of the origin check: the page must still be
    // where the server resolved it. A moved page gets nothing typed.
    if (originOfUrl(p.url()) !== origin) {
      return { ...(await snapshot(p)), signed_in: false, reason: 'page_moved' };
    }
    const pass = await passwordField(p);
    const user = pass ? await usernameField(p, pass) : null;
    if (!pass || !user) {
      return { ...(await snapshot(p)), signed_in: false, reason: 'no_form' };
    }
    signInAllowance = { origin, until: Date.now() + 60_000 };
    try {
      await user.fill(pair.username);
      await pass.fill(pair.password);
      await submitLogin(p, pass);
    } catch {
      // The error is swallowed on purpose: what went wrong is read
      // off the page below, and no machinery message on this path
      // may travel with what was typed.
      return { ...(await snapshot(p)), signed_in: false, reason: 'error' };
    } finally {
      signInAllowance = null;
    }
    await settle(p);
    const still = await passwordField(p);
    return { ...(await snapshot(p)), signed_in: !still, ...(still ? { reason: 'still_walled' } : {}) };
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
  assetToken = token;
  log(`Read-only: ${!ALLOW_WRITES}. Waiting for work…`);
  let backoff = 1000;
  while (true) {
    try {
      const { call } = await relay('/calls/next', {}, token);
      backoff = 1000;
      if (!call) continue;
      const tool = TOOLS[call.tool];
      // A sign-in call's input carries the pair: it is never logged.
      log(call.tool === 'sign_in' ? 'sign_in' : `${call.tool} ${JSON.stringify(call.input).slice(0, 120)}`);
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
      if (e.status === 401) { log('The token is not known any more; announcing again.'); saveState({}); token = await announce(); assetToken = token; continue; }
      log(`Relay unreachable (${e.message}); retrying.`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30000);
    }
  }
}

process.on('SIGINT', async () => { await context?.close().catch(() => {}); process.exit(0); });
main();
