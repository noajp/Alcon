# Alcon 統合企画書 v6

> **Alcon = All Context**
> すべての文脈を統合し、人間とAIが同じ地図で動く基盤

> 用語注記: 本書は現行コードベース（origin/main）の語彙に揃えてある。最上位の入れ物は **Domain**（旧称 System）、思考の塊は **Brief**（旧称 Ticket、可視化レイヤの旧称 BluePrint）と呼ぶ。

---

# Part 1: 哲学と目指したい方向

## 1.1 出発点 — なぜ Alcon か

Alcon = **All Context**。業務に散らばった文脈（誰が・何を・なぜ・どう動かしているか）を 1 つのデータモデルに集約し、人間と AI が同じ地図の上で動けるようにする、というのが出発点。

業界ごとに「タスク管理」「患者管理」「案件管理」「在庫管理」と別物に見える業務は、構造としては「**入れ物 + 実行単位 + メタデータ + 思考 + 表現**」に分解できる。Alcon はこの構造だけを基盤として提供し、業界語彙はユーザー側に委ねる。

## 1.2 ハンナ・アーレントの「人間の条件」から

思想的な出発点はアーレントの3区分。Alcon の中核概念はこの区分に対応している。

| 概念 | 原語 | 内容 | Alcon での対応 |
|------|------|------|----------------|
| **活動 (Action)** | Action | 他者と共に公共空間で何かを始める。価値判断・意思決定 | **Brief** — 戦略・議論・判断などの思考の塊 |
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

Alcon が目指すのは、ツールを増やすことではなく、**労働の最小単位（Element）と、それを束ねる構造（Domain / Object）を業界横断で共通化すること**。共通化された土台の上で次が成り立つ:

- **人間**は判断・創造（Action）に時間を使い、反復作業はツール側に押し戻す
- **AI**は構造化されたデータ（D/O/E + Tag）を読んで、提案・要約・自動化に参加できる
- **組織**はツールを乗り換えても文脈を失わない

「タスク管理ツール」ではなく、**業務の地図そのもの**を作る、というのが方向性。タスク管理・プロジェクト管理・ナレッジ管理・ダッシュボードはすべて、この地図の上の表現（Widget）として現れる。

---

# Part 2: 中核概念モデル

Alcon は **Domain / Object / Element / Tag / Brief / Widget** の 6 概念で世界を表現する。新しい機能・新しいビューはすべてこのいずれか（または組み合わせ）に紐付ける、というのが設計上の制約。

| カテゴリ | 概念 | 役割 |
|---------|------|------|
| 構造 | **Domain / Object / Element** | 業務の入れ物と実行単位 |
| メタ | **Tag** | D/O/E に付与する構造化メタデータ |
| 思考 | **Brief** | まだ実行に落ちていない判断・議論・構想 |
| 表現 | **Widget** | データを可視化する最小単位 |

## 2.1 大中小の 3 階層 — Domain / Object / Element

Alcon の根幹。業務を「大きな入れ物 → 中ぐらいの入れ物 → 小さな実行単位」の 3 階層に落とす。

```
Domain (大) ── 組織・領域・テナントの最大単位
   └── Object (中) ── Domain 直下のフラットな構造単位（multi-homing 可）
          └── Element (小) ── 最小の実行 / 記録単位
                 ├── Subelement ── Element 内のチェックリスト項目
                 └── element_edges ── Element 間の依存関係
```

### Domain（大） — 最上位の入れ物

- **役割**: 組織・領域・契約のスコープを定義する。テナント分離の単位。
- **粒度**: 1 つの会社 / 病院 / 作戦 / 学校 など、独立して存在する「世界」1 つにつき 1 つ。
- **比喩**: SAP で言う Client、マルチテナント SaaS で言う Workspace。
- **現状**: 独立した `domains` テーブルとして実装済（旧称 System から改称）。Object とは `object_domains` junction で結ばれる。

### Object（中） — Domain 直下のフラットな構造単位

- **役割**: Domain と Element の間を埋める「入れ物」。
- **特性**:
  - **フラット**: Object のネストは廃止済。Domain → Object の 2 階層に単純化した。
  - **Multi-homing**: 1 つの Object が複数の Domain に同時所属できる（`object_domains`）
  - 自分自身に Tag・Brief・Element を付けられる
  - Object 内タブ（`object_tabs`）で Board / Gantt / Calendar / Summary などのビューを持つ
- **比喩**: 複数の場所に同じ実体を置けるフォルダ（ただし入れ子にはしない）。

### Element（小） — 最小の実行 / 記録単位

