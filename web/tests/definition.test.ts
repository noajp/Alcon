import { describe, expect, it } from 'vitest';

const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);

const ISUCON = `# 目的
本番終了時点のスコアを最大にする

# 条件
- 競技時間 10:00–18:00。終了20分前以降は変更しない

# 指標
- スコア（大きいほど良い）: ベンチマークの結果

# 進め方（1周）
1. 律速を1つ選ぶ
2. 変更してベンチを走らせる

# 止める条件
- 目標 600,000 点に届いたら止める
- 費用 $30 まで
- 80 周まで
- 終了40分前: 最終確認に切り替える

# 点検（10周ごと）
- 0点の周がないか
- 戻せない変更をしていないか
`;

const REPORT = `# 目的
候補物件の比較レポートを出す

# 成果物の型
\`\`\`md
# 結論
{{一言で}}
## 推奨順位
<!-- 表で -->
## 確かめきれていない点
\`\`\`
`;

describe('reading a definition', () => {
  it('reads the sections, the metric, the stops and the checks of a loop', () => {
    const d = def.parseDefinition(ISUCON);
    expect(d.sections.goal).toBe('本番終了時点のスコアを最大にする');
    expect(d.metric).toEqual({ name: 'スコア', direction: 'max', source: 'ベンチマークの結果' });
    expect(d.stop.target).toBe(600000);
    expect(d.stop.budgetUsd).toBe(30);
    expect(d.stop.maxRounds).toBe(80);
    expect(d.checks).toEqual({ every: 10, items: ['0点の周がないか', '戻せない変更をしていないか'] });
    expect(d.output).toBeNull();
  });

  it('reads an output shape from a fenced block, and nothing else as a metric', () => {
    const d = def.parseDefinition(REPORT);
    expect(d.metric).toBeNull();
    expect(d.output?.format).toBe('markdown');
    expect(def.shapeHeadings(d.output!.body)).toEqual(['結論', '推奨順位', '確かめきれていない点']);
  });

  it('knows smaller-is-better metrics and English headings', () => {
    const d = def.parseDefinition('# Metric\n- p95 latency (lower is better): k6\n# Stop\n- target 120\n');
    expect(d.metric?.direction).toBe('min');
    expect(d.stop.target).toBe(120);
  });
});

describe('the output shape', () => {
  const shape = def.parseDefinition(REPORT).output;

  it('accepts an output with every heading filled in, and names what is missing otherwise', () => {
    expect(def.checkOutput(shape, '# 結論\n国分寺\n## 推奨順位\n|a|\n## 確かめきれていない点\n- 用途地域', 'markdown')).toEqual([]);
    expect(def.checkOutput(shape, '# 結論\n{{一言で}}\n## 推奨順位\n', 'markdown')).toEqual([
      '見出し「確かめきれていない点」がありません。', '{{…}} が埋まっていない箇所があります。',
    ]);
    expect(def.checkOutput(shape, 'a,b', 'csv')).toEqual(['format は markdown にしてください（今は csv）。']);
  });

  it('holds HTML to its style and slots, CSV to its header, JSON to its required keys', () => {
    const html = { format: 'html', body: '<style>.a{}</style><section data-slot="summary">{{x}}</section>' };
    expect(def.checkOutput(html, '<style>.a{}</style><section data-slot="summary">ok</section>', 'html')).toEqual([]);
    expect(def.checkOutput(html, '<section data-slot="other">ok</section>', 'html').length).toBe(2);
    expect(def.checkOutput({ format: 'csv', body: '物件,賃料,URL' }, '物件, 賃料 ,URL\nA,1,x', 'csv')).toEqual([]);
    expect(def.checkOutput({ format: 'json', body: '{"required":["items"]}' }, '{"other":1}', 'json')).toEqual(['項目「items」がありません。']);
  });
});

describe('loops', () => {
  const d = def.parseDefinition(ISUCON);

  it('stops on the target, the round limit or the budget, and not before', () => {
    expect(def.loopStop(d, [{ value: 400000 }, { value: 610000 }], 5)).toContain('目標 600000');
    expect(def.loopStop(d, Array.from({ length: 80 }, () => ({ value: 1 })), 5)).toContain('80 周');
    expect(def.loopStop(d, [{ value: 1 }], 30)).toContain('$30');
    expect(def.loopStop(d, [{ value: 1 }], 1)).toBeNull();
  });

  it('runs the checks every N rounds', () => {
    expect(def.checksDue(d, 10)).toBe(true);
    expect(def.checksDue(d, 9)).toBe(false);
  });
});

