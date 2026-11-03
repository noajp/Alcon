# Alcon：PMBOK の体系と既存機能の照合

この資料は、Alcon を PMBOK の用語で説明できるかを確かめるための対応表です。PMBOK を Alcon の骨格にするのではなく、**Alcon の概念で運用した結果として PMBOK の成果物と領域が表現できている状態**を目指します。不足している箇所は「読み替え（レンズ）で足りるもの」と「データそのものが足りないもの」に分けます。

調査日は 2026-10-02 です。PMBOK の内容は PMI の公開情報（第7版の FAQ と第8版の刊行告知）と、二次情報（研修会社や解説記事）によるもので、第8版の原本とは照合していません。Alcon 側の情報はリポジトリ（`web/src`、`supabase/migrations`、`web/src/types/database.ts`）を根拠にしています。

## 判断に使える結論

1. **第8版（2025）を主な対照軸にする。** 第8版は、第7版の原理・原則とパフォーマンス領域を保ったまま、40 のプロセスを領域に組み込んで一冊に戻した版です。第6版の「成果物の具体性」と、第7版の「成果と価値への重心」を両方持っており、Alcon との照合にいちばん向いています。
2. **Alcon の骨格は PMBOK の価値実現システムとほぼ重なる。** 第7版・第8版の The Standard は、価値の流れを「戦略 → ポートフォリオ → プログラム／プロジェクト → プロダクト／オペレーション」とし、オペレーションから戦略へ情報が戻るものとして描いています。Alcon の Vision → Initiative（入れ子）→ Domain → Object → Element は、この流れを実装した形です。ポートフォリオは、ほかの Initiative を束ねる親の Initiative として表します。第8版はガバナンス領域に、立ち上げ・計画の統合・変更判断をまとめました。これは「Initiative は意図を持ち、担当や進捗は持たない」という Alcon の分け方と同じ向きです。
3. **強いのは Governance・Resources・Schedule、弱いのは Finance・Stakeholders。Risk はその中間。** 前提（assumption）、意思決定、諦めたもの、成功条件（measure）、実現構想（approach）の仮説と見直しは、一般的な PM ツールよりも深く表現できます。一方で、ベースライン、コスト、外部ステークホルダー、リスクの発生確率と影響度は、表現するためのデータがありません。
4. **不足の大半はレンズで足りる。新たなデータが要るのは 4 つだけ。** その 4 つは、ベースラインのスナップショット、費用（予算と実績）、ステークホルダー（Worker ではない利害関係者）、リスク（脅威と機会、確率と影響）です。課題ログ、変更ログ、教訓登録簿、RACI、状況報告は、既存データの読み替えとして作れます。
5. **すでにスキーマがあるのに UI のない資産がガバナンス領域に効く。** `intent_escalations`、`intent_audits`、`intent_predictions`、`intent_resources`、`intent_alignments`、`intent_next_actions` は、第8版の Governance（変更の評価と実施、パフォーマンスの監視）と Risk に直結します。新しく作る前に、まずこれらを表に出すかどうかを判断します。

## 1. PMBOK の体系と変化（第6版 → 第7版 → 第8版）

| 観点 | 第6版（2017） | 第7版（2021） | 第8版（2025-11） |
|---|---|---|---|
| 基本の形 | プロセス型（何をどの順でやるか） | 原理・原則型（何を目指し、どう確かめるか） | 両方を一冊に統合 |
| 原理・原則 | なし | 12 | 6 |
| 分類の軸 | 知識エリア 10 | パフォーマンス領域 8（手順なし） | パフォーマンス領域 7（手順あり） |
| 工程の軸 | プロセス群 5 | モデルの一つに格下げ | フォーカスエリア 5（プロセス群と同じ 5 つ） |
| プロセス | 49（ITTO を規範として定義） | 本体にはなし（2022 年の別冊『Process Groups』に 49） | 40（ITTO は例示） |
| 成果物 | プロジェクト文書 33 種、PM 計画書、ベースライン 3 種 | 「モデル・方法・成果物」の章で 9 分類 | 入力・出力の解説集、ツール・技法の解説集（100 以上） |
| 新しい主題 | アジャイル（Agile Practice Guide を同時刊行） | 価値実現システム、テーラリング | AI（付録 X3）、サステナビリティ（原理・原則）、PMO（付録 X2）、調達（付録 X4） |

### 第6版：5 プロセス群 × 10 知識エリア

