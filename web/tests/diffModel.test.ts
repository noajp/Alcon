import { describe, expect, it } from 'vitest';
import {
  buildFileTree, changeSize, fileKind, inboxBucket, isCheckStale, iteratePrompt, matchFile, parsePatch, parsePullUrl, readGuide,
  readIntentCheck, reviewState, splitPath, splitRows, treeOrder, unchangedBefore,
  type InboxChange, type InboxContext, type ReviewRecord,
} from '@/Function/codeReview/diffModel';

const server = await import(new URL('../../supabase/functions/_shared/github.ts', import.meta.url).pathname);
const serverParsePullUrl = server.parsePullUrl as typeof parsePullUrl;
const pullUrlsIn = server.pullUrlsIn as (text: string) => { repo: string; number: number }[];

describe('parsePullUrl', () => {
  const cases = [
    'https://github.com/noajp/Alcon/pull/554',
    '  https://github.com/noajp/Alcon/pull/554/files  ',
    'https://github.com/a.b/c_d-e/pull/7#discussion',
    'https://github.com/noajp/Alcon/issues/554',
    'http://github.com/noajp/Alcon/pull/1',
    'https://github.com/noajp/Alcon/pull/0',
    'not a url',
  ];
  it('reads owner/repo and number', () => {
    expect(parsePullUrl(cases[0])).toEqual({ repo: 'noajp/Alcon', number: 554 });
    expect(parsePullUrl(cases[1])).toEqual({ repo: 'noajp/Alcon', number: 554 });
    expect(parsePullUrl(cases[2])).toEqual({ repo: 'a.b/c_d-e', number: 7 });
    expect(parsePullUrl(cases[3])).toBeNull();
    expect(parsePullUrl(cases[4])).toBeNull();
    expect(parsePullUrl(cases[5])).toBeNull();
  });
  it('agrees with the server', () => {
    for (const c of cases) expect(parsePullUrl(c)).toEqual(serverParsePullUrl(c));
  });
  it('finds each distinct PR in a tool result', () => {
    const text = '{"html_url":"https://github.com/o/r/pull/3","url":"https://github.com/o/r/pull/3"} and https://github.com/o/s/pull/4';
    expect(pullUrlsIn(text)).toEqual([{ repo: 'o/r', number: 3 }, { repo: 'o/s', number: 4 }]);
  });
});

describe('parsePatch', () => {
  const patch = [
    '@@ -1,4 +1,5 @@ function main()',
    ' a',
    '-b',
    '+B',
    '+B2',
    ' c',
    '@@ -10,2 +11,2 @@',
    '-x',
    '+y',
    '\\ No newline at end of file',
  ].join('\n');

  it('numbers old and new lines through each hunk', () => {
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].section).toBe('function main()');
    expect(hunks[0].lines.map((l) => [l.kind, l.oldNo, l.newNo, l.text])).toEqual([
      ['context', 1, 1, 'a'],
      ['del', 2, null, 'b'],
      ['add', null, 2, 'B'],
      ['add', null, 3, 'B2'],
      ['context', 3, 4, 'c'],
    ]);
    expect(hunks[1].lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['del', 10, null], ['add', null, 11], ['note', null, null],
    ]);
  });

  it('reads nothing from an absent patch and drops a trailing newline', () => {
    expect(parsePatch(null)).toEqual([]);
    expect(parsePatch('@@ -1 +1 @@\n-a\n+b\n')[0].lines).toHaveLength(2);
  });

  it('pairs deletions beside the additions that follow them', () => {
    const rows = splitRows(parsePatch(patch)[0].lines);
    expect(rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null])).toEqual([
      ['a', 'a'], ['b', 'B'], [null, 'B2'], ['c', 'c'],
    ]);
  });
});

describe('file kinds and size', () => {
  it('tells implementation from tests, docs and generated files', () => {
    expect(fileKind('web/src/app/page.tsx')).toBe('implementation');
    expect(fileKind('web/tests/diffModel.test.ts')).toBe('test');
    expect(fileKind('src/foo.spec.ts')).toBe('test');
    expect(fileKind('pkg/x_test.go')).toBe('test');
    expect(fileKind('README.md')).toBe('docs');
    expect(fileKind('docs/api.html')).toBe('docs');
    expect(fileKind('web/package-lock.json')).toBe('generated');
  });
  it('counts implementation lines apart from the total', () => {
    expect(changeSize([
      { filename: 'a.ts', additions: 10, deletions: 2 },
      { filename: 'a.test.ts', additions: 30, deletions: 0 },
      { filename: 'README.md', additions: 5, deletions: 1 },
    ])).toEqual({ additions: 10, deletions: 2, totalAdditions: 45, totalDeletions: 3 });
  });
});

