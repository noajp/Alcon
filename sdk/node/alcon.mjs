// Alcon asset relay — the one line a local app adds to join its Space.
//
//   import './alcon.mjs';                         // that is the line
//
// On import it announces this process to the relay (name, version, runtime,
// host, which AI providers it has keys for, nothing secret), keeps the asset
// token it gets back in .alcon/asset.json so a restart is the same asset,
// and from then on reports what the app does:
//
//   - every outbound HTTP host the app talks to (hostnames only, batched)
//   - process start and stop
//   - whatever the app chooses to say: alcon.event('closed-books', 'Q3 closed', { fy: 2026 })
//
// Configuration (environment):
//   ALCON_RELAY   the relay URL (…/functions/v1/asset-relay)   required
//   ALCON_SPACE   the Space id to announce to                  required on first contact
//   ALCON_NAME    the asset's name (default: package.json name, else the folder)
//   ALCON_KIND    app | ai_agent | script | service | other (default app)
//   ALCON_STATE   where to keep the token (default ./.alcon/asset.json)
//   ALCON_SILENT  set to 1 to suppress the one-line console notes
//
// Never throws, never blocks the app: a relay that is down or a token that
// was revoked is logged once and the app carries on as if the line were not
// there. Zero dependencies; Node 18+.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { hostname, platform, release } from 'node:os';

const RELAY = (process.env.ALCON_RELAY ?? '').replace(/\/+$/, '');
const SPACE = process.env.ALCON_SPACE ?? '';
const STATE_PATH = process.env.ALCON_STATE ?? join(process.cwd(), '.alcon', 'asset.json');
const SILENT = process.env.ALCON_SILENT === '1';
const FLUSH_MS = 5000;

const AI_PROVIDER_KEYS = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  ollama: ['OLLAMA_HOST'],
  azure_openai: ['AZURE_OPENAI_API_KEY'],
  aws_bedrock: ['AWS_BEARER_TOKEN_BEDROCK'],
};

const note = (msg) => { if (!SILENT) console.error(`[alcon] ${msg}`); };

function readPackage() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = join(dir, 'package.json');
    if (existsSync(p)) {
      try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return null; }
}

function writeState(state) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  } catch (e) {
    note(`could not keep the asset token at ${STATE_PATH}: ${e.message}`);
  }
}

/** What this process can say about itself without reading any secret. */
function manifest(pkg) {
  const providers = Object.entries(AI_PROVIDER_KEYS)
    .filter(([, keys]) => keys.some((k) => !!process.env[k]))
    .map(([name]) => name);
  return {
    runtime: `node ${process.versions.node}`,
    version: pkg?.version ?? null,
    description: pkg?.description ?? null,
    host: hostname(),
    platform: `${platform()} ${release()}`,
    cwd: basename(process.cwd()),
    entry: process.argv[1] ? basename(process.argv[1]) : null,
    ai_providers: providers,
    dependencies: Object.keys(pkg?.dependencies ?? {}).slice(0, 100),
    sdk: 'alcon-node/0.1',
  };
}

const state = { token: null, assetId: null, status: null, ready: null, down: false };
const queue = [];
const outbound = new Map(); // host → count since the last flush
let flushTimer = null;
const nativeFetch = globalThis.fetch;

