# Alcon — プロダクト概要と設計思想

## プロダクト概要

**Alcon は世界最高の組織活動支援ツールを目指す。** 人間が目的を示し、人間と AI が同じ業務データと権限のもとで仕事を進める。結果を確かめながら、業務の仕組みを改善できる基盤にする。長期的には業界を問わず使えることを目指し、適した業務と導入範囲は実際の顧客の仕事で確かめる。

目指すのは、**自分の仕事を更新するだけで、次の人に必要な情報が伝わること**。進行中の案件を取り込み、自分が着手する仕事の候補と、誰の何を待っているかを把握し、必要な情報を更新する。関係者全体の確認・転記・再説明を減らせるかを、製品の判断基準にする。

Strategy・Execution・Sustainment は、情報と操作を整理するためのモデルである。概念を統一するだけでなく、顧客の仕事が改善するかを確かめる。最初の案件を始めるために、分類の理解や設定を求めない。調査や試行錯誤、引き継ぎ、繰り返し行う業務を扱いにくくするなら、実際の負担をもとにモデルを見直す。

## 顧客価値と検証

### 初期の顧客と対象業務

初期の顧客候補は、顧客への導入支援、制作、業務受託などの案件を少人数で並行して進め、専任のツール管理者を置けないチーム。検証対象は、20～200人の組織に属する5～20人のチームを仮に想定する。市場調査で確定した顧客像ではない。まず登録済みの内部メンバー3～8人と1案件で、担当者の更新を受けた同僚が次の作業に進めるかを確かめる。

購入者、導入担当、実行者、情報の受取人を分けて考える。責任者が盤面を読めても、実行者の入力や受取人の確認が増えるなら価値は成立しない。仕事の進め方、更新できる人、どの記録を正式なものとして使うかも、導入時に確認する。

### 判断の根拠

- **顧客の仕事** — 実案件の導入、確認・転記の削減、漏れ・手戻り、催促なしの反復利用、有償継続を観測する。
- **公開調査** — 当事者の不満から仮説を作り、競合の現行機能で反証する。苦情の数を市場規模や乗換意向とみなさない。
- **実装検証** — 入力の保持、権限、原子性、競合、再試行、画面間の一貫性を確かめる。テストの成功を定着やPMFの成功に置き換えない。
- **演習と概念モデル** — 実行可能性や摩擦の発見に使う。架空の運用と哲学的な説明だけでは実顧客の需要は確認できない。

利用開始の指標（Activation）は、一人の更新を別の一人が読んで行動できたこととする。登録や取り込みの完了だけでは判断しない。継続利用の指標（Retention）は、次の仕事でも催促されずに使い、確認・転記を減らせたこととする。ログイン回数だけでは判断しない。更新する人と受け取る人の合計の管理時間が減らない、二重報告が残る、管理者だけが使う場合は仮説を見直す。

Linear・Asana・ClickUp等には、個人ビュー、取り込み、依存、承認、連携、AI更新が既にある。機能名や「AIが動く」という説明を差別化にしない。適切に設定した既存製品と比べ、対象顧客が一連の仕事をより少ない入力・判断・確認で終えられるかを検証する。現在の調査は差別化・PMF・全面代替の証明ではない。

根拠となる当事者の具体例、8つの反証ケース、activation・retention・棄却の暫定基準は [日常の実行と共有に関する調査・製品判断](../docs/research/2026-09-coordination-core.md) に置く。開発の進捗と次の判断は盤面に戻す。

## 人間とAIへの委任

### 目指す価値と設計思想

利用者に届けたい価値は、自分の仕事を進めると共有も進み、目的と根拠を確かめながら次の行動を選べること。

その価値を人間とAIが共に活動する組織へ広げる設計思想は、次のとおり。

> 人間の意図のもとでAIが自律的に活動し、その過程と成果を検証できる組織活動基盤。

原則は、**「意図で委ね、成果と根拠で確かめる」**。何を任せ、何が行われ、どこまで達成・検証されているかを把握できることを目指す。以下は設計・開発を導く原則であり、すべてが実装済みであることを意味しない。AIの起票・報告・判断が人間の確認や訂正を増やす場合は、その適用を見直す。

### AIへのミッションコマンド

Alconにおけるミッションコマンドとは、人間が目的・成功条件・制約・権限を示し、AIがその意図を理解して、状況に応じた手段を選び、権限内で判断・実行すること。権限を超える判断が必要になったり、前提が成り立たなくなったりした場合は、人間に判断を求める。人間は委任範囲を変更し、実行を停止できる。

| 層 | ミッションコマンドにおける役割 |
|---|---|
| **Strategy** | 人間が意図・成功条件・制約を定め、AIと共有する。実行から得られた結果を踏まえて方針を見直す |
| **Execution** | AIが意図に沿って行動を組み立て、与えられた権限内で実行し、成果と未達事項を報告する |
| **Sustainment** | 実行に必要な情報・道具・資源・アクセス権を供給する |

Initiative は任務の背景となる目的を、Object は委任する任務を、Element は遂行に必要な行動を表す。既存の概念を使って目的と行動を結び付け、実行結果を戦略の見直しに反映できるようにする。

### 委任を支える三原則 — 監査性・完全性・自律性

| 原則 | 可視化・検証できること |
|---|---|
| **監査性** | 誰／どのAIが、どの意図・指示・根拠・権限に基づいて、いつ何を実行・変更したかを辿れる |
| **完全性** | 任されたミッションの成功条件に対し、成果・未達・未検証・抜け漏れが分かる。確認できた範囲と不確実な範囲を区別できる |
| **自律性** | AIがどこまで自ら判断・実行でき、どの条件で人間の判断が必要になるかが明確である |

ここでいう自律性は、上位の意図に沿い、委任された権限の範囲内で行動できることを指す。完全性は、ミッションに対する網羅性と確認状況を意味し、AI が誤らないことを保証するものではない。監査記録の存在と成果の正しさも区別し、成果は成功条件と根拠に照らして検証する。

監査性があるから活動を委ねられ、完全性が見えるから任務の達成を判断できる。この二つが自律性を支える。StrategyとExecutionの接続では、**「どの意図に基づく行動か、どの権限で実行されたか、成果を誰が何を根拠に検証したか」**を一続きで辿れることを設計上の到達点とする。

受領や承認は、その確認が仕事に必要な場合に使う。探索や短い日常作業を含むすべての Element に同じ承認手順を求めない。文章から約束・担当・完了を推測して、当事者の明示した事実と同じように扱わない。

## 業務に合わせて育つ基盤

### 提供するもの

ユーザーが「引き継ぎ漏れを減らしたい」と伝えると、AIが現在の案件、必要な情報、担当範囲、作業を止める条件を確認し、そのチームに合う入力・引き継ぎ・例外対応の仕組みを組み立てる。人間は具体的な案件と変更内容を確かめ、委任範囲を決める。運用後は受取人が次へ進めたか、確認や訂正が増えていないかを測り、仕組みを調整する。これは目指す製品の姿であり、現在の Copilot には継続的に業務設定を改善する機能はない。

利用者にアプリ設計者になることを求めない。初回は既存の1案件を動かし、情報が不足した場面や例外が繰り返された場面で、必要な設定を提案する。日常の操作はNowや案件の文脈で完結させ、チャットは目的の相談・変更の説明・例外の判断に使う。その結果、利用者にアプリ管理の負担が増えていないかも確かめる。

### AIが変えられるものと、基盤が保証するもの

