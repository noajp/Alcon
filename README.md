# Alcon

**世界最高の組織活動支援ツールを目指す。** 企業・軍事作戦・病院など、さまざまな組織の活動を少数の共通概念で扱う。

## 三分類

全体の体系はクラウゼヴィッツ『戦争論』の戦略・戦闘・兵站に着想を得ている。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Initiative。複数の Initiative で戦略を構成する |
| **Execution** | 戦闘 | 実際に行動する | Domain（活動の場）→ Object（成果物の束）→ Element（行動の最小単位） |
| **Sustainment** | 兵站 | 仕事道具 | Workload / Notebook / Table / People / Calendar |

Execution の三層はアーレント『人間の条件』の活動・仕事・労働に着想を得ている。

設計思想は [.claude/PRODUCT.md](.claude/PRODUCT.md)、開発の規約は [.claude/CLAUDE.md](.claude/CLAUDE.md)、設計判断は [docs/architecture.md](docs/architecture.md)。

## 構成

- `web/` — Next.js 16 + Supabase + Tailwind CSS のアプリ本体
- `supabase/` — migrations と Edge Functions
- `ops/` — 盤面から開発するときの運用スクリプト（[friction](.claude/skills/friction/SKILL.md) の「配管」）
- `docs/` — 設計判断（architecture.md）と外部向けの API・MCP の説明

## コマンド

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npx tsc --noEmit   # 型チェック
cd web && npm test           # Vitest
cd web && npm run lint       # ESLint
```
