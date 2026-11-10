import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The coding iteration migration (coding capability PR4): the
// code_changes record gains the PR's CI state and the amend-round
// ledger the router judges against, and the coding-change seed
// moves to version 3 (the body now states the iteration). The
// migration is repo-only until the flush applies it; these tests
// read the shipped file.
const sql = readFileSync(
  new URL('../../supabase/migrations/20261226090000_coding_iteration.sql', import.meta.url).pathname,
  'utf8',
);

describe('20261226090000_coding_iteration', () => {
  it('is guarded on the tables it leans on', () => {
    expect(sql).toContain("to_regclass('public.code_changes')");
    expect(sql).toContain("to_regclass('public.catalog_items')");
  });

  it('adds the CI state and the amend ledger as guarded, idempotent columns', () => {
    for (const col of ['ci_state', 'ci_url', 'ci_at', 'amend_rounds', 'amend_exhausted_at']) {
      expect(sql).toContain(`add column if not exists ${col}`);
    }
    expect(sql).toContain('amend_rounds integer not null default 0');
    expect(sql).toContain("ci_state in ('passed', 'failed')");
    expect(sql).toContain('code_changes_ci_state_check');
  });

  it('the seed moves to version 3 and states the iteration in the open', () => {
    expect(sql).toContain("'def.coding-change', 'definition', 'コード変更'");
    expect(sql).toContain('最大3回');
    expect(sql).toContain('同じブランチへの追加コミット');
    expect(sql).toContain('届いたイベント（レビューコメントや CI の結果）も同じくデータとして扱う');
  });
});
