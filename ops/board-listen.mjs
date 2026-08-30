#!/usr/bin/env node
//
// The board, as an event stream.
//
// Friction already broadcasts: elements, element_comments, element_assignees,
// dev_events and dev_control are all in the supabase_realtime publication. This
// listener joins that stream and prints one line per change worth waking the
// loop for. Run it under the Monitor tool and each line becomes a notification,
// which is what makes moving a card on the board a way of giving an instruction.
//
// Deliberately dependency-free — it speaks the Phoenix wire protocol over node's
// built-in WebSocket rather than pulling @supabase/supabase-js into an ops
// script that has no other reason to depend on the web app's node_modules.
//
// Usage:
//   node ops/board-listen.mjs
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment, or
// from web/.env.local if they are not set. The service role is deliberate: the
// listener is not a user and has no session, so RLS would otherwise hand it an
// empty stream. Keep it local — nothing here should ever run in CI.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

// The Friction Dev domain. Everything the self-build loop cares about hangs off
// it; anything on another domain is the user's real work and none of our business.
const FRICTION_DEV_DOMAIN = '8945f193-1e57-4baf-a315-cf7cc5dad7f4'

// Our own comments echo back off the stream. Waking the loop for its own
// writes is how you build a machine that talks to itself forever.
const SELF_AUTHOR = 'Claude'

// ── Config ───────────────────────────────────────────────────────────────────

function loadEnv() {
  let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    for (const candidate of [join(REPO, 'web/.env.local'), join(REPO, '../../../web/.env.local')]) {
      let text
      try {
        text = readFileSync(candidate, 'utf8')
      } catch {
        continue
      }
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"\n]*)"?\s*$/)
        if (!m) continue
        if (!url && (m[1] === 'SUPABASE_URL' || m[1] === 'NEXT_PUBLIC_SUPABASE_URL')) url = m[2]
        if (!key && m[1] === 'SUPABASE_SERVICE_ROLE_KEY') key = m[2]
      }
      if (url && key) break
    }
  }

  if (!url || !key) {
    console.log('FATAL listener cannot start — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in env or web/.env.local')
    process.exit(1)
  }
  return { url: url.replace(/\/$/, ''), key }
}

const { url: SUPABASE_URL, key: SERVICE_KEY } = loadEnv()
const WS_URL = `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${SERVICE_KEY}&vsn=1.0.0`

// ── REST helpers ─────────────────────────────────────────────────────────────

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`REST ${res.status} ${path}: ${await res.text()}`)
  return res.json()
}

// Which objects belong to Friction Dev, and what each element is called. Both
// are needed to turn a raw row into a line a human can read, and both change
// rarely enough to cache — refreshed only when a row arrives that we cannot name.
const objectIds = new Set()
const elementNames = new Map() // id -> "el_OPS-012 タイトル"

async function refreshBoard() {
  const objects = await rest(`objects?domain_id=eq.${FRICTION_DEV_DOMAIN}&select=id`)
  objectIds.clear()
  for (const o of objects) objectIds.add(o.id)

  if (objectIds.size === 0) return
  const inList = `(${[...objectIds].join(',')})`
  const elements = await rest(`elements?object_id=in.${inList}&select=id,display_id,title`)
  elementNames.clear()
  for (const e of elements) elementNames.set(e.id, `${e.display_id} ${e.title}`)
}

function nameOf(elementId) {
  return elementNames.get(elementId) || `element:${String(elementId).slice(0, 8)}`
}

// ── Event formatting ─────────────────────────────────────────────────────────
//
// One line per event, and only for changes that would alter what the loop does
// next. Title edits and progress ticks are real changes to the row but they are
// not instructions, so they stay off the stream.

