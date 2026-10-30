# 設計の判断

いま有効な設計の判断をまとめた文書。各項目は、何を決めたか・なぜか・何が変われば考え直すかの3点だけを書く。番号はコードや migration のコメントが「ADR 0028」のように参照しているので変えない。

新しく大きな設計の判断をしたら、該当する節の末尾に同じ形で1項目を足す（番号は次の 0049 から）。判断が変わったら、その項目を書き換える。

## データモデル

### 0001 Element の Direction は jsonb 列

- 決定: 方針・受け入れ条件・次の一手を `elements.direction`（jsonb）に持つ。DB は `jsonb_typeof = 'object'` だけを強制し、形の正規化はクライアントの `normalizeDirection` が担う。
- 理由: Element と 1:1 で常に一緒に読むので、別表は join が増えるだけ。平坦な列は形を変えるたびに migration が要る。
- 覆す条件: Direction を Element と別に横断検索・集計する、別の権限で扱う、形が固まって実質スキーマになったとき。

### 0002 活動集計はサーバー側 RPC

- 決定: Element ごとのコメント件数と最終時刻は `get_element_activity(ids)` が返す。`security invoker` で、POST で呼ぶ。
- 理由: 応答が Element 数に比例し、行数上限による黙った切り捨てと URL 長の上限を避けられる。invoker なので見えないコメントの件数が漏れない。集計列とトリガは整合を保つコードが要るので採らない。
- 覆す条件: 1 Element あたりのコメントが数千になり集計が重いとき、リスト以外でも集計を使うとき。definer にしたくなったら、それは警告として扱う。

### 0003 コメント通知は DB トリガで作る

- 決定: `element_comments` の INSERT トリガ `notify_element_comment()`（definer、`search_path` 固定）が、担当者・Element のオーナー・Domain のオーナーから投稿者を除いた人へ通知を書く。
- 理由: アプリ側で作ると、MCP や API など経路が増えるたびに足し忘れる。トリガならどこから書いても通知が出る。Domain オーナーを含めるのは購読モデルがないことの近似。
- 覆す条件: 購読（watch）モデルを入れたとき。通知の条件分岐がトリガに溜まったとき。一括投入で通知が洪水になったとき。

### 0017 Initiative の Object 集合は junction にだけ置く

- 決定: Initiative（`strategies`）が束ねる Object は `strategy_objects` だけに置く。`scope.object_ids` は書かず読まず、型からも消した。組み立ては `assembleStrategies` に1本化する。
- 理由: 集合は関係なので、逆引き・インデックス・RLS が素直に書ける。二重書きは食い違った瞬間にどちらも信用できなくなる。
- 覆す条件: Initiative 内で Object の並び順が要るとき、条件で Object を束ねたいとき、Object 以外を集合に入れたいとき。

### 0018 データフックは query cache を通し、ユーザー id はセッションから読む

- 決定: ユーザー id は `getCurrentUserId()`（`auth.getSession()`）で読み、`auth.getUser()` は使わない。共有されるデータフックは `useQuery` で書き、realtime の channel は topic ごとに1本（`hooks/sharedRealtime.ts`）。画面が必要とする形は Postgres の RPC（`get_my_elements` など）で組む。
- 理由: 同じデータを読むフックが独立に waterfall を走らせ、起動時に 150 件超のリクエストが出ていた。RLS が毎回トークンを検証するので、クライアントで再検証しても安全性は増えない。
- 覆す条件: react-query を外すとき、`getSession()` の返すセッションを信用できなくなったとき。

### 0019 確定した変更は1本の差分ストリームで受ける

- 決定: `Function/sync/deltaStream.ts` が全表を1チャネルで購読し、純粋関数 `explorerPatch.ts` でキャッシュに差分を当てる。データフックは realtime を知らない。楽観更新は前借りで、確定はストリームから戻る行で行う。購読する表は publication の migration で管理する。
- 理由: 表ごとの購読と書き込み側の invalidate の掛け算が、取りこぼしの温床だった。
- 覆す条件: 同時編集者が増える、回線が不安定、Domain あたり数千 Element になったとき（この下にローカル永続化と書き込みキューを足す）。Realtime の配信仕様が変わったとき。

