import { describe, expect, it } from 'vitest';

// The definition canvas's projection (Sim-incorporation P3,
// Function/shared/flowProjection.ts): the flow a person judges at
// review is drawn from the definition's own structure and from the
// row it runs under — never from state of the canvas's own. These
// fixtures pin the reading: steps in the text's order, a conditional
// sentence branching off the step before it, Checks as the gate,
// Stop as the terminal node, and an honest empty for a body that
// declares nothing.
import { parseDefinition } from '@/AIP/harness/harnessDefinition';
import {
  FLOW_COLUMN_X, FLOW_ROW_HEIGHT, projectDefinitionFlow, type FlowContext,
} from '@/Function/shared/flowProjection';

const SCHEDULE: FlowContext = {
  trigger: { kind: 'schedule', cron: '*/15 * * * *', timezone: 'Asia/Tokyo' },
  objectName: '問い合わせ対応',
};
const NO_ROW: FlowContext = { trigger: null, objectName: null };

// The owner's claim-handling flow (prototype design §6), as a
// definition body: mail comes in, is read and classified, urgent
// ones are escalated, and the action is ticketed into an Object.
const CLAIM = `# 目的
届いたクレームメールを処理し、対応を起票する

# 使うコネクタ
- Gmail

# 進め方
- Gmail で未処理のクレームメールを検索する
- メールを読み、内容を要約して分類する
- 緊急の場合は担当者にすぐ知らせる
- 分類に応じて対象 Object に Element を起票する

# 点検
- 起票先の Object が請求・障害・その他のどれかに合っているか
- 個人情報を転記していないか

# 成果物の型
\`\`\`markdown
# 処理レポート
\`\`\`

# 止める条件
- 対象が特定できないメールは起票せず、人に聞く

# 担当の決め方
- クレームの種別ごとに、対応表の担当者を割り当てる
`;

describe('projectDefinitionFlow — the claim flow', () => {
  const flow = projectDefinitionFlow(parseDefinition(CLAIM), SCHEDULE);

  it('draws the row first, then the steps, the gate, the output and the stop', () => {
    expect(flow.nodes.map((n) => n.kind)).toEqual([
      'trigger', 'target', 'step', 'step', 'condition', 'step', 'checks', 'output', 'stop',
    ]);
    expect(flow.empty).toBe(false);
  });

  it('keeps the text itself as the cards’ lines — no paraphrase', () => {
    const byKind = (kind: string) => flow.nodes.find((n) => n.kind === kind);
    expect(byKind('trigger')).toMatchObject({ title: '*/15 * * * *', badge: 'Asia/Tokyo', triggerKind: 'schedule' });
    expect(byKind('target')?.title).toBe('問い合わせ対応');
    expect(flow.nodes.filter((n) => n.kind === 'step').map((n) => n.title)).toEqual([
      'Gmail で未処理のクレームメールを検索する',
      'メールを読み、内容を要約して分類する',
      '分類に応じて対象 Object に Element を起票する',
    ]);
    expect(byKind('checks')).toMatchObject({
      title: '起票先の Object が請求・障害・その他のどれかに合っているか',
      detail: '個人情報を転記していないか',
    });
    expect(byKind('output')).toMatchObject({ title: '# 処理レポート', badge: 'markdown' });
    expect(byKind('stop')?.title).toBe('対象が特定できないメールは起票せず、人に聞く');
  });

  it('branches the conditional step off the step before it, and the chain walks past it', () => {
    const branch = flow.edges.find((e) => e.kind === 'branch');
    expect(branch).toMatchObject({ source: 'step-1', target: 'step-2' });
    const chain = flow.edges.filter((e) => e.kind === 'sequence').map((e) => [e.source, e.target]);
    expect(chain).toEqual([
      ['trigger', 'target'],
      ['target', 'step-0'],
      ['step-0', 'step-1'],
      ['step-1', 'step-3'],
      ['step-3', 'checks'],
      ['checks', 'output'],
      ['output', 'stop'],
    ]);
    const condition = flow.nodes.find((n) => n.kind === 'condition');
    expect(condition?.position).toEqual({ x: FLOW_COLUMN_X, y: 3 * FLOW_ROW_HEIGHT });
    expect(condition?.title).toBe('緊急の場合は担当者にすぐ知らせる');
  });

  it('carries connectors and the assignment rule as annotations, not steps', () => {
    expect(flow.connectors).toEqual(['Gmail']);
    expect(flow.assignment).toBe('クレームの種別ごとに、対応表の担当者を割り当てる');
    expect(flow.nodes.some((n) => n.title.includes('Gmail で未処理'))).toBe(true);
    expect(flow.nodes.every((n) => n.title !== 'Gmail')).toBe(true);
  });

  it('is a pure function of the body and the row: same input, same graph', () => {
    expect(projectDefinitionFlow(parseDefinition(CLAIM), SCHEDULE)).toEqual(flow);
  });
});

