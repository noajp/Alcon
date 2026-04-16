# Alcon 統合企画書 v6

> **Alcon = All Context**
> すべての文脈を統合し、人間とAIが同じ地図で動く基盤

---

# Part 1: ビジョンと哲学

## 1.1 ハンナ・アーレントの「人間の条件」から

アーレントは人間の活動を3つに分類した：

| 概念 | 原語 | 内容 | Alconでの対応 |
|------|------|------|---------------|
| **活動 (Action)** | Action | 他者と共に公共空間で何かを始める | OKR/Overview — 目標の合意と方向づけ |
| **仕事 (Work)** | Work | 耐久的な人工物を作る創造的営み | Object — 構造の設計 |
| **労働 (Labor)** | Labor | 反復的活動。消費されて何も残らない | Elements — 実行の標準化 |

## 1.2 問題の本質

現代ホワイトカラーの多くは「仕事に見える労働」をしている。

```
労働（本来は標準化可能）
  ↓ 道具がバラバラ（Slack, Excel, Notion, 独自システム...）
  ↓ 解釈の余地が発生（属人化）
  ↓ 労働なのに「仕事的コスト」が発生
  ↓ 生産性の低下
```

## 1.3 Alconの解決策

**労働の最小単位を統一する。**

> 「労働を標準化し、人間を創造と活動に解放する」

Alconは単なるタスク管理ツールではない。ホワイトカラーの「仕事に見える労働」を標準化し、人間が本当に価値ある判断と創造に集中できる世界を実現するプラットフォーム。

---

# Part 2: プロダクトアーキテクチャ

## 2.1 3層 + 目標層

```
Objectives（WHY — なぜやるのか）
  └── Objective → Key Results → Linked Objects
        ↓ 進捗が自動集計される

Objects（HOW — どう構造化するか）
  └── 入れ子可能な構造単位
        ↓ Elementを格納する器

Elements（WHAT — 何をやるか）
  └── 最小作業単位
        └── Subelements（チェックリスト）
```

| 層 | 役割 | DBテーブル | 特徴 |
|---|---|---|---|
| **Objectives** | 目標・OKR | `objectives`, `objective_links` | Objective → Key Result の親子構造。KRはObjectにリンク |
| **Object** | 構造単位 | `objects` | `parent_object_id`で無限ネスト。プロジェクト、部門、フェーズなど |
| **Elements** | 実行単位 | `elements` | status/priority/due_date/assignees。セクションでグルーピング |
| **Subelements** | 構成要素 | `subelements` | Elementの細分化（チェックリスト） |

### なぜ「Task」ではなく「Elements」か？

業界によって扱う単位が異なる：
- IT企業 → タスク / 病院 → 患者 / 営業 → 案件 / 製造 → 工程

抽象的な「Elements」なら、どの業界でも違和感なく使える。

## 2.2 ビュー体系

### トップレベル（サイドバー）

| ビュー | ID | 説明 |
|--------|-----|------|
| Home | `home` | 全体ダッシュボード — KPIカード、ステータス/Priority分布チャート、Object進捗 |
| Overview | `overview` | OKR/目標管理 — Objective → KR → LinkedObject の進捗ツリー |
| BluePrint | `blueprint` | 思考キャンバス — Thought/Actionカードをドットグリッドキャンバスに配置 |
| Objects | `projects` | Object階層ツリー + Element管理（メインワークエリア） |
| Elements | `mytasks` | 個人タスクビュー — アサインされたElementを一覧 |

### Object内タブ（「+」で追加）

| タブ | tab_type | 説明 |
|------|----------|------|
| Elements | `elements` | スプレッドシート型テーブル。セクション、カスタムカラム、シートタブ |
| Dashboard | `summary` | Object内ダッシュボード — 完了率リング、ステータス/Priority分布、工数、期限 |
| Gantt | `gantt` | ガントチャート — Day/Week/Month切替、ドラッグリサイズ、依存線 |
| Calendar | `calendar` | 月間カレンダー — 期限ベースのイベント表示、Popover展開、カラーピッカー |
| Workers | `workers` | ワーカー管理（実装予定） |

## 2.3 Workers

```sql
workers (
  id, object_id,
  type,  -- 'human' | 'ai_agent'
  name, role, email, avatar_url,
  ai_model, ai_config,  -- AI Agentの場合の設定
  status,  -- 'active' | 'inactive' | 'busy'
  created_at, updated_at
)
```

