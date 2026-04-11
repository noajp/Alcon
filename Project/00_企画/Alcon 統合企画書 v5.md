# Alcon 統合企画書 v5

> 世界最高のタスク管理ツール

Alconは、タスク（Element）を中核に据え、あらゆる付随情報を「カード」として独立管理・多対多接続できる、次世代ワークマネジメントプラットフォームです。

**重要な視点**: このツールは「開発者が組織を作る」のではなく、「ユーザーが自分の組織構造を自由に構築し、プロジェクトを管理する」ためのものです。設計時は常に俯瞰して抽象化し、特定のユースケースに縛られない柔軟性を持たせること。

---

# Part 1: ビジョンと哲学

## 1.1 ハンナ・アーレントの「人間の条件」から

アーレントは人間の活動を3つに分類した：

| 概念 | 原語 | 内容 | Alconでの対応 |
|------|------|------|---------------|
| **活動 (Action)** | Action | 他者と共に公共空間で何かを始める。政治的・人間的営み | カードを通じた協働 |
| **仕事 (Work)** | Work | 耐久的な人工物を作る。世界に「モノ」を残す創造的営み | `Object`（構造設計） |
| **労働 (Labor)** | Labor | 生命維持のための反復的活動。消費されて何も残らない | `Elements`（実行単位） |

**そして、3つを結ぶもの:**

| 概念 | 役割 | Alconでの対応 |
|------|------|---------------|
| **判断 (Decision)** | 活動・仕事・労働を繋ぎ、意味を与える | `Decision`（ジョイント） |

## 1.2 現代ホワイトカラーの問題

現代のホワイトカラーワークの多くは、**「仕事に見える労働」** である。

```
労働（本来は標準化可能）
  ↓
道具がバラバラ（Slack, Excel, Notion, 独自システム...）
  ↓
解釈の余地が発生（誰がどう積み上げるかが属人化）
  ↓
労働なのに「仕事」的コストが発生
  ↓
生産性の低下
```

**問題の本質**: 生産性が低い道具を使っているから、労働にも「仕事的余地」（解釈の余地があり、積み上げる個人によって積み上げ方が違う状態）が発生している。

## 1.3 Alconの解決策

**労働の最小単位を統一する。**

どの会社でも、どの業界でも、積み上げるべき「1つの単位」は同じ形をしている。

この一貫性により：
- 労働から「解釈の余地」を排除
- 誰がやっても同じ積み上げ方になる
- 労働は労働として効率化される
- **人間は本当の「仕事」と「活動」に集中できる**

## 1.4 ビジョン

> 「労働を標準化し、人間を創造と活動に解放する」

Alconは単なるタスク管理ツールではない。
ホワイトカラーの「仕事に見える労働」を標準化し、人間が本当に価値ある判断と創造に集中できる世界を実現するプラットフォーム。

## 1.5 コンセプト

**「タスクを中核に、すべての情報がカードとして生きる、世界最高のワークマネジメントプラットフォーム」**

- タスク（Element）がすべての起点
- 付随情報はカード（独立したNode）として管理
- カードは複数のElementに多対多で接続可能
- AIがカード間の関連性・矛盾を自動検出

---

# Part 2: Core Concepts

## 2.1 アーキテクチャ概要

```
Object（構造設計）
└── Element（実行単位 ＝ タスクの中核）
    ├── Subelement（チェックリスト）
    └── Card（付随情報 ＝ 独立したNode）
         ├── 他のElementにも接続可能（多対多）
         └── AIが関連性・矛盾を自動検出

Decision（ジョイント）
├── Object ↔ Element を結ぶ
├── Element ↔ Element を結ぶ
└── 判断の理由・代替案・トレードオフを記録
```

## 2.2 各コンポーネントの役割

