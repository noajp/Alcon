#!/usr/bin/env node
//
// The dispatcher: Alcon hands work to Claude Code.
//
// A person hands an Element to Claude Code by labelling it 'dispatch' (the
// Initiative's Plan tab does it when an approved draft goes to Claude Code,
// the Execute tab's "Hand to Claude Code" does it for one Element). This
// script, running on the developer's Mac, finds those Elements and starts one
// headless Claude Code session per Element, each in a fresh worktree off
// origin/main, which then follows the alcon skill: claim the lease, branch,
// PR, review, merge, report. Only labelled Elements move — the dev Domain
// carries a long backlog assigned to Claude that nobody has handed over.
//
// What it will start, in order (pickDispatchable):
//   - in the dev Domain (dev_control.domain_id)
//   - labelled 'dispatch', status todo or in_progress
//   - assigned to a Worker whose ai_config.runner is 'claude-code'
//   - nobody holds its lease (or the lease has lapsed)
//   - no session this dispatcher started is still on it
// and never more than dev_control.max_concurrent at once, nothing at all
// while dev_control.paused.
//
// It polls once a minute: an assignment or a label change has no realtime
// event board-listen hears, and a minute is nothing next to a session that
// runs for half an hour. One dispatcher per machine (singleLease).
//
// Usage (from the primary checkout):
//   node .claude/ops/dispatch.mjs            run until stopped
//   node .claude/ops/dispatch.mjs --once     one pass, then wait for the sessions it started
//   node .claude/ops/dispatch.mjs --dry-run  say what it would start, start nothing
//
// Each session's output goes to $TMPDIR/dev-loop-<key>-agent-<display id>.log.
// Its worktree is .claude/worktrees/agent-<display id>; `npm run sync` removes
// it once its branch has landed.

import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, createWriteStream, existsSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimLease } from './singleLease.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const DISPATCH_LABEL = 'dispatch'
export const RUNNER = 'claude-code'

// What a session may do without asking. Edits are accepted; shell commands
// are limited to the tools the alcon skill's protocol uses. Anything else is
// refused in a headless session, and the skill tells it to stop and file a
// decision instead of working around a refusal.
export const ALLOWED_TOOLS = [
  'Read', 'Edit', 'Write', 'Grep', 'Glob', 'TodoWrite', 'Task',
  'Bash(git:*)', 'Bash(gh:*)', 'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)',
  'Bash(cp:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(mkdir:*)', 'Bash(rm -rf web/.next:*)',
]

// ── Pure ─────────────────────────────────────────────────────────────────────

/**
 * The Elements to start now, in order: sprint work first, then by priority,
 * then oldest. Pure.
 *
 * @param {Array<{ id: string, display_id: string|null, status: string|null, priority: string|null, labels: string[]|null,
 *   claimed_by: string|null, claim_expires_at: string|null, phase_id: string|null, created_at: string|null,
 *   runners: string[] }>} rows  Elements in the dev Domain, each with the runners of its assignees
 * @param {{ running: Set<string>, slots: number, now: number }} ctx
 */
export function pickDispatchable(rows, { running, slots, now }) {
  if (slots <= 0) return []
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 }
  return rows
    .filter((r) => (r.labels ?? []).includes(DISPATCH_LABEL))
    .filter((r) => r.status === 'todo' || r.status === 'in_progress')
    .filter((r) => r.runners.includes(RUNNER))
    .filter((r) => !r.claimed_by || !r.claim_expires_at || Date.parse(r.claim_expires_at) <= now)
    .filter((r) => !running.has(r.id))
    .sort((a, b) =>
      (a.phase_id ? 0 : 1) - (b.phase_id ? 0 : 1)
      || (rank[a.priority ?? 'medium'] ?? 2) - (rank[b.priority ?? 'medium'] ?? 2)
      || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
    .slice(0, slots)
}

/** The worktree directory and lease holder for an Element. `agent-` is the
 *  prefix `npm run sync` cleans up. Pure. */
export function sessionName(el) {
  const id = String(el.display_id || el.id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return `agent-${id}`
}

/** The instruction a session starts with. Pure. */
export function implementPrompt(el, template) {
  return template
    .replaceAll('{{display_id}}', el.display_id || el.id)
    .replaceAll('{{element_id}}', el.id)
    .replaceAll('{{title}}', el.title ?? '')
}

// ── Board ────────────────────────────────────────────────────────────────────

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
    console.error('FATAL     dispatch cannot reach the board — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found')
    process.exit(2)
  }
  return { url: url.replace(/\/$/, ''), key }
}

function board({ url, key }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    async get(path) {
      const res = await fetch(`${url}/rest/v1/${path}`, { headers })
      if (!res.ok) throw new Error(`${path.split('?')[0]}: ${res.status} ${await res.text()}`)
      return res.json()
    },
    async insert(table, row) {
      const res = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers, body: JSON.stringify(row) })
      if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
    },
  }
}

