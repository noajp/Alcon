#!/usr/bin/env node
//
// The lease on an Element, taken the only way it can be taken.
//
// "▶ 着手 — branch: …" used to be the claim. It was prose: nothing stopped
// two sessions from writing it on the same Element, and nothing noticed when
// the session that wrote it died. el_TRJ-012 moved the claim into the row —
// claimed_by / claim_expires_at / branch on elements, holder on
// element_comments, claim_element() / release_element() as the only writers,
// and a trigger that renews the lease on every comment the holder stamps.
// This file is the one place the loop talks to that machinery, so the
// convention and the mechanism cannot drift apart again.
//
// The holder is a SESSION token, never a display name. Every AI session
// comments as author_name 'Claude'; a lease keyed on that would let any
// session take over any other's Element and let a stranger's report keep a
// dead session's claim alive. The token is derived from the worktree the
// session runs in — the thing that is actually distinct per session — and
// can be pinned with LOOP_HOLDER when that isn't right.
//
// Usage (from anywhere in the repo):
//   node ops/lease.mjs claim   <display_id|uuid> [--branch <name>] [--note "方針1行"]
//   node ops/lease.mjs comment <display_id|uuid> --text "● 進捗 — …" | --file path
//   node ops/lease.mjs release <display_id|uuid> [--text "✔ 完了 — …" | --file path]
//   node ops/lease.mjs whoami
//
// `claim` exits 0 and prints the holder when the lease is granted, exits 3
// with a one-line reason when another session holds it — the same contract
// as singleLease.mjs: false means leave quietly, not retry. `comment` stamps
// the holder so the write is also the heartbeat. `release` posts the closing
// comment (still stamped, so it lands while the lease is live) and then
// returns the row.

import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- identity -------------------------------------------------------------

/**
 * The token this session claims and stamps with. Pure: derived from inputs
 * so it can be tested without a filesystem.
 *
 *   LOOP_HOLDER=… wins outright.
 *   Otherwise 'Claude@<worktree basename>' — the primary checkout is 'Clayware',
 *   a session worktree is its directory name, which is what makes two
 *   concurrent sessions distinguishable.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [repoRoot]
 * @returns {string}
 */
export function holderToken(env = process.env, repoRoot = REPO) {
  const pinned = (env.LOOP_HOLDER ?? '').trim()
  if (pinned) return pinned
  const agent = (env.LOOP_AGENT ?? 'Claude').trim() || 'Claude'
  return `${agent}@${basename(repoRoot)}`
}

// ---- args -----------------------------------------------------------------

/**
 * Minimal flag parser: `--k v` pairs plus positionals. Pure.
 * @param {string[]} argv
 * @returns {{ _: string[] } & Record<string, string | boolean | string[]>}
 */
export function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) out[k] = true
      else { out[k] = v; i++ }
    } else out._.push(a)
  }
  return out
}

/**
 * The comment body from --text or --file; null when neither is given.
 * @param {{ text?: unknown, file?: unknown }} args
 * @param {(path: string) => string} [readText]
 * @returns {string | null}
 */
export function readBody(args, readText = (p) => readFileSync(p, 'utf8')) {
  if (typeof args.text === 'string') return args.text.trim() || null
  if (typeof args.file === 'string') return readText(args.file).trim() || null
  return null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s) => UUID.test(s)

// ---- board ----------------------------------------------------------------

function loadEnv() {
  let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    for (const candidate of [join(REPO, 'web/.env.local'), join(REPO, '../../../web/.env.local')]) {
      let text
      try { text = readFileSync(candidate, 'utf8') } catch { continue }
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
    console.error('FATAL     lease cannot reach the board — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found')
    process.exit(2)
  }
  return { url: url.replace(/\/$/, ''), key }
}

function board() {
  const { url, key } = loadEnv()
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    async rpc(name, args) {
      const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) })
      if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`)
      return res.json()
    },
    async one(table, query) {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, { headers })
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
      const rows = await res.json()
      return rows[0] ?? null
    },
    async insert(table, row) {
      const res = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) })
      if (!res.ok) throw new Error(`${table} insert: ${res.status} ${await res.text()}`)
    },
    async patch(table, query, row) {
      const res = await fetch(`${url}/rest/v1/${table}?${query}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) })
      if (!res.ok) throw new Error(`${table} patch: ${res.status} ${await res.text()}`)
    },
  }
}

async function resolveElement(db, ref) {
  const q = isUuid(ref) ? `id=eq.${ref}` : `display_id=eq.${encodeURIComponent(ref)}`
  const row = await db.one('elements', `select=id,display_id,status,claimed_by,claim_expires_at,branch&${q}`)
  if (!row) {
    console.error(`NOT FOUND ${ref}`)
    process.exit(2)
  }
  return row
}

// The stamped comment IS the heartbeat: the trigger renews claim_expires_at
// only when holder matches claimed_by, so an unstamped report keeps nothing.
async function postComment(db, elementId, content, holder) {
  await db.insert('element_comments', {
    element_id: elementId,
    author_kind: 'ai_agent',
    author_id: null,
    author_name: (process.env.LOOP_AGENT ?? 'Claude').trim() || 'Claude',
    content,
    holder,
  })
}

