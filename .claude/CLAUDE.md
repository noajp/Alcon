# Alcon — 組織の活動に欠かせない運用基盤を目指す

ビジネスの活動に要る仕事を、人と AI が一つの場所で回せるようにする。作るのは、クリエイティブな作業のための道具ではなく、現実の課題を解決するための道具。人間が目的・成功条件・制約・権限を示し、AI はその意図に沿って権限内で手段を選ぶ。権限を超える判断が必要になったり、前提が成り立たなくなったりした場合は、人間に判断を求める。製品の設計と、次に作るものは [PRODUCT.md](./PRODUCT.md)。

## 作りの三層

| 層 | 中身 |
|---|---|
| 操作画面 | 仕事が流れていくのを見て、人は判断と評価だけをする |
| AIP | モデルは差し替え可能。ハーネス（仕事のやり方）とコネクタ（外とのつながり）を増やして使う。止める条件と承認はエンジンが守らせる |
| データ | Supabase（Postgres・RLS・Edge Functions・Vault・Realtime） |

## 概念モデル

| 分類 | 何を扱うか | 単位 |
|---|---|---|
| **Strategy** | 何を達成し、どう勝つか | Strategy（際限なく入れ子にでき、最上位が Space の目指す姿、配下がそれを勝ち取る筋道）。Phase（期間の区切り）はナビに出さない |
| **Execution** | 実際に行動する | Domain（活動の場）→ Object（Element をまとめる持ち場。プロジェクトに近い）→ Element（行動の最小単位） |
| **Sustainment** | 活動を続ける道具 | Automation / Artifacts / Reviews / Audit / People / Table / Calendar |

Strategy は目的・前提・意思決定・成功条件を持ち、担当や進捗は持たない。担当・期限・進捗・依存は Execution 側で扱う。Element は動詞（`judge` `decide` `approve` `answer` は人だけ、ほかは AI もできる）を持つ。Worker は `human | ai_agent`。外の世界のもの（顧客・候補・問い合わせ）は Object ではなく Table の行に置く。

## コマンド

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず）
cd web && npm test           # Vitest（変更後に必ず）
cd web && npm run build      # 本番ビルド
cd web && npm run lint:changed && npm run unwired-lint && npm run design-lint
cd web && npm run sync       # ブランチ・worktree の掃除
cd web && npm run dispatch   # Element を Claude Code に渡す常駐（alcon スキル）
```

テストは `web/tests/`（Vitest / node）。対象は不具合の影響が大きい純粋ロジックに絞り、UI のレンダリングテストは持たない。

## ディレクトリ

`web/src/` の下：

- `Frame/` 外枠（ModeRail・サイドバー・CommandPalette・MainContent・`viewRegistry.ts`）
- `ActivitySpace/` 画面。サイドバーの項目ごとに1フォルダ（`strategy` `automation` `artifacts` `reviews` `audit` `people` `table` `calendar` `execution` `home`）
- `AIP/` AI の部品（`harness` `connectors` `ai`）
- `Function/` 画面を支える仕組みと、画面をまたぐモデル（`widget` `property` `settings` `space` `shared` など）
- `hooks/` Supabase の読み書きはすべてここ
- `lib/` `providers/` `auth/` `types/` `ui/`、`app/` は layout / page / globals.css だけ

root 直下は `supabase/`（migrations と functions。ここにだけ置く）、`sdk/`、`docs/`（外部向けの API・MCP の説明）、`website/`（LP）。開発にだけ使うものは `.claude/`。

## 実装ルール

1. 変更後は必ず `npx tsc --noEmit` と `npm test`
2. 依存は `ActivitySpace/` → `Function/` `AIP/` `hooks/` の一方向。`Function/` `AIP/` `hooks/` から `ActivitySpace/` を import しない（`Function/widget/widgets/` だけ例外）。画面は `supabase` を直接使わず `hooks/` を通す（`artifacts/slides` だけ例外）。ESLint が検査する
3. **新 view**：`Frame/viewRegistry.ts`（label/icon の単一情報源）→ `Frame/MainContent` の分岐 → `Frame/railApps.ts` の `MODE_META`
4. **新 Widget**：本体を `Function/widget/widgets/`、定義を `registry.tsx` に1つ、既定配置は `defaults.ts`。枠は `WidgetFrame`、ヘッダは `useWidgetMeta` / `WidgetHeaderAction`。共有の中身は `useWidgetDocument`、本人だけの下書きは `useWidgetViewerState`
5. グラフの集計軸は `Function/shared/dimensions.ts` の `Dimension` から選ばせ、`WidgetInstance.params` に保存する
6. 業界固有のデータや分析結果をコンポーネントに直書きしない。分類は Table、文章は Note、仕事のやり方はハーネスに置く
7. **Object のネスト禁止**。Element の multi-homing は `object_id` + `element_objects` の二重書き
8. 日付は `Function/shared/dateUtils.ts` を通す。Phase の期間は `end_date` 当日を含める。暦日を `new Date('yyyy-MM-dd')` で読まない
9. 色はトークン（`globals.css` / `shared/designTokens.ts`）だけ。「Task」と呼ばず「Element」。recharts を使うコンポーネントは `'use client'`
10. AI の入口を画面ごとに置かない。AI はユーザーが AI 画面から呼ぶ。機能は AI なしでも動くように作る

## Supabase

- Project ID: `rkugtcqztkkacvoylupw`。閲覧範囲は RLS で制御する
- AI は Edge Functions 経由（`run-agent` `plan-initiative` `alcon-copilot` など）
- **既存テーブルに触る migration は `to_regclass` ガード必須**（PR の preview branch は空 DB に流すため。書式は alcon スキル）

## リポジトリ直下を「旧版」として消さない

root の `vercel.json` は本番デプロイ設定、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない。

## 文書の改訂方針

文書には現在の考え方だけを書く。用語や方針を変えたら関連する説明を全部更新し、「以前は X」「X→Y に変更」のような履歴は残さない。ここには守るべきことだけを書き、仕組みの説明はコードのコメントに置く。

## 完了したら

確認まで済んだらコミットして Push し、PR の CI が通ってからマージする。作業と無関係な変更は含めない。Alcon の Element を取って開発するとき、架空の案件で試すとき、PR をレビューするときは [alcon スキル](./skills/alcon/SKILL.md) を読む。