### 0023 Domain の構想と判断の根拠を残す

- 決定: Domain は複数の構想（`domain_approaches`）を持ち、構想は1つの Initiative と measure を参照する。条件への Object の貢献、観測と解釈を分けた評価、継続・変更・停止のレビューを追記で残し、レビュー時点をスナップショットにする。編集とレビューは版照合で並行更新を拒む。閲覧は Domain と Initiative の両方が見える人、記録は Domain の owner・admin。
- 理由: Object が全部終わっても Initiative が成立するとは限らない。判断当時の根拠を残せば、後の編集で過去の判断を正当化できない。
- 覆す条件: 計画の小さな変更で再評価が過剰になるとき（条件単位の適用範囲を入れる）、owner・admin 以外の評価が必要なとき、Domain をまたぐ比較が要るとき。

## 権限と Space

### 0022 Intent は Initiative と一緒に読め、書けるのはオーナーだけ

- 決定: `intents` / `intent_bindings` と Intent にぶら下がる表の SELECT は Initiative と同じ判定にし、書き込みは Initiative のオーナーに残す。UI は `canEdit` で入力と行の操作を閉じる。
- 理由: Initiative が見えて中身が空に見えると、意図を読むという Strategy と Execution の往復が成り立たない。可視性の述語を共有すれば食い違わない。意図を書けるのはそれを負う人だけ。
- 覆す条件: オーナー以外の編集者を認めるとき（`strategies` の UPDATE と同時に変える）、Intent の一部を下書きとして隠すとき。

### 0028 Worker は Space に属し、割り当ては境界に従う

- 決定: Worker の Space は所属から決める（`object_id` → その Object の Space、`user_id` → その人のメンバーシップ、どちらもなければ `workers.activity_space_id`）。割り当ての可否は `worker_assignable` が判定し、候補は `list_assignable_workers` で取る。ピッカー・MCP・Copilot・エージェントがすべてこれを通る。割り当てられない Worker でも、見える Element にすでに付いていれば名前は見える。各 Space に AI の Worker を1つ置く。人の Worker の名前や種類は本人だけが変え、オーナーが変えられるのは稼働時間・状態・不在の予定だけ。通知は宛先ごとに Element が見えるかで絞る。
- 理由: 全 Worker に Space 列を必須にすると、所属と列の2か所で食い違う。判定を DB の関数1つにまとめれば、どの入口も同じ答えを読む。過去の担当の表示と今後の割り当ては別の問い。
- 覆す条件: 所属の判定が一覧の速度で問題になるとき、名簿の人を複数 Space で使い回すとき、inactive も割り当てたいとき、Space に役割の違う AI を複数置くとき。

### 0029 所属は招かれた本人の承諾で成立する

- 決定: 招待は `membership_invitations` に置き、書き込みは RPC（`invite_member` / `respond_to_invite` / `cancel_invite`）だけ。承諾したときに所属の行ができる。作った人の owner 登録は作成時のトリガが書き、作成者の列は後から変えられない。Domain は参加している Space の中に、Object は見えている Domain の中に作る。ブラウザが書ける所属は、見えている Domain・Object へ自分が member として加わる行（Discover）だけ。Domain の役割には viewer があり、読む判定（`user_can_read_*`）と作業する判定（`user_can_see_*`）を分けている。最後の owner は外せない（Domain の管理者が外すときは引き継ぐ）。
- 理由: 所属の表に状態を足すと、所属を読むすべての関数が状態を見る必要があり、1か所の漏れで未承諾の人がメンバーになる。別表なら漏れは「見えない」側に倒れる。RPC なら権限・重複・通知を1トランザクションで決められる。
- 覆す条件: メールで招きたいとき、迷惑な招待が問題になるとき、member にも招く権限を渡したいとき。

### 0030 使わなくなった Object はアーカイブし、Object が残る Domain は消さない

