# Alcon 統合企画書 v6

> **Alcon = All Context**
> すべての文脈を統合し、人間とAIが同じ地図で動く基盤

---

# Part 1: ビジョンと哲学

## 1.1 ハンナ・アーレントの「人間の条件」から

アーレントは人間の活動を3つに分類した：

| 概念 | 原語 | 内容 | Alconでの対応 |
|------|------|------|---------------|
| **活動 (Action)** | Action | 他者と共に公共空間で何かを始める | Ticket — 戦略・思考の塊 |
| **仕事 (Work)** | Work | 耐久的な人工物を作る創造的営み | Object — 構造の設計 |
| **労働 (Labor)** | Labor | 反復的活動。消費されて何も残らない | Element — 実行の標準化 |

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

# Part 2: 中核概念モデル

Alconは**5つの中核概念**で世界を表現する。すべての機能はこの5つの組み合わせで成立する。

## 2.1 大中小の3階層 — System / Object / Element

業務を「大きな入れ物 → 中ぐらいの入れ物 → 小さな実行単位」の3階層で表現する。

```
System (大) ── 組織・領域・テナントの最大単位
   └── Object (中) ── ∞ネスト可能な構造単位
          └── Element (小) ── 最小の実行/記録単位
```

**業界横断の抽象化**：この3階層は意図的に抽象的にしてある。業界に応じて意味が変わる。

| 業界 | System | Object | Element |
|------|--------|--------|---------|
| **IT企業** | 会社 | 部門 → プロジェクト → スプリント | タスク |
| **病院** | 病院 | 病棟 → 科 → 部屋 | 患者 |
| **軍事** | 作戦 | 地域 → 部隊 | 目標 |
| **製造業** | 工場 | ライン → 工程 | 作業指示 |
| **学校** | 学校 | 学部 → 学科 → クラス | 生徒 |
| **小売** | チェーン | 地域 → 店舗 → 部門 | 商品 |
| **会計** | 会社 | 年度 → 部門 → 勘定 | 仕訳 |

> **Why ここまで抽象化？** 各業界の「タスク管理ツール」は、実は全部「入れ子の入れ物 + 実行単位」で表現できる。Alconはその構造だけを提供し、ユーザーが自由に意味を載せる。

### 各階層の特性

| 概念 | 階層 | 役割 | 特性 |
|------|------|------|------|
| **System** | 大 | 最上位の入れ物 | テナント分離、SAPで言うClient |
| **Object** | 中 | ∞ネスト可能な構造単位 | `parent_object_id`で無限階層、multi-homing対応 |
| **Element** | 小 | 最小実行/記録単位 | status / priority / due_date / assignees / multi-homing対応 |

> **Multi-homing**: 1つのObjectやElementは複数の親に所属できる（Asanaのmulti-homingと同じ）。例: 「コードレビュー」というElementを「Frontend」と「QA」の両方のObjectに置ける。

## 2.2 付随データ — Tag（タグ・メタデータ）

S/O/E のあらゆる単位に**任意の構造化メタデータ**を付与できる。**ドッグタグ**のように、その対象が何者かを表現する。

```
Element「患者A」
  ├── Tag: 血液型 = A+
  ├── Tag: 担当医 = 山田
  ├── Tag: 入院日 = 2026-04-10
  ├── Tag: 位置 = 病棟3F-302号室 (lat: 35.6, lng: 139.7)
  ├── Tag: アレルギー = ペニシリン
  └── Tag: 緊急度 = 高
```

### Tagの設計

- **型**: text / number / date / select / multi-select / person / location / boolean / url / image
- **対象**: System / Object / Element に付与可能
- **再利用**: Tag定義は組織内で共有でき、複数の対象で同じTag定義を使える
- **AI可読性**: Tagは構造化されているのでAIが文脈を読み取れる

### 既存実装との対応
現在のAlconでは `custom_columns` + `custom_column_values` がこのTag機能の前身。今後 **Tag** という統一概念で再設計する。

## 2.3 思考の塊 — Ticket（チケット）

S/O/Eが「**実行**の文脈」だとすれば、Ticketは「**思考**の文脈」を表現する。戦略、議論、判断、構想など、まだ実行に落ちていない思考の塊。

```
Ticket「Q3戦略：競合差別化」
  ├── 思考: 「Notionと比べてElementの抽象化が強み」
  ├── 思考: 「Asanaのmulti-homingに学んで実装」
  ├── 判断: 「BluePrintを最優先に開発する」
  └── アクション: → Element「BluePrint AI機能の実装」を生成
```

