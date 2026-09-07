# Alcon — Product Overview & Design Philosophy

## プロダクト概要

**Alcon は世界最高の組織活動支援ツールを目指す。** 担当者が仕事を進め、同僚が必要な情報を受け取り、組織が目的に向かって判断できるようにする。長期的には業界をまたいで使えることを目指すが、適合する業務と導入範囲は実顧客の仕事で確かめる。

中核の価値仮説は、**自分の仕事を進めるための更新が、そのまま次の人の行動に役立つ共有になること**。既に動いている案件を持ち込み、自分が動く候補と誰の何を待つかを把握し、必要な部分だけ更新する。確認・転記・再説明の負担を当事者全体で減らせるかを、製品の判断基準にする。

Strategy・Execution・Sustainment は情報と操作を整理する現在のモデルである。思想上の整合性や少数概念への統一は、顧客の仕事が改善することの証明ではない。分類の理解や設定を、最初の案件を始める前提にしない。モデルが探索・引継ぎ・反復業務を扱いにくくするなら、実際の負担を根拠に見直す。

## 顧客価値と検証

### 初期の対象と反復ジョブ

初期の顧客候補は、複数の顧客導入・制作・業務受託案件を少人数で並行して回し、専任のツール管理者を置けないチーム。20～200人の組織内の5～20人のチームという範囲は、検証を絞るための仮設定であり、市場調査で確定したICPではない。まず登録済みの内部メンバー3～8人と1案件で、担当者の更新を受けた同僚が次へ進む一巡を確かめる。

購入者、導入担当、実行者、情報の受取人を分けて考える。責任者が盤面を読めても、実行者の入力や受取人の確認が増えるなら価値は成立しない。仕事の進め方、更新する権限、何を運用の正本とするかも導入条件として扱う。

### 判断の根拠

- **顧客の仕事** — 実案件の導入、確認・転記の削減、漏れ・手戻り、催促なしの反復利用、有償継続を観測する。
- **公開調査** — 当事者の不満から仮説を作り、競合の現行機能で反証する。苦情の数を市場規模や乗換意向とみなさない。
- **実装検証** — 入力の保持、権限、原子性、競合、再試行、画面間の一貫性を確かめる。テストの成功を定着やPMFの成功に置き換えない。
- **演習と概念モデル** — 実行可能性や摩擦の発見に使う。架空の運用と哲学的な説明だけでは実顧客の需要は確認できない。

Activation はsignupや取り込み完了ではなく、一人の更新を別の一人が読んで行動できること。Retention はログイン回数ではなく、次の実行機会にも当事者が催促なしで使い、従来の確認・転記を減らせること。両者合計の管理時間が減らない、二重報告が残る、管理者だけが使う場合は仮説を見直す。

Linear・Asana・ClickUp等には、個人ビュー、取り込み、依存、承認、連携、AI更新が既にある。機能名や「AIが動く」という説明を差別化にしない。適切に設定した既存製品と比べ、対象顧客が一連の仕事をより少ない入力・判断・確認で終えられるかを検証する。現在の調査は差別化・PMF・全面代替の証明ではない。

根拠となる当事者の具体例、8つの反証ケース、activation・retention・棄却の暫定基準は [日常の実行と共有に関する調査・製品判断](../docs/research/2026-09-coordination-core.md) に置く。開発の進捗と次の判断は盤面に戻す。

## 人間とAIへの委任

### 目指す価値と設計思想

利用者に届けたい価値は、自分の仕事を進めると共有も進み、目的と根拠を確かめながら次の行動を選べること。

その価値を人間とAIが共に活動する組織へ広げる設計思想は、次のとおり。

> 人間の意図のもとでAIが自律的に活動し、その過程と成果を検証できる組織活動基盤。

原則は、**「意図で委ね、成果と根拠で確かめる」**。何を任せ、何が行われ、どこまで達成・検証されているかを把握できることを目指す。以下は設計・開発を導く原則であり、すべてが実装済みであることを意味しない。AIの起票・報告・判断が人間の確認や訂正を増やす場合は、その適用を見直す。

### AIへのミッションコマンド

Alconにおけるミッションコマンドとは、人間が目的・成功条件・制約・権限を示し、AIがその意図を理解して、状況に応じた手段を選び、権限内で判断・実行すること。権限を超える判断や前提の崩壊が生じたときは、人間に判断を戻す。人間は委任範囲を変更し、実行を停止できる。