- 決定: `objects.archived_at` / `archived_by` で一覧・ピッカー・ボードツールから外す。可視性（RLS）は変えず、id では開ける。権限はトリガ `objects_archive_guard`、操作は `archive_object` / `restore_object`。Object が1つでも残る Domain の削除はトリガ `domains_delete_guard` が拒む。
- 理由: 削除だけでは記録か一覧の静けさのどちらかを失う。RLS で隠すとリンクや検索が壊れる。Domain を消して Object を外に出すと「Object は必ず Domain にある」が破れる。
- 覆す条件: アーカイブが増えて探しにくいとき、アーカイブ済みへの書き込みを止めたいとき、自動削除や Domain ごとの一括移動が要るとき。

### 0048 Space の表示範囲は audit か full

- 決定: `activity_spaces.scope` を `audit` / `full` にする。audit では Audit・People・Inbox・Profile・Settings だけを辿れ、埋め込まれた Execution の表面も閉じる。判定は `Function/space/spaceScope.ts`、画面の切り替えは `page.tsx` の `updateTab` の1か所。データは動かさない。変えられるのはオーナー本人だけ（委任された呼び出しは拒否）。
- 理由: 監査から使い始める人に全画面を見せると何の道具か分からない。別アプリにすると全体へ広げるときにデータが分かれる。自由な組み合わせは意図と行動の対を崩す。
- 覆す条件: 中間の段階が要るとき（`scope` に値を足す）、課金プランと結び付けるとき、Copilot や API から範囲外を扱えることが問題になるとき（RLS で閉じる）。

## 外部接続（API・MCP・OAuth）

### 0026 外部 AI は MCP（Edge Function）から本人の RLS で盤面を読み書きする

- 決定: `alcon-mcp` を状態を持たない Streamable HTTP の MCP サーバーにし、ボードツールは `_shared/boardTools.ts` で Copilot と共有する。service role は使わない。外部に出すのは読み取りと日常的な書き込み（Element の作成・更新、コメント、担当、ラベル、Subelement）だけで、削除・一括変更・Object 間の移動・Object の編集は出さない。書き込みは Activity に「via <クライアント> (MCP)」を残す。
- 理由: Next の API ルートに置くと Copilot と二重実装になる。汎用 CRUD を出すと、主 Object と junction の整合や可視性の確認を外部 AI に任せることになる。
- 覆す条件: 確認付きで削除や一括変更を委ねたい要求が出たとき、Copilot と MCP で必要なツールが分かれてきたとき。

### 0032 外部の呼び出しは PAT か OAuth で認証し、関数が本人の短命な JWT を発行する

- 決定: PAT は `alc_pat_` 付きの乱数で、DB には SHA-256 だけを保存する。発行・取り消しは RPC だけで、委任された呼び出し（`is_delegated_request()`）からはできない。`_shared/callerAuth.ts` が PAT や OAuth のトークンを照合し、本人の5分間の JWT（`role=authenticated`）を `ALCON_JWT_SIGNING_KEY` で署名して動く。読み取り専用のトークンには読み取りのツールだけを見せる。エージェントの連携は Alcon 自身を指せず、PAT を連携の資格情報に預けられない。PAT はパスワード変更では失効しない。
- 理由: service role で動くとアプリ側の可視性判定の1か所の漏れが他人のデータに届く。本人の JWT なら RLS がそのまま効く。平文保存は DB の読み取りがなりすましになる。
- 覆す条件: 非対称鍵へ移るとき（鍵を JWK に替えるだけ）、トークンを Space 単位に絞りたいとき、要求ごとの使用記録が要るとき、パスワード変更で失効させたいとき。

### 0033 REST API は MCP と同じツール層を HTTP で出す

