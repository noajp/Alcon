import { describe, expect, it } from 'vitest';

// The coding loop's pure core (coding capability PR2,
// _shared/codingLoop.ts): the target law over the definition's
// declared repository set, the delivery and capture commands and
// their result readings, test evidence from the run's own shell
// records, and the finish gate's rules. The I/O halves
// (codingDelivery.ts, run-agent's wiring) are pinned on source in
// codingWiring.test.ts; what is pure enough to judge is judged here.
const cl = await import(new URL('../../supabase/functions/_shared/codingLoop.ts', import.meta.url).pathname);

type Decl = { repositories: string[]; testCommand: string | null; baseBranch: string };
const decl = (over: Partial<Decl> = {}): Decl => ({ repositories: ['acme/widgets'], testCommand: 'npm test', baseBranch: 'main', ...over });

describe('the target law', () => {
  it('a single-repo set is the target when the work names nothing', () => {
    expect(cl.resolveCodingTarget(decl(), ['直してほしい'])).toEqual({ ok: true, target: { repo: 'acme/widgets', baseBranch: 'main' } });
  });

  it('a named repo in the set wins; the declared base rides along', () => {
    const d = decl({ repositories: ['acme/widgets', 'acme/api'], baseBranch: 'develop' });
    expect(cl.resolveCodingTarget(d, ['acme/api の障害を直す'])).toEqual({ ok: true, target: { repo: 'acme/api', baseBranch: 'develop' } });
  });

  it('naming a repo outside the set refuses — the set is the definition’s law', () => {
    const r = cl.resolveCodingTarget(decl(), ['other/thing を直す']);
    expect(r).toEqual({ ok: false, reason: 'repo_outside_set' });
  });

  it('an empty set refuses, and a multi-repo set with no name is ambiguous', () => {
    expect(cl.resolveCodingTarget(decl({ repositories: [] }), ['x'])).toEqual({ ok: false, reason: 'no_repo_declared' });
    expect(cl.resolveCodingTarget(decl({ repositories: ['a/b', 'c/d'] }), ['直して'])).toEqual({ ok: false, reason: 'repo_ambiguous' });
  });

  it('reposMentionedIn reads owner/repo-shaped tokens (shape is the whole law)', () => {
    expect(cl.reposMentionedIn('acme/api と (other/thing) と a/b/c と 1/2 と 比率1:2')).toEqual(['acme/api', 'other/thing', 'a/b', '1/2']);
    expect(cl.reposMentionedIn('スラッシュ/なし の文')).toEqual([]);
  });
});

describe('tree delivery', () => {
  const cmd = cl.deliveryCommand({ url: "https://x.example/snap?tok=a&b=c'd", target: { repo: 'acme/widgets', baseBranch: 'main' }, baseSha: 'abc1234' });

  it('the command unpacks, initialises git at the base, and reports the file count', () => {
    expect(cmd).toContain('tar -xzf clayware-tree.tar.gz -C alcon-repo --strip-components=1');
    expect(cmd).toContain('git init -q -b \'main\'');
    expect(cmd).toContain('commit -qm \'base: acme/widgets@abc1234\'');
    expect(cmd).toContain('echo FILES $(git ls-files | wc -l)');
  });

  it('the signed URL is shell-quoted, quotes and all — it is the only secret-shaped value in the command', () => {
    expect(cmd).toContain("curl -fsSL 'https://x.example/snap?tok=a&b=c'\\''d'");
  });

  it('the delivery step title and detail round-trip (the later slice’s record)', () => {
    expect(cl.deliveryStepTitle({ repo: 'acme/widgets', baseBranch: 'main' }, 'abc1234def')).toBe('コードを受け取りました: acme/widgets @ abc1234');
    expect(cl.parseDeliveryDetail('repo=acme/widgets\nbase=main\nsha=abc1234def\n12 ファイル')).toEqual({ repo: 'acme/widgets', baseBranch: 'main', baseSha: 'abc1234def' });
    expect(cl.parseDeliveryDetail('no facts here')).toBeNull();
    expect(cl.parseDeliveryResult('... FILES 42\n')).toEqual({ files: 42 });
    expect(cl.parseDeliveryResult('nothing')).toBeNull();
  });
});

