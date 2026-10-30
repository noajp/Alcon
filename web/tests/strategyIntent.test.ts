import { describe, expect, it } from 'vitest';
import { extractStrategyIntent } from '@/ActivitySpace/execution/object/overview/strategyIntent';

// extractStrategyIntent is what stands between a Initiative description and a
// side rail a few rows tall. Its contract: cut only on seams the author wrote
// (headings, paragraph breaks, list boundaries) — never mid-sentence — keep the
// sections that state what winning looks like, drop the ones about process and
// means, and hand back an empty array (not a blank row) when a Initiative has
// said nothing at all.
//
// Both long fixtures below are the real `strategies.description` of the only
// two Initiatives in the database that have one. They are deliberately different
// shapes, because between them they are the whole problem:
//
//   OP KESTREL RELIEF — `## Ends` / `## Ways` / `## Means` / `## 成功条件`,
//     every section a bullet list. Opens with framing, so a leading-N-character
//     excerpt yields a preamble that is neither intent nor success criteria.
//   Alcon Self-Build — `## 勝ち筋` / `## 前提` / `## 成功条件と現在地`,
//     prose paragraphs, bold pseudo-sub-headings, bullets under a section that
//     must NOT be shown.

const KESTREL = `【架空演習】ケストレル火山噴火（アルダニア共和国・架空）に対する多国籍 HADR 作戦。

## Ends（何を達成するか）
- 被災 72h 以内に生存に直結する支援（水・食料・医療）を被災 3 島へ届ける
- D+8 以降、支援機能を地元行政・NGO へ段階移管し、依存を作らずに撤収する

## Ways（どう勝つか）
- RECON の評価を単一情報源とし、受入能力に合わせて空輸・海上輸送を配分する
- 医療・配布・避難所を「面」で同時展開し、単点のボトルネックを作らない
- Phase I 即応・評価 → Phase II 安定化 → Phase III 移管・撤収

## Means（何を投入するか）
- RECON / TF-AIR / TF-MED / TF-LOG / TF-CIV の 5 部隊

## 成功条件
- 12 避難所への日次配布ラインが 3 日連続で回る
- 野外医療所 3 箇所の診療と後送チェーンが機能する
- Phase III 終了時点で全機能の移管合意が成立している`;

// Verbatim: this line's wording is the actual strategies.description row,
// written before the Campaign→Initiative rename — kept as "Campaign" here on
// purpose so this fixture stays true to what's really stored, not to what the
// concept is called today.
const SELF_BUILD = `Alcon 自身を Alcon 上で開発する Campaign。

## 勝ち筋
Element の記述品質がそのままエージェントの実行品質になる構造を作り、自己改善ループを回す。

## 前提
- 実装は Claude（ai_agent Worker）が worktree + PR で行う
- **マージまで Claude が担う**（2026-08-30 ユーザー委任）

## 成功条件と現在地（2026-08-30 時点）

**(1) バックログが Alcon 内で完結する — 達成**
Sprint 1・2 とも起票から完了報告まで全て Alcon DB 上。

**(2) ループが 1 スプリント自走する — 未達成**`;

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

describe('extractStrategyIntent — OP KESTREL RELIEF (Ends / Ways / Means / 成功条件)', () => {
  const sections = extractStrategyIntent(KESTREL);

  it('keeps Ends, Ways and 成功条件, and drops Means', () => {
    expect(sections.map((s) => s.heading)).toEqual([
      null,
      'Ends（何を達成するか）',
      'Ways（どう勝つか）',
      '成功条件',
    ]);
  });

  // The acceptance line for this whole feature: someone standing in TF-MED
  // must be able to read the 72-hour aim without leaving the Object.
  it('surfaces the 72-hour aim verbatim, not a preamble', () => {
    const ends = sections.find((s) => s.heading?.startsWith('Ends'));
    expect(ends?.items[0]).toBe(
      '被災 72h 以内に生存に直結する支援（水・食料・医療）を被災 3 島へ届ける',
    );
  });

  it('does not lose the success criteria to the section budget', () => {
    const success = sections.find((s) => s.heading === '成功条件');
    expect(success?.items[0]).toBe('12 避難所への日次配布ラインが 3 日連続で回る');
  });

  it('keeps each bullet a separate item instead of welding them together', () => {
    const ends = sections.find((s) => s.heading?.startsWith('Ends'));
    expect(ends?.items).toHaveLength(2);
    // The specific regression: joining these two bullets produced
    // "…被災 3 島へ届けるD+8 以降、…" with nothing between the sentences.
    for (const item of ends!.items) expect(item).not.toContain('届けるD+8');
  });

  it('does not offer the preamble alone as the answer', () => {
    expect(sections[0].items[0]).toContain('HADR');
    expect(sections.length).toBeGreaterThan(1);
  });
});

