import { describe, expect, it } from 'vitest';

// The publish's pure core (coding capability PR3,
// _shared/codingPublish.ts): the patch read as files and hunks, its
// exact application to the base contents, its integrity against the
// change set it came with — the truncation test: a capture cut by
// the runner's caps must refuse, never publish as if whole — the
// composition of the one publish plan, and the critical law for a
// repository outside the definition's declared set. The I/O halves
// (base reads through the connection, the governed calls in
// run-agent) are pinned on source in codingPublishWiring.test.ts.
const cp = await import(new URL('../../supabase/functions/_shared/codingPublish.ts', import.meta.url).pathname);

type ChangeSet = {
  files: { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; additions: number; deletions: number; binary: boolean }[];
  additions: number; deletions: number; patch: string; empty: boolean;
};
const changeSet = (files: ChangeSet['files'], patch: string): ChangeSet => ({
  files,
  additions: files.reduce((n, f) => n + f.additions, 0),
  deletions: files.reduce((n, f) => n + f.deletions, 0),
  patch,
  empty: files.length === 0,
});

const MODIFY_PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' a',
  '-b',
  '+B',
  ' c',
  '',
].join('\n');

const ADD_PATCH = [
  'diff --git a/src/new.ts b/src/new.ts',
  '--- /dev/null',
  '+++ b/src/new.ts',
  '@@ -0,0 +1,2 @@',
  '+one',
  '+two',
  '',
].join('\n');

const DELETE_PATCH = [
  'diff --git a/src/old.ts b/src/old.ts',
  '--- a/src/old.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-x',
  '-y',
  '',
].join('\n');

const FULL_PATCH = MODIFY_PATCH + ADD_PATCH + DELETE_PATCH;
const FULL_SET = changeSet([
  { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, binary: false },
  { path: 'src/new.ts', status: 'added', additions: 2, deletions: 0, binary: false },
  { path: 'src/old.ts', status: 'deleted', additions: 0, deletions: 2, binary: false },
], FULL_PATCH);

describe('parsePatchFiles', () => {
  it('reads files, kinds and hunks, and proves a whole hunk complete', () => {
    const files = cp.parsePatchFiles(FULL_PATCH);
    expect(files.map((f: { oldPath: string | null; newPath: string | null; kind: string }) => [f.oldPath, f.newPath, f.kind])).toEqual([
      ['src/a.ts', 'src/a.ts', 'modify'],
      [null, 'src/new.ts', 'add'],
      ['src/old.ts', null, 'delete'],
    ]);
    expect(files.every((f: { hunks: { complete: boolean }[] }) => f.hunks.every((h) => h.complete))).toBe(true);
    expect(files[0].hunks[0]).toMatchObject({ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3 });
  });

  it('a hunk cut short of its header’s declared counts is incomplete — the truncation mark', () => {
    const cut = MODIFY_PATCH.replace(' c\n', '');
    const files = cp.parsePatchFiles(cut);
    expect(files[0].hunks[0].complete).toBe(false);
  });

  it('a line the diff grammar does not admit breaks its hunk instead of being absorbed', () => {
    const broken = MODIFY_PATCH.replace(' c', 'garbage-line');
    const files = cp.parsePatchFiles(broken);
    expect(files[0].hunks[0].complete).toBe(false);
    expect(files[0].hunks[0].lines.some((l: { broken?: boolean }) => l.broken)).toBe(true);
  });

  it('marks binary files, which carry no content a text patch can publish', () => {
    const files = cp.parsePatchFiles('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n');
    expect(files[0].binary).toBe(true);
  });

  it('reads a rename from its extended headers', () => {
    const files = cp.parsePatchFiles([
      'diff --git a/src/before.ts b/src/after.ts',
      'rename from src/before.ts',
      'rename to src/after.ts',
      '',
    ].join('\n'));
    expect(files[0]).toMatchObject({ kind: 'rename', oldPath: 'src/before.ts', newPath: 'src/after.ts' });
  });
});

