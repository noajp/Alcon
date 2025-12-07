# Alcon - AI-Powered Organizational Work Management Platform

## Project Vision

Alconは、人間とAIエージェントを包括的に管理し、組織の仕事を円滑に進めるためのプラットフォームです。

**重要な視点**: このツールは「開発者が組織を作る」のではなく、「ユーザーが自分の組織構造を自由に構築し、プロジェクトを管理する」ためのものです。設計時は常に俯瞰して抽象化し、特定のユースケースに縛られない柔軟性を持たせること。

---

## Core Concepts

### 1. 組織構造（Organization Structure）

ファイルシステムのメタファーで考える：

```
📁 Organization Unit (type: folder)
   ├── 📁 Organization Unit (type: folder)
   │   ├── 📂 Organization Unit (type: execute) ← タスク実行可能
   │   └── 📂 Organization Unit (type: execute)
   └── 📁 Organization Unit (type: folder)
       └── 📂 Organization Unit (type: execute)
```

- **Folder型**: 階層構造を作る。タスクは直接持てない。子ユニットを内包できる。
- **Execute型**: 実行単位。プロジェクト・タスクを持てる。ワーカー（人間・AI）が所属。

これにより、ユーザーは自由に：
- 「本部」「部」「課」「チーム」など任意の階層を作成
- 組織再編時に部門ごと移動
- フラットな構造も深い階層も自在に表現

### 2. ワーカー（Workers）

タスクを実行する主体。人間とAIを同列に扱う：

```
Worker
├── Human Worker (従来の「メンバー」)
└── AI Agent Worker (自律的に動くAI)
```

両者に共通する属性：
- 名前、役割、スキル
- 担当タスク、稼働状況
- パフォーマンスメトリクス

### 3. タスク管理（Work Graph Model）

#### コンテナモデルの問題

従来のツールは「1対1」の関係でデータを管理する（コンテナモデル）：
- タスクは1つのプロジェクトのみ
- プロジェクトは1つのチームのみ
- これでは部門横断コラボレーションが構造的に表現できない

#### 解決策：1対多の関係

```
Task
├── Primary: Section → Project → Execute Unit (主担当)
├── Contributors: [Execute Unit, Execute Unit, ...] (協力チーム)
├── Dependencies: [Task, Task, ...] (依存タスク)
└── Goals: [Goal, ...] (紐づく目標)

Project
├── Owner: Execute Unit (主担当)
├── Participants: [Execute Unit, ...] (参加チーム)
└── Portfolio: [Portfolio, ...] (所属ポートフォリオ)
```

#### データ構造

```sql
-- タスクの複数コンテキスト
task_links (
  task_id UUID,
  target_type TEXT,    -- 'unit' | 'worker' | 'goal'
  target_id UUID,
  role TEXT            -- 'owner' | 'contributor' | 'reviewer' | 'blocker'
)

-- プロジェクトの複数コンテキスト
project_links (
  project_id UUID,
  target_type TEXT,    -- 'unit' | 'goal' | 'portfolio'
  target_id UUID,
  relationship TEXT    -- 'owns' | 'contributes' | 'depends_on'
)

-- タスク間の依存関係
task_dependencies (
  task_id UUID,
  depends_on_task_id UUID,
  dependency_type TEXT  -- 'blocks' | 'requires' | 'related'
)
```

#### これで解決される問題

| 従来の問題 | 解決策 |
|-----------|--------|
| タスクは1チームのみ | `task_links`で複数チームが関与可能 |
| プロジェクトは1チームのみ | `project_links`で複数チーム参加可能 |
| 部門間の依存が見えない | `task_dependencies` + AIが自動検出 |
| 誰が何に関わってるか不明 | `role`で関係性を明示 |
| 目標との紐付けがない | `target_type: 'goal'`で接続 |

AIが自動検出する要素：
- 部門間の隠れた依存関係
- ボトルネックとなっているタスク
- リスク予測
- 最適なワーカー（人間・AI）のアサイン提案

---

## Design Principles

### UI/UX

- **テーマ**: Supabase Dashboard inspired dark theme
- **カラー**: モノクロベース（#171717, #1c1c1c）、白/グレーのアクセントのみ
- **レイアウト**: VSCode-like（ActivityBar + Sidebar + MainContent）
- **ロゴ**: シンプルに「Alcon」テキスト表示

### 抽象化の原則

1. **特定の組織形態を前提としない**
   - 「部」「課」などの固定概念ではなく、ユーザーが自由に命名
   - 階層の深さに制限を設けない

2. **ワーカーの種類を区別しすぎない**
   - 人間もAIも「タスクを実行する主体」として統一的に扱う
   - 将来的に新しいタイプのワーカーが追加されても対応可能

3. **データモデルの柔軟性**
   - メタデータ、タグ、カスタムフィールドで拡張可能に

---

## Technical Architecture

### Stack

- **Frontend**: Next.js 16 (App Router, Turbopack)
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
- **Deployment**: Vercel
- **AI**: Claude API via Supabase Edge Functions (Tool Use)

### Database Schema (Target)