| 対象 | 業務に合わせる内容 | Alcon が守る条件 |
|---|---|---|
| 情報 | 台帳の列、必須情報、意味と単位、入力・参照の対応 | Table / Propertyの型・ID・所有権・出典。既存データを保持した移行 |
| 行動 | 担当への引き継ぎ、状態遷移、依存、例外条件、使う道具 | Element / Objectと実行履歴。同じ仕事を二重実行しないこと、失敗からの再開 |
| 判断 | 検出条件、見積・試算、候補の比較 | 入力・計算規則・条件・欠損の明示。確定計算はUIとAIで共有する |
| 委任 | AIの役割、読める情報、変更できる対象、予算と停止条件 | Space / Domain / 所有者の権限。モデルの指示とは別にサーバーで強制する |
| 表示 | 入力フォーム、一覧、集計軸、Widgetの配置 | 人間とAIが同じ永続データを操作すること。画面へ業務の正本を埋め込まない |
| 評価 | 成功条件、比較期間、対象案件、失敗・訂正の記録 | 意図と実行結果の対応。仮説・試算・観測結果を区別する |

AIによる変更も、バージョンと適用範囲を持つ業務設定として扱う。変更案には目的、根拠のレコード、変更前後、影響する人と進行中の仕事、試す範囲、評価方法、戻す条件を含める。汎用コードを生成する拡張を提供する場合も、宣言済みの能力・入出力・権限・資源上限の契約に従わせる。UIを作れることだけで本番の業務変更権限を与えない。

### 改善の進め方

1. **観察** — 明示された目的と、既存の業務データ・例外・手戻りを読む。不足している情報は、不明なものとして扱う。
2. **比較** — 同じ入力と評価条件で現状と変更案を比較する。生成した説明の説得力を採用理由にしない。
3. **試行** — 委任範囲内の小さな対象へ適用し、設定版・対象・根拠・実行結果を記録する。権限拡張、外部送信、費用を伴う行為は個別の実行契約で扱う。
4. **評価** — 実案件の結果と人間の確認・訂正時間を測る。改善した設定を次の反復に使い、悪化した設定は戻す。

通常の案件を進める実行と、その案件を動かす規則の変更は別の権限にする。AIが自分の成功条件や警告閾値を緩め、成功したことにしてはならない。比較では対象・期間・分母を明示し、需要や案件構成の変化も記録する。前後比較だけで因果効果を断定しない。

設定を戻しても、送信済みの連絡や発注は取り消されない。設定の復元、既存データの移行、外部への補償操作を分けて設計する。人間の修正はその実行の訂正として保持し、次回以降の規則に反映する際には適用対象と根拠を示す。例外一件から組織全体のルールを書き換えない。

### 現在の実装範囲

現在はTableとWidgetのCRUD、Elementの実行情報、Initiativeの成功条件、CRMの計算器を持つ。Copilotの `analyzeOperations` は、保存済み `operations-planner` の列対応と呼出ユーザーが読めるTableを取得し、UIと同じ計算器で現状と条件変更後を比較する。対象の日付・設定版・Tableと行ID・欠損・通貨別集計を返し、取得上限を超えた台帳で部分集計を全体の結果として返さない。診断自体は台帳・設定・Elementを変更しない。

この診断はCRMに限る。初期対象である案件引き継ぎへの適合や、任意の業務の最適化を証明するものではない。現状の読み取りは単一トランザクションのスナップショットではなく、Copilotの会話もメモリ保持である。継続試行の台帳、設定版と実行の厳密な対応、イベントを受けて開始し、中断後も再開できる実行の仕組み、成果の自動観測、外部連携の補償処理は未提供であり、その能力を前提に委任させない。実装状況と次の作業は盤面で管理する。

### 事業としての成立条件