describe('projectDefinitionFlow — a plain linear flow', () => {
  const body = `# Purpose
Keep the inbox answered

# Procedure
- Fetch the inbox
- Summarize each message
- File a ticket in the support Object
`;
  const flow = projectDefinitionFlow(parseDefinition(body), {
    trigger: { kind: 'webhook' },
    objectName: null,
  });

  it('draws trigger and steps only, in order, down the main column', () => {
    expect(flow.nodes.map((n) => n.kind)).toEqual(['trigger', 'step', 'step', 'step']);
    expect(flow.nodes.map((n) => n.position)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: FLOW_ROW_HEIGHT },
      { x: 0, y: 2 * FLOW_ROW_HEIGHT },
      { x: 0, y: 3 * FLOW_ROW_HEIGHT },
    ]);
    expect(flow.edges.map((e) => e.kind)).toEqual(['sequence', 'sequence', 'sequence']);
    const trigger = flow.nodes[0];
    expect(trigger.triggerKind).toBe('webhook');
    expect(trigger.title).toBe('');
  });

  it('has no annotations the text does not declare', () => {
    expect(flow.connectors).toEqual([]);
    expect(flow.assignment).toBeNull();
  });
});

describe('projectDefinitionFlow — conditional steps at the edges of the list', () => {
  const body = `# 進め方
- 添付がある場合は先に保存する
- 本文を読む
- 宛先が社外なら、送信前に人に確認する
`;

  it('branches an opening condition off the target when a row gives one', () => {
    const flow = projectDefinitionFlow(parseDefinition(body), {
      trigger: null,
      objectName: '受付',
    });
    expect(flow.nodes.map((n) => n.kind)).toEqual(['target', 'condition', 'step', 'condition']);
    expect(flow.edges.filter((e) => e.kind === 'branch').map((e) => [e.source, e.target])).toEqual([
      ['target', 'step-0'],
      ['step-1', 'step-2'],
    ]);
  });

  it('places an opening condition in the chain when nothing precedes it', () => {
    const flow = projectDefinitionFlow(parseDefinition(body), NO_ROW);
    expect(flow.nodes.map((n) => n.kind)).toEqual(['condition', 'step', 'condition']);
    expect(flow.edges.filter((e) => e.kind === 'sequence').map((e) => [e.source, e.target])).toEqual([
      ['step-0', 'step-1'],
    ]);
    expect(flow.edges.find((e) => e.kind === 'branch')).toMatchObject({ source: 'step-1', target: 'step-2' });
  });
});

describe('projectDefinitionFlow — text shapes', () => {
  it('reads a bullet’s first line as its summary and keeps the rest as detail', () => {
    const body = `# 進め方
- 検索クエリは is:unread label:claim で組み立てる
  期間は直近 24 時間に限る
  ヒットが 0 件なら何もしない
- 結果を要約する
`;
    const flow = projectDefinitionFlow(parseDefinition(body), NO_ROW);
    expect(flow.nodes[0]).toMatchObject({
      kind: 'step',
      title: '検索クエリは is:unread label:claim で組み立てる',
      detail: '期間は直近 24 時間に限る\nヒットが 0 件なら何もしない',
    });
    expect(flow.nodes[1].detail).toBeNull();
  });

  it('degrades a bullet-less procedure to one step per line', () => {
    const body = `# 進め方
メールを検索する
読んで分類する
`;
    const flow = projectDefinitionFlow(parseDefinition(body), NO_ROW);
    expect(flow.nodes.map((n) => [n.kind, n.title])).toEqual([
      ['step', 'メールを検索する'],
      ['step', '読んで分類する'],
    ]);
  });

  it('reads checks written as plain lines as the gate, and a prose stop as the terminal', () => {
    const body = `# 進め方
- 処理する

# 点検
起票先が正しいか目視で確かめる

# 止める条件
判断できないものは人に返す
`;
    const flow = projectDefinitionFlow(parseDefinition(body), NO_ROW);
    expect(flow.nodes.map((n) => n.kind)).toEqual(['step', 'checks', 'stop']);
    expect(flow.nodes[1].title).toBe('起票先が正しいか目視で確かめる');
    expect(flow.nodes[2].title).toBe('判断できないものは人に返す');
  });
});

describe('projectDefinitionFlow — empty and near-empty bodies', () => {
  it('is honestly empty when neither body nor row gives anything', () => {
    const flow = projectDefinitionFlow(parseDefinition(''), NO_ROW);
    expect(flow).toMatchObject({ nodes: [], edges: [], empty: true });
    const goalOnly = projectDefinitionFlow(parseDefinition('# 目的\n何かのため\n'), NO_ROW);
    expect(goalOnly.empty).toBe(true);
  });

  it('still draws the row when the body declares nothing yet', () => {
    const flow = projectDefinitionFlow(parseDefinition(''), SCHEDULE);
    expect(flow.empty).toBe(false);
    expect(flow.nodes.map((n) => n.kind)).toEqual(['trigger', 'target']);
  });
});