```sql
-- 統一された組織単位
organization_units (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  parent_id UUID REFERENCES organization_units(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'folder' | 'execute'
  color TEXT,
  description TEXT,
  order_index INTEGER,
  created_at, updated_at
)

-- 統一されたワーカー（人間とAIを同列に）
workers (
  id UUID PRIMARY KEY,
  organization_unit_id UUID REFERENCES organization_units(id),  -- execute型に所属
  type TEXT NOT NULL,  -- 'human' | 'ai_agent'
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,          -- human only
  avatar_url TEXT,
  ai_model TEXT,       -- ai_agent only
  ai_config JSONB,     -- ai_agent only
  status TEXT,         -- 'active' | 'inactive' | 'busy'
  created_at, updated_at
)

-- プロジェクト（execute型のorg_unitが主担当）
projects (
  id UUID PRIMARY KEY,
  owner_unit_id UUID REFERENCES organization_units(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT,
  created_at, updated_at
)

-- プロジェクトの複数コンテキスト（部門横断）
project_links (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  target_type TEXT NOT NULL,  -- 'unit' | 'goal' | 'portfolio'
  target_id UUID NOT NULL,
  relationship TEXT,          -- 'contributes' | 'depends_on' | 'supports'
  created_at
)

-- セクション
sections (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  name TEXT NOT NULL,
  order_index INTEGER,
  created_at, updated_at
)

-- タスク
tasks (
  id UUID PRIMARY KEY,
  section_id UUID REFERENCES sections(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,         -- 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'
  priority TEXT,       -- 'low' | 'medium' | 'high' | 'urgent'
  assignee_id UUID REFERENCES workers(id),
  due_date DATE,
  estimated_hours NUMERIC,
  actual_hours NUMERIC,
  order_index INTEGER,
  created_at, updated_at
)

-- タスクの複数コンテキスト（部門横断コラボレーション）
task_links (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  target_type TEXT NOT NULL,  -- 'unit' | 'worker' | 'goal'
  target_id UUID NOT NULL,
  role TEXT,                  -- 'contributor' | 'reviewer' | 'blocker' | 'watcher'
  created_at
)

-- タスク間の依存関係
task_dependencies (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  depends_on_task_id UUID REFERENCES tasks(id),
  dependency_type TEXT,  -- 'blocks' | 'requires' | 'related'
  created_at
)

-- 目標
goals (
  id UUID PRIMARY KEY,
  company_id UUID REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status TEXT,
  created_at, updated_at
)
```

### Current Schema (Legacy - Migration Needed)

現在は `departments` と `teams` が分離している。上記の統一スキーマへのマイグレーションが必要。

---

## AI Integration

### Edge Functions

1. **validate-task**: タスク作成前の重複・競合チェック
2. **analyze-change**: タスク変更時の影響分析

### Tool Use Pattern

Edge FunctionsでClaude APIのTool Useを活用：
- DBからコンテキスト情報を取得
- AIが分析・判断
- 構造化された結果を返却

### Future AI Agents

- **Dependency Analyzer**: 部門間の隠れた依存関係を自動検出
- **Risk Detector**: ブロッカーの連鎖を予測
- **Workload Balancer**: ワーカー（人間・AI）の負荷を最適化提案
- **Auto-Assigner**: タスクを最適なワーカーに自動アサイン

---

## Key Features

### Implemented

- [x] 組織階層表示（Sidebar）
- [x] プロジェクト・タスク管理（List/Board view）
- [x] チーム/部門ダッシュボード
- [x] 組織編集（Department作成、Team移動）
- [x] AIタスク検証・影響分析

### Planned

- [ ] 組織構造の統一（organization_units migration）
- [ ] ワーカーの統一（human + AI agent）
- [ ] ドラッグ&ドロップでの組織再編
- [ ] AIエージェントの設定・管理UI
- [ ] リアルタイム通知
- [ ] タイムライン/ガントチャート表示
- [ ] 権限管理（RBAC）

---

## File Structure

```
/src
  /app
    page.tsx          # メインエントリ
  /components
    /layout
      TitleBar.tsx    # 上部バー（ロゴ、検索）
      ActivityBar.tsx # 左端アイコンバー
      Sidebar.tsx     # 組織ツリー表示
      MainContent.tsx # メインコンテンツ領域
      AIPanel.tsx     # AIアシスタントパネル
  /hooks
    useSupabase.ts    # データ取得・操作
  /lib
    supabase.ts       # Supabaseクライアント
  /types
    database.ts       # 型定義
```

---

## Development Notes

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

### Commands

```bash
npm run dev      # 開発サーバー
npm run build    # ビルド
npx vercel --prod # 本番デプロイ
```

### Supabase Project

- Project ID: rkugtcqztkkacvoylupw
- Region: ap-northeast-2

---

## Philosophy

> 「組織とは、人間とAIが協調して目標を達成するための構造である」

Alconは単なるタスク管理ツールではない。組織という概念を再定義し、人間とAIが同じ土俵で協働する未来を実現するプラットフォームを目指す。

設計の判断に迷ったら：
1. 特定のケースではなく、一般化できるか？
2. 人間とAIを同列に扱えているか？
3. ユーザーが自由に構造を作れるか？

この3つの問いに立ち返ること。
