#!/usr/bin/env node
//
// The dead-man's switch.
//
// This is the only part of the loop that watches a clock, and it is careful
// about what it uses one for. It never asks "is there work?" — the board pushes
// that. It asks "has something that claimed to be working gone quiet?", which
// is the one question no event can answer, because the event you are waiting
// for is the one that never arrives.
//
// The heartbeat is the progress comment, not the row's updated_at. The protocol
// requires a working agent to report; an agent that has hit a rate limit, been
// killed, or wandered off writes nothing at all, while its element sits in
// in_progress looking exactly like healthy work.
//
// Silence means healthy. This prints nothing at all while the board is moving,
// so it can run under Monitor for a whole session without producing noise.
//
// Usage:
//   node ops/stall-check.mjs [--warn-minutes 25] [--interval-seconds 300] [--once]
//
// Safe to start unconditionally. Every session's SessionStart hook runs this,
// and the lease settles which one actually watches.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFaultReporter, shouldEscalate } from './faultReporter.mjs'
import { attachLog, claimLease, noteLease } from './singleLease.mjs'

// `--once` is a question, not a watch: it prints an answer and leaves. Holding
// it against the running watcher would make the one command a person reaches
// for to ask "is anything stuck?" silently answer nothing.
const ONCE = process.argv.includes('--once')
if (!ONCE && !claimLease('stall-check')) process.exit(0)

const HOOK = process.env.FRICTION_LOOP_HOOK === '1'

// Only the watch owns a log. `--once` is a question asked by a person at a
// terminal; it answers on stdout and leaves nothing behind.
if (HOOK && !ONCE) attachLog('stall-check')

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRICTION_DEV_DOMAIN = '8945f193-1e57-4baf-a315-cf7cc5dad7f4'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}
const WARN_MINUTES = arg('--warn-minutes', 25)
const INTERVAL_MS = arg('--interval-seconds', 300) * 1000

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
    console.log('FATAL     stall-check cannot start — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found')
    process.exit(1)
  }
  return { url: url.replace(/\/$/, ''), key }
}

const { url: SUPABASE_URL, key: SERVICE_KEY } = loadEnv()

// PostgREST rather than a SQL RPC: no helper function to install, and the
// embedded comment resource gives us the last report per element in one round
// trip.
async function stalledElements() {
  const params = new URLSearchParams({
    select: 'id,display_id,title,status,updated_at,objects!inner(domain_id),element_comments(created_at)',
    status: 'eq.in_progress',
    'objects.domain_id': `eq.${FRICTION_DEV_DOMAIN}`,
  })
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elements?${params}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const rows = await res.json()

  const now = Date.now()
  const cutoff = WARN_MINUTES * 60_000
  const stalled = []

  for (const row of rows) {
    const lastComment = (row.element_comments || [])
      .map((c) => new Date(c.created_at).getTime())
      .sort((a, b) => b - a)[0]
    // No comment at all means it was moved to in_progress without anyone
    // claiming it — the row's own timestamp is the only clock we have.
    const lastSignal = lastComment ?? new Date(row.updated_at).getTime()
    const quietFor = now - lastSignal
    if (quietFor > cutoff) {
      stalled.push({ ...row, quietMinutes: Math.round(quietFor / 60_000), claimed: lastComment != null })
    }
  }
  return stalled
}

// The other half of the dead-man's switch. ADR-0007 moved "waiting on a
// person" out of in_progress and into blocked so this watcher would stop
// crying wolf — and named the cost: a blocked Element whose premise quietly
// vanishes has nothing watching it (el_UXQ-009 sank that way). The lease
// closes that gap without a second clock: a holder who is still around keeps
// commenting, and each comment renews claim_expires_at. A blocked Element
// whose lease has lapsed is one nobody is holding any more, whatever its
// status says.
async function lapsedBlocked() {
  const params = new URLSearchParams({
    select: 'id,display_id,title,claimed_by,claim_expires_at,objects!inner(domain_id)',
    status: 'eq.blocked',
    claimed_by: 'not.is.null',
    claim_expires_at: `lt.${new Date().toISOString()}`,
    'objects.domain_id': `eq.${FRICTION_DEV_DOMAIN}`,
  })
  const res = await fetch(`${SUPABASE_URL}/rest/v1/elements?${params}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const now = Date.now()
  return (await res.json()).map((row) => ({
    ...row,
    lapsedMinutes: Math.round((now - new Date(row.claim_expires_at).getTime()) / 60_000),
  }))
}

// One line per stall episode, not one per poll. Re-report only when the silence
// has doubled, so a genuinely stuck item escalates instead of repeating.
const reported = new Map() // element id -> minutes at last report
const lapsedReported = new Map() // element id -> minutes at last report

// The same discipline applied to this watcher's own failures. A board it cannot
// read is worth saying once and worth saying again when the outage doubles; it
// is never worth saying every five minutes until someone mutes the watch and
// loses the detector along with the noise.
const boardRead = createFaultReporter({
  subject: 'ERROR     stall-check could not read the board',
  restored: 'RECOVERED stall-check can read the board again',
})

async function tick() {
  let stalled
  let lapsed
  try {
    ;[stalled, lapsed] = await Promise.all([stalledElements(), lapsedBlocked()])
  } catch (err) {
    const line = boardRead.fault(err.message)
    if (line) console.log(line)
    // Written even when the line was suppressed. Quiet-because-blind must not
    // read as quiet-because-healthy, or the fix for the noise has simply hidden
    // the fault instead of reporting it once.
    const down = boardRead.status()
    const why = down.message.replace(/\s+/g, ' ').slice(0, 100)
    noteLease('stall-check', { state: `board unreadable for ${down.for} — ${why}`, faultSince: down.since })
    return
  }

  const recovered = boardRead.ok()
  if (recovered) console.log(recovered)

  // Recorded every tick, including the quiet ones. Silence is this watcher's
  // healthy state, so the only way to tell a healthy watcher from a dead one is
  // a mark it leaves somewhere other than its output.
  const summary = [
    stalled.length ? `${stalled.length} stalled` : null,
    lapsed.length ? `${lapsed.length} lapsed` : null,
  ].filter(Boolean).join(', ')
  noteLease('stall-check', { state: summary || 'clear', faultSince: null })

  const live = new Set()
  for (const el of stalled) {
    live.add(el.id)
    const last = reported.get(el.id)
    // Escalate on doubling, but `last` can be 0 (a stall found at a zero
    // threshold), and nothing is below zero — without the floor the same line
    // would repeat every tick until the rate limiter disarmed the watch.
    if (last != null && !shouldEscalate(last, el.quietMinutes)) continue
    reported.set(el.id, el.quietMinutes)
    const claim = el.claimed ? 'no progress report' : 'never claimed'
    console.log(`STALLED   ${el.display_id} ${el.title} — ${claim} for ${el.quietMinutes}m`)
  }

  // Something that started moving again should be able to stall a second time.
  for (const id of reported.keys()) if (!live.has(id)) reported.delete(id)

  const liveLapsed = new Set()
  for (const el of lapsed) {
    liveLapsed.add(el.id)
    const last = lapsedReported.get(el.id)
    if (last != null && !shouldEscalate(last, el.lapsedMinutes)) continue
    lapsedReported.set(el.id, el.lapsedMinutes)
    console.log(`LAPSED    ${el.display_id} ${el.title} — blocked, lease held by ${el.claimed_by} expired ${el.lapsedMinutes}m ago`)
  }
  for (const id of lapsedReported.keys()) if (!liveLapsed.has(id)) lapsedReported.delete(id)
}

await tick()
if (!ONCE) setInterval(tick, INTERVAL_MS)
