import { describe, expect, it } from 'vitest';
import {
  buildLabelCatalog,
  diffColorPatch,
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
  renameTouchedColorKeys,
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

describe('renameTouchedColorKeys — only claim a colour this rename actually set', () => {
  it('includes the destination when it had no colour — the rename gave it one', () => {
    expect(renameTouchedColorKeys({ Bug: 'red' }, 'Bug', 'Defect')).toEqual(['Bug', 'Defect']);
  });

  it('excludes the destination when it already had a colour — a merge, unchanged', () => {
    // Regression (ELE_QLT-032 review): naming Defect here made a merge-rename
    // re-assert its own (possibly stale) colour, silently undoing a
    // concurrent pick on Defect from an Element detail panel that landed
    // during the rename's Element-rewrite window.
    expect(renameTouchedColorKeys({ Bug: 'red', Defect: 'purple' }, 'Bug', 'Defect')).toEqual(['Bug']);
  });

  it('excludes the destination when the source had no colour either — nothing moved', () => {
    // A second-pass regression on the same fix: getting only the
    // destination's own colour-presence right still named it touched here,
    // which diffColorPatch then read as an explicit removal this rename
    // never intended (Bug carried no colour, so renameLabelColor changes
    // nothing at all).
    expect(renameTouchedColorKeys({}, 'Bug', 'Defect')).toEqual(['Bug']);
    expect(renameTouchedColorKeys({ Ops: 'teal' }, 'Bug', 'Defect')).toEqual(['Bug']);
  });
});

describe('diffColorPatch — only what a colour write should actually assert', () => {
  it('a touched key present in the result is a set', () => {
    expect(diffColorPatch({ Bug: 'red' }, ['Bug'])).toEqual({ set: { Bug: 'red' }, remove: [] });
  });

  it('a touched key absent from the result is a removal', () => {
    expect(diffColorPatch({ Ops: 'teal' }, ['Bug'])).toEqual({ set: {}, remove: ['Bug'] });
  });

  it('a rename is one set (the destination) and one removal (the source)', () => {
    const after = renameLabelColor({ Bug: 'red' }, 'Bug', 'Defect');
    expect(diffColorPatch(after, ['Bug', 'Defect'])).toEqual({ set: { Defect: 'red' }, remove: ['Bug'] });
  });

  it('a rename onto an existing label keeps the destination colour and still removes the source', () => {
    const after = renameLabelColor({ Bug: 'red', Defect: 'purple' }, 'Bug', 'Defect');
    expect(diffColorPatch(after, ['Bug', 'Defect'])).toEqual({ set: { Defect: 'purple' }, remove: ['Bug'] });
  });

  it('never mentions a key the operation did not touch, however large the map', () => {
    const after = { Bug: 'red', Ops: 'teal', Later: 'pink' };
    expect(diffColorPatch(after, ['Ops'])).toEqual({ set: { Ops: 'teal' }, remove: [] });
  });

  it('an untouched map produces an empty patch', () => {
    expect(diffColorPatch({ Bug: 'red' }, [])).toEqual({ set: {}, remove: [] });
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

  // Regression: creating "bug" here while "Bug" already exists used to be
  // allowed (exact-string check), producing two catalogue rows that
  // ElementDetailView's label picker — case-insensitive throughout — treats
  // as one and the same label. The check is case-insensitive so *creating* a
  // new collision is blocked; existing case-variant data (from before this
  // fix, or from an Element typed inconsistently) is unaffected and gets
  // reconciled by rename, not by refusing to create anything.
  it('rejects a name that only differs from an existing one by case', () => {
    expect(newLabelProblem('bug', entries)).toBe('“bug” already exists.');
    expect(newLabelProblem('BUG', entries)).toBe('“BUG” already exists.');
    expect(newLabelProblem('later', entries)).toBe('“later” already exists.');
  });

  it('accepts a genuinely new name', () => {
    expect(newLabelProblem('Defect', entries)).toBeNull();
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
