import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);
const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
const sql = read('20261114090000_customize_catalog.sql') + read('20261117090000_harnesses.sql');

// The catalog's harnesses, as the migrations seed them.
const bodies = new Map([...sql.matchAll(/\('(def\.[a-z-]+)', 'definition',\s*'[^']*',\s*'[^']*',\s*\$def\$([\s\S]*?)\$def\$/g)].map((m) => [m[1], m[2]]));

describe('harness catalog', () => {
  it('offers harnesses the engine reads: a goal, and the loop where there is one', () => {
    expect(bodies.size).toBe(7);
    for (const [id, body] of bodies) expect(def.parseDefinition(body).sections.goal, id).not.toBe('');
    const loop = def.parseDefinition(bodies.get('def.improve-loop')!);
    expect(loop.metric?.direction).toBe('max');
    expect([loop.stop.maxRounds, loop.stop.budgetUsd, loop.checks.every]).toEqual([50, 20, 10]);
    expect(def.parseDefinition(bodies.get('def.compare-report')!).output?.format).toBe('markdown');
  });

  it('passes its own checks', () => {
    for (const [id, body] of bodies) {
      const errors = def.checkHarness(def.parseDefinition(body)).filter((d: { severity: string }) => d.severity === 'error');
      expect(errors, id).toEqual([]);
    }
  });

  it('writes out how Alcon breaks a Strategy down, so a Space can change it', () => {
    const d = def.parseDefinition(bodies.get('def.strategy-default')!);
    expect(d.sections.breakdown).toContain('Object');
  });
});
