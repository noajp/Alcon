# Alcon — Product Overview & Design Philosophy

## プロダクト概要

Alcon は「あらゆる業務を少数の概念で抽象化する」Strategy & Execution SaaS。病院・企業・軍事作戦など業界を問わず、業界非依存の構造抽象で組織の計画と実行を管理する。

既存ツール（Asana, Notion, Jira 等）が業界固有のメタファーに縛られるのに対し、Alcon は「構造単位 (Object)」と「構造の最小単位 (Element)」という普遍抽象を提供する。

## 概念アーキテクチャ

### 3 層カスケード

人の営みには「消えるもの」と「残るもの」がある。会話や意図は発した瞬間から消えていき、文書や計画は形として残る。しかし実際の現場では、計画は実行と噛み合わず、議事録は議論から切り離され、タスクはそもそもの意図を失っている。

Alcon はこの変換を、上流（揮発する活動）から下流（具体的な実行）へと文脈を切らさず流す 3 層のカスケードで構造化する。

```
┌─────────────────────────────────────────────────────┐
│  Action（活動）— Chat / Talk                         │
│  会話・議論・意思のやりとり。本質的に揮発する         │
├─────────────────────────────────────────────────────┤
│  Materialization（具体化）— Note / Strategy / Diagram │
│  活動から抽出された耐久的な成果物                     │
├─────────────────────────────────────────────────────┤
│  Execution（実行）— Domain / Object / Element        │
│  成果物を実行単位として格納し、進捗・責任・状態を追跡 │
└─────────────────────────────────────────────────────┘
  ＋ Home（横断）   — My Elements / Inbox
  ＋ Property       — 実行単位に付与するメタデータ
```

ワークスペースの最上位コンテナを **Activity Space** と呼ぶため、第 1 層は語の衝突を避けて **Action（活動）** と名付ける。ModeRail の 4 セレクタ Home / A / M / E がこの構造（Home＋Action / Materialization / Execution）に直接対応する。

### Action 層：Chat / Talk

消えていく活動。会話・意図・やりとりそのもの。記録ではなく、いま起きている対話を支える。

| 機能 | 性質 | 実装 |
|------|------|------|
| **Chat** | 個人対話（1:1 / グループ DM） | `conversations` + `messages` |
| **Talk** | チャンネル制のリアルタイム会話 | `channels` + `messages`（コード上は `room/` モジュール） |

Talk と Chat は別系統。「場に人が集まる（チャンネル）」vs「人と人が繋がる（DM）」の違い。

### Materialization 層：Note / Strategy / Diagram

Action の消えるやりとりを、世界に残る耐久物へ変換する。

| 機能 | 役割 | 実装 |
|------|------|------|
| **Note** | 思考・記録のドキュメント（議事録 / メモ） | 独自 HTML エディタ（`AppleNoteEditor` + `htmlSanitizer`）。**Folder → File の 2 階層**ツリー |
| **Strategy** | 複数 Object を束ね、計画と進捗を俯瞰 | `strategy_objects` junction で Domain 横断にグルーピング |
| **Diagram** | 抽象を図として可視化 | — |

**Note の階層** — Folder は Activity Space 直下にフラットに並び、File はその中に入る。Folder 一覧は左サイドバー、選択中 Folder の File 一覧は中ペイン（FilesPane）、編集は右の PageView。

**Strategy** は Execution 層を**束ねるフォルダ**のような存在。個々の実行（Object / Element）ではなく、それらを集約して「なぜやるか」「どこへ向かうか」を示す。Shell 内ビュー：
- **Strategy**：参加 Object の List / Grid
- **Timeline**：配下 Object の期間・マイルストーン Gantt
- **Resource**：参加 Worker の日次負荷（面グラフ）

### Execution 層：Domain / Object / Element

Materialization で具体化された計画を「実際の実行単位」として格納し管理する機能群。

| 概念 | 役割 | 構造ルール |
|------|------|-----------|
| **Domain** | 最上位の入れ物 | localStorage 永続。組織・プロジェクト空間の切替単位（病院 / 会社 / 作戦） |
| **Object** | 構造単位 | Domain 直下のみ（フラット、ネスト禁止）。multi-homing は `object_domains` |
| **Element** | 最小の実行単位 | Object に所属。multi-homing 可（`object_id` + `element_objects` junction） |