- **役割**: 「やること」「記録すること」「管理対象」の最小単位。Alcon で標準化したいのはここ。
- **持つ情報**: `status` / `priority` / `start_date` / `due_date` / `due_time` / `estimated_hours` / `actual_hours` / `assignees` / `color` など、業務に共通する基本属性。
- **特性**:
  - **Multi-homing**: 1 つの Element が複数の Object に同時所属できる（例: 「コードレビュー」を Frontend と QA の両方に置く）
  - **Subelement**: Element 内に簡易チェックリストを持てる（AI は触らない）
  - **依存関係**: `element_edges` で Element 間の前後関係を表す
  - **Tag** で業界固有の属性を後付けできる
- **業界語彙との対応**: タスク・患者・案件・仕訳・生徒・商品・目標 — 業界によって呼び名は変わるが、構造は同じ。

### 業界横断の対応例

3 階層は意図的に抽象的に保ってある。同じ構造で異なる業界を表現できる、というのが Alcon の核となる主張。

| 業界 | Domain | Object | Element |
|------|--------|--------|---------|
| **IT 企業** | 会社 | 部門 / プロジェクト | タスク |
| **病院** | 病院 | 病棟 / 科 | 患者 |
| **軍事** | 作戦 | 地域 / 部隊 | 目標 |
| **製造業** | 工場 | ライン / 工程 | 作業指示 |
| **学校** | 学校 | 学部 / 学科 | 生徒 |
| **小売** | チェーン | 地域 / 店舗 | 商品 |
| **会計** | 会社 | 部門 / 勘定 | 仕訳 |

> **設計判断**: 「タスク」「患者」のような業界語彙は中核に持ち込まない。業界差は Tag と Widget のレイヤで吸収する。これにより、1 つのコードベースで業種をまたいだ運用ができる。

### Multi-homing — 複数親への所属

D/O/E のうち **Object と Element は複数の親に所属できる**（Asana の multi-homing と同じ発想）。

- **Object 例**: `Authentication` という Object を `Product` と `Security` の 2 つの Domain に同時配置（`object_domains`）
- **Element 例**: `コードレビュー` という Element を `Frontend` と `QA` の両方の Object に置く。実体は 1 つで、両方のリストから見える（`element_objects`）

実装上の補足は `web/src/types/database.ts` と migrations を参照（junction table と `is_primary` フラグで primary parent を識別）。

## 2.2 付随データ — Tag（タグ・メタデータ）

D/O/E に対して、構造はそのままに「**意味**」を後付けするレイヤ。**ドッグタグ**のように、その対象が何者か・どんな属性を持つかを表現する。

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
- **対象**: Domain / Object / Element に付与可能
- **再利用**: Tag定義は組織内で共有でき、複数の対象で同じTag定義を使える
- **AI可読性**: Tagは構造化されているのでAIが文脈を読み取れる

### 既存実装との対応
現在の Alcon では `custom_columns` + `custom_column_values` がこの Tag 機能を担う。UI 層は `alcon/tag/`（列定義・カスタム列セル・編集モーダル・`useCustomColumns`）。今後 **Tag** という統一概念名で再整理する。

## 2.3 思考の塊 — Brief（ブリーフ）

D/O/E が「**実行**の文脈」を表すのに対して、Brief は「**思考**の文脈」を表す。戦略・議論・判断・構想・問い — まだ実行に落ちていない、Action（アーレント的な意味での）の単位。

Brief は **Note から抽出された構造化スナップショット**として実装されている。Apple Notes 風のリッチテキスト（`notes` + `note_contents.html`）で自由に書いたものを、AI が overview / decisions / action_items / questions の構造に落とす。

```
Brief「Q3戦略：競合差別化」
  ├── overview:     「Notion と比べて Element の抽象化が強み」
  ├── decisions:    「Strategy を最優先に開発する」
  ├── action_items: → Element「Strategy ビューの実装」を生成
  └── questions:    「multi-homing の UX をどう見せるか」
```

### Briefの特性

- **Note 起点**: 自由記述の Note（`notes` / `note_contents.html`）から AI が構造を抽出（`summarize-note` Edge Function）
- **多対多接続**: 1 つの Brief は複数の Object や Element に紐付け可能
- **進化**: Brief 内の議論が成熟したら → Object / Element 化（`draft-object` で Object 草案を生成）
- **AI協働**: Claude API と対話しながら思考を深められる
- **永続**: `briefs` / `brief_comments` テーブル

