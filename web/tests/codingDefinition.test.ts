import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The coding declaration (coding capability PR2): three Conditions
// bullet families in definition.ts' grammar — the repository set,
// the declared test command, the base branch — read fail-closed the
// way the machine grammar reads. And the def.coding-change catalog
// seed, at its current version (migration 20261221090000, the PR3
// publish revision; the original seed is 20261220090000): it parses
// as a definition, passes the harness check, and ships with its
// repository undeclared — the placeholder line is an activator's
// instruction, and the parser reads it as "no repository yet"
// rather than as a guess.
import { checkHarness, parseDefinition } from '@/AIP/harness/harnessDefinition';

const body = (conditions: string) => `# 目的\nコードを変える\n\n# 条件\n${conditions}\n`;

describe('the coding grammar', () => {
  it('reads the repository set, the test command and the base', () => {
    const def = parseDefinition(body('- リポジトリ: acme/widgets, acme/api\n- テストコマンド: npm test\n- ベース: develop'));
    expect(def.coding).toEqual({ repositories: ['acme/widgets', 'acme/api'], testCommand: 'npm test', baseBranch: 'develop' });
  });

  it('reads the English forms, and defaults the base to main', () => {
    const def = parseDefinition(body('- repositories: acme/widgets\n- test command: pnpm vitest run'));
    expect(def.coding).toEqual({ repositories: ['acme/widgets'], testCommand: 'pnpm vitest run', baseBranch: 'main' });
  });

  it('is fail-closed: tokens that are not owner/repo drop, never widen', () => {
    const def = parseDefinition(body('- リポジトリ: acme/widgets, ただの言葉, ../escape, acme/../x, acme/widgets'));
    expect(def.coding?.repositories).toEqual(['acme/widgets']);
  });

  it('a test command alone still declares coding (the gate then judges it)', () => {
    const def = parseDefinition(body('- テストコマンド: make test'));
    expect(def.coding).toEqual({ repositories: [], testCommand: 'make test', baseBranch: 'main' });
  });

  it('no coding bullets, no declaration', () => {
    expect(parseDefinition(body('- 価格の鮮度: 30分まで')).coding).toBeNull();
  });

  it('the pairing is checked: coding without a workspace is an error (H007)', () => {
    const noMachine = parseDefinition(body('- リポジトリ: acme/widgets\n- テストコマンド: npm test'));
    const problems = checkHarness(noMachine);
    expect(problems.find((d) => d.code === 'H007')?.severity).toBe('error');
    const withMachine = parseDefinition(body('- ワークスペース: 必要\n- リポジトリ: acme/widgets\n- テストコマンド: npm test'));
    expect(checkHarness(withMachine).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('an undeclared repository set and a missing test command warn in the open (H008/H009)', () => {
    const def = parseDefinition(body('- ワークスペース: 必要\n- テスト: npm test'));
    const codes = checkHarness(def).map((d) => d.code);
    expect(codes).toContain('H008');
    expect(codes).not.toContain('H009');
    const noTest = parseDefinition(body('- ワークスペース: 必要\n- リポジトリ: acme/widgets'));
    expect(checkHarness(noTest).map((d) => d.code)).toContain('H009');
  });
});

const sql = readFileSync(
  new URL('../../supabase/migrations/20261221090000_coding_change_publish.sql', import.meta.url),
  'utf8',
);

function seedBody(): string {
  const at = sql.indexOf("'def.coding-change'");
  expect(at).toBeGreaterThan(-1);
  const open = sql.indexOf('$def$', at);
  const close = sql.indexOf('$def$', open + 5);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return sql.slice(open + 5, close);
}

describe('the def.coding-change seed', () => {
  const BODY = seedBody();
  const def = parseDefinition(BODY);

  it('is guarded for preview replay and lands as a definition catalog row', () => {
    expect(sql).toContain("if to_regclass('public.catalog_items') is null then");
    expect(sql).toContain('raise notice');
    expect(sql).toContain("'def.coding-change', 'definition'");
    expect(sql).toContain('on conflict (id) do update');
  });

  it('installs and activates nothing itself — it only offers the text', () => {
    expect(sql).not.toMatch(/insert into public\.(definitions|automations|promotion_drafts)/);
    expect(sql).not.toMatch(/update public\.(definitions|automations)/);
  });

  it('declares the governed workspace (PR1 grammar) with package-registry egress', () => {
    expect(def.machine).not.toBeNull();
    expect(def.machine?.disposal).toBe('per-run');
    expect(def.machine?.egress).toEqual(['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org']);
    expect(def.machine?.wallClockMs).toBe(4 * 60 * 60_000);
  });

  it('declares coding with an undeclared repository set — the placeholder reads as "not yet"', () => {
    expect(def.coding).toEqual({ repositories: [], testCommand: 'npm test', baseBranch: 'main' });
    expect(def.connectors).toEqual(['GitHub']);
  });

  it('passes the harness check with no errors (its warnings are the activator’s instructions)', () => {
    const problems = checkHarness(def);
    expect(problems.filter((d) => d.severity === 'error')).toEqual([]);
    expect(problems.map((d) => d.code)).toContain('H008');
  });

  it('carries what the promotion package gate demands: a numeric budget and checks', () => {
    expect(def.stop.budgetUsd).toBe(5);
    expect(def.checks.items.length).toBeGreaterThan(0);
    expect(def.output?.format).toBe('markdown');
  });

  it('is version 2 — the publish revision of the seed', () => {
    expect(sql).toContain("'{}'::jsonb, 25, 2)");
  });

  it('its Procedure ends in a PR the server publishes; the publish path is the server’s alone (PR3)', () => {
    // The manifest command is named exactly once in the whole body:
    // in the Conditions prohibition. The model never calls it; the
    // server composes the publish from the verified patch.
    expect(BODY.match(/create_pull_request/g)).toHaveLength(1);
    expect(def.sections.conditions).toContain('create_pull_request を自分で呼んではいけない');
    expect(def.sections.procedure).toContain('alcon-repo');
    expect(def.sections.procedure).toContain('サーバーが接続経由で公開し、PR が開かれる');
    expect(def.sections.conditions).toContain('データとして扱う');
    // The Checks carry the publish's verify: the server reads the
    // opened PR back, head and base against the declaration.
    expect(def.sections.checks).toContain('読み戻して');
  });

  it('names the critical class in the open: a first publish outside the declared set always asks', () => {
    expect(def.sections.conditions).toContain('宣言の外への初めての公開は、サーバーが重要な操作として常時確認する');
  });
});
