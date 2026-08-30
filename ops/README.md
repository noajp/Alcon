# ops — the self-build loop's plumbing

Scripts that drive the Friction Self-Build loop. Not application code: nothing
here ships to Vercel, and nothing here should ever run in CI.

## What this replaces

The loop used to be driven by a clock — wake up every N minutes, ask the
database whether anything had changed, go back to sleep. That is polling a
source that already pushes. `elements`, `element_comments`, `element_assignees`,
`dev_events` and `dev_control` are all in the `supabase_realtime` publication,
so a change on the board reaches a listener the moment it is written.

The loop now runs on three event sources and one clock:

| Source | Mechanism | What it carries |
|---|---|---|
| Agent completion | harness-native | a dispatched agent finished — the dominant event, and the reason the loop ticks at the speed of the work rather than the speed of a timer |
| Board change | Supabase Realtime → `board-listen.mjs` | status moved, priority raised, element pulled into the sprint, a human commented |
| Repo event | GitHub Actions → `dev_events` → same stream | CI went red, a PR landed, a review comment arrived |

The clock does one job only: `stall-check.mjs`, the dead-man's switch. It never
asks whether there is work — the board pushes that. It asks whether something
that claimed to be working has gone quiet, which is the one question no event
can answer, because the event you are waiting for is the one that never arrives.

## What this does not solve

**Unattended operation.** Both scripts run on the machine in front of you. Close
the laptop and the loop stops — including the stall detector, which is itself
something that has to be watched. What this buys is responsiveness and a single
place to drain events from while a session is alive, not a loop that runs
overnight. The only thing that gets that is a cloud routine, which is a separate
decision with a cost attached.

## Setup

Both scripts need `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, read from the
environment or from `web/.env.local` (gitignored). The service role is
deliberate: a listener is not a signed-in user, so RLS would otherwise hand it
an empty stream and it would sit there looking healthy and reporting nothing.

`web/.env.local` currently has the `SUPABASE_SERVICE_ROLE_KEY=` line present but
empty. Fill it from the Supabase dashboard (Project Settings → API → service_role).
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

Under the Monitor tool, so each printed line becomes a notification:

```bash
node ops/board-listen.mjs
```

```bash
node ops/stall-check.mjs
```

`stall-check` prints nothing while the board is moving — silence means healthy,
so it can run for a whole session without producing noise. Check it once without
arming a watch:

```bash
node ops/stall-check.mjs --once
```

Flags: `--warn-minutes 25` (how long an in-progress element may go without a
progress comment), `--interval-seconds 300`, `--once`.

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
- `consumed_at` — set when the loop has acted on it; `null` means still queued