describe('extractStrategyIntent — Alcon Self-Build (prose + bold sub-headings)', () => {
  const sections = extractStrategyIntent(SELF_BUILD);

  it('leads with the un-headed opening paragraph', () => {
    expect(sections[0]).toEqual({
      heading: null,
      items: ['Alcon 自身を Alcon 上で開発する Campaign。'],
    });
  });

  it('keeps the win condition and success criteria, dropping 前提', () => {
    expect(sections.map((s) => s.heading)).toEqual([
      null,
      '勝ち筋',
      '成功条件と現在地（2026-08-30 時点）',
    ]);
    expect(sections.some((s) => s.heading === '前提')).toBe(false);
  });

  it('strips bold markers rather than showing literal asterisks', () => {
    const success = sections.find((s) => s.heading?.includes('成功条件'));
    expect(success?.items).toEqual(['(1) バックログが Alcon 内で完結する — 達成']);
    for (const s of sections) {
      for (const item of s.items) expect(item).not.toContain('**');
    }
  });

  it('never cuts a sentence in half', () => {
    for (const s of sections) {
      expect(s.items.length).toBeGreaterThan(0);
      for (const item of s.items) {
        expect(item).not.toMatch(/…$/);
        expect(item).toBe(item.trim());
        expect(item.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('extractStrategyIntent — cutting on authored seams', () => {
  it('takes only the opening block of a section, not the whole section', () => {
    const [only] = extractStrategyIntent(
      '## Ways\nHow we win.\n\nA second paragraph that the rail must not show.\n',
    );
    expect(only.items).toEqual(['How we win.']);
  });

  it('ends a bullet list where the bullets stop', () => {
    const [only] = extractStrategyIntent(
      '## Goal\n- first\n- second\n\nTrailing prose the rail must not show.\n',
    );
    expect(only.items).toEqual(['first', 'second']);
  });

  it('ends prose where a bullet list begins — a change of form is a seam', () => {
    const [only] = extractStrategyIntent('## Goal\nThe aim.\n- not this\n');
    expect(only.items).toEqual(['The aim.']);
  });

  it('joins the lines of one paragraph with a space in latin prose', () => {
    const [only] = extractStrategyIntent('Ship the thing\nby the end of Q3.');
    expect(only.items).toEqual(['Ship the thing by the end of Q3.']);
  });

  it('joins the lines of one paragraph without a space in Japanese prose', () => {
    const [only] = extractStrategyIntent('日本語は空白で\n折り返さない。');
    expect(only.items).toEqual(['日本語は空白で折り返さない。']);
  });

  it('reads a heading-less description as a single lead section', () => {
    expect(extractStrategyIntent('Just one line of intent.')).toEqual([
      { heading: null, items: ['Just one line of intent.'] },
    ]);
  });

  it('accepts ordered lists as well as bulleted ones', () => {
    const [only] = extractStrategyIntent('## Goal\n1. first\n2. second\n');
    expect(only.items).toEqual(['first', 'second']);
  });
});

describe('extractStrategyIntent — a fully bold line is a seam', () => {
  it('stops after a bold lead-in instead of welding the next sentence to it', () => {
    const [only] = extractStrategyIntent(
      '## Goal\n**(1) Ship it — done**\nThe supporting detail nobody needs here.\n',
    );
    expect(only.items).toEqual(['(1) Ship it — done']);
  });

  it('stops before a bold line that follows prose', () => {
    const [only] = extractStrategyIntent('## Goal\nThe actual goal.\n**A claim about it**\n');
    expect(only.items).toEqual(['The actual goal.']);
  });

  it('leaves a partially bold line joined to its paragraph', () => {
    const [only] = extractStrategyIntent('## Goal\nShip **fast** and\nkeep it simple.\n');
    expect(only.items).toEqual(['Ship fast and keep it simple.']);
  });
});

describe('extractStrategyIntent — choosing which sections', () => {
  it('matches intent headings case-insensitively and as substrings', () => {
    const sections = extractStrategyIntent(
      '## Background\nSkip me.\n\n## SUCCESS criteria\nKeep me.\n',
    );
    expect(sections.map((s) => s.heading)).toEqual(['SUCCESS criteria']);
  });

  it('treats Means as Execution, not intent', () => {
    const sections = extractStrategyIntent(
      '## Means\nFive task forces.\n\n## Ends\nThe aim.\n',
    );
    expect(sections.map((s) => s.heading)).toEqual(['Ends']);
  });

  it('falls back to the first section when no heading names an intent', () => {
    const sections = extractStrategyIntent(
      '## Team\nWho is on it.\n\n## Schedule\nWhen it happens.\n',
    );
    expect(sections).toEqual([{ heading: 'Team', items: ['Who is on it.'] }]);
  });

  it('caps the result at four sections so the rail cannot be flooded', () => {
    const sections = extractStrategyIntent(
      'Lead.\n\n## Ends\na\n\n## Ways\nb\n\n## Goal\nc\n\n## Objective\nd\n',
    );
    expect(sections).toHaveLength(4);
    expect(sections.map((s) => s.heading)).toEqual([null, 'Ends', 'Ways', 'Goal']);
  });

  it('caps the bullets shown within one section', () => {
    const [only] = extractStrategyIntent('## Goal\n- a\n- b\n- c\n- d\n- e\n');
    expect(only.items).toEqual(['a', 'b', 'c']);
  });

  it('preserves the order the author wrote the sections in', () => {
    const sections = extractStrategyIntent(
      '## 成功条件\nsecond in the doc\n\n## 勝ち筋\nthird in the doc\n',
    );
    expect(sections.map((s) => s.heading)).toEqual(['成功条件', '勝ち筋']);
  });
});
