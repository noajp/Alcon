#!/usr/bin/env node
//
// The board, as an event stream.
//
// Friction already broadcasts: elements, element_comments, element_assignees,
// strategy_comments, dev_events and dev_control are all in the supabase_realtime
// publication. This listener joins that stream and prints one line per change
// worth waking the loop for. Run it under the Monitor tool and each line becomes
// a notification, which is what makes moving a card on the board a way of giving
// an instruction.
//
// strategy_comments is the downward direction. Everything else here reports what
// execution did; a Campaign comment is where the intent is written, and one that
// names the agent is an order. See docs/adr/0012.
//
// element_comments carries a second board's worth of traffic once another
// team's is on the same database, and the same naming rule decides what of it
// is ours: FEEDBACK for a foreign Element's comment that names the agent,
// COMMENT for anything on Friction Dev's own. See elementScope.mjs and
// .claude/skills/friction/FEEDBACK.md.
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
//
// Safe to start unconditionally. Every session's SessionStart hook runs this,
// and the lease settles which one actually listens.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFaultReporter } from './faultReporter.mjs'
import {
  AGENT_MENTION,
  classifyElementComment,
  isOurElement as isOurElementScope,
  resolveElementName,
} from './elementScope.mjs'
import { attachLog, claimLease, noteLease } from './singleLease.mjs'

// Before anything else — before reading a key, before opening a socket. A
// second listener that got as far as connecting would deliver every board
// change twice even if it exited a moment later.
if (!claimLease('board-listen')) process.exit(0)

// Started by a hook rather than by a person. A person who runs this and gets
// nothing deserves to be told why; a hook that fires on every session start
// has no reader for the explanation and would only be adding a line of noise
// to a machine that happens not to have the key.
const HOOK = process.env.FRICTION_LOOP_HOOK === '1'

// Started by a hook there is no terminal to print to, so the holder writes to a
// log file it owns and removes on the way out. Run by hand, stdout is the point
// and nothing is written to disk.
if (HOOK) attachLog('board-listen')

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

// The Friction Dev domain. Everything the self-build loop cares about hangs off
// it; anything on another domain is the user's real work and none of our business.
const FRICTION_DEV_DOMAIN = '8945f193-1e57-4baf-a315-cf7cc5dad7f4'

// Our own comments echo back off the stream. Waking the loop for its own
// writes is how you build a machine that talks to itself forever.
const SELF_AUTHOR = 'Claude'

// What turns a Campaign comment into an order, or an Element comment on a
// foreign board into feedback worth seeing: it names the agent. `AGENT_MENTION`
// is imported from elementScope.mjs — see that file for why plain text, not
// the `mentions` uuid[] column, is the only route that actually works — and is
// shared by both formatStrategyComment (ADR 0012's ORDER) and formatComment
// (el_OPS-030's FEEDBACK) below. One regex, two tables, the same rule.
//
// The mirror of ADR 0010 — an agent's comment reaches only the people it names,
// and a person reaches the agent only by naming it. Without a rule of this
// shape every remark on a Campaign becomes work, and the Campaign stops being
// somewhere you can write "this assumption no longer holds" without that
// sentence turning into a task. A question converted into a to-do is always
// answered "yes, do it".

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
    if (HOOK) process.exit(0)
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

// Which objects belong to Friction Dev, and the last known state of every
// element on it.
//
// The state cache is not an optimisation, it is the only way to know what
// actually changed. Postgres replicates updates under REPLICA IDENTITY DEFAULT,
// which puts nothing but the primary key in `old_record` — so comparing against
// it reports every field as having changed on every update, and a status edit
// announces itself as a status change *and* a priority change *and* the element
// leaving the sprint. Diffing against what we last saw is correct without
// asking the whole project to carry the extra WAL of REPLICA IDENTITY FULL.
const objectIds = new Set()
const elementState = new Map() // id -> { label, status, priority, phase_id }

