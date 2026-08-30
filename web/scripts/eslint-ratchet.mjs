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
// ~135 errors and ~124 warnings, so a plain gate would fail any PR that
// touched a large offender and would be routed around within a week. Only a
// net increase per file per rule fails; what was already broken is printed as
// a backlog and tolerated. Being answerable for a file you moved, or for a
// warning you left behind, would be the same unfair gate in a smaller costume,
// so a rename keeps its baseline and warnings are ratcheted too — reported on
// their own line, and, as with `npm run lint`, never fatal. Which problems
// block is the ESLint config's call; a ratchet only decides when.
//
// The base version is linted through ESLint's `lintText`, which resolves config
// from the file path while linting text we hand it. That keeps the working tree
// untouched — checking out base files in place would race the dev server and,
// on a machine running several sessions at once, could be seen by another.
//
//   node scripts/eslint-ratchet.mjs        # the gate
//   node scripts/eslint-ratchet.mjs --all  # whole tree, nothing forgiven

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { groupByRule, ratchetBySeverity, toFindings } from './eslintFindings.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const LINTABLE = /\.(ts|tsx|mts)$/;
const MAX_LINES = 12; // per rule, in the report

/** @param {string} cmd */
function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function baseRef() {
  for (const ref of ['origin/main', 'main']) {
    if (git(`git rev-parse --verify ${ref}`).trim()) return ref;
  }
  return null;
}

const BASE = baseRef();

function changedFiles() {
  const out = [
    git(`git diff --name-only ${BASE ? `${BASE}...HEAD` : 'HEAD'}`),
    git('git diff --name-only HEAD'), // uncommitted edits to tracked files
    git('git ls-files --others --exclude-standard'), // not committed yet
  ].join('\n');
  // `git diff` prints repo-root-relative paths and `git ls-files` cwd-relative
  // ones; both land on `src/…` once an optional `web/` is off the front.
  return [...new Set(out.split('\n').filter(Boolean))]
    .map((p) => p.replace(/^web\//, ''))
    .filter((p) => p.startsWith('src/') && LINTABLE.test(p))
    .filter((p) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile())
    .sort();
}

function allFiles() {
  return git(`git ls-files 'src/**/*.ts' 'src/**/*.tsx'`).split('\n').filter(Boolean);
}

/**
 * New path → the path the file had on the base branch, for files this branch
 * moved. Without this, moving a file reads as writing it, and every problem it
 * already had lands on whoever dragged it across the tree.
 */
function renamedFrom() {
  /** @type {Map<string, string>} */ const map = new Map();
  if (!BASE) return map;
  for (const line of git(`git diff --name-status --find-renames ${BASE}...HEAD`).split('\n')) {
    const [status, from, to] = line.split('\t');
    if (status?.startsWith('R') && from && to) {
      map.set(to.replace(/^web\//, ''), from.replace(/^web\//, ''));
    }
  }
  return map;
}

const RENAMES = renamedFrom();

/** The file's content on the base branch, or null when this branch created it. */
function baseSource(file) {
  if (!BASE) return null;
  return git(`git show ${BASE}:web/${RENAMES.get(file) ?? file}`) || null;
}

const all = process.argv.includes('--all');
const targets = all ? allFiles() : changedFiles();

if (!targets.length) {
  console.log(`eslint-ratchet: 対象ファイルなし（mode=${all ? 'all' : 'changed'}）`);
  process.exit(0);
}

const eslint = new ESLint({ cwd: ROOT, warnIgnored: false });
const newErrors = [];
const newWarnings = [];
const inherited = [];

for (const file of targets) {
  const abs = join(ROOT, file);
  const [current] = await eslint.lintFiles([abs]);
  const now = toFindings(file, current?.messages);
  if (!now.length) continue;
  if (all) {
    // The audit: everything that exists, nothing forgiven.
    const { newErrors: e, newWarnings: w } = ratchetBySeverity(now, []);
    newErrors.push(...e);
    newWarnings.push(...w);
    continue;
  }

  const before = baseSource(file);
  const wasBroken = before === null
    ? [] // new file — every problem in it is this branch's
    : toFindings(file, (await eslint.lintText(before, { filePath: abs }))[0]?.messages);

  const split = ratchetBySeverity(now, wasBroken);
  newErrors.push(...split.newErrors);
  newWarnings.push(...split.newWarnings);
  inherited.push(...split.inherited);
}

/** @param {string} mark @param {import('./eslintFindings.mjs').Finding[]} findings */
function report(mark, findings) {
  for (const [rule, items] of groupByRule(findings)) {
    console.log(`\n${mark} ${rule} — ${items.length} 件`);
    for (const f of items.slice(0, MAX_LINES)) {
      // react-hooks messages carry a code frame; the first line is the claim.
      console.log(`    web/${f.file}:${f.line}  ${f.message.split('\n')[0].slice(0, 100)}`);
    }
    if (items.length > MAX_LINES) console.log(`    … 他 ${items.length - MAX_LINES} 件`);
  }
}

report('✗', newErrors);
report('△', newWarnings);

if (inherited.length) {
  console.log(`\nℹ 既存の指摘 ${inherited.length} 件（base に既にあったもの — この PR では落としません）`);
  for (const [rule, items] of groupByRule(inherited)) console.log(`    ${rule} × ${items.length}`);
  console.log('  触れたついでに直せるなら直してください。まとめて見るなら npm run lint:all');
}

const scope = `${targets.length} ファイル（mode=${all ? 'all' : 'changed'}）`;
console.log(
  newErrors.length || newWarnings.length
    ? `\neslint-ratchet: 新規エラー ${newErrors.length} 件 / 新規警告 ${newWarnings.length} 件 / ${scope}`
    : `\neslint-ratchet: 新規の指摘なし / ${scope}${inherited.length ? ` — 既存 ${inherited.length} 件は据え置き` : ''}`,
);
process.exit(newErrors.length ? 1 : 0);
