# Alcon — 世界最高の組織活動支援ツールを目指す

Next.js 16 + Supabase + Tailwind CSS + recharts。企業・軍事作戦・病院など、さまざまな組織の活動を少数の共通概念で扱う。原則は **「意図で委ね、成果と根拠で確かめる」**。人間が目的・成功条件・制約・権限を示し、AI はその意図に沿って権限内で手段を選ぶ。権限を超える判断が必要になったり、前提が成り立たなくなったりした場合は、人間に判断を求める。

思想・データモデル・境界と権限の詳細は [PRODUCT.md](./PRODUCT.md)（製品判断をするときに読む）。

## 概念モデル

| 分類 | 何を扱うか | 単位 |
|---|---|---|
| **Strategy** | 何を達成し、どう勝つか | Vision（Space が目指す姿）→ Portfolio（Initiative の束、入れ子可）→ Initiative（複数で戦略を構成）。Phase（活動を期間で区切る単位）はナビに出さない |
| **Execution** | 実際に行動する | Domain（活動の場）→ Object（成果物）→ Element（行動の最小単位） |
| **Sustainment** | 仕事道具 | Workload / CRM / Audit / Notebook / Table / Slides / People / Calendar |

Initiative は目的・前提・意思決定・成功条件を持ち、担当や進捗は持たない。担当・期限・進捗・依存は Execution 側で扱う。ほかに分類を横断して使う個人向けの画面 **Home** と、Object ごとに定義して Element に値を持たせる **Property** がある。Worker は `human | ai_agent`。

**Strategy と Execution は分けて表示し、相互に参照できるようにする。** 「意図」と「行動」を区別しつつ、Initiative には配下の Object と実行上のリスク・負荷を、Object には貢献先の Initiative と意図を常に表示する。目的と実行状況を一クリックで行き来できることを重視する。

## 盤面から開発するとき

ユーザーが「盤面から取って」「演習して」「レビューして」と頼んだときだけ [friction](./skills/friction/SKILL.md) を読む。それ以外のセッションでは盤面を見に行かず、頼まれたことをする。大きな設計判断は [docs/architecture.md](../docs/architecture.md) に1項目足す。