async function control(db) {
  const [row] = await db.get('dev_control?id=eq.1&select=paused,max_concurrent,domain_id')
  return { paused: !!row?.paused, max: Number(row?.max_concurrent ?? 3), domain: row?.domain_id ?? null }
}

async function candidates(db, domain) {
  const rows = await db.get(
    'elements?select=id,display_id,title,status,priority,labels,claimed_by,claim_expires_at,phase_id,created_at,'
    + 'objects!inner(domain_id),element_assignees(role,workers(ai_config))'
    + `&objects.domain_id=eq.${domain}&labels=cs.{${DISPATCH_LABEL}}&status=in.(todo,in_progress)`,
  )
  return rows.map((r) => ({
    ...r,
    runners: (r.element_assignees ?? [])
      .filter((a) => a.role !== 'reviewer')
      .map((a) => a.workers?.ai_config?.runner)
      .filter(Boolean),
  }))
}

// ── Sessions ─────────────────────────────────────────────────────────────────

const running = new Map() // element id → { name, child }

function lockKey() {
  // The same key singleLease uses, so the session logs sit with the loop's.
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim()
  return createHash('sha256').update(common).digest('hex').slice(0, 16)
}

function prepareWorktree(name) {
  const dir = join(REPO, '.claude/worktrees', name)
  execFileSync('git', ['fetch', '-q', 'origin', 'main'], { cwd: REPO })
  if (!existsSync(dir)) execFileSync('git', ['worktree', 'add', '-q', '--detach', dir, 'origin/main'], { cwd: REPO })
  // Copies, not symlinks: turbopack refuses a symlinked node_modules.
  if (!existsSync(join(dir, 'web/node_modules')) && existsSync(join(REPO, 'web/node_modules'))) {
    execFileSync('cp', ['-c', '-R', join(REPO, 'web/node_modules'), join(dir, 'web/node_modules')])
  }
  if (existsSync(join(REPO, 'web/.env.local'))) cpSync(join(REPO, 'web/.env.local'), join(dir, 'web/.env.local'))
  return dir
}

function start(el, db, logKey, dryRun) {
  const name = sessionName(el)
  console.log(`START     ${el.display_id ?? el.id} ${el.title} → ${name}${dryRun ? ' (dry run)' : ''}`)
  if (dryRun) return
  const dir = prepareWorktree(name)
  const prompt = implementPrompt(el, readFileSync(join(REPO, '.claude/ops/prompts/implement.md'), 'utf8'))
  const log = createWriteStream(join(tmpdir(), `dev-loop-${logKey}-${name}.log`), { flags: 'a' })
  const child = spawn('claude', [
    '-p', prompt,
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ALLOWED_TOOLS.join(','),
    '--output-format', 'stream-json', '--verbose',
  ], { cwd: dir, env: { ...process.env, LOOP_HOLDER: name, LOOP_AGENT: 'Claude' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.pipe(log)
  child.stderr.pipe(log)
  running.set(el.id, { name, child })
  child.on('exit', (code) => {
    running.delete(el.id)
    console.log(`EXITED    ${el.display_id ?? el.id} → ${name} code ${code}`)
    db.insert('dev_events', {
      source: 'agent', kind: 'agent_exited', ref: el.display_id ?? el.id, title: `${name} exited with ${code}`,
      payload: { element_id: el.id, code },
    }).catch((err) => console.log(`ERROR     could not record the exit: ${err.message}`))
  })
}

async function pass(db, logKey, dryRun) {
  const { paused, max, domain } = await control(db)
  if (paused) return
  if (!domain) throw new Error('dev_control.domain_id is not set')
  const rows = await candidates(db, domain)
  const picked = pickDispatchable(rows, { running: new Set(running.keys()), slots: max - running.size, now: Date.now() })
  for (const el of picked) start(el, db, logKey, dryRun)
}

// ── Main ─────────────────────────────────────────────────────────────────────

function realpathOr(p) { try { return realpathSync(p) } catch { return p } }

const isMain = !!process.argv[1] && realpathOr(fileURLToPath(import.meta.url)) === realpathOr(process.argv[1])
if (isMain) {
  const once = process.argv.includes('--once')
  const dryRun = process.argv.includes('--dry-run')
  if (!dryRun && !claimLease('dispatch')) {
    console.log('dispatch is already running on this machine')
    process.exit(0)
  }
  const db = board(loadEnv())
  const logKey = lockKey()
  const tick = () => pass(db, logKey, dryRun).catch((err) => console.log(`ERROR     ${err.message}`))
  await tick()
  if (!once && !dryRun) setInterval(tick, 60_000)
}
