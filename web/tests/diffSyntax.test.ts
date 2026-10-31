import { describe, expect, it } from 'vitest';
import { common, createLowlight } from 'lowlight';
import { parsePatch } from '@/Function/codeReview/diffModel';
import { highlightHunks, languageOf } from '@/Function/codeReview/syntax';

const lowlight = createLowlight(common);
const highlight = (code: string, language: string) => lowlight.highlight(language, code);

describe('languageOf', () => {
  it('reads the language from the extension or the file name', () => {
    expect(languageOf('web/src/a.tsx')).toBe('typescript');
    expect(languageOf('supabase/migrations/x.sql')).toBe('sql');
    expect(languageOf('Dockerfile')).toBe('bash');
    expect(languageOf('LICENSE')).toBeNull();
    expect(languageOf('.env')).toBeNull();
  });
});

describe('multi-line constructs', () => {
  it('keeps a block comment coloured on every line it spans', () => {
    const [lines] = highlightHunks(parsePatch('@@ -1,3 +1,3 @@\n const a = 1\n /* one\n two */'), 'typescript', highlight);
    expect(lines).toHaveLength(3);
    expect(lines[0][0]).toEqual({ text: 'const', cls: 'hljs-keyword' });
    expect(lines[2]).toEqual([{ text: 'two */', cls: 'hljs-comment' }]);
  });
});

describe('highlightHunks', () => {
  it('colours deleted lines from the old side and added lines from the new side', () => {
    const hunks = parsePatch('@@ -1,3 +1,3 @@\n const a = 1\n-let b = "x"\n+const b = 2\n return a');
    const [lines] = highlightHunks(hunks, 'typescript', highlight);
    expect(lines).toHaveLength(4);
    expect(lines[1].find((t) => t.cls === 'hljs-string')?.text).toBe('"x"');
    expect(lines[2].find((t) => t.cls === 'hljs-number')?.text).toBe('2');
    expect(lines.map((l) => l.map((t) => t.text).join(''))).toEqual(['const a = 1', 'let b = "x"', 'const b = 2', 'return a']);
  });
  it('falls back to plain text when the language is unknown', () => {
    const hunks = parsePatch('@@ -1 +1 @@\n-a\n+b');
    expect(highlightHunks(hunks, 'no-such-language', highlight)[0]).toEqual([[{ text: 'a', cls: null }], [{ text: 'b', cls: null }]]);
  });
});
