# Alcon

人と AI が同じデータと権限のもとで組織の仕事を進めるツール。企業・行政・病院など、さまざまな組織の仕事を少数の共通の概念で扱う。

| 分類 | 何を扱うか | 単位 |
|---|---|---|
| **Strategy** | 何を達成するか、なぜか | Vision → Portfolio → Initiative |
| **Execution** | 誰が何をしているか | Domain → Object → Element |
| **Sustainment** | 仕事に使う道具 | Workload / CRM / Audit / Notebook / Table / Slides / People / Calendar |

開発の規則は [.claude/CLAUDE.md](.claude/CLAUDE.md)。

## 構成

- `web/` — アプリ本体（Next.js 16 + Supabase + Tailwind CSS）
- `supabase/` — migrations と Edge Functions
- `sdk/` — ローカルのアプリを Space に登録する SDK
- `docs/` — 外部向けの API・MCP・asset-relay の説明
- `website/` — LP
- `.claude/` — 開発にだけ使うもの（規則・スキル・補助スクリプト）

## コマンド

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npx tsc --noEmit   # 型チェック
cd web && npm test           # Vitest
cd web && npm run lint       # ESLint
npm run rename-product <新しい名前>   # 製品名を一括で変える
```