Object は「箱」、Element は「中身」。箱は一段しかなく（ネストしない）、中身は複数の箱に同時に入れられる。

### Home — 横断サーフェス

層に属さない個人ビュー。

| 機能 | 役割 |
|------|------|
| **My Elements** | 自分が所有・アサインされた Element を横断表示 |
| **Inbox** | 通知フィード |

### Property：実行単位のメタデータ

Execution 層の D/O/E に付与される型付きメタデータ列。EAV 的構造：
- `custom_columns`：列定義（名前・型・選択肢等）
- `custom_column_values`：各エンティティの値

これにより、業界ごとに異なる属性（血液型、期限、予算、担当者…）を同一の仕組みで表現する。

## UI デザイン原則

### レイアウト哲学
- **常時可視ナビ + 折りたためる文脈ペイン + メインキャンバス** の 3 列構成
- **ModeRail**（38px）は層セレクタ：Home / Action / Materialization / Execution（A/M/E）＋下部に Discover / Settings
- **AppSidebar** は層内のナビ。最上部に Space 名（`SpaceSwitcher`）＋アプリランチャー。本体は現在の層に応じて切替（Home＝My 項目 / Action＝Chat・Talk / Materialization＝Note ツリー or Strategy / Execution＝Domain Tree＋Data＋Reference）
- 層 id→文字 / ラベル / アプリは `shell/layers.ts` の単一情報源

### ビジュアル原則
- 入力フィールドにボーダー/リングを付けない。背景色の差だけでフィールドを示す
- IslandCard でメイン領域を囲む角丸カード。コンテンツが「浮いている」感覚
- ミニマルで静かな UI。装飾よりも情報密度を優先
- CommandPalette (⌘K) で何にでもジャンプ。マウス操作を最小化

### Object Detail（TabBar 内ビュー群）
| タブ | 機能 |
|------|------|
| Dashboard | Object 固有の KPI / Widget |
| List | Element 一覧（フィルタ / ソート / グルーピング） |
| Overview | Object のメタ情報・説明 |
| Gantt | Element の期間を Gantt チャート表示 |
| Calendar | Element を日/週/月カレンダー表示 |
| Workers | Object 内の Worker 一覧・アサイン管理 |
| Resource | Worker × 日次負荷の面グラフ |
| Board | Kanban ボード |
| Note | Object 固有の Notes |

## データ設計原則

- **RLS everywhere** — 全テーブルに Row Level Security
- **Junction テーブルで多対多** — `element_objects`, `strategy_objects`, `object_domains`
- **Property は EAV 的** — `custom_columns` + `custom_column_values` で任意メタデータ
- **Domain は localStorage 永続** — サーバーに持たず、クライアント側で切替
- **Note は 2 階層** — `notes`（Folder→File ツリー、Folder はルート）+ `note_contents.html`
- **Worker = human | ai_agent** — 同一テーブルで人的リソースと AI エージェントを管理

## AI 連携

Claude API を Supabase Edge Functions 経由で利用：
- `alcon-copilot`：汎用 AI アシスタント
- `run-agent`：エージェント実行
- `draft-object`：Object 自動生成
- `generate-object-report`：レポート生成
- `summarize-note`：Note 要約
- `analyze-change`：変更分析
- `validate-task`：Element 検証
- `voice-summarize`：音声要約

## 拡張計画（Vision）

### SAP モジュール型展開

将来は独立アプリ群として展開する：

| モジュール | 領域 | 状態 |
|-----------|------|------|
| **Alcon SEM** | Strategy & Execution Management | 現在開発中 |
| **Kanjo-kei** | 会計・仕訳管理 | 構想段階 |
| **HR** | 人事・勤怠・評価 | 構想段階 |
| **Sales** | 営業・CRM | 構想段階 |

### 共通基盤（全モジュール共有）

各モジュールは別リポ・別デプロイだが、以下の基盤を共有する：
- **Domain / Object / Element** — 構造の骨格
- **Property** — カスタムメタデータ
- **Note** — ドキュメント基盤
- **Widget** — ダッシュボード基盤
- **Worker** — 人的 / AI リソース管理
- **AI (Copilot)** — Claude 連携基盤

### 技術的方向性

- monorepo 化は行わない。各モジュールが独立してデプロイ可能
- 共通基盤は npm パッケージまたは共有 Supabase スキーマとして提供
- 認証・Domain 管理は共通ゲートウェイで統一