const TRACKED = ['status', 'priority', 'phase_id']

function snapshot(row) {
  return {
    label: `${row.display_id} ${truncate(row.title, 60)}`,
    status: row.status,
    priority: row.priority,
    phase_id: row.phase_id ?? null,
  }
}

async function refreshObjects() {
  const objects = await rest(`objects?domain_id=eq.${FRICTION_DEV_DOMAIN}&select=id`)
  objectIds.clear()
  for (const o of objects) objectIds.add(o.id)
  foreignObjectIds.clear()
}

// Objects we have already established are somebody else's.
//
// The subscription cannot filter by domain — an element's domain is reached
// through its object — so every element change in the user's real work arrives
// here too. Without this, each one misses the objectIds set and triggers a
// refresh that by definition cannot contain it, so editing twenty tasks in
// another domain costs twenty pointless round trips and a bulk update costs one
// per row, forever, because the refresh never converges.
const foreignObjectIds = new Set()

async function refreshObjectsFor(objectId) {
  if (foreignObjectIds.has(objectId)) return
  await refreshObjects()
  if (!objectIds.has(objectId)) foreignObjectIds.add(objectId)
}

// Startup only. Re-seeding mid-stream would overwrite the snapshots we diff
// against with the values we are in the middle of being told about, and the
// change would vanish instead of being reported.
async function seedElements() {
  if (objectIds.size === 0) return
  const inList = `(${[...objectIds].join(',')})`
  const elements = await rest(
    `elements?object_id=in.${inList}&select=id,display_id,title,status,priority,phase_id`,
  )
  for (const e of elements) elementState.set(e.id, snapshot(e))
}

// Elements referenced by a comment that were never seeded — because they live
// on somebody else's board, or because they are ours but the comment arrived
// before the element's own INSERT did. Without this, `nameOf` falls back to a
// bare uuid prefix: a comment on another team's element read as
// `COMMENT   element:3bced448 — Capt. Hale: …`, which is worse than not
// reporting it — it passed through *and* couldn't be read.
//
// `inScope` decides `COMMENT` vs `FEEDBACK` in formatComment below the same
// way `objectIds` decides it for a seeded element: by whether the row's own
// `object_id` is one of ours, not by which cache happened to answer the query.
//
// Same convergence problem as foreignObjectIds/unknownStrategyIds: an element
// that is genuinely gone, or whose row the service role cannot read, would
// otherwise cost one round trip per comment, forever.
const foreignElementState = new Map() // id -> { label, inScope }
const unknownElementIds = new Set()

async function refreshElementFor(elementId) {
  if (elementState.has(elementId) || foreignElementState.has(elementId) || unknownElementIds.has(elementId)) return
  const rows = await rest(`elements?id=eq.${elementId}&select=id,display_id,title,object_id`)
  const row = rows[0]
  if (!row) {
    unknownElementIds.add(elementId)
    return
  }
  foreignElementState.set(elementId, {
    label: `${row.display_id} ${truncate(row.title, 60)}`,
    inScope: objectIds.has(row.object_id),
  })
}

// The decision logic itself — which board a comment is ours to report, and
// what to call it when it is — lives in elementScope.mjs, tested there
// without a socket. These two just supply the live Maps it reads.
function nameOf(elementId) {
  return resolveElementName(elementId, { elementState, foreignElementState })
}

function isOurElement(elementId) {
  return isOurElementScope(elementId, { elementState, foreignElementState })
}

// Campaigns, by id: their name, and whether they are the loop's business.
//
// `strategies` has no domain column — a Campaign reaches Execution through
// strategy_objects — so scope is "holds at least one Friction Dev object".
// Unlike elementState this may be re-read at any time: nothing is diffed
// against it, it only resolves an id to something a person can read.
//
// The scope flags go stale if an Object joins Friction Dev mid-session and is
// then attached to a Campaign — that Campaign's chatter stays unreported until
// a restart. Left alone because orders are unaffected: an order is reported
// whatever the scope says, so the stale half is the half that only ever costs
// a line of context.
const strategyState = new Map() // id -> { name, inScope }

