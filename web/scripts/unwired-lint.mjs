#!/usr/bin/env node
// unwired-lint — exported values that nothing in the codebase imports.
//
// Written after a tabletop exercise kept hitting the same wall: the capability
// the operator wanted already existed and simply had no caller. Three of them,
// found by hand — the Intent layer's StrategyDocumentView (512 lines, plus its
// tables), a second Timeline implementation (998 lines) shadowed by the one
// the route actually renders, and canElementStart(), which answers "can this
// Element start yet" correctly and is called from nowhere.
//
// None of that is caught today. tsc and ESLint have no opinion about an export
// with no importer, and there are no tests over those files, so a feature can
// be entirely dead while every gate stays green.
//
// The output is a declaration, not a delete list. `craft/` is the standing
// proof that unreferenced does not mean unwanted — CLAUDE.md keeps it on
// purpose — so the baseline below is where "we know, and we mean it" gets
// written down. New unwired exports fail; accepting one means adding it to
// unwired-baseline.json with a reason, which is the inventory this repo did
// not otherwise have.
//
//   node scripts/unwired-lint.mjs            # the gate
//   node scripts/unwired-lint.mjs --json     # machine-readable
//   node scripts/unwired-lint.mjs --update   # rewrite the baseline from今の状態
//
// Deliberately narrow: only value exports (functions, classes, consts) under
// src/. Unused types are untidy; unused components are unreachable features,
// and mixing them buries the second under the first.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { findUnwired } from './unwiredRules.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BASELINE = join(ROOT, 'scripts/unwired-baseline.json');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const update = args.includes('--update');

const read = (patterns) =>
  execSync(`git ls-files ${patterns}`, { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => !/\.d\.ts$/.test(f))
    .map((file) => ({ file, source: readFileSync(join(ROOT, file), 'utf8') }));

// `git ls-files` alone cannot see a file that has never been added, so a
// brand-new module's exports went unexamined: the run said zero and CI, which
// checks out a commit, said otherwise. Two implementers shipped a PR that
// failed on exactly that. Untracked files are read too, which makes the local
// run stricter than CI rather than blinder than it — the safe direction for a
// gate to be wrong in.
const files = [
  ...read(`'src/**/*.ts' 'src/**/*.tsx'`),
  ...read(`--others --exclude-standard 'src/**/*.ts' 'src/**/*.tsx'`),
];
// Tests are consumers, not sources. A helper that only its unit test imports
// is wired — that is what having a test means — but a test file's own exports
// are nobody's feature.
const consumers = [...files, ...read(`'tests/*.ts' 'tests/*.tsx' 'tests/**/*.ts' 'tests/**/*.tsx'`)];

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { paths: {}, accepted: {} };
const declared = new Set(Object.keys(baseline.accepted ?? {}));
const declaredPaths = Object.keys(baseline.paths ?? {});

// Files this branch touched, so the declarations covering them can be printed
// where somebody is already looking. Same base resolution as design-lint.
function changedFiles() {
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    base = 'main';
  }
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD; git diff --name-only HEAD`, {
      cwd: ROOT, encoding: 'utf8',
    });
    return new Set(out.split('\n').filter(Boolean).map((p) => p.replace(/^web\//, '')));
  } catch {
    return new Set();
  }
}

const { findings, accepted, ambiguous } = findUnwired(files, declared, declaredPaths, consumers);

if (update) {
  const next = { ...baseline.accepted };
  for (const f of findings) {
    next[f.key] ??= 'TODO: なぜ配線されていないままでよいのか、一行で書くこと';
  }
  for (const key of Object.keys(next)) {
    const live = [...accepted, ...findings].some((f) => f.key === key);
    const covered = declaredPaths.some((p) => key.startsWith(p));
    if (!live || covered) delete next[key];
  }
  writeFileSync(BASELINE, `${JSON.stringify({ paths: baseline.paths ?? {}, accepted: next }, null, 2)}\n`);
  console.log(`unwired-lint: baseline を更新（${Object.keys(next).length} 件）`);
  process.exit(0);
}

if (asJson) {
  console.log(JSON.stringify({ findings, accepted, ambiguous }, null, 2));
  process.exit(findings.length ? 1 : 0);
}

// A declaration that has stopped being true: something got wired but the
// baseline still claims it is held back. Worth removing so the file keeps
// meaning what it says.
const stale = Object.keys(baseline.accepted ?? {}).filter((k) => !accepted.some((a) => a.key === k));
if (findings.length) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f.name]);
  console.log(`\n✗ 未配線の export — ${findings.length} 件`);
  console.log('  規則: export したものは、どこかから import されているか、意図的な保留として宣言されているかのどちらか');
  console.log('  直し方: 配線する（呼び出し元を足す）か、scripts/unwired-baseline.json に理由付きで載せる');
  for (const [file, names] of byFile) {
    console.log(`    web/${file}`);
    for (const n of names.slice(0, 8)) console.log(`      ${n}`);
    if (names.length > 8) console.log(`      … 他 ${names.length - 8} 件`);
  }
}

// The declarations covering what this branch touched. A baseline nobody reads
// records the judgement without carrying it: the entry for StrategyDocumentView
// says which board Element decides its fate, and that is worth knowing while
// editing the file, not only while grepping the JSON. Never fails — this is the
// file talking back, not a rule.
const touched = changedFiles();
const relevant = accepted
  .filter((a) => touched.has(a.file) && baseline.accepted?.[a.key])
  .map((a) => ({ ...a, reason: baseline.accepted[a.key] }));
if (relevant.length) {
  console.log(`\nℹ 触れたファイルに、宣言済みの未配線 export があります（${relevant.length} 件）`);
  console.log('  配線するなら宣言を消してください。保留のままでよければ何もしなくて構いません');
  for (const r of relevant.slice(0, 10)) {
    console.log(`    web/${r.file} — ${r.name}`);
    console.log(`      ${r.reason}`);
  }
  if (relevant.length > 10) console.log(`    … 他 ${relevant.length - 10} 件`);
}

if (ambiguous.length) {
  console.log(`\nℹ 同名の export が複数ファイルにあります（${ambiguous.length} 件）`);
  console.log('  この検査は名前だけを見るので、片方が使われていればもう片方も配線済みに見えます');
  for (const a of ambiguous.slice(0, 8)) console.log(`    ${a.name} — ${a.homes.map((h) => `web/${h}`).join(' / ')}`);
}

if (stale.length) {
  console.log(`\nℹ 宣言済みだが今は参照されている export（${stale.length} 件）— baseline から外せます`);
  for (const k of stale.slice(0, 8)) console.log(`    ${k}`);
}

console.log(
  findings.length
    ? `\nunwired-lint: 新規の未配線 ${findings.length} 件 / 宣言済み ${accepted.length} 件`
    : `unwired-lint: 新規の未配線なし / 宣言済み ${accepted.length} 件`,
);
process.exit(findings.length ? 1 : 0);
