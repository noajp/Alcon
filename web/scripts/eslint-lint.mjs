#!/usr/bin/env node
// ESLint ratchet — same idea as design-lint.mjs, applied to ESLint itself.
// The tree carries ~135 pre-existing ESLint errors. Running eslint straight
// on every changed file (the old CI step) fails a PR for errors it never
// touched, just because they live in the same file — the exact problem the
// design-lint ratchet (b9b9a3d) was built to avoid. This scopes the gate the
// same way: only a net-new error in a changed file fails the build.
//
//   node scripts/eslint-lint.mjs            # changed files (the gate)
//   node scripts/eslint-lint.mjs --all      # whole tree (the audit)
//   node scripts/eslint-lint.mjs path/...   # explicit files

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ESLint } from 'eslint';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function resolveBase() {
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    base = 'main';
  }
  return base;
}

function changedFiles(base) {
  const out = execSync(`git diff --name-only ${base}...HEAD; git diff --name-only HEAD`, {
    cwd: ROOT, encoding: 'utf8',
  });
  return [...new Set(out.split('\n').filter(Boolean))]
    .map((p) => p.replace(/^web\//, ''))
    .filter((p) => /\.tsx?$/.test(p))
    .filter((p) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile());
}

function allFiles() {
  const out = execSync(`git ls-files 'src/**/*.ts' 'src/**/*.tsx'`, {
    cwd: ROOT, encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

// The same file on the base branch, or null when it is new there.
function baseSource(base, file) {
  try {
    return execSync(`git show ${base}:web/${file}`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

function ruleKey(msg) {
  return `${msg.ruleId ?? '(none)'}#${msg.severity}`;
}

function tally(messages) {
  const budget = new Map();
  for (const msg of messages) budget.set(ruleKey(msg), (budget.get(ruleKey(msg)) ?? 0) + 1);
  return budget;
}

const args = process.argv.slice(2);
const mode = args.includes('--all') ? 'all' : args.filter((a) => !a.startsWith('--')).length ? 'explicit' : 'changed';
const base = resolveBase();
const targets = (
  mode === 'all' ? allFiles()
  : mode === 'explicit' ? args.filter((a) => !a.startsWith('--')).map((p) => relative(ROOT, p).replace(/^web\//, ''))
  : changedFiles(base)
).filter((p) => /^src\//.test(p));

if (!targets.length) {
  console.log(`eslint-lint: 対象ファイルなし（mode=${mode}）`);
  process.exit(0);
}

const eslint = new ESLint({ cwd: ROOT });
const currentResults = await eslint.lintFiles(targets.map((f) => join(ROOT, f)));
const currentByFile = new Map(currentResults.map((r) => [relative(ROOT, r.filePath), r.messages]));

const findings = [];
const inherited = [];

if (mode === 'all') {
  // --all is an audit of everything that exists, so nothing is forgiven there.
  for (const file of targets) {
    for (const msg of currentByFile.get(file) ?? []) findings.push({ file, msg });
  }
} else {
  for (const file of targets) {
    const before = baseSource(base, file);
    const beforeMessages = before == null ? [] : (await eslint.lintText(before, { filePath: join(ROOT, file) }))[0]?.messages ?? [];
    // Match by rule + severity, not by line number — an unrelated edit
    // shifts lines. A count per rule is enough to tell "you added one" from
    // "it was already like this", without pretending we can attribute
    // individual lines.
    const budget = tally(beforeMessages);
    for (const msg of currentByFile.get(file) ?? []) {
      const key = ruleKey(msg);
      const left = budget.get(key) ?? 0;
      if (left > 0) { budget.set(key, left - 1); inherited.push({ file, msg }); }
      else findings.push({ file, msg });
    }
  }
}

const newErrors = findings.filter((f) => f.msg.severity === 2);
const newWarnings = findings.filter((f) => f.msg.severity === 1);

function group(items) {
  const byRule = new Map();
  for (const f of items) byRule.set(f.msg.ruleId ?? '(none)', [...(byRule.get(f.msg.ruleId ?? '(none)') ?? []), f]);
  return byRule;
}

function printGroup(mark, label, items) {
  for (const [ruleId, group] of items) {
    console.log(`\n${mark} ${ruleId} — ${group.length} 件${label}`);
    for (const f of group.slice(0, 12)) {
      console.log(`    web/${f.file}:${f.msg.line}  ${f.msg.message.replace(/\n/g, ' ').slice(0, 140)}`);
    }
    if (group.length > 12) console.log(`    … 他 ${group.length - 12} 件`);
  }
}

printGroup('✗', '（error）', group(newErrors));
printGroup('⚠', '（warning）', group(newWarnings));

if (inherited.length) {
  console.log(`\nℹ 既存の違反 ${inherited.length} 件（base に既にあったもの — この PR では落としません）`);
  console.log('  触れたついでに直せるなら直してください。まとめて直すなら npm run eslint-lint:all');
}

console.log(
  newErrors.length || newWarnings.length
    ? `\neslint-lint: 新規エラー ${newErrors.length} 件 / 新規警告 ${newWarnings.length} 件 / ${targets.length} ファイル（mode=${mode}）`
    : `eslint-lint: 新規違反なし / ${targets.length} ファイル（mode=${mode}）${inherited.length ? ` — 既存 ${inherited.length} 件は据え置き` : ''}`
);
process.exit(newErrors.length ? 1 : 0);