### Ticketの特性

- **独立性**: S/O/Eから独立した思考のNode
- **多対多接続**: 1つのTicketは複数のObjectやElementに紐付け可能
- **進化**: Ticket内の議論が成熟したら → Element化（実行に落とす）
- **AI協働**: Claude APIと対話しながら思考を深められる
- **可視化**: BluePrint（ドットグリッドキャンバス）上にカードとして配置

### 既存実装との対応
- **BluePrint** がTicketの可視化レイヤー（思考カード = ThoughtCard, アクション提案カード = ActionCard）
- **Notes** がTicketのドキュメント形式（リッチテキスト）

## 2.4 表現単位 — Widget（ウィジェット）

S/O/E + Tag のデータを **表現する最小単位**がWidget。グラフ、リスト、カレンダー、地図、KPI等あらゆる可視化形式。

```
Element + Tag「位置」
  → Widget「マップビュー」: 地図上にElementをピン表示
  → Widget「位置別カウント」: エリアごとのElement件数バー

Element + Tag「期限」
  → Widget「カレンダー」: 月次グリッドに配置
  → Widget「ガント」: 期間バー
  → Widget「タイムライン」: 時系列リスト

Element + Tag「優先度」
  → Widget「Priority分布」: 円グラフ
  → Widget「Priorityヒートマップ」: 担当×優先度マトリクス
```

### Widgetの設計原則

1. **データ非依存**: Widgetは「データの形」を要求するだけ。データソースは差し替え可能
2. **配置自由**: Dashboard / Overview / 任意のページ上で自由に配置・並び替え
3. **永続化**: ユーザー毎・スコープ毎にレイアウト保存
4. **拡張可能**: 新しいTag型が追加されたら、それを表現する新Widgetが追加される

### 既存実装との対応
- 現在の **WidgetGrid** + 10種のwidgetsがこの基盤
- 各ビュー（Dashboard / Overview / Summary）は「同じWidget基盤の上の異なるプリセット」

---

# Part 3: 機能群の整理

5つの中核概念から見た機能マッピング：

```
                  ┌────────────────────────────────────────┐
                  │            Alcon Platform                │
                  └─┬──────────┬──────────┬──────────┬─────┘
                    │          │          │          │
              ┌─────▼─────┐  ┌─▼─────┐  ┌─▼─────┐  ┌─▼─────────┐
              │ S / O / E │  │  Tag  │  │Ticket │  │  Widget   │
              │  3階層    │  │メタ   │  │思考   │  │  表現      │
              └─────┬─────┘  └─┬─────┘  └─┬─────┘  └─┬─────────┘
                    │          │          │          │
        ┌───────────┼──────────┼──────────┼──────────┼───────────┐
        │           │          │          │          │           │
  ┌─────▼───┐  ┌────▼─────┐ ┌─▼──────┐ ┌─▼──────┐ ┌─▼────────┐
  │Object   │  │Element   │ │Custom  │ │BluePrint│ │Dashboard │
  │Tree     │  │Table     │ │Columns │ │Canvas   │ │Widgets   │
  │(Sidebar)│  │(List Tab)│ │(=Tag)  │ │(=Ticket)│ │(Recharts)│
  └─────────┘  └──────────┘ └────────┘ └─────────┘ └──────────┘
                                                    ┌──────────┐
                                                    │ Gantt    │
                                                    │ Calendar │
                                                    │ KPI      │
                                                    │ ...      │
                                                    └──────────┘
```

## 3.1 機能カテゴリ

### A. 構造管理 (S/O/E)
- **Object Tree** (サイドバー): Object階層のナビゲーション
- **Element List** (Listタブ): スプレッドシート型、セクション、シート
- **Multi-homing**: Object/Elementを複数の親に所属させる
- **Workers + Assignees**: 人間/AIエージェントをElementに割当

### B. メタデータ管理 (Tag)
- **Custom Columns** (現実装): 任意のカラム型を追加
- **Tag Library** (将来): 組織で共有可能なTag定義
- **Tag-driven Search/Filter**: TagでElementを絞り込み

### C. 思考管理 (Ticket)
- **BluePrint Board**: ドットグリッドキャンバス + Thought/Actionカード
- **Notes** (BlockNote): リッチテキストドキュメント
- **AI Chat** (将来): Ticketを起点にClaudeと対話