describe('applyPatchFile', () => {
  it('applies a modify exactly: context and deletions must match the base', () => {
    const [file] = cp.parsePatchFiles(MODIFY_PATCH);
    expect(cp.applyPatchFile('a\nb\nc\n', file)).toEqual({ ok: true, content: 'a\nB\nc\n' });
    const mismatch = cp.applyPatchFile('a\nX\nc\n', file);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.reason).toContain('一致しません');
  });

  it('builds an added file from nothing, and a deletion must consume its base whole', () => {
    const [add] = cp.parsePatchFiles(ADD_PATCH);
    expect(cp.applyPatchFile(null, add)).toEqual({ ok: true, content: 'one\ntwo\n' });
    const [del] = cp.parsePatchFiles(DELETE_PATCH);
    expect(cp.applyPatchFile('x\ny\n', del)).toEqual({ ok: true, content: null });
    expect(cp.applyPatchFile('x\ny\nz\n', del).ok).toBe(false);
  });

  it('refuses an incomplete hunk and a binary file, in the open', () => {
    const [cut] = cp.parsePatchFiles(MODIFY_PATCH.replace(' c\n', ''));
    const r = cp.applyPatchFile('a\nb\nc\n', cut);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不完全');
    const [bin] = cp.parsePatchFiles('diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n');
    expect(cp.applyPatchFile('whatever', bin).ok).toBe(false);
  });

  it('honours the no-newline marker at the file’s end', () => {
    const patch = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '\\ No newline at end of file',
      '+B',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const [file] = cp.parsePatchFiles(patch);
    expect(cp.applyPatchFile('a\nb', file)).toEqual({ ok: true, content: 'a\nB' });
  });

  it('a modify against a missing base refuses rather than inventing content', () => {
    const [file] = cp.parsePatchFiles(MODIFY_PATCH);
    expect(cp.applyPatchFile(null, file).ok).toBe(false);
  });
});

describe('patchIntegrity', () => {
  it('a whole patch against its own change set passes', () => {
    expect(cp.patchIntegrity(FULL_SET, cp.parsePatchFiles(FULL_PATCH))).toEqual({ ok: true, problems: [] });
  });

  it('a truncated patch fails, naming the file — never publishable as if whole', () => {
    const cut = FULL_PATCH.replace(' c\n', '');
    const r = cp.patchIntegrity(FULL_SET, cp.parsePatchFiles(cut));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('src/a.ts');
    expect(r.problems.join(' ')).toContain('不完全');
  });

  it('line counts that disagree with the change set’s record fail', () => {
    const wrong = changeSet([
      { path: 'src/a.ts', status: 'modified', additions: 5, deletions: 1, binary: false },
      { path: 'src/new.ts', status: 'added', additions: 2, deletions: 0, binary: false },
      { path: 'src/old.ts', status: 'deleted', additions: 0, deletions: 2, binary: false },
    ], FULL_PATCH);
    const r = cp.patchIntegrity(wrong, cp.parsePatchFiles(FULL_PATCH));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toContain('行数');
  });

  it('a change-set file missing from the patch, and a patch file outside the set, both fail', () => {
    const missing = cp.patchIntegrity(FULL_SET, cp.parsePatchFiles(MODIFY_PATCH));
    expect(missing.ok).toBe(false);
    const extraPatch = FULL_PATCH + [
      'diff --git a/src/extra.ts b/src/extra.ts',
      '--- /dev/null',
      '+++ b/src/extra.ts',
      '@@ -0,0 +1,1 @@',
      '+x',
      '',
    ].join('\n');
    const extra = cp.patchIntegrity(FULL_SET, cp.parsePatchFiles(extraPatch));
    expect(extra.ok).toBe(false);
    expect(extra.problems.join(' ')).toContain('src/extra.ts');
  });

  it('an empty change set has nothing to publish', () => {
    expect(cp.patchIntegrity(changeSet([], ''), []).ok).toBe(false);
  });
});

