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

describe('the screen reads a definition as the engine does', () => {
  it('finds the same parts', async () => {
    const { definitionParts } = await import('@/ActivitySpace/strategy/initiative/mission/definitionParts');
    const engine = (body: string) => Object.entries(def.parseDefinition(body).sections).filter(([, v]) => v).map(([k]) => k).sort();
    for (const body of [ISUCON, REPORT, '# Metric\n- latency (lower is better)\n# Stop\n- target 1\n']) {
      expect([...definitionParts(body)].sort()).toEqual(engine(body));
    }
  });
});