async function refreshStrategies() {
  const [strategies, links] = await Promise.all([
    rest('strategies?select=id,name'),
    objectIds.size
      ? rest(`strategy_objects?object_id=in.(${[...objectIds].join(',')})&select=strategy_id`)
      : Promise.resolve([]),
  ])
  const inScope = new Set(links.map((l) => l.strategy_id))
  strategyState.clear()
  for (const s of strategies) strategyState.set(s.id, { name: s.name, inScope: inScope.has(s.id) })
  unknownStrategyIds.clear()
}

// Same convergence problem as foreignObjectIds: a Campaign that is genuinely
// gone (deleted between the write and our read) would otherwise re-read the
// whole table on every comment that mentions it, forever.
const unknownStrategyIds = new Set()

async function refreshStrategiesFor(strategyId) {
  if (unknownStrategyIds.has(strategyId)) return
  await refreshStrategies()
  if (!strategyState.has(strategyId)) unknownStrategyIds.add(strategyId)
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

function formatElement(type, rec) {
  if (type === 'DELETE') {
    const line = elementState.has(rec?.id) ? `DELETED   ${nameOf(rec.id)}` : null
    elementState.delete(rec?.id)
    return line
  }

  if (!rec || !objectIds.has(rec.object_id)) return null

  const next = snapshot(rec)
  const prev = elementState.get(rec.id)
  elementState.set(rec.id, next)

  if (type === 'INSERT') return `FILED     ${next.label} [${rec.status}/${rec.priority}]`

  // An element we have never seen updating is a gap in our own cache, not news
  // about the board. Now that it is cached the next change reports properly.
  if (!prev) return null

  const lines = []
  for (const field of TRACKED) {
    if (prev[field] === next[field]) continue
    if (field === 'phase_id') {
      lines.push(`SPRINT    ${next.label} ${next.phase_id ? 'pulled into sprint' : 'removed from sprint'}`)
    } else {
      lines.push(`${field === 'status' ? 'STATUS   ' : 'PRIORITY '} ${next.label} ${prev[field]} → ${next[field]}`)
    }
  }
  return lines.length ? lines.join('\n') : null
}

// An Element comment. The same split as strategy_comments (ADR 0012), applied
// to a second table — COMMENT for our own board, FEEDBACK for a named mention
// on somebody else's, silence otherwise. The decision itself, and why it is
// shaped this way, lives in elementScope.mjs's classifyElementComment, tested
// there without a socket; this is just the wiring, and the label widths.
function formatComment(type, rec) {
  if (type !== 'INSERT' || !rec) return null
  const kind = classifyElementComment({
    authorName: rec.author_name,
    content: rec.content,
    selfAuthor: SELF_AUTHOR,
    isOurs: isOurElement(rec.element_id),
  })
  if (!kind) return null
  const who = rec.author_name || 'someone'
  const width = kind === 'FEEDBACK' ? 200 : 160
  // Both labels are 8-10 chars; padEnd(10) matches every other prefix in this
  // file (STATUS, PRIORITY, ORDER, CAMPAIGN, …) so the columns stay aligned.
  return `${kind.padEnd(10)}${nameOf(rec.element_id)} — ${who}: ${truncate(rec.content, width)}`
}

// A Campaign comment. Two lines exist here, and the difference between them is
// the whole point of ADR 0012:
//
//   ORDER    — names the agent. Something is being asked for.
//   CAMPAIGN — does not. Context; the intent being kept true. Not work.
//
// An order is reported from any Campaign, in scope or not. Scope filtering is
// right for chatter, because chatter on the user's real Campaigns is none of
// our business — but a protocol whose failure mode is silence is a broken
// protocol. Someone who typed the agent's name and got nothing has no way to
// tell a dropped line from an agent that decided not to act. The listener
// reports; what to do with an order aimed at somebody else's board is a
// judgement, and dropping the line removes the chance to make it.
function formatStrategyComment(type, rec) {
  if (type !== 'INSERT' || !rec) return null
  // Our own proposals and reports coming back round. Not news, and the one
  // loop that would never terminate: a proposal quoting an order that named
  // us would otherwise read as a fresh order.
  if (rec.author_name === SELF_AUTHOR) return null

  const campaign = strategyState.get(rec.strategy_id)
  const label = campaign?.name || `campaign:${String(rec.strategy_id).slice(0, 8)}`
  const who = rec.author_name || 'someone'
  const content = rec.content || ''

  if (AGENT_MENTION.test(content)) return `ORDER     ${label} — ${who}: ${truncate(content, 200)}`
  if (!campaign?.inScope) return null
  return `CAMPAIGN  ${label} — ${who}: ${truncate(content, 160)}`
}

function formatDevEvent(type, rec) {
  if (type !== 'INSERT' || !rec) return null
  const kind = String(rec.kind || 'event').toUpperCase().padEnd(9).slice(0, 9)
  return `${kind} ${truncate(rec.title, 120)}${rec.url ? ` ${rec.url}` : ''}`
}

// Same REPLICA IDENTITY story as elements: `old_record` carries only the key,
// so the previous value has to come from what we last saw. Seeded at startup
// from the real row — leaving it null would make the first dev_control write of
// any kind look like a flip, and a write that only touched `note` would then
// announce `RESUMED`, claiming the brake was released when nobody touched it.
let lastPaused = null

function formatControl(type, rec) {
  if (!rec) return null
  const was = lastPaused
  lastPaused = rec.paused
  if (was === rec.paused) return null
  return rec.paused
    ? `PAUSED    loop stopped${rec.note ? ` — ${truncate(rec.note, 100)}` : ''}`
    : `RESUMED   loop released`
}

const HANDLERS = {
  elements: formatElement,
  element_comments: (t, rec) => formatComment(t, rec),
  strategy_comments: formatStrategyComment,
  dev_events: (t, rec) => formatDevEvent(t, rec),
  dev_control: formatControl,
}

// ── Wire ─────────────────────────────────────────────────────────────────────

const TABLES = Object.keys(HANDLERS)
let ws
let heartbeat
let refCounter = 0
let backoff = 1000
// Open is not subscribed. Until the join is acknowledged the socket carries
// nothing, and that produces exactly the same silence as a board where nobody
// is working — the ambiguity this whole change exists to remove.
let joined = false

// Two failure modes, two reporters. A socket that drops and a join the server
// refuses are different problems with different fixes — a refused join is
// usually a key, a dropped socket is usually the network — and they alternate,
// because a refused join is followed by a close which is followed by another
// refused join. One reporter would treat every alternation as a new fault and
// announce it, which is the noise this exists to remove wearing a new hat.
//
// The socket gets a grace window: reconnecting inside the backoff is the
// normal behaviour of a laptop lid, not an outage, and announcing a fault
// nobody needed to know about costs a recovery line too.
const socketFault = createFaultReporter({
  subject: 'ERROR     realtime disconnected',
  restored: 'RECOVERED realtime listening again',
  graceMs: 15_000,
})
const joinFault = createFaultReporter({
  subject: 'FATAL     realtime join refused',
  restored: 'RECOVERED realtime join accepted',
})

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

    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok' && !joined) {
      joined = true
      for (const line of [socketFault.ok(), joinFault.ok()]) if (line) console.log(line)
      noteLease('board-listen', { joinedAt: new Date().toISOString(), state: 'listening', faultSince: null })
    }

    if (msg.event === 'phx_reply' && msg.payload?.status === 'error') {
      // A failed join is silent otherwise — the socket stays open and nothing
      // ever arrives, which is indistinguishable from a quiet board. Said once
      // per episode: a key that has expired refuses every retry, and repeating
      // it per retry is how the watch gets muted.
      const line = joinFault.fault(truncate(JSON.stringify(msg.payload.response), 200))
      if (line) console.log(line)
      noteState()
      return
    }
    if (msg.event !== 'postgres_changes') return

    const data = msg.payload?.data
    if (!data) return
    const handler = HANDLERS[data.table]
    if (!handler) return

    // On DELETE the new record is empty and the key lives in old_record.
    const rec = data.record && Object.keys(data.record).length ? data.record : data.old_record

    // An object we do not recognise usually means a new one was added to the
    // domain while we were connected. Only the object set is re-read — the
    // element snapshots must survive, or the change we are holding loses the
    // `before` it needs to be diffed against.
    if (data.table === 'elements' && rec?.object_id && !objectIds.has(rec.object_id)) {
      try {
        await refreshObjectsFor(rec.object_id)
      } catch { /* keep the stream alive; the next event retries */ }
    }

    // A Campaign created since startup. Worth one round trip: without the name
    // an order arrives addressed to a uuid, and without the scope every comment
    // on a new Campaign is silently dropped.
    if (data.table === 'strategy_comments' && rec?.strategy_id && !strategyState.has(rec.strategy_id)) {
      try {
        await refreshStrategiesFor(rec.strategy_id)
      } catch { /* keep the stream alive; the next event retries */ }
    }

    // A comment on an element we have not seeded — somebody else's board, most
    // likely. Worth one round trip: without it the comment cannot be told apart
    // from ours (isOurElement) or read (nameOf falls back to a bare uuid).
    if (data.table === 'element_comments' && rec?.element_id && !elementState.has(rec.element_id)) {
      try {
        await refreshElementFor(rec.element_id)
      } catch { /* keep the stream alive; the next event retries */ }
    }

    let line
    try {
      line = handler(data.type, rec)
    } catch (err) {
      line = `ERROR     formatting ${data.table} event: ${err.message}`
    }
    if (line) console.log(line)
  })

  // The close event that follows carries the code, which is the part worth
  // reporting; this one carries `undefined` on node and would only ever add a
  // second line saying `unknown` beside the first.
  ws.addEventListener('error', () => {})

  ws.addEventListener('close', (e) => {
    clearInterval(heartbeat)
    joined = false
    // Reconnect quietly, but never silently give up — a listener that has
    // stopped listening looks exactly like a board where nothing is happening.
    // The retry delay stays out of the reported text: it changes on every
    // attempt, and a message that changes is a fault that never repeats.
    backoff = Math.min(backoff * 2, 60_000)
    const line = socketFault.fault(`code ${e.code}`)
    if (line) console.log(line)
    noteState()
    setTimeout(connect, backoff)
  })
}

// What this holder is doing, for `loop-report.mjs` to read back. Written on
// every transition including the suppressed ones: a listener that has gone
// quiet because it cannot connect must not read as a listener watching a quiet
// board, or the silence has just moved somewhere harder to see.
function noteState() {
  const down = socketFault.status() || joinFault.status()
  if (down) {
    noteLease('board-listen', { state: `down for ${down.for} — ${truncate(down.message, 100)}`, faultSince: down.since })
    return
  }
  noteLease('board-listen', { state: joined ? 'listening' : 'connecting', faultSince: null })
}

// ── Start ────────────────────────────────────────────────────────────────────

try {
  await refreshObjects()
  await seedElements()
  await refreshStrategies()
  const [control] = await rest('dev_control?id=eq.1&select=paused')
  lastPaused = control?.paused ?? null
} catch (err) {
  console.log(`FATAL     cannot read the board: ${err.message}`)
  process.exit(1)
}

// Refreshed on a timer as well as on state changes: a holder that is alive but
// wedged still moves `seenAt`, one that has died stops moving it. The lock it
// already owns is where that goes, so nothing new has to exist to be asked.
setInterval(noteState, 60_000).unref()

connect()
