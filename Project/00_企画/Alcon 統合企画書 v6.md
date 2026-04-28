# Alcon 統合企画書 v6

> **Alcon = All Context**
> すべての文脈を統合し、人間とAIが同じ地図で動く基盤

---

# Part 1: 哲学と目指したい方向

## 1.1 出発点 — なぜ Alcon か

Alcon = **All Context**。業務に散らばった文脈（誰が・何を・なぜ・どう動かしているか）を 1 つのデータモデルに集約し、人間と AI が同じ地図の上で動けるようにする、というのが出発点。

業界ごとに「タスク管理」「患者管理」「案件管理」「在庫管理」と別物に見える業務は、構造としては「**入れ子の入れ物 + 実行単位 + メタデータ + 思考 + 表現**」に分解できる。Alcon はこの 5 種類の構造だけを基盤として提供し、業界語彙はユーザー側に委ねる。

## 1.2 ハンナ・アーレントの「人間の条件」から

思想的な出発点はアーレントの3区分。Alcon の中核概念はこの区分に対応している。

| 概念 | 原語 | 内容 | Alcon での対応 |
|------|------|------|----------------|
| **活動 (Action)** | Action | 他者と共に公共空間で何かを始める。価値判断・意思決定 | **Ticket** — 戦略・議論・判断などの思考の塊 |
| **仕事 (Work)** | Work | 耐久的な人工物を作る創造的営み。構造をつくる行為 | **Object** — 業務を入れる構造の設計 |
| **労働 (Labor)** | Labor | 生命維持のための反復的活動。消費されて何も残らない | **Element** — 実行の最小単位の標準化 |

## 1.3 問題意識 — 「仕事に見える労働」の肥大化

現代のホワイトカラー業務の多くは、本来 Labor（標準化可能な反復）であるはずのものが、ツールの分散と属人化によって Work（個別の創造的営み）の体裁で行われている。

```
労働（本来は標準化可能）
  ↓ 道具がバラバラ（Slack / Excel / Notion / 業界専用 SaaS / 独自システム）
  ↓ それぞれの道具で文脈の切れ目ができる
  ↓ 「どこに何があるか」を覚える属人コストが発生
  ↓ 労働なのに Work 的コストを払い続ける
  ↓ 本来の Action（判断・創造）に回す時間が削られる
```

これは個々のツールが悪いというより、**労働の最小単位が共通化されていない**ことが原因。同じ「やること」がツールごとに違う形で表現されているため、AI も人間も全体像を持てない。

## 1.4 目指したい方向

Alcon が目指すのは、ツールを増やすことではなく、**労働の最小単位（Element）と、それを束ねる構造（System / Object）を業界横断で共通化すること**。共通化された土台の上で次が成り立つ:

- **人間**は判断・創造（Action）に時間を使い、反復作業はツール側に押し戻す
- **AI**は構造化されたデータ（S/O/E + Tag）を読んで、提案・要約・自動化に参加できる
- **組織**はツールを乗り換えても文脈を失わない

「タスク管理ツール」ではなく、**業務の地図そのもの**を作る、というのが方向性。タスク管理・プロジェクト管理・ナレッジ管理・ダッシュボードはすべて、この地図の上の表現（Widget）として現れる。

---

# Part 2: 中核概念モデル

Alcon は **System / Object / Element / Tag / Ticket / Widget** の 6 概念で世界を表現する。S/O/E（大・中・小）の 3 階層を 1 系統と数えれば 4 カテゴリ、個別のエンティティとしては 6。新しい機能・新しいビューはすべてこのいずれか（または組み合わせ）に紐付ける、というのが設計上の制約。

| カテゴリ | 概念 | 役割 |
|---------|------|------|
| 構造 | **System / Object / Element** | 業務の入れ物と実行単位 |
| メタ | **Tag** | S/O/E に付与する構造化メタデータ |
| 思考 | **Ticket** | まだ実行に落ちていない判断・議論・構想 |
| 表現 | **Widget** | データを可視化する最小単位 |

