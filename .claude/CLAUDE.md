# Alcon — 世界最高の組織活動支援ツールを目指す

Next.js 16 + Supabase + Tailwind CSS + recharts。企業・軍事作戦・病院を問わず、あらゆる組織活動を業界非依存の少数概念で扱う。原則は **「意図で委ね、成果と根拠で確かめる」** —— 人間が目的・成功条件・制約・権限を示し、AI は意図を理解して権限内で手段を選び、権限を超える判断や前提の崩壊が生じたら人間に判断を戻す。

思想・UI レイアウト・データモデル・境界と権限の詳細は [PRODUCT.md](./PRODUCT.md)（製品判断をするときに読む）。

## 概念モデル

| 分類 | 何を扱うか | 単位 |
|---|---|---|
| **Strategy** | 何を達成し、どう勝つか | Initiative（束ねると戦略）/ Phase（時間箱）/ Timeline |
| **Execution** | 実際に行動する | Domain（活動の場）→ Object（成果物）→ Element（行動の最小単位） |
| **Sustainment** | 仕事道具 | Workload / CRM / SCM / Notebook / Table / Team / Calendar |

Initiative は目的・前提・意思決定・成功条件を持ち、担当や進捗は持たない。担当・期限・進捗・依存は Execution 側。ほかに個人の横断サーフェス **Home** と、Object ごとに定義して Element に値を持たせる **Property**。Worker は `human | ai_agent`。

**Strategy と Execution は分離するが遮断しない。** 混ぜて一覧化すると「意図」と「行動」の区別が崩れる。Initiative は配下 Object と実行上のリスク・負荷を、Object は貢献先 Initiative と意図を常に見せる —— この一クリックの往復可能性が Alcon の核。

## AI 駆動ループ

**バックログの単一情報源は盤面**（Supabase の `elements`）。外部の TODO リストを作らない。**状態をセッションの記憶に置かない** —— どのセッションが落ちても、盤面から拾えば続きが回る。

セッションを始めたら、まず盤面を見る。

| 盤面の状態 | 規約 |
|---|---|
| 着手できる Element がある | [friction](./skills/friction/SKILL.md) — 実装 → PR → レビューゲート → マージ → 書き戻し |
| 空いている | [exercise](./skills/exercise/SKILL.md) — **仕事を探さない。**架空の作戦を運用して摩擦を採る |
| PR をレビューする | [code-review](./skills/code-review/SKILL.md) |

ユーザーの判断が要るもの（課金 / 不可逆 / 割れた設計判断 / 停滞）は Object「Decisions — 判断」に Element として起票し、ユーザーにアサインして、止まらずに次へ行く。市場投入に直接効く仕事は Initiative「Friction GTM — 市場投入」の Ends から採り、Object「Go-to-Market」に置く。

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

テストは `web/tests/`（Vitest / node）。対象は壊れると痛い純粋ロジックだけ —— jsonb の正規化、リストのソート、design-lint の規則とラチェット。UI のレンダリングテストは持たない。

**キー**：⌘K で CommandPalette（グローバル検索＋ナビ）。ウィジェットは長押し 450ms で arrange モード（Esc / Done で抜ける）。

## ビジュアル原則

ミニマルで静かな UI。装飾よりも情報密度。メイン領域は角丸の IslandCard で浮かせる。

