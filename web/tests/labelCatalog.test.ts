import { describe, expect, it } from 'vitest';
import {
  buildLabelCatalog,
  elementsWithLabel,
  formatElementCount,
  formatLabelCount,
  newLabelProblem,
  planLabelRemove,
  planLabelRename,
  removeLabelColor,
  removeLabelFrom,
  renameLabelColor,
  renameLabelIn,
  restoreColorKeys,
  type LabelUsageRow,
} from '@/alcon/settings/labelCatalog';

// A label is not a row anywhere — it is a string inside `elements.labels`
// plus, maybe, a key in `domains.label_colors`. Settings › Labels joins the
// two and rewrites both on rename / delete. These are the joins and the
// rewrites, with the network cut out.

const row = (id: string, ...labels: string[]): LabelUsageRow => ({ id, labels });

describe('buildLabelCatalog — one list from two sources', () => {
  it('counts each Element once per label, however many times it lists it', () => {
    const entries = buildLabelCatalog([row('a', 'Bug', 'Bug'), row('b', 'Bug')], {});
    expect(entries).toEqual([{ name: 'Bug', count: 2, colorKey: null }]);
  });

  it('trims whitespace and ignores empty strings so " Bug " and "Bug" are one label', () => {
    const entries = buildLabelCatalog([row('a', ' Bug '), row('b', 'Bug', '', '  ')], {});
    expect(entries).toEqual([{ name: 'Bug', count: 2, colorKey: null }]);
  });

  it('lists a colour-only label as unused rather than dropping it', () => {
    const entries = buildLabelCatalog([row('a', 'Bug')], { Bug: 'red', Later: 'teal' });
    expect(entries).toEqual([
      { name: 'Bug', count: 1, colorKey: 'red' },
      { name: 'Later', count: 0, colorKey: 'teal' },
    ]);
  });

  it('sorts by name, case-insensitively first, so "bug" sits beside "Bug"', () => {
    const names = buildLabelCatalog([row('a', 'zeta', 'Bug', 'alpha', 'bug')], {}).map((e) => e.name);
    expect(names).toEqual(['alpha', 'Bug', 'bug', 'zeta']);
  });

  it('returns nothing when nothing is labelled and no colour is stored', () => {
    expect(buildLabelCatalog([row('a'), row('b')], {})).toEqual([]);
  });
});

describe('elementsWithLabel', () => {
  it('matches on the trimmed name only', () => {
    const rows = [row('a', ' Bug'), row('b', 'Bugs'), row('c', 'bug')];
    expect(elementsWithLabel(rows, 'Bug').map((r) => r.id)).toEqual(['a']);
  });
});

describe('renameLabelIn — one Element', () => {
  it('replaces the label in place and leaves the others alone', () => {
    expect(renameLabelIn(['Ops', 'Bug', 'P1'], 'Bug', 'Defect')).toEqual(['Ops', 'Defect', 'P1']);
  });

  it('collapses the two when the Element already carries the new name', () => {
    expect(renameLabelIn(['Defect', 'Bug'], 'Bug', 'Defect')).toEqual(['Defect']);
    expect(renameLabelIn(['Bug', 'Defect'], 'Bug', 'Defect')).toEqual(['Defect']);
  });

  it('is a no-op on an Element that does not carry the label', () => {
    expect(renameLabelIn(['Ops'], 'Bug', 'Defect')).toEqual(['Ops']);
  });
});

describe('removeLabelFrom', () => {
  it('drops every spelling that trims to the name', () => {
    expect(removeLabelFrom(['Bug', ' Bug ', 'Ops'], 'Bug')).toEqual(['Ops']);
  });
});