## 2.1 大中小の 3 階層 — System / Object / Element

Alcon の根幹。業務を「大きな入れ物 → 中ぐらいの入れ物 → 小さな実行単位」の 3 階層に落とす。

```
System (大) ── 組織・領域・テナントの最大単位
   └── Object (中) ── ∞ ネスト可能な構造単位
          └── Element (小) ── 最小の実行 / 記録単位
                 └── Subelement ── Element 内のチェックリスト項目
```

### System（大） — 最上位の入れ物

- **役割**: 組織・領域・契約のスコープを定義する。テナント分離の単位。
- **粒度**: 1 つの会社 / 病院 / 作戦 / 学校 など、独立して存在する「世界」1 つにつき 1 つ。
- **比喩**: SAP で言う Client、マルチテナント SaaS で言う Workspace。
- **現状**: 構造的にはトップレベル Object として表現されている（System 専用テーブルは未分離）。Phase 4 で正式に分離予定。

### Object（中） — ∞ ネスト可能な構造単位

- **役割**: System と Element の間を埋める、任意の階層の「入れ物」。
- **特性**:
  - 親 Object に対して**無限階層にネスト**できる（部門 → 部 → 課 → チーム…）
  - **Multi-homing**: 1 つの Object が複数の親 Object に同時所属できる
  - 自分自身に Tag・Ticket・Element を付けられる
- **比喩**: ファイルシステムのフォルダ。ただし複数の場所に同じ実体を置ける。

### Element（小） — 最小の実行 / 記録単位

- **役割**: 「やること」「記録すること」「管理対象」の最小単位。Alcon で標準化したいのはここ。
- **持つ情報**: `status` / `priority` / `start_date` / `due_date` / `due_time` / `estimated_hours` / `actual_hours` / `assignees` / `color` など、業務に共通する基本属性。
- **特性**:
  - **Multi-homing**: 1 つの Element が複数の Object に同時所属できる（例: 「コードレビュー」を Frontend と QA の両方に置く）
  - **Subelement**: Element 内に簡易チェックリストを持てる
  - **Tag** で業界固有の属性を後付けできる
- **業界語彙との対応**: タスク・患者・案件・仕訳・生徒・商品・目標 — 業界によって呼び名は変わるが、構造は同じ。

### 業界横断の対応例

3 階層は意図的に抽象的に保ってある。同じ構造で異なる業界を表現できる、というのが Alcon の核となる主張。

| 業界 | System | Object | Element |
|------|--------|--------|---------|
| **IT 企業** | 会社 | 部門 → プロジェクト → スプリント | タスク |
| **病院** | 病院 | 病棟 → 科 → 部屋 | 患者 |
| **軍事** | 作戦 | 地域 → 部隊 | 目標 |
| **製造業** | 工場 | ライン → 工程 | 作業指示 |
| **学校** | 学校 | 学部 → 学科 → クラス | 生徒 |
| **小売** | チェーン | 地域 → 店舗 → 部門 | 商品 |
| **会計** | 会社 | 年度 → 部門 → 勘定 | 仕訳 |

> **設計判断**: 「タスク」「患者」のような業界語彙は中核に持ち込まない。業界差は Tag と Widget のレイヤで吸収する。これにより、1 つのコードベースで業種をまたいだ運用ができる。

### Multi-homing — 複数親への所属

S/O/E のうち **Object と Element は複数の親に所属できる**（Asana の multi-homing と同じ発想）。

- **Object 例**: `Authentication` という Object を `Phase 1` と `Security` の両方の階層に配置
- **Element 例**: `コードレビュー` という Element を `Frontend` と `QA` の両方の Object に置く。実体は 1 つで、両方のリストから見える

実装上の補足は `web/src/types/database.ts` と migrations を参照（`object_parents` / `element_objects` の junction table と `is_primary` フラグで primary parent を識別）。