describe('test evidence', () => {
  const call = (over: Record<string, unknown> = {}) => ({
    id: 'c1', command: 'npm test', status: 'done', exitCode: 0, at: '2026-11-10T00:00:00Z', ...over,
  });

  it('is the last settled run of the declared command, exactly as declared', () => {
    const ev = cl.testEvidenceOf([
      call({ id: 'old', exitCode: 1, at: '2026-11-10T00:00:00Z' }),
      call({ id: 'wrapped', command: 'npm test 2>&1 | tail -5', at: '2026-11-10T01:00:00Z' }),
      call({ id: 'new', exitCode: 0, at: '2026-11-10T02:00:00Z' }),
    ], 'npm test');
    expect(ev).toEqual({ state: 'ran', exitCode: 0, callId: 'new', at: '2026-11-10T02:00:00Z' });
  });

  it('a transport-failed call, a missing exit code, or no declared command is no evidence', () => {
    expect(cl.testEvidenceOf([call({ status: 'failed' })], 'npm test')).toEqual({ state: 'missing' });
    expect(cl.testEvidenceOf([call({ exitCode: null })], 'npm test')).toEqual({ state: 'missing' });
    expect(cl.testEvidenceOf([call()], null)).toEqual({ state: 'missing' });
    expect(cl.testEvidenceOf([], 'npm test')).toEqual({ state: 'missing' });
  });
});

describe('the change set', () => {
  const output = [
    'staged',
    '__CLAYWARE_STATUS__',
    'M  src/a.ts',
    'A  src/b.ts',
    'D  src/c.ts',
    'R  src/old.ts -> src/new.ts',
    '__CLAYWARE_DIFF__',
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1,2 @@',
    '-old',
    '+new',
    '+more',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- /dev/null',
    '+++ b/src/b.ts',
    '@@ -0,0 +1 @@',
    '+born',
    'diff --git a/src/c.ts b/src/c.ts',
    '--- a/src/c.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    'diff --git a/src/new.ts b/src/new.ts',
    'Binary files a/src/new.ts and b/src/new.ts differ',
  ].join('\n');

  it('parses status kinds, per-file counts, totals, and keeps the patch', () => {
    const cs = cl.parseChangeSet(output);
    expect(cs?.empty).toBe(false);
    expect(cs?.additions).toBe(3);
    expect(cs?.deletions).toBe(2);
    expect(cs?.files).toEqual([
      { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, binary: false },
      { path: 'src/b.ts', status: 'added', additions: 1, deletions: 0, binary: false },
      { path: 'src/c.ts', status: 'deleted', additions: 0, deletions: 1, binary: false },
      { path: 'src/new.ts', status: 'renamed', additions: 0, deletions: 0, binary: true },
    ]);
    expect(cs?.patch).toContain('diff --git a/src/a.ts b/src/a.ts');
  });

  it('an output without a change is an empty set; without markers it is no evidence', () => {
    const empty = cl.parseChangeSet('__CLAYWARE_STATUS__\n__CLAYWARE_DIFF__\n');
    expect(empty?.empty).toBe(true);
    expect(empty?.files).toEqual([]);
    expect(cl.parseChangeSet('random shell noise')).toBeNull();
  });

  it('the capture command stages everything and prints both markers', () => {
    const cmd = cl.captureCommand();
    expect(cmd).toContain('cd alcon-repo && git add -A');
    expect(cmd).toContain('git status --porcelain=v1');
    expect(cmd).toContain('git diff --cached --no-color');
  });

  it('the summary names files and totals and the test line — never contents', () => {
    const cs = cl.parseChangeSet(output)!;
    const text = cl.changeSetSummaryText({
      target: { repo: 'acme/widgets', baseBranch: 'main' }, baseSha: 'abc1234def', changeSet: cs,
      evidence: { state: 'ran', exitCode: 0, callId: 'c9', at: '2026-11-10T02:00:00Z' }, testCommand: 'npm test',
    });
    expect(text).toContain('acme/widgets @ abc1234 への変更: 4 ファイル、+3 / -2');
    expect(text).toContain('src/a.ts');
    expect(text).toContain('終了コード 0');
    expect(text).not.toContain('+new');
    expect(cl.patchArtifactTitle({ repo: 'acme/widgets', baseBranch: 'main' })).toBe('変更パッチ (acme/widgets)');
  });
});

