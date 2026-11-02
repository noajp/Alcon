import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The Supabase preview branch keys each migration by its numeric prefix and
// records it in schema_migrations, so two files sharing a prefix fail the replay.
const dir = new URL('../../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));

describe('supabase migrations', () => {
  it('every file has a 14-digit version prefix', () => {
    expect(files.filter((f) => !/^\d{14}_.+\.sql$/.test(f))).toEqual([]);
  });

  it('no two files share a version', () => {
    const seen = new Map<string, string[]>();
    for (const f of files) {
      const v = f.slice(0, 14);
      seen.set(v, [...(seen.get(v) ?? []), f]);
    }
    expect([...seen.values()].filter((names) => names.length > 1)).toEqual([]);
  });
});
