import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../src/Function/i18n/messages';
import { SCM_MESSAGES } from '../src/Function/i18n/scmMessages';
import { SCM_VIEW_LABEL } from '../src/ActivitySpace/sustainment/scm/scmNavigation';
import { HEALTH_LABEL, PO_STATUS_LABEL } from '../src/ActivitySpace/sustainment/scm/scmText';

const SCM_DIR = join(__dirname, '../src/ActivitySpace/sustainment/scm');

/** Every string literal passed straight to `t(` in the SCM App, including
 * each branch of a `t(a ? 'X' : 'Y')` ternary. Literals compared with
 * `===` are conditions, not messages. */
function scmMessageKeys(): string[] {
  const keys = new Set<string>();
  const literal = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g;
  for (const file of readdirSync(SCM_DIR).filter(name => /\.tsx?$/.test(name))) {
    const source = readFileSync(join(SCM_DIR, file), 'utf8');
    const call = /(?<![\w.$])t\(/g;
    for (let match = call.exec(source); match; match = call.exec(source)) {
      // The first argument runs to the top-level comma or closing paren.
      let end = match.index + 2;
      let depth = 0;
      let quote: string | null = null;
      for (; end < source.length; end++) {
        const char = source[end];
        if (quote) {
          if (char === '\\') end++;
          else if (char === quote) quote = null;
          continue;
        }
        if (char === "'" || char === '"' || char === '`') quote = char;
        else if ('([{'.includes(char)) depth++;
        else if (')]}'.includes(char)) { if (depth === 0) break; depth--; }
        else if (char === ',' && depth === 0) break;
      }
      const argument = source.slice(match.index + 2, end);
      for (let found = literal.exec(argument); found; found = literal.exec(argument)) {
        const before = argument.slice(0, found.index).trimEnd();
        const after = argument.slice(found.index + found[0].length).trimStart();
        if (/[!=]==?$/.test(before) || /^[!=]==?/.test(after)) continue;
        keys.add((found[1] ?? found[2]).replace(/\\(.)/g, '$1'));
      }
      literal.lastIndex = 0;
    }
  }
  return [...keys];
}

describe('SCM i18n', () => {
  // Labels kept in maps reach `t` indirectly, as t(HEALTH_LABEL[health]).
  const keys = [...scmMessageKeys(), ...Object.values(HEALTH_LABEL), ...Object.values(PO_STATUS_LABEL), ...Object.values(SCM_VIEW_LABEL)];

  it('finds the SCM messages', () => {
    expect(keys.length).toBeGreaterThan(300);
  });

  it('translates every SCM message in every locale', () => {
    for (const locale of ['ja', 'ko', 'fr', 'es'] as const) {
      const missing = keys.filter(key => !(key in MESSAGES[locale]));
      expect(missing, locale).toEqual([]);
    }
  });

  it('keeps placeholders intact in every translation', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const [locale, dictionary] of Object.entries(SCM_MESSAGES)) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(placeholders(value), `${locale}: ${key}`).toEqual(placeholders(key));
      }
    }
  });
});