Workersは人間とAIエージェントの両方を統一的に扱う。同じ `element_assignees` テーブルでElementにアサインされ、同じUIで表示される。

---

# Part 3: 現在の実装状況（2026年4月時点）

## 3.1 技術スタック

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 16 (App Router, Turbopack) |
| Styling | Tailwind CSS, shadcn/ui, Radix UI |
| Charts | recharts |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions, Realtime) |
| AI | Claude API via Supabase Edge Functions |
| Deployment | Vercel |
| DnD | @dnd-kit/core, @dnd-kit/sortable |
| Editor | BlockNote (Notion-like block editor) |
| Canvas | Excalidraw (BluePrint board) |

## 3.2 実装済み機能

### Core
- Supabase Auth（メール/パスワード）
- Object CRUD、階層構造、ドラッグ&ドロップ
- Element テーブルビュー（セクション、カスタムカラム、シートタブ）
- Subelement チェックリスト
- Worker管理、Elementアサイン（assignee/reviewer/collaborator）
- Element詳細パネル（Linear風サイドパネル）

### ビュー
- **Home Dashboard** — KPIカード4枚 + recharts棒グラフ/円グラフ + Object進捗バー + 期限リスト
- **Overview** — OKR表示（Objective → Key Result → Linked Objectの進捗ツリー）
- **BluePrint** — ドットグリッドキャンバス + Thought/Actionカード（kind-based variant）
- **Object Dashboard** — 完了率RadialBarChart + ステータス/Priority分布 + 見積vs実績 + 期限リスト
- **Gantt** — Day/Week/Month切替、ドラッグリサイズ、依存矢印、Todayライン、ホバーツールチップ
- **Calendar** — 月間グリッド、ステータスカラー、+N more Popover、Todayハイライト
- **My Tasks** — グループ化（status/priority/object/none）、折りたたみ
- **Notes** — BlockNoteエディタ、フォルダ/ページ階層

### インフラ
- Vercel自動デプロイ（mainブランチpush）
- Supabase RLS（全テーブル有効）
- ダーク/ライトテーマ切替

## 3.3 データベーススキーマ（現在）

```sql
-- Core
objects (id, parent_object_id, name, description, color, prefix, display_id, order_index, ...)
elements (id, object_id, sheet_id, title, description, section, status, priority,
          start_date, due_date, estimated_hours, actual_hours, color, order_index, ...)
subelements (id, element_id, title, is_completed, order_index, ...)
workers (id, object_id, type, name, role, email, avatar_url, ai_model, ai_config, status, ...)

-- Relations
element_assignees (id, element_id, worker_id, role, assigned_at)
element_edges (id, from_element, to_element, edge_type, ...)
  -- edge_type: 'spawns' | 'depends_on' | 'merges_into' | 'splits_to' | 'references' | 'cancels'

-- Objectives (OKR)
objectives (id, title, description, type, parent_id, target_value, current_value, status, due_date, ...)
  -- type: 'objective' | 'key_result'
  -- status: 'on_track' | 'at_risk' | 'behind' | 'achieved'
objective_links (id, objective_id, object_id)

-- Configuration
object_tabs (id, object_id, tab_type, title, content, order_index, is_pinned)
element_sheets (id, object_id, name, column_config, order_index)
custom_columns (id, object_id, name, column_type, config, order_index)
custom_column_values (id, column_id, element_id, value)

-- Documents
documents (id, parent_id, type, title, content, ...)
```

---

# Part 4: ロードマップ

## Phase 1: Core Platform（〜2026年5月）✅ ほぼ完了

- [x] 認証・プロフィール
- [x] Object階層管理
- [x] Elementテーブルビュー
- [x] カスタムカラム
- [x] シートタブ
- [ ] OAuth（Google/GitHub）

## Phase 2: Collaboration（〜2026年6月）🔄 進行中

- [x] Worker管理・アサイン
- [ ] リアルタイム同期（Supabase Realtime）
- [ ] 通知システム（アプリ内 + メール）
- [ ] Presenceインジケーター

## Phase 3: Intelligence（〜2026年8月）⏳ 初期段階

- [x] Claude API Edge Function基盤
- [x] BluePrintカードボード
- [x] Analyticsダッシュボード (recharts)
- [ ] Element自動要約
- [ ] タスク分解AI
- [ ] AIチャットインターフェース

## Phase 4: Enterprise（〜2026年Q4）📋 計画段階

