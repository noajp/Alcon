# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を少数概念で抽象化する Strategy & Execution SaaS。
詳細な設計思想・拡張計画は [PRODUCT.md](./PRODUCT.md) を参照。

## 概念モデル

人の営みには「消えるもの」と「残るもの」がある。会話や意図は発した瞬間から消えていき、文書や計画は形として残る。しかし実際の現場では、計画は実行と噛み合わず、議事録は議論から切り離され、タスクはそもそもの意図を失っている。

Alcon はこの変換を、揮発する活動を耐久物へ変え、それを「何を達成し、どう勝つか」と「誰を何に投入するか」に分けて構造化する。

- **Action（活動）** — 会話・議論・意思のやりとり。本質的に揮発する
- **Materialization（具体化）** — 活動から抽出された耐久的な成果物。ドキュメント・図
- **Strategy（Ends / Ways）** — 何を達成し、どう勝つか
- **Execution（Employment of Means）** — 誰／何を、どの仕事に投入して成果を作るか
- **Sustainment（Generate & Sustain Means）** — 実行手段を稼働可能に保ち、補充し、制約を管理する

上流の活動が下流の実行に至るまで文脈が切れない。これを業界語彙に依存しない少数の概念で実現する。

### Action 層 — 活動行為
消えていく活動。会話・意図・やりとりそのもの。
- **Chat**：1:1 / グループ DM（`conversations`）
- **Talk**：チャンネル制のリアルタイム会話（`channels`、コード上は `room/` モジュール）

### Materialization 層 — 具体化行為
Action の消えるやりとりを、世界に残る耐久物へ変換する。
- **Note**：ドキュメント（議事録 / メモ）
- **Diagram**：抽象を図として可視化

### Strategy 層 — Ends / Ways
目的・方針・前提・意思決定・成功条件。「何を、なぜ、どう勝つか」を扱い、担当や進捗は持たない。
- **Campaign**：複数の Object を束ね、目的単位で計画と進捗を俯瞰（`strategies` + `strategy_objects`、view id は `strategy`）
- **Phase**：努力をどの段階に配分するかの時間箱（`phases`、Domain スコープ）
- **Timeline**：Campaign の期間・シーケンスを Gantt で俯瞰

### Execution 層 — Employment of Means
戦力を実際の仕事に投入する層。担当・期限・進捗・依存関係・成果物を扱う。
- **Domain**：最上位の入れ物（病院 / 会社 / 作戦）
- **Object**：Domain 直下のフラット構造単位（病棟 / プロジェクト）
- **Element**：最小の実行単位、multi-homing 可（患者 / タスク / 仕訳）

### Sustainment 層 — Generate & Sustain Means
兵力そのものは兵站ではない。Worker は戦闘を行う主体であり、Strategy / Execution が用いる中心的な手段。Sustainment はその手段が存在し、動き、戦い続けられるように支える側を扱う（稼働・勤怠・給与・採用・育成・予算・会計・契約・購買・設備）。
- **Workload**：Worker 別の日次負荷。手段がどれだけ埋まっているかを俯瞰する独立モード

Worker エンティティは 1 つを共有し、サーフェスごとに見せる意味を変える。
- **能力・組織・配置** — Execution が用いる戦力
- **稼働・勤怠・給与・採用・育成・予算** — Sustainment
- **Campaign への人員配分の意思決定** — Strategy

### Strategy と Execution の分離
UI では Strategy と Execution を明確に分ける（ModeRail の別モード）。混ぜて一覧化すると「意図」と「投入」の区別が崩れる。ただし遮断もしない —— Campaign は配下 Object と実行上のリスク・負荷を、Object は貢献先 Campaign と戦略上の意図を常に見せる。この一クリックの往復可能性が Alcon の核。

### Home — 横断サーフェス
層に属さない個人ビュー。
- **My Elements**：自分が所有・アサインされた Element
- **Inbox**：通知フィード

### Property — 実行単位のメタデータ
Execution 層の実行単位（D/O/E）に付与される型付きメタデータ列。期限・担当・ステータス等。

## UI レイアウト

```
┌─────┬──────────┬────────────────────────────┐
│Mode │AppSide   │ TopBar + TabBar            │
│Rail │bar       ├────────────────────────────┤
│46px │          │      MainContent           │
└─────┴──────────┴────────────────────────────┘
```