| コンポーネント | アーレントの概念 | 役割 | 特徴 |
|---------------|----------------|------|------|
| **Object** | 仕事 (Work) | 構造・設計単位 | 入れ子可能、プロジェクトや部門を表現 |
| **Element** | 労働 (Labor) | 実行単位（タスクの中核） | 標準化、誰がやっても同じ結果 |
| **Subelement** | 労働 (Labor) | 実行単位の構成要素 | チェックリスト的な細分化 |
| **Card** | 活動 (Action) | 付随情報の独立Node | 再利用可能、多対多接続、AIが読み取り可能 |
| **Decision** | （ジョイント） | 判断の記録 | 依存関係、責任根拠を付与 |
| **Edge** | （接続） | Card ↔ Element の接続 | 多対多の関連付け |

## 2.3 Card（カード）の設計思想

### 従来のタスク管理ツールの問題

AsanaやNotionでは、タスクに付随する情報（Description、コメント、仕様メモなど）はそのタスクの中に埋もれる。書いた情報はそこで死に、他のタスクから参照できず、AIが構造的に活用することもできない。

### Alconのカード方式

カードは **Loop的な独立性・再利用性** + **Edge（グラフ構造）による多対多の紐づけ** + **AIによる自動関連付け・矛盾検出** を兼ね備えた情報単位。

```
タスク「API設計」
├── Card: 仕様メモ ──→ 同時に「DB設計」タスクにも接続
├── Card: 参考リンク集
├── Card: 議事録の要点 ──→ 同時に「UI設計」タスクにも接続
└── Card: テスト要件

タスク「DB設計」
├── Card: 仕様メモ（← API設計と同じカード）
├── Card: ER図
└── Card: パフォーマンス要件
```

### カードの種類

| カード種別 | 説明 | ユースケース |
|-----------|------|-------------|
| **Document** | リッチテキスト | 仕様書、議事録、手順書 |
| **Table** | 構造化データ | 比較表、データ一覧、見積もり |
| **Link** | 外部リソース参照 | 参考URL、関連ドキュメント |
| **File** | ファイル添付 | 画像、PDF、デザインファイル |
| **Note** | 短いメモ | ひとこと補足、注意事項 |
| **Checklist** | チェックリスト | 確認項目、レビューポイント |

### カードの特性

- **独立性**: カードはElementとは独立したNodeとして存在する
- **再利用性**: 1つのカードを複数のElementに接続できる（多対多）
- **追跡性**: カードの編集履歴が追跡される
- **AI可読性**: AIがカードの内容を構造的に読み取り、関連性や矛盾を検出できる
- **リンク同期**: あるElementでカードを更新すると、接続されたすべてのElementに反映される

## 2.4 Decision（判断）の設計

**Decisionは「ノード」ではなく「エッジ（ジョイント）」として設計する。**

```
Decision = ジョイント（接続）
├── source_type: 'object' | 'element'
├── source_id: UUID
├── target_type: 'object' | 'element'
├── target_id: UUID
├── relation: 'creates' | 'decomposes' | 'prioritizes' | 'assigns' | 'terminates'
├── rationale: 判断理由（なぜこう繋いだか）
├── alternatives: 他にどんな選択肢があったか
├── trade_off: 何を諦めたか
├── decided_by: Worker（誰が判断したか）
└── decided_at: タイムスタンプ
```

**Decisionの例**:
- Object「新機能開発」 → Decision「こう分解すると決定」 → Element「API設計」「UI実装」
- Element「API設計」 → Decision「この人に任せると決定」 → Worker「山田」
- Element「API設計」 → Decision「仕様変更」 → Element「DB設計」に影響

**Decisionの価値**:
- 「なぜこの判断をしたか」が常に追跡可能
- 承認フロー・履歴はDecisionを可視化したものに過ぎない
- AIが過去の判断パターンを学習できる
- 組織の意思決定プロセスが可視化される

## 2.5 Edge（接続）の設計

Edgeは Card ↔ Element の多対多接続を管理する。

```
Edge
├── card_id: UUID
├── element_id: UUID
├── attached_by: Worker（誰が接続したか）
├── attached_at: タイムスタンプ
└── context: なぜこのカードをこのElementに接続したか（任意）
```