- プロセス群は、立ち上げ、計画、実行、監視・コントロール、終結の 5 つです。
- 知識エリアは、統合、スコープ、スケジュール、コスト、品質、資源、コミュニケーション、リスク、調達、ステークホルダーの 10 です。
- 主な成果物：プロジェクト憲章、PM 計画書（補助計画 10 本＋スコープ・スケジュール・コストの 3 ベースライン）、WBS と WBS 辞書、前提条件ログ、課題ログ、変更ログ、教訓登録簿、リスク登録簿、ステークホルダー登録簿、要求事項トレーサビリティ・マトリックス、マイルストーン・リスト、チーム憲章。

### 第7版：12 の原理・原則と 8 つのパフォーマンス領域

- **原理・原則**：スチュワードシップ、チーム、ステークホルダー、価値、システム思考、リーダーシップ、テーラリング、品質、複雑さ、リスク、適応力と回復力、変革。
- **パフォーマンス領域**：ステークホルダー、チーム、開発アプローチとライフサイクル、計画、プロジェクト作業、デリバリー、測定、不確かさ。各領域は手順ではなく、望ましい成果と、その成果を確かめる方法で定義されています。
- **プロセス型をやめた理由**（PMI の FAQ）：予測型・適応型・ハイブリッドのどれを選ぶかが実務者の判断になり、重心が成果物（deliverables）から成果（outcomes）へ移ったためです。ANSI の認定要件が理由ではありません。規格そのものを書き換え、それを ANSI が認定しています。
- **成果物の 9 分類**：戦略、ログと登録簿、計画、階層図、ベースライン、視覚データ、報告書、合意書と契約、その他。

### 第8版：6 の原理・原則、7 つのパフォーマンス領域、40 のプロセス

- **原理・原則**：全体を見渡す、価値に焦点を当てる、プロセスと成果物に品質を組み込む、説明責任を果たすリーダーであれ、サステナビリティを組み込む、自律を促す文化を築く。正式な表記は資料によって揺れがあり、和訳は仮訳です。
- **パフォーマンス領域とプロセス数**

| 領域 | プロセス数 | 主なプロセス |
|---|---|---|
| ガバナンス | 9 | Initiate Project or Phase、Integrate and Align Project Plans、Plan Sourcing Strategy、Manage Project Execution、Manage Quality Assurance、Manage Project Knowledge、Monitor and Control Project Performance、Assess and Implement Changes、Close Project or Phase |
| スコープ | 6 | Elicit and Analyze Requirements、Define Scope、Develop Scope Structure（旧 Create WBS）、Validate Scope |
| スケジュール | 3 | Plan、Develop、Monitor and Control（旧版の 4 プロセスを Develop Schedule に統合） |
| 財務 | 4 | Plan Financial Management、Estimate Costs、Develop Budget、Monitor and Control Finances（EVM はここ） |
| ステークホルダー | 7 | 特定、エンゲージメントの計画・管理・監視、コミュニケーションの計画・管理・監視 |
| 資源 | 5 | Plan、Estimate、Acquire、Lead the Team（旧 Develop と Manage Team を統合）、Monitor and Control |
| リスク | 6 | Plan、Identify、Perform Risk Analysis（定性と定量を統合）、Plan Responses、Implement Responses、Monitor |

- **フォーカスエリア別のプロセス数**：立ち上げ 2、計画 19、実行 8、監視・コントロール 10、終結 1。
- **第7版の領域の行き先**
  - 開発アプローチとライフサイクル → The Standard 第 4 章
  - 計画と測定 → 各領域の計画系・監視系プロセスに分散
  - プロジェクト作業 → ガバナンス
  - デリバリー → スコープ
  - チーム → 資源
  - 不確かさ → リスク
- **第8版で強まった考え方**：「すべてのプロジェクトは投資である」として価値の側面を強めました。AI の活用（見積り、リスク分析、意思決定）も付録で扱っています。

### 確認できていない点

次の点は第8版の原本（PMI 会員は無料）か PMIstandards+ で確かめる必要があります。

- ANSI の規格番号（ANSI/PMI 99-001-2025 は二次情報のみ）
- 原理・原則の正式な表記
- 40 プロセスのフォーカスエリアへの割り当て
- 「モデル・方法・成果物」の章が残っているか
- 公式日本語訳の有無と訳語

## 2. 価値実現システムと Alcon の階層

| PMI の価値実現システム | Alcon | 備考 |
|---|---|---|
| 組織戦略 | Vision | Space に 1 文 |
| ポートフォリオ | 親の Initiative | 子の Initiative を束ねる（入れ子） |
| プログラム／プロジェクト（意図の側） | Initiative（`strategies` ＋ `intents`） | 目的、前提、決定、成功条件。担当や進捗は持たない |
| プロジェクト（実行の側） | Domain → Object | Domain が活動の場、Object が成果物 |
| 作業パッケージ／アクティビティ | Element | 行動の最小単位 |
| フェーズ | Phase | Domain ごと。`end_date` 当日を含む |
| オペレーション | Sustainment（CRM / SCM / Workload / Calendar） | 継続業務の道具 |
| オペレーション → 戦略への情報の戻り | measure の実績、approach の検証、Situation 表示 | 成果の自動観測は未提供（PRODUCT.md） |

