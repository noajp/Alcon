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

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const FRICTION_DEV_DOMAIN = '8945f193-1e57-4baf-a315-cf7cc5dad7f4'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}
const WARN_MINUTES = arg('--warn-minutes', 25)
const INTERVAL_MS = arg('--interval-seconds', 300) * 1000
const ONCE = process.argv.includes('--once')

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

// One line per stall episode, not one per poll. Re-report only when the silence
// has doubled, so a genuinely stuck item escalates instead of repeating.
const reported = new Map() // element id -> minutes at last report

async function tick() {
  let stalled
  try {
    stalled = await stalledElements()
  } catch (err) {
    console.log(`ERROR     stall-check could not read the board: ${err.message}`)
    return
  }

  const live = new Set()
  for (const el of stalled) {
    live.add(el.id)
    const last = reported.get(el.id)
    // Escalate on doubling, but `last` can be 0 (a stall found at a zero
    // threshold), and nothing is below zero — without the floor the same line
    // would repeat every tick until the rate limiter disarmed the watch.
    if (last != null && el.quietMinutes < Math.max(last * 2, last + 1)) continue
    reported.set(el.id, el.quietMinutes)
    const claim = el.claimed ? 'no progress report' : 'never claimed'
    console.log(`STALLED   ${el.display_id} ${el.title} — ${claim} for ${el.quietMinutes}m`)
  }

  // Something that started moving again should be able to stall a second time.
  for (const id of reported.keys()) if (!live.has(id)) reported.delete(id)
}

await tick()
if (!ONCE) setInterval(tick, INTERVAL_MS)
