#!/usr/bin/env node
// ESLint, scoped to changed files and ratcheted against the base branch.
//
// The workflow used to inline this as a shell one-liner, and it silently
// checked nothing for its entire life: the step runs with working-directory
// `web`, so the pathspec `web/src/**/*.ts` resolved against `web/` and looked
// for `web/web/src/...`. Nothing matched, the guard printed "No changed TS/TSX
// files", and the job went green over a branch carrying 12 ESLint errors. A
// gate that passes without looking is worse than no gate — it manufactures
// confidence. Hence a real script, with the git work done from a known root.
//
// Ratcheted for the same reason design-lint is (see #200): the tree carries
// ~135 pre-existing errors, so a plain gate would fail any PR that touched a
// large offender and would be routed around within a week. Only a net increase
// per file per rule fails; what was already broken is reported and tolerated.
//
// The base version is linted through ESLint's `lintText`, which resolves config
// from the file path while linting text we hand it. That keeps the working tree
// untouched — checking out base files in place would race the dev server and,
// on a machine running several sessions at once, could be seen by another.
//
//   node scripts/eslint-ratchet.mjs        # the gate
//   node scripts/eslint-ratchet.mjs --all  # whole tree, nothing forgiven

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { ratchet } from './designLintRules.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const LINTABLE = /\.(ts|tsx|mts)$/;

function baseRef() {
  for (const ref of ['origin/main', 'main']) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { cwd: ROOT, stdio: 'ignore' });
      return ref;
    } catch { /* try the next one */ }
  }
  return null;
}

const BASE = baseRef();

function changedFiles() {
  const range = BASE ? `${BASE}...HEAD` : 'HEAD';
  const out = execSync(`git diff --name-only ${range}; git diff --name-only HEAD`, {
    cwd: ROOT, encoding: 'utf8',
  });
  return [...new Set(out.split('\n').filter(Boolean))]
    .map((p) => p.replace(/^web\//, ''))
    .filter((p) => p.startsWith('src/') && LINTABLE.test(p))
    .filter((p) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile());
}

function allFiles() {
  return execSync(`git ls-files 'src/**/*.ts' 'src/**/*.tsx'`, { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

/** The file's content on the base branch, or null when it is new. */
function baseSource(file) {
  if (!BASE) return null;
  try {
    return execSync(`git show ${BASE}:web/${file}`, {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

// ESLint messages, shaped like design-lint findings so `ratchet` can budget
// them the same way: per rule, so fixing one rule can't buy a breach of another.
function toFindings(result, file) {
  return (result?.messages ?? [])
    .filter((m) => m.severity === 2 && m.ruleId)
    .map((m) => ({ file, line: m.line, rule: { id: m.ruleId }, message: m.message }));
}

const all = process.argv.includes('--all');
const targets = all ? allFiles() : changedFiles();

if (!targets.length) {
  console.log(`eslint-ratchet: 対象ファイルなし（mode=${all ? 'all' : 'changed'}）`);
  process.exit(0);
}

const eslint = new ESLint({ cwd: ROOT });
const findings = [];
const inherited = [];

for (const file of targets) {
  const abs = join(ROOT, file);
  const [current] = await eslint.lintFiles([abs]);
  const now = toFindings(current, file);
  if (!now.length) continue;
  if (all) { findings.push(...now); continue; }

  const before = baseSource(file);
  const wasBroken = before === null
    ? [] // new file — every error is this branch's
    : toFindings((await eslint.lintText(before, { filePath: abs }))[0], file);

  const split = ratchet(now, wasBroken);
  findings.push(...split.findings);
  inherited.push(...split.inherited);
}

const byRule = new Map();
for (const f of findings) byRule.set(f.rule.id, [...(byRule.get(f.rule.id) ?? []), f]);

for (const [id, items] of byRule) {
  console.log(`\n✗ ${id} — ${items.length} 件`);
  for (const f of items.slice(0, 12)) {
    console.log(`    web/${f.file}:${f.line}  ${f.message.split('\n')[0].slice(0, 100)}`);
  }
  if (items.length > 12) console.log(`    … 他 ${items.length - 12} 件`);
}

if (inherited.length) {
  console.log(`\nℹ 既存のエラー ${inherited.length} 件（base に既にあったもの — この PR では落としません）`);
}

console.log(
  findings.length
    ? `\neslint-ratchet: 新規エラー ${findings.length} 件 / ${targets.length} ファイル`
    : `eslint-ratchet: 新規エラーなし / ${targets.length} ファイル${inherited.length ? ` — 既存 ${inherited.length} 件は据え置き` : ''}`
);
process.exit(findings.length ? 1 : 0);
