import { describe, expect, it } from 'vitest';
import { splitMentions } from '@/Function/shared/mentions';

const marked = (text: string, names?: string[]) => splitMentions(text, names).filter((p) => p.mention).map((p) => p.text);

describe('splitMentions', () => {
  it('colours @AI and keeps the rest as text', () => {
    expect(splitMentions('@AI  ネット上に乗ってるものは全部')).toEqual([
      { text: '@AI', mention: true },
      { text: '  ネット上に乗ってるものは全部', mention: false },
    ]);
  });

  it('colours a known name whole, with a space or in Japanese, longest first', () => {
    expect(marked('@Claude Code 【推奨】date 型に変える', ['Claude', 'Claude Code'])).toEqual(['@Claude Code']);
    expect(marked('確認お願いします@中野貴慶さん', ['中野貴慶'])).toEqual(['@中野貴慶']);
    expect(marked('＠ai 続けて')).toEqual(['＠ai']);
  });

  it('takes one Latin word for an unknown name, and nothing for unknown Japanese', () => {
    expect(marked('@tanaka please check')).toEqual(['@tanaka']);
    expect(marked('@山田さんに聞く')).toEqual([]);
  });

  it('leaves addresses alone', () => {
    expect(marked('mail a@b.com or https://x.com/@nakano')).toEqual([]);
  });

  it('loses no character', () => {
    const text = 'まず @AI に聞いて、次に @Claude Code。';
    expect(splitMentions(text, ['Claude Code']).map((p) => p.text).join('')).toBe(text);
  });
});