### D. 表現 (Widget)
- **Dashboard** (Home/Object Summary): プリセット+カスタマイズ可能なWidget配置
- **Object Overview**: Project Brief / Team / Activity / Milestones
- **Standard Widgets**:
  - KPI Cards (完了率/Active/Overdue/Hours)
  - Status / Priority Distribution
  - Gantt / Calendar (Day/Week/Month)
  - Recent Activity / Team Roster / Milestones
  - Object Progress / Overdue / Upcoming
- **Tag-driven Widgets** (将来):
  - Map Widget (位置Tagベース)
  - Heatmap Widget (任意Tag×Tag)
  - Funnel Widget (ステータス遷移)
  - Custom Chart (Tag選択でグラフ生成)

---

# Part 4: 設計原則

## 4.1 抽象を保つ

業界特化の語彙（タスク、患者、案件）を中核に持ち込まない。**System/Object/Element/Tag/Ticket/Widget の6語**だけが普遍。

## 4.2 データ非依存

Widgetはデータの形だけを要求。バックエンドの変化（Multi-homing追加、Tag追加）でWidgetは壊れない。

## 4.3 ユーザー駆動の構造

開発者が組織を定義しない。**ユーザーが System/Object/Element を自由に組み立て、Tagで意味付けする**。

## 4.4 AI第一

Tag（構造化メタデータ）+ Ticket（思考の塊）が揃うことで、AIが意味のある提案・要約・自動化を行える。

## 4.5 段階的拡張

新機能は中核5概念のいずれかに紐付ける。新しいビュー = 新しいWidget。新しいプロパティ = 新しいTag型。

---

# Part 5: ロードマップ

## Phase 1: Core Platform（〜2026年5月）✅ ほぼ完了

- [x] System/Object/Element の3階層（Systemは構造的にはトップObject）
- [x] Object階層管理（∞ネスト + Multi-homing）
- [x] Element テーブルビュー
- [x] Custom Columns（Tag前身）
- [x] Workers + Assignees
- [ ] OAuth（Google/GitHub）

## Phase 2: Collaboration（〜2026年6月）🔄 進行中

- [x] Element multi-homing
- [x] Object multi-homing
- [ ] リアルタイム同期（Supabase Realtime）
- [ ] 通知システム
- [ ] Presenceインジケーター

## Phase 3: Intelligence（〜2026年8月）⏳ 初期段階

- [x] BluePrint カードボード（Ticket基盤）
- [x] Analyticsダッシュボード（Widget基盤）
- [x] Calendar Day/Week/Month ビュー（時刻対応）
- [ ] Tag Library（Custom Columnsを Tag に再構成）
- [ ] Tag-driven Widget（位置Tag → Map Widget等）
- [ ] AI チャット（Ticketと連動）
- [ ] Element 自動要約 / タスク分解

## Phase 4: Enterprise（〜2026年Q4）📋 計画段階

- [ ] System レベルのマルチテナント分離
- [ ] RLS強化
- [ ] REST API / Webhook
- [ ] セキュリティ監査 / SOC2準備

---

# Part 6: 将来ビジョン — Alcon App Suite

## 6.1 SAPモデル: 独立モジュール群

SAPが ERP を FI/CO（財務）/ HR（人事）/ SD（販売）と独立モジュールで構成しているように、Alconも業務領域ごとに**別アプリ**として展開する。

各モジュールは独立アプリだが、共通基盤（Auth / System / Object / Element / Tag / Ticket / Widget / AI Engine）を共有するため、データが自然に繋がる。

```
                    ┌─────────────────────────────┐
                    │    Alcon Platform (共通基盤)  │
                    │  Auth · S/O/E · Tag · Ticket │
                    │  Widget · Worker · AI Engine │
                    └──────────┬──────────────────┘
                               │
        ┌──────────┬───────────┼───────────┬──────────┐
        │          │           │           │          │
  ┌─────┴─────┐ ┌──┴────┐ ┌───┴───┐ ┌────┴───┐ ┌───┴────┐
  │ Alcon SEM │ │Kanjo  │ │Jinji  │ │Eigyo   │ │Kaihatsu│
  │ 戦略実行   │ │勘定系  │ │人事系  │ │営業系   │ │開発系   │
  │ ★現在開発中│ │会計/ERP│ │HR     │ │CRM    │ │DevOps  │
  └───────────┘ └───────┘ └───────┘ └────────┘ └────────┘
```