これにより、カードがどのElementに接続されているかを一覧でき、逆にElementがどのカードを持っているかも一覧できる。

## 2.6 具体例

### IT企業の例
```
Object: 「ECサイトリニューアル」
├── Object: 「フロントエンド」
│   ├── Element: 「商品一覧ページ実装」
│   │   ├── Subelement: 「API連携」
│   │   ├── Subelement: 「UIコンポーネント作成」
│   │   ├── Card [Document]: 「コンポーネント設計仕様」 ──→ 「決済フロー実装」にも接続
│   │   └── Card [Table]: 「APIエンドポイント一覧」 ──→ 「商品API開発」にも接続
│   │
│   │ Decision: 「React採用」（理由: チームスキル、trade-off: Vue経験者の学習コスト）
│   │
│   └── Element: 「決済フロー実装」
│       ├── Card [Document]: 「コンポーネント設計仕様」（← 商品一覧と同じカード）
│       └── Card [Link]: 「Stripe API リファレンス」
│
└── Object: 「バックエンド」
    ├── Element: 「商品API開発」
    │   └── Card [Table]: 「APIエンドポイント一覧」（← 商品一覧と同じカード）
    └── Element: 「認証システム構築」
```

### 病院の例
```
Object: 「内科病棟」
├── Object: 「3階東」
│   ├── Element: 「山田太郎」（患者）
│   │   ├── Subelement: 「血液検査」
│   │   ├── Subelement: 「CT検査」
│   │   ├── Card [Document]: 「治療計画書」
│   │   └── Card [Table]: 「投薬履歴」 ──→ 「佐藤花子」にも接続（同じ薬剤プロトコル）
│   └── Element: 「佐藤花子」
│       └── Card [Table]: 「投薬履歴」（← 山田太郎と同じカード）
└── Object: 「3階西」
    └── Element: 「鈴木一郎」
```

## 2.7 なぜ「Task」ではなく「Elements」か？

業界によって扱う単位が異なる：
- IT企業 → タスク
- 病院 → 患者
- 営業 → 案件・商談
- カスタマーサポート → チケット

抽象的な「Elements」なら、どの業界でも違和感なく使える。

## 2.8 Workers（ワーカー）

Elementsを実行する主体。

```
Worker
├── Human Worker（人間）
└── AI Agent Worker（AIエージェント）
```

両者に共通する属性：
- 名前、役割、スキル
- 担当Elements、稼働状況
- パフォーマンスメトリクス

---

# Part 3: データベーススキーマ

## 3.1 テーブル構成

| 概念 | DBテーブル | 備考 |
|------|-----------|------|
| Object | `objects` | parent_object_idで入れ子 |
| Element | `elements` | object_idでObjectに紐づく |
| Subelement | `subelements` | element_idでElementに紐づく |
| Card | `cards` | 独立したNode。card_typeで種別管理 |
| Card-Element Edge | `card_element_edges` | CardとElementの多対多接続 |
| Decision | `decisions` | ジョイント型（source → target） |
| Worker | `workers` | human / ai_agent |
| Element Assignee | `element_assignees` | ElementとWorkerの関連 |

## 3.2 スキーマ詳細

