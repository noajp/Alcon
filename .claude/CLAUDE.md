# Alcon — 世界最高の組織活動支援ツールを目指す

Next.js 16 + Supabase + Tailwind CSS + recharts。企業・軍事作戦・病院を問わず、あらゆる組織活動を業界非依存の少数概念で扱う。

人間が目的を示し、人間と AI が同じ業務データと権限のもとで仕事を進め、結果を確かめながら仕事の仕組みを育てる基盤。原則は **「意図で委ね、成果と根拠で確かめる」** —— 人間が目的・成功条件・制約・権限を示し、AI は意図を理解して権限内で手段を選び、権限を超える判断や前提の崩壊が生じたら人間に判断を戻す。

UI レイアウト・データモデル・境界と権限・拡張構想の詳細は [PRODUCT.md](./PRODUCT.md)。

## 概念モデル

機能は **Strategy / Execution / Sustainment** の三つに分類される。体系はクラウゼヴィッツ『戦争論』の**戦略・戦闘・兵站**の三分に着想を得ている。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Initiative（束ねると戦略になる） |
| **Execution** | 戦闘 | 実際に行動する | Domain → Object → Element |
| **Sustainment** | 兵站 | 仕事道具 | Workload / CRM / SCM / Notebook / Table / Team / Calendar |

**Strategy** — Initiative が単位。目的・前提・意思決定・成功条件を持ち、担当や進捗は持たない。Initiative が束ねられて戦略になる。ほかに Phase（努力を配分する時間箱）と Timeline がある。

**Execution** — 担当・期限・進捗・依存・成果物を扱う層。三層はアーレント『人間の条件』の**活動・仕事・労働**の三分に着想を得ている。**Domain** は複数の人が集い関わり合う活動の場（病院 / 会社 / 作戦）。**Object** はその中で成果物として世界に残る仕事（病棟 / プロジェクト）。**Element** は Object を構成する行動の最小単位で、日々こなされる労働（患者 / タスク / 仕訳）。

**Sustainment** — 行動を支える仕事道具。Worker（human | ai_agent）が Execution で行動する主体であり、その Worker が働き続けられるよう支える道具がここに属する。

ほかに、分類に属さない個人の横断サーフェス **Home** と、Object ごとに定義して Element に値を持たせるメタデータ **Property** がある。

**Strategy と Execution は分離する。** 混ぜて一覧化すると「意図」と「行動」の区別が崩れる。ただし遮断もしない —— Initiative は配下 Object と実行上のリスク・負荷を、Object は貢献先 Initiative と戦略上の意図を常に見せる。この一クリックの往復可能性が Alcon の核。

## AI 駆動ループ

**バックログの単一情報源は盤面**（Supabase の `elements`）。外部の TODO リストを作らない。進捗・判断・失敗の訂正はすべて盤面に書き戻す —— **状態をセッションの記憶に置かない。どのセッションが落ちても、盤面から拾えば続きが回る。**

セッションを始めたら、まず盤面を見る。

| 盤面の状態 | 何をするか | 規約 |
|---|---|---|
| 着手できる Element がある | 実装 → PR → レビューゲート → マージ → 盤面へ書き戻す | [friction](./skills/friction/SKILL.md) |
| 空いている | **仕事を探さない。**架空の作戦を Alcon で実際に運用して摩擦を採る | [exercise](./skills/exercise/SKILL.md) |
| PR をレビューする | 差分・呼び出し元・検証結果で見て、マージ可否を記録する | [code-review](./skills/code-review/SKILL.md) |

次に何を作るかは、機能一覧を眺めても要望を聞いても出ない。**使えば必ず出る。** 市場投入に直接効く仕事は Initiative「Friction GTM — 市場投入」の Ends から採り、Object「Go-to-Market」に置く。

ユーザーの判断が要るもの（課金 / 不可逆 / 割れた設計判断 / 停滞）は Object「Decisions — 判断」に Element として起票し、ユーザーにアサインして、止まらずに次へ行く。

## コマンド

```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず）
cd web && npm test           # Vitest（変更後に必ず）
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

テストは `web/tests/`（Vitest / node）。対象は壊れると痛い純粋ロジックだけ —— jsonb の正規化、リストのソート、design-lint の規則とラチェット。UI のレンダリングテストは持たない。

**キー**：⌘K で CommandPalette（グローバル検索＋ナビ）。ウィジェットは長押し 450ms で arrange モード（Esc / Done で抜ける）。

## ビジュアル原則

ミニマルで静かな UI。装飾よりも情報密度。メイン領域は角丸の IslandCard で浮かせる。

- **色をハードコードしない** — デザイントークンは `shared/designTokens.ts`
- **入力フィールドに枠・リング・アウトライン禁止** — `<input>` / `<textarea>` / `[contenteditable]` に focus ring は付けない。globals.css が自動リングを一切出さないので、フォーカスの可視化は部品側の義務（背景トーンの変化で示す）。`focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで書かない
- **ラベルを CSS で全大文字にしない** — `uppercase` を使わず、書いた通り（先頭大文字）で表示する
- **「Task」と呼ばない** — 必ず「Element」。業界横断の抽象名
- **ウィジェットの枠を自作しない** — カードを足したくなったら `WIDGET_REGISTRY` に登録する。枠は `WidgetFrame`、ヘッダは `useWidgetMeta` / `WidgetHeaderAction`。専用の型・localStorage・カード UI を別経路で作らない
- **recharts を使うコンポーネントは `'use client'` 必須** — SSR 非対応

## ディレクトリ

