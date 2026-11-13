import { describe, expect, it } from 'vitest';
import { flattenCreated, liveTurnFromSteps, type CopilotStepRow } from '@/AIP/ai/copilotSteps';
import { toKeptMessages, type CopilotMessage, type ToolEvent } from '@/AIP/ai/useClaywareCopilot';

// The panel's live turn, mapped from a chat run's steps while Athena
// works (copilotSteps.ts), and the kept shape a cut-back writes
// (useClaywareCopilot.ts) — the client half of the unification's display
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

  it('surfaces a step detail’s created records on the live tool event', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('write', 'createElements', JSON.stringify({
        input: { objectId: 'o1' }, rows: 2,
        created: [
          { kind: 'element', id: 'e1', title: 'A', displayId: 'ELE_OBJ-001', status: 'todo' },
          { kind: 'element', id: 'e2', title: 'B', status: 'todo' },
        ],
      })),
      step('write', 'createObject', JSON.stringify({
        rows: 1, created: [{ kind: 'object', id: 'o2', title: '請求対応' }],
      })),
    ]);
    expect(live.toolEvents).toEqual([
      {
        name: 'createElements', input: { objectId: 'o1' }, result: { ok: true, rows: 2 },
        created: [
          { kind: 'element', id: 'e1', title: 'A', displayId: 'ELE_OBJ-001', status: 'todo' },
          { kind: 'element', id: 'e2', title: 'B', status: 'todo' },
        ],
      },
      {
        name: 'createObject', result: { ok: true, rows: 1 },
        created: [{ kind: 'object', id: 'o2', title: '請求対応' }],
      },
    ]);
  });

  it('drops malformed created entries — and the field entirely when none are valid', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '質問'),
      step('write', 'createElements', JSON.stringify({
        rows: 3,
        created: [
          { kind: 'element', id: 'e1', title: 'A' },
          { kind: 'widget', id: 'w1', title: '種別違い' },
          { kind: 'element', title: 'id なし' },
          { kind: 'object', id: 'o1', title: '' },
          'not-a-record',
          null,
        ],
      })),
      step('write', 'createObject', JSON.stringify({ rows: 1, created: [{ kind: 'object', title: 'id なし' }] })),
      step('write', 'createInitiative', JSON.stringify({ rows: 1, created: 'not-an-array' })),
    ]);
    expect(live.toolEvents[0].created).toEqual([{ kind: 'element', id: 'e1', title: 'A' }]);
    expect(live.toolEvents[1].created).toBeUndefined();
    expect(live.toolEvents[2].created).toBeUndefined();
  });

  it('a pull_request step becomes the turn’s PR card record (coding PR3)', () => {
    const live = liveTurnFromSteps([
      step('message', '質問', '直して'),
      step('pull_request', 'PR を開きました: acme/widgets#7', JSON.stringify({
        created: [{
          kind: 'pull_request', id: 'cc1', title: '請求画面の修正',
          url: 'https://github.com/acme/widgets/pull/7', repo: 'acme/widgets', number: 7, state: 'open',
        }],
      })),
      // The fallback detail (a plain URL, when the link row could not
      // be read back) is not the record's JSON: no card is invented.
      step('pull_request', 'PR を開きました: acme/widgets#8', 'https://github.com/acme/widgets/pull/8'),
      step('reply', '直しました', '直しました'),
    ]);
    expect(live.toolEvents).toHaveLength(1);
    expect(live.toolEvents[0].created).toEqual([{
      kind: 'pull_request', id: 'cc1', title: '請求画面の修正',
      url: 'https://github.com/acme/widgets/pull/7', repo: 'acme/widgets', number: 7, state: 'open',
    }]);
    expect(flattenCreated(live.toolEvents)).toHaveLength(1);
    expect(live.content).toBe('直しました');
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

describe('flattenCreated', () => {
  it('flattens a turn’s events in order, deduped by kind + id, first wins', () => {
    const events: ToolEvent[] = [
      { name: 'createObject', result: { ok: true, rows: 1 }, created: [{ kind: 'object', id: 'o1', title: '請求対応' }] },
      {
        name: 'createElements', result: { ok: true, rows: 2 },
        created: [
          { kind: 'element', id: 'e1', title: 'A', status: 'todo', objectId: 'o1' },
          { kind: 'element', id: 'e2', title: 'B', status: 'todo', objectId: 'o1' },
        ],
      },
      { name: 'listElements', result: { ok: true, rows: 5 } },
      // A repeated record (a resumed slice re-reporting) never rewrites
      // the first, and the same id under another kind is another entity.
      {
        name: 'createElements', result: { ok: true, rows: 1 },
        created: [
          { kind: 'element', id: 'e1', title: 'A（再掲）', status: 'done' },
          { kind: 'strategy', id: 'e1', title: '同 id の Strategy' },
        ],
      },
    ];
    expect(flattenCreated(events)).toEqual([
      { kind: 'object', id: 'o1', title: '請求対応' },
      { kind: 'element', id: 'e1', title: 'A', status: 'todo', objectId: 'o1' },
      { kind: 'element', id: 'e2', title: 'B', status: 'todo', objectId: 'o1' },
      { kind: 'strategy', id: 'e1', title: '同 id の Strategy' },
    ]);
  });

  it('a turn that created nothing flattens to nothing', () => {
    expect(flattenCreated([])).toEqual([]);
    expect(flattenCreated([{ name: 'readFile', result: { ok: true } }])).toEqual([]);
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

  it('carries a tool event’s created records through — they ride inside toolEvents, whole', () => {
    const shown: CopilotMessage[] = [
      { role: 'user', content: '作って' },
      {
        role: 'assistant', content: '作りました', done: true, at: 400,
        toolEvents: [{
          name: 'createElements', result: { ok: true, rows: 2 },
          created: [
            { kind: 'element', id: 'e1', title: 'A', displayId: 'ELE_OBJ-001', status: 'todo', objectId: 'o1' },
            { kind: 'element', id: 'e2', title: 'B', status: 'todo', objectId: 'o1' },
          ],
        }],
      },
    ];
    expect(toKeptMessages(shown)).toEqual([
      { role: 'user', content: '作って' },
      {
        role: 'assistant', content: '作りました',
        toolEvents: [{
          name: 'createElements', result: { ok: true, rows: 2 },
          created: [
            { kind: 'element', id: 'e1', title: 'A', displayId: 'ELE_OBJ-001', status: 'todo', objectId: 'o1' },
            { kind: 'element', id: 'e2', title: 'B', status: 'todo', objectId: 'o1' },
          ],
        }],
      },
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