```sql
-- Object（仕事：入れ子可能）
objects (
  id UUID PRIMARY KEY,
  parent_object_id UUID REFERENCES objects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  icon TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

-- Elements（労働：実行単位 = タスクの中核）
elements (
  id UUID PRIMARY KEY,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  section TEXT,
  status TEXT DEFAULT 'todo',
  priority TEXT DEFAULT 'medium',
  due_date DATE,
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)
-- ※ descriptionカラムは廃止。付随情報はすべてCardで管理する。

-- Subelements（構成要素）
subelements (
  id UUID PRIMARY KEY,
  element_id UUID REFERENCES elements(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_completed BOOLEAN DEFAULT FALSE,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

-- Cards（独立した情報Node）
cards (
  id UUID PRIMARY KEY,
  card_type TEXT NOT NULL,  -- 'document' | 'table' | 'link' | 'file' | 'note' | 'checklist'
  title TEXT NOT NULL,
  content JSONB,            -- カード種別に応じた構造化データ
  -- document: { body: "リッチテキスト" }
  -- table: { columns: [...], rows: [...] }
  -- link: { url: "...", description: "..." }
  -- file: { storage_path: "...", file_type: "...", file_size: 0 }
  -- note: { body: "短いテキスト" }
  -- checklist: { items: [{ text: "...", checked: false }] }
  created_by UUID REFERENCES workers(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

-- Card-Element Edges（カードとElementの多対多接続）
card_element_edges (
  id UUID PRIMARY KEY,
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  element_id UUID REFERENCES elements(id) ON DELETE CASCADE,
  context TEXT,              -- なぜこのカードをこのElementに接続したか
  attached_by UUID REFERENCES workers(id),
  attached_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(card_id, element_id)  -- 同じカードを同じElementに二重接続しない
)

-- Decisions（ジョイント）
decisions (
  id UUID PRIMARY KEY,
  source_type TEXT NOT NULL,  -- 'object' | 'element'
  source_id UUID NOT NULL,
  target_type TEXT NOT NULL,  -- 'object' | 'element' | 'worker'
  target_id UUID NOT NULL,
  relation TEXT NOT NULL,     -- 'creates' | 'decomposes' | 'prioritizes' | 'assigns' | 'terminates'
  rationale TEXT,
  alternatives JSONB,         -- [{option, predicted_outcome}]
  trade_off TEXT,
  decided_by UUID REFERENCES workers(id),
  decided_at TIMESTAMP DEFAULT NOW(),
  is_explicit BOOLEAN DEFAULT TRUE,
  confidence TEXT DEFAULT 'certain',  -- 'certain' | 'tentative' | 'forced'
  created_at TIMESTAMP DEFAULT NOW()
)

-- Workers（ワーカー）
workers (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,  -- 'human' | 'ai_agent'
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  avatar_url TEXT,
  ai_model TEXT,
  ai_config JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

-- Element Assignees（担当者）
element_assignees (
  id UUID PRIMARY KEY,
  element_id UUID REFERENCES elements(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES workers(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'assignee',
  assigned_at TIMESTAMP DEFAULT NOW()
)

-- Custom Columns（カスタムカラム）
custom_columns (
  id UUID PRIMARY KEY,
  object_id UUID REFERENCES objects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  column_type TEXT NOT NULL,
  options JSONB,
  order_index INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT TRUE,
  width INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)

-- Custom Column Values（カスタムカラム値）
custom_column_values (
  id UUID PRIMARY KEY,
  column_id UUID REFERENCES custom_columns(id) ON DELETE CASCADE,
  element_id UUID REFERENCES elements(id) ON DELETE CASCADE,
  value JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
)
```

## 3.3 Supabase Project

- **Project ID**: rkugtcqztkkacvoylupw
- **Region**: ap-northeast-2

---

# Part 4: UI/UXデザイン仕様

## 4.1 デザイン原則

- **テーマ**: Supabase Dashboard inspired dark theme
- **カラー**: モノクロベース（#171717, #1c1c1c）、白/グレーのアクセントのみ
- **レイアウト**: VSCode-like（ActivityBar + Sidebar + MainContent）
- **ロゴ**: シンプルに「Alcon」テキスト表示
- **ナビゲーション**: 全階層リスト表示

## 4.2 カラートークン

### Background Colors
| Token | Hex | Usage |
|-------|-----|-------|
| bg-primary | `#1E1E1E` | Main background |
| bg-secondary | `#252526` | Sidebar, panels |
| bg-tertiary | `#2D2D30` | Tabs bar, inputs |
| bg-hover | `#2A2D2E` | Hover state |
| bg-active | `#37373D` | Active/selected |

### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| text-primary | `#CCCCCC` | Main text |
| text-secondary | `#858585` | Secondary text |
| text-muted | `#6E6E6E` | Disabled/muted |

### Status Colors
| Token | Hex | Usage |
|-------|-----|-------|
| status-success | `#4EC9B0` | Success/completed |
| status-warning | `#DCDCAA` | Warning |
| status-error | `#F14C4C` | Error/blocked |
| status-info | `#75BEFF` | Info |

## 4.3 レイアウト構造

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TITLE BAR (40px)                                                        │
│ [Logo] [                Search (Cmd+K)                ] [Bell] [AI] [User]│
├────┬───────────┬─────────────────────────────────────┬──────────────────┤
│ A  │ SIDEBAR   │ MAIN CONTENT                        │ DETAIL PANEL     │
│ C  │ (260px)   │ (flex: 1)                           │ (400px)          │
│ T  │           │                                     │                  │
│ I  │ Objects   │ ┌─────────────────────────────────┐ │ Element詳細      │
│ V  │ TreeView  │ │ TABS BAR (35px)                 │ │ ────────         │
│ I  │           │ │ [Elements] [Board] [+]          │ │ ステータス・担当者 │
│ T  │ ────────  │ ├─────────────────────────────────┤ │                  │
│ Y  │ Filters   │ │                                 │ │ Cards            │
│    │           │ │ ELEMENT LIST                    │ │ ────────         │
│ B  │           │ │                                 │ │ [+ Add Card]     │
│ A  │           │ │ セクション別グループ表示          │ │ [Doc] 仕様メモ   │
│ R  │           │ │ Priority / Status / Due date    │ │ [Table] API一覧  │
│    │           │ │ + Custom Columns                │ │ [Link] 参考URL   │
│(48)│           │ │                                 │ │                  │
│ px │           │ └─────────────────────────────────┘ │ Decisions        │
├────┴───────────┴─────────────────────────────────────┴──────────────────┤
│ STATUS BAR (22px)                                                       │
│ [main] [Synced] [AI Active]                    [2 pending] [v12] [3]    │
└─────────────────────────────────────────────────────────────────────────┘
```

## 4.4 カードのUI体験

### Element詳細パネル（右パネル）
Elementをクリックすると右にDetail Panelが展開。上部にステータス・担当者・期日、下部にCardsセクション。

### カード追加フロー
1. Detail Panel内の「+ Add Card」ボタンをクリック
2. カード種別選択ポップアップが表示（Document / Table / Link / File / Note / Checklist）
3. 種別を選択するとインラインで編集開始
4. 保存するとカードがNodeとして独立して生成される

### カードの接続フロー
1. 既存カードの「...」メニューから「他のElementに接続」を選択
2. Element検索・選択UI
3. 接続理由（context）を任意で入力
4. Edgeが生成され、対象Elementからもこのカードが見える

### カードのクロスリファレンス表示
カードには「接続先」バッジが表示される。
例: `仕様メモ [API設計] [DB設計] [UI設計]`
バッジをクリックするとそのElementに遷移。

---

# Part 5: 技術スタック

## 5.1 現在の実装

- **Frontend**: Next.js (App Router, Turbopack)
- **Backend**: Supabase (PostgreSQL, Auth, Edge Functions)
- **Deployment**: Vercel
- **AI**: Claude API via Supabase Edge Functions (Tool Use)

## 5.2 Supabaseの機能活用

```
┌─────────────────────────────────────────────────────────────┐
│                    Supabase                                 │
├─────────────────────────────────────────────────────────────┤
│  Auth          │ 認証・ユーザー管理                          │
│  Database      │ PostgreSQL + RLS（行レベルセキュリティ）      │
│  Storage       │ ファイル保存（S3互換）                       │
│  Realtime      │ WebSocketでDB変更をリアルタイム配信          │
│  Edge Functions│ サーバーレス関数（Deno/TypeScript）          │
│  RPC           │ PostgreSQL関数をAPI経由で呼び出し            │
│  PostgREST     │ DBスキーマから自動REST API生成               │
└─────────────────────────────────────────────────────────────┘
```

---

# Part 6: AI統合

## 6.1 AIの役割

AIはタスク管理を強化するインテリジェンスレイヤーとして機能する。

| 機能 | 説明 | トリガー |
|------|------|---------|
| **カード関連付け提案** | 新しいカード作成時に関連するElementを自動提案 | カード作成 |
| **矛盾検出** | 複数のElementに接続されたカード間の矛盾を検出 | カード更新 |
| **タスク分析** | Elementの分解・見積もり提案 | Element作成 |
| **依存関係検出** | Element間の隠れた依存関係を推論 | Element更新 |
| **ワークロード分析** | Worker間の負荷バランスを可視化・提案 | 定期的 |

## 6.2 Edge Functions

### 実装済み
1. **validate-task**: Elements作成前の重複・競合チェック
2. **analyze-change**: Elements変更時の影響分析

### 計画中
- **card-relation-suggester**: カード作成時に関連Elementを自動提案
- **conflict-detector**: カード間の矛盾・不整合を検出
- **dependency-analyzer**: Element間の隠れた依存関係を自動検出
- **workload-balancer**: ワーカーの負荷を最適化提案

---

# Part 7: 設計原則

## 7.1 判断基準

設計の判断に迷ったら：

1. **一般化**: 特定のケースではなく、一般化できるか？
2. **自由度**: ユーザーが自由に構造を作れるか？
3. **汎用性**: 業界を問わず使える用語か？
4. **標準化**: 労働を標準化し、解釈の余地を排除できているか？
5. **判断の可視化**: Decisionとして記録・追跡できているか？
6. **カードの独立性**: 情報がElementに埋もれず、再利用可能なNodeとして存在しているか？

## 7.2 アーレントの3概念との対応

| 設計要素 | アーレントの概念 | 設計意図 |
|----------|------------------|----------|
| **Card** | 活動（Action） | 他者と共に創造し、情報を共有・再利用する |
| **Object** | 仕事（Work） | 耐久的な構造を設計する |
| **Element** | 労働（Labor） | 標準化され、消費される作業 |
| **Decision** | - | 3つを繋ぐジョイント。判断と責任の記録 |

## 7.3 Decisionの4つの作法

哲学的探究から導かれた、判断に対する責任の作法：

| 作法 | 意味 | Alconでの実装 |
|------|------|---------------|
| **判断を避けないこと** | 不完全な情報でも決断する | AIが判断ポイントを検出し、先送りを防ぐ |
| **判断を絶対視しないこと** | 常に修正可能性を残す | revision_deadline、confidence属性 |
| **判断の理由を語れること** | 他者との対話可能性を保つ | rationale、alternatives、trade_off |
| **判断の代償を引き受けること** | 何を失ったかを自覚する | trade_off、帰結追跡（将来実装） |

---

# Part 8: ロードマップ

## Phase 1: 基盤（完了）
- [x] 組織階層表示（Sidebar）
- [x] Elements管理（Table view）
- [x] ドラッグ&ドロップでの組織再編
- [x] カスタムカラム
- [x] Decisionテーブル設計
- [x] Decision UI実装

## Phase 2: カードシステム（現在）
- [ ] Cardsテーブル追加
- [ ] Card-Element Edgesテーブル追加
- [ ] Elementsのdescriptionカラム廃止
- [ ] Element詳細パネル（右パネル）UI
- [ ] カード作成フロー（種別選択 → インライン編集）
- [ ] カードの多対多接続UI
- [ ] カードのクロスリファレンス表示

## Phase 3: Edge & Decision
- [ ] Edgeテーブル設計・実装
- [ ] Element間の依存関係表示
- [ ] Decision記録UI
- [ ] Decision履歴表示

## Phase 4: AI統合
- [ ] カード関連付け自動提案
- [ ] カード間矛盾検出
- [ ] タスク分析・分解提案
- [ ] 依存関係の自動検出
- [ ] ワークロード分析

## Phase 5: 拡張
- [ ] リアルタイム通知
- [ ] タイムライン/ガントチャート
- [ ] 権限管理（RBAC）
- [ ] バージョン管理（Git-like）
- [ ] カレンダー連携
- [ ] ボードビュー（カンバン）

---

# Part 9: プロジェクト構造

## 9.1 ファイル構成

```
/src
  /app
    page.tsx              # メインエントリ
  /components
    /layout
      TitleBar.tsx        # 上部バー（ロゴ、検索）
      ActivityBar.tsx     # 左端アイコンバー
      Sidebar.tsx         # 組織ツリー表示
      MainContent.tsx     # メインコンテンツ領域
      DetailPanel.tsx     # 右側Element詳細パネル
    /elements
      ElementList.tsx     # Elements一覧表示
      ElementRow.tsx      # Element行コンポーネント
    /cards
      CardList.tsx        # Element内のカード一覧
      CardCreator.tsx     # カード作成ポップアップ
      DocumentCard.tsx    # ドキュメントカード
      TableCard.tsx       # テーブルカード
      LinkCard.tsx        # リンクカード
      FileCard.tsx        # ファイルカード
      NoteCard.tsx        # メモカード
      ChecklistCard.tsx   # チェックリストカード
      CrossReference.tsx  # クロスリファレンスバッジ
    /decisions
      DecisionLog.tsx     # 判断履歴表示
    /ui
      (shadcn/ui components)
  /hooks
    useSupabase.ts        # データ取得・操作
    useCards.ts            # カード操作
    useEdges.ts            # Edge操作
  /lib
    supabase.ts            # Supabaseクライアント
    utils.ts               # ユーティリティ
  /types
    database.ts            # 型定義