- 決定: `alcon-api` に、許可リスト（`_shared/externalTools.ts`、MCP と共通）のツール1つにつき経路1本を置く。入力はツールのスキーマで検査し、OpenAPI も同じ表から作る。失敗は HTTP ステータスで返し、見えないものは 404。
- 理由: PostgREST に直接入れると RLS だけで絞ることになり、MCP で外した操作が REST で開く。同じツールを呼べば可視性と記録が MCP と同一になる。
- 覆す条件: 200 件を超える一覧が要るとき（ページング）、削除や一括変更を外に出すとき（MCP と同時に決める）、Webhook が要るとき。

### 0034 MCP クライアントは Supabase の OAuth でサインインし、そのトークンは Alcon の関数でだけ使える

- 決定: 認可サーバーは Supabase の OAuth サーバーで、`alcon-mcp` が保護リソースのメタデータを出す。同意画面は `/oauth/consent` で、読み書きか読み取りのみを選び、`oauth_client_access` に置く。`custom_access_token_hook` が `client_id` のあるトークンのロールを権限のない `alcon_oauth_client` に替えるので、盤面に届くのは `alcon-mcp` / `alcon-api` を通したときだけ。Auth の設定（現在のパスワード必須、Secure email change、TOTP・ID リンク・パスキーは OFF）を前提にする。
- 理由: 自前の認可層は保守が重い。トークンをそのまま使うと PostgREST に直接入れ、許可リストが助言に変わる。
- 覆す条件: `openid` を求められて HS256 で失敗するとき（非対称鍵に移る）、Supabase がトークンの宛先を縛れるようになったとき、MFA などを有効にしたいとき。

### 0035 OAuth の連携は Edge Function でサインインし、トークンは Vault にだけ置く

- 決定: `integration-oauth` が PKCE・1回券・cookie の nonce でサインインし、コールバックはトークンを Vault に預けるだけにする。保存はサインインを始めた本人の JWT で `/finish` が確定する。トークンは Vault の `integration:<id>` にだけ置き、ブラウザにも URL にも出さない。Google Drive のスコープは `drive.file` だけで、道具は型付き（`drive_search` など）、書き込みは承認を通る。リフレッシュは照合付きで書く。
- 理由: ブラウザで受け取るとスクリプトや拡張から読める。cookie は「券を使ったブラウザ」しか結び付けないので、他人に URL を踏ませる攻撃を `/finish` で止める。`drive` 全体のスコープは読み取りだけで Drive 全体が漏れうる。
- 覆す条件: Alcon の外で作ったファイルを日常的に扱いたいとき（Picker かスコープ拡大）、Space ごとにファイルを分けたいとき、Google 以外の OAuth 連携を足すとき。

## AI エージェント

### 0027 エージェントは本人の RLS で Element を代行し、外部への書き込みは承認を通す

- 決定: Edge Function `run-agent` で自前のループを回し（判断は純粋モジュール `loop.ts`）、盤面・成果物・連携は呼び出した人の JWT で読み書きする。service role は実行の記録と Vault の読み出しだけ。同じターンの外部への書き込みを1件の `agent_actions` にまとめ、入力の SHA-256 に結んだ承認を通す（連携が `full_delegation` なら省く）。最後に `finish` で完了報告を残し、成果物は `agent_artifacts`。長い作業は区切って続きを起動し、transcript はブラウザから読めない。費用は Space ごとの月の上限と1回 $5 で止める。外部連携は Space 単位の `integrations` で、資格情報は Vault、接続先は https の公開ホストに限る。
- 理由: 必要なのは Alcon 内の RLS・承認・監査を通す道具で、隔離環境での任意実行ではない。service role で動くと1か所の漏れが他人のデータの書き換えになる。1件ずつの承認は大量の作業で使えず、承認しないと取り消しにくい書き込みが人の意図の外に出る。
- 覆す条件: 区切りでは回らない量になったとき（キューとワーカーへ）、隔離環境やブラウザ操作が要るとき、承認の粒度が合わないとき、二重実行で困る連携が出たとき（冪等キー）、MCP サーバーが `readOnlyHint` で承認を逃れる例が出たとき。

### 0037 Workload の平準化は決定的に算出し、人が適用する