| 層 | ミッションコマンドにおける役割 |
|---|---|
| **Strategy** | 人間が意図・成功条件・制約を定め、AIと共有する。実行から得られた結果を踏まえて方針を見直す |
| **Execution** | AIが意図に沿って行動を組み立て、与えられた権限内で実行し、成果と未達事項を報告する |
| **Sustainment** | 実行に必要な情報・道具・資源・アクセス権を供給する |

Initiativeは任務の上位意図を提供し、Objectは委任する任務を、Elementはその遂行に必要な行動を表現できる。既存の概念構造を活かし、意図から行動へ、行動の結果から戦略の見直しへと往復できるようにする。

### 委任を支える三原則 — 監査性・完全性・自律性

| 原則 | 可視化・検証できること |
|---|---|
| **監査性** | 誰／どのAIが、どの意図・指示・根拠・権限に基づいて、いつ何を実行・変更したかを辿れる |
| **完全性** | 任されたミッションの成功条件に対し、成果・未達・未検証・抜け漏れが分かる。確認できた範囲と不確実な範囲を区別できる |
| **自律性** | AIがどこまで自ら判断・実行でき、どの条件で人間の判断が必要になるかが明確である |

ここでいう自律性は、上位の意図と委任された権限の範囲内で行動できることを指す。完全性は、ミッションに対する網羅性と確認状況を意味し、AIの無謬性を保証するものではない。監査記録の存在と成果の正しさも区別し、成果は成功条件と根拠に照らして検証する。

監査性があるから活動を委ねられ、完全性が見えるから任務の達成を判断できる。この二つが自律性を支える。StrategyとExecutionの接続では、**「どの意図に基づく行動か、どの権限で実行されたか、成果を誰が何を根拠に検証したか」**を一続きで辿れることを設計上の到達点とする。

受領や承認は、その確認が仕事に必要な場合に使う。探索や短い日常作業を含む全Elementへ同一の承認ライフサイクルを要求しない。文章から約束・担当・完了を推測して、当事者の明示した事実と同じように扱わない。

## 概念アーキテクチャ

### 三分類 — クラウゼヴィッツ『戦争論』の 戦略・戦闘・兵站

現在の体系はクラウゼヴィッツ『戦争論』の三分に着想を得ている。目的、実行、それを支える道具を区別するためのモデルであり、あらゆる組織活動にこの分類だけで十分だとする根拠ではない。実行から目的を見直す仕事や、複数の分類にまたがる日常操作も扱う。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Initiative。複数の Initiative が束ねられて戦略となる |
| **Execution** | 戦闘 | 実際に行動する | Element（最小単位）→ Object（Element の束）→ Domain（Object の集合） |
| **Sustainment** | 兵站 | 仕事道具 | Workload / CRM / SCM / Notebook / Table / Team / Calendar |

### Activity Space — 組織活動の文脈と信頼境界