- **ModeRail** (`shell/ModeRail.tsx`, 46px)：常時表示のモードセレクタ。折りたたまれない外殻の背骨。上段は固定の Home / Strategy / Execution、区切り線の下がユーザーが Apps ランチャーから追加した App と、追加用の Apps ボタン。`railModeOf(view)` が view→モードの単一情報源で、レールのハイライトと AppSidebar の中身分岐を同時に駆動する。Campaign→Object / Object→Campaign のリンクを辿ると `activeView` が変わり、レールのモードも自動で切り替わる
- **Apps ランチャー**：カタログ・モードのメタ・追加状態は `shell/railApps.ts` の単一情報源（`CORE_MODES` / `APP_GROUPS` / `MODE_META` / `useRailApps`）。グループは Tools（Notebook / Table / Team）と Sustainment（Workload）。タイルを押すとレールに追加してそのまま開く。追加済みタイルの右上に出るチェックを外すとレールから外れ、カタログに戻る。追加状態は `alcon:railApps` に localStorage 永続。追加していない App も、開いている間だけレールに現れる
- **AppSidebar**（折りたたみ可）：最上部に Space 名（`SpaceSwitcher`）＋ Discover(検索) ＋ Create(+)。本体は現在のモードに応じて切替：
  - **Home**：Inbox / Calendar / My Elements
  - **Strategy**：Campaign / Phase / Timeline
  - **Execution**：Domain ツリー（各 Domain を開くと Objects／Elements）
  - **Workload / Notebook / Table / Team**：Apps から追加する独立モード。それぞれ単一サーフェスをメインに開き、サイドバーはモード名ラベルのみ
- **TabBar**：Object 内 view 切替。`rightSlot` に view 固有コントロール
- **CommandPalette**：⌘K でグローバル検索 + ナビ
- **viewRegistry** (`shell/viewRegistry.ts`)：view id→label/icon の単一情報源

## ディレクトリ構成

```
web/src/
├── app/          # Next.js App Router (単一ページSPA)
├── alcon/        # 中核概念ごとのドメインモジュール
│   ├── domain/   # Domain
│   ├── object/   # Object
│   ├── element/  # Element + actions/ (Strategy/Resource/Inbox等)
│   ├── property/ # Property（型付きメタデータ列）
│   ├── brief/    # Note 編集
│   ├── widget/   # Widget基盤 + home/
│   ├── room/     # Talk: チャネル (Text/Voice)
│   ├── chat/     # Chat: DM / グループ
│   ├── copilot/  # AI Copilot
│   └── shared/   # alcon横断UI
├── shell/        # 外殻 (ModeRail/AppSidebar/TabBar/CommandPalette等)
├── ui/           # shadcn/ui プリミティブ
├── hooks/        # useSupabase, useAuth, useRoom 等
├── shared/       # designTokens.ts / colors / icons
└── types/        # database.ts (全DB型)
```

## データモデル要点

- Object はフラット（Domain 直下のみ、ネスト無し）。multi-homing は `object_domains`
- Element の multi-homing は `object_id` (primary FK) + `element_objects` junction 二重書き
- Property = `custom_columns`（定義）+ `custom_column_placements`（どのリストに表示するか）+ `custom_column_values`（値）。定義スコープは4択（object=ローカル / activity_space=Space ライブラリ / owner_user=個人・RLSで本人のみ / domain=Object タグ付けの別軸）。値は常に Element（domain 列のみ Object）に1つ — マルチホーム先のどのリストから見ても同じ値（Asana 型）。詳細パネルは全ホームの placement を union 表示
- Note = `notes` (folder/file ツリー) + `note_contents.html`
- Phase = `phases`（Domain スコープの期間ボックス、Linear の Cycle 相当）。Object / Element は自身の `phase_id` FK で高々1つの Phase に所属（junction なし、削除時は SET NULL）。`end_date` は含む — 最終日はその Phase の稼働日で、境界の翌日ではない（`start_date === end_date` は1日の Phase であって長さ0ではない）。日付を扱う処理は `alcon/shared/phaseWindow.ts` を通す
- Worker = human | ai_agent。`element_assignees` でアサイン
- Subelement = チェックリスト（AI は触らない）
- 境界 = 二層メンバーシップ。Space=`activity_space_members`、Domain=`domain_members`、Object=`object_members`（owner/member）。Space 非メンバーの domain_member は Guest（招かれた Domain のみ可視）
- 可視性は RLS で強制。`domains.privacy` は `workspace`（Space メンバー全員）/`private`（domain_members のみ）。SECURITY DEFINER ヘルパー `user_can_see_domain/_object/_element` が単一情報源（`get_explorer_data` も同じ判定）

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド（型検査込み）
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm test           # Vitest（純ロジックのユニットテスト。変更後に必ず実行）
cd web && npm run test:watch # Vitest watch
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

