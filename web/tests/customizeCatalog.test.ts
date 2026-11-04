import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);
const sql = readFileSync(new URL('../../supabase/migrations/20261114090000_customize_catalog.sql', import.meta.url), 'utf8');

// The catalog's definitions, as the migration seeds them.
const bodies = new Map([...sql.matchAll(/\('(def\.[a-z-]+)', 'definition', '[^']*', '[^']*', \$def\$([\s\S]*?)\$def\$/g)].map((m) => [m[1], m[2]]));
const packs = [...sql.matchAll(/\('(pack\.[a-z-]+)', 'pack', '[^']*', '[^']*', null,\s*'([^']*)'/g)].map((m) => [m[1], JSON.parse(m[2])] as const);

describe('customize catalog', () => {
  it('offers definitions the engine reads: a goal, and the loop where there is one', () => {
    expect(bodies.size).toBe(6);
    for (const [id, body] of bodies) expect(def.parseDefinition(body).sections.goal, id).not.toBe('');
    const loop = def.parseDefinition(bodies.get('def.improve-loop')!);
    expect(loop.metric?.direction).toBe('max');
    expect([loop.stop.maxRounds, loop.stop.budgetUsd, loop.checks.every]).toEqual([50, 20, 10]);
    expect(def.parseDefinition(bodies.get('def.compare-report')!).output?.format).toBe('markdown');
  });

  it('bundles only definitions the catalog has', () => {
    expect(packs).toHaveLength(3);
    for (const [, p] of packs) for (const d of p.definitions) expect(bodies.has(d), d).toBe(true);
  });
});
