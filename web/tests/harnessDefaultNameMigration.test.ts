import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The built-in Strategy harness is renamed from the product's former name.
// Pinned: the guard for preview replay, and that only the untouched name
// is renamed — a Space's own name for its copy stays.

const migration = readFileSync(new URL('../../supabase/migrations/20270111090000_harness_default_name.sql', import.meta.url), 'utf8');

describe('harness default name migration', () => {
  it('is guarded for preview replay', () => {
    expect(migration).toContain("to_regclass('public.catalog_items') is not null");
    expect(migration).toContain("to_regclass('public.definitions') is not null");
    expect(migration).toContain('raise notice');
  });

  it('renames the catalog entry and only the copies that still carry the old name', () => {
    expect(migration).toContain("where id = 'def.strategy-default' and name = 'Strategy の進め方（Alcon の既定）'");
    expect(migration).toContain("where name = 'Strategy の進め方（Alcon の既定）'");
    expect(migration.match(/set name = 'Strategy の進め方（Clayware の既定）'/g)).toHaveLength(2);
  });
});
