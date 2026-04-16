# Alcon

> **Alcon = All Context**
> すべての文脈を統合し、人間とAIが同じ地図で動く基盤

> AI駆動型 Strategy Execution Manager

**重要な視点**: このツールは「開発者が組織を作る」のではなく、「ユーザーが自分の組織構造を自由に構築し、プロジェクトを管理する」ためのもの。設計時は常に俯瞰して抽象化し、特定のユースケースに縛られない柔軟性を持たせること。

---

## 哲学: ハンナ・アーレント「人間の条件」

| 概念 | Alconの対応 |
|------|------------|
| **活動 (Action)** | Overview — OKR/目標の合意と方向づけ |
| **仕事 (Work)** | Object — 構造の設計と入れ子 |
| **労働 (Labor)** | Elements — 実行の標準化 |

> 「労働を標準化し、人間を創造と活動に解放する」

---

## 技術スタック

- **Frontend**: Next.js 16 (App Router, Turbopack)
- **UI**: Tailwind CSS, shadcn/ui, recharts
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **AI**: Claude API via Supabase Edge Functions
- **Deployment**: Vercel
- **Supabase Project ID**: `rkugtcqztkkacvoylupw`

## Commands
```bash
npm run dev          # 開発サーバー
npm run build        # 本番ビルド
npm run type-check   # TypeScript型チェック
npm run lint         # ESLint
npm test             # Vitest
```

## Code Style
- **TypeScript**: Strict typing. Never use `any`. `?.` and `??` over null checks.
- **React**: Functional Components, Hooks. PascalCase files. Destructure props.
- **Tailwind**: utility classes > inline styles. `clsx`/`tailwind-merge` for conditional.
- **Async**: Always `async/await`.

## Architecture
```
web/src/
├── app/           # App Router pages
├── components/
│   ├── ui/        # shadcn/ui (button, card, dialog, etc.)
│   ├── layout/    # AppSidebar, MainContent, TabBar, BreadcrumbBar
│   ├── overview/  # OverviewView (OKR)
│   ├── home/      # HomeView (Dashboard)
│   ├── blueprint/ # BlueprintBoard, ActionCard, ThoughtCard
│   ├── summary/   # SummaryView (Object Dashboard tab)
│   ├── gantt/     # GanttView
│   ├── calendar/  # CalendarView
│   ├── elements/  # ElementTableRow, SheetTabBar, PropertiesPanel
│   └── views/     # MyTasksView, ActionsView
├── hooks/         # useSupabase, useObjectives, useDashboardData, useAuth
├── types/         # database.ts (all DB types)
├── shared/        # designTokens.ts
└── lib/           # supabase client, utils
```

## 3層 + 目標層

| 層 | テーブル | 説明 |
|---|---|---|
| **Objectives** | `objectives`, `objective_links` | OKR。Objective → Key Result → Object にリンク |
| **Object** | `objects` | 入れ子構造単位。`parent_object_id` で無限ネスト |
| **Elements** | `elements` | 最小作業単位。status/priority/due_date/assignees |
| **Subelements** | `subelements` | チェックリスト項目 |

### Workers
`workers` テーブル: `type = 'human' | 'ai_agent'`。`element_assignees` でElementにアサイン。

## ビュー体系

### トップレベル（サイドバー）
- `home` → HomeView (Dashboard)
- `overview` → OverviewView (OKR)
- `blueprint` → BlueprintBoard
- `projects` → ObjectTree + ObjectDetailView
- `mytasks` → MyTasksView

### Objectタブ（「+」で追加）
- `elements` → スプレッドシート
- `summary` → Dashboard (recharts)
- `gantt` → ガントチャート
- `calendar` → 月間カレンダー
- `workers` → ワーカー管理

## 将来ビジョン: Alcon モジュール群（SAPモデル）
SAPの独立モジュール（FI/CO, HR, SD...）のように、業務領域ごとに**別アプリ・別リポジトリ・別デプロイ**で展開。
共通基盤（Auth / Object / Element / Worker / AI Engine）を共有し、データが自然に繋がる。
- **Alcon SEM** (Strategy Execution Manager) ← 現在開発中
- **Kanjo-kei** (勘定系 — 会計/ERP) ← 将来モジュール
- **Jinji-kei** (人事系 — HR) ← 将来モジュール
- **Eigyo-kei** (営業系 — CRM) ← 将来モジュール
- **Kaihatsu-kei** (開発系 — DevOps) ← 将来モジュール
詳細: `Project/00_企画/Alcon 統合企画書 v6.md`
