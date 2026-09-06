import ts from 'typescript';

// The rules, the matcher and the ratchet behind `design-lint.mjs`.
//
// Kept separate from the CLI so the parts that decide "is this line a
// violation?" and "was it already there?" are pure functions — no git, no
// filesystem, no process.exit — and can therefore be unit-tested. A design
// gate fails silently: if a rule's regex stops matching, or the ratchet
// forgives everything, the run still exits 0 and still prints 新規違反なし,
// which is indistinguishable from success. Tests are what tell the two apart.
// See `tests/designLintRules.test.ts`.

/**
 * @typedef {{ id: string, test: RegExp, message: string, fix: string, files: RegExp,
 *             refine?: (line: string) => boolean, refineSource?: (source: string, file: string, lineIndex: number) => boolean, allowlist?: string[] }} DesignRule
 * @typedef {{ file: string, line: number, rule: DesignRule, snippet: string }} Finding
 */

// Files that legitimately hold raw color values: the token definitions
// themselves and the hand-picked palettes users choose from.
export const COLOR_ALLOWLIST = [
  'src/app/globals.css',
  'src/shared/designTokens.ts',
  'src/alcon/shared/labelColor.ts',
  'src/alcon/property/builtInColumns.ts',
  'src/alcon/settings/AppearanceSettings.tsx',
  // Theme-preview swatch data feeding SettingsView.tsx's theme picker.
  'src/alcon/settings/appearanceOptions.ts',
  // Domain "Color" swatch grid — same shape as labelColor.ts.
  'src/alcon/domain/domainColorPalette.ts',
  // Random pastel for a freshly-typed Select/Status option.
  'src/alcon/property/optionColorPalette.ts',
  // Calendar's event-color picker — same shape as labelColor.ts.
  'src/alcon/element/calendar/calendarColorPalette.ts',
  // CustomView.tsx's two color schemes (fixed flag-type legend + the draw
  // tool's swatch picker) — kept in their own file, not a blanket exemption
  // for the whole 600+ line component, so the linter still watches
  // everything else in it.
  'src/alcon/element/custom/customColorScheme.ts',
  // <meta name="theme-color"> — a literal string is the only thing the
  // browser-chrome API accepts; it cannot read a CSS custom property.
  'src/app/layout.tsx',
];

/** @type {DesignRule[]} */
export const RULES = [
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
  {
    id: 'no-status-priority-vocab',
    // Only literal declarations explicitly typed as Element vocabulary. Other
    // domains (agent runs, decisions, custom Properties) own different enums.
    test: /\b(?:const|let)\s+(?:STATUS_OPTIONS|STATUS_LABELS?|PRIORITY_OPTIONS|PRIORITY_LABELS?|PRIORITY_WEIGHT)\b[^=]*=\s*[\[{]/,
    refine: (line) => !/^\s*\/\//.test(line)
      && /\bElement(?:Status|Priority)\b|ElementWithDetails\[['"](?:status|priority)['"]\]/.test(line),
    refineSource: hasCopiedElementInitializer,
    message: 'Element の status/priority 語彙をローカル再定義しない — designTokens.ts から派生させる',
    fix: '候補は STATUS_ORDER / PRIORITY_ORDER、ラベル・weight は STATUS / PRIORITY を使う',
    files: /\.tsx?$/,
    allowlist: ['src/shared/designTokens.ts'],
  },
];

/** Inspect only the matched declaration's initializer, including wrapped lines.
 * Parsing also keeps comments and neighboring declarations from exempting a copy.
 * @param {string} source
 * @param {string} file
 * @param {number} lineIndex
 */
function hasCopiedElementInitializer(source, file, lineIndex) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let copied = false;
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer
      && /^(?:STATUS_OPTIONS|STATUS_LABELS?|PRIORITY_OPTIONS|PRIORITY_LABELS?|PRIORITY_WEIGHT)$/.test(node.name.getText(parsed))
      && parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line === lineIndex) {
      let derived = false;
      /** @param {import('typescript').Node} expression */
      const inspect = (expression) => {
        if (ts.isIdentifier(expression) && /^(?:STATUS|PRIORITY)(?:_ORDER)?$/.test(expression.text)) {
          const parent = expression.parent;
          const propertyName = (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent))
            && parent.name === expression;
          if (!propertyName) derived = true;
        }
        ts.forEachChild(expression, inspect);
      };
      inspect(node.initializer);
      if (!derived) copied = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return copied;
}

/**
 * Every violation in one file's source. Pure — `file` is only ever matched
 * against a rule's `files` / `allowlist`, never read from disk.
 *
 * @param {string} file    repo-relative path, e.g. 'src/alcon/foo.tsx'
 * @param {string} source  the file's contents
 * @returns {Finding[]}
 */
export function scan(file, source) {
  const out = [];
  const lines = source.split('\n');
  for (const rule of RULES) {
    if (!rule.files.test(file)) continue;
    if (rule.allowlist?.some((a) => file === a)) continue;
    lines.forEach((line, i) => {
      if (!rule.test.test(line)) return;
      if (rule.refine && !rule.refine(line)) return;
      if (rule.refineSource && !rule.refineSource(source, file, i)) return;
      // Deliberate, documented exception.
      if (/design-lint-ignore/.test(line) || /design-lint-ignore/.test(lines[i - 1] ?? '')) return;
      out.push({ file, line: i + 1, rule, snippet: line.trim().slice(0, 100) });
    });
  }
  return out;
}

/**
 * Split one file's current violations into the ones it inherited from the base
 * branch and the ones this branch added.
 *
 * Matched by rule, not by line number — an unrelated edit shifts lines. A count
 * per rule is enough to tell "you added one" from "it was already like this",
 * without pretending we can attribute individual lines.
 *
 * @param {Finding[]} current  violations in the working copy
 * @param {Finding[]} before   violations in the same file on the base branch
 * @returns {{ findings: Finding[], inherited: Finding[] }}
 */
export function ratchet(current, before) {
  const budget = new Map();
  for (const f of before) budget.set(f.rule.id, (budget.get(f.rule.id) ?? 0) + 1);
  const findings = [];
  const inherited = [];
  for (const f of current) {
    const left = budget.get(f.rule.id) ?? 0;
    if (left > 0) {
      budget.set(f.rule.id, left - 1);
      inherited.push(f);
    } else {
      findings.push(f);
    }
  }
  return { findings, inherited };
}
