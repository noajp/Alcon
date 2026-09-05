import { describe, expect, it } from 'vitest';
import { COLOR_ALLOWLIST, RULES, ratchet, scan } from '../scripts/designLintRules.mjs';

// The design gate is the kind of check that fails silently: if a rule's regex
// stops matching — or the ratchet forgives everything — `design-lint` still
// exits 0 and still prints 新規違反なし. The only way to tell a clean tree from
// a broken gate is to feed each rule a line it MUST catch and a line it must
// NOT, and to feed the ratchet a violation it must NOT forgive.
//
// Every fixture below is a string, never real JSX — which is also why these
// tests live in `tests/` rather than under `src/`, where design-lint would
// scan the fixtures themselves and flag them as genuine violations.

/** Rule ids fired by linting `source` as `file`. */
function ruleIds(file: string, source: string): string[] {
  return scan(file, source).map((f) => f.rule.id);
}

const TSX = 'src/alcon/example/Example.tsx';

describe('the rule table', () => {
  it('has a unique id per rule, so findings group correctly in the report', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every rule a message and a fix — the report prints both', () => {
    for (const rule of RULES) {
      expect(rule.message, rule.id).toBeTruthy();
      expect(rule.fix, rule.id).toBeTruthy();
    }
  });
});

describe('no-uppercase-label', () => {
  it('catches the Tailwind utility in a className', () => {
    expect(ruleIds(TSX, '  <span className="text-xs uppercase">Inbox</span>')).toContain(
      'no-uppercase-label',
    );
  });

  it('catches a class attribute in a .css file — the rule covers .css as well', () => {
    expect(ruleIds('src/app/theme.css', '/* was: class="uppercase" */')).toContain(
      'no-uppercase-label',
    );
  });

  it('is scoped to the utility class, so a raw CSS declaration slips through', () => {
    // Documenting a known gap, not endorsing it: the rule keys off a quoted
    // class list or a class= attribute, so `text-transform: uppercase` in a
    // stylesheet is not caught. Widen the rule here if that ever bites.
    expect(ruleIds('src/app/theme.css', '  text-transform: uppercase;')).toEqual([]);
  });

  it('does not fire on the word in prose or an identifier', () => {
    expect(ruleIds(TSX, '// keep labels sentence case, never uppercase')).not.toContain(
      'no-uppercase-label',
    );
    expect(ruleIds(TSX, 'const uppercaseName = name.toUpperCase();')).not.toContain(
      'no-uppercase-label',
    );
  });
});

describe('no-input-ring', () => {
  it('catches a focus ring and a focus border on an input', () => {
    expect(ruleIds(TSX, '<input className="focus:ring-2" />')).toContain('no-input-ring');
    expect(ruleIds(TSX, '<input className="focus:border-primary" />')).toContain('no-input-ring');
    expect(ruleIds(TSX, '<textarea className="focus-visible:outline-none" />')).toContain(
      'no-input-ring',
    );
  });

  it('allows a ring on a button, a link, or role="button" — globals.css whitelists them', () => {
    expect(ruleIds(TSX, '<button className="focus-visible:ring-2">Save</button>')).not.toContain(
      'no-input-ring',
    );
    expect(ruleIds(TSX, '<a className="focus-visible:ring-2" href="/x">Open</a>')).not.toContain(
      'no-input-ring',
    );
    expect(ruleIds(TSX, '<div role="button" className="focus:ring-2" />')).not.toContain(
      'no-input-ring',
    );
  });
});

describe('no-hardcoded-color', () => {
  it('catches hex and rgb literals', () => {
    expect(ruleIds(TSX, "const bg = '#ff0088';")).toContain('no-hardcoded-color');
    expect(ruleIds(TSX, "const bg = '#fff';")).toContain('no-hardcoded-color');
    expect(ruleIds(TSX, "const bg = 'rgba(0, 0, 0, 0.5)';")).toContain('no-hardcoded-color');
  });

  it('leaves token references alone', () => {
    expect(ruleIds(TSX, "const bg = 'var(--muted-foreground)';")).not.toContain(
      'no-hardcoded-color',
    );
    expect(ruleIds(TSX, '<div className="bg-muted text-muted-foreground" />')).not.toContain(
      'no-hardcoded-color',
    );
  });

  it('exempts every allowlisted file — those are the palettes themselves', () => {
    const rawColor = "export const RED = '#ff0000';";
    for (const file of COLOR_ALLOWLIST) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
      expect(ruleIds(file, rawColor), file).not.toContain('no-hardcoded-color');
    }
    // …and only those files: the same line elsewhere is still a violation.
    expect(ruleIds('src/shared/otherTokens.ts', rawColor)).toContain('no-hardcoded-color');
  });
});

describe('no-task-wording', () => {
  it('catches user-visible "Task" / "Tasks" copy', () => {
    expect(ruleIds(TSX, '<span>Tasks</span>')).toContain('no-task-wording');
    expect(ruleIds(TSX, "const label = 'New Task';")).toContain('no-task-wording');
  });

  it('spares the identifiers the rule deliberately exempts', () => {
    expect(ruleIds(TSX, "const id = taskId ?? '';")).not.toContain('no-task-wording');
    expect(ruleIds(TSX, '<TaskList items={items} />')).not.toContain('no-task-wording');
  });

  it('only applies to .tsx — it is about copy, not internal .ts naming', () => {
    expect(ruleIds('src/alcon/example/model.ts', "const label = 'New Task';")).not.toContain(
      'no-task-wording',
    );
  });
});

