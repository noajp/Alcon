// Stop hook: before a session ends its turn, the TypeScript it changed must
// type-check and the tests touching it must pass ("変更後に必ず tsc と test").
//
// Only runs when the working tree has changes under web/src or web/tests,
// and only once per distinct set of changes (the last good fingerprint is
// kept in the temp dir), so a turn that only talks costs nothing. A failure
// exits 2: the agent sees the errors and keeps working instead of stopping.
// If the agent is already continuing because of this hook, it lets the stop
// through rather than looping.

import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { /* no input */ }
if (input.stop_hook_active) process.exit(0)

const sh = (c, cwd) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
let root
try { root = sh('git rev-parse --show-toplevel', input.cwd || process.cwd()) } catch { process.exit(0) }
const web = join(root, 'web')
if (!existsSync(join(web, 'node_modules', '.bin', 'tsc'))) process.exit(0)

const changed = sh('git status --porcelain --untracked-files=all -- web/src web/tests', root)
  .split('\n').filter(Boolean)
  .map((l) => l.slice(3).split(' -> ').pop())
  .filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(join(root, f)))
if (changed.length === 0) process.exit(0)

const fingerprint = createHash('sha1')
  .update(changed.map((f) => f + readFileSync(join(root, f), 'utf8')).join('\0'))
  .digest('hex')
const mark = join(tmpdir(), `alcon-stop-check-${createHash('sha1').update(root).digest('hex').slice(0, 10)}`)
if (existsSync(mark) && readFileSync(mark, 'utf8') === fingerprint) process.exit(0)

const run = (args) => spawnSync('npx', args, { cwd: web, encoding: 'utf8', timeout: 240_000 })
const tsc = run(['tsc', '--noEmit', '--pretty', 'false'])
if (tsc.status !== 0) {
  process.stderr.write(`check-on-stop: 型エラーがあります。直してから終えてください。\n${(tsc.stdout || tsc.stderr).split('\n').slice(0, 30).join('\n')}\n`)
  process.exit(2)
}
const rel = changed.map((f) => f.replace(/^web\//, ''))
const test = run(['vitest', 'related', '--run', '--passWithNoTests', ...rel])
if (test.status !== 0) {
  const out = (test.stdout + test.stderr).split('\n').filter((l) => /FAIL|✗|×|Error|expected/i.test(l)).slice(0, 30).join('\n')
  process.stderr.write(`check-on-stop: 変更に関わるテストが落ちています。直してから終えてください。\n${out}\n`)
  process.exit(2)
}
writeFileSync(mark, fingerprint)
process.exit(0)