describe('the finish gate', () => {
  const cs = (empty: boolean) => ({ files: empty ? [] : [{ path: 'a.ts', status: 'modified' as const, additions: 1, deletions: 0, binary: false }], additions: empty ? 0 : 1, deletions: 0, patch: empty ? '' : 'diff', empty });
  const base = {
    decl: decl(), outcome: 'completed' as const, delivered: true,
    evidence: { state: 'ran', exitCode: 0, callId: 'c1', at: 't' } as const, changeSet: cs(false),
  };

  it('a verified finish stands: evidence green, change set non-empty', () => {
    expect(cl.codingFinishGaps({ ...base, claims: [{ text: 'テストが通った', source: 'run-record', retrievedAt: null, type: null }] })).toEqual([]);
  });

  it('a tests-passed claim with no record behind it is refused on the record', () => {
    const gaps = cl.codingFinishGaps({ ...base, evidence: { state: 'missing' }, summary: 'テストが通って完了' });
    expect(gaps.some((g: string) => g.includes('asset_calls'))).toBe(true);
  });

  it('a tests-passed claim the record contradicts is refused — for any outcome', () => {
    const gaps = cl.codingFinishGaps({
      ...base, outcome: 'partial', evidence: { state: 'ran', exitCode: 1, callId: 'c1', at: 't' },
      claims: [{ text: 'テストは合格した', source: 'run-record', retrievedAt: null, type: null }],
    });
    expect(gaps.length).toBe(1);
    expect(gaps[0]).toContain('終了コードは 1');
  });

  it('an honest red reported as partial stands — the failure is the result', () => {
    expect(cl.codingFinishGaps({
      ...base, outcome: 'partial', evidence: { state: 'ran', exitCode: 1, callId: 'c1', at: 't' },
    })).toEqual([]);
  });

  it('a red test dressed as completed is sent back, and so is a run with no test record', () => {
    expect(cl.codingFinishGaps({ ...base, evidence: { state: 'ran', exitCode: 2, callId: 'c1', at: 't' } }).some((g: string) => g.includes('partial'))).toBe(true);
    expect(cl.codingFinishGaps({ ...base, evidence: { state: 'missing' } }).length).toBeGreaterThan(0);
  });

  it('an empty change set is a stated result, not a success', () => {
    const gaps = cl.codingFinishGaps({ ...base, changeSet: cs(true) });
    expect(gaps.some((g: string) => g.includes('変更が空'))).toBe(true);
  });

  it('no tree, no completion; an unreadable change set, no completion', () => {
    expect(cl.codingFinishGaps({ ...base, delivered: false }).some((g: string) => g.includes('届いていない'))).toBe(true);
    expect(cl.codingFinishGaps({ ...base, changeSet: null }).some((g: string) => g.includes('読み取れなかった'))).toBe(true);
  });

  it('no declared test command means a completed coding finish cannot be verified', () => {
    const gaps = cl.codingFinishGaps({ ...base, decl: decl({ testCommand: null }), evidence: { state: 'missing' } });
    expect(gaps.some((g: string) => g.includes('テストコマンドが宣言されていない'))).toBe(true);
  });

  it('claimsTestsPassed reads assertions, not mentions', () => {
    expect(cl.claimsTestsPassed({ claims: [{ text: 'テストを実行した', source: null, retrievedAt: null, type: null }] })).toBe(false);
    expect(cl.claimsTestsPassed({ summary: 'all tests passed' })).toBe(true);
    expect(cl.claimsTestsPassed({ claims: [{ text: 'テストが失敗した', source: null, retrievedAt: null, type: null }] })).toBe(false);
  });
});
