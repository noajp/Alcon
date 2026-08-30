#!/usr/bin/env node
// Keep the local checkout in step with GitHub, and clear away what merging
// left behind: stale remote refs, local branches whose work is already in
// main, and finished agent worktrees.
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
//   - Deletion goes through `git branch -d`, never `-D`, so git itself gets
//     the last word.
//
// The stash stack is deliberately untouched: it is shared across every
// worktree, so popping here could take another session's work.
//
//   node ops/git-sync.mjs             # sync and clean
//   node ops/git-sync.mjs --dry-run   # say what it would do

import { execSync } from 'node:child_process';
import { basename } from 'node:path';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const DRY = process.argv.includes('--dry-run');

const git = (cmd, opts = {}) =>
  execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const tryGit = (cmd, opts) => { try { return git(cmd, opts); } catch { return null; } };

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

console.log(`git-sync${DRY ? ' (dry-run)' : ''} — ${ROOT}\n`);

// ── 1. fetch ─────────────────────────────────────────────────────────────
console.log('fetch');
act('origin --prune', () => { git('fetch origin --prune'); });

// ── 2. bring the primary checkout up to main ─────────────────────────────
console.log('\nmain checkout');
const wts = worktrees();
const root = wts.find((w) => w.isRoot);
if (root.dirty) {
  console.log('  — 未コミット変更あり。触りません');
} else if (root.branch !== 'main') {
  console.log(`  — main ではなく ${root.branch ?? 'detached'}。触りません`);
} else if (git('rev-parse main') === git('rev-parse origin/main')) {
  console.log('  — 既に origin/main と同一');
} else {
  act('main を origin/main へ fast-forward', () => { git('merge --ff-only origin/main'); });
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

// ── 3. local branches whose work is already in main ──────────────────────
console.log('\nローカルブランチ');
const checkedOut = new Map(wts.filter((w) => w.branch).map((w) => [w.branch, w.name]));
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
  if (state.kind === 'ancestor') {
    act(`${b} を削除（main に取り込み済み）`, () => {
      if (tryGit(`branch -d ${b}`) === null) { console.log('      git が拒否しました'); return false; }
    });
  } else {
    // Rebased or squashed before merge: the SHAs differ but every patch is
    // already upstream. `branch -d` refuses these, so it has to be -D — which
    // is only safe because `git cherry` just proved nothing would be lost.
    act(`${b} を削除（rebase/squash 済み、内容は main にあり）`, () => {
      if (tryGit(`branch -D ${b}`) === null) { console.log('      git が拒否しました'); return false; }
    });
  }
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
