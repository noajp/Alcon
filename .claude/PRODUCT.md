# Alcon — Product Overview & Design Philosophy

## プロダクト概要

Alcon は「あらゆる業務を少数の概念で抽象化する」Strategy & Execution SaaS。病院・企業・軍事作戦など業界を問わず、業界非依存の構造抽象で組織の計画と実行を管理する。

既存ツール（Asana, Notion, Jira 等）が業界固有のメタファーに縛られるのに対し、Alcon は「構造単位 (Object)」と「構造の最小単位 (Element)」という普遍抽象を提供する。

## 概念アーキテクチャ

### 3 層構成

Alcon の概念モデルは「抽象→具象」の 3 層で構成される：

```
┌─────────────────────────────────────────────┐
│  Action 層 — Strategy                       │
│  意図・戦略・可視化（抽象的活動の支援）       │
├─────────────────────────────────────────────┤
│  Execution 層 — Domain / Object / Element   │
│  実行単位の格納と管理（具体的活動の実行）     │
├─────────────────────────────────────────────┤
│  Property — 実行単位に付与されるメタデータ    │
└─────────────────────────────────────────────┘

  ＋ 活動支援機能 — Note / Chat / Room
     ユーザーの活動的行動を支える横断機能
```

### Action 層：Strategy

Strategy は Execution 層を**包含するフォルダ**のような存在。個々の実行（Object/Element）ではなく、それらを束ねて「なぜやるか」「どこへ向かうか」を示す。

| 役割 | 詳細 |
|------|------|
| 意図の明示 | 複数 Object にまたがる目標を言語化し、方向性を揃える |
| 戦略の構造化 | Object 群を Strategy 配下にグルーピングし、依存関係を可視化 |
| 俯瞰の可視化 | Timeline（Gantt）/ Resource（負荷グラフ）で進捗と能力配分を一望 |

Strategy は `strategy_objects` junction で複数 Object を束ねる Domain 横断エンティティ。Shell 内ビュー：
- **Strategy**：参加 Object の List / Grid
- **Timeline**：配下 Object の期間・マイルストーン Gantt
- **Resource**：参加 Worker の日次負荷（面グラフ）

### Execution 層：Domain / Object / Element

Action 層の計画が「実際の実行単位」になったものを格納し管理する機能群。

| 概念 | 役割 | 構造ルール |
|------|------|-----------|
| **Domain** | 最上位の入れ物 | localStorage 永続。組織・プロジェクト空間の切替単位 |
| **Object** | 構造単位 | Domain 直下のみ（フラット、ネスト禁止）。multi-homing は `object_domains` |
| **Element** | 最小の実行単位 | Object に所属。multi-homing 可（`object_id` + `element_objects` junction） |

Object は「箱」、Element は「中身」。箱は一段しかなく、中身は複数の箱に同時に入れられる。

### Property：実行単位のメタデータ

Execution 層の D/O/E に付与される型付きメタデータ列。EAV 的構造：
- `custom_columns`：列定義（名前・型・選択肢等）
- `custom_column_values`：各エンティティの値

これにより、業界ごとに異なる属性（血液型、期限、予算、担当者…）を同一の仕組みで表現する。

### 活動支援機能：Note / Chat / Room

ユーザーの活動的行動を支える機能群。Execution 層の「管理」とは異なり、思考・記録・対話を直接支援する。

| 機能 | 性質 | 実装 |
|------|------|------|
| **Note** | 思考・記録 | Apple Notes 風 HTML エディタ。フォルダ/ファイルのツリー構造 |
| **Room** | チーム対話 | Slack 的チャンネルベース。Text/Voice。`channels` + `messages` |
| **Chat** | 個人対話 | 1:1 / グループ DM。`conversations` + `messages` |

Room と Chat は別系統。「場に人が集まる」vs「人と人が繋がる」の違い。

## UI デザイン原則

### レイアウト哲学
- **常時可視ナビ + 折りたためる文脈ペイン + メインキャンバス** の 3 列構成
- ModeRail は「アプリのモード」を切替え（Home / Room / Chat / Note）、AppSidebar は「モード内のナビ」
- Sidebar 内の Action Space / Execution Space が概念モデルの Action 層 / Execution 層に直接対応

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
- **Worker = human | ai_agent** — 同一テーブルで人的リソースと AI エージェントを管理

## 境界と権限（Boundary & Permissions）

組織の信頼境界は **ActivitySpace**。Linear 型の二層メンバーシップで人を所属させる。

- **二層の所属** — Space メンバー（`activity_space_members`：owner/member）＝組織の正規メンバー。Domain メンバー（`domain_members`）＝その Domain だけに招かれた人。Object メンバー（`object_members`）はさらに細かい Object 限定の同席者（通常 domain_members の部分集合、Object 限定ゲストも可）。
- **Guest** — `domain_members` だが Space 非メンバーの人。招かれた Domain しか見えず、組織の他 Domain 構造は一切露出しない。他組織の人を招いても相手の Space は混ざらない（Domain は `activity_space_id` で1つの Space に属したまま、相手には「Shared with me」として現れる）。
- **Domain 可視性 `domains.privacy`** — `workspace`＝同じ Space のメンバー全員が閲覧可。`private`＝`domain_members` のみ。
- **可視性カスケード** — Domain 可視 ⇔ domain_member、または（`workspace` かつ Space メンバー）。Object 可視 ⇔ object_member、または所属 Domain が可視。Element 可視 ⇔ 所有者、または所属 Object が可視。
- **サーバーで強制** — 上記は SECURITY DEFINER ヘルパー（`user_can_see_domain` / `user_can_see_object` / `user_can_see_element`）として RLS に組み込む。クライアント表示任せにしない。横断取得 RPC `get_explorer_data` も同じ可視性で Object/Element を返す。
- **招待 UI** — Space 招待は ActivitySpace 設定（owner のみ）、Domain 招待（Guest 化）は Domain の Team 設定から。

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