## 2.2 付随データ — Tag（タグ・メタデータ）

S/O/E に対して、構造はそのままに「**意味**」を後付けするレイヤ。S/O/E のいずれにも任意の構造化メタデータを付与できる。**ドッグタグ**のように、その対象が何者か・どんな属性を持つかを表現する。

業界差はここで吸収する。例えば「血液型」は病院だけが必要な Tag、「勘定科目」は会計だけが必要な Tag。中核を膨らませず、Tag 定義を増やすだけで対応する。

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

S/O/E が「**実行**の文脈」を表すのに対して、Ticket は「**思考**の文脈」を表す。戦略・議論・判断・構想・問い — まだ実行に落ちていない、Action（アーレント的な意味での）の単位。

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

S/O/E + Tag のデータを**表現する最小単位**が Widget。同じデータを、グラフ・リスト・カレンダー・地図・KPI など複数の形で見せ替えられるようにする。「ビュー」と呼ばれているもの（Dashboard / Overview / Summary など）は、すべて Widget の組み合わせとして実装される。

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

中核概念から見た機能マッピング：

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

業界特化の語彙（タスク、患者、案件）を中核に持ち込まない。**System / Object / Element / Tag / Ticket / Widget の 6 語**だけが普遍。

## 4.2 データ非依存

Widgetはデータの形だけを要求。バックエンドの変化（Multi-homing追加、Tag追加）でWidgetは壊れない。

## 4.3 ユーザー駆動の構造

開発者が組織を定義しない。**ユーザーが System/Object/Element を自由に組み立て、Tagで意味付けする**。

## 4.4 AI第一

Tag（構造化メタデータ）+ Ticket（思考の塊）が揃うことで、AIが意味のある提案・要約・自動化を行える。

## 4.5 段階的拡張

新機能は中核 6 概念のいずれかに紐付ける。新しいビュー = 新しい Widget。新しいプロパティ = 新しい Tag 型。

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
  ┌─────┴─────┐ ┌──┴────┐ ┌───┴───┐ ┌───┴────┐ ┌────┴────┐
  │ Alcon SEM │ │勘定系  │ │Alcon  │ │Alcon   │ │Alcon    │
  │ 戦略実行   │ │会計    │ │HR     │ │CRM     │ │DevOps   │
  │ ★現在開発中│ │       │ │       │ │        │ │         │
  └───────────┘ └───────┘ └───────┘ └────────┘ └─────────┘
```

| SAP モジュール | Alcon モジュール | Object 例 | Element 例 | 主要 Tag 例 |
|---------------|----------------|----------|-----------|-------------|
| FI/CO | **勘定系** | 部門 → 勘定 | 仕訳 | 金額・期日・勘定科目 |
| HR | **Alcon HR** | 部署 → チーム | 従業員 | 役職・スキル・評価 |
| SD | **Alcon CRM** | 商談フェーズ | 案件 | 金額・確度・顧客 |
| PP/PM | **Alcon DevOps** | スプリント | Issue | 工数・依存・PR |

## 6.2 共通基盤の設計原則

各モジュールは**独立したアプリ**だが、同じ Alcon Platform 上で動く。

```
共通基盤が提供:
├── Auth (認証・認可)     → 共通アカウント基盤
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
| **Next** | 2026 Q3-Q4 | Alcon SEM | マルチテナント、API、Realtime |
| **Later** | 2027 Q1-Q2 | **勘定系** | 独立アプリとして会計 MVP |
| **Future** | 2027 H2 | **Alcon HR / Alcon CRM** | HR + CRM をそれぞれ独立アプリとして検討 |
| **Vision** | 2028+ | **Alcon Platform** | 共通基盤の汎用化 |

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
| Canvas | 独自実装のドットグリッドキャンバス（BluePrint board） |

> DB スキーマやテーブル定義の最新は `web/src/types/database.ts` および Supabase migrations を参照。本書では中核概念との対応のみ扱う。

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
