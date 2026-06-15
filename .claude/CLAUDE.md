# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を少数概念で抽象化する Strategy & Execution SaaS

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## 中核概念モデル

| 概念 | 役割 | 例 |
|------|------|---|
| **Domain** | 最上位の入れ物 | 病院 / 会社 / 作戦 |
| **Object** | Domain直下のフラットな構造単位 | 病棟 / 部門 / プロジェクト |
| **Element** | 最小の実行/記録単位（multi-homing） | 患者 / タスク / 案件 / 仕訳 |
| **Property** | D/O/E に付与する型付きメタデータ列  | 血液型 / 期限 / 位置 / 担当 |
| **Strategy** | 複数 Object をまたぐ目標達成計画| Q3売上目標 / 新棟開設 |
| **Note** | Apple Notes 風 HTML ドキュメント | 議事録 / メモ |

## UI 構造

縦並びレール 2 段 + メインキャンバスでナビゲーション。「常時可視ナビ + 折りたためる文脈ペイン + メインキャンバス + コマンドパレット」を踏襲。

```
┌─────┬──────────┬────────────────────────────┐
│Mode │AppSide   │ TopBar (breadcrumb / AI)   │
│Rail │bar       ├────────────────────────────┤
│40px │My        │ TabBar (Object 内 view 切替)│
│     │Action    ├────────────────────────────┤
│Home │Execution │                            │
│Room │+ Domain  │      MainContent           │
│Chat │ Tree     │   (activeView で切替)      │
│Note │          │                            │
│Sea/ │          │                            │
│Set  │          │                            │
└─────┴──────────┴────────────────────────────┘
```

- **ModeRail** (`shell/ModeRail.tsx`)：左端 40px の縦アイコンレール。Home / Room / Chat / Note を常時可視、下部に Discover / Settings。AppSidebar を畳んでも残る。
- **AppSidebar** (`shell/AppSidebar.tsx`)：折りたたみ可能。3 セクション + Domain Tree。
  - `My`：My Elements / Inbox
  - `Action Space`：Strategy（目標と能力配分）
  - `Execution Space`：Objects（=projects view id）/ Elements（=mytasks view id）
- **CommandPalette** (`shell/CommandPalette.tsx`)：⌘K / Ctrl+K でグローバル検索 + ナビ。Element / Object / Note を横断検索。
- **TabBar** (`shell/TabBar.tsx`)：Object 内 view tabs (Dashboard / List / Overview / Gantt / Calendar / Workers / Resource / Board / CustomView / Note)。右端 `rightSlot` に view 固有コントロール（Filter / Display）を流し込む。
- **viewRegistry** (`shell/viewRegistry.ts`)：activity-view の id→label/icon の単一情報源。AppSidebar / WindowTabBar / CommandPalette はすべてここから引く。
- **IslandCard** (`shell/IslandCard.tsx`)：メイン領域を囲む角丸カードシェル。

## Action Space（Strategy / Resource）

Object/Element の「実行」ではなく、目標と能力配分の俯瞰を担う層。

- **Strategy**（`alcon/element/actions/StrategyShell.tsx`）：DB の `strategies` テーブルが本体。`strategy_objects` junction で複数 Object をぶら下げる Domain 横断エンティティ。Shell 内タブ：
  - `Strategy`：参加 Object の List / Grid 表示
  - `Timeline`：Strategy 配下 Object の期間 / マイルストーン Gantt（`StrategyTimelineView`）
  - `Resource`：参加 Worker の日次負荷
- **Resource**（`alcon/element/actions/ResourceView.tsx`）：Asana 風の Worker × 日次積上げ面グラフ。Worker ごとの assigned hours/day を SVG で描画。Standalone（Action Space）/ Object Detail / Domain Detail に同一コンポーネントを埋め込める（`scopeOverride` で切替、`hideHeader` / `hideFilter` で UI 抑止）。

## Architecture

