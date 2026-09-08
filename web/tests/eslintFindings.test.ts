import { describe, expect, it } from 'vitest';
import {
  NO_RULE,
  bySeverity,
  groupByRule,
  ratchetBySeverity,
  toFindings,
} from '../scripts/eslintFindings.mjs';

// The lint gate decides which ESLint problems a branch is answerable for, and
// it can be wrong in two directions of which only one is visible: too strict
// and CI goes red on somebody else's debt, which someone reports within the
// hour; too lax and it forgives everything, exits 0 and prints 新規の指摘なし
// — indistinguishable from a branch that is actually clean, and nobody reports
// it at all. These tests are how the second failure gets found.
//
// Fixtures are hand-written message objects rather than real lint runs: what
// is under test is the mapping and the budgeting, not ESLint.

const FILE = 'src/ActivitySpace/execution/object/ListTable.tsx';

type Msg = { ruleId: string | null; severity: 1 | 2; message: string; line?: number };

const msg = (line: number, ruleId: string | null, severity: 1 | 2, message: string): Msg => ({
  ruleId,
  severity,
  message,
  line,
});

const lint = (...messages: Msg[]) => toFindings(FILE, messages);

const ANY = (line: number) =>
  msg(line, '@typescript-eslint/no-explicit-any', 2, 'Unexpected any. Specify a different type.');
const UNUSED = (line: number, name: string) =>
  msg(line, '@typescript-eslint/no-unused-vars', 1, `'${name}' is assigned a value but never used.`);

// react-hooks messages end in a code frame, so an untouched problem is worded
// differently the moment a line is inserted above it. Reproduced here because
// budgeting by count — rather than by wording — is what survives that.
const REFS = (line: number) =>
  msg(
    line,
    'react-hooks/refs',
    2,
    ['Error: Cannot access refs during render', '', `> ${line} |   ref.current = x;`].join('\n'),
  );

describe('toFindings', () => {
  it('shapes a message like a design-lint finding, so one ratchet serves both gates', () => {
    expect(lint(ANY(12))).toEqual([
      {
        file: FILE,
        line: 12,
        rule: { id: '@typescript-eslint/no-explicit-any' },
        severity: 2,
        message: 'Unexpected any. Specify a different type.',
      },
    ]);
  });

  it('keeps a problem ESLint blames on no rule — a parse error is not an excuse', () => {
    const [finding] = lint(msg(3, null, 2, 'Parsing error: Unexpected token'));
    expect(finding.rule.id).toBe(NO_RULE);
    expect(finding.severity).toBe(2);
  });

  it('treats anything that is not severity 2 as a warning', () => {
    expect(lint(msg(1, 'x', 1, 'm'))[0].severity).toBe(1);
    expect(lint(msg(1, 'x', 2, 'm'))[0].severity).toBe(2);
  });

  it('returns nothing for a file ESLint had no complaints about', () => {
    expect(toFindings(FILE, [])).toEqual([]);
    expect(toFindings(FILE, undefined)).toEqual([]);
  });

  it('splits errors from warnings — only errors fail the run', () => {
    const findings = lint(ANY(1), UNUSED(2, 'a'));
    expect(bySeverity(findings, 2).map((f) => f.line)).toEqual([1]);
    expect(bySeverity(findings, 1).map((f) => f.line)).toEqual([2]);
  });
});

describe('the ratchet — inherited problems are forgiven, new ones are not', () => {
  it('forgives a file that is exactly as broken as the base branch', () => {
    const before = lint(ANY(10), UNUSED(20, 'draft'));
    const split = ratchetBySeverity(lint(ANY(10), UNUSED(20, 'draft')), before);
    expect(split.newErrors).toEqual([]);
    expect(split.newWarnings).toEqual([]);
    expect(split.inherited).toHaveLength(2);
  });

  it('forgives them after an edit moves every line — position is not identity', () => {
    const before = lint(ANY(10), REFS(20));
    const split = ratchetBySeverity(lint(ANY(48), REFS(61)), before);
    expect(split.newErrors).toEqual([]);
  });

  it('forgives a renamed unused variable — same rule, same count, better name', () => {
    const before = lint(UNUSED(61, 'isLoading'));
    const split = ratchetBySeverity(lint(UNUSED(61, 'isPending')), before);
    expect(split.newWarnings).toEqual([]);
    expect(split.inherited).toHaveLength(1);
  });

  it('fails the one problem added on top of the inherited ones', () => {
    const before = lint(ANY(10), ANY(20));
    const split = ratchetBySeverity(lint(ANY(10), ANY(20), ANY(30)), before);
    expect(split.newErrors).toHaveLength(1);
    expect(split.inherited).toHaveLength(2);
  });

  it('forgives nothing when the file is new on this branch — it owns all of it', () => {
    const split = ratchetBySeverity(lint(ANY(1), UNUSED(2, 'x')), []);
    expect(split.newErrors).toHaveLength(1);
    expect(split.newWarnings).toHaveLength(1);
    expect(split.inherited).toEqual([]);
  });

  it('reports nothing for a file that only got cleaner', () => {
    const before = lint(ANY(10), ANY(20));
    const split = ratchetBySeverity(lint(ANY(10)), before);
    expect(split.newErrors).toEqual([]);
    expect(split.inherited).toHaveLength(1);
  });
});

describe('the ratchet — budgets do not cross', () => {
  it('budgets per rule, so fixing an any does not buy a ref violation', () => {
    const before = lint(ANY(10), ANY(20));
    const split = ratchetBySeverity(lint(ANY(10), REFS(30)), before);
    expect(split.newErrors.map((f) => f.rule.id)).toEqual(['react-hooks/refs']);
    expect(split.inherited.map((f) => f.rule.id)).toEqual(['@typescript-eslint/no-explicit-any']);
  });

  it('budgets per severity, so a fixed warning cannot pay for an error', () => {
    const rule = 'react-hooks/exhaustive-deps';
    const before = lint(msg(10, rule, 1, 'missing dependency'), msg(20, rule, 1, 'missing dependency'));
    const split = ratchetBySeverity(lint(msg(10, rule, 2, 'missing dependency')), before);
    expect(split.newErrors).toHaveLength(1);
    expect(split.inherited).toEqual([]);
  });

  it('counts a new warning without failing the run — the config says which problems block', () => {
    const before = lint(ANY(10));
    const split = ratchetBySeverity(lint(ANY(10), UNUSED(20, 'neverRead')), before);
    expect(split.newErrors).toEqual([]);
    expect(split.newWarnings).toHaveLength(1);
  });
});

describe('the report', () => {
  it('groups by severity and rule, biggest group first', () => {
    const grouped = groupByRule(lint(ANY(1), UNUSED(2, 'a'), ANY(3), UNUSED(4, 'b'), ANY(5)));
    expect([...grouped.keys()]).toEqual([
      'error @typescript-eslint/no-explicit-any',
      'warning @typescript-eslint/no-unused-vars',
    ]);
    expect(grouped.get('error @typescript-eslint/no-explicit-any')).toHaveLength(3);
  });

  it('keeps one rule’s errors and warnings in separate groups', () => {
    const rule = 'react-hooks/exhaustive-deps';
    const grouped = groupByRule(lint(msg(1, rule, 2, 'm'), msg(2, rule, 1, 'm')));
    expect([...grouped.keys()]).toEqual([`error ${rule}`, `warning ${rule}`]);
  });
});
