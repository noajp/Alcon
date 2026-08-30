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

// `git rev-parse --show-toplevel` answers "which checkout am I in", not "which
// is the primary one" — run from a worktree it returns that worktree. Every
// command here has to be anchored to the primary checkout instead, because
// that is the thing being brought up to main. `git worktree list` always names
// it first.
const HERE = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const ROOT = execSync('git worktree list --porcelain', { cwd: HERE, encoding: 'utf8' })
  .split('\n')[0].slice('worktree '.length).trim();
const DRY = process.argv.includes('--dry-run');

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

const act = (label, fn) => {
  if (DRY) { console.log(`  [dry-run] ${label}`); return true; }
  const out = fn();
  console.log(`  ${out === false ? '✗' : '✓'} ${label}`);
  return out !== false;
};

// ── worktrees ────────────────────────────────────────────────────────────
function worktrees() {
  const out = git('worktree list --porcelain');
  const list = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null, detached: false }; list.push(cur); }
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line === 'detached') cur.detached = true;
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
  if (!behind) return { kind: 'ancestor' };
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
  const why = state.kind === 'ancestor' ? 'main に取り込み済み' : 'rebase/squash 済み、内容は main にあり';
  act(`${b} を削除（${why}）`, () => {
    const err = gitErr(`branch -D ${b}`);
    if (err) { console.log(`      ${err}`); return false; }
  });
}

// ── 4. finished agent worktrees ──────────────────────────────────────────
console.log('\nagent worktree');
const agents = wts.filter((w) => w.isAgent);
if (!agents.length) console.log('  — なし');
for (const w of agents) {
  if (w.dirty) { console.log(`  — ${w.name}: 未コミット変更あり。触りません`); continue; }
  const unique = w.branch ? git(`log --oneline origin/main..${w.branch}`) : '';
  if (unique) { console.log(`  — ${w.name}: 未マージのコミットあり。触りません`); continue; }
  act(`${w.name} を削除`, () => { git(`worktree remove ${w.path}`); });
}
if (!DRY) tryGit('worktree prune');

// ── 5. what is left, and why ─────────────────────────────────────────────
console.log('\n残っているもの');
for (const w of worktrees()) {
  if (w.isRoot) continue;
  const why = w.dirty ? '未コミット変更' : w.isAgent ? '未マージ' : 'セッション作業場';
  console.log(`  ${w.name} [${w.branch ?? 'detached'}] — ${why}`);
}