- **色をハードコードしない** — デザイントークンは `shared/designTokens.ts`
- **入力フィールドに枠・リング・アウトライン禁止** — globals.css が自動リングを一切出さないので、フォーカスの可視化は部品側の義務（背景トーンの変化で示す）。`focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで書かない
- **`uppercase` を使わない** — ラベルは書いた通り（先頭大文字）で表示する
- **「Task」と呼ばない** — 必ず「Element」
- **ウィジェットの枠を自作しない** — `WIDGET_REGISTRY` に登録し、枠は `WidgetFrame`、ヘッダは `useWidgetMeta` / `WidgetHeaderAction`
- **recharts を使うコンポーネントは `'use client'` 必須** — SSR 非対応

UI を変更したら `npm run design-lint`（変更ファイル限定のラチェット）。

## ディレクトリ

`web/src/` の下に、`shell/`（外殻 — ModeRail / AppSidebar / TabBar / CommandPalette / MainContent / viewRegistry）、`ActivitySpace/`（盤面の面 — `home/` `strategy/` `execution/` `sustainment/`）、`Function/`（盤面を成立させる仕組み — `widget/` `property/` `copilot/` `settings/` `space/` `sync/` `shared/`）、`hooks/`（Supabase の CRUD は全部ここ）、`shared/designTokens.ts`、`lib/` `providers/` `auth/` `types/` `ui/`。`app/` は layout / page / globals.css だけ。

root 直下は `supabase/`（migrations と functions）、`ops/`（自走ループの配管）、`docs/`（adr / friction-risk-register.md）、`website/`（LP）。

## 実装ルール

1. 変更後は必ず `npx tsc --noEmit` と `npm test`
2. 新規ファイルは、盤面の面なら `ActivitySpace/<分類>/<概念>/`、それを支える仕組みなら `Function/<concept>/`。横断 UI は `Function/shared/`、外殻は `shell/`
3. **新 view**：`viewRegistry.ts`（label/icon の単一情報源）→ `MainContent` 分岐 → `railApps.ts` の `MODE_META`。新モードを App にするなら `RailMode` / `APP_GROUPS` も
4. **新 Widget**：本体を `Function/widget/widgets/` に、定義を `registry.tsx` に1つ（`accepts` / `zones` / `load()` の動的 import）、既定配置は `defaults.ts`。既存ウィジェットを別 Subject に開放するのは `accepts` に1語足すだけ
5. **図の軸を焼き込まない** — 集計軸は `Function/shared/dimensions.ts` の `Dimension` から選ばせ `WidgetInstance.params` に持たせる。軸違いで2つ目のウィジェットを作らない
6. **フレームワークは永続データの見せ方にする** — OKR / Gap は `intents` の measure の読み替え、任意分類の分析は Table、散文は Note。業界固有のデータや分析結果をコンポーネントや配置パラメータへ直書きしない
7. **Object のネスト禁止**。Element の multi-homing は `object_id` + `element_objects` の二重書き
8. Phase の `end_date` は**含む**。日付を扱う処理は `Function/shared/phaseWindow.ts` を通す
9. Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）。BlockNote は使わない

## Supabase

- Project ID: `rkugtcqztkkacvoylupw`。RLS 有効で可視性は RLS が強制。CRUD は `hooks/` に集約
- AI は Edge Functions 経由（`alcon-copilot` / `run-agent` / `summarize-note` 等）
- **`supabase/` は root にのみ存在する**（migrations・functions とも）。`web/supabase/` は作らない
- **既存テーブルに触る migration は `to_regclass` ガード必須** —— 基底スキーマは migrations フォルダの外にあり、PR の preview branch は空 DB に replay する（書式は [friction/references/db.md](./skills/friction/references/db.md)）

## リポジトリ直下を「旧版」として消さない

root の `vercel.json` は本番デプロイ設定そのもの、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない（root で `npm install` すると lockfile が復活し、Next が workspace root を誤認して dev の `globals.css` が stale になる）。

## 改訂の作法 — 差分注釈ではなくモデル更新

知識・方針・用語の修正を依頼されたら、**思考（モデル）自体を上書き**する。新しい理解が最初からそうだったかのように書き直し、残骸を残さない。旧概念を「禁止」「廃止」「旧称」に降格させて残さない。「X→Y に変更」「以前は X」をファイルに書かない —— 変更点は会話で述べ、ファイルには最終状態だけを残す。言及された一箇所だけでなく意図が波及する全箇所（用語・例・図・命名表）を直し、仕上げに旧概念を grep して 0 件を確認する。例外はユーザーが履歴の保持を明示したときだけ。

## 完了したら

確認まで済んだらコミットして Push する。**Push の確認を毎回求めない。** 作業と無関係な変更や未追跡ファイルは含めない。Push に失敗したら理由と未反映の状態を報告する。
