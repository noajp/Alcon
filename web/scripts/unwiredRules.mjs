// The rule behind `unwired-lint`: which exported values nothing imports.
//
// Pure — it takes the source text of every file and returns findings, so the
// CLI can stay about file discovery and printing, and the whole judgement can
// be unit-tested without a repo. Mirrors how designLintRules.mjs relates to
// design-lint.mjs.
//
// What counts as "wired" here is deliberately narrow: some *other* file names
// this export in an `import` or a re-`export ... from`. Free-text occurrences
// of the identifier do not count, because a name appearing in a comment or as
// an unrelated local is exactly the false signal that makes dead-code hunts
// untrustworthy.

/** Files Next.js and the toolchain load by convention — never "unwired". */
const ENTRY_PATTERNS = [
  /^src\/app\/.*\/(page|layout|template|loading|error|not-found|route|default)\.tsx?$/,
  /^src\/app\/(page|layout|template|loading|error|not-found|route|global-error)\.tsx?$/,
  /^src\/(middleware|instrumentation)\.tsx?$/,
];

export function isEntryPoint(file) {
  return ENTRY_PATTERNS.some((re) => re.test(file));
}

// Type-only exports are out of scope. An unused interface is untidy; an unused
// component or function is a feature nobody can reach, and conflating the two
// buries the second under hundreds of the first (database.ts alone exports
// well over a hundred types).
const VALUE_EXPORT = new RegExp(
  [
    'export\\s+(?:async\\s+)?function\\s+([A-Za-z_$][\\w$]*)',
    'export\\s+(?:abstract\\s+)?class\\s+([A-Za-z_$][\\w$]*)',
    'export\\s+(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)',
  ].join('|'),
  'g',
);

// `export { a, b as c }` — but not `export { x } from './y'`, which is a
// re-export and is counted as a reference to './y' instead.
const EXPORT_LIST = /export\s*\{([^}]*)\}(\s*from\s*['"][^'"]+['"])?/g;

/** Every value this file exports, by name. */
export function exportsOf(source) {
  const names = new Set();
  const src = stripComments(source);

  for (const m of src.matchAll(VALUE_EXPORT)) {
    names.add(m[1] ?? m[2] ?? m[3]);
  }
  for (const m of src.matchAll(EXPORT_LIST)) {
    if (m[2]) continue; // re-export: a reference, not a definition
    for (const part of m[1].split(',')) {
      const alias = part.trim().split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).trim();
      if (name && name !== 'default' && !name.startsWith('type ')) names.add(name);
    }
  }
  return names;
}

/**
 * Every name this file imports or re-exports, regardless of where from.
 *
 * Module paths are ignored on purpose. Resolving `@/` aliases, index files and
 * extensions would add a resolver's worth of ways to be subtly wrong, and the
 * question being asked — "does anything in this codebase reach for this name?"
 * — does not need the answer. The cost is that two files exporting the same
 * name make each other look wired; the CLI reports those collisions so they
 * can be seen rather than silently trusted.
 */
export function importedNamesOf(source) {
  const names = new Set();
  const src = stripComments(source);

  for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s*['"][^'"]+['"]/g)) {
    collectSpecifiers(m[1], names);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    collectSpecifiers(`{${m[1]}}`, names);
  }
  // Every view in the shell arrives as `dynamic(() => import('…').then(m =>
  // m.Thing))`, so a check that only reads static imports would call the
  // entire app unwired.
  for (const m of src.matchAll(/import\s*\(\s*['"][^'"]+['"]\s*\)\s*\.then\s*\(([\s\S]{0,120}?)\)/g)) {
    for (const mm of m[1].matchAll(/\.\s*([A-Za-z_$][\w$]*)/g)) names.add(mm[1]);
    collectSpecifiers(m[1], names);
  }
  for (const m of src.matchAll(/await\s+import\s*\(\s*['"][^'"]+['"]\s*\)/g)) {
    const line = src.slice(Math.max(0, src.indexOf(m[0]) - 120), src.indexOf(m[0]));
    collectSpecifiers(line, names);
  }
  // `export * from './x'` re-exports everything in x, so nothing in x is dead.
  for (const m of src.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)) {
    names.add(`*:${m[1]}`);
  }
  return names;
}

function collectSpecifiers(clause, into) {
  const braced = clause.match(/\{([^}]*)\}/);
  if (braced) {
    for (const part of braced[1].split(',')) {
      const t = part.trim().replace(/^type\s+/, '');
      if (!t) continue;
      const alias = t.split(/\s+as\s+/);
      into.add(alias[0].trim());
    }
  }
  const bare = clause.replace(/\{[^}]*\}/g, '').replace(/^type\s+/, '');
  for (const part of bare.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const ns = t.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (ns) { into.add(ns[1]); continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(t)) into.add(t);
  }
}

// Comments are stripped before matching so that a commented-out import can't
// make a dead export look alive — the failure mode that would quietly defeat
// the whole check.
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Exports that nothing else imports.
 *
 * `files` is `[{ file, source }]`. `declared` is the set of `file#name` entries
 * that have been consciously accepted (the craft/ modules and anything else
 * held back on purpose) — those are returned separately rather than dropped,
 * so a declaration that has stopped being true is still visible.
 *
 * `declaredPaths` accepts whole prefixes, for the cases where the reason is a
 * property of the directory rather than of each name in it: vendored component
 * families ship complete, and craft/ is held back wholesale.
 *
 * `consumers` is who may reach an export, and defaults to `files`. Callers pass
 * a wider set to count test files — a helper its unit test imports is wired —
 * without letting tests contribute exports of their own.
 */
export function findUnwired(files, declared = new Set(), declaredPaths = [], consumers = files) {
  const wanted = new Set();
  const starReexported = new Set();
  for (const { source } of consumers) {
    for (const name of importedNamesOf(source)) {
      if (name.startsWith('*:')) starReexported.add(name.slice(2));
      else wanted.add(name);
    }
  }

  const definedIn = new Map();
  for (const { file, source } of files) {
    for (const name of exportsOf(source)) {
      definedIn.set(name, [...(definedIn.get(name) ?? []), file]);
    }
  }

  const findings = [];
  const accepted = [];
  const ambiguous = [];
  for (const { file, source } of files) {
    if (isEntryPoint(file)) continue;
    // `export * from './thing'` republishes every name in the target, so a
    // module on the receiving end of one is reachable by construction.
    if ([...starReexported].some((spec) => moduleMayBe(spec, file))) continue;

    for (const name of exportsOf(source)) {
      if (wanted.has(name)) continue;
      const homes = definedIn.get(name) ?? [];
      const entry = { file, name, key: `${file}#${name}` };
      if (homes.length > 1) ambiguous.push({ ...entry, homes });
      if (declared.has(entry.key) || declaredPaths.some((p) => file.startsWith(p))) accepted.push(entry);
      else findings.push(entry);
    }
  }

  return { findings, accepted, ambiguous };
}

/** Loose check that a bare specifier could name this file. */
function moduleMayBe(specifier, file) {
  const tail = specifier.replace(/^[@.]\//, '').replace(/^\.+\//g, '');
  const stem = file.replace(/^src\//, '').replace(/\.(tsx?|jsx?)$/, '');
  return stem === tail || stem.endsWith(`/${tail}`) || stem === `${tail}/index`;
}
