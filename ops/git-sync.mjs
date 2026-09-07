#!/usr/bin/env node
// Keep the primary checkout in step with GitHub, and clear away what merging
// left behind: stale remote refs, local branches whose work is already in
// main, and finished agent worktrees. Runnable from any worktree — it always
// acts on the primary checkout, not on wherever it was invoked.
//
// This was a hand-run sequence (`fetch` / `merge --ff-only` / `branch -D` /
// `worktree remove`) repeated after every merge, which is exactly the kind of
// thing that gets skipped when a session ends mid-flow — and then the next one
// starts against a stale tree.
//
// Safety is the whole design. Several Claude sessions work in this repo at
// once, each in its own worktree, and a sweep that guessed wrong would destroy
// someone's uncommitted work (it has happened: see the risk register). So:
//
//   - A worktree with ANY uncommitted change is never touched, full stop.
//   - A locked worktree is never removed and never unlocked. The harness locks
//     an agent worktree for as long as the agent lives, and a just-started one
//     is clean with zero unique commits — the lock is the only thing that
//     distinguishes "just started" from "finished".
//   - A branch checked out anywhere is never deleted.
//   - A branch holding commits that are not in origin/main is never deleted,
//     even if its remote is gone — that is unpushed work, not leftovers.
//   - Only `agent-*` worktrees are removed. Session worktrees belong to a
//     session, and this script has no way to know whether it is still alive.
//   - Nothing is deleted until `git cherry` has proved every one of its
//     patches is already in origin/main.
//
// The stash stack is deliberately untouched: it is shared across every
// worktree, so popping here could take another session's work.
//
//   node ops/git-sync.mjs             # sync and clean
//   node ops/git-sync.mjs --dry-run   # say what it would do

import { execSync } from 'node:child_process';
import { basename } from 'node:path';

// Unknown arguments abort before anything runs. The dangerous typo is
// `--dry` for `--dry-run`: ignoring it would turn a requested preview into a
// real sweep, silently.
const ARGS = process.argv.slice(2);
const BAD = ARGS.filter((a) => a !== '--dry-run');
if (BAD.length) {
  console.error(`不明な引数: ${BAD.join(' ')}\n使い方: node ops/git-sync.mjs [--dry-run]`);
  process.exit(1);
}
// `npm run sync --dry-run` never reaches argv: npm keeps the flag as its own
// config and runs the script anyway, with npm_config_dry_run=true in the
// environment. Honoring that env var keeps the natural spelling a preview
// instead of a silent real sweep. (`npm run sync:dry` is the documented path.)
const DRY = ARGS.includes('--dry-run') || process.env.npm_config_dry_run === 'true';

// `git rev-parse --show-toplevel` answers "which checkout am I in", not "which
// is the primary one" — run from a worktree it returns that worktree. Every
// command here has to be anchored to the primary checkout instead, because
// that is the thing being brought up to main. `git worktree list` always names
// it first.
const HERE = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const ROOT = execSync('git worktree list --porcelain', { cwd: HERE, encoding: 'utf8' })
  .split('\n')[0].slice('worktree '.length).trim();

const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryGit = (cmd, opts) => { try { return git(cmd, opts); } catch { return null; } };
// Same, but keeps git's own first line of stderr. Guessing at why a command
// failed sends whoever reads the output to check the wrong thing.
const gitErr = (cmd, opts) => {
  try { git(cmd, opts); return null; } catch (e) {
    const said = String(e.stderr || e.message || '').trim().split('\n')[0];
    return said || 'git が理由を言わずに失敗しました';
  }
};

// A sweep where something failed must not exit 0 — callers read the exit
// status as "everything it promised got done".
let FAILED = false;
const act = (label, fn) => {
  if (DRY) { console.log(`  [dry-run] ${label}`); return true; }
  const out = fn();
  console.log(`  ${out === false ? '✗' : '✓'} ${label}`);
  if (out === false) FAILED = true;
  return out !== false;
};

// ── worktrees ────────────────────────────────────────────────────────────
function worktrees() {
  const out = git('worktree list --porcelain');
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, detached: false, locked: false, lockReason: null }; list.push(cur); }
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'locked' || line.startsWith('locked ')) { cur.locked = true; cur.lockReason = line.slice(7).trim() || null; }
  }
  for (const w of list) {
    const st = tryGit('status --porcelain', { cwd: w.path });
    // Unreadable means something is wrong with it — treat as dirty, i.e. hands off.
    w.dirty = st === null ? true : st.length > 0;
    w.name = basename(w.path);
    w.isRoot = w.path === ROOT;
    w.isAgent = /^agent-/.test(w.name);
  }
  return list;
}