| SAP モジュール | Alcon モジュール | Object例 | Element例 | 主要Tag例 |
|---------------|----------------|---------|----------|----------|
| FI/CO | **Kanjo-kei** | 部門 → 勘定 | 仕訳 | 金額・期日・勘定科目 |
| HR | **Jinji-kei** | 部署 → チーム | 従業員 | 役職・スキル・評価 |
| SD | **Eigyo-kei** | 商談フェーズ | 案件 | 金額・確度・顧客 |
| PP/PM | **Kaihatsu-kei** | スプリント | Issue | 工数・依存・PR |

## 6.2 共通基盤の設計原則

各モジュールは**独立したアプリ**だが、同じ Alcon Platform 上で動く。

```
共通基盤が提供:
├── Auth (認証・認可)     → 全モジュールでSSO
├── S/O/E                → 統一データモデル
├── Tag                  → メタデータ機構
├── Ticket               → 思考管理
├── Widget               → 表現エンジン
├── Worker               → 人間・AIの統一ID
├── AI Engine            → Claude API 共通基盤
└── Edge Functions       → 共有ビジネスロジック

各モジュールが独自に持つ:
├── 専用UI/UX            → 業務領域に最適化
├── 専用Tag定義          → 勘定科目・スキル・商談ステージ等
├── 専用ビジネスロジック    → 仕訳ルール・パイプライン遷移等
└── 専用AIプロンプト       → 領域特化の推論
```

## 6.3 ロードマップ

| フェーズ | 期間 | モジュール | 内容 |
|---------|------|----------|------|
| **Now** | 2026 Q2 | Alcon SEM | MVP — S/O/E + Tag + Ticket + Widget の基盤完成 |
| **Next** | 2026 Q3-Q4 | Alcon SEM | Enterprise — マルチテナント、API、Realtime |
| **Later** | 2027 Q1-Q2 | **Kanjo-kei** | 独立アプリとして会計MVP |
| **Future** | 2027 H2 | **Jinji-kei / Eigyo-kei** | HR + CRM をそれぞれ独立アプリ |
| **Vision** | 2028+ | **Alcon Platform** | 共通基盤OSS化、サードパーティモジュール対応 |

---

# Part 7: 技術スタック（現状）

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

## データベーススキーマ（現状）

```sql
-- Core (S/O/E)
objects (id, parent_object_id, name, description, color, prefix, ...)
elements (id, object_id, sheet_id, title, description, section, status, priority,
          start_date, start_time, due_date, due_time,
          estimated_hours, actual_hours, color, ...)
subelements (id, element_id, title, is_completed, ...)

-- Multi-homing
object_parents (id, object_id, parent_object_id, is_primary, ...)
element_objects (id, element_id, object_id, is_primary, ...)

-- Workers
workers (id, object_id, type, name, role, email, ai_model, ...)
element_assignees (id, element_id, worker_id, role)

-- Tag (前身)
custom_columns (id, object_id, name, column_type, config, ...)
custom_column_values (id, column_id, element_id, value)

-- Ticket (前身)
documents (id, parent_id, type, title, content, ...)  -- Notes
-- BluePrintカードはまだ専用テーブルなし（将来 tickets テーブル化）

-- Widget (永続化)
-- 現状は localStorage 保存。将来 user_widget_layouts テーブルへ
```

---

# Appendix: 用語集

| 用語 | 定義 |
|------|------|
| **System** | 最上位の入れ物。テナント・組織・領域 |
| **Object** | 中間の構造単位。∞ネスト・Multi-homing可能 |
| **Element** | 最小の実行/記録単位。タスク・患者・案件・仕訳・商品など |
| **Subelement** | Element内のチェックリスト項目 |
| **Tag** | S/O/Eに付与する構造化メタデータ。ドッグタグ的役割 |
| **Ticket** | 思考の塊。戦略・議論・判断。BluePrint上で可視化 |
| **Widget** | データを表現する最小単位。グラフ・リスト・地図など |
| **Worker** | 人間 or AIエージェント。Elementにアサインされる |

---

# 開発コマンド

```bash
cd web && npm run dev          # 開発サーバー
cd web && npm run build        # 本番ビルド
cd web && npm run type-check   # TypeScript型チェック
cd web && npm run lint         # ESLint
npx vercel --prod              # 本番デプロイ
```

**Supabase Project ID**: `rkugtcqztkkacvoylupw`
**Production URL**: https://alcon-ashy.vercel.app
