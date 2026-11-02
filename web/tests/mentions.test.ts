import { describe, expect, it } from 'vitest';
import {
  detectMentionQuery,
  insertMentionText,
  mentionMatchRank,
  mentionedUserIds,
  rankMentionCandidates,
} from '@/Function/shared/mentions';

describe('detectMentionQuery', () => {
  it('opens on a bare @ at the start or after a space', () => {
    expect(detectMentionQuery('@')).toEqual({ start: 0, query: '' });
    expect(detectMentionQuery('hi @tak')).toEqual({ start: 3, query: 'tak' });
  });

  it('accepts Japanese names in the query', () => {
    expect(detectMentionQuery('@中')).toEqual({ start: 0, query: '中' });
    expect(detectMentionQuery('@なかの')).toEqual({ start: 0, query: 'なかの' });
  });

  it('opens right after Japanese text with no space', () => {
    expect(detectMentionQuery('確認お願いします@中')).toEqual({ start: 8, query: '中' });
    expect(detectMentionQuery('（@中')).toEqual({ start: 1, query: '中' });
  });

  it('treats a full-width ＠ like @', () => {
    expect(detectMentionQuery('確認＠中野')).toEqual({ start: 2, query: '中野' });
  });

  it('stays closed inside an e-mail address', () => {
    expect(detectMentionQuery('a@b')).toBeNull();
    expect(detectMentionQuery('a@b.com')).toBeNull();
    expect(detectMentionQuery('taro.y@')).toBeNull();
    expect(detectMentionQuery('https://x.com/@nak')).toBeNull();
    expect(detectMentionQuery('mailto:@nak')).toBeNull();
  });

  it('closes once the name has ended', () => {
    expect(detectMentionQuery('@中野 ')).toBeNull();
    expect(detectMentionQuery('@中野、')).toBeNull();
    expect(detectMentionQuery('no mention here')).toBeNull();
    expect(detectMentionQuery('')).toBeNull();
  });

  it('keeps dots so an e-mail-like query can match', () => {
    expect(detectMentionQuery('@taro.y')).toEqual({ start: 0, query: 'taro.y' });
  });
});

describe('mentionMatchRank / rankMentionCandidates', () => {
  it('ranks a name prefix above a substring', () => {
    expect(mentionMatchRank('中', '中野貴慶')).toBe(0);
    expect(mentionMatchRank('野', '中野貴慶')).toBe(2);
    expect(mentionMatchRank('山', '中野貴慶')).toBe(-1);
  });

  it('matches a word start, an e-mail prefix, and folds width and case', () => {
    expect(mentionMatchRank('nak', 'Takanori Nakano')).toBe(0);
    expect(mentionMatchRank('n.tak', 'Takanori', 'n.takanori@example.com')).toBe(1);
    expect(mentionMatchRank('ＮＡＫ', 'nakano')).toBe(0);
  });

  it('orders matches by rank and keeps the original order on ties', () => {
    const people = [
      { name: '山中太郎' },
      { name: '中野貴慶' },
      { name: '佐藤' },
      { name: '中村' },
    ];
    expect(rankMentionCandidates(people, '中', (p) => ({ name: p.name })).map((p) => p.name))
      .toEqual(['中野貴慶', '中村', '山中太郎']);
    expect(rankMentionCandidates(people, '', (p) => ({ name: p.name }))).toHaveLength(4);
  });
});

describe('insertMentionText', () => {
  it('replaces the typed query (and a full-width ＠) with @name', () => {
    expect(insertMentionText('確認お願いします@中 です', { start: 8, query: '中' }, '中野貴慶'))
      .toBe('確認お願いします@中野貴慶  です');
    expect(insertMentionText('＠な', { start: 0, query: 'な' }, '中野')).toBe('@中野 ');
  });
});

describe('mentionedUserIds', () => {
  const workers = [
    { name: '中野貴慶', user_id: 'u1' },
    { name: 'Takanori Nakano', user_id: 'u2' },
    { name: 'Bot', user_id: null },
  ];

  it('finds Japanese and Latin names, ending at punctuation or the end', () => {
    expect(mentionedUserIds('確認お願いします@中野貴慶。', workers)).toEqual(['u1']);
    expect(mentionedUserIds('@Takanori Nakano', workers)).toEqual(['u2']);
    expect(mentionedUserIds('＠中野貴慶 さん', workers)).toEqual(['u1']);
  });

  it('ignores an @ inside an e-mail address or a URL', () => {
    const ws = [{ name: 'nakano', user_id: 'u3' }];
    expect(mentionedUserIds('連絡先は info@nakano です', ws)).toEqual([]);
    expect(mentionedUserIds('https://user@nakano.jp/x', ws)).toEqual([]);
    expect(mentionedUserIds('https://x.com/@nakano', ws)).toEqual([]);
    expect(mentionedUserIds('確認@nakano', ws)).toEqual(['u3']);
  });

  it('prefers the longest name and drops a shorter name inside it', () => {
    const ws = [
      { name: 'Takanori', user_id: 'short' },
      { name: 'Takanori Nakano', user_id: 'long' },
    ];
    expect(mentionedUserIds('@Takanori Nakano please', ws)).toEqual(['long']);
    expect(mentionedUserIds('@Takanori Nakano and @Takanori', ws).sort()).toEqual(['long', 'short']);
  });

  it('names every Worker who shares the exact name', () => {
    const ws = [
      { name: '佐藤', user_id: 's1' },
      { name: '佐藤', user_id: 's2' },
      { name: '佐藤花子', user_id: 'h' },
    ];
    expect(mentionedUserIds('@佐藤 お願いします', ws).sort()).toEqual(['s1', 's2']);
    expect(mentionedUserIds('@佐藤花子 お願いします', ws)).toEqual(['h']);
  });

  it('ignores a name that continues and Workers without a user', () => {
    expect(mentionedUserIds('@中野貴慶さん', workers)).toEqual([]);
    expect(mentionedUserIds('@Bot', workers)).toEqual([]);
  });
});