- [ ] マルチテナント（Organization管理）
- [ ] RLS強化
- [ ] REST API / Webhook
- [ ] セキュリティ監査 / SOC2準備

---

# Part 5: 将来ビジョン — Alcon App Suite

## 5.1 SAPモデルに学ぶ: 独立モジュール群としてのAlcon

SAPが ERP を FI（財務）/ CO（管理会計）/ HR（人事）/ SD（販売）/ MM（購買）… と**独立モジュール**で構成しているように、Alconも業務領域ごとに**別アプリ（独立モジュール）**として展開する。

各モジュールは独立したアプリケーションだが、共通基盤（Auth / Object / Element / Worker / AI Engine）を共有するため、**データが自然に繋がる**。

```
                    ┌─────────────────────────────┐
                    │    Alcon Platform (共通基盤)  │
                    │  Auth · Object · Element     │
                    │  Worker · AI Engine · Edge Fn │
                    └──────────┬──────────────────┘
                               │
        ┌──────────┬───────────┼───────────┬──────────┐
        │          │           │           │          │
  ┌─────┴─────┐ ┌──┴────┐ ┌───┴───┐ ┌────┴───┐ ┌───┴────┐
  │ Alcon SEM │ │Kanjo  │ │Jinji  │ │Eigyo   │ │Kaihatsu│
  │ 戦略実行   │ │勘定系  │ │人事系  │ │営業系   │ │開発系   │
  │ ★現在開発中│ │会計/ERP│ │HR     │ │CRM    │ │DevOps  │
  └───────────┘ └───────┘ └───────┘ └────────┘ └────────┘
       別アプリ     別アプリ    別アプリ    別アプリ     別アプリ
       別リポジトリ  別リポジトリ 別リポジトリ 別リポジトリ  別リポジトリ
       別デプロイ    別デプロイ   別デプロイ   別デプロイ    別デプロイ
```

### SAPとの対比

| SAP モジュール | Alcon モジュール | 共通点 | Alconの差別化 |
|---------------|----------------|--------|--------------|
| FI/CO (財務/管理会計) | **Kanjo-kei** | 予算管理、仕訳、P/L | AIによる仕訳自動提案 |
| HR (人事) | **Jinji-kei** | 組織図、評価、勤怠 | OKRとの自動連動 |
| SD (販売管理) | **Eigyo-kei** | パイプライン、見積 | AI受注確率予測 |
| PP/PM (生産/保全) | **Kaihatsu-kei** | スプリント、CI/CD | Element = Issue として統一 |
| BW/BI (分析) | **Bunseki-kei** | レポート、ダッシュボード | モジュール横断AIインサイト |

### モジュール間の独立性と連携

```
独立性:
- 各モジュールは別リポジトリ、別デプロイ、別ドメイン
- Kanjo-kei を使わなくても Alcon SEM は完全に動く
- 導入企業は必要なモジュールだけ選択できる

連携:
- 共通基盤の Object/Element/Worker を介してデータが繋がる
- Alcon SEM の Element「新機能開発」→ Kanjo-kei の Element「開発費 200万」
- Jinji-kei の Worker「山田」→ Alcon SEM の Worker「山田」（同一ID）
- AI Engine がモジュール横断でパターンを学習
```

## 5.2 Alcon SEM (Strategy Execution Manager) — 現在開発中

**戦略立案から実行までを一気通貫で管理する。Alconの第一弾モジュール。**

| 機能 | 説明 |
|------|------|
| OKR/目標管理 | Objective → Key Result → Object → Element の完全トレーサビリティ |
| BluePrint | 戦略キャンバス。思考カードとアクションカードで構想を可視化 |
| ロードマップ | Gantt + Calendar + タイムラインビュー |
| リソース配分 | Workers × Objects のワークロード可視化 |
| AI戦略アドバイザー | Claude APIによるボトルネック検出・リスク予測・リソース最適化提案 |

> 競合: Asana Goals, Linear Initiatives, Notion OKR, Palantir Foundry
> 差別化: AI-first + Element/Object の抽象化による業界横断性

## 5.3 Kanjo-kei (勘定系) — 将来モジュール

**独立した会計/ERPアプリ。** Alcon Platform 上に構築するが、別リポジトリ・別デプロイ。

