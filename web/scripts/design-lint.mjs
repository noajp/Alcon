#!/usr/bin/env node
// Design-system lint — the write-time gate for the rules in .claude/CLAUDE.md
// that ESLint can't express. These are house rules about how the UI is allowed
// to look, and until now nothing checked them: a sweep in Aug 2026 found ~40
// uppercase labels, ~120 hardcoded colors and 19 ringed inputs that had piled
// up precisely because the rules lived only in prose.
//
// Default mode is --changed (files differing from origin/main), NOT the whole
// tree. With that much existing debt a whole-tree gate would fire on every PR
// and get ignored within a week; scoping it to what you touched makes it
// enforceable today and lets the backlog drain through dedicated cleanup PRs.
//
// Within those files it is a ratchet: violations that already existed on the
// base branch are reported but do not fail. Only a net increase fails. The
// first PR to hit the file-scoped version was blocked by dead code it merely
// sat next to — correct to clean up, wrong to demand, and a guarantee that
// anyone touching a large offender like ListTable.tsx would be stuck. Same
// rule we already apply to ESLint by hand: compare against the base, allow
// what was already broken, refuse to make it worse.
//
//   node scripts/design-lint.mjs            # changed files (the gate)
//   node scripts/design-lint.mjs --all      # whole tree (the audit)
//   node scripts/design-lint.mjs path/...   # explicit files
//
// Escape hatch: put `design-lint-ignore` in a comment on the offending line or
// the line above it, with a reason. Deliberate exceptions should be visible.
//
// This file is only the CLI: which files to look at, what the base branch had,
// and how to print the result. The rules, the matcher (`scan`) and the ratchet
// itself live in `designLintRules.mjs`, which is pure and unit-tested.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ratchet, scan } from './designLintRules.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function changedFiles() {
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    base = 'main';
  }
  // `git diff` lists tracked changes only, so a file that has never been added
  // was never scanned — a brand-new component could carry any violation and the
  // run would say nothing, then CI would say otherwise the moment it landed.
  // Untracked files have no base version, so the ratchet forgives nothing in
  // them, which is the right standard for code that did not exist before.
  const out = execSync(
    `git diff --name-only ${base}...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard`,
    { cwd: ROOT, encoding: 'utf8' },
  );
  return [...new Set(out.split('\n').filter(Boolean))]
    .map((p) => p.replace(/^web\//, ''))
    .filter((p) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile());
}

function allFiles() {
  const out = execSync(`git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.css'`, {
    cwd: ROOT, encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

const args = process.argv.slice(2);
const mode = args.includes('--all') ? 'all' : args.filter((a) => !a.startsWith('--')).length ? 'explicit' : 'changed';
const targets = (
  mode === 'all' ? allFiles()
  : mode === 'explicit' ? args.filter((a) => !a.startsWith('--')).map((p) => relative(ROOT, p).replace(/^web\//, ''))
  : changedFiles()
).filter((p) => /^src\//.test(p));

// The same file on the base branch, or null when it is new there.
function baseSource(file) {
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    base = 'main';
  }
  try {
    return execSync(`git show ${base}:web/${file}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const findings = [];
const inherited = [];
for (const file of targets) {
  const full = join(ROOT, file);
  if (!existsSync(full)) continue;
  const current = scan(file, readFileSync(full, 'utf8'));
  if (!current.length) continue;
  // --all is an audit of everything that exists, so nothing is forgiven there.
  if (mode === 'all') { findings.push(...current); continue; }
  const split = ratchet(current, scan(file, baseSource(file) ?? ''));
  findings.push(...split.findings);
  inherited.push(...split.inherited);
}

if (!targets.length) {
  console.log(`design-lint: 対象ファイルなし（mode=${mode}）`);
  process.exit(0);
}

const byRule = new Map();
for (const f of findings) byRule.set(f.rule.id, [...(byRule.get(f.rule.id) ?? []), f]);

for (const [id, items] of byRule) {
  const { message, fix } = items[0].rule;
  console.log(`\n✗ ${id} — ${items.length} 件`);
  console.log(`  規則: ${message}`);
  console.log(`  直し方: ${fix}`);
  for (const f of items.slice(0, 12)) console.log(`    web/${f.file}:${f.line}  ${f.snippet}`);
  if (items.length > 12) console.log(`    … 他 ${items.length - 12} 件`);
}

if (inherited.length) {
  console.log(`\nℹ 既存の違反 ${inherited.length} 件（base に既にあったもの — この PR では落としません）`);
  console.log('  触れたついでに直せるなら直してください。まとめて直すなら npm run design-lint:all');
}

console.log(
  findings.length
    ? `\ndesign-lint: 新規違反 ${findings.length} 件 / ${targets.length} ファイル（mode=${mode}）`
    : `design-lint: 新規違反なし / ${targets.length} ファイル（mode=${mode}）${inherited.length ? ` — 既存 ${inherited.length} 件は据え置き` : ''}`
);
process.exit(findings.length ? 1 : 0);