describe('file-extension scoping', () => {
  it('ignores anything outside the extensions a rule declares', () => {
    // no-input-ring and no-hardcoded-color are .ts/.tsx only.
    expect(ruleIds('src/app/globals.css', '.field { focus:ring-2 }')).toEqual([]);
  });
});

describe('the design-lint-ignore escape hatch', () => {
  const violation = "const bg = '#ff0000';";

  it('silences a finding when the marker is on the same line', () => {
    expect(ruleIds(TSX, `${violation} // design-lint-ignore: print-only export`)).toEqual([]);
  });

  it('silences a finding when the marker is on the line above', () => {
    const source = ['// design-lint-ignore: print-only export', violation].join('\n');
    expect(ruleIds(TSX, source)).toEqual([]);
  });

  it('does NOT reach a line two below the marker', () => {
    const source = ['// design-lint-ignore: only covers the next line', '', violation].join('\n');
    expect(ruleIds(TSX, source)).toContain('no-hardcoded-color');
  });
});

describe('finding shape', () => {
  it('reports a 1-based line number and a trimmed snippet', () => {
    const source = ['// header', '', "  const bg = '#ff0000';"].join('\n');
    const [finding] = scan(TSX, source);
    expect(finding.line).toBe(3);
    expect(finding.snippet).toBe("const bg = '#ff0000';");
    expect(finding.file).toBe(TSX);
  });

  it('caps the snippet at 100 characters so the report stays readable', () => {
    const long = `const bg = '#ff0000'; // ${'x'.repeat(200)}`;
    const [finding] = scan(TSX, long);
    expect(finding.snippet).toHaveLength(100);
  });

  it('reports every violating line, not just the first', () => {
    const source = ["const a = '#ff0000';", "const b = '#00ff00';"].join('\n');
    expect(scan(TSX, source)).toHaveLength(2);
  });

  it('returns nothing for a clean file', () => {
    expect(scan(TSX, "export const label = 'Elements';\n")).toEqual([]);
  });
});

describe('the ratchet — inherited violations are forgiven, new ones are not', () => {
  const before = scan(TSX, ["const a = '#ff0000';", "const b = '#00ff00';"].join('\n'));

  it('forgives a file that is exactly as broken as the base branch', () => {
    const current = scan(TSX, ["const a = '#ff0000';", "const b = '#00ff00';"].join('\n'));
    const { findings, inherited } = ratchet(current, before);
    expect(findings).toEqual([]);
    expect(inherited).toHaveLength(2);
  });

  it('fails the one violation added on top of the inherited ones', () => {
    const current = scan(
      TSX,
      ["const a = '#ff0000';", "const b = '#00ff00';", "const c = '#0000ff';"].join('\n'),
    );
    const { findings, inherited } = ratchet(current, before);
    expect(findings).toHaveLength(1);
    expect(inherited).toHaveLength(2);
  });

  it('forgives nothing when the base file was clean — a new file gets no budget', () => {
    const current = scan(TSX, "const a = '#ff0000';");
    const { findings, inherited } = ratchet(current, []);
    expect(findings).toHaveLength(1);
    expect(inherited).toEqual([]);
  });

  it('budgets per rule, so removing a color does not buy an uppercase label', () => {
    // Base: two hardcoded colors, no uppercase. Current: one color, one
    // uppercase. Total count is unchanged, but the uppercase is still new.
    const current = scan(
      TSX,
      ["const a = '#ff0000';", '<span className="uppercase">Inbox</span>'].join('\n'),
    );
    const { findings, inherited } = ratchet(current, before);
    expect(findings.map((f) => f.rule.id)).toEqual(['no-uppercase-label']);
    expect(inherited.map((f) => f.rule.id)).toEqual(['no-hardcoded-color']);
  });

  it('lets a spare budget go unused rather than forgiving a different rule', () => {
    const current = scan(TSX, "const a = '#ff0000';");
    const { findings, inherited } = ratchet(current, before);
    expect(findings).toEqual([]);
    expect(inherited).toHaveLength(1);
  });
});

describe('no-status-priority-vocab', () => {
  it('catches literal Element labels, options, and priority weights', () => {
    for (const source of [
      'const STATUS_OPTIONS: ElementStatus[] = [',
      'const STATUS_LABEL: Record<ElementStatus, string> = {',
      'const PRIORITY_OPTIONS: ElementPriority[] = [',
      'const PRIORITY_WEIGHT: Record<ElementPriority, number> = {',
      "export const STATUS_OPTIONS: { value: ElementWithDetails['status']; label: string }[] = [",
    ]) expect(ruleIds(TSX, source)).toContain('no-status-priority-vocab');
  });

  it('allows derivation from canonical values without a per-file exemption', () => {
    for (const source of [
      'const STATUS_OPTIONS: ElementStatus[] = [...STATUS_ORDER];',
      'const PRIORITY_OPTIONS: ElementPriority[] = PRIORITY_ORDER.map(value => ({ value }));',
      'const STATUS_OPTIONS: ElementStatus[] =\n  STATUS_ORDER.map(value => value);',
      'const PRIORITY_WEIGHT: Record<ElementPriority, number> = { urgent: PRIORITY.urgent.weight };',
    ]) expect(ruleIds(TSX, source)).not.toContain('no-status-priority-vocab');
  });

  it('leaves other domains and comments alone', () => {
    for (const source of [
      'const STATUS_LABELS: Record<DecisionStatus, string> = {',
      'const PRIORITY_OPTIONS: FlagPriority[] = [',
      '// const STATUS_OPTIONS: ElementStatus[] = [',
    ]) expect(ruleIds(TSX, source)).not.toContain('no-status-priority-vocab');
  });
});