テストは `web/tests/`。ランナーは Vitest（`web/vitest.config.mts`、environment は node）。
対象は「壊れると痛い純粋ロジック」— DB jsonb の正規化、リストのソート、design-lint の
規則とラチェット。UI のレンダリングテストは持たない。テストが `src/` ではなく `tests/`
に住むのは、design-lint のフィクスチャ（`className="uppercase"` や `#ff0000` を含む文字列）
を design-lint 自身が本物の違反として拾ってしまうため。

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効。CRUD は `hooks/` に集約
- AI は Edge Functions 経由 (`alcon-copilot` / `run-agent` / `summarize-note` 等)
- **新しい migration は root の `supabase/migrations/` に置く**（`YYYYMMDDHHMMSS_name.sql`）。`web/supabase/migrations/` は 2026-04 以降凍結された分岐コピーで、`livekit-token` を独自に持つ。統合は el_QLT-006
- **基底スキーマは migrations フォルダの外**（ダッシュボード / MCP `apply_migration` で作られた）。フォルダは部分的な履歴でしかないので、既存テーブルに触る migration は `to_regclass` ガード必須 — PR の preview branch は空 DB に replay する

## 開発ルール

1. **変更後は必ず `cd web && npx tsc --noEmit` と `cd web && npm test`**
2. デザイントークンは `shared/designTokens.ts`。色ハードコード禁止
3. 新 view 追加: `viewRegistry.ts` → `MainContent` 分岐 → ModeRail のモードに属させるなら `ModeRail.tsx`（`VIEW_TO_MODE` / `RAIL_DEFAULT_VIEW`）＋ `AppSidebar` のモード分岐。新モードを App にするなら `railApps.ts`（`RailMode` / `MODE_META` / `APP_GROUPS`）
4. 新 Widget: `alcon/widget/widgets/` + `registry.ts` + `renderWidget.tsx`
5. 新規ファイルは `alcon/<concept>/` 配下。横断UI は `alcon/shared/`、外殻は `shell/`
6. 盤面（Friction の Element）から仕事を取って実装・PR・マージまで回す自走ループの規約は friction スキル（`.claude/skills/friction/SKILL.md`）
7. **次に何を作るかは、Friction で架空の作戦を実際に運用して決める。** 機能一覧を眺めても要望を聞いても出ない摩擦が、使えば必ず出る。演習の設計・観察サイクル・所見の起票・セッションをまたいだ再開の規約は exercise スキル（`.claude/skills/exercise/SKILL.md`）。**盤面が空いたらここへ戻る**

## 禁止事項・アンチパターン

- **入力フィールドに枠・リング・アウトライン禁止** — `<input>` / `<textarea>` / `[contenteditable]` に focus ring 不要。globals.css は `*:focus, *:focus-visible { outline: none }` で自動リングを一切出さない。フォーカスの可視化は部品側の義務（背景トーンの変化などで示す）。Tailwind の `focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けてはならない
- **「Task」と呼ばない** — 必ず「Element」。業界横断の抽象名
- **リポジトリ直下を「旧版」として消さない** — root の `vercel.json` は**本番デプロイ設定そのもの**（`buildCommand: cd web && …` / `outputDirectory: web/.next`）、root の `package.json` はフレームワーク検出用。`web/next.config.ts` の `turbopack.root` 固定も外さない（root で `npm install` すると lockfile が復活し、Next が workspace root を誤認して dev の `globals.css` が stale になる）
- **Object のネスト禁止** — `parent_object_id` も `object_parents` junction も廃止済
- **BlockNote 使用禁止** — Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）
- **Talk と Chat を混同しない** — Talk = チャンネル制（`channels`、コードは `room/`・`RoomView`）、Chat = DM/グループ（`conversations`）
- **recharts コンポーネントに 'use client' 必須** — SSR 非対応
- **ラベルを CSS で全大文字にしない** — メニュー項目・セクション見出し・テーブルヘッダ等で Tailwind の `uppercase` を使わない。ラベルは書いた通り（先頭大文字）で表示する

## 改訂の作法 — 差分注釈ではなくモデル更新

知識・方針・用語の修正を依頼されたら、その意図を汲んで**思考（モデル）自体を上書き**する。新しい理解が最初からそうだったかのように書き直し、残骸を残さない。

- 置き換えた旧概念を「禁止」「廃止」「旧称」等のラベルに降格させて残さない。消すなら本当に消す
- 「X→Y に変更」「以前は X」のような差分・履歴を成果物（ファイル）に書かない。変更点の説明は会話の応答で述べ、ファイルには最終状態だけを残す
- 言及された一箇所だけでなく、意図が波及する全箇所（用語・例・図・付随説明・命名表）を一貫して更新する
- 仕上げに旧概念を grep し、参照が 0 件であることを確認する
- 例外：移行手順や後方互換の deprecation など、ユーザーが履歴の保持を明示した場合のみ記録する
