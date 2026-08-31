// Reporting a failure as a transition rather than as a state.
//
// A watcher that cannot do its job has to say so — going quiet would turn its
// silence-means-healthy contract into a lie. But saying so on every tick is how
// a monitor gets muted, and a muted monitor is the same as no monitor. So the
// rule here is the one the rest of the loop already follows: report the edges.
// `dev_control.paused` prints on the flip; a stall re-prints when the silence
// doubles; the listener's diff carries only the fields that moved. Failures now
// obey the same discipline.
//
// Four edges, and nothing in between:
//
//   onset      the first failure of an episode
//   escalation the same failure, still going, after the outage has doubled
//   change     a different failure — a new episode, because `fetch failed`
//              becoming `401` is news and must not hide inside the old silence
//   recovery   working again, with how long it had been broken
//
// Deliberately pure: no fetch, no timers, no console. The caller passes the
// clock in and prints what comes back, which is what makes the discipline
// testable without a network to break.

/** How long an outage must last before it is worth announcing at all. */
const DEFAULT_GRACE_MS = 0

/**
 * What makes two failures the same failure.
 *
 * Too fine and the noise comes straight back: a message carrying a request id
 * or a timestamp would look like a new failure every tick, which is the shape
 * of the bug this module exists to remove. Too coarse and an outage that
 * changes character — the network coming back but the key having expired —
 * stays hidden inside a silence that was granted to a different problem.
 *
 * The line: an HTTP failure is identified by its status alone, because the
 * body is where servers put the varying part and the status is where they put
 * the kind. Everything else is identified by its text, with only the reliably
 * volatile pieces blanked — ids, hashes, clock readings. Small integers such
 * as a WebSocket close code survive, because those *are* the kind.
 */
export function faultSignature(message) {
  const text = String(message ?? '').trim()
  if (!text) return 'msg:'

  const status = text.match(/^(\d{3})\b/)
  if (status) return `http:${status[1]}`

  const normalized = text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#id')
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, '#time')
    .replace(/\b[0-9a-f]{12,}\b/g, '#hex')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  return `msg:${normalized}`
}

/**
 * Should an ongoing failure be re-reported now?
 *
 * The stall detector's rule, reused rather than re-invented: re-report when the
 * duration has doubled, with a one-unit floor so an episode that starts at zero
 * can still escalate. A twelve-hour outage costs a handful of lines that get
 * further apart, instead of one line lost in the far past or one line per tick.
 */
export function shouldEscalate(lastMinutes, currentMinutes) {
  return currentMinutes >= Math.max(lastMinutes * 2, lastMinutes + 1)
}

/** A duration a person can read at a glance. */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * A reporter for one failure mode of one watcher.
 *
 * One per *kind* of failure, not one per process. Two failure modes that
 * alternate — a socket that closes, then refuses the join, then closes — would
 * share an episode and announce on every alternation, which is the original
 * noise wearing a different hat. Give each its own reporter and each settles
 * into its own silence.
 *
 * @param options.subject  what is broken, e.g. `stall-check could not read the board`
 * @param options.restored what works again, e.g. `stall-check can read the board again`
 * @param options.graceMs  how long a failure must persist before it is announced.
 *                         Zero for a watcher whose ticks are already minutes
 *                         apart; a few seconds for a socket, where a reconnect
 *                         inside the backoff is routine rather than an outage.
 */
export function createFaultReporter(options = {}) {
  const subject = options.subject ?? 'failed'
  const restored = options.restored ?? 'recovered'
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS

  // The current outage, or null when things are working.
  //
  // Two clocks, because one would answer the wrong question. `startedAt` is
  // when *this* failure began and drives the escalation, so a failure that
  // changes character gets a fresh hearing rather than inheriting the silence
  // granted to the last one. `outageStartedAt` is when the machine last worked
  // — it survives every change of character, because that is the span the
  // recovery line has to account for. Both are when things broke, not when we
  // got around to saying so.
  let episode = null

  function minutesSince(startedAt, now) {
    return Math.floor((now - startedAt) / 60_000)
  }

  return {
    /**
     * A failure just happened. Returns the line to print, or null to stay quiet.
     */
    fault(message, now = Date.now()) {
      const signature = faultSignature(message)
      const text = String(message ?? '')

      if (!episode) {
        episode = { signature, message: text, startedAt: now, outageStartedAt: now, announcedMinutes: null }
      } else if (episode.signature !== signature) {
        const previous = episode
        const announced = previous.announcedMinutes != null
        episode = {
          signature,
          message: text,
          // Nothing said about the old failure means nobody has been told
          // anything at all yet, and the grace window is still measuring one
          // uninterrupted outage — so the new failure inherits its clock. Once
          // the old one has been announced, the new one is news in its own
          // right and starts counting now.
          startedAt: announced ? now : previous.startedAt,
          outageStartedAt: previous.outageStartedAt,
          announcedMinutes: announced ? 0 : null,
        }
        if (announced) {
          return `${subject}: ${text} — fault changed after ${formatDuration(now - previous.startedAt)} of: ${previous.message}`
        }
      } else {
        episode.message = text
      }

      const elapsed = now - episode.startedAt
      if (elapsed < graceMs) return null

      const minutes = minutesSince(episode.startedAt, now)
      if (episode.announcedMinutes == null) {
        episode.announcedMinutes = minutes
        return `${subject}: ${text}`
      }
      if (!shouldEscalate(episode.announcedMinutes, minutes)) return null
      episode.announcedMinutes = minutes
      return `${subject}: ${text} — still failing after ${formatDuration(elapsed)}`
    },

    /**
     * It worked. Returns the recovery line, or null when there was nothing to
     * recover from — including an outage short enough that nobody was told
     * about it, since un-announcing something is not worth a line.
     */
    ok(now = Date.now()) {
      if (!episode) return null
      const previous = episode
      episode = null
      if (previous.announcedMinutes == null) return null
      // The whole blind span, not just its last leg. A reader looking back at
      // the log needs to know which stretch of silence was the watcher working
      // and which was the watcher unable to see, and an outage that changed
      // character partway through was blind for all of it.
      return `${restored} — was down for ${formatDuration(now - previous.outageStartedAt)}, last fault: ${previous.message}`
    },

    /**
     * The outage as state, for somewhere that is polled rather than read.
     *
     * Suppressing the output is only half the job: a watcher that has gone
     * quiet because it is blind must not also *look* healthy, or the fix is
     * just the original bug with better manners. This goes in the lock file,
     * where `loop-report.mjs` reads it back.
     */
    status(now = Date.now()) {
      if (!episode) return null
      return {
        signature: episode.signature,
        message: episode.message,
        since: new Date(episode.outageStartedAt).toISOString(),
        elapsedMs: now - episode.outageStartedAt,
        for: formatDuration(now - episode.outageStartedAt),
        announced: episode.announcedMinutes != null,
      }
    },
  }
}
