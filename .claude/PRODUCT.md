# Alcon — Product Overview & Design Philosophy

## プロダクト概要

**Alcon は世界最高の組織活動支援ツールを目指す。** 企業・軍事作戦・病院など業界を問わず、あらゆる組織活動を、人間の本質的な活動原理を反映した業界非依存の少数概念で扱う。

既存の生産性ツールが業界固有の文脈に縛られた機能しか持たないのに対し、Alcon は機能を **Strategy（戦略）**・**Execution（戦闘）**・**Sustainment（兵站）** の三つに分類し、この三分類だけで組織活動の全体を支援する。

### 表のコピーと裏の設計思想

**表のコピー — 利用者に届ける価値**

> 世界最高の組織活動支援ツール。

**裏のコピー — その価値を成立させる設計思想**

> 人間の意図のもとでAIが自律的に活動し、その過程と成果を検証できる組織活動基盤。

この二つを結ぶ原則は、**「意図で委ね、成果と根拠で確かめる」**。人間とAIが共に活動する組織において、何を任せ、何が行われ、どこまで達成・検証されているかを把握できることを目指す。以下は今後の設計・開発を導く原則であり、すべてが現時点で実装済みであることを意味しない。

### AIへのミッションコマンド

Alconにおけるミッションコマンドとは、人間が目的・成功条件・制約・権限を示し、AIがその意図を理解して、状況に応じた手段を選び、権限内で判断・実行すること。権限を超える判断や前提の崩壊が生じたときは、人間に判断を戻す。人間は委任範囲を変更し、実行を停止できる。

| 層 | ミッションコマンドにおける役割 |
|---|---|
| **Strategy** | 人間が意図・成功条件・制約を定め、AIと共有する。実行から得られた結果を踏まえて方針を見直す |
| **Execution** | AIが意図に沿って行動を組み立て、与えられた権限内で実行し、成果と未達事項を報告する |
| **Sustainment** | 実行に必要な情報・道具・資源・アクセス権を供給する |

Campaignは任務の上位意図を提供し、Objectは委任する任務を、Elementはその遂行に必要な行動を表現できる。既存の概念構造を活かし、意図から行動へ、行動の結果から戦略の見直しへと往復できるようにする。

### 委任を支える三原則 — 監査性・完全性・自律性

| 原則 | 可視化・検証できること |
|---|---|
| **監査性** | 誰／どのAIが、どの意図・指示・根拠・権限に基づいて、いつ何を実行・変更したかを辿れる |
| **完全性** | 任されたミッションの成功条件に対し、成果・未達・未検証・抜け漏れが分かる。確認できた範囲と不確実な範囲を区別できる |
| **自律性** | AIがどこまで自ら判断・実行でき、どの条件で人間の判断が必要になるかが明確である |

ここでいう自律性は、上位の意図と委任された権限の範囲内で行動できることを指す。完全性は、ミッションに対する網羅性と確認状況を意味し、AIの無謬性を保証するものではない。監査記録の存在と成果の正しさも区別し、成果は成功条件と根拠に照らして検証する。

監査性があるから活動を委ねられ、完全性が見えるから任務の達成を判断できる。この二つが自律性を支える。StrategyとExecutionの接続では、**「どの意図に基づく行動か、どの権限で実行されたか、成果を誰が何を根拠に検証したか」**を一続きで辿れることを設計上の到達点とする。

## 概念アーキテクチャ

### 三分類 — クラウゼヴィッツ『戦争論』の 戦略・戦闘・兵站

全体の体系はクラウゼヴィッツ『戦争論』の三分に着想を得ている。戦略が何を達成するかを決め、戦闘がそれを実際に行い、兵站が戦闘を続けられるように支える。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Campaign。複数の Campaign が束ねられて戦略となる |
| **Execution** | 戦闘 | 実際に行動する | Element（最小単位）→ Object（Element の束）→ Domain（Object の集合） |
| **Sustainment** | 兵站 | 仕事道具 | Workload / Notebook / Table / Team / Chat / Talk / Calendar |