## コマンド

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず）
cd web && npm test           # Vitest（変更後に必ず）
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npm run lint       # ESLint
cd web && npm run sync       # ブランチ・worktree の同期と掃除
npx vercel --prod            # 本番デプロイ
```

テストは `web/tests/`（Vitest / node）。対象は、不具合の影響が大きい純粋ロジックに絞る。jsonb の正規化、リストのソート、design-lint の規則とラチェットなど。UI のレンダリングテストは持たない。

**キー**：⌘K で CommandPalette（グローバル検索＋ナビ）。ウィジェットは長押し 450ms で arrange モード（Esc / ウィジェット外のクリックで抜ける）。

## 画面の実装

- **色をハードコードしない** — トークンは `web/src/app/globals.css` と `shared/designTokens.ts`。UI を変更したら `npm run design-lint`（変更ファイル限定のラチェット）
- **「Task」と呼ばない** — 必ず「Element」
- **ウィジェットの枠を自作しない** — `WIDGET_REGISTRY` に登録し、枠は `WidgetFrame`、ヘッダは `useWidgetMeta` / `WidgetHeaderAction`
- **recharts を使うコンポーネントは `'use client'` 必須** — SSR 非対応

## ディレクトリ

`web/src/` の下に、`shell/`（外殻 — ModeRail / AppSidebar / CommandPalette / MainContent / viewRegistry）、`ActivitySpace/`（盤面の面 — `home/` `strategy/` `execution/` `sustainment/`）、`Function/`（盤面を成立させる仕組みと画面をまたぐモデル — `widget/` `property/` `settings/` `space/` `sync/` `shared/`、`strategy/` `crm/` `team/` など概念ごと）、`hooks/`（Supabase の CRUD は全部ここ）、`shared/designTokens.ts`、`lib/` `providers/` `auth/` `types/` `ui/`。`app/` は layout / page / globals.css だけ。

root 直下は `supabase/`（migrations と functions）、`ops/`（盤面から開発するときの配管）、`docs/`（architecture.md と外部向けの API・MCP の説明）、`website/`（LP）。

## 実装ルール

1. 変更後は必ず `npx tsc --noEmit` と `npm test`
2. 新規ファイルは、盤面の画面なら `ActivitySpace/<分類>/<概念>/`、それを支える仕組みなら `Function/<concept>/`。横断 UI は `Function/shared/`、外殻は `shell/`。依存は `ActivitySpace/` → `Function/` / `hooks/` の一方向。`Function/` `hooks/` から `ActivitySpace/` を import せず（画面の一部を盤面に置く `widget/widgets/` だけ例外）、画面は `supabase` を直接使わず `hooks/` を通す（Kata 由来の Slides だけ例外）。どちらも ESLint が検査する
3. **新 view**：`viewRegistry.ts`（label/icon の単一情報源）→ `MainContent` 分岐 → `railApps.ts` の `MODE_META`。新モードを App にするなら `RailMode` / `APP_GROUPS` も
4. **新 Widget**：本体を `Function/widget/widgets/` に、定義を `registry.tsx` に1つ（`accepts` / `zones` / `load()` の動的 import）、既定配置は `defaults.ts`。既存ウィジェットを別の Subject でも使う場合は、`accepts` に対象を追加する。Home 以外のボードは対象を見られる全員が共有するので、ウィジェットの中身は `useWidgetDocument`（全員で共有）に置き、本人だけに見せる下書きは `useWidgetViewerState` に置く
5. **グラフの集計軸を固定しない** — 集計軸は `Function/shared/dimensions.ts` の `Dimension` から選択できるようにし、`WidgetInstance.params` に保存する。軸の違いだけで別のウィジェットを作らない
6. **フレームワークは永続データの見せ方にする** — OKR / Gap は `intents` の measure の読み替え、任意の分類による分析には Table を使い、文章は Note に保存する。業界固有のデータや分析結果をコンポーネントや配置パラメータへ直書きしない
7. **Object のネスト禁止**。Element の multi-homing は `object_id` + `element_objects` の二重書き
8. Phase の期間には **`end_date` 当日を含める**（`Function/shared/phaseWindow.ts`）。日付の解釈・計算・表示は `Function/shared/dateUtils.ts` を通す。日付列は暦日なので `new Date('yyyy-MM-dd')`（UTC 0時になり、日がずれる）で読まない
9. Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）。BlockNote は使わない

## Supabase

- Project ID: `rkugtcqztkkacvoylupw`。閲覧範囲は RLS で制御する。CRUD は `hooks/` に集約
- AI は Edge Functions 経由（`alcon-copilot` / `run-agent` / `summarize-note` 等）
- **`supabase/` は root にのみ存在する**（migrations・functions とも）。`web/supabase/` は作らない
- **既存テーブルに触る migration は `to_regclass` ガード必須** —— 基底スキーマは migrations フォルダの外にあり、PR の preview branch は空 DB に replay する（書式は [friction](./skills/friction/SKILL.md) の「DB を直に触るとき」）

## リポジトリ直下を「旧版」として消さない

root の `vercel.json` は本番デプロイ設定そのもの、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない（root で `npm install` すると lockfile が復活し、Next が workspace root を誤認して dev の `globals.css` が stale になる）。

## 文書の改訂方針

知識・方針・用語を修正するときは、意図を踏まえて関連する説明全体を更新する。文書には現在の考え方を記し、古い説明を残さない。不要になった概念は「禁止」「廃止」「旧称」として残さず、削除する。変更点は会話で説明し、文書には「X→Y に変更」「以前は X」のような履歴を書かない。用語・例・図・命名表など、関連する箇所を一貫して更新し、旧概念の表記が残っていないことを検索で確認する。例外はユーザーが履歴の保持を明示したときだけ。

## 完了したら

確認まで済んだらコミットして Push する。**Push の確認を毎回求めない。** 作業と無関係な変更や未追跡ファイルは含めない。Push に失敗したら理由と未反映の状態を報告する。