describe('planLabelRename / planLabelRemove — only the rows that change', () => {
  const rows = [row('a', 'Bug', 'Ops'), row('b', 'Ops'), row('c', 'Defect', 'Bug')];

  it('rename writes only the Elements carrying the old name', () => {
    expect(planLabelRename(rows, 'Bug', 'Defect')).toEqual([
      { id: 'a', labels: ['Defect', 'Ops'] },
      { id: 'c', labels: ['Defect'] },
    ]);
  });

  it('remove writes only the Elements carrying the name', () => {
    expect(planLabelRemove(rows, 'Bug')).toEqual([
      { id: 'a', labels: ['Ops'] },
      { id: 'c', labels: ['Defect'] },
    ]);
  });

  it('plans nothing for a label nobody carries', () => {
    expect(planLabelRename(rows, 'Ghost', 'Spirit')).toEqual([]);
    expect(planLabelRemove(rows, 'Ghost')).toEqual([]);
  });
});

describe('renameLabelColor — the colour follows the name', () => {
  it('moves the key', () => {
    expect(renameLabelColor({ Bug: 'red', Ops: 'teal' }, 'Bug', 'Defect')).toEqual({ Defect: 'red', Ops: 'teal' });
  });

  it('keeps the target colour when renaming onto an existing label — a merge', () => {
    expect(renameLabelColor({ Bug: 'red', Defect: 'purple' }, 'Bug', 'Defect')).toEqual({ Defect: 'purple' });
  });

  it('changes nothing when the old name had no colour', () => {
    expect(renameLabelColor({ Ops: 'teal' }, 'Bug', 'Defect')).toEqual({ Ops: 'teal' });
  });

  it('is a copy, not the same object, even for a same-name rename', () => {
    const colors = { Bug: 'red' };
    const next = renameLabelColor(colors, 'Bug', 'Bug');
    expect(next).toEqual(colors);
    expect(next).not.toBe(colors);
  });
});

describe('removeLabelColor', () => {
  it('drops the key without touching the input', () => {
    const colors = { Bug: 'red', Ops: 'teal' };
    expect(removeLabelColor(colors, 'Bug')).toEqual({ Ops: 'teal' });
    expect(colors).toEqual({ Bug: 'red', Ops: 'teal' });
  });
});

describe('restoreColorKeys — rolling back one edit under a later one', () => {
  it('restores the named keys and leaves the rest as they are now', () => {
    const snapshot = { Bug: 'red', Ops: 'teal' };
    const now = { Bug: 'purple', Ops: 'green', New: 'pink' };
    expect(restoreColorKeys(now, snapshot, ['Bug'])).toEqual({ Bug: 'red', Ops: 'green', New: 'pink' });
  });

  it('deletes a key the snapshot never had', () => {
    expect(restoreColorKeys({ Bug: 'red', New: 'pink' }, { Bug: 'red' }, ['New'])).toEqual({ Bug: 'red' });
  });

  it('undoes a rename by restoring both ends', () => {
    const before = { Bug: 'red' };
    const after = renameLabelColor(before, 'Bug', 'Defect');
    expect(restoreColorKeys(after, before, ['Bug', 'Defect'])).toEqual(before);
  });
});

describe('newLabelProblem', () => {
  const entries = buildLabelCatalog([row('a', 'Bug')], { Later: 'teal' });

  it('rejects an empty name', () => {
    expect(newLabelProblem('', entries)).toBe('Give the label a name.');
  });

  it('rejects a name already in use — whether by an Element or by the colour map alone', () => {
    expect(newLabelProblem('Bug', entries)).toBe('“Bug” already exists.');
    expect(newLabelProblem('Later', entries)).toBe('“Later” already exists.');
  });

  it('accepts a new name; "bug" and "Bug" are different strings on the Element', () => {
    expect(newLabelProblem('Defect', entries)).toBeNull();
    expect(newLabelProblem('bug', entries)).toBeNull();
  });
});

describe('count wording', () => {
  it('pluralises Elements and never says Task', () => {
    expect(formatElementCount(1)).toBe('1 Element');
    expect(formatElementCount(2)).toBe('2 Elements');
    expect(formatElementCount(0)).toBe('0 Elements');
  });

  it('reads zero as Unused in the catalogue', () => {
    expect(formatLabelCount(0)).toBe('Unused');
    expect(formatLabelCount(1)).toBe('1 Element');
  });
});
