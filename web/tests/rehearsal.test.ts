import { describe, expect, it } from 'vitest';

// The rehearsal substrate's pure half (_shared/rehearsal.ts): how a
// finished rehearsal's report classifies, in the design's five
// classes, and how the stored report reads back.
const reh = await import(new URL('../../supabase/functions/_shared/rehearsal.ts', import.meta.url).pathname);

const report = (over: Record<string, unknown> = {}) => ({
  reads: [{ tool: 'Gmail: list', ok: true, authFailure: false }],
  writes: [{ tool: 'Slack: post', valid: true, problem: null }],
  ...over,
});

describe('classifyRehearsal (§4.6)', () => {
  it('reads executed and writes assembled: tested', () => {
    expect(reh.classifyRehearsal(report(), false)).toBe('tested');
    expect(reh.classifyRehearsal(report({ writes: [] }), false)).toBe('tested');
  });

  it('no reads at all is unverifiable, with or without planned writes', () => {
    expect(reh.classifyRehearsal(report({ reads: [] }), false)).toBe('unverifiable');
    expect(reh.classifyRehearsal({ reads: [], writes: [] }, false)).toBe('unverifiable');
  });

  it('a write that cannot be assembled is write_plan_invalid', () => {
    const r = report({ writes: [{ tool: 'Slack: post', valid: false, problem: 'channel が必要です' }] });
    expect(reh.classifyRehearsal(r, false)).toBe('write_plan_invalid');
  });

  it('a read that failed on auth points at the connection', () => {
    const r = report({ reads: [{ tool: 'Gmail: list', ok: false, authFailure: true }] });
    expect(reh.classifyRehearsal(r, false)).toBe('connector_missing');
  });

  it('any other failed read, and a failed run, are read_failed', () => {
    const r = report({ reads: [{ tool: 'Gmail: list', ok: false, authFailure: false }] });
    expect(reh.classifyRehearsal(r, false)).toBe('read_failed');
    expect(reh.classifyRehearsal(report(), true)).toBe('read_failed');
  });

  it('precedence: the earliest stage’s problem wins', () => {
    const both = report({
      reads: [{ tool: 'Gmail: list', ok: false, authFailure: true }],
      writes: [{ tool: 'Slack: post', valid: false, problem: 'x' }],
    });
    expect(reh.classifyRehearsal(both, false)).toBe('connector_missing');
    const readAndWrite = report({
      reads: [{ tool: 'Gmail: list', ok: false, authFailure: false }],
      writes: [{ tool: 'Slack: post', valid: false, problem: 'x' }],
    });
    expect(reh.classifyRehearsal(readAndWrite, false)).toBe('read_failed');
  });
});

describe('readRehearsalReport', () => {
  it('reads a stored report and tolerates junk as no evidence', () => {
    expect(reh.readRehearsalReport(null)).toEqual({ reads: [], writes: [], outcome: null, at: null });
    expect(reh.readRehearsalReport('junk').reads).toEqual([]);
    const r = reh.readRehearsalReport({
      reads: [{ tool: 'A', ok: true }, { nope: 1 }],
      writes: [{ tool: 'B', valid: false, problem: 'p' }],
      outcome: 'tested', at: '2026-11-08T00:00:00Z',
    });
    expect(r.reads).toEqual([{ tool: 'A', ok: true, authFailure: false }]);
    expect(r.writes).toEqual([{ tool: 'B', valid: false, problem: 'p' }]);
    expect(r.outcome).toBe('tested');
    // Junk still classifies honestly: no evidence is unverifiable.
    expect(reh.classifyRehearsal(reh.readRehearsalReport(null), false)).toBe('unverifiable');
  });
});

describe('summarizeRehearsalReport', () => {
  it('tells the same story to the step, the drafter and the reviewer', () => {
    const s = reh.summarizeRehearsalReport(report(), 'tested');
    expect(s).toContain('合格');
    expect(s).toContain('読み取り 1 件（成功 1・失敗 0）');
    expect(s).toContain('書き込みの計画 1 件（組み立て可能 1・問題あり 0）');
    const bad = reh.summarizeRehearsalReport(
      report({ writes: [{ tool: 'Slack: post', valid: false, problem: 'channel が必要です' }] }),
      'write_plan_invalid',
    );
    expect(bad).toContain('分類 write_plan_invalid');
    expect(bad).toContain('Slack: post — channel が必要です');
  });

  it('the task notice says reads are real and writes are plans', () => {
    expect(reh.REHEARSAL_TASK_NOTICE).toContain('試走');
    expect(reh.REHEARSAL_TASK_NOTICE).toContain('実行されず');
  });
});