// ---- commands -------------------------------------------------------------

async function cmdClaim(db, args, holder) {
  const ref = args._[1]
  // A branch is the resource that conflicts when code is written; an Element
  // that writes none (sprint measurement, a harvest note) still needs a
  // holder, so the branch is optional and the claim is not.
  const branch = typeof args.branch === 'string' && args.branch.trim() ? args.branch.trim() : null
  if (!ref) {
    console.error('usage: lease.mjs claim <display_id|uuid> [--branch <name>] [--note "方針1行"]')
    process.exit(2)
  }
  const el = await resolveElement(db, ref)
  const ok = await db.rpc('claim_element', { p_element_id: el.id, p_holder: holder, p_branch: branch })
  if (!ok) {
    // Say who, so the loser can decide whether to wait or walk away — but
    // never take it: a live lease is the whole point.
    const fresh = await resolveElement(db, el.id)
    console.log(`HELD      ${el.display_id} by ${fresh.claimed_by ?? '?'} on ${fresh.branch ?? '?'} until ${fresh.claim_expires_at ?? '?'}`)
    process.exit(3)
  }
  // A claim moves work from the shelf to the desk, and nothing else. It does
  // not reopen finished work, and it does not decide for ADR 0007 that a
  // blocked Element's wait is over — only a person's answer does that.
  if (el.status === 'done' || el.status === 'cancelled') {
    await db.rpc('release_element', { p_element_id: el.id, p_holder: holder })
    console.error(`REFUSED   ${el.display_id} is ${el.status}; reopen it on the board first`)
    process.exit(2)
  }
  if (el.status === 'todo' || el.status === 'backlog') {
    await db.patch('elements', `id=eq.${el.id}`, { status: 'in_progress' })
  }
  const note = typeof args.note === 'string' && args.note.trim() ? ` / ${args.note.trim()}` : ''
  const where = branch ? `branch: ${branch} / ` : ''
  await postComment(db, el.id, `▶ 着手 — ${where}holder: ${holder}${note}`, holder)
  console.log(`CLAIMED   ${el.display_id} as ${holder}${branch ? ` on ${branch}` : ''}`)
}

async function cmdComment(db, args, holder) {
  const ref = args._[1]
  const body = readBody(args)
  if (!ref || !body) {
    console.error('usage: lease.mjs comment <display_id|uuid> --text "…" | --file path')
    process.exit(2)
  }
  const el = await resolveElement(db, ref)
  if (el.claimed_by && el.claimed_by !== holder) {
    // Still allowed — a comment is a report, and reports are welcome — but
    // it is not a heartbeat for someone else's lease, and say so.
    console.log(`NOTE      ${el.display_id} is held by ${el.claimed_by}; this comment will not renew that lease`)
  }
  await postComment(db, el.id, body, holder)
  console.log(`POSTED    ${el.display_id}`)
}

async function cmdRelease(db, args, holder) {
  const ref = args._[1]
  if (!ref) {
    console.error('usage: lease.mjs release <display_id|uuid> [--text "✔ 完了 — …" | --file path]')
    process.exit(2)
  }
  const el = await resolveElement(db, ref)
  const body = readBody(args)
  if (body) await postComment(db, el.id, body, holder)
  const ok = await db.rpc('release_element', { p_element_id: el.id, p_holder: holder })
  if (!ok) {
    console.log(`NOT HELD  ${el.display_id} — lease belongs to ${el.claimed_by ?? 'nobody'}, nothing released`)
    process.exit(3)
  }
  console.log(`RELEASED  ${el.display_id}`)
}

// Compare real paths on both sides: Node realpaths the main module but only
// path.resolve()s argv[1], so through a symlinked checkout the two differ and
// a bare equality check would make `claim` print nothing and exit 0 — a
// silent success, the one failure a mutex must never have.
const realpathOr = (p) => { try { return realpathSync(p) } catch { return p } }
const isMain = !!process.argv[1] && realpathOr(fileURLToPath(import.meta.url)) === realpathOr(process.argv[1])
if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const holder = holderToken()
  if (cmd === 'whoami') {
    console.log(holder)
    // Two sessions in checkouts with the same directory name would share a
    // token and could take each other's lease. The primary checkout is the
    // likely place for that to happen; say so where it can be seen.
    if (!process.env.LOOP_HOLDER && statSync(join(REPO, '.git'), { throwIfNoEntry: false })?.isDirectory()) {
      console.error('WARN      token derives from the primary checkout name; a second session there would share it — set LOOP_HOLDER')
    }
  } else if (cmd === 'claim' || cmd === 'comment' || cmd === 'release') {
    const db = board()
    const run = { claim: cmdClaim, comment: cmdComment, release: cmdRelease }[cmd]
    run(db, args, holder).catch((err) => {
      console.error(`ERROR     ${err.message}`)
      process.exit(1)
    })
  } else {
    console.error('usage: lease.mjs claim|comment|release|whoami …')
    process.exit(2)
  }
}
