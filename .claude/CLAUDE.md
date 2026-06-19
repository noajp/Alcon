# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を少数概念で抽象化する Strategy & Execution SaaS。
詳細な設計思想・拡張計画は [PRODUCT.md](./PRODUCT.md) を参照。

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## 概念モデル

Alcon は「構造単位 (Object)」と「構造の最小単位 (Element)」という業界非依存の抽象を提供する。
この概念を機能化したものが以下の 3 層構成：

### Action 層 — Strategy
Execution 層を包含するフォルダ的存在。意図・戦略・可視化といった**抽象的活動**を支援する。
- Strategy は複数の Object を束ね、目標達成の計画と進捗を俯瞰する
- Timeline / Resource などの可視化ビューを持つ

### Execution 層 — Domain / Object / Element
Action 層の計画が**実際の実行単位**になったものを格納・管理する機能群。
- **Domain**：最上位の入れ物（病院 / 会社 / 作戦）
- **Object**：Domain 直下のフラット構造単位（病棟 / プロジェクト）
- **Element**：最小の実行単位、multi-homing 可（患者 / タスク / 仕訳）

### Property — 実行単位のメタデータ
Execution 層の実行単位（D/O/E）に付与される型付きメタデータ列。期限・担当・ステータス等。

### 活動支援機能 — Note / Chat / Room
ユーザーの活動的行動を支える機能群。
- **Note**：Apple Notes 風 HTML ドキュメント（議事録 / メモ）
- **Room**：チャンネル制メッセージング（`channels`）
- **Chat**：1:1 / グループ DM（`conversations`）

## UI レイアウト

```
┌─────┬──────────┬────────────────────────────┐
│Mode │AppSide   │ TopBar + TabBar            │
│Rail │bar       ├────────────────────────────┤
│40px │          │      MainContent           │
└─────┴──────────┴────────────────────────────┘
```

- **ModeRail**（40px）：Home / Room / Chat / Note / Discover / Settings
- **AppSidebar**（折りたたみ可）：My / Action Space / Execution Space + Domain Tree
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
│   ├── room/     # チャネル (Text/Voice)
│   ├── chat/     # DM / グループ
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

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効。CRUD は `hooks/` に集約
- AI は Edge Functions 経由 (`alcon-copilot` / `run-agent` / `summarize-note` 等)

## 開発ルール

1. **変更後は必ず `cd web && npx tsc --noEmit`**
2. デザイントークンは `shared/designTokens.ts`。色ハードコード禁止
3. 新 view 追加: `viewRegistry.ts` → `AppSidebar` nav + `MainContent` 分岐
4. 新 Widget: `alcon/widget/widgets/` + `registry.ts` + `renderWidget.tsx`
5. 新規ファイルは `alcon/<concept>/` 配下。横断UI は `alcon/shared/`、外殻は `shell/`

## 禁止事項・アンチパターン

- **入力フィールドに枠・リング・アウトライン禁止** — `<input>` / `<textarea>` / `[contenteditable]` に focus ring 不要。globals.css はホワイトリスト方式（button/a/role=button のみ ring）。Tailwind の `focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けてはならない
- **「Task」と呼ばない** — 必ず「Element」。業界横断の抽象名
- **Object のネスト禁止** — `parent_object_id` も `object_parents` junction も廃止済
- **BlockNote 使用禁止** — Note エディタは独自 `AppleNoteEditor`（HTML + `htmlSanitizer`）
- **Room と Chat を混同しない** — Room = チャンネル制（`channels`）、Chat = DM/グループ（`conversations`）
- **recharts コンポーネントに 'use client' 必須** — SSR 非対応

## 地雷ポイント

- Object内タブ `tab_type='summary'` → UI上「Dashboard」表示
- Calendar Day/Week は `due_time`（'HH:MM:SS'）参照
- `craft/` ディレクトリは孤児だが将来再追加予定。削除禁止