### 既存実装との対応
- **Note**（`alcon/brief/editor/AppleNoteEditor`）が Brief のドキュメント形式（独自の HTML エディタ + `htmlSanitizer`。旧 BlockNote は廃止）
- **Brief**（`briefs`）が Note から抽出した構造化スナップショット（旧 Ticket。旧 BluePrint キャンバスは廃止）

## 2.4 表現単位 — Widget（ウィジェット）

D/O/E + Tag のデータを**表現する最小単位**が Widget。同じデータを、グラフ・リスト・カレンダー・地図・KPI など複数の形で見せ替えられるようにする。「ビュー」と呼ばれているもの（Dashboard / Overview / Summary など）は、すべて Widget の組み合わせとして実装される。

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
3. **永続化**: ユーザー毎・スコープ毎にレイアウト保存（localStorage）
4. **拡張可能**: 新しいTag型が追加されたら、それを表現する新Widgetが追加される

### 既存実装との対応
- 現在の **WidgetGrid** + 各 widget（KPI / Status / Priority / Gantt / Calendar / Milestones / Roster / Activity / Overdue / Upcoming / ObjectProgress / ProjectBrief）がこの基盤
- 各ビュー（Home Dashboard / Object Overview / Object Summary）は「同じ Widget 基盤の上の異なるプリセット」

---

# Part 3: 機能群の整理

中核概念から見た機能マッピング：

```
                  ┌────────────────────────────────────────┐
                  │            Alcon Platform                │
                  └─┬──────────┬──────────┬──────────┬─────┘
                    │          │          │          │
              ┌─────▼─────┐  ┌─▼─────┐  ┌─▼─────┐  ┌─▼─────────┐
              │ D / O / E │  │  Tag  │  │ Brief │  │  Widget   │
              │  3階層    │  │メタ   │  │思考   │  │  表現      │
              └─────┬─────┘  └─┬─────┘  └─┬─────┘  └─┬─────────┘
                    │          │          │          │
        ┌───────────┼──────────┼──────────┼──────────┼───────────┐
        │           │          │          │          │           │
  ┌─────▼───┐  ┌────▼─────┐ ┌─▼──────┐ ┌─▼──────┐ ┌─▼────────┐
  │Domain   │  │Element   │ │Custom  │ │Note +  │ │Dashboard │
  │/ Object │  │List      │ │Columns │ │Brief   │ │Widgets   │
  │(Sidebar)│  │(List Tab)│ │(=Tag)  │ │(=Brief)│ │(Recharts)│
  └─────────┘  └──────────┘ └────────┘ └─────────┘ └──────────┘
                                                    ┌──────────┐
                                                    │ Gantt    │
                                                    │ Calendar │
                                                    │ KPI ...  │
                                                    └──────────┘
```

## 3.1 機能カテゴリ

### A. 構造管理 (D/O/E)
- **Domain Switcher / DomainsView** (サイドバー): Domain のナビゲーション
- **Object** (Execution): Domain 直下のフラットな Object、Board / Gantt / Calendar / Summary タブ
- **Element List** (List): スプレッドシート型、セクション、フィルタ/グループ/ソート（`listControls`）
- **Multi-homing**: Object を複数 Domain、Element を複数 Object に所属させる
- **Workers + Assignees**: 人間 / AIエージェント / ロボットを Element に割当

### B. メタデータ管理 (Tag)
- **Custom Columns** (現実装): 任意のカラム型を追加
- **Tag Library** (将来): 組織で共有可能なTag定義
- **Tag-driven Search/Filter**: TagでElementを絞り込み

### C. 思考管理 (Brief)
- **Note** (AppleNoteEditor): リッチテキストドキュメント（folder/file ツリー）
- **Brief**: Note から AI が抽出する構造化スナップショット（overview / decisions / action_items / questions）
- **Strategy**: 戦略レイヤ（`strategies` / Object 紐付け / タイムライン）

### D. 表現 (Widget)
- **Dashboard** (Home / Object Summary): プリセット+カスタマイズ可能なWidget配置
- **Object Overview**: Project Brief / Team / Activity / Milestones
- **Standard Widgets**:
  - KPI Cards (完了率/Active/Overdue/Hours)
  - Status / Priority Distribution
  - Gantt / Calendar (Day/Week/Month)
  - Recent Activity / Team Roster / Milestones
  - Object Progress / Overdue / Upcoming
- **Tag-driven Widgets** (将来): Map / Heatmap / Funnel / Custom Chart

## 3.2 周辺サブシステム（中核 6 概念の上の実装群）