async function post(path, body, withToken) {
  const headers = { 'content-type': 'application/json' };
  if (withToken && state.token) headers.authorization = `Bearer ${state.token}`;
  const res = await nativeFetch(`${RELAY}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

async function announce() {
  if (!RELAY) { note('ALCON_RELAY is not set; not connected'); state.down = true; return; }
  const pkg = readPackage();
  const name = process.env.ALCON_NAME ?? pkg?.name ?? basename(process.cwd());
  const kind = process.env.ALCON_KIND ?? 'app';
  const saved = readState();
  const body = { name, kind, manifest: manifest(pkg) };
  if (saved?.token) body.token = saved.token;
  else if (SPACE) body.space = SPACE;
  else { note('ALCON_SPACE is not set and no asset token is kept; not connected'); state.down = true; return; }

  let r;
  try { r = await post('/hello', body, false); } catch (e) { note(`relay unreachable (${e.message}); carrying on without it`); state.down = true; return; }

  if (r.status === 401 && saved?.token) {
    // The kept token is unknown to this relay (another project, a reset):
    // start over as a new asset if a Space is configured.
    if (!SPACE) { note('the kept asset token is unknown and ALCON_SPACE is not set; not connected'); state.down = true; return; }
    try { r = await post('/hello', { name, kind, manifest: body.manifest, space: SPACE }, false); } catch (e) { note(`relay unreachable (${e.message})`); state.down = true; return; }
  }
  if (r.status === 403) { note('this asset was revoked in Alcon; not reporting'); state.down = true; return; }
  if (!r.ok || !r.data?.asset_id) { note(`relay refused the hello (${r.status} ${r.data?.error?.code ?? ''}); carrying on without it`); state.down = true; return; }

  state.assetId = r.data.asset_id;
  state.status = r.data.status;
  if (r.data.token) { state.token = r.data.token; writeState({ token: r.data.token, asset_id: r.data.asset_id, relay: RELAY }); }
  else state.token = saved.token;
  note(r.data.token
    ? `announced to Alcon as "${name}" — waiting for a Space owner to accept it (Settings › Integrations › Connected assets)`
    : `connected to Alcon as "${name}" (${state.status})`);
  event('started', `${name} started`, { pid: process.pid, entry: body.manifest.entry });
}

async function flush() {
  flushTimer = null;
  if (state.down || !state.token) { queue.length = 0; outbound.clear(); return; }
  if (outbound.size > 0) {
    const hosts = Object.fromEntries(outbound);
    outbound.clear();
    queue.push({ kind: 'outbound', summary: `Talked to ${Object.keys(hosts).join(', ')}`, payload: { hosts } });
  }
  if (queue.length === 0) return;
  const batch = queue.splice(0, 50);
  try {
    const r = await post('/events', { events: batch }, true);
    if (r.status === 403) { note('this asset was revoked in Alcon; not reporting'); state.down = true; return; }
    if (!r.ok) note(`relay refused ${batch.length} event(s) (${r.status} ${r.data?.error?.code ?? ''})`);
  } catch (e) {
    note(`relay unreachable (${e.message}); ${batch.length} event(s) dropped`);
  }
  if (queue.length > 0) schedule();
}

function schedule() {
  if (!flushTimer) {
    flushTimer = setTimeout(() => { void flush(); }, FLUSH_MS);
    flushTimer.unref?.();
  }
}

/** Say what the app just did. Never throws. */
export function event(kind, summary, payload) {
  if (state.down) return;
  queue.push({ kind: String(kind).slice(0, 60), summary: String(summary).slice(0, 300), payload: payload ?? null, occurred_at: new Date().toISOString() });
  if (queue.length > 500) queue.splice(0, queue.length - 500);
  schedule();
}

// Outbound hosts, hostnames only: which services and AI providers the app
// actually talks to, as opposed to what it says in its manifest.
if (typeof nativeFetch === 'function') {
  globalThis.fetch = function alconFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
      if (url && !url.startsWith(RELAY)) {
        const host = new URL(url).hostname;
        outbound.set(host, (outbound.get(host) ?? 0) + 1);
        schedule();
      }
    } catch { /* not a URL we can read; the request proceeds untouched */ }
    return nativeFetch.call(this, input, init);
  };
}

// The stop is best effort: a hard kill sends nothing, and that absence is
// itself what the Space sees (last_seen_at stops moving).
let stopping = false;
function stop(reason) {
  if (stopping || state.down || !state.token) return;
  stopping = true;
  const batch = queue.splice(0, 49);
  batch.push({ kind: 'stopped', summary: `Stopped (${reason})`, occurred_at: new Date().toISOString() });
  void post('/events', { events: batch }, true).catch(() => {});
}
process.once('beforeExit', () => stop('exit'));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { stop(sig); setTimeout(() => process.exit(0), 300).unref?.(); });
}

state.ready = announce();

export const alcon = { event, ready: state.ready, get status() { return state.status; }, get assetId() { return state.assetId; } };
export default alcon;
