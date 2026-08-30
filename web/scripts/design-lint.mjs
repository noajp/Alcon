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
//   node scripts/design-lint.mjs            # changed files (the gate)
//   node scripts/design-lint.mjs --all      # whole tree (the audit)
//   node scripts/design-lint.mjs path/...   # explicit files
//
// Escape hatch: put `design-lint-ignore` in a comment on the offending line or
// the line above it, with a reason. Deliberate exceptions should be visible.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Files that legitimately hold raw color values: the token definitions
// themselves and the hand-picked palettes users choose from.
const COLOR_ALLOWLIST = [
  'src/app/globals.css',
  'src/shared/designTokens.ts',
  'src/alcon/shared/labelColor.ts',
  'src/alcon/property/builtInColumns.ts',
  'src/alcon/settings/AppearanceSettings.tsx',
  'src/alcon/element/craft/canvasTypes.ts',
  // Export/print HTML is theme-independent by nature — it renders outside the app.
  'src/alcon/element/craft/canvasRender.ts',
];

const RULES = [
  {
    id: 'no-uppercase-label',
    test: /\buppercase\b/,
    // Only the Tailwind utility, not the word in prose/JS identifiers.
    refine: (line) => /(?:class(?:Name)?\s*=|['"`][^'"`]*\b)uppercase\b/.test(line),
    message: 'ラベルを CSS で全大文字にしない — 書いた通り（先頭大文字）で表示する',
    fix: 'uppercase と、それに付随する tracking-wider/tracking-[Npx] を削除。階層は font-weight / color / size で表す',
    files: /\.(tsx?|css)$/,
  },
  {
    id: 'no-input-ring',
    test: /focus:(ring|border)-|focus-visible:(ring|outline|border)-/,
    message: '入力フィールドに枠・リング・アウトライン禁止 — 背景色の差だけでフィールドを示す',
    fix: 'focus:ring-* / focus:border-* を削除。フォーカスは背景トーンの変化（focus:bg-muted/60 等）で示す',
    files: /\.tsx?$/,
    // Buttons and links are allowed a ring (globals.css whitelists them).
    refine: (line) => !/<(button|a)\b/.test(line) && !/role=["']button["']/.test(line),
  },
  {
    id: 'no-hardcoded-color',
    test: /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/,
    message: '色ハードコード禁止 — designTokens / CSS 変数を通す',
    fix: 'var(--*) トークンか Tailwind の意味クラス（text-muted-foreground 等）に置き換える。新しい意味が要るならトークンを globals.css に足す',
    files: /\.tsx?$/,
    allowlist: COLOR_ALLOWLIST,
  },
  {
    id: 'no-task-wording',
    test: /\bTasks?\b/,
    refine: (line) => /['"`>][^'"`<]*\bTasks?\b/.test(line) && !/TaskList|TaskGet|taskId/.test(line),
    message: '「Task」と呼ばない — 業界横断の抽象名は Element',
    fix: 'ユーザーに見える文言を Element / Elements に置き換える',
    files: /\.tsx$/,
  },
];

function changedFiles() {
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { cwd: ROOT, stdio: 'ignore' });
  } catch {
    base = 'main';
  }
  const out = execSync(`git diff --name-only ${base}...HEAD; git diff --name-only HEAD`, {
    cwd: ROOT, encoding: 'utf8',
  });
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

const findings = [];
for (const file of targets) {
  const full = join(ROOT, file);
  if (!existsSync(full)) continue;
  const lines = readFileSync(full, 'utf8').split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(file)) continue;
    if (rule.allowlist?.some((a) => file === a)) continue;
    lines.forEach((line, i) => {
      if (!rule.test.test(line)) return;
      if (rule.refine && !rule.refine(line)) return;
      // Deliberate, documented exception.
      if (/design-lint-ignore/.test(line) || /design-lint-ignore/.test(lines[i - 1] ?? '')) return;
      findings.push({ file, line: i + 1, rule, snippet: line.trim().slice(0, 100) });
    });
  }
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

console.log(
  findings.length
    ? `\ndesign-lint: ${findings.length} 件の違反 / ${targets.length} ファイル（mode=${mode}）`
    : `design-lint: 違反なし / ${targets.length} ファイル（mode=${mode}）`
);
process.exit(findings.length ? 1 : 0);
