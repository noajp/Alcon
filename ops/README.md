# ops — the self-build loop's plumbing

Scripts that drive the Friction Self-Build loop. Not application code: nothing
here ships to Vercel, and nothing here should ever run in CI.

## What this replaces

The loop used to be driven by a clock — wake up every N minutes, ask the
database whether anything had changed, go back to sleep. That is polling a
source that already pushes. `elements`, `element_comments`, `element_assignees`,
`strategy_comments`, `dev_events` and `dev_control` are all in the
`supabase_realtime` publication, so a change on the board reaches a listener the
moment it is written.

The loop now runs on three event sources and one clock:

| Source | Mechanism | What it carries |
|---|---|---|
| Agent completion | harness-native | a dispatched agent finished — the dominant event, and the reason the loop ticks at the speed of the work rather than the speed of a timer |
| Board change | Supabase Realtime → `board-listen.mjs` | status moved, priority raised, element pulled into the sprint, a human commented, an order was written on a Campaign, feedback arrived from another team's board |
| Repo event | GitHub Actions → `dev_events` → same stream | CI went red, a PR landed, a review comment arrived |

Ask what any of it did with `loop-report.mjs`.

Almost all of that reports what execution did. Two kinds of comment run the
other way, and the listener draws the same line through both of them: does
this comment name the agent.

A Campaign comment is where intent is written, so one can be a request rather
than a report. `ORDER` when it names the agent, `CAMPAIGN` when it does not.
Only the first is work — [ADR 0012](../docs/adr/0012-naming-the-agent-is-what-makes-an-order.md)
is why the line is drawn there.

An Element comment gets the same test once another team's board is on the same
database. `COMMENT` for anything on Friction Dev's own Elements, reported
regardless of mention — it is our own conversation. `FEEDBACK` for a comment on
somebody else's Element that names the agent; a foreign comment that does not
is dropped without a line, on purpose — reading another team's working
conversation because it shares a database is surveillance, not context. Judging
what a piece of feedback is worth is [`.claude/skills/friction/FEEDBACK.md`](../.claude/skills/friction/FEEDBACK.md)'s
job, not the listener's — it only decides whether the line gets reported at
all. The decision logic for both `COMMENT`/`FEEDBACK` and the name resolution
that makes either one readable lives in `elementScope.mjs`, tested without a
socket in `web/tests/elementScope.test.ts`.

The clock does one job only: `stall-check.mjs`, the dead-man's switch. It never
asks whether there is work — the board pushes that. It asks whether something
that claimed to be working has gone quiet, which is the one question no event
can answer, because the event you are waiting for is the one that never arrives.

## When a watcher cannot do its job

Silence means healthy, so a watcher that has gone blind has to say so — reading
nothing off the board and reporting "no stalls" would turn its own contract into
a lie. It says so **once**. A failure is a transition, the same discipline the
rest of the loop already runs on: `dev_control.paused` prints on the flip, a
stall re-prints when the silence doubles, the listener's diff carries only the
fields that moved. Four lines exist and nothing in between:

- the first failure of an episode
- the same failure, still going, once the outage has **doubled** — so twelve
  hours of a dead network costs a handful of lines that get further apart,
  rather than one line in the distant past or one line every five minutes
- a **different** failure. `fetch failed` becoming `401` is news and must not
  hide inside a silence that was granted to the network being down. An HTTP
  failure is identified by its status, everything else by its text with the
  volatile parts blanked, so a body carrying a request id is still one fault
- recovery, with how long the watcher was blind — a stretch of silence read
  back later has to be tellable from a stretch of working

The listener holds a fifteen-second grace window on the socket: a reconnect
inside the backoff is a laptop lid, not an outage, and passes without a line in
either direction. Its two failure modes report separately, because a socket that
drops and a join the server refuses have different fixes and alternate with each
other.

Suppressing the repeat is only half the job — a watcher quiet because it is
blind must not also *look* healthy. The outage goes into the lock file as well
(`state: board unreadable for 8m — fetch failed`), where `loop-report.mjs` reads
it back. This is an availability property as much as a tidiness one: a monitor
muted for noise is a monitor lost, and the thing lost is the detector.

The rule is `faultReporter.mjs` — pure, with the clock passed in, tested in
`web/tests/faultReporter.test.ts`. Why it is drawn this way is
[ADR 0014](../docs/adr/0014-a-failure-is-a-transition.md).

## What this does not solve

**Unattended operation.** Both scripts run on the machine in front of you. Close
the laptop and the loop stops — including the stall detector, which is itself
something that has to be watched. What this buys is responsiveness and a single
place to drain events from while a session is alive, not a loop that runs
overnight. The only thing that gets that is a cloud routine, which is a separate
decision with a cost attached.

**Being asked.** The loop is meant to run quietly in the background, so the
question is not how to push its lines at anyone — it is how to get an answer
when someone asks. Both watchers are silent when healthy, and an open socket
that never subscribed produces exactly the same silence as a board where nobody
is working. So each holder records what it is actually doing in the lock file it
already owns, and `loop-report.mjs` reads it back — see
[ADR 0011](../docs/adr/0011-loop-state-lives-in-the-lock.md).