PMBOK の「プロジェクト」は、Alcon の Initiative（意図）と Object の束（実行）の二つにまたがります。PMBOK のプロジェクト憲章は、この二つを一枚に書く文書です。**Alcon で「プロジェクト」を一つの画面に出すなら、Initiative と、それに紐づく Object の集合を合成したビューになります。** これが第一のレンズの候補です。

## 3. パフォーマンス領域（第8版）× 既存機能

凡例：◎＝十分に表現できる、○＝読み替えれば表現できる、△＝一部だけ、×＝データがない

| 領域 | 評価 | Alcon で表現できているもの | 足りないもの |
|---|---|---|---|
| ガバナンス | ◎ | Initiative の意図、decision（判断者、日時、諦めたもの、見直し日、`superseded_by`）、`intent_lineage`（判断の改訂履歴）、`domain_approaches`（仮説、前提、見直し条件、改訂、`approach_reviews` での継続・変更・中止）、Element の承認と承認履歴、Space・Domain・Object の境界 RLS、AI の権限（run-agent は review で止まる、MCP は許可リスト方式）、Phase の締め | 変更要求（CR）を起票・審査・承認するワークフロー、PM 計画書を一枚にまとめたビュー。品質保証の計画 |
| スコープ | ○ | Object（成果物）→ Element（作業）の階層、Element の受け入れ条件（`direction.acceptance`）、review ステータス、`element_templates`、Note からの Object 案生成（draft-object） | 要求事項とそのトレーサビリティ（要求 → Element → 検証）、WBS 辞書としての一覧、スコープのベースライン |
| スケジュール | ○ | 開始日と期日、`element_edges`（depends_on など）、`object_milestones`、Gantt、Timeline、Phase、PhaseBurnup、Decision Lab による完了日の試算、持ち越し回数 | ベースライン（計画値のスナップショット）、クリティカルパス、計画と実績の差異 |
| 財務 | △ | `estimated_hours` / `actual_hours`、Key numbers の予算超過表示（工数ベース）、Property の `budget` 型、SCM の費用試算、CRM の確度加重予測 | 費用の予算と実績の台帳、単価、EVM（PV / EV / AC、CPI / SPI）、S 曲線 |
| ステークホルダー | △ | メンバー、Guest、Worker、コメント、通知、check-in、Brief（会議要約） | ステークホルダー登録簿（関心、影響力、現在と望ましい関与度）、コミュニケーション計画、定期の状況報告 |
| 資源 | ◎ | Worker（human / ai_agent / robot）、稼働時間/日、不在（`worker_availability`）、Workload、Resource ビュー、属人化の検出、Team、Risk & Load ウィジェット、effort-flow | 資源の取得（調達）、スキル台帳、RBS |
| リスク | △ | 期限超過・停滞・ブロック・期限間近の自動検出（`initiativeRiskModel.ts`）、Domain ごとの閾値、assumption の状態（on_track / at_risk / off_track）、approach の検証（refuted など）、Decision Lab | リスク登録簿（脅威と機会、発生確率、影響度、対応策、オーナー、トリガー）、リスク対応の実施記録 |

### 原理・原則（第8版）との相性

| 原理・原則 | Alcon での表れ |
|---|---|
| 全体を見渡す | Strategy と Execution の相互参照。Initiative に配下の Object とリスクを、Object に貢献先の Initiative を常に表示する |
| 価値に焦点を当てる | measure（成功条件）と approach（期待する変化と仮説）。成果物ではなく成果で確かめる |
| 品質を組み込む | 受け入れ条件、review ステータス、承認、approach の検証 |
| 説明責任を果たすリーダー | decision に判断者と日時、諦めたものを残す。判断は Decisions に起票して人間にアサインする |
| サステナビリティ | 該当なし。業界固有の論点で、Property か Table で扱う範囲 |
| 自律を促す文化 | 「意図で委ね、成果と根拠で確かめる」。AI Worker を含め、権限内で手段を選ばせる |

## 4. 主要な成果物（第6版・第7版）× 既存機能

分類の意味：**A** 既存のまま対応する、**B** データはあり、レンズ（読み替えビュー）で足りる、**C** データそのものが足りない