| サブシステム | 役割 | 主要テーブル / モジュール |
|---|---|---|
| **Worker** | 人間 / AIエージェント / ロボットの統一ID | `workers` / `element_assignees` |
| **Strategy** | 戦略レイヤ（Brief から実行へ橋渡し） | `strategies` / `strategy_objects` / `strategy_children` / `alcon/element/actions/` |
| **Agent (Workpad)** | AIエージェントが Element を実行 → 人間が承認 | `agent_runs` / `agent_run_steps` / `alcon/element/agent/` / `run-agent` |
| **Craft Studio** | AI が canvas / doc 成果物を生成 | `alcon/element/craft/`（localStorage） |
| **Room** | Discord 風 Text/Voice チャンネル + ビデオ会議・字幕・議事録 | `rooms` / `channels` / `messages` / `voice_meeting_minutes` / `voice_transcript_lines` |
| **Chat** | 1:1 / グループ DM（Room とは別系統） | `conversations` / `conversation_members` / `messages` |
| **Copilot** | 画面横断の AI パネル | `alcon/copilot/` / `alcon-copilot` |

---

# Part 4: 設計原則

## 4.1 抽象を保つ

業界特化の語彙（タスク、患者、案件）を中核に持ち込まない。**Domain / Object / Element / Tag / Brief / Widget の 6 語**だけが普遍。

## 4.2 データ非依存

Widgetはデータの形だけを要求。バックエンドの変化（Multi-homing追加、Tag追加）でWidgetは壊れない。

## 4.3 ユーザー駆動の構造

開発者が組織を定義しない。**ユーザーが Domain/Object/Element を自由に組み立て、Tagで意味付けする**。

## 4.4 AI第一

Tag（構造化メタデータ）+ Brief（思考の塊）が揃うことで、AIが意味のある提案・要約・自動化を行える。AI は Worker として基盤に内包され、Agent (Workpad) で Element を実行する。

## 4.5 段階的拡張

新機能は中核 6 概念のいずれかに紐付ける。新しいビュー = 新しい Widget。新しいプロパティ = 新しい Tag 型。

---

# Part 5: ロードマップ

## Phase 1: Core Platform ✅ 完了

- [x] Domain / Object / Element の 3 階層（Domain は独立テーブル化済）
- [x] Object のフラット化 + Object multi-homing（`object_domains`）
- [x] Element テーブルビュー + multi-homing（`element_objects`）+ 依存関係（`element_edges`）
- [x] Custom Columns（Tag 実装）
- [x] Workers + Assignees（human / ai_agent / robot）
- [x] Note（AppleNoteEditor）+ Brief 抽出

## Phase 2: Collaboration 🔄 進行中

- [x] Room（Text/Voice チャンネル）
- [x] Room ビデオ会議・ライブ字幕・議事録
- [x] Chat（1:1 / グループ DM）
- [ ] リアルタイム同期（Supabase Realtime）の全面適用
- [ ] 通知システム / Presence インジケーター

## Phase 3: Intelligence 🔄 進行中

- [x] Brief（Note → 構造化スナップショット、`summarize-note`）
- [x] Strategy レイヤ（戦略 → Object/Element）
- [x] Agent (Workpad)：AIエージェント実行 + 承認フロー（`run-agent`）
- [x] Craft Studio：AI 成果物生成
- [x] Alcon Copilot：横断 AI パネル（`alcon-copilot`）
- [x] Analytics ダッシュボード（Widget 基盤）
- [x] Calendar Day/Week/Month ビュー（時刻対応）
- [ ] Tag Library（Custom Columns を Tag に再構成）
- [ ] Tag-driven Widget（位置Tag → Map Widget 等）

## Phase 4: Enterprise 📋 計画段階

- [ ] Domain レベルのマルチテナント分離の厳格化
- [ ] RLS強化
- [ ] REST API / Webhook
- [ ] セキュリティ監査 / SOC2準備

---

# Part 6: 将来ビジョン — Alcon App Suite

## 6.1 SAPモデル: 独立モジュール群

SAPが ERP を FI/CO（財務）/ HR（人事）/ SD（販売）と独立モジュールで構成しているように、Alconも業務領域ごとに**別アプリ**として展開する。

各モジュールは独立アプリだが、共通基盤（Auth / Domain / Object / Element / Tag / Brief / Widget / Worker / AI Engine）を共有するため、データが自然に繋がる。

```
                    ┌─────────────────────────────┐
                    │    Alcon Platform (共通基盤)  │
                    │  Auth · D/O/E · Tag · Brief  │
                    │  Widget · Worker · AI Engine │
                    └──────────┬──────────────────┘
                               │
        ┌──────────┬───────────┼───────────┬──────────┐
        │          │           │           │          │
  ┌─────┴─────┐ ┌──┴────┐ ┌───┴───┐ ┌───┴────┐ ┌────┴────┐
  │ Alcon SEM │ │Kanjo  │ │Alcon  │ │Alcon   │ │Alcon    │
  │ 戦略実行   │ │-kei   │ │HR     │ │Sales   │ │DevOps   │
  │ ★現在開発中│ │会計    │ │       │ │        │ │         │
  └───────────┘ └───────┘ └───────┘ └────────┘ └─────────┘
```

