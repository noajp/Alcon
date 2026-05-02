# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を「**大中小+メタ+思考+表現**」の6概念で抽象化するワークマネジメントSaaS。

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npx tsc --noEmit   # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## 中核概念モデル（6つだけ覚える）

| 概念 | 役割 | 例 |
|------|------|---|
| **Domain** | 最上位の入れ物（テナント、Asana Organization相当） | 病院 / 会社 / 作戦 |
| **Object** | 中間の構造単位（∞ネスト + multi-homing） | 病棟→科 / 部門→プロジェクト |
| **Element** | 最小の実行/記録単位（multi-homing） | 患者 / タスク / 案件 / 仕訳 |
| **Tag** | D/O/Eに付与するメタデータ（ドッグタグ） | 血液型 / 期限 / 位置 / 担当 |
| **Brief** | Note から抽出された構造化スナップショット（旧 Ticket） | overview / decisions / action_items / questions |
| **Widget** | データを表現する最小単位 | KPI / Gantt / Map / Chart |

業界横断のため業界語彙（タスク・患者）は中核に持ち込まない。
note: Subelement (チェックリスト) が Element より下に存在するが、AIによる自動生成は Element 止まり。

## Architecture（哲学整列）

```
web/src/
├── app/                # Next.js App Router (単一ページSPA)
├── alcon/              # 6概念 + room ごとのドメインモジュール
│   ├── domain/         # Domain — Switcher / DomainsView / store
│   ├── object/         # Object — Detail / Picker / overview/ / summary/
│   ├── element/        # Element — List / Detail / board/ / gantt/ / calendar/ / actions/
│   ├── tag/            # Tag — 列定義 / カスタム列セル / 編集モーダル
│   ├── brief/          # Brief + Note (BlockEditor / Notesサイドバー / documents/)
│   ├── widget/         # Widget基盤 + 各 widget + home/ (全体Dashboard)
│   ├── room/           # チャネル/メッセージ (Text/Voice channels)
│   └── shared/         # alcon横断UI (Chip/Filter/PriorityBadge等)
├── shell/              # 外殻 (AppSidebar / MainContent / TabBar / TopBar / Toolbar
│                       #       / BreadcrumbBar / LayoutToggle / AIPanel / IslandCard
│                       #       / CreateView / sidebar/ / icons/)
├── ui/                 # shadcn/ui プリミティブ
├── hooks/              # useSupabase, useDashboardData, useAuth, useNotesDb, useRoom
├── lib/                # supabase client, utils
├── providers/          # AuthProvider, ThemeProvider
├── auth/               # AuthPage
├── shared/             # designTokens.ts (CARD/STATUS/PRIORITY/FONT) / colors / icons
└── types/              # database.ts (全DB型) / navigation / notes
```

## Data Model

```
Domain (localStorage 永続。各 Object が domain_id で所属)
  └── Object (parent_object_id + object_parents で multi-homing)
        └── Element (object_id + element_objects で multi-homing)
              └── Subelement (チェックリスト、AIは触らない)

Note       ← notes (folder/file ツリー) + note_contents (BlockNote JSON)
Brief      ← briefs (Note から抽出した構造化スナップショット)
Tag        ← custom_columns + custom_column_values が前身
Widget     ← alcon/widget/ + localStorage layout
Worker     ← human | ai_agent。element_assignees でアサイン
```

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効（全テーブル）。CRUD は `hooks/useSupabase.ts` に集約
- AI: Claude API は Edge Functions 経由

## Workflow
- IMPORTANT: 変更後は必ず `npx tsc --noEmit` を実行
- デザイントークンは `shared/designTokens.ts` を参照。色をハードコードしない
- 新ビュー追加: `shell/AppSidebar` の `ICON_BAR_LAYERS` + `shell/MainContent` の条件分岐
- 新Widget追加: `alcon/widget/widgets/` に追加 + `registry.ts` + `renderWidget.tsx`
- 新規ファイルは概念ごとに `alcon/<concept>/` 配下に置く。横断UIは `alcon/shared/`、外殻は `shell/`

## Gotchas
- 「Task」ではなく「Element」。業界横断で使える抽象名
- Object内タブの `tab_type='summary'` は UI上「Dashboard」と表示される
- Calendar Day/Week ビューは `due_time` カラムを参照（'HH:MM:SS'）
- recharts は SSR 非対応。chart コンポーネントは 'use client' 必須
- Multi-homing: 単一親FK (`parent_object_id`/`object_id`) は primary parent のレガシー、junction tables (`object_parents`/`element_objects`) が真実

## Vision
将来はSAPモジュール型の独立アプリ群に展開:
Alcon SEM (現在) / Kanjo-kei (会計) / Jinji-kei (HR) / Eigyo-kei (CRM)
各モジュールは別リポ・別デプロイ。共通基盤(D/O/E + Tag + Brief + Widget + Worker + AI)を共有。
詳細: @Project/00_企画/Alcon 統合企画書 v6.md
