#!/usr/bin/env node
//
// What the loop did, and whether it is still up.
//
// Two questions that used to have no answer. "Is the loop running?" was
// unanswerable because both watchers are silent when healthy, so an empty log
// meant either a quiet board or a listener that never subscribed. "What
// happened while I was away?" was unanswerable because the activity was spread
// across element comments, dev_events and the elements themselves, and nobody
// had ever put them on one page.
//
// Liveness comes out of the lock files the watchers already hold — not a new
// table and not a new file. `seenAt` moves while the holder is alive and stops
// when it dies, and `state` says whether the listener actually joined realtime
// or is only holding an open socket.
//
// The report itself belongs on the board, not on disk. Campaign is the surface
// for "what is this effort doing", the protocol already asks for retrospective
// comments there, and a file would be a second source that nobody updates.
// So --post writes it as a Campaign comment and stdout is just the preview.
//
//   node ops/loop-report.mjs                 # health + the last 24h
//   node ops/loop-report.mjs --hours 72
//   node ops/loop-report.mjs --post          # file it on the Campaign

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readLease } from './singleLease.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const CAMPAIGN = 'Friction Self-Build'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}
const HOURS = arg('--hours', 24)
const POST = process.argv.includes('--post')

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
    console.log('FATAL cannot read the board — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not found in env or web/.env.local')
    process.exit(1)
  }
  return { url: url.replace(/\/$/, ''), key }
}

const { url: URL_BASE, key: KEY } = loadEnv()

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...init.headers },
  })
  if (!res.ok) throw new Error(`REST ${res.status} ${path}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

const since = new Date(Date.now() - HOURS * 3600_000).toISOString()

// A report nobody scrolls to the end of is a report nobody reads. Long lists
// are cut and the remainder counted, because the count is the part that says
// whether the cut mattered.
const LIST_CAP = 12
function listOf(rows, render) {
  const shown = rows.slice(0, LIST_CAP).map(render)
  if (rows.length > LIST_CAP) shown.push(`- …ほか ${rows.length - LIST_CAP} 件`)
  return shown
}

function ago(iso) {
  if (!iso) return 'unknown'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

// ── health ───────────────────────────────────────────────────────────────────

function health() {
  const lines = []
  for (const [name, label] of [['board-listen', 'listener'], ['stall-check', 'stall watch']]) {
    const held = readLease(name)
    if (!held) {
      lines.push(`- **${label}** — 停止中。次のセッション開始で hook が起こす`)
      continue
    }
    // A listener whose socket is open but unsubscribed reports nothing and looks
    // exactly like a quiet board, so the state matters more than the pid.
    // A holder that predates this reporting carries neither field. Saying so
    // beats printing "unknown", which reads like a fault rather than an old
    // process that will report properly once it restarts.
    if (!held.seenAt) {
      lines.push(`- **${label}** — 稼働中 / pid ${held.pid} / 起動 ${ago(held.startedAt)}（状態報告以前のプロセス。再起動で解消）`)
      continue
    }
    lines.push(`- **${label}** — ${held.state ?? 'starting'} / pid ${held.pid} / 最終確認 ${ago(held.seenAt)}`)
  }
  return lines
}

// ── activity ─────────────────────────────────────────────────────────────────

// The markers the protocol writes progress with. Counting them is how the board
// answers "was anything actually worked on", as opposed to merely edited.
const MARKERS = [['▶', '着手'], ['●', '進捗'], ['⬆', 'PR'], ['✔', '完了'], ['■', 'Blocked']]

async function activity() {
  const [objects] = await Promise.all([
    rest(`objects?domain_id=eq.8945f193-1e57-4baf-a315-cf7cc5dad7f4&select=id,prefix`),
  ])
  const ids = objects.map((o) => o.id)
  if (!ids.length) return { lines: ['- 対象 Object なし'], counts: {} }
  const inObjects = `(${ids.join(',')})`

  const [changed, comments, events, control] = await Promise.all([
    rest(`elements?object_id=in.${inObjects}&updated_at=gte.${since}&select=display_id,title,status,priority,updated_at,created_at&order=updated_at.desc`),
    rest(`element_comments?created_at=gte.${since}&select=content,created_at,elements!inner(display_id,object_id)&order=created_at.asc`),
    rest(`dev_events?created_at=gte.${since}&select=kind,ref,title,created_at&order=created_at.desc`),
    rest('dev_control?id=eq.1&select=paused,max_concurrent'),
  ])

  const mine = comments.filter((c) => ids.includes(c.elements?.object_id))
  const counts = {}
  for (const [mark, label] of MARKERS) counts[label] = mine.filter((c) => c.content?.startsWith(mark)).length

  const done = changed.filter((e) => e.status === 'done')
  const created = changed.filter((e) => e.created_at >= since)
  const open = changed.filter((e) => e.status === 'in_progress' || e.status === 'review')
  const merged = events.filter((e) => e.kind === 'pr_merged')
  const red = events.filter((e) => e.kind === 'ci_failed')

  const lines = []
  lines.push(`- 完了 ${done.length} / 新規 ${created.length} / 進行中・レビュー中 ${open.length}`)
  lines.push(`- main 移動 ${merged.length} 件${red.length ? ` / CI red ${red.length} 件` : ''}`)
  lines.push(`- 報告 ${MARKERS.map(([, l]) => `${l} ${counts[l]}`).join(' / ')}`)
  if (control?.[0]?.paused) lines.push(`- **ガバナー: paused** — ディスパッチは止まっている`)

  if (done.length) {
    lines.push('')
    lines.push('**完了**')
    lines.push(...listOf(done, (e) => `- ${e.display_id} ${e.title}`))
  }
  if (open.length) {
    lines.push('')
    lines.push('**進行中 / レビュー中**')
    lines.push(...listOf(open, (e) => `- ${e.display_id} ${e.title} — ${e.status}（更新 ${ago(e.updated_at)}）`))
  }
  if (red.length) {
    lines.push('')
    lines.push('**CI red**')
    lines.push(...listOf(red, (e) => `- ${e.ref} ${e.title}`))
  }
  return { lines, counts }
}

// ── compose ──────────────────────────────────────────────────────────────────

const { lines: act } = await activity()
const body = [
  `## 活動レポート — 直近 ${HOURS}h`,
  '',
  '**ループの状態**',
  ...health(),
  '',
  '**盤面の動き**',
  ...act,
].join('\n')

console.log(body)

if (POST) {
  const [campaign] = await rest(`strategies?name=eq.${encodeURIComponent(CAMPAIGN)}&select=id`)
  if (!campaign) {
    console.log(`\nFATAL Campaign 「${CAMPAIGN}」が見つからないので投稿できません`)
    process.exit(1)
  }
  // author_id stays null: the FK points at auth.users, and the AI worker is not
  // one. author_kind + author_name are what the board renders.
  await rest('strategy_comments', {
    method: 'POST',
    body: JSON.stringify({
      strategy_id: campaign.id,
      author_kind: 'ai_agent',
      author_name: 'Claude',
      content: body,
    }),
  })
  console.log(`\n→ Campaign「${CAMPAIGN}」に投稿しました`)
}