describe('checking a harness', () => {
  const codes = (body: string, connected?: string[]) => def.checkHarness(def.parseDefinition(body), { connected }).map((d: { code: string }) => d.code);

  it('finds a loop that never stops, and a missing goal', () => {
    expect(codes('# 指標\n- スコア（大きいほど良い）: ベンチ\n')).toEqual(['H001', 'H002', 'H006']);
    expect(codes(ISUCON)).toEqual(['H006']);
  });

  it('tells a stop the engine reads from one it only passes on', () => {
    expect(codes('# 目的\nx\n')).toContain('H003');
    expect(codes('# 目的\nx\n# 止める条件\n- 迷ったら聞く\n')).toContain('H004');
    expect(codes('# 目的\nx\n# 止める条件\n- 費用 $5 まで\n')).not.toContain('H004');
  });

  it('reads the connectors a harness uses and checks them against the Space', () => {
    const body = '# 目的\nx\n# 止める条件\n- 10 周まで\n# 使うコネクタ\n- GitHub\n- Notion（議事録）\n';
    expect(def.parseDefinition(body).connectors).toEqual(['GitHub', 'Notion']);
    expect(codes(body, ['github'])).toEqual(['H005', 'H006']);
    expect(codes(body)).not.toContain('H005');
  });

  it('reads how a Strategy is broken down', () => {
    expect(def.parseDefinition('# 目的\nx\n# 分け方\n- 画面ごとに Object を分ける\n').sections.breakdown).toBe('- 画面ごとに Object を分ける');
  });

  it('reads who a person\'s task goes to', () => {
    expect(def.parseDefinition('# 目的\nx\n# 担当の決め方\n- 契約まわりは法務の人\n').sections.assignment).toBe('- 契約まわりは法務の人');
    expect(def.parseDefinition('# Goal\nx\n# Assignment\n- Design work goes to the designer\n').sections.assignment).toBe('- Design work goes to the designer');
    expect(def.parseDefinition('# 目的\nx\n# 分け方\n- y\n').sections.assignment).toBe('');
  });
});

