import { describe, it, expect } from 'vitest';
import { holderToken, parseArgs, readBody, isUuid } from '../../.claude/ops/lease.mjs';

// The holder token is what makes two concurrent sessions distinguishable on
// the board. If it ever collapsed to the same string for two worktrees, the
// lease would silently stop being a mutex — which is exactly the bug the
// first implementation shipped with. These pin the derivation.
describe('holderToken', () => {
  it('derives from the worktree basename, prefixed with the agent name', () => {
    expect(holderToken({}, '/Users/x/Dev/Alcon/.claude/worktrees/unmerged-wip-check-30418a'))
      .toBe('Claude@unmerged-wip-check-30418a');
  });

  it('gives the primary checkout its own token', () => {
    expect(holderToken({}, '/Users/x/Dev/Clayware')).toBe('Claude@Clayware');
  });

  it('two worktrees never share a token', () => {
    const a = holderToken({}, '/r/.claude/worktrees/session-a');
    const b = holderToken({}, '/r/.claude/worktrees/session-b');
    expect(a).not.toBe(b);
  });

  it('LOOP_HOLDER pins the token outright', () => {
    expect(holderToken({ LOOP_HOLDER: ' Codex@box-7 ' }, '/anything')).toBe('Codex@box-7');
  });

  it('a blank LOOP_HOLDER does not produce an empty token', () => {
    expect(holderToken({ LOOP_HOLDER: '   ' }, '/r/wt')).toBe('Claude@wt');
  });

  it('LOOP_AGENT renames the prefix but keeps the worktree', () => {
    expect(holderToken({ LOOP_AGENT: 'Codex' }, '/r/wt')).toBe('Codex@wt');
  });
});

describe('parseArgs', () => {
  it('splits positionals from --flag value pairs', () => {
    expect(parseArgs(['claim', 'ELE_TRJ-016', '--branch', 'claude/x', '--note', 'why']))
      .toEqual({ _: ['claim', 'ELE_TRJ-016'], branch: 'claude/x', note: 'why' });
  });

  it('treats a flag with no value as boolean true', () => {
    expect(parseArgs(['release', 'X', '--dry'])).toEqual({ _: ['release', 'X'], dry: true });
  });

  it('does not swallow the next flag as a value', () => {
    expect(parseArgs(['--a', '--b', 'v'])).toEqual({ _: [], a: true, b: 'v' });
  });
});

describe('readBody', () => {
  it('prefers --text and trims it', () => {
    expect(readBody({ text: '  ● 進捗 — x  ' })).toBe('● 進捗 — x');
  });

  it('reads --file through the injected reader', () => {
    expect(readBody({ file: '/p' }, (p) => (p === '/p' ? '\n✔ 完了\n' : ''))).toBe('✔ 完了');
  });

  it('returns null for an empty body so the caller refuses to post nothing', () => {
    expect(readBody({ text: '   ' })).toBeNull();
    expect(readBody({})).toBeNull();
  });
});

describe('isUuid', () => {
  it('accepts a v4 uuid and rejects a display id', () => {
    expect(isUuid('57a1ef37-e986-4462-a655-387e06968b2e')).toBe(true);
    expect(isUuid('ELE_TRJ-016')).toBe(false);
  });
});