| SAP モジュール | Alcon モジュール | Object 例 | Element 例 | 主要 Tag 例 |
|---------------|----------------|----------|-----------|-------------|
| FI/CO | **Kanjo-kei（会計）** | 部門 / 勘定 | 仕訳 | 金額・期日・勘定科目 |
| HR | **Alcon HR** | 部署 / チーム | 従業員 | 役職・スキル・評価 |
| SD | **Alcon Sales** | 商談フェーズ | 案件 | 金額・確度・顧客 |
| PP/PM | **Alcon DevOps** | スプリント | Issue | 工数・依存・PR |

## 6.2 共通基盤の設計原則

各モジュールは**独立したアプリ**だが、同じ Alcon Platform 上で動く。

```
共通基盤が提供:
├── Auth (認証・認可)     → 共通アカウント基盤
├── D/O/E                → 統一データモデル
├── Tag                  → メタデータ機構
├── Brief                → 思考管理
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
| **Now** | 2026 | Alcon SEM | D/O/E + Tag + Brief + Widget + Room/Chat + Agent の基盤 |
| **Next** | 2026 H2 | Alcon SEM | マルチテナント、API、Realtime |
| **Later** | 2027 | **Kanjo-kei（会計）** | 独立アプリとして会計 MVP |
| **Future** | 2027 H2 | **Alcon HR / Alcon Sales** | HR + Sales をそれぞれ独立アプリとして検討 |
| **Vision** | 2028+ | **Alcon Platform** | 共通基盤の汎用化 |

詳細なモジュール展開は `Project/00_企画/将来マイルストーン.md` を参照。

---

# Part 7: 技術スタック（現状）

| レイヤー | 技術 |
|---------|------|
| Frontend | Next.js 16 (App Router, Turbopack) |
| Styling | Tailwind CSS, shadcn/ui, Radix UI |
| Charts | recharts |
| Backend | Supabase (PostgreSQL, Auth, Edge Functions, Realtime) |
| AI | Claude API via Supabase Edge Functions（`alcon-copilot` / `summarize-note` / `draft-object` / `run-agent` / `generate-object-report` / `analyze-change` / `validate-task` / `voice-summarize`） |
| Deployment | Vercel |
| DnD | @dnd-kit/core, @dnd-kit/sortable |
| Editor | 独自の AppleNoteEditor（HTML + htmlSanitizer。旧 BlockNote は廃止） |

> DB スキーマやテーブル定義の最新は `web/src/types/database.ts` および Supabase migrations を参照。本書では中核概念との対応のみ扱う。

---

# Appendix: 用語集

| 用語 | 定義 |
|------|------|
| **Domain** | 最上位の入れ物。テナント・組織・領域（旧称 System） |
| **Object** | 中間の構造単位。Domain 直下のフラット・Multi-homing 可能 |
| **Element** | 最小の実行/記録単位。タスク・患者・案件・仕訳・商品など |
| **Subelement** | Element内のチェックリスト項目（AIは触らない） |
| **Tag** | D/O/Eに付与する構造化メタデータ。ドッグタグ的役割（`custom_columns`） |
| **Brief** | 思考の塊。Note から抽出した構造化スナップショット（旧称 Ticket / BluePrint） |
| **Note** | Brief の元になるリッチテキスト（AppleNoteEditor） |
| **Widget** | データを表現する最小単位。グラフ・リスト・地図など |
| **Worker** | 人間 / AIエージェント / ロボット。Elementにアサインされる |
| **Strategy** | 戦略レイヤ。Brief と実行（Object/Element）の橋渡し |
| **Agent (Workpad)** | AIエージェントの実行ログと承認フロー |
| **Room / Chat** | Room = チャンネル制コラボ、Chat = DM/グループ |

---

# 開発コマンド

```bash
cd web && npm run dev          # 開発サーバー
cd web && npm run build        # 本番ビルド
cd web && npx tsc --noEmit     # TypeScript型チェック（変更後に必ず実行）
cd web && npm run lint         # ESLint
npx vercel --prod              # 本番デプロイ
```

**Supabase Project ID**: `rkugtcqztkkacvoylupw`
**Production URL**: https://alcon-ashy.vercel.app