「AIでアプリが作れる」「エージェントが動く」は既存製品にもある。2026年9月の公式資料では、[Airtable Omni](https://support.airtable.com/articles/1744327578-using-omni-ai-in-airtable) はアプリ構築とレコード操作を、[Notion Custom Agents](https://www.notion.com/help/custom-agents) は権限・トリガー・履歴を伴う反復業務を提供している。柔軟な基盤という分類だけを差別化の証拠にしない。

最初は、少人数チームが複数の案件を受け付け、担当へ引き継ぎ、例外に対応するまでの業務を支援する。最小の導入単位と、確認・転記・手戻りがどれだけ減ったかを一緒に提供する。まず同種の少数の有償チームで、導入を支援しながら再利用できる設定を見つける。顧客ごとの専用コードと専任運用者が増え続けるなら、基盤としての経済性は成立していない。

運用を通じて、その組織のデータの意味、例外への対応方法、採用された変更と成果の関係を蓄積し、繰り返し安定して実行できるようにする。蓄積だけで参入障壁ができると決めつけず、再設定の短さ・確認の少なさ・継続利用で確かめる。業務データと設定の持ち出し可能性を保ち、機密の組織間転用を前提にしない。モデルや外部AIが交代しても同じ権限と実行契約を使える設計を目指す。

価格は席数や生成画面数だけに依存させず、基盤の利用と予測可能な実行量を組み合わせる仮説で検証する。成功一件当たりの推論・連携・再試行・人間の確認・導入支援の原価を測り、利用者には予算上限と費用の理由を見せる。成果報酬は成果の帰属と計測方法に合意できる業務でのみ検討し、現時点で料金体系を確定したことにはしない。

継続判断は、同種の業務の反復利用、有償継続、管理時間と手戻り、初回導入と次回変更に要する支援、成功一件当たり原価で行う。AIが出す変更案が増えても確認が増える、二重入力が残る、同じ設定を再利用できない、適切に設定した既存製品より負担を減らせない場合は、対象業務か提供方法を見直す。

## 概念アーキテクチャ

### 三分類 — クラウゼヴィッツ『戦争論』の 戦略・戦闘・兵站

現在の体系はクラウゼヴィッツ『戦争論』の三分に着想を得ている。目的、実行、それを支える道具を区別するためのモデルであり、あらゆる組織活動にこの分類だけで十分だとする根拠ではない。実行から目的を見直す仕事や、複数の分類にまたがる日常操作も扱う。

| 分類 | 戦争論 | 何を扱うか | 単位 |
|---|---|---|---|
| **Strategy** | 戦略 | 何を達成し、どう勝つか | Vision（Space が目指す姿）→ Portfolio（Initiative の束）→ Initiative。複数の Initiative で戦略を構成する |
| **Execution** | 戦闘 | 実際に行動する | Domain（活動の場）→ Object（成果物の束）→ Element（最小単位） |
| **Sustainment** | 兵站 | 仕事道具 | Workload / CRM / Notebook / Table / People / Calendar |

### Activity Space — 組織活動の文脈と信頼境界

Strategy・Execution・Sustainment の三分類、および横断機能の Home・Property は、**Activity Space** を組織活動の文脈として使う。Activity Space は組織の信頼境界であり（詳細は [境界と権限](#境界と権限boundary--permissions) を参照）、ユーザーが所属する組織・チームそのものを表す。Activity Space を切り替えると、三分類一式ごと別の組織の文脈へ移る。組織の行動を起票するときは、その Space 内の Object を選ぶ。個人の My Elements と Table は所有者の権限で扱い、Space への所属だけで共有されない。CRM の記録と SCM の拠点・仕入先・品目は Space か、その中の 1 つの Domain に属し、Domain に属するものはその Domain を見られる人だけが扱う（Domain に属さないものは Space のメンバーで共有する）。

```
╔═══════════════════════ Activity Space ═══════════════════════╗
║ ┌──────────────────────────────────────────────────────────┐ ║
║ │  Strategy（戦略）— Vision / Portfolio / Initiative         │ ║
║ │  何を達成し、どう勝つか。Initiative を束ねると戦略になる          │ ║
║ ├──────────────────────────────────────────────────────────┤ ║
║ │  Execution（戦闘）— Domain → Object → Element             │ ║
║ │  実際に行動する。活動・仕事・労働                             │ ║
║ ├──────────────────────────────────────────────────────────┤ ║
║ │  Sustainment（兵站）— Workload / CRM                      │ ║
║ │                       / Notebook / Table / People / Calendar │ ║
║ │  行動を支える仕事道具                                        │ ║
║ └──────────────────────────────────────────────────────────┘ ║
║   ＋ Home（横断）  — Now / Inbox / Calendar / My Elements      ║
║   ＋ Property      — 実行単位に付与するメタデータ                 ║
╚══════════════════════════════════════════════════════════════╝
```

ModeRail の固定セレクタは Inbox / Calendar / Strategy / Execution。Strategy と Execution がこの構造に対応し、Inbox と Calendar は毎日の入口として常設する。レール最下部のアバターは Profile を開き、Now / My Elements / My Notes / AI は Profile のタブとして並ぶ。Sustainment のその他の道具は Apps ランチャーから各自がレールに追加する。カタログは Tools（Notebook / Table / People）と Sustainment（Workload / CRM / SCM）の2グループで表示し、概念上はどちらも Sustainment に属する。

### Strategy と Execution の分離

「何を達成するか」と「誰が何を行っているか」は異なる情報として保持する。UIにはそれぞれを扱うモードを用意し、目的・前提・決定と、担当・期限・状態を混同しない。一方、利用者の判断に両方が必要なら、Homeや相互リンクから同時に参照できるようにする。分類ごとに画面を往復させること自体は目的にしない。

| Strategy | Execution |
|----------|-----------|
| Vision → Portfolio → Initiative | Domain → Object → Element |
| 目的、方針、前提、意思決定、成功条件 | 担当、期限、進捗、依存関係、成果物 |
| 「何を、なぜ、どう勝つか」 | 「何を今やるか、どこで詰まっているか」 |

意図と行動の接続が判断に役立つよう、相互リンクを見せる。

- **Initiative を開いたとき** — 参加 Object、実行上のリスク、負荷を併せて示す
- **Object を開いたとき** — 貢献先 Initiative（Contributes to）と、その戦略上の意図・成功条件を示す

レールのハイライトは `activeView` に追従するため、どちらのリンクを辿ってもモードは自動で切り替わる。この往復によって方針の確認や変更が実際に容易になるかを検証する。日常の実行に毎回Initiativeの設定や閲覧を要求しない。

### Strategy（戦略）：Vision / Portfolio / Initiative

何を達成し、どう勝つかを扱う分類。目的・方針・前提・意思決定・成功条件がここに置かれ、担当・進捗は持たない。

**Strategy は Vision → Portfolio → Initiative の階層で、Execution の Domain → Object → Element と同じ形をしている。** Vision は Space が目指す姿で、Space に複数置ける（`visions`：名前、目指す姿の一文、いつまでに、なぜ、達成の判断基準）。メンバーは誰でも Vision を作れ、変更・削除できるのは書いた人か Space のオーナー。Portfolio は 1 つの Vision に属する Initiative の束（`portfolios.vision_id`）で、`parent_id` で入れ子にでき、入れ子の Portfolio は親と同じ Vision に入る。Initiative は 1 つの Vision に属し（`strategies.vision_id`）、その Vision の Portfolio の中か、Vision の直下に置く。Initiative が入る Portfolio は高々 1 つ（`strategies.portfolio_id`）で、Portfolio に入れるとその Portfolio の Vision に移る。Vision ページには配下の最上位 Portfolio が集計（Initiative 数・平均進捗・警告数）つきで並び、直下の Initiative も並ぶ。Portfolio ページは開いている Vision のツリーで、各 Portfolio に配下（入れ子分を含む）の Initiative 数・平均進捗・警告数を出し、開くと説明・中の Portfolio・Initiative の健全性を示す。Initiative 一覧は開いている Vision のもので、どの Vision にも入っていない Initiative をその下に分けて出す。Vision の削除は配下の Portfolio も削除し（cascade）、Initiative はどの Vision にも入らない状態に戻る。Portfolio の削除は中の Portfolio も削除する（cascade）。 親は同じ Space の Portfolio に限り、自分自身や自分の子孫の中には入れられない（DB のトリガで強制）。 Initiative 自体は Space に属さず、Object の Domain を介して Space に届く（[ADR](../supabase/migrations/20260902140000_strategy_boundary_visibility.sql) の境界可視性）。そのため Portfolio ページには、この Space の Domain に Object を持つ Initiative と、まだ Object を持たない Initiative を出す。Portfolio を削除すると、中の Initiative はどの Portfolio にも入らない状態に戻る（`on delete set null`）。Initiative を Portfolio に入れる操作は Initiative 側の書き込みなので、その作成者だけができる。 Initiative は Initiative を内包でき（`strategy_children`）、Initiative 一覧には最上位の Initiative だけが並ぶ。入れ子の Initiative は親の "Initiatives" セクションにだけ現れる。

| 機能 | 役割 | 実装 |
|------|------|------|
| **Vision** | Space が目指す姿。Space に複数置け、Portfolio と Initiative がその下に入る | `visions`（Space スコープ）。view id は `vision`、開いている Vision は `navigation.visionId`。作成はメンバー、変更・削除は書いた人か Space オーナー |
| **Portfolio** | 1 つの Vision に向かう Initiative を束ね、Strategy を少数の賭けとして読めるようにする。入れ子にできる | `portfolios`（`vision_id`、`parent_id` で入れ子、メンバーが作成・編集）+ `strategies.portfolio_id`。view id は `portfolio`、開いた Portfolio は `navigation.portfolioId` |
| **Initiative** | Object を目的単位で束ね、意図・前提・決定・成功条件を保持する | `strategies` + `strategy_objects` junction（Object 集合の唯一の置き場、[ADR 0017](../docs/adr/0017-campaign-objects-live-in-the-junction.md)）+ `strategy_children`（Initiative の入れ子）+ `intents`（decision / assumption / measure）。view id は `strategy` |
| **Phase** | 活動を期間で区切り、力の配分を決める単位 | `phases`（Domain スコープ）。Object / Element は高々 1 つの Phase に所属。ナビには出さず、Initiative や Domain から到達する |
| **Timeline** | Initiative の期間・シーケンスを月スケール Gantt で俯瞰 | 行を展開すると参加 Object のバーが同じ軸に並ぶ。ナビには出さない |

Vision の名前変更と削除は、サイドバーの Vision 行の「…」（モーダルの General）で行う。Strategy の設定は、同じモーダルと Settings > Strategy の両方から同じパネルで開く。**Initiative** は判定閾値（Due soon / Stalled / Idle）で、Domain ごとの `risk_thresholds` を編集する（Elements > SLAs と同じ値）。**Phase** は Domain ごとの作成既定値（既定の長さ、開始日を「今日」か「最後の Phase の翌日」にする）で、新規 Phase ダイアログの日付に効く。**Timeline** は個人の表示設定（月 / 四半期スケール、前後の月数、今日の線、進捗の塗り）で `user_preferences` に持つ。

Initiative を開くと、意図・状況・前提・決定・指標・リスクの各ウィジェットと、参加 Object の一覧が並ぶ。そこから Object 詳細を一クリックで開ける。

**Decision Lab** は、重要な Element への集中・着手延期・担当変更を試し、条件付きの完了日と他の仕事への影響を現状と比較するウィジェット。同じ Space で閲覧できる仕事の工数・担当・依存関係・不在を使い、履歴の蓄積を待たずに試算する。未見積や解けない依存は未算定として示す。採択理由・前提・比較結果は Initiative の Decision に保存し、対象 Element に結び付ける。試算は実際の予定を変えず、Element の編集へ戻って判断を実行に反映する。完了日の試算と成功条件の達成は区別する。

### Execution（戦闘）：Domain → Object → Element

実際に行動する分類。担当・期限・進捗・依存関係・成果物を扱う。Initiativeに結び付いた実行も、目的の整理に先立って始まる日常の仕事も扱う。

三層はアーレント『人間の条件』の **活動・仕事・労働** の三分に着想を得ている。製品ではDomainを活動の場、Objectを成果や案件のまとまり、Elementを行動として使う。哲学上の区分への一致より、実際の仕事を探し、更新し、共有しやすい粒度を優先する。

| 概念 | 役割 | 構造ルール |
|------|------|-----------|
| **Domain** | Objectの集合、活動の場 | Space内の活動をまとめる。activeなDomainはlocalStorage永続 |
| **Object** | 成果や案件としてElementを束ねる単位 | 必ずDomainに置き、Domain直下のフラットな集合。multi-homingは `object_domains`。使わなくなったらアーカイブする |
| **Element** | 行動の最小単位 | 個人の仕事、またはObjectに所属する仕事。multi-homing可（`object_id` + `element_objects` junction） |

Object は Element をまとめる単位で、Object 同士はネストしない。一つの Element は複数の Object に所属できる。Object 詳細は貢献先 Initiative を常に表示し、Strategy へ一クリックで戻れる。

使わなくなった Object はアーカイブする（`objects.archived_at`）。データは残り、一覧・ピッカー・My Elements・Now・Calendar / Workload の範囲・ボードツールから外れ、リンクと検索からは開ける。所属 Object がすべてアーカイブ済みの Element も実行中の一覧から外れる。アーカイブと復元はその Object を管理する人（主 Domain の owner・admin）だけができ、Domain の Objects 一覧の下の「Archived」から開いて元に戻せる。Object が残っている Domain（アーカイブ済みを含む）は削除できず、先に Object を移すか削除する。判断は [ADR 0030](../docs/adr/0030-unused-objects-are-archived-and-domains-with-objects-stay.md)。

**Domain の実現構想** — 期間の限られた複数のプロジェクトをどう組み合わせて Initiative を実現するかを記す。Domain は継続する活動の場であり、複数の構想を持てる。構想は Initiative と任意の既存成功条件（measure）を参照し、期待する変化・仮説・前提・見直し条件を持つ。成立条件に Object の貢献と役割・順序の理由を結び、進捗とは独立に、観測事実・出典・観測日・解釈を記録する。構想の変更後は以前の評価を再評価対象にする。継続・変更・停止の判断は判断者と当時の構想・根拠を保存し、対象 Object と Initiative へ戻れる。書き込みは Domain の owner/admin、閲覧は Domain と Initiative の両方にアクセスできる人。同じ Domain 内で共有する Object の役割を比較できる。Domain の既定画面は判断が必要な事項を先頭に置く。

### Sustainment（兵站）：横断的維持活動

行動を支える**横断的維持活動**の分類。Worker（human | ai_agent）は Execution で行動する主体であり、Sustainment はその Worker が働き続けられるように支える道具を扱う。

| 道具 | 役割 | 実装 |
|------|------|------|
| **Workload** | Space 内の Worker 別日次負荷・不在・未計画作業を俯瞰し、平準化の提案（担当替え・前倒し・後ろ倒し・割り当て）をプレビューして適用する | Apps ランチャーの App。サイドバーにチームの負荷・平準化プラン・注意が要る順の人・Domain の範囲。提案は決定的に算出し、人が適用する（[ADR 0037](../docs/adr/0037-workload-rebalancing-is-computed-not-generated-and-applied-by-a-person.md)） |
| **CRM** | 今日動かすべき商談を示し、記録の手間なく商談を前に進める | Space か Domain に属する会社・担当者・商談・活動履歴（`crm_*`）。Today / Pipeline / Deals / Companies / Contacts / Forecast、メモやメールから更新する Capture、健全度と次の一手、AI の要約・メール下書き |
| **Notebook** | 思考・記録のドキュメント（議事録 / メモ） | 独自 HTML エディタ（`AppleNoteEditor` + `htmlSanitizer`）。**Folder → File の 2 階層**ツリー（`notes` + `note_contents.html`） |
| **Table** | 任意の表 | `tables` + `table_columns` / `table_rows` / `table_cells`。所有者限定の RLS |
| **People** | 誰がいて、何ができ、何に取り組んできたかを示し、次の仕事を誰に渡すかを決める | `workers`（human \| ai_agent）の所属・通常稼働時間、スキル（`worker_skills`）とその根拠（`worker_skill_evidence` — 本人が担当した完了済み Element）。アサイン履歴は `element_assignees` から導出し、入力させない |
| **Calendar** | Domain を横断して Element の予定を調整 | レールの Calendar から開く。初期表示は自分の予定で、ヘッダの範囲選択で Domain / Object の予定へ広げる。サイドバーに今日の日付・ミニ月・表示する人の選択を置き、同じ日 / 週 / 月ビューと保存先を使う。月表示と週/日表示の終日行では、期間を持つ Element を開始日から終了日まで続く帯で描き、表示範囲をまたぐ帯は行ごとに切って同じ段に揃える（左端は直線）。日のセルへの予定登録はホバーで出る「＋」か右クリックから行い、素のクリックでは何も開かない |

People の名簿は Space メンバー、閲覧できる Domain のゲスト、実行に参加する Worker をまとめ、人と AI エージェントを同じ形で扱う。スキルは Worker と同じ範囲に見え、根拠はその Element を見られる人にだけ見える。評価はスキルと別の閲覧境界（レポートライン）を要するため、People には置かない（ADR 0038）。ゲストの取得はメンバー設定と同じ境界 RPC を使う。受信可能な変更イベントは名簿へ反映し、所属テーブルの RLS によりイベントを受信できない変更は、画面へのフォーカス復帰または Refresh で最新の名簿を取得する。

**CRM** は標準の型と、組織ごとに変えられる範囲を分けて持つ。

標準（全組織で同じ）は、記録の型と計算である。会社（`crm_companies`）・担当者（`crm_contacts`）・商談（`crm_deals`）・活動履歴（`crm_activities`）を Space のメンバーで共有し、商談は Space 内で D-番号を持つ。商談は担当 Worker（人でも AI エージェントでもよい）、会社、主担当者と関わる人（決裁者・推進者・影響者・反対者・利用者・その他の役割つき、`crm_deal_contacts`）、ステージ、金額・確度・通貨、成約予定日、最終連絡日、次のステップ、貢献先の Initiative、契約の更新日を持つ。受注（won）・失注（lost）以外のステージはすべて進行中として集計し、商談をステージへ移すと、手入力した確度を除きそのステージの既定確度を適用する。活動履歴は追記のみで、ステージ・金額・確度・成約予定日の変更は DB が履歴に書き、電話・メール・打ち合わせの記録は最終連絡日を進める。更新日のある受注済みの商談は、更新日が近づくと Today の要対応に出て（期限切れは超過）、一度の操作で同じ会社・担当者・担当・金額の更新の商談を作れる（作成先は元のパイプラインが決め、見られないパイプラインには作らない）。更新の商談は元の商談を指し、1 件の商談に更新の商談は 1 件だけで、作られると元の商談は要対応から外れる。更新しない顧客は「更新しない」で要対応から外し、更新日は履歴のメモに残る。

組織ごとに変えられる範囲は次に限る。

- **パイプライン** — 新規・更新・代理店のように複数持て、それぞれがステージ（名前と既定の確度）・既定の通貨・予測期間・連絡が途絶えたとみなす日数・更新を何日前から要対応にするか・更新の商談を作るパイプラインを持つ（`crm_pipelines`）
- **呼び方** — パイプラインごとに商談の呼び名（案件、引合など）を決められる
- **独自項目** — 商談・会社・担当者に、テキスト・数値・日付・選択肢・チェックの項目を足せる（`crm_fields`、値は各記録の `custom`）。Domain の項目はその Domain の記録（パイプライン・会社・担当者）にだけ出て、Space の項目はすべての記録に出る
- **引き継ぎ** — 退職・異動のとき、ある人の進行中の商談（次のステップの Element の担当も）と担当の会社・担当者を、見えるすべてのパイプラインにわたって別の人へ一度に移せる。受注・失注の商談は担当のまま残り、移した商談の履歴に引き継ぎが残る。引き継ぎは DB の 1 トランザクション（`crm_hand_over`、呼んだ人の権限）で行い、新しい担当者を割り当てられない次のステップは前の担当者のまま件数で示す。商談の担当を一件ずつ変えたときも、次のステップの Element の担当が一緒に移り、移せないときはその旨を示す
- **Domain** — パイプライン・会社・担当者は Domain（部署・病棟・部隊・事業会社）に属させられる。商談はパイプラインの Domain に従い、商談から作った会社・担当者はその Domain に属する
- **つながり** — 次のステップの Element を置く Object と、成果を書き込む Initiative の成功条件（今四半期・今年・累計の受注件数・受注額・商談の数値項目（ARR・席数など）の合計、加重パイプライン、進行中パイプラインのいずれか。数値項目の合計は、数の成功条件には全通貨の受注をそのまま、金額の成功条件にはパイプラインと同じ通貨の場合だけ、その通貨の受注の値（1 円・1 ドル単位として読む）を桁に直して書き込む。選んだ項目が消えると書き込みを止める。金額はパイプラインと同じ通貨の成功条件にだけ、その桁（円・万円・百万円・億円）に直して書き込み、件数は社・件などの数の成功条件にだけ書き込む。率・期間あたりの値や通貨の違う成功条件には書き込まない）

Strategy・Execution とは次のようにつながる。会社・担当者・商談には、それについての Element（審査・見積・納品など）をリンクでき（`crm_element_links`）、記録の「関係する仕事」にリンクした Element と、その会社・担当者の商談の次のステップがまとめて出る。リンクは Element と記録の両方を見られる人にだけ見え、Object の Element は同じ Space の記録にだけリンクできる。商談の次のステップは Element であり、パイプラインの Object に起票して担当者にアサインする。Object が未指定なら、自分の商談は自分の My Elements に起票し、他人の商談は Element にせず商談上の次のステップとしてチーム全員に見せる（Element は作った人にしか個人のものにできないため）。Element の期日と状態が商談の次回アクションになり、Element を完了すると CRM は次の一手を求める。商談は貢献先の Initiative を持ち、Forecast は担当者別・Initiative 別に集計する。Initiative の前提（「大口顧客は更新する」など）は商談を見張れ、その商談が失注・リスク・成約予定日超過・更新遅れになると前提が揺らいだと示す（更新済みの商談は更新の商談で読み、読む人に見えない商談はリンクだけを示す）。パイプラインに成功条件をつなぐと、CRM を開いた人が書き込める場合（Initiative の作成者）に実績値を書き込む。それ以外の人には書き込めない旨を示す。

- **Today** — 自分の商談（と担当未定の商談）について、次にやるべきことを、期限切れ → 今日 → 今週 → 計画が必要の順に、同順位は加重金額の大きい順に並べる。チーム全体にも切り替えられる
- **Pipeline / Deals / Companies / Contacts** — ステージ別のボード（ドラッグで移動）、並べ替えられる一覧、会社と担当者の一覧と詳細（関係する商談と活動履歴）。サイドバーの検索・ステージ・リスト（自分の商談、リスクあり、まもなく成約、次のステップなし、連絡が途絶えがち、受注、失注、未入力あり）で絞り込む
- **Forecast** — 成約予定月ごとに受注・加重・コミット（確度70%以上）・ベストケースを通貨別に示す。期限を過ぎた進行中の商談は当月に数え、受注は受注した月に数える
- **健全度** — 進行中の商談を 100 点から減点し、理由と減点幅を示す（成約予定日超過、次回アクションの未設定・遅延、連絡の途絶、確度の低いまま迫る成約）。金額か成約予定日のない進行中の商談は「未入力あり」として予測から外す
- **Capture** — 打ち合わせメモ・メール・一行の記述から、対象の商談と会社・担当者・金額・確度・日付・ステージ・次のステップを読み取り、書き込む値をすべて一覧して確認後に反映する（ステージに伴う確度や新しい商談の既定値も一覧に出し、受注・失注への変更は既定で選ばない）。新しい会社名・担当者名は記録として作る。手元の規則による読み取りが即座に動き、AI の読み取りは同じ検証を通った項目だけを置き換える
- **AI** — 商談の要約とリスク・顧客への質問、フォローアップメールの下書き、Capture の読み取りを `alcon-copilot` の JSON モードに呼び出しユーザーの権限で依頼する。JSON モードはツールを渡さないので、貼り付けた顧客の文面に何が書かれていても盤面を読み書きしない。クライアントはモデルを呼ばない probe でこのモードの有無を確かめてから文面を送り、無ければ AI の操作を出さない。AI の出力は提案であり、適用・送信・記録は人が行う

以前の CRM が読んでいた Table は、パイプライン設定から一度だけ取り込める（Table は変更しない）。

ウィジェット `operations-planner` は、任意の Table の商談行を列対応で読み、通貨別の予測とフォローアップを試算する。Table ID・列 ID の対応・予測期間・連絡間隔はウィジェットの設定（`widgets.params`）に保存し、`me` / `domain` / `object` / `initiative` の `main` に配置できる。CRM App の記録とは別で、手元の表を分析する道具である。

リスクへの対応は、利用者が根拠を確認して **Element を作成**する。選択した Object または My Elements に起票し、説明に判断根拠・元 Table と行の ID・試算時点のデータと条件を残す。Sustainment は意思決定を支える情報と道具を供給し、行動は Execution、目的と成功条件は Strategy が持つ。

Object Detail 内の Workers / Resource / Calendar / Gantt タブは、同じ道具を Object 単位で提供するもの。稼働・勤怠・給与・採用・育成・予算・会計・契約・購買・設備などへの拡張候補は、[拡張構想](#拡張構想vision)を参照。

### Home — 分類を横断する個人向け画面

分類をまたいで、自分が行う仕事と返答が必要な事項を確認する画面。最初に開く画面の既定は Inbox とし、ユーザーが指定した初期ビューの設定は保持する。Profile はアバターから開き、サイドバーを出さずに全幅で表示する。ヘッダ（カバー・アバター・名前と Worker ID・自己紹介・プロフィール編集）の下に仕切り線を引き、その上に Now / My Elements / My Notes / AI のタブを置く。自己紹介は Settings > Profile で編集する。

| 機能 | 役割 |
|------|------|
| **Now** | 担当・状態・記録済みの依存・開始日等から、着手する仕事の候補と待機中の仕事を理由付きで示す。必要な更新をその場で行う |
| **Inbox** | 通知フィード。サイドバーに通知の一覧、メイン領域に開いた通知の本文（Element の詳細）を全幅で表示する |
| **Calendar** | 自分の Element の期日。サイドバーのミニ月で日を移動し、担当者ごとに表示を切り替える |
| **My Elements** | 自分が所有・アサインされた Element を横断表示 |

Nowの「前提が完了」は記録された依存の範囲の判断であり、現実の着手可能性や余力の保証ではない。見えない前提は不明として扱い、承認決定者を推測しない。更新がないことを停滞・怠慢と解釈しない。

### Widget と Board — 三分類を補完する掲示板

Board は、Strategy・Execution・Sustainment の画面に、その対象を補う情報を並べる掲示板。Object・Domain・Initiative・Element の Board は対象に1枚で、対象を見られる人が全員同じものを見て、並べ替え、足し、外せる。変更はほかの人の画面にもすぐ反映され、いま同じ Board を開いている人がアバターで表示される。Home の Board だけは個人のもので、Space ごとに持つ。

Widget は Board に置く部品で、Board とは別に存在する。種類と設定と**出自**（どの対象の Board で作られたか）を持ち、出自を見られる人が見られて、編集できる。Widget を別の Board に置いても見られる人は広がらず、見られない人には中身のない枠だけが表示される。その枠は zone の中で並べ替えられるが、別の zone へ移せるのも外せるのも Widget を見られる人だけである。

Widget は業務の正本を持たない。集計や一覧は Element・Initiative・Table を読んで映し、Widget が持つのは何をどう映すかの設定である。AI で作るミニアプリのように自分の中身を持つ Widget は、その中身も Widget を見られる全員で共有する。別々の項目を同時に変えても両方が残り、ほかの人の変更は開いたままのアプリに届く。作りかけのプレビューだけは本人にしか見えず、採用したときに全員のアプリが置き換わる。同梱のテンプレートはプレビューを経ずにそのまま使える。Object のデータを読むアプリは見る人の権限で読むので、採用された版は、見る人がそれぞれデータの接続を承認するまで読み取りを行わない。中身を持つ Widget をボードから外すと中身も全員から消えるので、外す前に確認する。判断は [ADR 0039](../docs/adr/0039-widgets-are-shared-components-with-an-origin-and-boards-are-placements.md)、[ADR 0040](../docs/adr/0040-widget-contents-are-shared-documents-merged-by-key.md)、[ADR 0041](../docs/adr/0041-board-presence-rides-a-private-channel-scoped-to-the-subject.md)。

### 案件の取り込みと日常の更新

既存の1案件を、CSV / TSV / 複数行テキストの貼り付け、または CSV ファイルから取り込む。列の対応と、読み取れなかった状態・日付・担当をプレビューで確認する。取り込みは1～100行をまとめて行い、一部だけが保存されることを防ぐ。Spaceを選び、可視の既存Objectか新しい案件名を指定する。Domainがない場合はGeneralを用意し、最初に概念の設定を要求しない。

取り込みは同期ではない。未対応の情報と元データを照合し、対象案件の運用の正本を当事者が選べるようにする。外部連携、全履歴の移行、未登録者へのtoken招待が必要な場合は、今回の入口だけでは導入を完了できない。

check-inは、必要なstatus変更、短い更新文、任意の次の一手を一回で保存し、同じElementに共有履歴を残す。毎回の全項目入力や日報を要求しない。並行編集では下書きを保持し、最新内容を確認してから再送する。画面から作成・削除した依存をNowも読み、前提の更新を次の人の表示へ反映する。Homeと詳細で同じ仕事を更新し、文章だけから依存や完了を推測しない。

### Property：Objectごとの業務フィールド

カスタムフィールドの定義は **Objectに帰属**し、そのObjectに含まれるElementの情報を保持する。作成の「＋」はObject内のElements一覧にだけ置く。My ElementsとDomain横断のElements一覧、およびObjects一覧にはカスタムフィールドの作成を置かず、基本情報を中心に表示する。

- **標準フィールド** — Status・Priority・Type・Assignee・Due date・Tags・所属Objectsなど。各ビューで表示／非表示・順序・幅を設定できる。名前は常に表示する。
- **カスタムフィールド** — テキスト・単一選択・複数選択・数値・日付・人物・チェックボックス・URL・メール・電話。Object内で名前・説明・選択肢・色・順序・数値の表示形式を設定する。
- **Tag** — Element自身の属性。同じElementをどのビューから見ても引き継ぐ。
- **値と表示の分離** — 非表示や幅の変更で値を消さない。選択肢の表示名を変えても保存済みの値を維持し、廃止した選択肢も過去のElement上では読める。数値の丸めは表示にのみ適用する。

顧客への提案・連絡や、調達・出荷などの行動は Element として運用し、その実行に必要な属性を Object のフィールドで表現する。商談と顧客は Sustainment の CRM が、Space か Domain に属する台帳で扱う。Strategy・Execution・Sustainment の役割を保ったまま、分析から行動につなげる。必要な属性だけを足し、設定と保守の負担も評価する。

データは `custom_columns`（定義）・`custom_column_placements`（配置）・`custom_column_values`（Elementの値）に分ける。保存済みのSpace・個人・Domainスコープのデータは保持するが、一覧の作成導線はObjectスコープに統一する。

### コードの置き場 — 盤面と仕組み

概念モデルに合わせ、`web/src/` では組織活動の画面を **ActivitySpace** に、画面を支える共通の仕組みを **Function** に置く。分類や概念ごとの画面は ActivitySpace 配下で管理する。

```
web/src/
├── ActivitySpace/        盤面そのもの — 三分類 ＋ Home
│   ├── home/             Now / Inbox / My Elements / My Calendar / Profile
│   ├── strategy/         initiative / phase / timeline
│   ├── execution/        domain / object / element
│   └── sustainment/      workload / notebook / table / team / calendar / crm / operations（CRM の計算）
├── Function/             盤面を成立させる仕組み。特定の概念に属さない
│   ├── widget/           WidgetFrame と widgets/ + registry.tsx + defaults.ts
│   ├── property/         Object ごとの列定義と値
│   ├── copilot/          Copilot パネルと Edge Function 呼び出し
│   ├── settings/
│   ├── space/            Activity Space の切替とオンボーディング
│   ├── sync/             差分ストリームと正規化キャッシュ
│   └── shared/           概念をまたぐ UI とロジック
├── shell/                外殻 — ModeRail / AppSidebar / CommandPalette
├── app/                  Next.js App Router
├── hooks/                Supabase の CRUD
├── lib/ providers/ auth/ types/ ui/ shared/
```

Execution が Domain → Object → Element の順に並ぶのは、上位ほど活動の範囲が広く、下位ほど行動が具体的になるため。Sustainment の各道具は ModeRail の Apps ランチャーに1対1で対応する。

## UI デザイン原則

### レイアウト哲学
- **常時可視ナビ + 折りたためる文脈ペイン + メインキャンバス** の 3 列構成。ブラウザのタブがあるので画面内にタブ列は置かない。サイドバーの表示切替と AI ペインの開閉は、アイランドの下の帯の右端に置く。サイドバー最上部の Space 行は固定ヘッダーで、メイン領域のヘッダーと同じ高さ・位置に揃え、その下だけがスクロールする。Settings は同じ画面で開き、その固定ヘッダーの「Back」で元の画面へ戻る
- **ModeRail**（46px）は分類セレクタ：固定の Inbox / Calendar / Strategy / Execution ＋ Apps ランチャーから追加した App ＋ 最下部のアバター（Profile）。Inbox のアイコンには未読数のバッジを出す。カタログは Tools（Notebook / Table / People）と Sustainment（Workload / CRM / SCM）の 2 グループで、すべて Sustainment の道具
- **AppSidebar** は分類内のナビ。最上部に Space 名（`SpaceSwitcher`）＋ Discover ＋「＋」。「＋」はモードごとに対象が変わる（Notebook＝ノートブック / Table＝テーブル / Strategy＝Vision・Portfolio・Initiative のメニュー / Calendar＝表示中の日を期日にした Element / Execution＝Domain・Object のメニュー）。どれも Object / Element と同じクイック作成カード（画面下の角丸カードに名前・説明・プロパティのピル・Create）で作る。作るものが無いモードでは出さない。見出し横に別の「＋」を置かない。本体は現在のモードに応じて切替（Inbox＝通知の一覧 / Calendar＝今日・ミニ月・表示する人 / Strategy＝Vision ごとの行の下に Portfolio・Initiative / Execution＝Domain ツリー / Notebook＝ノートブック一覧 / App 各種＝モード名ラベルのみ）。アバターから開く Profile ではサイドバーを出さない
- **Notebook** はサイドバーに Book（ノートブック）と配下の Section をツリーで並べ、メイン領域の左列は選んだ Section のページ一覧だけを示す。Book / Section の右クリックで New section / New page / Rename / Delete（削除は確認を経る）、ページは右クリックで Rename / Delete、一覧末尾の「New page」で追加する。新しい Book はサイドバー上部の「＋」
- view→モードの対応は `shell/railApps.ts` の `MODE_META.views` / `railModeOf`、view id→ラベル / アイコンは `shell/viewRegistry.ts` が単一情報源

Domain の概要は、その Domain の Objects と実行状況、Object を介して関連する Initiatives を示す。Initiative 側には現在 Space と招待された Guest の関連 Domains を示し、相互に移動できる。関係は両端が可視の Object 所属から導出し、multi-homing を含む。Domain 集計は所属 Object の Element を重複なく数える。Phase / Timeline のナビゲーション上の配置は、Phase の Domain スコープを変えない。

### ビジュアル原則
- 入力フィールドにボーダー/リングを付けない。背景色の差だけでフィールドを示す
- メイン領域を角丸の IslandCard で囲み、背景から区別する
- ミニマルで静かな UI。装飾よりも情報密度を優先
- CommandPalette (⌘K) で検索・移動できるようにし、マウス操作を減らす

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
- **CRM は標準の型＋変えられる範囲** — 記録の型と計算は全組織で同じ。パイプライン・ステージ・呼び方・独自項目・つながりだけを組織が決める。計算結果は記録から導出し、次のステップは Element として Execution に置く
- **active な Domain は localStorage 永続** — どの Domain を開いているかはクライアント側で切替
- **Notebook は 2 階層** — `notes`（Folder→File ツリー、Folder はルート）+ `note_contents.html`
- **Worker = human | ai_agent** — 同一テーブルで人的リソースと AI エージェントを管理。Space は `object_id`（Object の Space）→ `user_id`（メンバーシップ）→ `activity_space_id` の順に決まり、列はどちらも持たない Worker のためだけにある。アカウントに接続した Object の Worker も、その Object の Worker のまま

## 境界と権限（Boundary & Permissions）

組織の信頼境界は **ActivitySpace**。Strategy / Execution / Sustainment / Home / Property は、選択中の ActivitySpace を組織活動の文脈として使う（詳細は前述の [Activity Space — 組織活動の文脈と信頼境界](#activity-space--組織活動の文脈と信頼境界)）。組織データは Linear 型の二層メンバーシップでアクセスを管理し、個人の道具は所有者の権限で管理する。

- **二層の所属** — Space メンバー（`activity_space_members`：owner/member）＝組織の正規メンバー。Domain メンバー（`domain_members`：owner/admin/member）＝その Domain だけに招かれて承諾した人。Object メンバー（`object_members`）はさらに細かい Object 限定の同席者（通常 domain_members の部分集合、Object 限定ゲストも可）。
- **Guest** — `domain_members` だが Space 非メンバーの人。招かれた Domain しか見えず、組織の他 Domain 構造は一切露出しない。他組織の人を招いても相手の Space は混ざらない（Domain は `activity_space_id` で1つの Space に属したまま、相手には「Shared with me」として現れる）。Domain を作れるのは自分が参加している Space の中だけで、Domain を別の Space へ移せるのは移動元と移動先の両方の Space のオーナーだけ。Object は必ず Domain に置き、作れるのは自分が見られる Domain の中だけ。Object を Domain の外に出すことはできない（別の Domain へ移すだけ）。Object が残っている Domain は削除できない。
- **Domain 可視性 `domains.privacy`** — `workspace`＝同じ Space のメンバー全員が閲覧可。`private`＝`domain_members` のみ。
- **可視性カスケード** — Domain 可視 ⇔ domain_member、または（`workspace` かつ Space メンバー）。作った人であることは数えない（外された作った人には見えない）。Object 可視 ⇔ object_member、または所属 Domain が可視。Element 可視 ⇔ 所有者、または所属 Object が可視。
- **サーバーで強制** — 上記は SECURITY DEFINER ヘルパー（`user_can_see_domain` / `user_can_see_object` / `user_can_see_element`）として RLS に組み込む。クライアント表示任せにしない。横断取得 RPC `get_explorer_data` も同じ可視性で Object/Element を返し、アーカイブ済みの Object は id を指定したときだけ返す。
- **Worker は Space に属する** — Object の Worker はアカウントに接続していてもその Object で、人の Worker は Space・Domain・Object のメンバーシップで、どちらもない Worker（AI・アカウントのない人）は `workers.activity_space_id` で Space が決まる。割り当てられるのは Element と同じ Space の Worker で、人ならその人自身も Element を見られること（`worker_assignable` / `list_assignable_workers`。ピッカー・テンプレート・取り込み・ボードツール・エージェントの Worker 選択が通り、`element_assignees` と `agent_runs` の RLS も同じ判定で追加を拒む）。`workers` の RLS で見えるのは、自分、一覧できる Worker、見える Element の担当者、同じ Space に属する Lead・Person 値の Worker だけで、割り当ての範囲外でも過去の担当者の名前は残る。Worker の種類は変わらない。人の Worker はアカウントから外れず、プロフィールを変えられるのは本人だけで、その人の Space か Domain のオーナーが変えられるのは稼働時間と状態だけ。所属のない Worker はその Space のメンバー、Object の Worker はその Object を見られる人が変えられる。アカウントへの接続は human の Object Worker だけ。削除できるのは所属のない Worker だけで、Space のオーナーが行う。Element の通知（状態変更・コメント・メンション・期日・担当・承認）は、その Element を見られる人にだけ届く。ブラウザは通知を直接書かず、担当・状態・承認の通知は `notify_about_element` が呼び出した人の直前の操作を確かめてから、宛先と文面をサーバーで決める。承認の記録は Element を見られる人が本人として追加するだけで、変更・削除はできない。各 Space に AI Worker「Claude」を置き、メンバーになると自分の human Worker が DB で用意される。判断は [ADR 0028](../docs/adr/0028-workers-belong-to-a-space.md)。
- **Property は付く先に従う** — 値（`custom_column_values`）を読み書きできるのは、付いている Element / Object と列の定義を見られる人だけ。書くときは、列がその付き先のものであることも確かめる（Element なら所属 Object のローカル列、所属 Object か自分の My Elements に配置した Space の列、自分の個人列。Object なら所属 Domain の列）。定義（`custom_columns`）はスコープの中で見え、変えられる（Object・Domain の列はそれを見られる人、Space の列はメンバー、個人の列は本人）。Domain の列はその Domain に入った Object を見られる人も、Space の列は配置先の Object を見られる人も読める。列のスコープは作った後に変えられない。配置（`custom_column_placements`）では、Object を見られる人が、その Object 自身の列か、その Object の Space の列を置ける。Domain に入っていない Object（以前からある Object だけ）には、Space のメンバーがその Space の列を置ける。My Elements には、本人が自分の個人列か、自分が属する Space の列を置ける。Person 値が指せるのは、Element なら `worker_assignable` が通す Worker、Object ならその Space に属し一覧できる Worker だけ。
- **所属は承諾で成立する** — 所属の表は参加している人だけを表す。招く側は招待（`membership_invitations`）を送るだけで、招かれた本人が承諾したときに所属の行ができ、Worker が用意される。招待は `invite_member`（対象を管理する人：Space のオーナー、Domain のオーナー・admin、Object の Domain のオーナー・admin）・`respond_to_invite`（本人だけ）・`cancel_invite`（招いた人か管理する人）の RPC だけが書き、辞退から 7 日は同じ人を同じ対象に招けない。作った人の owner の行は作成時のトリガが書き、作った人を表す列は作成後に変えられない。ブラウザが書ける所属の行は、見えている Domain・Object に member として自分が加わる（Discover）行だけ。所属の行は人と対象を変えられず、Domain・Object も Space と同じく最後の owner を外せない（Object の Domain の owner・admin が外すときだけ、その人が owner を引き継ぐ。Domain の owner・admin は Object のメンバーを参加せずに見て外せる）。Object を別の Domain へ移せるのは、移動元と移動先の両方の Domain の owner・admin だけ。Object を別の Domain にも入れる（`object_domains`）のは、Object の主 Domain（Domain のない Object なら Object 自身）とその Domain の両方の owner・admin だけ。外すのはどちらか一方の owner・admin でよいが、その行が見えている必要がある。保留中の招待はピッカー・Worker・所属の判定に入らない。判断は [ADR 0029](../docs/adr/0029-membership-takes-effect-on-acceptance.md)。
- **招待 UI** — Space 招待は ActivitySpace 設定（owner のみ）、Domain 招待（Guest 化）は Domain の Team 設定、Object 招待は Object の Members タブ（その Domain の owner・admin）から。招かれた人は Inbox・Profile・（Space をまだ持たなければ）初回画面で Accept / Decline する。メンバー一覧は保留中の招待を「Invited」と示し、管理する人は取り消せる。
- **Widget と Board は対象に従う** — Board の在席（いま開いている人）は、対象を見られる人だけが入れる非公開の Realtime チャンネルで伝える。Board（`boards`・`board_placements`）を読み書きできるのは、その対象（Domain / Object / Element / Initiative、Home は本人）を見られる人。Widget（`widgets`）は出自を見られる人。置けるのも、別の zone へ移せるのも、外せるのも見られる Widget だけで、置いた先の Board を見られても Widget は見られるようにならない。Board の行はクライアントから削除できない。種類と出自は作成後に変えられず、対象が消えると Board と Widget も消える。Widget の中身（`widget_documents`）は Widget を見られる人が読み書きし、本人だけの状態（`widget_viewer_state`）は本人だけが読み書きする。
- **Table と CRM** — Table の RLS は `created_by = auth.uid()` による所有者限定。`domain_id` を付けても Space メンバー全員に共有されない。CRM の記録（`crm_*`）は、Domain に属するものはその Domain を見られる人（メンバー・ゲスト、公開範囲が workspace なら Space のメンバー）が、属さないものは Space のメンバーが読み書きする。商談はパイプラインに従い、関わる人の行は商談と担当者の両方を見られる人だけが扱う。商談に会社・担当者を設定できるのはそれを見られる人だけ（後から会社・担当者が Domain に移っても、商談を見られる人は商談を編集できる）。履歴は、つながる商談・会社・担当者のすべてを見られる人だけが読み書きし、商談に書く履歴は書く人に見えない会社・担当者をつながない。商談番号は見えない商談も含めて Space で通し番号になる。独自項目のキーは、Space 全体の項目と各 Domain の項目のあいだで重ならない（同じ Domain の記録に両方が表示されるため）。記録を Domain の外へ移せるのはその Domain の owner・admin だけで、CRM の記録が残っている Domain は削除できない（先に Space か別の Domain へ移す）。ゲストは RLS 上は招かれた Domain の記録を扱えるが、CRM App は所属する Space ごとに開くため、今はゲストが CRM App から扱う手段はない。CRM の記録どうしの参照は同じ Space の行だけを指す（複合外部キー）。Element・Worker・Initiative・成功条件・Object への参照は通常の外部キーで、読み取りはそれぞれの RLS に従う。同名の会社は別の記録として持てる（入力時は同じ名前の既存の会社を使う）。会社は、その相手が組織自身の一部（姉妹会社・社内の部署）であるとき、同じ Space の Domain を「自組織の Domain」として指せ、会社から Domain を開ける（Domain はその Space にあり、設定する人に見えるものに限る）。会社・担当者を消しても商談の履歴は残り、その記録だけの履歴が消える。画面が読む履歴は新しい 3000 件まで。活動履歴は追記と本人による削除だけ。商談のステージ・金額・確度・成約予定日の変更は DB が「旧 → 新」と変更した人の名前で履歴に書き、誰も書き足せず消せない（ステージと同時に動いた確度は重ねて書かない）。この行は商談の履歴で、商談を見られる全員が見られる会社だけをつなぐ。

## AI 連携

Claude API を Supabase Edge Functions 経由で利用：
- `alcon-copilot`：汎用 AI アシスタント
- `run-agent`：エージェント実行
- `draft-object`：Object 自動生成
- `summarize-note`：Note 要約
- `analyze-change`：変更分析
- `validate-task`：Element 検証

外部の AI は `alcon-mcp`（MCP サーバー）から、スクリプトやノーコードツールは `alcon-api`（REST API）から、本人として盤面を読み書きする。どちらも同じ許可リストのツールを呼ぶので、外から削除や一括変更はできない（[ADR 0033](../docs/adr/0033-the-rest-api-is-the-mcp-tool-layer-over-http.md)）。資格情報は、claude.ai や ChatGPT のコネクタなら OAuth のサインインと同意（`/oauth/consent`）、スクリプトなら本人が Settings › Integrations で発行する個人用アクセストークン。どちらも読み取りのみを選べ、いつでも取り消せる。OAuth のトークンで盤面に届くのは Alcon の関数を通したときだけ（[ADR 0034](../docs/adr/0034-mcp-clients-sign-in-through-supabase-oauth-and-their-tokens-only-work-through-alcon.md)）。関数がそれを本人の短命な JWT に交換するので、アプリと同じ RLS が効き、書き込みの記録にはどのトークン経由かが残る（[ADR 0032](../docs/adr/0032-external-callers-authenticate-with-a-pat-or-oauth-and-get-a-short-lived-user-jwt.md)）。

逆向きに、Alcon のエージェントは Space の owner がつないだ外部サービス（Linear・Asana・任意の MCP / API）を道具として使い、外部への書き込みは既定で毎回承認を待つ（[ADR 0027](../docs/adr/0027-agents-act-on-elements-with-the-callers-rls-and-stop-for-approval.md)）。Google Drive は owner が Google にサインインしてつなぎ（`integration-oauth`）、スコープは `drive.file` だけなので、エージェントが扱えるのは Alcon が作ったファイルと利用者が選んだファイルに限られる。サインインは、アプリに戻ってからサインインを始めた本人が確定したときだけ保存される。トークンは Vault にだけ置き、ブラウザには出さない。アクセスは Google アカウントに付くので、同じアカウントを複数の Space でつなぐと、どの Space のエージェントも他方で Alcon が作ったファイルを見られ、一方で切断すると他方も再接続が必要になる（[ADR 0035](../docs/adr/0035-oauth-integrations-sign-in-through-an-edge-function-and-keep-tokens-in-vault.md)）。

## 拡張構想

拡張は、実顧客の反復業務で現在の道具では解けない負担が確認でき、導入と日常操作を複雑にする費用を上回る場合に選ぶ。Sustainmentでは、Workload・CRM・SCMを起点に、Object単位の道具を横断して使うことや、予算・会計・契約・購買・勤怠・設備まで扱うことが候補になる。概念上分類できることだけを開発理由にしない。

### 業務単位の展開

同じ基盤の上で、台帳・入力・実行条件・権限・評価を束ねた業務設定を提供する。独立して繰り返し行う業務と、その購入者が確認でき、設定で吸収できない提供サイクルや信頼境界がある場合は、独立アプリとしての提供を選ぶ。

| モジュール | 領域 | 状態 |
|-----------|------|------|
| **Alcon SEM** | Strategy & Execution Management | 現在開発中 |
| **Kanjo-kei** | 会計・仕訳管理 | 構想段階 |
| **HR** | 人事・勤怠・評価 | 構想段階 |
| **Sales** | 営業活動支援 | Alcon 内の CRM App はチームで共有する会社・担当者・商談の記録、Capture、次の一手（Element）、パイプライン・予測、Initiative への成果報告、AI 支援を提供。独立アプリとしての展開は構想段階 |

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