// Is this branch's work already in main?
//
// A plain ancestry check is not enough here: branches get rebased onto main
// right before merging, so the merged commits carry different SHAs and
// `origin/main..branch` still lists the pre-rebase originals. `git cherry`
// compares patch content instead and marks a commit `-` when an equivalent
// one is already upstream — the only reliable way to tell "already merged,
// different SHA" from "genuinely unmerged work".
function mergedState(branch) {
  const behind = git(`log --oneline origin/main..${branch}`);
  if (!behind) {
    // Zero commits ahead of main means one of two things, and only one of
    // them is "merged": either the branch's work landed and main moved on
    // (an ancestor), or nothing was ever committed on it. The two are
    // identical to `git cherry` — there is no patch to compare. A tip that
    // still equals origin/main is the second case for certain; a tip behind
    // main might be either, and the log must not call it "merged" as if
    // work had landed (ELE_OPS-042: an agent that stalled before its first
    // commit was swept as "取り込み済み").
    const same = git(`rev-parse ${branch}`) === git('rev-parse origin/main');
    return { kind: same ? 'untouched' : 'ancestor' };
  }
  const cherry = git(`cherry origin/main ${branch}`).split('\n').filter(Boolean);
  const missing = cherry.filter((l) => l.startsWith('+'));
  return missing.length
    ? { kind: 'unmerged', count: missing.length }
    : { kind: 'equivalent' };
}

console.log(`git-sync${DRY ? ' (dry-run)' : ''} — ${ROOT}${ROOT === HERE ? '' : `（実行元: ${basename(HERE)}）`}\n`);

// ── 1. fetch ─────────────────────────────────────────────────────────────
console.log('fetch');
act('origin --prune', () => { git('fetch origin --prune'); });

// ── 2. bring the primary checkout up to main ─────────────────────────────
//
// A session that finishes on a feature branch leaves the primary checkout
// parked there, and it then falls behind every merge that follows — which is
// invisible until something reads a file out of it and gets an old answer.
// So being on the wrong branch is a state to recover from, not a reason to
// stop: if the branch it is sitting on is already in main, move it back.
console.log('\nmain checkout');
let wts = worktrees();
const root = wts.find((w) => w.isRoot);
// The branch the recovery releases. Step 3 may then delete it — and a
// --dry-run that did not track this would preview the branch as still in use
// and quietly omit a deletion the real run performs.
let freed = null;
// A session worktree holding `main` blocks the move — and blocks
// `gh pr merge --delete-branch` for every session on this machine, which is
// how a merged branch survives on the remote.
const mainHolder = wts.find((w) => w.branch === 'main' && !w.isRoot);
if (root.dirty) {
  console.log('  — 未コミット変更あり。触りません');
} else if (root.branch !== 'main') {
  const parked = root.branch;
  const state = parked ? mergedState(parked) : { kind: 'detached' };
  if (state.kind === 'unmerged') {
    console.log(`  — ${parked}: main に無いコミット ${state.count} 件。触りません`);
  } else if (state.kind === 'detached') {
    console.log('  — detached HEAD。触りません');
  } else if (mainHolder) {
    // Knowable up front, so --dry-run must not promise a move that would fail.
    console.log(`  — main を ${mainHolder.name} が使用中。触りません`);
  } else if (act(`main へ戻す（${parked} は main に取り込み済み）`, () => {
    const err = gitErr('checkout main');
    if (err) { console.log(`      ${err}`); return false; }
  })) {
    freed = parked;
    if (!DRY) wts = worktrees();
  }
}

const onMain = wts.find((w) => w.isRoot);
if (freed || (onMain.branch === 'main' && !onMain.dirty)) {
  if (git('rev-parse main') === git('rev-parse origin/main')) {
    console.log('  — 既に origin/main と同一');
  } else {
    act('main を origin/main へ fast-forward', () => { git('merge --ff-only origin/main'); });
  }
}

// ── 3. local branches whose work is already in main ──────────────────────
console.log('\nローカルブランチ');
const checkedOut = new Map(wts.filter((w) => w.branch && w.branch !== freed).map((w) => [w.branch, w.name]));
const branches = git("for-each-ref --format='%(refname:short)' refs/heads").split('\n').filter(Boolean);

