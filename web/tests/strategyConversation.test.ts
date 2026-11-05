import { describe, expect, it } from 'vitest';
import { conversationItems, workTally } from '@/ActivitySpace/strategy/initiative/conversationModel';

const OPENING_SEPARATOR = '\n---\n';
const strategyTools = await import(new URL('../../supabase/functions/_shared/strategyTools.ts', import.meta.url).pathname);
const conversation = await import(new URL('../../supabase/functions/run-agent/conversation.ts', import.meta.url).pathname);
const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);

describe('intentPatch', () => {
  const { intentPatch } = strategyTools;

  it('keeps a note where each kind keeps it', () => {
    expect(intentPatch('assumption', { title: '予算は 300 万円', note: '超えたら規模を縮める' }, true))
      .toEqual({ title: '予算は 300 万円', subtitle: '超えたら規模を縮める' });
    expect(intentPatch('decision', { title: '自社開発にする', note: '外注' }, true))
      .toEqual({ title: '自社開発にする', abandoned: '外注' });
  });

  it('asks a success condition for a numeric target, and defaults its direction', () => {
    expect(() => intentPatch('measure', { title: '問い合わせを増やす' }, true)).toThrow(/targetValue/);
    expect(intentPatch('measure', { title: '月間問い合わせ', targetValue: 300, unit: '件' }, true))
      .toEqual({ title: '月間問い合わせ', target_value: 300, unit: '件', direction: 'at_least' });
  });

  it('refuses measure fields on other kinds and bad values', () => {
    expect(() => intentPatch('assumption', { title: 'x', targetValue: 3 }, true)).toThrow(/measure/);
    expect(() => intentPatch('measure', { targetValue: '300' }, false)).toThrow(/数値/);
    expect(() => intentPatch('decision', { horizon: '来月' }, false)).toThrow(/YYYY-MM-DD/);
    expect(() => intentPatch('decision', { status: 'great' }, false)).toThrow(/status/);
    expect(() => intentPatch('assumption', { title: '  ' }, true)).toThrow(/空/);
  });

  it('an edit writes only what it was given, and a reading stamps its time', () => {
    const patch = intentPatch('measure', { actualValue: 120 }, false);
    expect(Object.keys(patch).sort()).toEqual(['actual_value', 'measured_at']);
    expect(intentPatch('assumption', { note: '' }, false)).toEqual({ subtitle: null });
  });
});

describe('definitionReading', () => {
  it('says what the engine will enforce and what is missing', () => {
    const reading = def.definitionReading(def.parseDefinition('# 目的\n候補から 3 件に絞る\n# 止める条件\n- 費用 $3 まで\n'));
    expect(reading.reads[0]).toContain('候補から 3 件に絞る');
    expect(reading.reads.some((r: string) => r.includes('$3'))).toBe(true);
    expect(reading.missing.some((m: string) => m.includes('成果物の型'))).toBe(true);
  });

  it('a definition without a goal or a stop says so', () => {
    const reading = def.definitionReading(def.parseDefinition('ただの文章'));
    expect(reading.missing).toHaveLength(3);
  });
});

describe('the conversation run', () => {
  it('offers the Strategy reads and writes and the hand-over, never execution tools', () => {
    const names = conversation.conversationTools().map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['getInitiative', 'addIntent', 'writeInitiativeDefinition', 'hand_to_planner', 'listElements']));
    for (const n of ['finish', 'createElement', 'updateElement', 'save_artifact']) expect(names).not.toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });

  it('nothing in it waits for approval', () => {
    expect(conversation.conversationKindOf('addIntent')).toBe('board');
    expect(conversation.conversationKindOf('hand_to_planner')).toBe('internal');
  });

  it('the opening ends with what the person said, after the separator the page strips', () => {
    const opening = conversation.conversationOpening({
      strategy: { id: 's1', name: '新規事業', description: null, intents: [{ id: 'i1', kind: 'measure', title: '売上 1 億', status: 'on_track' }], objects: [], children: [], elements: [] },
      canEdit: true, definition: null, integrations: [], today: '2026-11-05',
    }, '目的から決めたい');
    expect(opening).toContain('成功条件: 売上 1 億');
    expect(opening.endsWith(`${OPENING_SEPARATOR}目的から決めたい`)).toBe(true);
  });
});

describe('conversationItems', () => {
  // The steps the engine writes for a conversation turn, in order.
  let n = 0;
  const step = (type: string, title: string, detail: string | null = null) => ({ id: `s${++n}`, type, title, detail });
  const steps = [
    step('status', '会話を開始', 'Alcon Agent / Sonnet'),
    step('message', '目的から決めたい', '目的から決めたい'),
    step('action', 'Alcon: getInitiative', null),
    step('reply', '目的を書きます。', '目的を書きます。'),
    step('write', 'Alcon: updateInitiative', '地域の問い合わせを倍にする'),
    step('error', 'Alcon: addIntent', '持ち主だけです'),
    step('action', 'Web 検索: 問い合わせ 平均'),
    step('plan_request', '計画を Planner に渡す準備をしました', '広告は使わない'),
    step('reply', '記録しました。', '記録しました。\n次は前提です。'),
    step('message', '次は前提を', '次は前提を'),
    step('error', '予算の上限に達しました', '…'),
  ];

  it('shows the person’s messages, and one agent turn between them', () => {
    const items = conversationItems(steps);
    expect(items.map((i) => i.kind)).toEqual(['person', 'agent', 'person']);
    expect(items[0]).toEqual({ kind: 'person', text: '目的から決めたい' });
    expect(items[2]).toEqual({ kind: 'person', text: '次は前提を' });
  });

  it('folds the work between the agent’s words, with each result', () => {
    const agent = conversationItems(steps)[1];
    if (agent.kind !== 'agent') throw new Error('expected the agent');
    expect(agent.segments.map((s) => s.kind)).toEqual(['work', 'text', 'work', 'text']);
    const work = agent.segments.flatMap((s) => (s.kind === 'work' ? s.items : []));
    expect(work.map((w) => [w.name, w.kind, w.ok])).toEqual([
      ['getInitiative', 'read', true], ['updateInitiative', 'write', true], ['addIntent', 'write', false],
      ['Web 検索: 問い合わせ 平均', 'web', true], ['hand_to_planner', 'plan', true],
    ]);
    expect(work[2].error).toBe('持ち主だけです');
    expect(work.find((w) => w.kind === 'plan')?.detail).toBe('広告は使わない');
    expect(workTally(work)).toEqual({ write: 2, read: 1, web: 1, plan: 1, failed: 1 });
    expect(agent.segments[3]).toEqual({ kind: 'text', text: '記録しました。\n次は前提です。' });
  });

  it('no steps, no conversation', () => {
    expect(conversationItems([])).toEqual([]);
  });
});
