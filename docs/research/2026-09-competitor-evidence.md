# Alcon：Linear / Asana の一次苦情から導入・日常操作を再考する

この資料は当事者の具体例を保持する証拠集。[製品判断・実装範囲・検証基準](2026-09-coordination-core.md)と、[組織活動の証拠](2026-09-organization-evidence.md)を併せて参照する。

調査日：2026-09-07。目的は、競合の機能一覧から新機能を選ぶことではなく、仕事が実際に失敗する境界を把握すること。公開投稿の観察と現行公式ドキュメントの照合であり、顧客面談・利用ログ分析・購入意向の検証はまだ行っていない。以下の仮説・検証基準は調査者の提案で、観測結果ではない。

## 判断に使える結論

最も中核に近い問題は、仕事そのものと共有盤面の維持が別の仕事になっていること。その背景には、仕事の粒度と所属を決める負担、担当者が更新する直接的な利点の弱さ、階層や繰り返しによる状態の不整合がある。高機能な集計・計画を加えても、基礎となる状態が信頼されなければ利用価値は成立しない。A1～A4 の具体例がこの推論を支える。

Alcon の当面の統合案「既存の1案件を持ち込む → 自分が今動ける仕事と待ち先が分かる → 同じ場所で実行状況を更新 → 同僚がその情報で動ける」は支持できる。これは独自機能の発明を立証したものではなく、導入と継続利用の仮説である。Linear / Asana には、個人ビュー、取り込み、Slack連携、ルール、AI更新が既にある。差は機能名ではなく、対象顧客の仕事を完了するまでに必要な操作・判断・再入力をどこまで減らせるかで検証すべきである。

一方、「全員に合意ライフサイクルを追加」「AIが大量の細かい仕事を生成」「状況が古いまま高度な予測を表示」は、今回観測した負担を増やす可能性がある。公開苦情だけから全社一括乗換やPMFを断言する根拠は得られていない。

## 読み方と証拠の限界

- 一次苦情：投稿者が自分の利用状況・失敗・回避策を述べた箇所。Reddit の本人・所属・規模は独立確認していない。
- 現行確認：2026-09-07に取得した公式仕様、または日付のある公式リリース。検索で見つからないことは「未実装」の証明にしない。ヘルプと新リリースが食い違う場合は新しい具体的告知を優先し、範囲を限定する。
- 「残存」は少なくとも引用した直近投稿と確認できた公式仕様の範囲で残るという意味。実際の有料テナントで全設定を再現した意味ではない。
- フォーラムは困っている利用者・高度な設定担当者に偏る。投稿数・賛成票から全利用者の頻度や市場規模は推定できない。
- Asana公式フォーラムのスタッフ・アンバサダー・コンサルタントにはベンダー側の利害がある。機能説明や回避策は参考にするが、推薦や販売誘導を需要証拠に数えない。Redditの同文クロスポストも独立の声と数えない。
- 投稿時期は検索結果が提示した絶対日付と、本文の明示日付を使用。本文に相対日付しかない返信は無理に年月日を算出していない。
- 性能・価格については個別の環境依存が大きい。両製品の比較ベンチマークも見積もり比較も行っていない。

## Linear：主要な一次例

### L1：型付きの業務データが移行先で表現できない

**分類：モデル / 機能 / 切替。状態：残存する設計上の選択。**

- 日付・話者：2026-05-24、Nice-Jaguar-5649。JiraからLinearへ移るPOC中。
- 失敗：追加の日付、boolean、選択値などを持たせようとして、Labelsしか見つからない。
- 回避策と追加の声：同スレッドの Charming-Lie-855 は、自動化に使う複数日付・ID等を説明文へ押し込むと、エージェントが変更・消失させると報告。返信の絶対日付は未確認。
- 切替契機：Jiraからの乗換評価中の障害。乗換中止・購入額は未確認。