```
web/src/
├── app/                # Next.js App Router (単一ページSPA)
├── alcon/              # 中核概念ごとのドメインモジュール
│   ├── domain/         # Domain — Switcher / DomainsView / store
│   ├── object/         # Object — DomainView / ObjectDetailView / Picker / overview/ / summary/
│   ├── element/        # Element — List / Detail / board/ / gantt/ / calendar/
│   │   └── actions/    # Action Space ビュー群（StrategyShell / ResourceView / InboxView / MyElementsView / ElementsListView / NotesView / ActionsView）
│   ├── tag/            # Property（旧称 Tag）— 列定義 / カスタム列セル / EditPropertyModal
│   ├── brief/          # Note 編集 + Brief 抽出 (PageView / editor / NotesSidebar / documents/)
│   ├── widget/         # Widget基盤 + 各 widget + home/ (全体Dashboard)
│   ├── room/           # チャネル/メッセージ (Text/Voice channels)
│   ├── chat/           # 1:1 / グループ DM
│   ├── copilot/        # AI Copilot
│   ├── reference/      # Reference（社内 wiki 的）
│   ├── settings/       # Domain / Team 設定
│   └── shared/         # alcon横断UI (Chip / Filter / PriorityBadge 等)
├── shell/              # 外殻 — ModeRail / AppSidebar / MainContent / TabBar / WindowTabBar /
│                       #        CommandPalette / IslandCard / CreateView / DiscoverModal /
│                       #        sidebar/ (NavIcons, ObjectTree) / icons/ / viewRegistry.ts
├── ui/                 # shadcn/ui プリミティブ
├── hooks/              # useSupabase, useDashboardData, useAuth, useNotesDb, useRoom
├── lib/                # supabase client, utils
├── providers/          # AuthProvider, ThemeProvider
├── auth/               # AuthPage
├── shared/             # designTokens.ts (CARD/STATUS/PRIORITY/FONT) / colors / icons
└── types/              # database.ts (全DB型) / navigation / notes
```

## Data Model
Domain (localStorage 永続。各 Object / Strategy が domain_id で所属)
  ├── Object (フラット — Domain 直下のみ、ネストなし)
  │     └── Element (object_id + element_objects で multi-homing)
  │           └── Subelement (チェックリスト、AIは触らない)
  └── Strategy (strategies)
        └── Object (strategy_objects junction で複数 Object 参加)

Property   ← custom_columns + custom_column_values（旧 Tag）
Note       ← notes (folder/file ツリー) + note_contents.html (Apple Notes 風 HTML)
Worker     ← human | ai_agent。element_assignees でアサイン
```

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効（全テーブル）。CRUD は `hooks/useSupabase.ts` に集約
- AI: Claude API は Edge Functions 経由

## Workflow
- IMPORTANT: 変更後は必ず `cd web && npx tsc --noEmit` を実行
- デザイントークンは `shared/designTokens.ts` を参照。色をハードコードしない
- 新ビュー追加：`shell/viewRegistry.ts` に id / label / icon を追加 → `AppSidebar` のセクション + `MainContent` の switch 分岐 + 必要なら `CommandPalette` の NAV_COMMANDS に登録
- 新Widget追加：`alcon/widget/widgets/` に追加 + `registry.ts` + `renderWidget.tsx`
- 新規ファイルは概念ごとに `alcon/<concept>/` 配下。横断UIは `alcon/shared/`、外殻は `shell/`

## Gotchas
- **入力フィールドに枠・リング・アウトラインを付けることは厳禁**（`<input>` / `<textarea>` / `[contenteditable]` にはfocus ring不要。globals.css は「デフォルト無し、`button`/`a`/`role=button` 等のみ ring 付与」のホワイトリスト方式。Tailwind の `focus:ring-*` `focus:border-*` `focus-visible:outline-*` `focus-visible:ring-*` を新規コードで付けてはならない）
- AppSidebar の `projects` view id は UI 上「Objects」と表示（`mytasks` は「Elements」）。`viewRegistry.ts` が単一情報源
- Object 内タブの `tab_type='summary'` は UI 上「Dashboard」と表示
- Calendar Day/Week ビューは `due_time` カラム参照（'HH:MM:SS'）
- recharts は SSR 非対応。chart コンポーネントは 'use client' 必須
- Object はフラット (Domain 直下のみ) — `parent_object_id` 列も `object_parents` junction も廃止済 (2026-05-06 マイグレーション)。`AlconObjectWithChildren.children` は互換のため残るが常に `[]`
- Element の multi-homing は引き続き `object_id` (primary FK) + `element_objects` junction の二重書き

## Vision
将来はSAPモジュール型の独立アプリ群に展開:
Alcon SEM (現在) / Kanjo-kei (会計) / Jinji-kei (HR) / Eigyo-kei (CRM)
各モジュールは別リポ・別デプロイ。共通基盤(D/O/E + Property + Strategy + Widget + Worker + AI)を共有。
詳細: @Project/00_企画/Alcon 統合企画書 v6.md
