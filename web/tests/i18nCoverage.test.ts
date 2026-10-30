import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { MESSAGES } from '@/Function/i18n/messages';

// Every message the app passes to t() or translate() as a literal must be
// translated in every locale — otherwise a Japanese (or Korean, French,
// Spanish) viewer meets that one string in English. Keys built at runtime
// (a label table, a variable) are out of reach of this scan; their tables
// are checked by their own tests where they exist (widgetI18n).
const SRC = join(__dirname, '..', 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const LITERAL = /\b(?:t|translate)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")\s*[,)]/g;
const unescape = (raw: string) => raw.replace(/\\(['"\\])/g, '$1');

describe('i18n coverage', () => {
  it('translates every literal message in every locale', () => {
    const keys = new Map<string, string>();
    for (const file of files(SRC)) {
      for (const match of readFileSync(file, 'utf8').matchAll(LITERAL)) {
        const key = unescape(match[1] ?? match[2] ?? '');
        if (key && !keys.has(key)) keys.set(key, relative(SRC, file));
      }
    }
    for (const locale of ['ja', 'ko', 'fr', 'es'] as const) {
      const missing = [...keys].filter(([key]) => !(key in MESSAGES[locale])).map(([key, file]) => `${file}: ${key}`);
      expect(missing, locale).toEqual([]);
    }
  });
});