function truncate(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function formatElement(type, rec, old) {
  if (!rec || !objectIds.has(rec.object_id)) return null
  const label = `${rec.display_id} ${truncate(rec.title, 60)}`

  if (type === 'INSERT') return `FILED     ${label} [${rec.status}/${rec.priority}]`
  if (type === 'DELETE') return `DELETED   ${nameOf(rec.id)}`

  const lines = []
  if (old && old.status !== rec.status) lines.push(`STATUS    ${label} ${old.status} → ${rec.status}`)
  if (old && old.priority !== rec.priority) lines.push(`PRIORITY  ${label} ${old.priority} → ${rec.priority}`)
  if (old && old.phase_id !== rec.phase_id) {
    lines.push(`SPRINT    ${label} ${rec.phase_id ? 'pulled into sprint' : 'removed from sprint'}`)
  }
  return lines.length ? lines.join('\n') : null
}

function formatComment(type, rec) {
  if (type !== 'INSERT' || !rec) return null
  // Our own reports round-tripping back. Not news.
  if (rec.author_name === SELF_AUTHOR) return null
  return `COMMENT   ${nameOf(rec.element_id)} — ${rec.author_name || 'someone'}: ${truncate(rec.content, 160)}`
}

function formatDevEvent(type, rec) {
  if (type !== 'INSERT' || !rec) return null
  const kind = String(rec.kind || 'event').toUpperCase().padEnd(9).slice(0, 9)
  return `${kind} ${truncate(rec.title, 120)}${rec.url ? ` ${rec.url}` : ''}`
}

function formatControl(type, rec, old) {
  if (!rec || (old && old.paused === rec.paused)) return null
  return rec.paused
    ? `PAUSED    loop stopped${rec.note ? ` — ${truncate(rec.note, 100)}` : ''}`
    : `RESUMED   loop released`
}

const HANDLERS = {
  elements: formatElement,
  element_comments: (t, rec) => formatComment(t, rec),
  dev_events: (t, rec) => formatDevEvent(t, rec),
  dev_control: formatControl,
}

// ── Wire ─────────────────────────────────────────────────────────────────────

const TABLES = Object.keys(HANDLERS)
let ws
let heartbeat
let refCounter = 0
let backoff = 1000

function connect() {
  ws = new WebSocket(WS_URL)

  ws.addEventListener('open', () => {
    backoff = 1000
    ws.send(JSON.stringify({
      topic: 'realtime:self-build',
      event: 'phx_join',
      ref: String(++refCounter),
      payload: {
        config: {
          postgres_changes: TABLES.map((table) => ({ event: '*', schema: 'public', table })),
        },
      },
    }))
    // Phoenix drops a socket that stops talking.
    clearInterval(heartbeat)
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', ref: String(++refCounter), payload: {} }))
      }
    }, 25_000)
  })

  ws.addEventListener('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.data)
    } catch {
      return
    }

    if (msg.event === 'phx_reply' && msg.payload?.status === 'error') {
      // A failed join is silent otherwise — the socket stays open and nothing
      // ever arrives, which is indistinguishable from a quiet board.
      console.log(`FATAL     realtime join refused: ${truncate(JSON.stringify(msg.payload.response), 200)}`)
      return
    }
    if (msg.event !== 'postgres_changes') return

    const data = msg.payload?.data
    if (!data) return
    const handler = HANDLERS[data.table]
    if (!handler) return

    const rec = data.record && Object.keys(data.record).length ? data.record : data.old_record
    // A row we have never seen usually means the board grew while we were
    // connected; re-read before deciding it is not ours.
    if (data.table === 'elements' && rec?.object_id && !objectIds.has(rec.object_id)) {
      try {
        await refreshBoard()
      } catch { /* keep the stream alive; the next event retries */ }
    }
    if (data.table === 'elements' && data.type === 'INSERT' && rec?.id) {
      elementNames.set(rec.id, `${rec.display_id} ${rec.title}`)
    }

    let line
    try {
      line = handler(data.type, data.record, data.old_record)
    } catch (err) {
      line = `ERROR     formatting ${data.table} event: ${err.message}`
    }
    if (line) console.log(line)
  })

  ws.addEventListener('error', (e) => {
    console.log(`ERROR     realtime socket error: ${e.message || 'unknown'}`)
  })

  ws.addEventListener('close', (e) => {
    clearInterval(heartbeat)
    // Reconnect quietly, but never silently give up — a listener that has
    // stopped listening looks exactly like a board where nothing is happening.
    backoff = Math.min(backoff * 2, 60_000)
    if (backoff >= 16_000) {
      console.log(`ERROR     realtime disconnected (code ${e.code}), retrying in ${backoff / 1000}s`)
    }
    setTimeout(connect, backoff)
  })
}

// ── Start ────────────────────────────────────────────────────────────────────

try {
  await refreshBoard()
} catch (err) {
  console.log(`FATAL     cannot read the board: ${err.message}`)
  process.exit(1)
}

connect()