- 決定: クライアントの純粋関数 `planRebalance` が、42日分について不在日の期限・稼働超過・担当者なしの順に貪欲に提案する。Space 全体でだけ出し、却下は条件として計算し直す。書き込みは人の Apply だけで、ふだんの編集と同じ経路を通る。
- 理由: 同じ盤面から同じ提案が出るので検証とテストができ、課金も通信もない。LLM は時間の足し算を間違えうる。担当替えは人の合意が要る。
- 覆す条件: スキルや希望を根拠に足したいとき、再計算が 300ms を超えるとき、土日に働く組織、人が毎回同じ提案を承認しているとき。

### 0038 People のスキルは完了済み Element を根拠に持つ

- 決定: Team を People に育てる（view id は `team`）。アサイン履歴は `element_assignees` から導出する。スキルは `worker_skills` に持ち、根拠（`worker_skill_evidence`）はその Worker の `done` の Element だけ。境界は Worker と Element の既存の規則に乗せる。評価は People に入れない。
- 理由: 盤面にすでにある事実から導けば入力が要らず、申告を成果で確かめられる。評価はレポートラインの境界が要り、スキルと同じ境界に置くと漏れる。
- 覆す条件: 平準化でスキルを使いたいとき、表記ゆれが索引で吸収できないとき、レポートラインが決まったとき（評価を別の境界で作る）、スキルが Space を越えて見えることが問題になったとき。

## Widget と盤面

### 0039 Widget は出自を持つ共有部品、ボードはその配置（0020 を含む）

- 決定: `widgets`（種類・設定・出自）、`boards`（面と対象ごとに1枚）、`board_placements`（配置）の3表に分け、Supabase の行と RLS と Realtime で同期する。対象と出自の可視性は既存の判定に委ね、Widget 専用の権限は作らない。Home は個人のボード。Widget は生まれたボードの対象を出自にし、置いても見える範囲は広がらない。既定配置は最初の編集まで行にしない。設定は `merge_widget_params` でキー単位に合流する。人と Copilot は同じ行に書く。任意の項目・分類・数値は Table に置き、Widget は参照と表示設定だけを持つ（0020）。
- 理由: Fluid などの中継を足すと中身が Postgres の外に出て、RLS が効かず AI が同じ権限で触れない。個人ボードでは同じものを指して話せない。貼った先に開く方式は、配置という軽い操作で RLS を越える。
- 覆す条件: 中身を持つ Widget を共同編集で順序付きの操作ログが要るとき、Widget を別の対象のボードに置く UI を作るとき、置いた先にも開く要求が繰り返されるとき、Table の共有が決まったとき。

### 0040 Widget の中身は共有の文書で、キー単位で合流する（0024・0025 を含む）

- 決定: 中身は `widget_documents`（Widget × パート）に置き、`merge_widget_document` がトップレベルのキー単位で合流する。本人だけの状態（下書き・依頼文・承認）は `widget_viewer_state`。Widget を最後のボードから外すと中身も消えるので、外す前に確認する。生成アプリは共通ランタイムで、opaque origin の sandbox iframe と CSP の中で動き、認証情報を渡さない（0024）。`alcon.readContext()` は配置先 Object とその Element・Initiative などを本人の RLS で読み取り専用に返し、書き込み・外部通信・任意 SQL は出さない（0025）。共有のアプリが `readContext` を使うには、見る人が採用中の版を承認する。
- 理由: 上書きと拒否は共有するほど使えなくなる。今の中身はキーが独立していて、操作ログは要らない。他人のコードが自分の権限で読むので、接続は見る人ごとに決めさせる。
- 覆す条件: 同じキーの同時編集で入力が失われるとき、順序が結果を決める中身（表計算）を作るとき、外した Widget を戻したいとき、承認が形骸化するとき。

### 0041 ボードの在席は対象を見られる人だけが入れる非公開チャンネルで伝える