for (const b of branches) {
  if (b === 'main') continue;
  const holder = checkedOut.get(b);
  if (holder) { console.log(`  — ${b}: ${holder} が使用中`); continue; }
  const state = mergedState(b);
  if (state.kind === 'unmerged') {
    console.log(`  — ${b}: main に無いコミット ${state.count} 件。残します`);
    continue;
  }
  // `git branch -d` looks like a second opinion, but it is answering a
  // different question: it checks the branch against the *current HEAD* and
  // its upstream. git-sync anchors to the primary checkout, and does not get
  // to choose what that checkout is sitting on — so a checkout parked on a
  // stale branch made `-d` refuse branches that origin/main fully contained.
  // Measured: `claude/fric-ops-sync-root`, zero commits ahead of origin/main,
  // rejected as `not fully merged` because HEAD was 29 commits behind. That is
  // how six merged branches accumulated while a sweep ran after every merge.
  //
  // The real check is the one above — `git cherry` against origin/main, which
  // is the ref that decides whether work is safe, and is the same ref whether
  // the checkout is on main or not. Once it has passed, `-d` can only produce
  // a false refusal, so the deletion goes through `-D`.
  const why = state.kind === 'untouched'
    ? 'コミット0件 — 未着手のまま（origin/main と同一）'
    : state.kind === 'ancestor'
      ? '差分コミット0件 — main に含まれる（未着手の可能性あり）'
      : 'rebase/squash 済み、内容は main にあり';
  act(`${b} を削除（${why}）`, () => {
    const err = gitErr(`branch -D ${b}`);
    if (err) { console.log(`      ${err}`); return false; }
  });
}

// ── 4. finished agent worktrees ──────────────────────────────────────────
console.log('\nagent worktree');
const agents = wts.filter((w) => w.isAgent);
if (!agents.length) console.log('  — なし');
const removeFailed = new Set();
for (const w of agents) {
  // The sweep must never take out the tree it is running from — HERE can be
  // an agent worktree, and every guard below could wave a clean one through.
  if (w.path === HERE) { console.log(`  — ${w.name}: 実行元です。触りません`); continue; }
  // Locked means a live session is holding it — the clean/merged checks below
  // cannot see that (a just-started worktree passes both). Removing one is
  // also a hard `fatal:` that used to kill the whole sweep mid-run. Never
  // force, never unlock: skip, say why, and keep cleaning the rest.
  if (w.locked) { console.log(`  — ${w.name}: locked（${w.lockReason ?? '理由未記載'}）。使用中につき触りません`); continue; }
  if (w.dirty) { console.log(`  — ${w.name}: 未コミット変更あり。触りません`); continue; }
  // The same merged test the branch sweep uses: a plain `origin/main..` check
  // lies after the rebase that normally precedes a merge, and would hold a
  // finished worktree hostage forever. A branch whose state cannot be read is
  // a branch this script does not understand — leave it, do not crash.
  let state;
  try { state = w.branch ? mergedState(w.branch) : { kind: 'ancestor' }; }
  catch { console.log(`  — ${w.name}: ブランチの状態を読めません。触りません`); continue; }
  if (state.kind === 'unmerged') { console.log(`  — ${w.name}: main に無いコミット ${state.count} 件。触りません`); continue; }
  // Removal is still right for a zero-commit worktree — nothing committed
  // means nothing to lose, and `dirty` above already protects uncommitted
  // work — but the log must say what was actually found, not "merged".
  const because = state.kind === 'untouched'
    ? 'コミット0件・未着手のまま'
    : state.kind === 'ancestor'
      ? '差分コミット0件、main に含まれる'
      : '内容は main にあり';
  // A lock can appear between the listing above and this removal — a failure
  // here must not stop the sweep for the worktrees still in the list.
  const ok = act(`${w.name} を削除（${because}）`, () => {
    const err = gitErr(`worktree remove ${w.path}`);
    if (err) { console.log(`      ${err}`); return false; }
  });
  if (!ok) removeFailed.add(w.path);
}
if (!DRY) tryGit('worktree prune');

// ── 5. what is left, and why ─────────────────────────────────────────────
console.log('\n残っているもの');
for (const w of worktrees()) {
  if (w.isRoot) continue;
  const why = removeFailed.has(w.path)
    ? '削除に失敗（上のログ参照）'
    : w.isAgent && w.path === HERE
      ? '実行元'
      : [w.locked && 'locked（使用中）', w.dirty && '未コミット変更'].filter(Boolean).join(' + ')
        || (w.isAgent ? '未マージ' : 'セッション作業場');
  console.log(`  ${w.name} [${w.branch ?? 'detached'}] — ${why}`);
}
if (FAILED) process.exitCode = 1;