describe('composePublish', () => {
  const baseFiles = new Map([
    ['src/a.ts', { content: 'a\nb\nc\n', blobSha: 'sha-a' }],
    ['src/old.ts', { content: 'x\ny\n', blobSha: 'sha-old' }],
  ]);
  const compose = (over: Partial<Parameters<typeof cp.composePublish>[0]> = {}) => cp.composePublish({
    target: { repo: 'acme/widgets', baseBranch: 'main' },
    branch: 'alcon/run-abcdef123456',
    changeSet: FULL_SET,
    patchFiles: cp.parsePatchFiles(FULL_PATCH),
    baseFiles,
    commitMessage: '直す',
    prTitle: '直す',
    prBody: '本文',
    ...over,
  });

  it('composes one plan: the branch, the whole change set as writes and deletes, the PR', () => {
    const r = compose();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.branch).toBe('alcon/run-abcdef123456');
    expect(r.plan.writes).toEqual([
      { path: 'src/a.ts', content: 'a\nB\nc\n' },
      { path: 'src/new.ts', content: 'one\ntwo\n' },
    ]);
    expect(r.plan.deletes).toEqual([{ path: 'src/old.ts', sha: 'sha-old' }]);
    expect(r.plan.pr).toEqual({ title: '直す', body: '本文', head: 'alcon/run-abcdef123456', base: 'main' });
  });

  it('refuses when a base file could not be read — a partial tree is never composed', () => {
    const r = compose({ baseFiles: new Map([['src/old.ts', { content: 'x\ny\n', blobSha: 'sha-old' }]]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('src/a.ts');
  });

  it('refuses a truncated patch outright (integrity is judged before any application)', () => {
    const cut = FULL_PATCH.replace(' c\n', '');
    const r = compose({ changeSet: changeSet(FULL_SET.files, cut), patchFiles: cp.parsePatchFiles(cut) });
    expect(r.ok).toBe(false);
  });

  it('a mode-only change (content byte-identical) leaves nothing publishable and says so', () => {
    const modeOnly = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,3 @@',
      ' a',
      ' b',
      ' c',
      '',
    ].join('\n');
    const set = changeSet([{ path: 'src/a.ts', status: 'modified', additions: 0, deletions: 0, binary: false }], modeOnly);
    const r = compose({ changeSet: set, patchFiles: cp.parsePatchFiles(modeOnly) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('公開できる内容の変更がありません');
  });

  it('refuses a composition past the one-publish content cap', () => {
    const big = 'x'.repeat(cp.MAX_PUBLISH_CONTENT_CHARS + 1);
    const patch = [
      'diff --git a/big.txt b/big.txt',
      '--- /dev/null',
      '+++ b/big.txt',
      '@@ -0,0 +1,1 @@',
      `+${big}`,
      '',
    ].join('\n');
    const set = changeSet([{ path: 'big.txt', status: 'added', additions: 1, deletions: 0, binary: false }], patch);
    const r = compose({ changeSet: set, patchFiles: cp.parsePatchFiles(patch), baseFiles: new Map() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('一度の公開に収まりません');
  });
});

describe('composeAmend (PR4: the iteration’s added commit)', () => {
  const baseFiles = new Map([
    ['src/a.ts', { content: 'a\nb\nc\n', blobSha: 'sha-a' }],
    ['src/old.ts', { content: 'x\ny\n', blobSha: 'sha-old' }],
  ]);
  const amend = (over: Partial<Parameters<typeof cp.composeAmend>[0]> = {}) => cp.composeAmend({
    changeSet: FULL_SET,
    patchFiles: cp.parsePatchFiles(FULL_PATCH),
    baseFiles,
    ...over,
  });

  it('resolves the same writes and deletes as a publish — no branch, no PR, the one composition', () => {
    const r = amend();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.writes).toEqual([
      { path: 'src/a.ts', content: 'a\nB\nc\n' },
      { path: 'src/new.ts', content: 'one\ntwo\n' },
    ]);
    expect(r.plan.deletes).toEqual([{ path: 'src/old.ts', sha: 'sha-old' }]);
    expect('branch' in r.plan).toBe(false);
    expect('pr' in r.plan).toBe(false);
  });

  it('applies against the head files it is given: a head that moved under the patch refuses exactly', () => {
    const moved = new Map([
      ['src/a.ts', { content: 'a\nCHANGED\nc\n', blobSha: 'sha-a2' }],
      ['src/old.ts', { content: 'x\ny\n', blobSha: 'sha-old' }],
    ]);
    const r = amend({ baseFiles: moved });
    expect(r.ok).toBe(false);
  });

  it('refuses a truncated patch and an unread head file, under the amend’s own name', () => {
    const cut = FULL_PATCH.replace(' c\n', '');
    const r1 = amend({ changeSet: changeSet(FULL_SET.files, cut), patchFiles: cp.parsePatchFiles(cut) });
    expect(r1.ok).toBe(false);
    const r2 = amend({ baseFiles: new Map([['src/old.ts', { content: 'x\ny\n', blobSha: 'sha-old' }]]) });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toContain('修正できません');
  });

  it('the amend commit message names the work and the PR it amends', () => {
    expect(cp.amendCommitMessage('請求フローを直す', 42)).toBe('請求フローを直す（PR #42 への修正）');
    expect(cp.amendCommitMessage(null, 7)).toBe('コード変更（PR #7 への修正）');
    expect(cp.amendCommitMessage('  ', 7)).toBe('コード変更（PR #7 への修正）');
  });
});

describe('the publish plan’s small laws', () => {
  it('branchNameForRun is deterministic per run and safe as a ref', () => {
    expect(cp.branchNameForRun('12345678-9abc-def0-1234-56789abcdef0')).toBe('alcon/run-123456789abc');
    expect(cp.branchNameForRun('12345678-9abc-def0-1234-56789abcdef0'))
      .toBe(cp.branchNameForRun('12345678-9abc-def0-1234-56789abcdef0'));
  });

  it('publishCommandKind recognises the wrapped tool, falls back to the name, and nothing else', () => {
    expect(cp.publishCommandKind({ name: 'github__create_pull_request', mcp: 'create_pull_request' })).toBe('create_pull_request');
    expect(cp.publishCommandKind({ name: 'push_files' })).toBe('push_files');
    expect(cp.publishCommandKind({ name: 'get_file_contents', mcp: 'get_file_contents' })).toBeNull();
    expect(cp.publishCommandKind(undefined)).toBeNull();
    expect(cp.PUBLISH_COMMANDS).toEqual(['create_branch', 'push_files', 'delete_file', 'create_pull_request']);
  });

  it('the critical law: outside the declared set always asks; inside, ordinary governance', () => {
    const decl = { repositories: ['acme/widgets'], testCommand: 'npm test', baseBranch: 'main' };
    expect(cp.publishIsCritical(decl, 'acme/widgets')).toBe(false);
    expect(cp.publishIsCritical(decl, 'other/thing')).toBe(true);
    const reason = cp.publishCriticalReason(decl, 'other/thing');
    expect(reason).toContain('other/thing');
    expect(reason).toContain('宣言は広がりません');
  });

  it('the PR’s title prefers the work’s own name; its body carries summary and change record', () => {
    expect(cp.pullRequestTitle('請求画面の修正', '要約')).toBe('請求画面の修正');
    expect(cp.pullRequestTitle(null, '要約')).toBe('要約');
    expect(cp.pullRequestTitle(null, '')).toBe('コード変更');
    const body = cp.pullRequestBody({ finishSummary: '直した', finishMessage: '詳細', changeSummary: '変更: 2 ファイル' });
    expect(body).toContain('直した');
    expect(body).toContain('変更: 2 ファイル');
  });
});