## Setup

Both scripts need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, read from the
environment or from `web/.env.local` (gitignored). The service role is
deliberate: a listener is not a signed-in user, so RLS would otherwise hand it
an empty stream and it would sit there looking healthy and reporting nothing.

It comes from the Supabase dashboard (Project Settings → API → service_role).
It is a secret with full read/write on the database — keep it in the gitignored
env file, and never pass it to a cloud routine or a CI job.

### CI → the board

The `report` job in `.github/workflows/ci.yml` files CI outcomes into
`dev_events` through the `dev-event` Edge Function. It needs one shared token,
the same value in two places:

- GitHub → repository Settings → Secrets and variables → Actions → `DEV_EVENT_TOKEN`
- Supabase → Edge Functions → Secrets → `DEV_EVENT_TOKEN`

Any long random string will do (`openssl rand -hex 32`). CI holds *only* this
token, never the service role: a workflow that holds the service role holds the
whole database, and any install script in `npm ci` could read it out of the
environment. The worst a leak of this token buys is a fake CI-failure event.

Until it is set the endpoint answers `500 DEV_EVENT_TOKEN not configured` and
the CI step skips itself without failing the build.

## Running

Nothing to start. The `SessionStart` hook in `.claude/settings.json` launches
both on every session, in every worktree, and `singleLease.mjs` settles which
one actually runs — see [ADR 0009](../docs/adr/0009-loop-starts-from-a-hook.md).
The holder writes to a log it owns outright — truncated at start, capped while
running, and **deleted on a clean exit**, so a stopped loop leaves nothing
behind. A log that survives is one whose writer crashed, which is the only case
where reading one is worth the trouble.

```bash
cat $TMPDIR/friction-loop-*-board-listen.log
```

Starting them by hand still works and is how you get each line as a
notification, under the Monitor tool:

```bash
node ops/board-listen.mjs
```

```bash
node ops/stall-check.mjs
```

If one is already running anywhere on the machine, a second start exits
immediately and silently rather than doubling every notification. To take over,
stop the holder first — the lock names the pid:

```bash
cat $TMPDIR/friction-loop-*-board-listen.lock
```

`stall-check` prints nothing while the board is moving — silence means healthy,
so it can run for a whole session without producing noise, and a board it cannot
read costs one line rather than one per tick. Check it once without arming a
watch; `--once` is a question rather than a watch, so it answers even while
another process holds the lease:

```bash
node ops/stall-check.mjs --once
```

Flags: `--warn-minutes 25` (how long an in-progress element may go without a
progress comment), `--interval-seconds 300`, `--once`.

## Asking what happened

```bash
node ops/loop-report.mjs
```

Health plus the last 24h of board movement, on one page. Health comes out of the
lock files rather than the logs: `state` says whether the listener actually
joined realtime, is only holding an open socket, or cannot reach the board at
all, and `seenAt` stops moving when a holder dies — which is the only thing that
separates a dead watcher from a healthy one, both being silent.

`--hours N` widens the diagnostic window. Current progress and risk belong in
**Friction Self-Build → Situation / Risk**, where the widgets derive the latest
state from the board. Diagnostic snapshots stay in stdout.

To record a decision or retrospective, write the narrative to a UTF-8 file and
supply its author explicitly:

```bash
node ops/loop-report.mjs --post ./retrospective.txt --author Codex
```

Only the file's content is posted; the diagnostic snapshot is never appended.
A bare `--post`, an empty file, or a missing author fails before board access.
Existing report comments remain as historical records.

## The governor

`dev_control` is a single row and it is the loop's brake. An event-driven loop
reacts faster than a scheduled one, which also means it runs away faster.

```sql
-- stop the loop; a running listener sees this immediately
update dev_control set paused = true, note = 'why', updated_at = now() where id = 1;

-- release it
update dev_control set paused = false, note = null, updated_at = now() where id = 1;
```

`max_concurrent` bounds how many implementation agents may be in flight at once.
Whatever dispatches work is responsible for honouring both — the listener
reports the flag flipping, it does not enforce it.

## Event ledger

`dev_events` is where anything that happens outside the database gets written so
it arrives on the same stream as everything else. One channel to drain instead
of three.

- `source` — `github` | `monitor` | `agent` | `human`
- `kind` — `ci_failed` | `ci_passed` | `pr_merged` | `review_comment` | `stalled`
- `ref` — PR number, element `display_id`, branch: whatever names the subject
- `title` — one line; this is what reaches the loop as a notification
- `consumed_at` — defined in the schema (with a partial index on `null`), but
  nothing writes it. Events reach a running listener over realtime the
  moment they're inserted, so nothing has ever needed to re-poll "what's
  still unconsumed" — as of this writing 112 of 113 rows sit at `null`
  forever. Treat the column as reserved, not as a working queue: don't build
  logic that reads it expecting completed events to be marked. Making it
  real (writing it when the loop acts on an event) or dropping it outright
  is an open decision (el_OPS-021) — until one of those lands, this ledger
  is append-only, not a queue.
