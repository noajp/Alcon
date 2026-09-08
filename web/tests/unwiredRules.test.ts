// The rule behind unwired-lint: which exported values nothing imports.
//
// Worth pinning because both directions of error are silent. A missed import
// form (the shell loads every view through `dynamic(() => import(…))`) reports
// the live app as dead and the check gets switched off within a day. A stray
// match — an identifier in a comment, a commented-out import — reports dead
// code as live and the check quietly stops finding anything.

import { describe, expect, it } from 'vitest';

// The rules module is plain ESM, shared with the CLI, so it carries no types.
import { exportsOf, importedNamesOf, findUnwired, isEntryPoint } from '../scripts/unwiredRules.mjs';

const names = (source: string): string[] => [...(exportsOf(source) as Set<string>)].sort();
const imported = (source: string): string[] => [...(importedNamesOf(source) as Set<string>)].sort();

describe('exportsOf', () => {
  it('finds function, class and const exports', () => {
    expect(names(`
      export function alpha() {}
      export async function beta() {}
      export class Gamma {}
      export const delta = 1;
    `)).toEqual(['Gamma', 'alpha', 'beta', 'delta']);
  });

  it('finds names in an export list, resolving aliases to the exported name', () => {
    expect(names('const a = 1; export { a as publicName };')).toEqual(['publicName']);
  });

  it('ignores re-export lists, which define nothing here', () => {
    expect(names(`export { thing } from './elsewhere';`)).toEqual([]);
  });

  it('ignores types — an unused interface is untidy, not an unreachable feature', () => {
    expect(names(`
      export interface Shape {}
      export type Alias = string;
      export const value = 1;
    `)).toEqual(['value']);
  });

  it('does not see exports inside comments', () => {
    expect(names(`
      // export function ghost() {}
      /* export const alsoGhost = 1; */
      export const real = 1;
    `)).toEqual(['real']);
  });
});

describe('importedNamesOf', () => {
  it('reads named, default and namespace imports', () => {
    expect(imported(`
      import Default from './a';
      import { named, other as renamed } from './b';
      import * as ns from './c';
    `)).toEqual(['Default', 'named', 'ns', 'other']);
  });

  it('reads a multi-line named import', () => {
    expect(imported(`
      import {
        first,
        second,
      } from '../src/thing';
    `)).toEqual(['first', 'second']);
  });

  it('reads the dynamic form the shell loads every view through', () => {
    // Missing this one would report the entire application as unwired.
    expect(imported(`
      const InboxView = dynamic(() => import('@/ActivitySpace/home/InboxView').then(m => m.InboxView));
    `)).toContain('InboxView');
  });

  it('strips type modifiers from specifiers', () => {
    expect(imported(`import { type Shape, value } from './x';`)).toEqual(['Shape', 'value']);
  });

  it('does not count a commented-out import', () => {
    expect(imported(`
      // import { ghost } from './a';
      import { real } from './b';
    `)).toEqual(['real']);
  });
});

describe('isEntryPoint', () => {
  it('recognises the files Next.js loads by convention', () => {
    expect(isEntryPoint('src/app/page.tsx')).toBe(true);
    expect(isEntryPoint('src/app/domain/[id]/layout.tsx')).toBe(true);
    expect(isEntryPoint('src/app/api/thing/route.ts')).toBe(true);
    expect(isEntryPoint('src/middleware.ts')).toBe(true);
  });

  it('does not treat ordinary modules as entry points', () => {
    expect(isEntryPoint('src/ActivitySpace/execution/object/ListTable.tsx')).toBe(false);
    expect(isEntryPoint('src/hooks/useSupabase.ts')).toBe(false);
  });
});

describe('findUnwired', () => {
  const call = (files: { file: string; source: string }[], declared = new Set<string>(), paths: string[] = [], consumers?: typeof files) =>
    findUnwired(files, declared, paths, consumers) as {
      findings: { file: string; name: string; key: string }[];
      accepted: { key: string }[];
      ambiguous: { name: string; homes: string[] }[];
    };

  it('flags an export nothing imports, and clears one something does', () => {
    const { findings } = call([
      { file: 'src/a.ts', source: 'export function used() {}\nexport function orphan() {}' },
      { file: 'src/b.ts', source: `import { used } from './a';\nused();` },
    ]);
    expect(findings.map((f) => f.name)).toEqual(['orphan']);
  });

  it('never flags an entry point', () => {
    const { findings } = call([
      { file: 'src/app/page.tsx', source: 'export default function Page() {}\nexport const revalidate = 0;' },
    ]);
    expect(findings).toEqual([]);
  });

  it('treats a name-level declaration as accepted, not a finding', () => {
    const files = [{ file: 'src/a.ts', source: 'export function held() {}' }];
    expect(call(files).findings.map((f) => f.name)).toEqual(['held']);
    expect(call(files, new Set(['src/a.ts#held'])).findings).toEqual([]);
    expect(call(files, new Set(['src/a.ts#held'])).accepted.map((a) => a.key)).toEqual(['src/a.ts#held']);
  });

  it('accepts a whole declared path, for reasons that belong to the directory', () => {
    const files = [{ file: 'src/ui/table.tsx', source: 'export const TableCaption = 1;' }];
    expect(call(files).findings).toHaveLength(1);
    expect(call(files, new Set(), ['src/ui/']).findings).toEqual([]);
  });

  it('counts a consumer outside the source set — a helper its test imports is wired', () => {
    const files = [{ file: 'src/a.ts', source: 'export function onlyTested() {}' }];
    const tests = [{ file: 'tests/a.test.ts', source: `import { onlyTested } from '../src/a';` }];
    expect(call(files).findings.map((f) => f.name)).toEqual(['onlyTested']);
    expect(call(files, new Set(), [], [...files, ...tests]).findings).toEqual([]);
  });

  it('treats a star re-export as reaching everything in the target module', () => {
    const { findings } = call([
      { file: 'src/inner.ts', source: 'export const hidden = 1;' },
      { file: 'src/index.ts', source: `export * from './inner';` },
      { file: 'src/use.ts', source: `import { index } from './index';\nexport const x = index;` },
    ]);
    expect(findings.map((f) => f.name)).not.toContain('hidden');
  });

  it('reports a name exported from two files, where one importer covers both', () => {
    const { ambiguous } = call([
      { file: 'src/a.ts', source: 'export const shared = 1;' },
      { file: 'src/b.ts', source: 'export const shared = 2;' },
    ]);
    expect(ambiguous.map((a) => a.name)).toContain('shared');
  });
});