- 決定: Realtime の presence をトピック `board:<kind>:<id>` の非公開チャンネルで配り、`board_presence_allowed` が対象の読み取り判定で入れる人を決める。名乗りはクライアントが決め、表示の目安にだけ使う。Home は在席を出さない。
- 理由: 公開チャンネルは UUID を知る人に在席者が漏れる。テーブルに書くと掃除と書き込み量が問題になる。
- 覆す条件: 在席を信頼できる表示にしたいとき、変更履歴が要るとき、判定が接続のたびに重いとき。

## Slides・Design

### 0042 Slides は Kata の編集画面を Space の資料の上で動かす

- 決定: Kata のコードを `ActivitySpace/sustainment/slides/kata/` に移して一本化した。資料（`decks`）とフォルダ（`deck_folders`）は Space の行で、`slides/sync.ts` が同期する。AI は Edge Function `slides-chat` がデッキの JSON だけを返す。Slides は Sustainment の App、`deck` ウィジェットは資料を参照し、全画面で同じ編集画面を開く。同時編集は資料単位の上書きで、未保存の編集は上書きしない。
- 理由: 3ペインの編集画面はボードの枠に収まらないが、資料は文脈の中で見せたい。別アプリのままだと権限とデータが分かれる。
- 覆す条件: 同時編集で変更が消えるとき、Domain 単位で見せたいとき、AI の費用が問題になるとき。

### 0043 デザインは静的な HTML と SVG で持ち、スクリプトの動かない枠で描く

- 決定: アートボードを大きさ・背景・書体・`html`・`css` で持つ（`Function/widget/design/model.ts`）。スクリプト・外部 URL・`@import` は `parseDesign` が拒み、`sandbox="allow-same-origin"` と `default-src 'none'` の CSP の枠で描く。書体はビルド時に `public/design-fonts/` へ写して自前で配る。中身は Widget の共有文書（0040）、AI は `generate-design`。
- 理由: HTML は画面そのものの形式で、AI も実装も読める。スクリプトがなければ閲覧者ごとの接続の確認が要らない。外部フォント配信に閲覧者の情報を渡さない。
- 覆す条件: 手での編集や PNG・PDF の書き出しを入れるとき、スクリプトが必要なデザインが出たとき。

## 監査

### 0044 AI の監査台帳は書類を持たずに記録を持ち、鎖で改ざんを示す

- 決定: 外部の実行は `agent_runs` と分け、`workflow_templates` / `workflow_deployments` / `workflow_runs` / `workflow_run_steps` に置く。書類は番号と鍵つきダイジェストだけ。実行と手順は追記のみで、権限とトリガで変更・削除を拒む。手順は導入ごとに DB が計算するハッシュの鎖を持ち、`verifyChain` で検証する。結果は手順から読む。画面は Sustainment の App「Audit」。
- 理由: 書類の中身を持つと漏えいと保管の責任が増える。顧客のストレージを毎回読むと集計が遅く脆い。鎖を DB で計算すれば、抜けや書き換えが切れ目として残る。
- 覆す条件: 顧客が記録を外に置くこと自体を拒むとき、導入の行のロックが待ちを生むとき、`run-agent` と同じ画面で監査したいとき、DDL 権限者からも守る必要が出たとき（鎖の末尾を外部へ書き出す）。

### 0045 記録の受け口は署名されたまとめ送りを受け、ゲートウェイの鎖が続いているかを確かめる

- 決定: ゲートウェイは Ed25519 の鍵で本文に署名し、Alcon は公開鍵だけを `workflow_gateway_keys` に持つ（登録と失効は Space のオーナー）。`audit-intake` は各記録のダイジェストと、保存済みの最後の記録から鎖が続いていることを確かめ、切れていればまとめ全体を拒む。`batch_id` と記録のダイジェストで冪等にする。拒否も受け入れも `workflow_intake_batches` に残す。
- 理由: 共有シークレットは Alcon から漏れても偽造できる。mTLS は前段で終端される。ゲートウェイ側の鎖は「届くべきものが届いた」を、DB 側の鎖は「入ったものが書き換わっていない」を示す。
- 覆す条件: 1つの導入へ複数のゲートウェイが書くとき、まとめが時間制限に近づくとき、鍵の管理を運用者に任せるとき。