[一次投稿](https://www.reddit.com/r/Linear/comments/1tm85kg/add_customized_fields_into_linear/)

公式Jira移行ガイドは、custom fieldsをLabels / Label groupsに置き換えるよう案内している。Customer Requestsは顧客要望を表す専用構造なので任意の型付きデータと同義ではない。したがって不満を設定の見落としだけでは片づけられない。[公式Jira移行](https://linear.app/switch/jira-guide)、[公式Customer Requests](https://linear.app/docs/customer-requests)

ただし「自由なcustom fieldsがあれば全社が喜ぶ」も誤り。同じ投稿に柔軟性を増やしたくない声がある。Linear公式Oscar事例では、複雑なJira設定を捨てて600人超が移行したとされる。これはベンダー選定事例であるものの、設定の多さを便益とみなす仮説への反証になる。[公式Oscar事例](https://linear.app/customers/oscar)

### L2：小規模の外部受付に、別のヘルプデスクが必要になる

**分類：コスト / 機能境界 / 入力。状態：一部残存。**

- 日付・話者：2026-05-05、_moertel。個人のモバイルアプリ開発者。週20～40件の問い合わせの約半分がissueになるか既存issueへ紐づく。
- 失敗：Frontの受付のためだけに別製品を契約したくない。BusinessのAsksではWebフォームが使えず、プログラムからemail Askを作る入口が足りない。
- 回避策：Makeのwebhookをemailへ変換したが、Reply-Toの利用者ではなく自分がrequesterになる。既に直接emailのAsksは活用し、公開後の通知もLinear Agentで十分と本人が補足。
- 切替契機：Linearを捨てる話ではなく、Front等の追加費用を避けたい。

[一次投稿](https://www.reddit.com/r/Linear/comments/1t4j6zi/a_bit_disappointed_by_asks_restrictions_looking/)

現行公式でもWeb AsksはEnterpriseの社内向けSAML認証、email AsksはBusiness / Enterprise。emailでの会話・完了通知は既にある。「外部との往復ができない」は誤り。公式は本格的な顧客サポートのSLA/NPS等を用途に含めないと明記している。残るのは小規模B2C受付の入口・価格・requester保持の適合であり、汎用PMの中核需要と同一視しない。[公式Web Asks](https://linear.app/docs/linear-asks-web-forms)、[公式email Asks](https://linear.app/docs/linear-asks-email)

### L3：NotionのProjectsがCSV移行で再構成されない

**分類：切替 / 入力。状態：CLI経由では残存。**

- 日付・話者：2026-03-19、Previous-Display-593。Notion databaseからCLI importerと独自処理で移行。
- 失敗：LinearからCSVを書き出して調べても、issueのproject参照はあるが、projectそのものを作成するCSV表現が分からない。
- 回避策：LinearTeamの返信はCLIがprojectsを取り込まないと説明。projectsをlabelsとして一旦保持し、projectsを手作成またはMCPで作ってから紐づける方法を提示。
- 切替契機：実際に移行作業を始めた段階。移行完了は未確認。外部製品へDM誘導する返信は証拠から除外。

[一次投稿](https://www.reddit.com/r/Linear/comments/1rxqa6s/how_do_i_import_projects/)

現行CLIも限定されたissue項目が中心。ただしJira / GitHub / Asana等には専用のimport assistantがあるため、「Linearは移行できない」は誤り。Alconには、取り込み経路ごとの保持範囲を示すプレビューと、未解釈項目を黙って失わない設計が必要になる。[公式CLI](https://linear.app/docs/cli-importer)、[公式import](https://linear.app/docs/import-issues)

### L4：Project乱立で、仕事を追加するたびに所属を考える

**分類：モデル / 入力 / 定着。状態：設定で一部軽減、粒度の問題は残る。**

- 日付・話者：2026-03-13、antshill。PRDとProjectsを1対1にしたい既存利用チーム。
- 失敗：Projectが増え、issue作成時の大きな選択リストが使いづらい。命名規則だけでは改善しない。
- 回避策：auto-archiveが6か月設定だったので短縮する案を受け入れた。本人は作りすぎも認め、大きい成果単位へ寄せ、所属を即決できない仕事をtriageへ入れることを検討。
- 切替契機：乗換発言はなく、継続利用を整理したい。別製品を宣伝する返信は除外。

[一次投稿](https://www.reddit.com/r/Linear/comments/1rsdjvb/simplify_cleanup_project_list/)

現行公式はproject pickerの並び順を説明し、継続仕事には期限なしProjectや期間で分割する方法を案内する。「一覧を小さくする機能が一切ない」という不満ではない。AlconでもDomain / Object / Initiativeを導入前に理解させたり、作成先を毎回選ばせたりすると再現し得る。[公式Projects](https://linear.app/docs/projects)

### L5：Releaseが表現できずJiraを残す — この欠落は解消済み

**分類：モデル / 機能 / 切替。状態：中核の欠落は2026-04-30に解消。**

- 日付・話者：2024-08-19、freiwaldDev。複数ProjectのissuesをReleaseとして束ねたい。
- 失敗と回避策：ProjectをReleaseにするとissueの所属と衝突。別の利用者はReleaseという親issueに子issueを入れ、親子関係が崩れると報告。
- 切替契機：スレッドではdelivery担当者やtravisjoが、Releaseの版・内容を追うためJiraを残すと述べた。後続返信の正確な日付は未確認。

[一次投稿](https://www.reddit.com/r/Linear/comments/1ewajm0/how_to_manage_release_versions/)

現在はReleasesがCI/CD、環境・版・issueのデプロイ状態、Release notesを扱う。したがって「Release管理のないLinearを代替する」は今日の差別化根拠にできない。任意の変更管理項目や価格適合まで全て解消したとまでは確認していない。[2026-04-30公式Releases](https://linear.app/changelog/2026-04-30-releases)

### L6：完了するProjectと、継続する製品の履歴の衝突（補助観察）

**分類：モデル / 入力。状態：公式モデル上の制約は確認、一次投稿の再取得は不安定。**

2026-07-28のEnterpriseプロダクト管理者の投稿は、主要scopeは済んだがnice-to-haveが残るため90～95%に見えること、公開後のバグ・改善を元Projectへ置くか別Projectへ置くか迷うことを述べている。再取得でタイムアウトしたため、投稿者handleを確定できず、主要5例とは分けた。[一次投稿](https://www.reddit.com/r/Linear/comments/1v99tsj/question_about_projects_and_linking_issues/)

公式にはProjectは明確な成果や終期を持つ単位で、issueは同時に1Projectのみ。恒久的な製品履歴と一回の成果範囲を両方保持したい場合の制約は残る。ただしLabels、Views、期限なしProjectという代替表現がある。[公式Projects](https://linear.app/docs/projects)

## Asana：主要な一次例

### A1：AIの細分化で、盤面の仕事が本来の仕事を圧迫する

**分類：モデル / 入力 / 定着。状態：運用と製品の共同課題。**

- 日付・話者：2026-02-10、pixiepalooza。チーム全体のproject managementを担当。
- 失敗：部署ごとに小仕事をProject化して乱立。AI生成計画で1枚のパンフ編集に60件超を作り、それぞれの期限をデザイナーへ要求。命名も曖昧で、探しづらさから利用をやめた人がいる。
- 回避策：全体研修と粒度・命名の統一を探している。別の経験者は部門横断ワークグループで規約作りと既存盤面の清掃をしたと述べる。
- 切替契機：実際の利用離脱あり。ただし別製品への乗換実施は未確認。

[一次投稿](https://www.reddit.com/r/Asana/comments/1r1799c/our_org_asana_is_out_of_hand_looking_for_good/)

Asanaスタッフの回答はProject / section / taskの理解とチーム規約・研修を勧める。公式も、作成する単位の判断と規約を説明している。この種の失敗を新しいAI生成だけで解決したと主張できない。Alconの導入でも分類・細分化を強制せず、実際に回る粒度を維持することが重要という推論になる。[公式規約](https://help.asana.com/s/article/establish-conventions-for-your-team)

### A2：全社購入しても定着せず、メールと口頭へ戻り顧客案件を落とす

**分類：定着 / 切替 / 入力。状態：機能存在では解決を証明できない。**

- 日付・話者：2025-05-11、FantasticFrontButt。既に全社で購入済みだが、自チームで導入を任された新しいメンバー。
- 失敗：緊急仕事に押され案件が落ち、以前のツール導入も部分利用で終わった。転送メール・個別Teams・口頭に戻り、顧客を失いかけた。
- 回避策：本人と上司は数か月検討し、本人が夜に学習。研修・既存ツール連携を探している。
- 導入契機：経営層が問題を認め全社購入。他チームは定着していると本人も述べるため、Asana全体の失敗ではない。

[一次投稿](https://www.reddit.com/r/Asana/comments/1kk5s09/my_organization_got_asana_for_everyone_but_my/)

My Tasks、Inbox、概要、連携、研修は存在する。したがって「新しいHomeを作れば全員使う」は反証され得る。本人の毎日の動機と、同僚が情報を使う動作まで検証すべき。コンサルタントの営業返信は需要証拠から除外した。[公式My Tasks views](https://help.asana.com/s/article/views-in-my-tasks)、[公式Slack連携](https://help.asana.com/s/article/slack-and-asana)

### A3：PMが追いかけて更新し、実態とダッシュボードが食い違う

**分類：入力 / 定着 / データ信頼。状態：継続的な業務上の痛み。**

- 日付・話者：2025-04-03、Silver_Glass_5655。Asanaの更新を集めるPM。
- 失敗：日々email・Slack・対面で催促し、結局本人が更新。実作業は進んでいても盤面は遅れて見え、上司への説明が必要になる。
- 回避策：本人は手入力で埋め合わせ。他の利用者は会議中に担当票を見ながら確認、更新できていれば会議を任意にする等を挙げる。
- 導入・切替：乗換の具体例ではない。担当者側から「上司のためのcheckboxに見える」という反論があり、機能不足だけでは説明できない。

[一次投稿と反対視点](https://www.reddit.com/r/projectmanagement/comments/1jqekj5/why_nudging_adults_to_update_their_task_in_asana/)

現在のAsana Slack連携は、メッセージからの作成、スレッドとコメントの双方向同期、状態変更の通知を持つ。「更新連携がない」は誤り。しかし連携できることと、現場が適切な単位・頻度で利用し状態を維持することは別。Alconのcheck-inは担当者に追加の報告義務を課すより、実行の続きが見えるという直接便益を必要とする。[公式Slack連携](https://help.asana.com/s/article/slack-and-asana)

### A4：親を完了すると未完の子が残り、集計を掃除する仕事が発生

**分類：モデル / データ信頼 / 入力。状態：基本動作は現行でも独立完了。**

- 日付・話者：2025-02-25、Kerri_Kartel。組織のReportingデータを修復した利用者。
- 失敗：完了・archive済みの数百Projectに未完subtaskが残り、未完・期限超過が過大表示。整理に数週間かかり、組織でsubtasksを禁止した。
- 別の回避策：2025-02-26のLaura_Jagerは、Projectをarchiveする2名を決めて全完了確認し、独自の進捗表示ルールを導入。2025-10-10にbundleでの作り方を共有。
- 切替契機：製品乗換は未確認だが、標準機能の利用停止と追加の保守業務が生じている。

[一次投稿群](https://forum.asana.com/t/mark-all-subtasks-complete-before-allowing-tasks-to-be-marked-complete/1741?page=5)

現行公式にも、親を完了しても子は自動完了せず別に完了が必要と記載。これは「子を勝手に完了にすればよい」という要件ではない。実作業の完了と集計上の完了が一致することが要点。任意の完了条件や未完要素の確認は考えられるが、全業務へ承認を強制すると逆効果。[公式subtasks](https://help.asana.com/s/article/subtasks)

### A5：仕事をしたsubtaskが顧客向け進捗更新に現れない

**分類：モデル / 機能 / データ信頼。状態：2026年に一部解消、報告側は直近不満が残る。**

- 日付・話者：2025-09-25、Kyle_Bellin。subtaskで実際の工数と依存を整理する利用者。
- 失敗：難しいsubtaskを終えてもstatus updateの完了欄が空。トップ階層へ昇格すると整理しづらい。
- 回避策：翌日、各subtaskを明示的にProjectへ追加すれば報告に載ると自己訂正。
- 直近の業務影響：2026-08-14、Rick_At_CIPRは毎週多数の顧客向け更新を送り、subtask欠落が透明性を損なうと投稿。乗換は未確認。

[一次投稿](https://forum.asana.com/t/including-subtasks-in-overview-status-update/1099708)

2026-05-08公式告知は、子のTask Paneに親Projectとcustom fieldsが5階層まで現れる改善を発表。一方、当該告知はTimeline / Calendar / Dashboards / Rules等への継承は未対応と明記。従って「subtaskは何も継承しない」という古い苦情は部分的に消えたが、「自動で報告・ルールまで一貫する」は成立しない。8月の投稿はこの切り分けに整合する。[公式2026-05-08告知](https://forum.asana.com/t/subtasks-now-show-parent-project-and-fields-in-the-task-pane/1140273)

### A6：繰り返しで作られた次の仕事に、通常のルールが発火しない

**分類：機能 / 入力 / データ信頼。状態：2026-07に回避策が改善、標準イベントの不整合は残存報告。**

- 日付・話者：2026-06-17、Stilyan_Miladinov。繰り返しで作られる新しい仕事のcustom fieldsを初期化したい。
- 失敗：新規追加時ルールが期待どおり発火せず、前回の値等を新しい回へ持ち込む。
- 回避策：Andreas_Schumannは2026-07-06、時間ベースのルールで毎朝未完仕事のfieldsを消せるようになったと報告。ただし添付画像が次回へ複製される問題は残ると述べる。
- 切替契機：乗換は未確認。毎回の手直しを減らしたいという行動に近い要望。

[直近一次投稿と回避策](https://forum.asana.com/t/enable-recurring-tasks-to-trigger-rules/116010?page=5)

2026-01の公式Scheduled Triggersは定時作成、後続版は既存仕事への操作まで拡張。したがって「Asanaは定期的な自動化ができない」は誤り。残るのは、手作成とシステム生成で同じイベントだと期待した利用者が、別のルール体系を保守する必要があること。[公式Scheduled Triggers](https://forum.asana.com/t/introducing-scheduled-triggers-automate-your-workflows-with-time-based-rules/1113456/1)

### A7：毎月のテンプレートを使うたび、ルール内のProjectを手修正

**分類：モデル / 入力 / 機能。状態：直近で確認できた回避策は構造変更、現行UIでの完全再現は未検証。**

- 日付・話者：2025-12-03、Anastasya_Raichart。月次Projectと永続のintake / deploymentを組み合わせて運用。
- 失敗：templateから月次Projectを作るたび、subtask作成ルールの対象Projectを入れ直す。入れ忘れでsubtaskを見落とす恐れがあり、可変部分の2ルールはbundleから外す必要がある。
- 回避策：evergreenへまとめる案が出るが、本人は月次の報告の見通しとのトレードオフとして今の構造を維持。
- 切替契機：乗換ではなく保守コストの削減。未知の現行改善まで否定しない。

[一次投稿](https://forum.asana.com/t/variable-project-field-in-subtasks-tasks-created-by-rules/1112319)

公式にはtemplate / bundle / project settingsがある。テンプレートが存在することと、参照先が新しい実行単位へ正しく置換されることは別である。この例を「テンプレート機能不足」へ粗く一般化しない。[公式Project templates](https://help.asana.com/s/article/project-templates)

### A8：成果単位の依存を見せられず、個別仕事へ仮の依存を作る

**分類：モデル / 機能 / 切替。状態：関連表示は可能、正式なProject依存としての完全解決は未確認。**

- 日付・話者：2025-07-16、Vernon_Stout1。最高階層の契約でPortfoliosを使い、顧客X/Yの納品が共通機能Aの開発へ依存する構造を見せたい。
- 別例：2026-01-18のAJ130は認証取得の外部監査→内部監査→文書整備という順序を、日付と個別仕事が固まる前に表したい。
- 回避策：別Projectの最後と最初の仕事を依存させる。日付や仕事の未確定時、上位での可視化には合わない。
- 切替契機：元の2020投稿者はMonday導入を検討と明記。2025～26の利用者による乗換実施は未確認。

[一次投稿群](https://forum.asana.com/t/making-one-project-dependent-on-another-project/84168)

現行Asanaにはreference custom fieldsがあり、Projects同士等の関連を表示できる。ただし公式は関連参照と正式な依存を区別する。単に「Projectをリンクできない」は誤りで、状態伝播や依存線まで含む要求は別途検証が必要。[公式Reference fields](https://help.asana.com/s/article/reference-custom-fields)

## 消えた苦情・弱い根拠を、競合の欠落として残さない

| 論点 | 現行確認による扱い |
| --- | --- |
| LinearにRelease管理がない | L5の主要な欠落は2026-04-30に解消。今回の差別化から外す。 |
| Linearの計画起案・進捗更新をAIに任せられない | 2026-09-03のProject draft、2026-06-18のagent-assisted updates、2026-07-20のLoopsがある。単なるAI生成や定期更新を独自機能と呼ばない。 |
| Linearの通知が全て同じ優先度 | 2026-09-03にPriority Inbox。Nowの独自性を「重要な通知をまとめる」に置かない。 |
| Asanaのsubtaskに親のProject / fieldsが何も現れない | 2026-05-08にTask Pane側は改善。報告・Rulesへの継承と区別する。 |
| Asanaで任意の仕事同士・Project同士を関連付けできない | Reference custom fieldsがある。正式な依存と関連参照の差だけを残す。 |
| Asanaに定期実行の自動化がない | Scheduled Triggersがある。繰り返し生成時のイベント整合性と区別する。 |
| Slackから仕事を作り、返信を同期するだけで新しい | 両製品に既存機能。AsanaにはAI条件付きSlack Rulesもある。 |

現行機能の根拠：[Linear 2026-09-03](https://linear.app/changelog)、[Linear agent-assisted updates 2026-06-18](https://linear.app/changelog/2026-06-18-agent-assisted-project-updates)、[Linearの更新仕様](https://linear.app/docs/initiative-and-project-updates)、[Asana Slack仕様](https://help.asana.com/s/article/slack-and-asana)。

さらに、Asanaで「1回だけ繰り返し期日を変えると全未来が変わる」という2026-02-03の投稿は、翌日の再現・説明で投稿者が解決を認めたので残存苦情から除外した。[自己訂正された投稿](https://forum.asana.com/t/editing-the-due-date-of-a-single-recurring-task-instance-without-changing-future-ones/1122359)

性能は今回の優先根拠にしない。LinearのUIを速く使いやすいとする移行者もいる一方、報告や連携の不足を感じる利用者もいる。しかし速度の比較測定をせず、単発の遅い・バグが多いという声から「高速化で勝てる」とは言えない。Asanaのformula再計算の個別不具合報告も発見したが、現行で解決済みか確定できないので中核の未実装機能に数えていない。

宣伝除外：L2のHipporello営業返信、L3のDM誘導、L4の外部AIサービス推薦は不満の裏付けに使用していない。2026-03-21の「task loggingをやめた」同文が複数のSaaS起業コミュニティへ投稿されていたため、独立した利用者の声として集計しない。

## 組織活動の問題として読み替える

1. **依頼・作業・共有の単位が揃わない。** A1 / L4のように粒度や所属がばらつくと、検索・担当一覧・報告が全部悪化する。万能な階層を増やすより、最初の案件がそのまま日常操作へつながることが必要。
2. **更新する人と便益を得る人が違う。** A3では担当者が管理者のための入力と感じる。本人が次に進む・待ち先が分かる・同じ説明を繰り返さず済む、という便益がないと、新しい欄は新しい管理負担になる。
3. **同じ仕事なのに、作成経路や表示階層で挙動が変わる。** A4～A7は、親子・再発・template・集計の組合せで現実と状態がずれる例。一覧の見栄えより、共通の更新と一貫した意味が重要。
4. **現場の便利さと組織の柔軟性は対立し得る。** L1では型付きデータが必要、L4 / A1では分類の増殖が負担。どちらか一方を無条件に最大化してもPMFにはならない。
5. **選ぶ人・導入する人・使う人を分ける必要がある。** A2は全社購入だけでは自チームが動かない例。移行完了や管理画面の成功だけで利用定着とみなさない。

これらは観測例からの推論であり、組織一般での原因構成比は未検証。

## 中核の解法仮説と反証条件

### H1：1人が仕事を進める操作を、共有盤面の更新と同じにする

初期顧客の候補は、5～20人程度で複数の顧客案件・社内業務を同時に回し、専任のツール管理者がいない運用チーム。人数は今回の調査から推計した市場規模ではなく、検証範囲を絞るための仮設定。技術者専用のコーディング管理を最初の市場にしない。

仮説：Homeで自分が動ける仕事と待ち先を理由付きで示し、その場の小さな更新が実行状態と共有履歴へ反映されれば、担当者自身の利用価値が上がり、PMの転記・催促が減る。A2 / A3に直接対応する。

既存機能との境界：両社に個人ビューがあり、Linear My IssuesにはFocus、Asanaには保存ビューがある。従って「自分の仕事をまとめる」は新しくない。勝ち筋は、設定不要で妥当な初期表示、なぜ動けるかの説明、更新先の一貫性、同僚が次の行動へ移れることを少ない操作で満たすこと。[Linear My Issues](https://linear.app/docs/my-issues)、[Asana My Tasks](https://help.asana.com/s/article/views-in-my-tasks)

提案する反証条件：実案件を扱う3～5チームの短いpilotで、既存の確認手順より日次確認と更新が短くならない、担当者が催促なしで再訪しない、更新後も同僚が別途説明を求めるなら、Home / check-inだけで十分という仮説を棄却する。状態を更新するだけで実作業は進んでいない場合も、実行の改善とみなさない。

### H2：移行を「データを入れる」から「明日もその仕事を続けられる」へ変える

初期顧客の候補は、スプレッドシートまたは別PM製品で1つの進行中案件を管理し、全面移行する前に少人数で試したいチーム。L3のような技術的な移行担当しか使えない入口にしない。

仮説：貼付 / CSVをpreviewし、担当・期日・状態を確認でき、未解釈項目を失わずに1案件を持ち込めれば、概念設定を学ぶ前に自分の仕事が現れ、初日の価値を感じられる。A1 / A2 / L3 / L4への入口になる。

既存機能との境界：競合にも強いimportがある。Alconの当面の実装を全履歴・添付・コメント・独自fieldsの完全移行と呼ばない。未対応項目、同名担当、曖昧な日付を明示し、権限のない人や外部ユーザーを自動招待しない。保持したものを利用者が読み直せることが差の検証対象。

提案する反証条件：import成功後に元の表へ戻る、担当や状態の修正に元の手入力以上の時間がかかる、翌日に同じ案件を更新しない場合は、importをactivationと数えない。合格は「保存できた」ではなく、担当者の更新を別の同僚が読んで動けるところまで。

### H3：任意の構造を増やす前に、仕事の所属と完了の意味を一貫させる

初期顧客候補は、一つの仕事が顧客案件・社内改善など複数の文脈へ関わり、再発業務も持つチーム。L1 / L4 / A4～A7に対応する。

仮説：同じElementを複数の文脈から参照しても複製されず、完了・依存・再開がどの入口からも一貫し、必要な型付き属性だけ足せれば、運用のための整理を減らせる。Alconの既存multi-homing / Property / 依存を強くする方向で、別の管理ライフサイクルを全員へ追加しない。

既存機能との境界：Asanaもmulti-homingとReference fieldsを持つ。LinearはissueのProjectが1つでもLabels / Viewsで代替できる。従って「グラフ構造」自体を独自性にしない。同じ操作が別画面・再発・集計で矛盾しないことが要点。繰り返しや親子の全組合せを今回一度に実装する必要はなく、最初に実際の更新と依存作成の経路を成立させる。

提案する反証条件：導入顧客の大半が単一案件だけで困らず複数文脈を使わない、従来のLabelsや規約で十分、構造の説明時間が手直し削減より大きいなら、この方向を中核GTMにしない。

## 今回の統合案への具体的な評価

| 提案 | 一次声との適合 | 実装・検証時の反論 |
| --- | --- | --- |
| 1案件の貼付 / CSV preview | L3の移行作業、A2の立ち上げ負担へ直接効く | 取り込みは継続利用ではない。未解釈値を隠さず、元データとの照合と翌日の更新まで見る。 |
| 新規default HomeをNowにする | A2 / A3の個人にとっての便益を作れる | My Tasks類の再発明だけでは弱い。「今動ける」は依存データが最新である条件付き。期限なし・依存なしの普通の仕事にも役立つ必要がある。 |
| 一度のcheck-inで状況・次の一手・共有履歴 | A3の転記と別報告を減らす可能性 | 3項目を毎回必須にすると入力税。何も変わっていない時に儀式を要求しない。履歴から誰が何を変えたか読めること。 |
| 依存を画面から作成できる | Nowの待ち先説明の必要条件 | 実行データが作れないまま可視化を増やさない。権限、循環、削除・完了・非可視の参照、重複を扱う。 |

縦の実装検証は「1案件をpreview → 保存 → 担当者のHomeへ出る → 依存を設定 → 待ち元を更新 → 待っていた人の表示が変わる → 同じ履歴を詳細で読める」を中心にする。新しいテスト用語を製品のユーザーへ露出しない。

GTMで今言えるのは、進行中の案件を持ち込み、日々の実行・待ち合わせ・共有を一つの流れにするという提案まで。「追跡不要」「AIが実態を自動把握」「移行するだけでチームが定着」「Asana / Linearより全面的に優れる」は、今回の機能と証拠の範囲を超える。

本レポートは今回の意思決定の根拠であり、バックログや進捗の代替ではない。次の検証結果と判断は既存の盤面へ戻す。

## ClickUp：性能・情報量・表示の信頼性

確認日：2026-09-07。以下は3つの当事者事例であり、不満の発生率ではない。

| 証拠 | 当事者と失敗 | 回避・切替・解消の確認 |
|---|---|---|
| C1 | [MattPaquette613：11人の制作会社、7年以上利用](https://www.reddit.com/r/clickup/comments/1w89ps5/clickup_is_so_slow_that_im_about_to_look_hard_at/)。2026-09-05付検索索引、取得ページは相対時刻表示のため投稿日の厳密一致は未確認。直近1年、一覧・計算付きDashboardの読込が遅く、翌7日分の仕事表示に2分かかるという自己申告 | 代替候補を探す意向。別の投稿者はbrowser再起動・cache削除で軽減すると回答し、問題を経験しない人もいる。ClickUp担当アカウントが個別調査を申し出ている。全環境の再現や実際の乗換は未確認 |
| C2 | [Karen Cuéllar、2026-04-07、公式Feedback内](https://feedback.clickup.com/feature-requests/p/make-it-faster)。数日使わずGanttを開くと完了済みの仕事が進行中に見え、個別項目を開いて戻ると表示が更新される、と報告 | 古い表示がチームの状況判断を誤らせる例。親issueはcompletedだがコメント時点の現象の解消は確認できない。根本原因・保存データの巻戻りを証明するものではない |
| C3 | [Maeve Lander、2026-04-02の投稿、04-06に公式Feedbackへ統合](https://feedback.clickup.com/feature-requests/p/clickup-lite)。BoardsとDocsしか使わないため増え続ける機能を非表示にし、軽い構成を使いたい | Lite版の要望。導入人数・離脱・支払額は未記載。シンプルさへの需要を、全ユーザーが機能の少なさを好むという主張へ一般化しない |

公式には[ClickUp 4.0の統合sidebar、Home、Agents等](https://clickup.com/blog/clickup-4-0/)が2025-12-08に紹介され、[3.0は2026-03-27に終了](https://help.clickup.com/hc/en-us/articles/31142608907543-Intro-to-ClickUp-4-0)している。「日々の入口を一か所にする」だけでは競合との差別化にならない。完了扱いの古い性能要望も、改善なしの証明には使わない。

Alconへの含意は、分析やAIを足す前に日常操作の応答と共有状態の一貫性を測ること。Nowにも読取時点・取得失敗・隠れた依存の不明を表示する。Alconの性能が競合を上回ること、モバイルやオフラインまで代替できることは今回未検証である。
