# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を少数概念で抽象化する Strategy & Execution SaaS。
詳細な設計思想・拡張計画は [PRODUCT.md](./PRODUCT.md) を参照。

## 概念モデル

人の営みには「消えるもの」と「残るもの」がある。会話や意図は発した瞬間から消えていき、文書や計画は形として残る。しかし実際の現場では、計画は実行と噛み合わず、議事録は議論から切り離され、タスクはそもそもの意図を失っている。

Alcon はこの変換を、3 層のカスケードで構造化する。

- **Activity（活動）** — 会話・議論・意思のやりとり。本質的に揮発する。
- **Materialization（具体化）** — 活動から抽出された耐久的な成果物。ドキュメント・計画・図。
- **Execution（実行）** — 成果物を実行単位として格納し、進捗・責任・状態を追跡する。

上流の活動が下流の実行に至るまで文脈が切れない。これを業界語彙に依存しない少数の概念で実現する。

### Activity 層 — 活動行為
消えていく活動。会話・意図・やりとりそのもの。
- **Chat**：1:1 / グループ DM（`conversations`）
- **Talk**：チャンネル制のリアルタイム会話（`channels`、コード上は `room/` モジュール）

### Materialization 層 — 具体化行為
Activity の消えるやりとりを、世界に残る耐久物へ変換する。
- **Note**：ドキュメント（議事録 / メモ）
- **Strategy**：複数の Object を束ね、計画と進捗を俯瞰。Timeline / Resource ビューを持つ
- **Diagram**：抽象を図として可視化

### Execution 層 — 実行行為
成果物を実際の実行単位として格納・管理する。
- **Domain**：最上位の入れ物（病院 / 会社 / 作戦）
- **Object**：Domain 直下のフラット構造単位（病棟 / プロジェクト）
- **Element**：最小の実行単位、multi-homing 可（患者 / タスク / 仕訳）

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
│38px │          │      MainContent           │
└─────┴──────────┴────────────────────────────┘
```

- **ModeRail**（38px）：層セレクタ。Home / A / M / E（Activity / Materialization / Execution）＋ 下部に Discover / Settings
- **AppSidebar**（折りたたみ可）：最上部に Space 名（`SpaceSwitcher`）＋ 6ドットのアプリランチャー（`LayerAppLauncher`）。本体は現在の層に応じて切替（Home=My項目 / Activity=Chat・Talkパネル / Materialization=Noteツリー or 項目 / Execution=Domain Tree＋Data＋Reference）
- **LayerAppLauncher**：6ドットを押すと現在の層のアプリをグリッドで切替。アプリが1つのサーフェスに収まる層（Home / Execution）は中身を出さない（ボタンは整列のため残す）
- **layers** (`shell/layers.ts`)：層 id→文字/ラベル/アプリ、`layerOf(view)` の単一情報源
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
│   ├── tag/      # Property (旧称 Tag)
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
- Property = `custom_columns` + `custom_column_values`
- Note = `notes` (folder/file ツリー) + `note_contents.html`
- Worker = human | ai_agent。`element_assignees` でアサイン
- Subelement = チェックリスト（AI は触らない）
- 境界 = 二層メンバーシップ。Space=`activity_space_members`、Domain=`domain_members`、Object=`object_members`（owner/member）。Space 非メンバーの domain_member は Guest（招かれた Domain のみ可視）
- 可視性は RLS で強制。`domains.privacy` は `workspace`（Space メンバー全員）/`private`（domain_members のみ）。SECURITY DEFINER ヘルパー `user_can_see_domain/_object/_element` が単一情報源（`get_explorer_data` も同じ判定）

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効。CRUD は `hooks/` に集約
- AI は Edge Functions 経由 (`alcon-copilot` / `run-agent` / `summarize-note` 等)

## 開発ルール

1. **変更後は必ず `cd web && npx tsc --noEmit`**
2. デザイントークンは `shared/designTokens.ts`。色ハードコード禁止
3. 新 view 追加: `viewRegistry.ts` → `MainContent` 分岐 → 層に属させるなら `layers.ts`（ランチャー/層判定）＋ `AppSidebar` 本体
4. 新 Widget: `alcon/widget/widgets/` + `registry.ts` + `renderWidget.tsx`
5. 新規ファイルは `alcon/<concept>/` 配下。横断UI は `alcon/shared/`、外殻は `shell/`

## 禁止事項・アンチパターン

- **入力フィールドに枠・リング・アウトライン禁止** — `<input>` / `<textarea>` / `[contenteditable]` に focus ring 不要。globals.css はホワイトリスト方式（button/a/role=button のみ ring）。Tailwind の `focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けてはならない
- **「Task」と呼ばない** — 必ず「Element」。業界横断の抽象名
- **Object のネスト禁止** — `parent_object_id` も `object_parents` junction も廃止済
- **BlockNote 使用禁止** — Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）
- **Talk と Chat を混同しない** — Talk = チャンネル制（`channels`、コードは `room/`・`RoomView`）、Chat = DM/グループ（`conversations`）
- **recharts コンポーネントに 'use client' 必須** — SSR 非対応

## 改訂の作法 — 差分注釈ではなくモデル更新

知識・方針・用語の修正を依頼されたら、その意図を汲んで**思考（モデル）自体を上書き**する。新しい理解が最初からそうだったかのように書き直し、残骸を残さない。

- 置き換えた旧概念を「禁止」「廃止」「旧称」等のラベルに降格させて残さない。消すなら本当に消す
- 「X→Y に変更」「以前は X」のような差分・履歴を成果物（ファイル）に書かない。変更点の説明は会話の応答で述べ、ファイルには最終状態だけを残す
- 言及された一箇所だけでなく、意図が波及する全箇所（用語・例・図・付随説明・命名表）を一貫して更新する
- 仕上げに旧概念を grep し、参照が 0 件であることを確認する
- 例外：移行手順や後方互換の deprecation など、ユーザーが履歴の保持を明示した場合のみ記録する