Strategy・Execution・Sustainment の三分類、および横断機能の Home・Property は、**Activity Space** を組織活動の文脈として使う。Activity Space は組織の信頼境界であり（詳細は [境界と権限](#境界と権限boundary--permissions) を参照）、ユーザーが所属する組織・チームそのものを表す。Activity Space を切り替えると、三分類一式ごと別の組織の文脈へ移る。組織の行動を起票するときは、その Space 内の Object を選ぶ。個人の My Elements と Table は所有者の権限で扱い、Space への所属だけで共有されない。CRM / SCM の配置・設定は active Space ごとに保存し、参照する Table の所有者権限を引き継ぐ。

```
╔═══════════════════════ Activity Space ═══════════════════════╗
║ ┌──────────────────────────────────────────────────────────┐ ║
║ │  Strategy（戦略）— Initiative / Phase / Timeline            │ ║
║ │  何を達成し、どう勝つか。Initiative を束ねると戦略になる          │ ║
║ ├──────────────────────────────────────────────────────────┤ ║
║ │  Execution（戦闘）— Element → Object → Domain             │ ║
║ │  実際に行動する。労働・仕事・活動                             │ ║
║ ├──────────────────────────────────────────────────────────┤ ║
║ │  Sustainment（兵站）— Workload / CRM / SCM                │ ║
║ │                       / Notebook / Table / Team / Calendar │ ║
║ │  行動を支える仕事道具                                        │ ║
║ └──────────────────────────────────────────────────────────┘ ║
║   ＋ Home（横断）  — Now / Inbox / Calendar / My Elements      ║
║   ＋ Property      — 実行単位に付与するメタデータ                 ║
╚══════════════════════════════════════════════════════════════╝
```

ModeRail の固定セレクタ Home / Strategy / Execution がこの構造の背骨に対応する。Sustainment の各道具は Apps ランチャーから各自がレールに追加する。カタログは Tools（Notebook / Table / Team）と Sustainment（Workload / CRM / SCM）の2グループで表示し、概念上はどちらも Sustainment に属する。

### Strategy と Execution の分離

「何を達成するか」と「誰が何を行っているか」は異なる情報として保持する。UIにはそれぞれを扱うモードを用意し、目的・前提・決定と、担当・期限・状態を混同しない。一方、利用者の判断に両方が必要なら、Homeや相互リンクから同時に参照できるようにする。分類ごとに画面を往復させること自体は目的にしない。

| Strategy | Execution |
|----------|-----------|
| Initiative → Phase → Timeline | Domain → Object → Element |
| 目的、方針、前提、意思決定、成功条件 | 担当、期限、進捗、依存関係、成果物 |
| 「何を、なぜ、どう勝つか」 | 「何を今やるか、どこで詰まっているか」 |

意図と行動の接続が判断に役立つよう、相互リンクを見せる。

- **Initiative を開いたとき** — 参加 Object、実行上のリスク、負荷を併せて示す
- **Object を開いたとき** — 貢献先 Initiative（Contributes to）と、その戦略上の意図・成功条件を示す

レールのハイライトは `activeView` に追従するため、どちらのリンクを辿ってもモードは自動で切り替わる。この往復によって方針の確認や変更が実際に容易になるかを検証する。日常の実行に毎回Initiativeの設定や閲覧を要求しない。

### Strategy（戦略）：Initiative / Phase / Timeline

何を達成し、どう勝つかを扱う分類。目的・方針・前提・意思決定・成功条件がここに置かれ、担当・進捗は持たない。

**Initiative が Strategy の単位であり、複数の Initiative が束ねられることで戦略となる。** Initiative は Initiative を内包でき（`strategy_children`）、ポートフォリオのルートには最上位の Initiative だけが並ぶ。入れ子の Initiative は親の "Initiatives" セクションにだけ現れる。

| 機能 | 役割 | 実装 |
|------|------|------|
| **Initiative** | Object を目的単位で束ね、意図・前提・決定・成功条件を保持する | `strategies` + `strategy_objects` junction（Object 集合の唯一の置き場、[ADR 0017](../docs/adr/0017-campaign-objects-live-in-the-junction.md)）+ `strategy_children`（Initiative の入れ子）+ `intents`（decision / assumption / measure）。view id は `strategy` |
| **Phase** | 努力をどの段階に配分するかの時間箱 | `phases`（Domain スコープ）。Object / Element は高々 1 つの Phase に所属 |
| **Timeline** | Initiative の期間・シーケンスを月スケール Gantt で俯瞰 | 行を展開すると参加 Object のバーが同じ軸に並ぶ |

Initiative を開くと、意図・状況・前提・決定・指標・リスクの各ウィジェットと、参加 Object の一覧が並ぶ。そこから Object 詳細へ一クリックで降りられる。

**Decision Lab** は、重要な Element への集中・着手延期・担当変更を試し、条件付きの完了日と他の仕事への影響を現状と比較するウィジェット。同じ Space で閲覧できる仕事の工数・担当・依存関係・不在を使い、履歴の蓄積を待たずに試算する。未見積や解けない依存は未算定として示す。採択理由・前提・比較結果は Initiative の Decision に保存し、対象 Element に結び付ける。試算は実際の予定を変えず、Element の編集へ戻って判断を実行に反映する。完了日の試算と成功条件の達成は区別する。

### Execution（戦闘）：Element → Object → Domain

実際に行動する分類。担当・期限・進捗・依存関係・成果物を扱う。Initiativeに結び付いた実行も、目的の整理に先立って始まる日常の仕事も扱う。

三層はアーレント『人間の条件』の **労働・仕事・活動** の三分に着想を得ている。製品ではElementを行動、Objectを成果や案件のまとまり、Domainを活動の場として使う。哲学上の区分への一致より、実際の仕事を探し、更新し、共有しやすい粒度を優先する。

| 概念 | 役割 | 構造ルール |
|------|------|-----------|
| **Element** | 行動の最小単位 | 個人の仕事、またはObjectに所属する仕事。multi-homing可（`object_id` + `element_objects` junction） |
| **Object** | 成果や案件としてElementを束ねる単位 | 現在の構造はDomain直下のフラットな集合。multi-homingは `object_domains` |
| **Domain** | Objectの集合、活動の場 | Space内の活動をまとめる。activeなDomainはlocalStorage永続 |

Object は「箱」、Element は「中身」。箱は一段しかなく（ネストしない）、中身は複数の箱に同時に入れられる。Object 詳細は貢献先 Initiative を常に表示し、Strategy へ一クリックで戻れる。

### Sustainment（兵站）：横断的維持活動

行動を支える**横断的維持活動**の分類。Worker（human | ai_agent）は Execution で行動する主体であり、Sustainment はその Worker が働き続けられるように支える道具を扱う。

| 道具 | 役割 | 実装 |
|------|------|------|
| **Workload** | Worker 別の日次負荷を Space 横断で俯瞰 | Apps ランチャーの App。Domain は自前のフィルタで絞る |
| **CRM** | 商談の見通しと、優先して対応する顧客を把握 | Table の商談・顧客データを参照する `operations-planner`。通貨別の確度加重予測とフォローアップのリスクを表示 |
| **SCM** | 欠品を予測し、需要の変化に応じた補充を計画 | 同じ `operations-planner` で在庫・需要・調達条件を参照。入荷前の欠品、推奨補充数量、通貨別費用を試算 |
| **Notebook** | 思考・記録のドキュメント（議事録 / メモ） | 独自 HTML エディタ（`AppleNoteEditor` + `htmlSanitizer`）。**Folder → File の 2 階層**ツリー（`notes` + `note_contents.html`） |
| **Table** | 任意の表 | `tables` + `table_columns` / `table_rows` / `table_cells`。所有者限定の RLS |
| **Team** | Worker と所属の一覧 | `workers`（human \| ai_agent）。`element_assignees` で Element にアサイン |
| **Calendar** | Element の期日を時間軸で管理 | 日 / 週 / 月ビュー |


**CRM** は商談名・顧客・段階（open / won / lost）・金額・確度・通貨・成約予定日・最終連絡日・次回アクション日を扱う。予測期間内の未成約商談を金額 × 確度で試算し、通貨ごとに集計する。連絡の停滞、次回アクションの未設定や期限超過、成約予定日の超過を示し、フォローアップ対象を絞れる。

**SCM** は品目・仕入先・在庫・日次需要・リードタイム・安全在庫・発注残・入荷予定日・単価・通貨を扱う。各行は一つの数量単位と一件の入荷予定を持つ。需要倍率と計画日数を変えて、在庫の持続日数、入荷前の不足、補充数量と費用を試算する。発注残が存在するだけで欠品を解消したと見なさず、入荷時期を考慮する。入力の不足や不正な値は明示し、異なる通貨の金額は合算しない。

両 App は既存の Table を選んで列を対応付けるか、空の業務用 Table をテンプレートから作る。業務入力は Table の行・セルに保存する。`operations-planner` の用途（`kind`）、Table ID、列 ID によるフィールド対応、予測期間・需要倍率・連絡間隔は `widget_boards` の配置パラメータに保存する。列名を変更しても対応関係は維持する。CRM / SCM のサーフェスは `me` を対象とし、配置をユーザー・active Space・サーフェス別に保存する。同じウィジェットは `me` / `domain` / `object` / `initiative` の `main` に配置できる。

リスクへの対応は、利用者が根拠を確認して **Element を作成**する。選択した Object または My Elements に起票し、説明に判断根拠・元 Table と行の ID・試算時点のデータと条件を残す。Sustainment は意思決定を支える情報と道具を供給し、行動は Execution、目的と成功条件は Strategy が持つ。

Object Detail 内の Workers / Resource / Calendar / Gantt タブは、同じ道具を Object 単位で提供するもの。稼働・勤怠・給与・採用・育成・予算・会計・契約・購買・設備などへの拡張候補は、[拡張構想](#拡張構想vision)を参照。

### Home — 横断サーフェス

分類をまたいで、自分の行動と必要な応答を選ぶサーフェス。Nowを既定の入口にし、既存の明示的な初期view設定は保持する。

| 機能 | 役割 |
|------|------|
| **Now** | 担当・状態・記録済みの依存・開始日等から、自分が動く候補と待ちを理由付きで示す。必要な更新をその場で行う |
| **Inbox** | 通知フィード |
| **Calendar** | 自分の Element の期日 |
| **My Elements** | 自分が所有・アサインされた Element を横断表示 |

Nowの「前提が完了」は記録された依存の範囲の判断であり、現実の着手可能性や余力の保証ではない。見えない前提は不明として扱い、承認決定者を推測しない。更新がないことを停滞・怠慢と解釈しない。

### 案件の持込みと日常の更新

既存の1案件を、CSV / TSV / 複数行テキストの貼付またはCSVファイルから取り込む。列対応と未解釈の状態・日付・担当をpreviewで確認し、1～100行を原子的にコピーする。Spaceを選び、可視の既存Objectか新しい案件名を指定する。Domainがない場合はGeneralを用意し、最初に概念の設定を要求しない。

取り込みは同期ではない。未対応の情報と元データを照合し、対象案件の運用の正本を当事者が選べるようにする。外部連携、全履歴の移行、未登録者へのtoken招待が必要な場合は、今回の入口だけでは導入を完了できない。

check-inは、必要なstatus変更、短い更新文、任意の次の一手を一回で保存し、同じElementに共有履歴を残す。毎回の全項目入力や日報を要求しない。並行編集では下書きを保持し、最新内容を確認してから再送する。画面から作成・削除した依存をNowも読み、前提の更新を次の人の表示へ反映する。Homeと詳細で同じ仕事を更新し、文章だけから依存や完了を推測しない。

### Property：Objectごとの業務フィールド

カスタムフィールドの定義は **Objectに帰属**し、そのObjectに含まれるElementの情報を保持する。作成の「＋」はObject内のElements一覧にだけ置く。My ElementsとDomain横断のElements一覧、およびObjects一覧にはカスタムフィールドの作成を置かず、基本情報を中心に表示する。

- **標準フィールド** — Status・Priority・Type・Assignee・Due date・Tags・所属Objectsなど。各ビューで表示／非表示・順序・幅を設定できる。名前は常に表示する。
- **カスタムフィールド** — テキスト・単一選択・複数選択・数値・日付・人物・チェックボックス・URL・メール・電話。Object内で名前・説明・選択肢・色・順序・数値の表示形式を設定する。
- **Tag** — Element自身の属性。同じElementをどのビューから見ても引き継ぐ。
- **値と表示の分離** — 非表示や幅の変更で値を消さない。選択肢の表示名を変えても保存済みの値を維持し、廃止した選択肢も過去のElement上では読める。数値の丸めは表示にのみ適用する。

顧客への提案・連絡や、調達・出荷などの行動は Element として運用し、その実行に必要な属性を Object のフィールドで表現する。商談・在庫の業務台帳と試算は Sustainment の CRM / SCM が Table を使って扱う。Strategy・Execution・Sustainment の役割を保ったまま、分析から行動につなげる。必要な属性だけを足し、設定と保守の負担も評価する。

データは `custom_columns`（定義）・`custom_column_placements`（配置）・`custom_column_values`（Elementの値）に分ける。保存済みのSpace・個人・Domainスコープのデータは保持するが、一覧の作成導線はObjectスコープに統一する。

## UI デザイン原則

### レイアウト哲学
- **常時可視ナビ + 折りたためる文脈ペイン + メインキャンバス** の 3 列構成
- **ModeRail**（46px）は分類セレクタ：固定の Home / Strategy / Execution ＋ Apps ランチャーから追加した App。カタログは Tools（Notebook / Table / Team）と Sustainment（Workload / CRM / SCM）の 2 グループで、すべて Sustainment の道具
- **AppSidebar** は分類内のナビ。最上部に Space 名（`SpaceSwitcher`）＋ Discover ＋ Create。本体は現在のモードに応じて切替（Home＝Now・Inbox・Calendar・My Elements / Strategy＝Initiative・Phase・Timeline / Execution＝Domain ツリー / App 各種＝モード名ラベルのみ）
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
- **CRM / SCM は Table の見せ方** — 業務入力は共通の Table スキーマ、列 ID の対応と試算条件は `widget_boards`。計算結果は入力から導出する
- **active な Domain は localStorage 永続** — どの Domain を開いているかはクライアント側で切替
- **Notebook は 2 階層** — `notes`（Folder→File ツリー、Folder はルート）+ `note_contents.html`
- **Worker = human | ai_agent** — 同一テーブルで人的リソースと AI エージェントを管理

## 境界と権限（Boundary & Permissions）

組織の信頼境界は **ActivitySpace**。Strategy / Execution / Sustainment / Home / Property は、選択中の ActivitySpace を組織活動の文脈として使う（詳細は前述の [Activity Space — 組織活動の文脈と信頼境界](#activity-space--組織活動の文脈と信頼境界)）。組織データは Linear 型の二層メンバーシップでアクセスを管理し、個人の道具は所有者の権限で管理する。

- **二層の所属** — Space メンバー（`activity_space_members`：owner/member）＝組織の正規メンバー。Domain メンバー（`domain_members`）＝その Domain だけに招かれた人。Object メンバー（`object_members`）はさらに細かい Object 限定の同席者（通常 domain_members の部分集合、Object 限定ゲストも可）。
- **Guest** — `domain_members` だが Space 非メンバーの人。招かれた Domain しか見えず、組織の他 Domain 構造は一切露出しない。他組織の人を招いても相手の Space は混ざらない（Domain は `activity_space_id` で1つの Space に属したまま、相手には「Shared with me」として現れる）。
- **Domain 可視性 `domains.privacy`** — `workspace`＝同じ Space のメンバー全員が閲覧可。`private`＝`domain_members` のみ。
- **可視性カスケード** — Domain 可視 ⇔ domain_member、または（`workspace` かつ Space メンバー）。Object 可視 ⇔ object_member、または所属 Domain が可視。Element 可視 ⇔ 所有者、または所属 Object が可視。
- **サーバーで強制** — 上記は SECURITY DEFINER ヘルパー（`user_can_see_domain` / `user_can_see_object` / `user_can_see_element`）として RLS に組み込む。クライアント表示任せにしない。横断取得 RPC `get_explorer_data` も同じ可視性で Object/Element を返す。
- **招待 UI** — Space 招待は ActivitySpace 設定（owner のみ）、Domain 招待（Guest 化）は Domain の Team 設定から。
- **Table と CRM / SCM** — Table の RLS は `created_by = auth.uid()` による所有者限定。`domain_id` を付けても Space メンバー全員に共有されない。CRM / SCM は active Space の Domain に属する Table と、Domain 未指定の個人 Table を選択できる。配置はユーザー・Space 別に保存する。

## AI 連携

Claude API を Supabase Edge Functions 経由で利用：
- `alcon-copilot`：汎用 AI アシスタント
- `run-agent`：エージェント実行
- `draft-object`：Object 自動生成
- `summarize-note`：Note 要約
- `analyze-change`：変更分析
- `validate-task`：Element 検証

## 拡張構想（Vision）

拡張は、実顧客の反復業務で現在の道具では解けない負担が確認でき、導入と日常操作を複雑にする費用を上回る場合に選ぶ。Sustainmentでは、Workload・CRM・SCMを起点に、Object単位の道具を横断して使うことや、予算・会計・契約・購買・勤怠・設備まで扱うことが候補になる。概念上分類できることだけを開発理由にしない。

### モジュール型展開

独立した反復ジョブと購入者が確認できた領域は、アプリとして提供する選択肢がある。

| モジュール | 領域 | 状態 |
|-----------|------|------|
| **Alcon SEM** | Strategy & Execution Management | 現在開発中 |
| **Kanjo-kei** | 会計・仕訳管理 | 構想段階 |
| **HR** | 人事・勤怠・評価 | 構想段階 |
| **Sales** | 営業活動支援 | Alcon 内の CRM App は商談台帳・予測・フォローアップ分析を提供。独立アプリとしての展開は構想段階 |

### 共通化の候補

既存の基盤を再利用できるか、各領域の意味と権限を保てるかを評価する。
- **Domain / Object / Element** — 構造の骨格
- **Property** — カスタムメタデータ
- **Table** — 業務台帳と分析入力の共通データ基盤
- **Note** — ドキュメント基盤
- **Widget** — ダッシュボード基盤
- **Worker** — 人的 / AI リソース管理
- **AI** — Claude 連携基盤

### 技術選択の基準

リポジトリ・デプロイの分割、npmパッケージやSupabaseスキーマの共有は、独立した提供サイクル、運用費、信頼境界を根拠に選ぶ。認証・Space・Domainの権限を維持し、共通化のために業務ごとの意味を失わない。将来構想は、現在の導入と日常利用の検証より先に拡張を約束するものではない。