```
Alcon/
├── web/
│   ├── src/
│   │   ├── app/                  Next.js App Router。layout / page / globals.css だけ
│   │   ├── shell/                外殻 — ModeRail / AppSidebar / TabBar / CommandPalette / MainContent / viewRegistry
│   │   ├── ActivitySpace/        盤面そのもの — 三分類 ＋ Home
│   │   │   ├── home/             Now / Inbox / My Elements / My Calendar / Profile
│   │   │   ├── strategy/         initiative / phase / timeline
│   │   │   ├── execution/        domain / object / element
│   │   │   └── sustainment/      workload / notebook / table / team / calendar / operations（CRM・SCM）
│   │   ├── Function/             盤面を成立させる仕組み。特定の概念に属さない
│   │   │   ├── widget/           widgets/ 本体 + registry.tsx（定義）+ defaults.ts（既定配置）
│   │   │   ├── property/         Object ごとの列定義と値
│   │   │   ├── copilot/          AlconCopilotPanel と Edge Function 呼び出し
│   │   │   ├── settings/
│   │   │   ├── space/            Activity Space の切替とオンボーディング
│   │   │   ├── sync/             deltaStream / explorerCache
│   │   │   └── shared/           概念をまたぐ UI とロジック（dimensions.ts / phaseWindow.ts ほか）
│   │   ├── shared/               designTokens.ts — デザイントークンの単一情報源
│   │   ├── hooks/                Supabase の CRUD はすべてここ
│   │   ├── lib/                  supabase クライアント / queryClient / utils
│   │   ├── providers/            Auth / Query / Theme
│   │   ├── auth/                 ログイン画面
│   │   ├── types/                DB とナビの型
│   │   └── ui/                   shadcn 由来のプリミティブ
│   ├── tests/                    Vitest（node 環境、純粋ロジックのみ）
│   └── scripts/                  design-lint / eslint-ratchet / unwired-lint
├── supabase/                     migrations/ と functions/（root にのみ置く）
├── ops/                          自走ループの運用スクリプト（lease / board-listen / stall-check ほか）
├── docs/                         adr/ と friction-risk-register.md
└── website/                      LP
```

## 実装ルール

1. 変更後は必ず `npx tsc --noEmit` と `npm test`
2. 新規ファイルは、盤面の面なら `ActivitySpace/<分類>/<概念>/`、それを支える仕組みなら `Function/<concept>/` 配下。横断 UI は `Function/shared/`、外殻（ModeRail / AppSidebar / TabBar / CommandPalette）は `shell/`
3. **新 view**：`viewRegistry.ts`（label/icon の単一情報源）→ `MainContent` 分岐 → `railApps.ts` の `MODE_META`。新モードを App にするなら `RailMode` / `APP_GROUPS` も
4. **新 Widget**：本体を `Function/widget/widgets/` に置き、`registry.tsx` に定義を1つ足す（`accepts` の Subject、`zones`、`load()` の動的 import）。既定配置は `defaults.ts`。既存ウィジェットを別 Subject に開放するのは `accepts` に1語足すだけ
5. **図の軸を焼き込まない** — 集計軸は `Function/shared/dimensions.ts` の `Dimension` から選ばせ、`WidgetInstance.params` に持たせる。軸違いで2つ目のウィジェットを作らない
6. **フレームワークは永続データの見せ方にする** — OKR / Gap は `intents` の measure の読み替え、任意分類の分析は Table の列・行・値、散文は Note。業界固有のデータや分析結果をコンポーネントや配置パラメータへ直書きしない
7. **Object のネスト禁止**（`parent_object_id` も `object_parents` も無い）。Element の multi-homing は `object_id` + `element_objects` の二重書き
8. Phase の `end_date` は**含む**（最終日はその Phase の稼働日）。日付を扱う処理は `Function/shared/phaseWindow.ts` を通す
9. Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）。BlockNote は使わない

## Supabase

- Project ID: `rkugtcqztkkacvoylupw`。RLS 有効で可視性は RLS が強制。CRUD は `hooks/` に集約
- AI は Edge Functions 経由（`alcon-copilot` / `run-agent` / `summarize-note` 等）
- **`supabase/` は root にのみ存在する**（migrations・functions とも）。`web/supabase/` は作らない
- **基底スキーマは migrations フォルダの外**にある。既存テーブルに触る migration は `to_regclass` ガード必須 —— PR の preview branch は空 DB に replay する

## リポジトリ直下を「旧版」として消さない

root の `vercel.json` は本番デプロイ設定そのもの（`buildCommand: cd web && …` / `outputDirectory: web/.next`）、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない（root で `npm install` すると lockfile が復活し、Next が workspace root を誤認して dev の `globals.css` が stale になる）。

## 改訂の作法 — 差分注釈ではなくモデル更新

知識・方針・用語の修正を依頼されたら、その意図を汲んで**思考（モデル）自体を上書き**する。新しい理解が最初からそうだったかのように書き直し、残骸を残さない。

- 旧概念を「禁止」「廃止」「旧称」のラベルに降格させて残さない。消すなら本当に消す
- 「X→Y に変更」「以前は X」のような差分・履歴をファイルに書かない。変更点の説明は会話で述べ、ファイルには最終状態だけを残す
- 言及された一箇所だけでなく、意図が波及する全箇所（用語・例・図・命名表）を一貫して更新し、仕上げに旧概念を grep して 0 件を確認する
- 例外：移行手順や後方互換の deprecation など、ユーザーが履歴の保持を明示した場合のみ記録する
