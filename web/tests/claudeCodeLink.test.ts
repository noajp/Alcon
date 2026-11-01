import { describe, expect, it } from 'vitest';
import { claudeCodePrompt, claudeCodeUrl } from '@/Function/shared/claudeCodeLink';

describe('Claude Code link', () => {
  it('says what to work on, with where it sits and its description as text', () => {
    const prompt = claudeCodePrompt({
      kind: 'Element', identifier: 'REF-3', title: 'Error boundary',
      description: '<p>Add <b>error.tsx</b></p><p>and a toast&nbsp;&amp; notify</p>',
      path: ['APL_Div', 'リファクタリング'],
    });
    expect(prompt).toBe([
      'Work on Alcon Element REF-3:',
      '',
      '<element identifier="REF-3">',
      '<title>Error boundary</title>',
      '<location>APL_Div > リファクタリング</location>',
      '<description>\nAdd error.tsx\nand a toast & notify\n</description>',
      '</element>',
    ].join('\n'));
  });

  it('names an Object by its title when it has no id, and leaves out what is empty', () => {
    expect(claudeCodePrompt({ kind: 'Object', title: 'Refactor' })).toBe('Work on Alcon Object "Refactor":\n\n<object>\n<title>Refactor</title>\n</object>');
  });

  it('opens a new Claude Code session with the prompt encoded', () => {
    expect(claudeCodeUrl('a & b\nc')).toBe('claude://code/new?q=a%20%26%20b%0Ac');
  });
});