describe('failure rows (B13)', () => {
  const codes = (body: string, ctx?: unknown) => def.checkHarness(def.parseDefinition(body), ctx).map((d: { code: string }) => d.code);

  it('reads a Japanese failure row field by field', () => {
    const d = def.parseDefinition('# 目的\nx\n\n# 失敗時の扱い\n- read_failed: 再試行 2回、補償は確認、エスカレーション: オーナー、3回で諦める\n');
    expect(d.failure).toEqual([{ class: 'read_failed', retry: 2, compensate: 'ask', escalate: 'owner', giveUpAfter: 3 }]);
    expect(d.failureProblems).toEqual([]);
  });

  it('reads the English form under an English heading', () => {
    const d = def.parseDefinition('# Goal\nx\n\n# Failure\n- auth_failed: retry never, compensate never, escalate strategy, give up after 10\n');
    expect(d.failure).toEqual([{ class: 'auth_failed', retry: 0, compensate: 'never', escalate: 'strategy', giveUpAfter: 10 }]);
  });

  it('names classes by their Japanese labels', () => {
    const d = def.parseDefinition('# 目的\nx\n\n# 失敗の扱い\n- 認証失敗: 再試行なし、補償は自動、通知先: Inbox\n- 出典が古い: 補償は確認、エスカレーション: Strategy のオーナー\n');
    expect(d.failure).toEqual([
      { class: 'auth_failed', retry: 0, compensate: 'auto', escalate: 'inbox', giveUpAfter: null },
      { class: 'stale_claims', retry: null, compensate: 'ask', escalate: 'strategy', giveUpAfter: null },
    ]);
  });

  it('refuses a row with no escalation target (F001): silence is not declarable', () => {
    const body = '# 目的\nx\n\n# 失敗時の扱い\n- read_failed: 再試行 2回、補償は確認\n';
    const d = def.parseDefinition(body);
    expect(d.failure).toEqual([]);
    expect(d.failureProblems.map((p: { code: string }) => p.code)).toEqual(['F001']);
    expect(codes(body)).toContain('F001');
    expect(def.checkHarness(d).find((x: { code: string }) => x.code === 'F001')?.severity).toBe('error');
  });

  it('refuses a row whose class cannot be named (F002) and one with an out-of-grammar field (F003)', () => {
    const body = '# 目的\nx\n\n# 失敗時の扱い\n- something_else: 再試行 1回、エスカレーション: オーナー\n- read_failed: 再試行 9回、エスカレーション: オーナー\n- write_failed: 補償はたぶん、エスカレーション: オーナー\n- not_found: 再試行 1回、補償は確認、エスカレーション: オーナー、99回で諦める\n';
    const d = def.parseDefinition(body);
    expect(d.failure).toEqual([]);
    expect(d.failureProblems.map((p: { code: string }) => p.code)).toEqual(['F002', 'F003', 'F003', 'F003']);
  });

  it('refuses a second row for the same class (F004) and keeps the first', () => {
    const body = '# 目的\nx\n\n# 失敗時の扱い\n- read_failed: 再試行 1回、エスカレーション: オーナー\n- 読み取り失敗: 再試行 2回、エスカレーション: Inbox\n';
    const d = def.parseDefinition(body);
    expect(d.failure).toHaveLength(1);
    expect(d.failure[0].retry).toBe(1);
    expect(d.failureProblems.map((p: { code: string }) => p.code)).toEqual(['F004']);
  });

  it('reads the exceptions section by catalog id, split like connectors', () => {
    const d = def.parseDefinition('# 目的\nx\n\n# 例外カタログ\n- exc.partial-outage（相手先の一部障害）\n- exc.rate-limited: レート制限\n');
    expect(d.exceptions).toEqual(['exc.partial-outage', 'exc.rate-limited']);
    expect(def.parseDefinition('# Goal\nx\n\n# Exceptions\n- exc.stale-source\n').exceptions).toEqual(['exc.stale-source']);
  });

  it('warns on exceptions the Space has not installed (F005) or the catalog does not hold (F006), only with context', () => {
    const body = '# 目的\nx\n\n# 例外カタログ\n- exc.partial-outage\n- exc.nope\n';
    expect(codes(body)).not.toContain('F005');
    expect(codes(body)).not.toContain('F006');
    const withCtx = codes(body, { exceptions: { catalog: ['exc.partial-outage'], installed: [] } });
    expect(withCtx).toContain('F005');
    expect(withCtx).toContain('F006');
    expect(codes(body, { exceptions: { catalog: ['exc.partial-outage', 'exc.nope'], installed: ['exc.partial-outage', 'exc.nope'] } })).not.toContain('F005');
  });

  it('leaves a definition without the sections exactly as before', () => {
    const d = def.parseDefinition(ISUCON);
    expect(d.failure).toEqual([]);
    expect(d.failureProblems).toEqual([]);
    expect(d.exceptions).toEqual([]);
  });

  it('reads the rows back in definitionReading, and never as missing', () => {
    const d = def.parseDefinition('# 目的\nx\n\n# 失敗時の扱い\n- read_failed: 再試行 2回、補償は確認、エスカレーション: オーナー、3回で諦める\n\n# 例外カタログ\n- exc.partial-outage\n- exc.rate-limited\n- exc.stale-source\n');
    const reading = def.definitionReading(d);
    expect(reading.reads).toContain('失敗時の扱い: read_failed は再試行 2 回まで・補償は確認・エスカレーションはオーナー・3 回で諦める');
    expect(reading.reads).toContain('例外カタログ: 「exc.partial-outage」ほか 2 件を採用');
    expect(reading.missing.some((m: string) => m.includes('失敗'))).toBe(false);
  });
});

describe('the web copy of the harness reader', () => {
  it('is the same file run-agent and the Planner use', async () => {
    const { readFileSync } = await import('node:fs');
    const fn = readFileSync(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url), 'utf8');
    const web = readFileSync(new URL('../src/AIP/harness/harnessDefinition.ts', import.meta.url), 'utf8');
    expect(web).toBe(fn);
  });
});
