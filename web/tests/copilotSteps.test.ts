import { describe, expect, it } from 'vitest';
import { liveTurnFromSteps, type CopilotStepRow } from '@/AIP/ai/copilotSteps';
import { toKeptMessages, type CopilotMessage } from '@/AIP/ai/useAlconCopilot';

// The panel's live turn, mapped from a chat run's steps while Athena
// works (copilotSteps.ts), and the kept shape a cut-back writes
// (useAlconCopilot.ts) — the client half of the unification's display
// contract.
const step = (type: string, title: string, detail: string | null = null): CopilotStepRow => ({ type, title, detail });

describe('liveTurnFromSteps', () => {
  it('reads only the turn after the latest message', () => {
    const live = liveTurnFromSteps([
      step('message', '前の質問', '前の質問'),
      step('reply', '前の答え', '前の答え'),
      step('message', '今の質問', '今の質問'),
      step('draft', '応答を書いています', '育っている答え'),
    ]);
    expect(live.content).toBe('育っている答え');
    expect(live.toolEvents).toEqual([]);
  });

  it('joins finished stretches and the growing draft', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('reply', 'まず調べます', 'まず調べます'),
      step('draft', '応答を書いています', '結果は…'),
    ]);
    expect(live.content).toBe('まず調べます\n\n結果は…');
  });

  it('maps tool steps to events with their input and outcome', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('action', 'listElements', JSON.stringify({ input: { status: 'todo' }, rows: 12 })),
      step('write', 'updateElement', JSON.stringify({ input: { id: 'e1' } })),
      step('error', 'ext__send', JSON.stringify({ input: { to: 'a@example.com' }, error: '認証が必要です' })),
    ]);
    expect(live.toolEvents).toEqual([
      { name: 'listElements', input: { status: 'todo' }, result: { ok: true, rows: 12 } },
      { name: 'updateElement', input: { id: 'e1' }, result: { ok: true } },
      { name: 'ext__send', input: { to: 'a@example.com' }, result: { ok: false, error: '認証が必要です' } },
    ]);
  });

  it('a step whose detail is not the driver’s JSON still shows', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('error', 'readFile', 'ファイルが見つかりません'),
      step('action', 'listFiles', null),
      step('status', '停止しました'),
      step('approval', '承認待ち'),
    ]);
    expect(live.toolEvents).toEqual([
      { name: 'readFile', result: { ok: false, error: 'ファイルが見つかりません' } },
      { name: 'listFiles', result: { ok: true } },
    ]);
    expect(live.content).toBe('');
  });

  it('no steps yet reads as an empty turn', () => {
    expect(liveTurnFromSteps([])).toEqual({ content: '', toolEvents: [], connections: [], credentials: [] });
  });

  it('maps credential_request steps to the turn’s capture asks', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('credential_request', 'GitHub の認証情報が必要です', JSON.stringify({ requestId: 'req-1', label: 'GitHub' })),
      step('credential_request', '壊れた詳細', 'not json'),
      step('credential_request', 'ID なし', JSON.stringify({ label: 'GitHub' })),
      step('reply', 'カードを出しました', 'カードを出しました'),
    ]);
    expect(live.credentials).toEqual([{ requestId: 'req-1', label: 'GitHub', waitingFor: '' }]);
    expect(live.content).toBe('カードを出しました');
  });

  it('maps connection_request steps to the turn’s proposals', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('connection_request', '接続を提案しました', JSON.stringify({ names: ['GitHub'], waitingFor: 'PR を作る' })),
      step('connection_request', '壊れた詳細', 'not json'),
      step('reply', 'カードを出しました', 'カードを出しました'),
    ]);
    expect(live.connections).toEqual([{ names: ['GitHub'], waitingFor: 'PR を作る' }]);
    expect(live.content).toBe('カードを出しました');
  });
});

describe('toKeptMessages', () => {
  it('keeps the record and drops the panel’s bookkeeping and file contents', () => {
    const shown: CopilotMessage[] = [
      { role: 'user', content: '読んで', at: 123, attachments: [{ name: '請求書.pdf', mediaType: 'application/pdf', data: 'QUJD' }] },
      {
        role: 'assistant', content: '読みました', done: true, at: 124,
        toolEvents: [{ name: 'readFile', result: { ok: true } }],
        approvals: [{ calls: [], inputHash: 'h', status: 'pending', runId: 'r', actionId: 'a' }],
        connections: [{ names: ['GitHub'], waitingFor: 'PR を作る' }],
      },
      { role: 'assistant', content: '', done: false },
    ];
    expect(toKeptMessages(shown)).toEqual([
      { role: 'user', content: '読んで', attachments: [{ name: '請求書.pdf', mediaType: 'application/pdf' }] },
      {
        role: 'assistant', content: '読みました',
        toolEvents: [{ name: 'readFile', result: { ok: true } }],
        approvals: [{ calls: [], inputHash: 'h', status: 'pending', runId: 'r', actionId: 'a' }],
        connections: [{ names: ['GitHub'], waitingFor: 'PR を作る' }],
      },
      { role: 'assistant', content: '' },
    ]);
  });

  it('carries a stopped turn’s mark through — a cut must not un-stop it', () => {
    const shown: CopilotMessage[] = [
      { role: 'user', content: 'たくさん作って' },
      {
        role: 'assistant', content: '途中まで作りました', done: true, at: 300, stopped: true,
        toolEvents: [{ name: 'createElements', result: { ok: true, rows: 12 } }],
      },
      { role: 'assistant', content: '通常の答え', done: true },
    ];
    expect(toKeptMessages(shown)).toEqual([
      { role: 'user', content: 'たくさん作って' },
      {
        role: 'assistant', content: '途中まで作りました', stopped: true,
        toolEvents: [{ name: 'createElements', result: { ok: true, rows: 12 } }],
      },
      { role: 'assistant', content: '通常の答え' },
    ]);
  });

  it('carries a person’s chart colors through — the next cut must not strip them', () => {
    const shown: CopilotMessage[] = [
      {
        role: 'assistant', content: 'グラフです', done: true, at: 200,
        chartColors: { 0: { '売上': '#ef4444' }, 2: { '12月': '#8b8d98' } },
      },
      { role: 'assistant', content: '色なし', done: true, chartColors: {} },
    ];
    expect(toKeptMessages(shown)).toEqual([
      { role: 'assistant', content: 'グラフです', chartColors: { 0: { '売上': '#ef4444' }, 2: { '12月': '#8b8d98' } } },
      { role: 'assistant', content: '色なし' },
    ]);
  });
});
