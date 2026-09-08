// ESLint messages, turned into what `eslint-ratchet.mjs` compares and prints.
//
// Kept apart from the CLI so the parts that decide what counts — which
// problems survive the mapping, and which of them this branch is answerable
// for — are pure functions with no git, no ESLint and no process.exit, and can
// therefore be unit-tested. A ratchet fails silently in the direction that
// costs the most: drop a message on the way in, or forgive a severity it
// shouldn't, and the run still exits 0 and still prints 新規エラーなし, which
// is indistinguishable from a branch that is genuinely clean.
// See `tests/eslintFindings.test.ts`.

import { ratchet } from './designLintRules.mjs';

/** Bucket for a problem ESLint attributes to no rule: a parse error, or a stale eslint-disable. */
export const NO_RULE = '(no rule)';

/**
 * @typedef {{ file: string, line: number, rule: { id: string }, severity: 1 | 2,
 *             message: string }} Finding
 */

/**
 * One file's ESLint messages as findings.
 *
 * Shaped like a design-lint finding (`rule.id`) so the same `ratchet` can
 * budget both gates and the two can't drift in how they forgive. Pure — `file`
 * is carried through for the report only, never read from disk.
 *
 * Nothing is filtered out here. A message with no `ruleId` is a parse error or
 * a stale disable directive, and dropping those would quietly excuse the file
 * ESLint could not even read.
 *
 * @param {string} file  path to show in the report, e.g. 'src/ActivitySpace/foo.tsx'
 * @param {Array<{ ruleId?: string | null, severity?: number, message: string,
 *                 line?: number }>} [messages]
 * @returns {Finding[]}
 */
export function toFindings(file, messages = []) {
  return messages.map((m) => ({
    file,
    line: m.line ?? 0,
    rule: { id: m.ruleId ?? NO_RULE },
    severity: m.severity === 2 ? 2 : 1,
    message: m.message,
  }));
}

/**
 * @param {Finding[]} findings
 * @param {1 | 2} severity
 * @returns {Finding[]}
 */
export const bySeverity = (findings, severity) => findings.filter((f) => f.severity === severity);

/**
 * Split one file's current findings into what it inherited from the base
 * branch and what this branch added.
 *
 * Errors and warnings are ratcheted separately, so a warning that got fixed
 * can never pay for an error that appeared. Within each severity the budget is
 * per rule and by count, never by line: any edit above a problem moves it, and
 * the react-hooks messages carry a code frame that is reworded by the same
 * edit, so neither position nor wording identifies a problem across two
 * versions of a file. What counting costs is that swapping one problem for
 * another of the same rule and severity in the same file is forgiven — the
 * promise is that the count never rises.
 *
 * @param {Finding[]} current  findings in the working copy
 * @param {Finding[]} before   findings in the same file on the base branch
 * @returns {{ newErrors: Finding[], newWarnings: Finding[], inherited: Finding[] }}
 */
export function ratchetBySeverity(current, before) {
  const errors = ratchet(bySeverity(current, 2), bySeverity(before, 2));
  const warnings = ratchet(bySeverity(current, 1), bySeverity(before, 1));
  return {
    newErrors: errors.findings,
    newWarnings: warnings.findings,
    inherited: [...errors.inherited, ...warnings.inherited],
  };
}

/**
 * Findings grouped by severity and rule, biggest group first — how the report
 * is printed. Keyed `'error react-hooks/refs'`, since the same rule can hold
 * both and the two are not the same news.
 *
 * @param {Finding[]} findings
 * @returns {Map<string, Finding[]>}
 */
export function groupByRule(findings) {
  /** @type {Map<string, Finding[]>} */ const groups = new Map();
  for (const f of findings) {
    const key = `${f.severity === 2 ? 'error' : 'warning'} ${f.rule.id}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return new Map([...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));
}