### 0046 権限は Alcon で決め、署名した版つきの表としてゲートウェイに渡す

- 決定: 権限は `deployment_grants`（導入 × 接続 × 操作）に置き、変えられるのはオーナー本人だけ（委任された呼び出しと service role は不可）。変えるたびに `deployment_grant_versions` に版を追記する。`audit-grants` が期限15分の表に Alcon の鍵で署名して配り、期限切れ後は送信とお金を止め、読む・下書きだけを続ける。記録は判断に使った版を持ち、受け口が `outside_grant` を判定する。
- 理由: ゲートウェイの設定に置くと運用者が黙って広げられる。毎回問い合わせると Alcon が落ちたとき全部止まる。版を記録に封じれば後から読み替えられない。
- 覆す条件: 15分の配布遅れが許されないとき、時計のずれで誤判定が出るとき、1つのゲートウェイが複数 Space を扱うとき、署名鍵を替えるとき。

### 0047 承認は内容のハッシュに結び、証明を発行する時に1回だけ消費する

- 決定: 依頼は `workflow_approvals` に内容の SHA-256 と要約だけを持つ。判断はオーナー本人だけで、委任された呼び出しや利用者の JWT で動く関数の道具からは呼ばせない。ゲートウェイは送る直前にハッシュを添えて引き換え、DB が承認済み・期限内・未使用・ハッシュ一致のときだけ消費し、`audit-approvals` が10分有効の証明に署名して返す。
- 理由: `agent_actions` は Element と Alcon 内の実行に結び付いていて合わない。証明の発行と消費を分けると2回使われうる。同じトランザクションなら証明の存在が1回目の使用を意味する。
- 覆す条件: 引き換えの応答が届かず取り直しが許されないとき、オーナー以外にも判断を任せるとき、要約だけでは判断できないとき、署名鍵を分けるとき。

## 開発の仕組み（CI・テスト・lint）

### 0004 design-lint は変更ファイル限定のラチェット

- 決定: `npm run design-lint` は既定で origin/main との差分ファイルだけを見て、ベースより増えた違反だけで落とす。全ツリーは `--all` で監査する。例外は `design-lint-ignore` に理由を添える。規則は純粋関数（`designLintRules.mjs`）でテストする。
- 理由: 既存違反が多い状態で全ツリーゲートを入れると全 PR が赤くなり誰も見なくなる。警告だけでは溜まる。ファイル単位でも隣の既存違反で無関係な PR が止まる。
- 覆す条件: 既存違反が実質ゼロになったとき（全ツリーゲートへ）、ラチェットをすり抜ける違反が主流になったとき、ignore が理由なしで増えたとき。

### 0006 CI に service role を持たせない

- 決定: CI から DB へのイベントは Edge Function `dev-event` が受け、CI は書き込み1種類だけのトークン `DEV_EVENT_TOKEN` を持つ。`kind` は許可リストで検証する。報告の失敗でワークフローを落とさない。
- 理由: CI は `npm ci` で依存の install script を実行するので、service role があればサプライチェーンの1か所で DB 全体が取られる。anon key での匿名 INSERT は誰でも偽イベントを流せる。
- 覆す条件: CI から書くものが増えて関数が実質 API になったとき、OIDC の短命な資格情報が使えるようになったとき。トークンが漏れたら両側で同時に回転する。

### 0008 DOM テストはファイル単位の opt-in

- 決定: vitest の既定環境は node のまま、DOM が要るファイルだけが先頭で `@vitest-environment jsdom` を宣言する。設定ファイルは1つ。
- 理由: 設定を割ると alias や include が2か所になりずれる。jsdom の起動コストが要るファイルにだけ乗る。何が要るかがファイルを読めば分かる。
- 覆す条件: DOM テストが大半になったとき（既定を jsdom に）、環境ごとに setup や alias が要るとき（projects へ）、結線や実描画の検証が主な関心になったとき（E2E）。