describe('buildFileTree', () => {
  it('folds single-folder chains and lists folders before files', () => {
    const tree = buildFileTree(['web/src/app/page.tsx', 'web/src/app/layout.tsx', 'web/src/lib/a.ts', 'README.md']);
    expect(tree.map((n) => n.name)).toEqual(['web/src', 'README.md']);
    expect(tree[0].children.map((n) => n.name)).toEqual(['app', 'lib']);
    expect(treeOrder(tree)).toEqual(['web/src/app/layout.tsx', 'web/src/app/page.tsx', 'web/src/lib/a.ts', 'README.md']);
  });
  it('keeps the only top folder as a row', () => {
    const tree = buildFileTree(['src/a.ts', 'src/b.ts']);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('src');
    expect(tree[0].children.map((c) => c.file)).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('readIntentCheck', () => {
  it('reads a stored check and tolerates junk', () => {
    const check = readIntentCheck({
      verdict: 'partial', summary: 's', head_sha: 'abc', at: '2026-10-31T00:00:00Z',
      criteria: [{ intent: 'i', kind: 'measure', verdict: 'met', evidence: 'e', files: ['a.ts', 3] }, { nope: true }, { intent: 'j', verdict: 'weird' }],
      out_of_scope: [{ path: 'x', note: 'n' }, 'junk'], questions: ['q', 1],
    });
    expect(check?.criteria).toEqual([
      { intent: 'i', kind: 'measure', verdict: 'met', evidence: 'e', files: ['a.ts'] },
      { intent: 'j', kind: 'element', verdict: 'unclear', evidence: '', files: [] },
    ]);
    expect(check?.outOfScope).toEqual([{ path: 'x', note: 'n' }]);
    expect(check?.questions).toEqual(['q']);
    expect(readIntentCheck({ verdict: 'great' })).toBeNull();
    expect(readIntentCheck(null)).toBeNull();
    expect(readIntentCheck([])).toBeNull();
  });
  it('reads lists the model sent JSON-encoded', () => {
    const check = readIntentCheck({
      verdict: 'misaligned',
      criteria: JSON.stringify([{ intent: 'i', kind: 'element', verdict: 'not_met', evidence: 'e', files: [] }]),
      out_of_scope: '[{"path":"a.ts","note":"n"}]', questions: '["q"]',
    });
    expect(check?.criteria.map((c) => c.verdict)).toEqual(['not_met']);
    expect(check?.outOfScope).toEqual([{ path: 'a.ts', note: 'n' }]);
    expect(check?.questions).toEqual(['q']);
    expect(readIntentCheck({ verdict: 'aligned', criteria: 'not json' })?.criteria).toEqual([]);
  });
  it('is stale when the head moved', () => {
    const check = readIntentCheck({ verdict: 'aligned', head_sha: 'a' });
    expect(isCheckStale(check, 'a')).toBe(false);
    expect(isCheckStale(check, 'b')).toBe(true);
    expect(isCheckStale(check, null)).toBe(false);
  });
});

describe('reviewState', () => {
  const r = (reviewer_id: string, verdict: ReviewRecord['verdict'], created_at: string, head_sha: string | null = 'h2'): ReviewRecord =>
    ({ reviewer_id, reviewer_name: reviewer_id, verdict, created_at, head_sha });

  it('counts each reviewer once, by their latest verdict', () => {
    const s = reviewState([r('a', 'needs_changes', '1'), r('a', 'matches', '2'), r('b', 'matches', '3'), r('b', 'comment', '4')], 'h2');
    expect(s.matches).toBe(2);
    expect(s.needsChanges).toBe(0);
    expect(s.overall).toBe('matches');
    expect(s.latest.map((x) => x.reviewer_id)).toEqual(['b', 'a']);
  });
  it('lets one request for changes win', () => {
    expect(reviewState([r('a', 'matches', '1'), r('b', 'needs_changes', '2')], 'h2').overall).toBe('needs_changes');
  });
  it('stops counting a verdict given on an older head', () => {
    const s = reviewState([r('a', 'matches', '1', 'h1')], 'h2');
    expect(s.overall).toBe('pending');
    expect(s.latest[0].stale).toBe(true);
  });
});

describe('matchFile', () => {
  const files = ['web/src/a/Thing.tsx', 'web/src/b/Thing.tsx', 'README.md'];
  it('matches exactly, then by tail', () => {
    expect(matchFile('README.md', files)).toBe('README.md');
    expect(matchFile('b/Thing.tsx', files)).toBe('web/src/b/Thing.tsx');
    expect(matchFile('./README.md', files)).toBe('README.md');
    expect(matchFile('nope.ts', files)).toBeNull();
  });
});

describe('readGuide', () => {
  const files = ['db.sql', 'api.ts', 'ui.tsx', 'notes.md'];
  it('places each file once, drops empty sections and gathers the rest', () => {
    const g = readGuide({
      summary: 's', head_sha: 'h1',
      sections: [
        { title: 'Data', what: 'w', why: 'y', files: ['db.sql', 'api.ts'] },
        { title: 'Ghost', what: '', why: '', files: ['missing.ts'] },
        { title: 'API again', what: '', why: '', files: ['api.ts', 'ui.tsx'] },
      ],
    }, files)!;
    expect(g.sections.map((s) => s.title)).toEqual(['Data', 'API again', '']);
    expect(g.sections[1].files).toEqual(['ui.tsx']);
    expect(g.sections[2]).toMatchObject({ rest: true, files: ['notes.md'] });
    expect(g.headSha).toBe('h1');
  });
  it('reads malformed or empty guides as null', () => {
    expect(readGuide(null, files)).toBeNull();
    expect(readGuide({ sections: '[]' }, files)).toBeNull();
    expect(readGuide({ sections: [{ title: 'x', files: ['zzz'] }] }, files)).toBeNull();
  });
});

describe('inboxBucket', () => {
  const ctx = (over: Partial<InboxContext> = {}): InboxContext => ({
    myElements: new Set(), reviewingElements: new Set(), elementsWithReviewer: new Set(), myVerdictHeads: new Map(), ...over,
  });
  const change = (over: Partial<InboxChange> = {}): InboxChange => ({ id: 'c', element_id: 'e', state: 'open', head_sha: 'h2', linked_by: 'other', ...over });

  it('puts finished changes in done and the person’s own in mine', () => {
    expect(inboxBucket(change({ state: 'merged' }), 'me', ctx())).toBe('done');
    expect(inboxBucket(change({ linked_by: 'me' }), 'me', ctx())).toBe('mine');
    expect(inboxBucket(change(), 'me', ctx({ myElements: new Set(['e']) }))).toBe('mine');
  });
  it('waits on a review until a verdict is given on the current head', () => {
    expect(inboxBucket(change(), 'me', ctx())).toBe('review');
    expect(inboxBucket(change(), 'me', ctx({ myVerdictHeads: new Map([['c', new Set(['h1'])]]) }))).toBe('review');
    expect(inboxBucket(change(), 'me', ctx({ myVerdictHeads: new Map([['c', new Set(['h2'])]]) }))).toBe('open');
  });
  it('leaves a change with someone else as reviewer to them, and drafts open', () => {
    expect(inboxBucket(change(), 'me', ctx({ elementsWithReviewer: new Set(['e']) }))).toBe('open');
    expect(inboxBucket(change(), 'me', ctx({ elementsWithReviewer: new Set(['e']), reviewingElements: new Set(['e']) }))).toBe('review');
    expect(inboxBucket(change({ state: 'draft' }), 'me', ctx())).toBe('open');
  });
});

describe('iteratePrompt', () => {
  const base = { repo: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7', headRef: 'alcon/el-1' };
  it('asks for the open points on the same branch', () => {
    const p = iteratePrompt({
      ...base,
      comments: [
        { path: 'a.ts', line: 3, body: 'rename this', author: 'Ann', resolved: false },
        { path: 'b.ts', line: 1, body: 'done already', author: 'Ann', resolved: true },
      ],
      reviews: [
        { verdict: 'needs_changes', body: 'missing the empty state', reviewer: 'Bo', stale: false },
        { verdict: 'needs_changes', body: 'old point', reviewer: 'Bo', stale: true },
        { verdict: 'matches', body: 'lgtm', reviewer: 'Cy', stale: false },
      ],
    })!;
    expect(p).toContain('alcon/el-1');
    expect(p).toContain('`a.ts:3`');
    expect(p).toContain('missing the empty state');
    expect(p).not.toContain('done already');
    expect(p).not.toContain('old point');
    expect(p).not.toContain('lgtm');
  });
  it('is null when nothing is left to address', () => {
    expect(iteratePrompt({ ...base, comments: [], reviews: [{ verdict: 'matches', body: 'ok', reviewer: null, stale: false }] })).toBeNull();
  });
});

describe('unchangedBefore / splitPath', () => {
  it('counts the lines the patch leaves out before each hunk', () => {
    const hunks = parsePatch('@@ -10,3 +10,3 @@\n a\n-b\n+B\n c\n@@ -40,2 +40,2 @@\n x\n y');
    expect(unchangedBefore(hunks)).toEqual([9, 27]);
    expect(unchangedBefore(parsePatch('@@ -0,0 +1,2 @@\n+a\n+b'))).toEqual([0]);
  });
  it('splits a path into name and folder', () => {
    expect(splitPath('web/src/a.ts')).toEqual({ name: 'a.ts', dir: 'web/src/' });
    expect(splitPath('README.md')).toEqual({ name: 'README.md', dir: '' });
  });
});
