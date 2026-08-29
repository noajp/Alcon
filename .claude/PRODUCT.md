# Friction — Product Overview & Design Philosophy

## プロダクト概要

Friction はあらゆる組織活動を人間の本質的な活動原理が反映された抽象概念をもとに企画された Strategy & Execution SaaS である。企業・軍事作戦・病院など業界、分野を問わず、業界非依存の抽象構造で組織の活動行為の可視化を可能にする。

既存の生産性ツールが業界固有の文脈との定義に縛られた機能しか持たないのに対し、Friction は **Action（活動）**・**Materialization（具体化）**・**Strategy（戦略）**・**Execution（実行）**・**Sustainment（サステインメント）** という 5 つの概念で、活動行為全般を支援する。

## 概念アーキテクチャ

### Activity Space — すべての層を包含する最上位コンテナ

Action・Materialization・Strategy・Execution・Sustainment の 5 層、および横断機能の Home・Property は、例外なくすべて単一の **Activity Space** の内側に存在する。Activity Space は組織の信頼境界であり（詳細は [境界と権限](#境界と権限boundary--permissions) を参照）、ユーザーが所属する組織・チームそのものを表す最上位コンテナである。Activity Space を切り替えるということは、Action/Materialization/Strategy/Execution/Sustainment/Home/Property 一式ごと、別の組織の文脈へ移ることを意味する。層をまたいだ機能同士の連携（Chat の内容を Note にまとめる、Note から Element を起票する等）は、すべて同じ Activity Space の中で完結する。

### Ends / Ways / Means のカスケード

人の営みには「消えるもの」と「残るもの」がある。会話や意図は発した瞬間から消えていき、文書や計画は形として残る。しかし実際の現場では、計画は実行と噛み合わず、議事録は議論から切り離され、タスクはそもそもの意図を失っている。

Friction はこの変換を、揮発する活動を耐久物へ変え、それを **Ends / Ways（何を達成し、どう勝つか）** と **Means の運用（誰を何に投入するか）** に分け、さらにその Means を**維持・補充する層**を添えて構造化する。この一式は、すべて一つの Activity Space の中に収まる。

```
╔══════════════════════════ Activity Space ═══════════════════════════╗
║ ┌─────────────────────────────────────────────────────┐             ║
║ │  Action（活動）— Chat / Talk                         │             ║
║ │  会話・議論・意思のやりとり。本質的に揮発する         │             ║
║ ├─────────────────────────────────────────────────────┤             ║
║ │  Materialization（具体化）— Note / Diagram           │             ║
║ │  活動から抽出された耐久的な成果物                     │             ║
║ ├─────────────────────────────────────────────────────┤             ║
║ │  Strategy（Ends / Ways）                             │             ║
║ │  Campaign / Phase / Timeline                         │             ║
║ │  何を達成し、どう勝つか                               │             ║
║ ├─────────────────────────────────────────────────────┤             ║
║ │  Execution（Employment of Means）                    │             ║
║ │  Domain / Object / Element                           │             ║
║ │  誰／何を、どの仕事に投入して成果を作るか             │             ║
║ └─────────────────────────────────────────────────────┘             ║
║   ＋ Sustainment（Generate & Sustain Means）                          ║
║     稼働可能な人員・予算・会計・契約・購買・勤怠・設備                 ║
║   ＋ Home（横断）          — My Elements / Inbox                     ║
║   ＋ Property              — 実行単位に付与するメタデータ            ║
╚═══════════════════════════════════════════════════════════════════╝
```

Activity Space の内部において、第 1 層は語の衝突を避けて **Action（活動）** と名付ける。ModeRail の固定セレクタ Home / Strategy / Execution がこの構造の背骨に対応し、Sustainment と Tools は Apps ランチャーから各自がレールに追加する。Sustainment のうち App になっているのは Workload（Worker 別の稼働）のみで、残りは Execution 層の Object Detail 内タブとして提供される（詳細は下記 Sustainment 層 / 拡張計画を参照）。

### Strategy と Execution の分離

UI 上で Strategy と Execution は明確に分ける。両者を混ぜて一覧化すると「何を達成するか」と「誰が何に投入されているか」の区別が崩れ、概念そのものが壊れる。

| Strategy | Execution |
|----------|-----------|
| Campaign → Phase → Timeline | Domain → Object → Element |
| 目的、方針、前提、意思決定、成功条件 | 担当、期限、進捗、依存関係、成果物 |
| 「何を、なぜ、どう勝つか」 | 「何を今やるか、どこで詰まっているか」 |

ただし完全に遮断すると、Friction の価値である「意図と実行の接続」が消える。分離しつつ、相互リンクは常時見せる。

- **Campaign を開いたとき** — 参加 Object、実行上のリスク、負荷を併せて示す
- **Object を開いたとき** — 貢献先 Campaign（Contributes to）と、その戦略上の意図・成功条件を示す

レールのハイライトは `activeView` に追従するため、どちらのリンクを辿ってもモードは自動で切り替わる。画面はごちゃつかず、上下を一クリックで往復できる。この往復可能性が Friction の核である。

### Action 層：Chat / Talk

消えていく活動。会話・意図・やりとりそのもの。記録ではなく、いま起きている対話を支える。

| 機能 | 性質 | 実装 |
|------|------|------|
| **Chat** | 個人対話（1:1 / グループ DM） | `conversations` + `messages` |
| **Talk** | チャンネル制のリアルタイム会話 | `channels` + `messages`（コード上は `room/` モジュール） |

Talk と Chat は別系統。「場に人が集まる（チャンネル）」vs「人と人が繋がる（DM）」の違い。

### Materialization 層：Note / Diagram

Action の消えるやりとりを、世界に残る耐久物へ変換する。

| 機能 | 役割 | 実装 |
|------|------|------|
| **Note** | 思考・記録のドキュメント（議事録 / メモ） | 独自 HTML エディタ（`AppleNoteEditor` + `htmlSanitizer`）。**Folder → File の 2 階層**ツリー |
| **Diagram** | 抽象を図として可視化 | — |

**Note の階層** — Folder は Activity Space 直下にフラットに並び、File はその中に入る。Folder 一覧は左サイドバー、選択中 Folder の File 一覧は中ペイン（FilesPane）、編集は右の PageView。

### Strategy 層：Campaign / Phase / Timeline

Ends（何を達成するか）と Ways（どう勝つか）を扱う層。目的・方針・前提・意思決定・成功条件がここに置かれ、担当・進捗は持たない。

| 機能 | 役割 | 実装 |
|------|------|------|
| **Campaign** | 複数 Object を目的単位で束ね、計画と進捗を俯瞰 | `strategies` + `strategy_objects` junction で Domain 横断にグルーピング（view id は `strategy`） |
| **Phase** | 努力をどの段階に配分するかの時間箱 | `phases`（Domain スコープ）。Object / Element は高々 1 つの Phase に所属 |
| **Timeline** | Campaign の期間・シーケンスを月スケール Gantt で俯瞰 | 行を展開すると参加 Object のバーが同じ軸に並ぶ |

**Campaign** は Execution 層を**束ねるフォルダ**のような存在。個々の実行（Object / Element）ではなく、それらを集約して「なぜやるか」「どこへ向かうか」を示す。Campaign を開くと参加 Object の List / Grid が並び、そこから Object 詳細へ一クリックで降りられる。

### Execution 層：Domain / Object / Element

Strategy が定めた Ends / Ways に対し、実際に手段を投入する層。担当・期限・進捗・依存関係・成果物を扱う。

| 概念 | 役割 | 構造ルール |
|------|------|-----------|
| **Domain** | 最上位の入れ物 | localStorage 永続。組織・プロジェクト空間の切替単位（病院 / 会社 / 作戦） |
| **Object** | 構造単位 | Domain 直下のみ（フラット、ネスト禁止）。multi-homing は `object_domains` |
| **Element** | 最小の実行単位 | Object に所属。multi-homing 可（`object_id` + `element_objects` junction） |

Object は「箱」、Element は「中身」。箱は一段しかなく（ネストしない）、中身は複数の箱に同時に入れられる。Object 詳細は貢献先 Campaign を常に表示し、Strategy 層へ一クリックで戻れる。

### Sustainment 層：手段の生成と維持

兵力そのものは兵站ではない。Worker は仕事を行う主体であり、Strategy / Execution が用いる中心的な**手段**である。Sustainment はその手段が存在し、移動し、働き続けられるように支える側——稼働・勤怠・給与・採用・育成・予算・会計・契約・購買・設備——を扱う。カスケードの一段ではなく、Execution と対をなす横断的な層として位置づける。

Worker エンティティは 1 つを共有し、サーフェスごとに見せる意味を変える。

| Worker の側面 | 属する層 |
|--------------|---------|
| 能力・組織・配置 | Execution（用いられる戦力そのもの） |
| 稼働・勤怠・給与・採用・育成・予算 | Sustainment |
| Campaign への人員配分の意思決定 | Strategy |

| 概念 | 役割 | 実装 |
|------|------|------|
| **Worker** | 人的 / AI リソースの管理単位 | `workers`（human \| ai_agent）。`element_assignees` で Element にアサイン |
| **Workload** | Worker 別の日次負荷を Space 横断で俯瞰 | Apps ランチャーの Sustainment グループ。Domain は自前のフィルタで絞る |
| **Resource** | Worker 別の日次負荷を Object 単位で可視化 | Object Detail 内タブの面グラフ |
| **Calendar** | Element の期日を時間軸で管理 | 日 / 週 / 月ビュー |

App になっているのは Workload のみで、Worker / Resource / Calendar / Gantt は Execution 層の Object Detail 内タブとして実装されている。予算・会計・契約・購買・設備まで含む手段管理へ広げる計画（詳細は拡張計画を参照）。

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
- **ModeRail**（46px）は層セレクタ：固定の Home / Strategy / Execution ＋ Apps ランチャーから追加した App。カタログは Tools（Notebook / Table / Team）と Sustainment（Workload）の 2 グループ
- **AppSidebar** は層内のナビ。最上部に Space 名（`SpaceSwitcher`）＋ Discover ＋ Create。本体は現在のモードに応じて切替（Home＝My 項目 / Strategy＝Campaign・Phase・Timeline / Execution＝Domain ツリー / App 各種＝モード名ラベルのみ）
- view→モードの対応は `shell/ModeRail.tsx` の `VIEW_TO_MODE`、view id→ラベル / アイコンは `shell/viewRegistry.ts` が単一情報源

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

Workers タブは Worker の配置（Execution 側の側面）、Resource / Calendar / Gantt は稼働と時間の配分（Sustainment 側の側面）を、いずれも Object 単位で提供している。

## データ設計原則

- **RLS everywhere** — 全テーブルに Row Level Security
- **Junction テーブルで多対多** — `element_objects`, `strategy_objects`, `object_domains`
- **Property は EAV 的** — `custom_columns` + `custom_column_values` で任意メタデータ
- **Domain は localStorage 永続** — サーバーに持たず、クライアント側で切替
- **Note は 2 階層** — `notes`（Folder→File ツリー、Folder はルート）+ `note_contents.html`
- **Worker = human | ai_agent** — 同一テーブルで人的リソースと AI エージェントを管理

## 境界と権限（Boundary & Permissions）

組織の信頼境界は **ActivitySpace**。Action / Materialization / Strategy / Execution / Sustainment / Home / Property のすべての機能は、この ActivitySpace の内側でのみ存在・動作する（詳細は前述の [Activity Space — すべての層を包含する最上位コンテナ](#activity-space--すべての層を包含する最上位コンテナ)）。Linear 型の二層メンバーシップで人を所属させる。

- **二層の所属** — Space メンバー（`activity_space_members`：owner/member）＝組織の正規メンバー。Domain メンバー（`domain_members`）＝その Domain だけに招かれた人。Object メンバー（`object_members`）はさらに細かい Object 限定の同席者（通常 domain_members の部分集合、Object 限定ゲストも可）。
- **Guest** — `domain_members` だが Space 非メンバーの人。招かれた Domain しか見えず、組織の他 Domain 構造は一切露出しない。他組織の人を招いても相手の Space は混ざらない（Domain は `activity_space_id` で1つの Space に属したまま、相手には「Shared with me」として現れる）。
- **Domain 可視性 `domains.privacy`** — `workspace`＝同じ Space のメンバー全員が閲覧可。`private`＝`domain_members` のみ。
- **可視性カスケード** — Domain 可視 ⇔ domain_member、または（`workspace` かつ Space メンバー）。Object 可視 ⇔ object_member、または所属 Domain が可視。Element 可視 ⇔ 所有者、または所属 Object が可視。
- **サーバーで強制** — 上記は SECURITY DEFINER ヘルパー（`user_can_see_domain` / `user_can_see_object` / `user_can_see_element`）として RLS に組み込む。クライアント表示任せにしない。横断取得 RPC `get_explorer_data` も同じ可視性で Object/Element を返す。
- **招待 UI** — Space 招待は ActivitySpace 設定（owner のみ）、Domain 招待（Guest 化）は Domain の Team 設定から。

## AI 連携

Claude API を Supabase Edge Functions 経由で利用：
- `Friction-copilot`：汎用 AI アシスタント
- `run-agent`：エージェント実行
- `draft-object`：Object 自動生成
- `generate-object-report`：レポート生成
- `summarize-note`：Note 要約
- `analyze-change`：変更分析
- `validate-task`：Element 検証
- `voice-summarize`：音声要約

## 拡張計画（Vision）

**Sustainment 機能の強化** — Workload に続き、Object Detail 内タブに留まる Worker / Resource / Calendar / Gantt も Domain 横断の App へ引き上げる。人員稼働だけでなく、予算・会計・契約・購買・勤怠・設備まで含む手段管理へ拡張予定。

### モジュール型展開

将来は独立アプリ群として展開する：

| モジュール | 領域 | 状態 |
|-----------|------|------|
| **Friction SEM** | Strategy & Execution Management | 現在開発中 |
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
- **AI** — Claude 連携基盤

### 技術的方向性

- monorepo 化は行わない。各モジュールが独立してデプロイ可能
- 共通基盤は npm パッケージまたは共有 Supabase スキーマとして提供
- 認証・Domain 管理は共通ゲートウェイで統一