```

## 9.2 環境変数

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## 9.3 開発コマンド

```bash
npm run dev      # 開発サーバー起動
npm run build    # 本番ビルド
npx vercel --prod # 本番デプロイ
```

---

# 付録A: 用語集

| 用語 | 定義 |
|------|------|
| **Object** | 仕事の構造単位。入れ子可能。プロジェクト、部門、フェーズなどを表現 |
| **Element** | 最小作業単位（タスクの中核）。業界によりタスク、患者、案件など |
| **Subelement** | Elementの構成要素。チェックリスト項目など |
| **Card** | Elementに付随する独立した情報Node。再利用可能、多対多接続 |
| **Edge** | CardとElementの接続。多対多関係を管理 |
| **Decision** | 判断の記録。Object/Element間を結ぶジョイント |
| **Worker** | 作業主体。Human, AI Agent |

---

# 付録B: 参考資料

- Hannah Arendt "The Human Condition" (1958)
- Microsoft Loop Components
- Asana Work Graph: https://asana.com/resources/work-graph
- Linear App: https://linear.app
- Supabase Docs: https://supabase.com/docs
- Anthropic Claude API: https://docs.anthropic.com

---

# 付録C: v4からの変更点

| 項目 | v4 | v5 |
|------|----|----|
| **Document** | 独立した「活動の場」（Canvas/Chat/Editor） | 廃止 → Cardとして再設計 |
| **Card** | なし | 新規追加。独立した情報Node、多対多接続 |
| **Edge** | なし | 新規追加。Card ↔ Element の接続管理 |
| **Element.description** | あり | 廃止。付随情報はすべてCardで管理 |
| **AI統合** | AIはオペレーター、逆MCP | 純粋なインテリジェンスレイヤー |
| **Worker** | Human / AI Agent / Robot | Human / AI Agent（Robotは将来） |
| **将来ビジョン** | フィジカルAI、AR、Division的UI | 別文書に分離 |
| **コンセプト** | AI駆動型組織ワークマネジメント | 世界最高のタスク管理ツール |

---

**文書バージョン:** 5.0
**最終更新:** 2026年4月