| 機能 | 説明 |
|------|------|
| 予算管理 | Object階層で部門・プロジェクト別予算を構造化 |
| 経費精算 | Elementとして経費申請。承認フローはDecision |
| 仕訳自動生成 | AI が Element のメタデータから仕訳候補を提案 |
| 財務ダッシュボード | P/L, B/S, CF の可視化 |
| 請求書管理 | Card として請求書PDFを添付、Element にリンク |

> ネーミング「勘定系(Kanjo-kei)」は日本の企業システム用語を踏襲。親しみやすく、かつ専門性を感じさせる。

## 5.4 Jinji-kei (人事系) — 将来モジュール

**独立したHR/Peopleアプリ。**

| 機能 | 説明 |
|------|------|
| 組織図 | Object階層 = 組織構造 |
| 評価管理 | Element = 評価項目。KR と連動して目標達成度を自動算出 |
| 1on1記録 | Card として記録、Worker にリンク |
| スキルマトリクス | Worker × スキル の交差ビュー |
| タイムシート | Element の actual_hours を集計 |

## 5.5 Eigyo-kei (営業系) — 将来モジュール

**独立したCRM/Salesアプリ。**

| 機能 | 説明 |
|------|------|
| パイプライン | Object = 商談フェーズ、Element = 個別案件 |
| 顧客管理 | Worker (type: 'customer') として統一管理 |
| 見積・提案 | Card として見積書を管理、Element にリンク |
| 売上予測 | AI が過去の案件パターンから受注確率を予測 |
| ダッシュボード | ファネル、月次推移、担当者別実績 |

## 5.6 共通基盤の設計原則

各モジュールは**独立したアプリ**だが、同じ Alcon Platform（共通基盤）上で動く。

```
共通基盤が提供するもの:
├── Auth (認証・認可)     → 全モジュールでSSO
├── Object/Element       → 統一データモデル
├── Worker               → 人間・AIの統一ID
├── AI Engine            → Claude API ラッパー、共通プロンプト基盤
├── ビューエンジン         → Gantt/Calendar/Dashboard を各モジュールが再利用
└── Edge Functions       → Supabase上の共有ビジネスロジック

各モジュールが独自に持つもの:
├── 専用UI/UX            → 業務領域に最適化された画面
├── 専用スキーマ拡張       → 勘定科目テーブル、商談テーブルなど
├── 専用ビジネスロジック    → 仕訳ルール、パイプライン遷移など
└── 専用AIプロンプト       → 領域特化の推論
```

## 5.7 ロードマップ

| フェーズ | 期間 | モジュール | 内容 |
|---------|------|----------|------|
| **Now** | 2026 Q2 | Alcon SEM | MVP — OKR + Object/Element + Dashboard + AI基盤 |
| **Next** | 2026 Q3-Q4 | Alcon SEM | Enterprise — マルチテナント、API、Realtime |
| **Later** | 2027 Q1-Q2 | **Kanjo-kei** | 独立アプリとして会計MVP。共通基盤を分離・パッケージ化 |
| **Future** | 2027 H2 | **Jinji-kei / Eigyo-kei** | HR + CRM をそれぞれ独立アプリとして開発 |
| **Vision** | 2028+ | **Alcon Platform** | 共通基盤のOSS化、サードパーティモジュール対応 |

---

# Part 6: 競合との差別化

| 観点 | Notion | Asana | Linear | SAP | **Alcon** |
|------|--------|-------|--------|-----|-----------|
| 構造の自由度 | ページ/DB | プロジェクト/タスク | チーム/Issue | 固定モジュール | **Object/Element 無限ネスト** |
| 業界横断性 | △ 汎用だが構造なし | × IT特化 | × 開発特化 | △ 業界テンプレ | **◎ Element抽象化** |
| AI統合度 | △ Notion AI | △ 要約のみ | △ 自動ラベル | × なし | **◎ Claude API ネイティブ** |
| OKR → 実行の接続 | × 別ツール | △ Goals機能 | △ Initiatives | × 別モジュール | **◎ Objective → KR → Object → Element** |
| ERP統合 | × | × | × | ◎ 本業 | **○ Kanjo-kei で統合予定** |
| コスト | 高（Enterprise） | 高 | 中 | 非常に高 | **低（Supabase + Vercel）** |

---

# Appendix: 開発コマンド

```bash
npm run dev          # 開発サーバー起動
npm run build        # 本番ビルド
npm run type-check   # TypeScript型チェック
npm run lint         # ESLint
npm test             # Vitest
npx vercel --prod    # 本番デプロイ
```
*Production URL**: https://alcon-ashy.vercel.app
