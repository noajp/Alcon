// One holder per loop process, across every session and worktree.
//
// The listener and the stall detector are meant to be started unconditionally
// — by a session hook, by hand, by whatever — and to sort out among themselves
// which one actually runs. Without that, three concurrent Claude sessions mean
// three listeners, and every board change arrives as three identical
// notifications. Noise at that multiple is how a monitor gets muted, and a
// muted monitor is the same as no monitor.
//
// The lease is keyed on the repository rather than the working directory,
// because worktrees of one repo are one project sharing one board. It lives in
// the temp dir rather than inside .git so that no git tooling has to reason
// about a file it did not put there.
//
// Liveness is `kill(pid, 0)`: it signals nothing and throws when the process is
// gone. A crashed holder therefore leaves a lock that the next starter takes
// over rather than a lock that blocks the loop until someone notices.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, linkSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function repoKey() {
  try {
    // Asked from this file's own directory, not the process's cwd. The scope
    // being locked is "the checkout these scripts belong to", and a hook is
    // free to launch them from anywhere — resolving against cwd would put two
    // starters of the same script in different lock namespaces and let both
    // run.
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return createHash('sha256').update(common).digest('hex').slice(0, 16)
  } catch {
    // Outside a repo the caller is on their own; fall back to a fixed key so
    // two such processes still exclude each other.
    return 'no-repo'
  }
}

function lockPath(name) {
  return join(tmpdir(), `dev-loop-${repoKey()}-${name}.lock`)
}

function logPath(name) {
  return join(tmpdir(), `dev-loop-${repoKey()}-${name}.log`)
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists and belongs to someone else — still alive.
    return err.code === 'EPERM'
  }
}

function read(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Missing, unreadable or corrupt — all mean "no valid holder".
    return null
  }
}

// Publish ourselves as the holder, or fail because someone already is.
//
// `link` is the atomic primitive here, not the write: it fails with EEXIST
// rather than clobbering, so N processes starting at the same instant produce
// exactly one winner no matter how their syscalls interleave. Writing the
// payload first and linking it into place second means the file is never
// observable in a half-written state, which matters because the loser reads it
// to decide whether to give up.
function publish(path, payload) {
  const staging = `${path}.${process.pid}`
  try {
    writeFileSync(staging, payload, { flag: 'w' })
    linkSync(staging, path)
    return true
  } catch {
    return false
  } finally {
    try { unlinkSync(staging) } catch { /* already gone */ }
  }
}

/**
 * Try to become the single holder of `name`.
 *
 * Returns true when this process may run. Returns false when a live holder
 * already exists, and the caller is expected to exit silently: a hook that
 * starts this on every session must not print anything on the common path.
 */
export function claimLease(name) {
  const path = lockPath(name)
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })

  let won = false
  // Three passes is enough for every real interleaving: each failed pass means
  // some other process changed the file, and a process that changed the file
  // either holds the lease (we stop) or is itself about to.
  for (let attempt = 0; attempt < 3 && !won; attempt++) {
    if (publish(path, payload)) {
      won = true
      break
    }

    const held = read(path)
    if (held && held.pid === process.pid) {
      // Our own lock from a previous claim in this process.
      won = true
      break
    }
    if (held && alive(held.pid)) return false

    // A dead holder, or a corrupt file nobody can be holding. Re-read
    // immediately before removing it so we cannot delete a lock that a
    // competing starter has just taken over in the interval.
    const stillDead = read(path)
    if (stillDead?.pid !== held?.pid) continue
    try {
      unlinkSync(path)
    } catch {
      // Someone else reclaimed it first; the next pass will see their lock.
    }
  }

  if (!won) {
    // Every pass lost. If the file is unwritable rather than contended,
    // running is still better than not running: the worst case is the
    // duplicate notifications this exists to avoid, and the best case is a
    // loop that works on a read-only tmp dir.
    const held = read(path)
    if (held && held.pid !== process.pid && alive(held.pid)) return false
  }

  const release = () => {
    const held = read(path)
    if (held?.pid === process.pid) {
      try { unlinkSync(path) } catch { /* already gone */ }
    }
  }

  process.on('exit', release)
  // Without these, a killed holder leaves the lock behind. Liveness checking
  // makes that recoverable rather than fatal, but cleaning up is still better.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { release(); process.exit(0) })
  }

  held.set(name, path)
  return true
}

// Paths this process is currently the holder of, so note() and the log writer
// can refuse to touch a lock they do not own.
const held = new Map()

/**
 * Record something about this holder in the lock it already owns.
 *
 * The lock file is the only per-process state the loop has, and it is already
 * created, already cleaned up, and already keyed to the right scope. Liveness
 * belongs there rather than in a new file or a new table: "is the loop up?"
 * should not be a question that costs a migration to answer.
 *
 * Writes in place rather than through the link dance — the exclusion has
 * already been decided by then, and re-linking would mean unlinking our own
 * lock first, which is exactly the window where a competing starter could take
 * it. A torn read costs a caller one unparsable poll; a lost lock costs the
 * loop its exclusion.
 */
export function noteLease(name, patch) {
  const path = held.get(name)
  if (!path) return
  const current = read(path) || { pid: process.pid }
  try {
    writeFileSync(path, JSON.stringify({ ...current, ...patch, seenAt: new Date().toISOString() }))
  } catch { /* the loop must not die because tmp went read-only */ }
}

/**
 * What is holding `name`, if anything is. Returns null when the lock is
 * missing, unreadable, or names a process that is gone.
 */
export function readLease(name) {
  const state = read(lockPath(name))
  if (!state || !alive(state.pid)) return null
  return state
}

const LOG_CAP_BYTES = 256 * 1024

/**
 * Send this process's output to a log file it owns outright.
 *
 * The hook used to do this with a shell append, which meant nobody owned the
 * file: it grew without limit and outlived every process that had written to
 * it. Ownership fixes both ends. The holder truncates on start, caps the file
 * while running, and deletes it on a clean exit — so a stopped loop leaves
 * nothing behind, and the only log that survives is one whose writer crashed,
 * which is the only case where a log is worth reading.
 *
 * Losers never call this: they fail the lease and exit before writing a byte.
 */
export function attachLog(name) {
  const path = logPath(name)
  if (held.get(name) !== lockPath(name)) return
  try {
    writeFileSync(path, '')
  } catch {
    return // no writable tmp; keep printing to stdout and carry on
  }

  const write = (line) => {
    try {
      if (statSync(path).size > LOG_CAP_BYTES) writeFileSync(path, '')
      appendFileSync(path, `${line}\n`)
    } catch { /* never let logging take the loop down */ }
  }

  console.log = (...args) => write(args.join(' '))
  process.on('exit', () => { try { unlinkSync(path) } catch { /* already gone */ } })
}
