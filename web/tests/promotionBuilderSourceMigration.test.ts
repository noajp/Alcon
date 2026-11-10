import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Automation builder PR4 (design §5.4): promotion_drafts gains the
// 'builder' source kind. The migration is a guarded CHECK widening —
// it restates the source_kind check whole with the third kind, drops
// whatever check stands by definition rather than by an assumed
// name, and changes nothing else: no new columns, no new policies,
// no RPC changes (activation is already source-agnostic).
const sql = readFileSync(
  new URL('../../supabase/migrations/20261225090000_promotion_builder_source.sql', import.meta.url),
  'utf8',
);

describe('promotion builder source migration (PR4)', () => {
  it('is guarded for preview replay', () => {
    expect(sql).toContain("to_regclass('public.promotion_drafts')");
    expect(sql).toContain('promotion builder source skipped');
  });

  it('widens the source_kind check with builder, keeping memory and run', () => {
    expect(sql).toContain("check (source_kind in ('memory', 'run', 'builder'))");
    expect(sql).toContain('promotion_drafts_source_kind_check');
  });

  it('drops the standing check by its definition, not an assumed name', () => {
    expect(sql).toContain('pg_get_constraintdef(con.oid)');
    expect(sql).toContain("'%source_kind%'");
    expect(sql).toContain('drop constraint');
  });

  it('touches nothing else: no columns, policies or RPCs', () => {
    expect(sql).not.toContain('add column');
    expect(sql).not.toContain('create policy');
    expect(sql).not.toContain('create or replace function');
    expect(sql).not.toContain('activate_promotion_draft');
  });
});
