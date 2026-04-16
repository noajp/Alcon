# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。戦略(OKR)から実行(Element)まで一気通貫で管理するSaaS。

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npm run type-check # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## Architecture
```
web/src/
├── app/            # App Router (単一ページSPA)
├── components/
│   ├── ui/         # shadcn/ui
│   ├── layout/     # AppSidebar, MainContent, TabBar
│   ├── overview/   # OKR (Objective → Key Result → Object)
│   ├── home/       # 全体Dashboard
│   ├── summary/    # Object内Dashboard (タブ)
│   ├── blueprint/  # 思考キャンバス (Thought/Action cards)
│   ├── gantt/      # ガントチャート
│   ├── calendar/   # 月間カレンダー
│   └── elements/   # スプレッドシートビュー
├── hooks/          # useSupabase, useObjectives, useDashboardData
├── shared/         # designTokens.ts (STATUS/PRIORITY/FONT定数)
└── types/          # database.ts (全DB型定義)
```

## Data Model (3層 + 目標層)
- **Objectives** → Key Results → Objects にリンク (OKR)
- **Objects** → `parent_object_id` で無限ネスト
- **Elements** → status/priority/due_date/assignees。Objectの中の作業単位
- **Workers** → `type: 'human' | 'ai_agent'`。element_assigneesでアサイン

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効（全テーブル）。CRUD は `hooks/useSupabase.ts` に集約
- AI: Claude API は Edge Functions 経由

## Workflow
- IMPORTANT: 変更後は必ず `npm run type-check` を実行
- デザイントークンは `shared/designTokens.ts` を参照。色をハードコードしない
- 新ビュー追加: AppSidebar の `ICON_BAR_LAYERS` + MainContent の条件分岐
- 新タブ追加: TabBar の `TAB_OPTIONS` + MainContent の ObjectDetailView 内

## Gotchas
- 「Task」ではなく「Element」。業界横断で使える抽象名
- Object内タブの `tab_type='summary'` は UI上「Dashboard」と表示される
- OverviewView は OKR ページ。Object一覧ではない
- recharts は SSR 非対応。chart コンポーネントは 'use client' 必須

## Vision
将来はSAPモジュール型の独立アプリ群に展開:
Alcon SEM (現在) / Kanjo-kei (会計) / Jinji-kei (HR) / Eigyo-kei (CRM)
各モジュールは別リポ・別デプロイ。共通基盤(Object/Element/Worker/AI)を共有。
詳細: @Project/00_企画/Alcon 統合企画書 v6.md
