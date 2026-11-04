// Which parts of a definition the engine will act on, for the screen. The
// headings mirror supabase/functions/_shared/definition.ts (sectionOf);
// tests/definition.test.ts keeps the two in step.

export type DefinitionPart = 'goal' | 'conditions' | 'metric' | 'procedure' | 'stop' | 'checks' | 'output';

const DEFINITION_PARTS: [DefinitionPart, RegExp][] = [
  ['goal', /^(目的|ゴール|goal|purpose)/i],
  ['conditions', /^(条件|前提|ルール|conditions?|rules)/i],
  ['metric', /^(指標|評価指標|metric|score)/i],
  ['procedure', /^(進め方|手順|ループ|procedure|steps|loop)/i],
  ['stop', /^(止める条件|終了条件|停止条件|stop)/i],
  ['checks', /^(点検|チェック|監査|checks?|audit)/i],
  ['output', /^(成果物の型|出力の型|成果物|output)/i],
];

/** Pure. The parts a definition has, in the order it has them. */
export function definitionParts(body: string): DefinitionPart[] {
  const found: DefinitionPart[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^#{1,3}\s+(.+?)\s*$/.exec(line) : null;
    const part = h ? DEFINITION_PARTS.find(([, re]) => re.test(h[1].trim()))?.[0] : undefined;
    if (part && !found.includes(part)) found.push(part);
  }
  return found;
}

/** A definition to start from, for the paste box. */
export const DEFINITION_EXAMPLE = `# 目的
（この仕事で何を達成するか）

# 条件
- （守るルール、触ってよい範囲、期限）

# 指標
- （ループで改善する値。例: スコア（大きいほど良い）: 計測の仕方）

# 進め方
1. （1 周、または手順）

# 止める条件
- 目標 （値）に届いたら止める
- 費用 $10 まで

# 点検（10周ごと）
- （見直す項目）

# 成果物の型
\`\`\`md
# 結論
## 根拠
\`\`\`
`;
