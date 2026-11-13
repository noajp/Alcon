#!/usr/bin/env node
// Renames the product everywhere it is a display name, in one run.
//
//   node .claude/ops/rename-product.mjs <NewName>            # rewrite
//   node .claude/ops/rename-product.mjs <NewName> --dry-run  # count only
//
// What changes: every case-sensitive "Clayware" in tracked text files (docs, UI
// strings, component and file names such as ClaywareCopilotPanel.tsx), and the
// skill folder .claude/skills/clayware with its `name:`. CURRENT below is
// rewritten too, so the next run starts from the new name.
//
// What does not: lowercase and upper-case identifiers that something outside
// this repo already depends on — Edge Function names (clayware-mcp, clayware-api,
// clayware-copilot), HTTP headers (x-clayware-*), env vars and secrets (CLAYWARE_*),
// the SDK file names, token prefixes. Renaming those means redeploying and
// telling every caller, so they stay. supabase/migrations is history that has
// already run, so it stays too.

import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CURRENT = 'Clayware'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const next = args.find(a => !a.startsWith('--'))
if (!next || !/^[A-Z][A-Za-z0-9]*$/.test(next)) {
  console.error('usage: node .claude/ops/rename-product.mjs <NewName> [--dry-run]   (NewName: a capitalised word, e.g. Orbit)')
  process.exit(2)
}
if (next === CURRENT) {
  console.log(`already ${CURRENT}`)
  process.exit(0)
}

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' })

const SKIP = [/^supabase\/migrations\//, /(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|pyc|zip)$/i]
const oldSkill = `.claude/skills/${CURRENT.toLowerCase()}`
const newSkill = `.claude/skills/${next.toLowerCase()}`

// 1. contents
const files = git('grep', '-lI', '-e', CURRENT, '-e', oldSkill.slice('.claude/'.length), '--', '.')
  .split('\n').filter(Boolean).filter(f => !SKIP.some(re => re.test(f)))
let hits = 0
for (const f of files) {
  const path = join(root, f)
  const before = readFileSync(path, 'utf8')
  let after = before.split(CURRENT).join(next)
  after = after.split(oldSkill.slice('.claude/'.length)).join(newSkill.slice('.claude/'.length))
  if (f === `${oldSkill}/SKILL.md`) after = after.replace(/^name: .*$/m, `name: ${next.toLowerCase()}`)
  if (after === before) continue
  hits += before.split(CURRENT).length - 1
  if (!dryRun) writeFileSync(path, after)
}

// 2. file and folder names
const renames = git('ls-files').split('\n').filter(Boolean)
  .filter(f => !SKIP.some(re => re.test(f)))
  .filter(f => f.includes(CURRENT) || f.startsWith(`${oldSkill}/`))
  .map(f => [f, f.split(CURRENT).join(next).replace(`${oldSkill}/`, `${newSkill}/`)])
if (!dryRun) {
  for (const [from, to] of renames) {
    execFileSync('mkdir', ['-p', join(root, to, '..')])
    git('mv', from, to)
  }
  rmSync(join(root, oldSkill), { recursive: true, force: true })
}

console.log(`${dryRun ? '[dry-run] ' : ''}${CURRENT} → ${next}: ${hits} occurrences in ${files.length} files, ${renames.length} files renamed`)
for (const [from, to] of renames) console.log(`  ${from} → ${to}`)
console.log(`
Not changed here — do these by hand if they should follow:
  - Domain / Space / Initiative names in the database that contain "${CURRENT}"
  - the repository and its local folder name, the Vercel project, the website/ copy deck if it is published elsewhere
  - lowercase identifiers (Edge Function names, x-${CURRENT.toLowerCase()}-* headers, ${CURRENT.toUpperCase()}_* env vars, SDK file names)
Then run: cd web && npx tsc --noEmit && npm test`)