### Activity Space — すべてを包含する最上位コンテナ

Strategy・Execution・Sustainment の三分類、および横断機能の Home・Property は、例外なくすべて単一の **Activity Space** の内側に存在する。Activity Space は組織の信頼境界であり（詳細は [境界と権限](#境界と権限boundary--permissions) を参照）、ユーザーが所属する組織・チームそのものを表す。Activity Space を切り替えるということは、三分類一式ごと別の組織の文脈へ移ることを意味する。分類をまたいだ連携（Chat の内容を Note にまとめる、Note から Element を起票する等）は、すべて同じ Activity Space の中で完結する。

```
╔═══════════════════════ Activity Space ═══════════════════════╗
║ ┌──────────────────────────────────────────────────────────┐ ║
║ │  Strategy（戦略）— Campaign / Phase / Timeline            │ ║
║ │  何を達成し、どう勝つか。Campaign を束ねると戦略になる          │ ║
║ ├──────────────────────────────────────────────────────────┤ ║
║ │  Execution（戦闘）— Element → Object → Domain             │ ║
║ │  実際に行動する。労働・仕事・活動                             │ ║
║ ├──────────────────────────────────────────────────────────┤ ║
║ │  Sustainment（兵站）— Workload / Notebook / Table / Team  │ ║
║ │                       / Chat / Talk / Calendar           │ ║
║ │  行動を支える仕事道具                                        │ ║
║ └──────────────────────────────────────────────────────────┘ ║
║   ＋ Home（横断）  — Inbox / Calendar / My Elements            ║
║   ＋ Property      — 実行単位に付与するメタデータ                 ║
╚══════════════════════════════════════════════════════════════╝
```

ModeRail の固定セレクタ Home / Strategy / Execution がこの構造の背骨に対応する。Sustainment の各道具は Apps ランチャーから各自がレールに追加する（カタログ上は Tools と Sustainment の2グループに分けて表示しているが、概念上はどちらも Sustainment）。Chat / Talk は Execution モードのサイドバーから開く。

### Strategy と Execution の分離

UI 上で Strategy と Execution は明確に分ける。両者を混ぜて一覧化すると「何を達成するか」と「誰が何を行っているか」の区別が崩れ、概念そのものが壊れる。

| Strategy | Execution |
|----------|-----------|
| Campaign → Phase → Timeline | Domain → Object → Element |
| 目的、方針、前提、意思決定、成功条件 | 担当、期限、進捗、依存関係、成果物 |
| 「何を、なぜ、どう勝つか」 | 「何を今やるか、どこで詰まっているか」 |

ただし完全に遮断すると、Alcon の価値である「意図と行動の接続」が消える。分離しつつ、相互リンクは常時見せる。

- **Campaign を開いたとき** — 参加 Object、実行上のリスク、負荷を併せて示す
- **Object を開いたとき** — 貢献先 Campaign（Contributes to）と、その戦略上の意図・成功条件を示す

レールのハイライトは `activeView` に追従するため、どちらのリンクを辿ってもモードは自動で切り替わる。画面はごちゃつかず、上下を一クリックで往復できる。この往復可能性が Alcon の核である。

### Strategy（戦略）：Campaign / Phase / Timeline

何を達成し、どう勝つかを扱う分類。目的・方針・前提・意思決定・成功条件がここに置かれ、担当・進捗は持たない。

**Campaign が Strategy の単位であり、複数の Campaign が束ねられることで戦略となる。** Campaign は Campaign を内包でき（`strategy_children`）、ポートフォリオのルートには最上位の Campaign だけが並ぶ。入れ子の Campaign は親の "Campaigns" セクションにだけ現れる。

| 機能 | 役割 | 実装 |
|------|------|------|
| **Campaign** | Object を目的単位で束ね、意図・前提・決定・成功条件を保持する | `strategies` + `strategy_objects` junction（Object 集合の唯一の置き場、[ADR 0017](../docs/adr/0017-campaign-objects-live-in-the-junction.md)）+ `strategy_children`（Campaign の入れ子）+ `intents`（decision / assumption / measure）。view id は `strategy` |
| **Phase** | 努力をどの段階に配分するかの時間箱 | `phases`（Domain スコープ）。Object / Element は高々 1 つの Phase に所属 |
| **Timeline** | Campaign の期間・シーケンスを月スケール Gantt で俯瞰 | 行を展開すると参加 Object のバーが同じ軸に並ぶ |

Campaign を開くと、意図・状況・前提・決定・指標・リスクの各ウィジェットと、参加 Object の一覧が並ぶ。そこから Object 詳細へ一クリックで降りられる。

### Execution（戦闘）：Element → Object → Domain

Strategy が定めたことを実際に行う分類。担当・期限・進捗・依存関係・成果物を扱う。

三層はアーレント『人間の条件』の **労働・仕事・活動** の三分に着想を得ている。Element は日々こなされて消費される労働、Object は成果物として世界に残る仕事、Domain は複数の人が集い関わり合う活動の場である。

| 概念 | 役割 | 構造ルール |
|------|------|-----------|
| **Element** | 行動の最小単位（労働） | Object に所属。multi-homing 可（`object_id` + `element_objects` junction） |
| **Object** | Element を束ねる単位（仕事） | Domain 直下のみ（フラット、ネスト禁止）。multi-homing は `object_domains` |
| **Domain** | Object の集合（活動の場） | 組織・プロジェクト空間の切替単位（病院 / 会社 / 作戦）。active な Domain は localStorage 永続 |

Object は「箱」、Element は「中身」。箱は一段しかなく（ネストしない）、中身は複数の箱に同時に入れられる。Object 詳細は貢献先 Campaign を常に表示し、Strategy へ一クリックで戻れる。

### Sustainment（兵站）：仕事道具

行動を支える**仕事道具**の分類。Worker（human | ai_agent）は Execution で行動する主体であり、Sustainment はその Worker が働き続けられるように支える道具を扱う。

| 道具 | 役割 | 実装 |
|------|------|------|
| **Workload** | Worker 別の日次負荷を Space 横断で俯瞰 | Apps ランチャーの App。Domain は自前のフィルタで絞る |
| **Notebook** | 思考・記録のドキュメント（議事録 / メモ） | 独自 HTML エディタ（`AppleNoteEditor` + `htmlSanitizer`）。**Folder → File の 2 階層**ツリー（`notes` + `note_contents.html`） |
| **Table** | 任意の表 | `tables` + `table_columns` / `table_rows` / `table_cells` |
| **Team** | Worker と所属の一覧 | `workers`（human \| ai_agent）。`element_assignees` で Element にアサイン |
| **Chat** | 1:1 / グループ DM | `conversations` + `messages` |
| **Talk** | チャンネル制のリアルタイム会話 | `channels` + `messages`（コード上は `room/` モジュール） |
| **Calendar** | Element の期日を時間軸で管理 | 日 / 週 / 月ビュー |

Talk と Chat は別系統。「場に人が集まる（チャンネル）」vs「人と人が繋がる（DM）」の違い。

Object Detail 内の Workers / Resource / Calendar / Gantt タブは、同じ道具を Object 単位で提供するもの。稼働・勤怠・給与・採用・育成・予算・会計・契約・購買・設備まで含む手段管理へ広げる計画は拡張計画を参照。

### Home — 横断サーフェス

分類に属さない個人ビュー。

| 機能 | 役割 |
|------|------|
| **Inbox** | 通知フィード |
| **Calendar** | 自分の Element の期日 |
| **My Elements** | 自分が所有・アサインされた Element を横断表示 |

### Property：Objectごとの業務フィールド

カスタムフィールドの定義は **Objectに帰属**し、そのObjectに含まれるElementの情報を保持する。作成の「＋」はObject内のElements一覧にだけ置く。My ElementsとDomain横断のElements一覧、およびObjects一覧にはカスタムフィールドの作成を置かず、基本情報を中心に表示する。

- **標準フィールド** — Status・Priority・Type・Assignee・Due date・Tags・所属Objectsなど。各ビューで表示／非表示・順序・幅を設定できる。名前は常に表示する。
- **カスタムフィールド** — テキスト・単一選択・複数選択・数値・日付・人物・チェックボックス・URL・メール・電話。Object内で名前・説明・選択肢・色・順序・数値の表示形式を設定する。
- **Tag** — Element自身の属性。同じElementをどのビューから見ても引き継ぐ。
- **値と表示の分離** — 非表示や幅の変更で値を消さない。選択肢の表示名を変えても保存済みの値を維持し、廃止した選択肢も過去のElement上では読める。数値の丸めは表示にのみ適用する。

これにより、同じElementをCRMの案件、SCMの調達・出荷項目などとして運用できる。業務固有の属性はObjectのフィールドで表現し、Strategy・Execution・Sustainmentという骨格は共通に保つ。

データは `custom_columns`（定義）・`custom_column_placements`（配置）・`custom_column_values`（Elementの値）に分ける。保存済みのSpace・個人・Domainスコープのデータは保持するが、一覧の作成導線はObjectスコープに統一する。

## UI デザイン原則

### レイアウト哲学
- **常時可視ナビ + 折りたためる文脈ペイン + メインキャンバス** の 3 列構成
- **ModeRail**（46px）は分類セレクタ：固定の Home / Strategy / Execution ＋ Apps ランチャーから追加した App（Sustainment の道具。カタログ上は Tools と Sustainment の 2 グループ表示）
- **AppSidebar** は分類内のナビ。最上部に Space 名（`SpaceSwitcher`）＋ Discover ＋ Create。本体は現在のモードに応じて切替（Home＝My 項目 / Strategy＝Campaign・Phase・Timeline / Execution＝Domain ツリー / App 各種＝モード名ラベルのみ）
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

Workers / Resource / Calendar / Gantt は Sustainment の道具を Object 単位で提供している。

## データ設計原則

- **RLS everywhere** — 全テーブルに Row Level Security
- **Junction テーブルで多対多** — `element_objects`, `strategy_objects`, `object_domains`
- **Property は EAV 的** — `custom_columns` + `custom_column_values` で任意メタデータ
- **active な Domain は localStorage 永続** — どの Domain を開いているかはクライアント側で切替
- **Notebook は 2 階層** — `notes`（Folder→File ツリー、Folder はルート）+ `note_contents.html`
- **Worker = human | ai_agent** — 同一テーブルで人的リソースと AI エージェントを管理

## 境界と権限（Boundary & Permissions）

組織の信頼境界は **ActivitySpace**。Strategy / Execution / Sustainment / Home / Property のすべての機能は、この ActivitySpace の内側でのみ存在・動作する（詳細は前述の [Activity Space — すべてを包含する最上位コンテナ](#activity-space--すべてを包含する最上位コンテナ)）。Linear 型の二層メンバーシップで人を所属させる。

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
- `summarize-note`：Note 要約
- `analyze-change`：変更分析
- `validate-task`：Element 検証
- `voice-summarize`：音声要約

## 拡張計画（Vision）

**Sustainment の道具を増やす** — Workload に続き、Object Detail 内タブに留まる Workers / Resource / Calendar / Gantt も Domain 横断の App へ引き上げる。人員稼働だけでなく、予算・会計・契約・購買・勤怠・設備まで含む仕事道具へ拡張予定。

### モジュール型展開

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
- **AI** — Claude 連携基盤

### 技術的方向性

- monorepo 化は行わない。各モジュールが独立してデプロイ可能
- 共通基盤は npm パッケージまたは共有 Supabase スキーマとして提供
- 認証・Domain 管理は共通ゲートウェイで統一