| 成果物 | 分類 | Alcon での対応・作り方 |
|---|---|---|
| プロジェクト憲章 / Project brief | B | Initiative（目的＝master intent と description、前提＝assumption、成功基準＝measure、決定＝decision）と、紐づく Object・Domain・Phase を合成する。「制約」と「権限」は専用の列がないため、intents の新しい種別を作るか、テキストで書く |
| ビジネスケース | B / C | Initiative の意図で一部書ける。費用対効果は財務データがないため書けない |
| ロードマップ / マイルストーン・スケジュール | A | Timeline、`object_milestones`、Phase |
| WBS / WBS 辞書 | A / B | Object → Element → Subelement。辞書は受け入れ条件・見積・担当を並べる一覧ビュー |
| プロジェクト・スケジュール / ガントチャート | A | Gantt、Mini Gantt、Calendar |
| スケジュール / コストのベースライン | C | 計画値のスナップショットがない（PhaseBurnup にも「履歴スナップショットなし」と明記） |
| 予算 / コスト見積 | C | 工数しかない。`budget` Property は Object 単位の値にとどまる |
| 前提条件ログ | A | intents の assumption。状態と見直し日を持ち、外部の前提条件ログより強い |
| 意思決定ログ | A | intents の decision と `intent_lineage`。PMBOK には独立した成果物はないが、Alcon の強み |
| 課題ログ | B | status が blocked の Element、または Type が Issue の Element を一覧にする |
| 変更ログ | B | `intent_lineage` の revision、`approach_reviews`、`element_activity` を時系列で束ねる |
| 変更要求 / 変更管理計画 | B | Decisions Object に Element として起票し、承認（`is_approval`）で判断する。審査の型はテンプレートで作れる |
| リスク登録簿 | C（一部 B） | 自動検出したリスクと、揺らいでいる assumption は B。確率・影響・対応策・オーナーを持つ「識別したリスク」は保存先がない |
| リスク報告書 | B | Risk & Load と Situation から生成できる |
| ステークホルダー登録簿 | C | Worker は作業者で、利害関係者ではない。CRM の取引先とも別物 |
| RACI | B | `element_assignees.role`（assignee / reviewer / collaborator）、Object の lead、承認者から作れる。C（Consulted）と I（Informed）は通知とコメントの対象から推定する |
| 教訓登録簿 | B | Phase の `closing_note`、`approach_assessments`、`approach_reviews` の「変更」「中止」の判断理由を束ねる |
| 状況報告 / ステアリングコミッティ資料 | B | Situation、measure、Risk & Load、check-in から AI が生成する。Excel とパワポを置き換える要になる |
| 品質報告書 | B | review と承認の結果、受け入れ条件の充足状況から作れる |
| チーム憲章 | B | Note（Notebook）に書いて、Domain や Initiative に紐づける |
| 要求事項文書 / トレーサビリティ・マトリックス | C | 要求そのものの単位がない。Element の受け入れ条件では粒度が足りない |
| 調達計画 / 契約 | C | SCM の試算はあるが、発注・契約の台帳はない（第8版でも調達は付録扱い） |
| バーンチャート / ダッシュボード / インフォメーション・ラジエーター | A | PhaseBurnup、Key numbers、ウィジェット盤面 |
| イテレーション計画 / リリース計画 | A | Phase |

### 第8版の 40 プロセスで、運用ループとして既にあるもの

- **Initiate Project or Phase**：Initiative の作成と Phase の開始。
- **Manage Project Execution**：Element の実行、check-in、run-agent。
- **Manage Project Knowledge**：Notebook、Brief。
- **Monitor and Control Project Performance**：Situation、Risk & Load、Now のアテンション区分。
- **Assess and Implement Changes**：decision の改訂、approach の見直し。
- **Close Project or Phase**：Phase の締め（持ち越し、締めのメモ）。
- **Lead the Team**：委任と承認、Workload。

## 5. 判断が要る点

1. **レンズの最初の一本を何にするか。** 候補は、(a) プロジェクト憲章ビュー（Initiative と配下の Object の合成）と、(b) AI が生成する状況報告です。(b) のほうが「Excel とパワポを置き換える」という訴求に直結しますが、元になる状態が古いと価値が出ません。これは 2026-09 の競合調査の結論とも一致します。
2. **データが足りない 4 つのうち、どれを作るか。** リスクとステークホルダーは、PMO の現場で必ず求められる台帳です。intents の新しい種別（`risk`）として持つ案と、独立したテーブルにする案があります。ベースラインと費用は EVM まで含めると大きな仕事になります。
3. **スキーマだけある intent 系テーブルを表に出すか、捨てるか。** エスカレーションと監査は、ガバナンス領域の説明材料として強い一方、使われないまま残っています。
4. **用語の扱い。** PMBOK の用語（憲章、課題ログ、RACI など）をレンズの見出しとして出し、Alcon の概念名は変えない。CLAUDE.md の「フレームワークは永続データの見せ方にする」に従います。
