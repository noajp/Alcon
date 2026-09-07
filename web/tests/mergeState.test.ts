import { describe, it, expect } from 'vitest';
import { classifyMergeState, REMOVAL_REASON } from '../../ops/mergeState.mjs';

describe('classifyMergeState', () => {
  it('a tip still equal to origin/main is untouched — nothing was ever committed', () => {
    expect(classifyMergeState({ behindEmpty: true, sameTip: true, missing: 0 })).toEqual({ kind: 'untouched' });
  });
  it('zero commits ahead but a tip behind main is an ancestor — merged or never touched, unknowable', () => {
    expect(classifyMergeState({ behindEmpty: true, sameTip: false, missing: 0 })).toEqual({ kind: 'ancestor' });
  });
  it('patches not upstream are unmerged, with the count', () => {
    expect(classifyMergeState({ behindEmpty: false, sameTip: false, missing: 3 })).toEqual({ kind: 'unmerged', count: 3 });
  });
  it('commits ahead whose patches are all upstream are equivalent (rebase/squash)', () => {
    expect(classifyMergeState({ behindEmpty: false, sameTip: false, missing: 0 })).toEqual({ kind: 'equivalent' });
  });
  it('never calls a zero-commit branch merged', () => {
    for (const k of ['untouched', 'ancestor'] as const) expect(REMOVAL_REASON[k]).not.toContain('取り込み済み');
    expect(REMOVAL_REASON.untouched).toContain('コミット0件');
  });
});
