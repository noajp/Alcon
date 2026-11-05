// Which parts of a harness the engine will act on, for the screen, read by
// the editor's copy of the engine's reader (sectionOf).
import { sectionOf, type SectionKey } from '@/Function/customize/harnessDefinition';

export type DefinitionPart = SectionKey;

/** Pure. The parts a harness has, in the order it has them. */
export function definitionParts(body: string): DefinitionPart[] {
  const found: DefinitionPart[] = [];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^#{1,3}\s+(.+?)\s*$/.exec(line) : null;
    const part = h ? sectionOf(h[1]) : null;
    if (part && !found.includes(part)) found.push(part);
  }
  return found;
}

/** A harness to start from, for the paste box. */
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
