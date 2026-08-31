import { describe, expect, it } from 'vitest';
import { extractStrategyIntent } from '@/alcon/object/overview/strategyIntent';

// extractStrategyIntent is what stands between a 1,300-character Campaign
// description and a side rail four rows tall. Its contract: cut only on seams
// the author wrote (headings, paragraph breaks) — never mid-sentence — keep the
// sections that state what winning looks like, drop the ones about process,
// and hand back an empty array (not a blank row) when a Campaign has said
// nothing at all.
//
// The long fixture below is the real `strategies.description` of the
// "Friction Self-Build" Campaign, abridged. It is the only Campaign in the
// database that has a description, so it is the shape this code must handle:
// a lead sentence, `## ` sections, bold runs, and bullet lists.

const REAL_DESCRIPTION = [
  'Friction 自身を Friction 上で開発する Campaign。',
  '',
  '## 勝ち筋',
  'Element の記述品質がそのままエージェントの実行品質になる構造を作り、自己改善ループを回す。',
  '',
  '## 前提',
  '- 実装は Claude（ai_agent Worker）が worktree + PR で行う',
  '- **マージまで Claude が担う**（2026-08-30 ユーザー委任）',
  '',
  '## 成功条件と現在地（2026-08-30 時点）',
  '',
  '**(1) バックログが Friction 内で完結する — 達成**',
  'Sprint 1・2 とも起票から完了報告まで全て Friction DB 上。',
  '',
  '**(2) ループが 1 スプリント自走する — 未達成**',
].join('\n');

describe('extractStrategyIntent — nothing to say', () => {
  it('returns an empty array for null, undefined and blank input', () => {
    expect(extractStrategyIntent(null)).toEqual([]);
    expect(extractStrategyIntent(undefined)).toEqual([]);
    expect(extractStrategyIntent('')).toEqual([]);
    expect(extractStrategyIntent('   \n\n  \t ')).toEqual([]);
  });

  it('returns an empty array when the description is only headings', () => {
    expect(extractStrategyIntent('## 勝ち筋\n\n## 成功条件\n')).toEqual([]);
  });
});

describe('extractStrategyIntent — the real Campaign description', () => {
  const sections = extractStrategyIntent(REAL_DESCRIPTION);

  it('leads with the un-headed opening paragraph', () => {
    expect(sections[0]).toEqual({
      heading: null,
      body: 'Friction 自身を Friction 上で開発する Campaign。',
    });
  });

  it('keeps the win-condition and success-criteria sections, dropping process', () => {
    expect(sections.map((s) => s.heading)).toEqual([
      null,
      '勝ち筋',
      '成功条件と現在地（2026-08-30 時点）',
    ]);
    // `## 前提` is about how the Campaign is run, not what winning is.
    expect(sections.some((s) => s.heading === '前提')).toBe(false);
  });

  it('never cuts a sentence in half', () => {
    for (const s of sections) {
      expect(s.body).not.toMatch(/…$/);
      expect(s.body.length).toBeGreaterThan(0);
      expect(s.body).toBe(s.body.trim());
    }
  });

  it('strips bold markers rather than showing literal asterisks', () => {
    const success = sections.find((s) => s.heading?.includes('成功条件'));
    expect(success?.body).toBe('(1) バックログが Friction 内で完結する — 達成');
    for (const s of sections) expect(s.body).not.toContain('**');
  });
});

describe('extractStrategyIntent — a fully bold line is a seam', () => {
  it('stops after a bold lead-in instead of welding the next sentence to it', () => {
    const [only] = extractStrategyIntent(
      '## Goal\n**(1) Ship it — done**\nThe supporting detail nobody needs here.\n',
    );
    expect(only.body).toBe('(1) Ship it — done');
  });

  it('stops before a bold line that follows prose', () => {
    const [only] = extractStrategyIntent(
      '## Goal\nThe actual goal.\n**A claim about it**\n',
    );
    expect(only.body).toBe('The actual goal.');
  });

  it('leaves a partially bold line joined to its paragraph', () => {
    const [only] = extractStrategyIntent('## Goal\nShip **fast** and\nkeep it simple.\n');
    expect(only.body).toBe('Ship fast and keep it simple.');
  });
});

describe('extractStrategyIntent — cutting on authored seams', () => {
  it('takes only the first paragraph of a section, not the whole section', () => {
    const [only] = extractStrategyIntent(
      '## Ways\nHow we win.\n\nA second paragraph that the rail must not show.\n',
    );
    expect(only.body).toBe('How we win.');
  });

  it('joins the lines of one paragraph with a space in latin prose', () => {
    const [only] = extractStrategyIntent('Ship the thing\nby the end of Q3.');
    expect(only.body).toBe('Ship the thing by the end of Q3.');
  });

  it('joins the lines of one paragraph without a space in Japanese prose', () => {
    const [only] = extractStrategyIntent('日本語は空白で\n折り返さない。');
    expect(only.body).toBe('日本語は空白で折り返さない。');
  });

  it('reads a heading-less description as a single lead section', () => {
    expect(extractStrategyIntent('Just one line of intent.')).toEqual([
      { heading: null, body: 'Just one line of intent.' },
    ]);
  });

  it('turns a leading bullet into prose', () => {
    const [only] = extractStrategyIntent('## Goal\n- Win the quarter\n');
    expect(only.body).toBe('Win the quarter');
  });
});

describe('extractStrategyIntent — choosing which sections', () => {
  it('matches intent headings case-insensitively and as substrings', () => {
    const sections = extractStrategyIntent(
      '## Background\nSkip me.\n\n## SUCCESS criteria\nKeep me.\n',
    );
    expect(sections.map((s) => s.heading)).toEqual(['SUCCESS criteria']);
  });

  it('falls back to the first section when no heading names an intent', () => {
    const sections = extractStrategyIntent(
      '## Team\nWho is on it.\n\n## Schedule\nWhen it happens.\n',
    );
    expect(sections).toEqual([{ heading: 'Team', body: 'Who is on it.' }]);
  });

  it('caps the result at three sections so the rail cannot be flooded', () => {
    const sections = extractStrategyIntent(
      'Lead.\n\n## Ends\na\n\n## Ways\nb\n\n## Goal\nc\n\n## Objective\nd\n',
    );
    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.heading)).toEqual([null, 'Ends', 'Ways']);
  });

  it('preserves the order the author wrote the sections in', () => {
    const sections = extractStrategyIntent(
      '## 成功条件\nsecond in the doc\n\n## 勝ち筋\nthird in the doc\n',
    );
    expect(sections.map((s) => s.heading)).toEqual(['成功条件', '勝ち筋']);
  });
});
