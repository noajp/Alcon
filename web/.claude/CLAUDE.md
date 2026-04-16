# Alcon — AI-driven Strategy Execution Manager

Next.js 16 + Supabase + Tailwind CSS + recharts。あらゆる業務を「**大中小+メタ+思考+表現**」の6概念で抽象化するワークマネジメントSaaS。

## Commands
```bash
cd web && npm run dev        # 開発サーバー (port 3000)
cd web && npm run build      # 本番ビルド
cd web && npm run type-check # 型チェック（変更後に必ず実行）
cd web && npm run lint       # ESLint
npx vercel --prod            # 本番デプロイ
```

## 中核概念モデル（6つだけ覚える）

| 概念 | 役割 | 例 |
|------|------|---|
| **System** | 最上位の入れ物（テナント） | 病院 / 会社 / 作戦 |
| **Object** | 中間の構造単位（∞ネスト + multi-homing） | 病棟→科 / 部門→プロジェクト |
| **Element** | 最小の実行/記録単位（multi-homing） | 患者 / タスク / 案件 / 仕訳 |
| **Tag** | S/O/Eに付与するメタデータ（ドッグタグ） | 血液型 / 期限 / 位置 / 担当 |
| **Ticket** | 思考の塊（戦略・議論・判断） | BluePrintカード / Notes |
| **Widget** | データを表現する最小単位 | KPI / Gantt / Map / Chart |

業界横断のため業界語彙（タスク・患者）は中核に持ち込まない。

## Architecture
```
web/src/
├── app/            # App Router (単一ページSPA)
├── components/
│   ├── ui/         # shadcn/ui
│   ├── layout/     # AppSidebar, MainContent, TabBar
│   ├── overview/   # Object Overview (Asana風)
│   ├── home/       # 全体Dashboard
│   ├── summary/    # Object内Dashboard (タブ)
│   ├── widgets/    # Widget基盤 (Grid/Card/Registry/各種widget)
│   ├── blueprint/  # Ticket可視化 (Thought/Action cards)
│   ├── gantt/      # ガントチャート
│   ├── calendar/   # 月/週/日カレンダー
│   └── elements/   # スプレッドシートビュー
├── hooks/          # useSupabase, useDashboardData
├── shared/         # designTokens.ts (CARD/STATUS/PRIORITY/FONT)
└── types/          # database.ts (全DB型定義)
```

## Data Model

```
System (現状はトップObjectで代用)
  └── Object (parent_object_id + object_parents で multi-homing)
        └── Element (object_id + element_objects で multi-homing)
              └── Subelement (チェックリスト)

Tag        ← custom_columns + custom_column_values が前身
Ticket     ← documents (Notes) + BluePrint cards
Widget     ← components/widgets/ + localStorage layout
Worker     ← human | ai_agent。element_assignees でアサイン
```

## Supabase
- Project ID: `rkugtcqztkkacvoylupw`
- RLS有効（全テーブル）。CRUD は `hooks/useSupabase.ts` に集約
- AI: Claude API は Edge Functions 経由

## Workflow
- IMPORTANT: 変更後は必ず `npm run type-check` を実行
- デザイントークンは `shared/designTokens.ts` を参照。色をハードコードしない
- 新ビュー追加: AppSidebar の `ICON_BAR_LAYERS` + MainContent の条件分岐
- 新Widget追加: `widgets/widgets/` に追加 + `registry.ts` + `renderWidget.tsx`

## Gotchas
- 「Task」ではなく「Element」。業界横断で使える抽象名
- Object内タブの `tab_type='summary'` は UI上「Dashboard」と表示される
- Calendar Day/Week ビューは `due_time` カラムを参照（'HH:MM:SS'）
- recharts は SSR 非対応。chart コンポーネントは 'use client' 必須
- Multi-homing: 単一親FK (`parent_object_id`/`object_id`) は primary parent のレガシー、junction tables (`object_parents`/`element_objects`) が真実

## Vision
将来はSAPモジュール型の独立アプリ群に展開:
Alcon SEM (現在) / Kanjo-kei (会計) / Jinji-kei (HR) / Eigyo-kei (CRM)
各モジュールは別リポ・別デプロイ。共通基盤(S/O/E + Tag + Ticket + Widget + Worker + AI)を共有。
詳細: @Project/00_企画/Alcon 統合企画書 v6.md
