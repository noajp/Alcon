# Alcon

**世界最高の組織活動支援ツールを目指す。** 企業・軍事作戦・病院など業界を問わず、あらゆる組織活動を業界非依存の少数概念で扱う。

## 三分類

全体の体系はクラウゼヴィッツ『戦争論』の 戦略・戦闘・兵站 に着想を得ている。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Campaign。複数の Campaign が束ねられて戦略となる |
| **Execution** | 戦闘 | 実際に行動する | Element（行動の最小単位）→ Object（Element の束）→ Domain（Object の集合） |
| **Sustainment** | 兵站 | 仕事道具 | Workload / Notebook / Table / Team / Calendar |

Execution の三層はアーレント『人間の条件』の 労働・仕事・活動 に着想を得ている。

設計思想の全体は [.claude/PRODUCT.md](.claude/PRODUCT.md)、開発の規約は [.claude/CLAUDE.md](.claude/CLAUDE.md)、判断の履歴は [docs/adr/](docs/adr/README.md)。

## 構成

- `web/` — Next.js 16 + Supabase + Tailwind CSS のアプリ本体
- `supabase/` — migrations と Edge Functions
- `ops/` — 自走開発ループの配管（[ops/README.md](ops/README.md)）
- `docs/` — ADR とリスク登録簿

## Commands

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npx tsc --noEmit   # 型チェック
cd web && npm test           # Vitest
cd web && npm run lint       # ESLint
```
