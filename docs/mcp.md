# Clayware MCP サーバー

外部の AI（Claude Code、Claude、ChatGPT など）やスクリプトから、接続した本人の権限で Clayware のデータを読み書きする入口。

- エンドポイント: `https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/clayware-mcp`
- 方式: Streamable HTTP（状態を持たない。POST で JSON-RPC を 1 件送り、JSON で応答を受け取る）
- 認証: claude.ai・ChatGPT などのコネクタは OAuth でサインイン、Claude Code やスクリプトは `Authorization: Bearer <個人用アクセストークン>`（`alc_pat_…`）

## できること

| 読み取り | 書き込み |
|---|---|
| listMyDomains / listObjects / listElements / getElement / findByText / getProgress / getRecentActivity / listWorkers / listInitiatives / getInitiative | createElement / updateElement / addElementComment / addElementAssignee / setElementLabels / createSubelement / toggleSubelementComplete / claimElement / releaseElement / logProgress / reportOutcome |

`createSubelement` / `toggleSubelementComplete` が扱う Sub-element は、親の Element（`parent_id`）を持つ普通の Element で、親と同じ Object に入る。完了は status `done`、再開は `todo`。`getElement` は `subElements` に並べる。

削除、一括変更、Object 間の移動、Object の編集はできない。この許可リスト（`_shared/externalTools.ts`）は REST API（[api.md](api.md)）と共通。見える範囲と書ける範囲は、アプリでの本人の権限（RLS）と同じ。書き込みは Element の Activity に「… — via Claude Code (MCP · token: laptop)」の形で、どのトークン経由かまで記録され、コメントは AI 名で投稿される。

担当にできるのは、Element と同じ Space の Worker だけ。`listWorkers` は `elementId` を渡すとその Element に割り当てられる Worker を、`objectId` / `domainId` を渡すとその Domain を見られる人を、引数なしなら本人が属する Space 全体の Worker を返す。`addElementAssignee` は Space の外の Worker を `Worker is outside this Element's Space` で断り、`createElement` の `assigneeWorkerIds` は割り当てられない Worker を飛ばして `assigneeError` に名前を返す。`createElement` の `basisIntentIds` には、その Element が何のためにあるか（Strategy の成功条件・前提・意思決定の intent id。`getInitiative` で読める）を渡す。一つずつ判定し、置き換えられた intent、Element の Object が属していない Strategy の intent、編集できない Strategy の intent は結び付けず、`basisError` に id と理由を返す（ほかの id は結び付く）。

## Element を進めるとき（着手・報告）

外部のエージェントは、Element を進めるあいだ、何をしているかを次の4つで Element に残す。人はアプリの Element の行・コメント・Activity で、誰（どのクライアント）がどこまで進めたかを確かめられる。

| ツール | すること |
|---|---|
| `claimElement` | 着手を宣言する。Element に lease（担い手・ブランチ・40 分の期限）が付き、一覧の行に出る。別のセッション（`.claude/ops/lease.mjs` や他の外部エージェント）が lease を持っている間は、持ち主と期限を添えて断られるので、その Element は進めない |
| `logProgress` | 計画（`steps`）や進捗をコメントに残す。このセッションが lease を持っていれば期限を延ばす。報告が途絶えれば lease は切れる |
| `reportOutcome` | 締めくくる。`completed` は Element をレビュー待ちへ、`blocked`（権限を超える判断・資格情報が要る）はブロック中へ移し、`partial` はステータスを変えない（完了・取り消し済みの Element は動かさない）。`message` は「完了報告／対応が必要です／途中報告」のコメントになり、担当者・Element の owner・Domain の owner に通知される。接続した本人にも「<クライアント名>: 対応が必要です」などの通知が1件届く（担当が本人だけの Element でも判断依頼が埋もれない）。lease は返す |
| `releaseElement` | 報告せずに手を引くときに lease を返す |

lease は `claim_element()` / `release_element()` だけを通して書く。担い手は `<記録名>@<接続した人の ID の先頭 8 文字>.<session>`（例 `Claude Code (MCP · token: laptop)@1a2b3c4d.feat-x`）で、別の人のエージェントが同じクライアント名を名乗っても、他人の lease を取ったり返したりできない。同じトークンで複数のセッションを動かすときは、`session` に作業ごとの名前（worktree 名・ブランチ名）を渡し、4つのツールで同じ値を使う。読み取りのみのトークンには4つとも出ない。

## 認証

個人用アクセストークン（PAT）を使う。アプリの Settings › API で発行する。

- 名前、有効期限（30 日・90 日・無期限）、権限（読み取りと書き込み／読み取りのみ）を選ぶ。平文が表示されるのは発行したときの 1 回だけで、DB にはハッシュだけが残る
- 一覧には、権限・有効期限・最終使用日時と接続元が出る。取り消すと、次の要求から 401 になる
- 関数はトークンを本人の 5 分間の JWT に交換して動くので、見える範囲と書ける範囲はアプリでの本人の権限と同じ。読み取りのみのトークンには読み取りのツールだけが見え、書き込みは `Unknown tool` で断られる
- 外部の AI やスクリプトは、トークンを発行・取り消し・一覧できない（アプリからだけ）
- 有効なトークンは 1 人 20 個まで
- パスワードを変更しても、トークンは取り消されない。使わなくなったトークンは取り消す

Supabase のセッションの JWT（1 時間で切れる）も受け付けるが、検証用の代替手段にとどめる。

## claude.ai・ChatGPT から接続する（OAuth）

コネクタの設定にエンドポイントの URL を貼るだけでよい。トークンは要らない。

1. claude.ai の Settings › Connectors › Add custom connector（ChatGPT は Developer mode のコネクタ）に、エンドポイントの URL を入れる
2. Clayware のサインイン画面が開く。サインインすると同意画面（`/oauth/consent`）に、クライアント名・戻り先・できること・できないことが出る
3. 「読み取りと書き込み」か「読み取りのみ」を選んで承認する

接続したアプリは、Settings › API の「Connected apps」に並ぶ。権限を替えたり、切断したりでき、切断すると次の呼び出しから 401 になる。OAuth で発行されたトークンでデータに届くのは、Clayware の MCP（と REST API）を通したときだけで、PostgREST などに直接持ち込んでもデータは読み書きできない。書き込みは「Claude (MCP · OAuth)」の形で記録される。

仕組み：401 の `WWW-Authenticate` が `resource_metadata` で `…/clayware-mcp/.well-known/oauth-protected-resource` を指し、そこに認可サーバー（Supabase Auth の OAuth サーバー、`https://<ref>.supabase.co/auth/v1`）が書いてある。クライアントの登録・PKCE・トークンの発行と更新は Supabase が行う。

## Claude Code から接続する

トークンを発行すると、それを埋め込んだコマンドがコピーボタン付きで表示される。

```bash
claude mcp add --transport http clayware "https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/clayware-mcp?client=Claude%20Code" --header "Authorization: Bearer alc_pat_…"
```

`?client=` に書いた名前が記録に使われる。省略した場合は、User-Agent から判別する。Authorization ヘッダーを送れる MCP クライアントやスクリプトなら、同じ方法で接続できる。

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy clayware-mcp --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```

`--no-verify-jwt` を付けるのは、トークンがない場合や、期限切れ・取り消し済みの場合に、関数自身が MCP の形式に沿った 401（保護リソースのメタデータを指す `WWW-Authenticate` 付き）を返し、メタデータをトークンなしで配るため。トークンの検証は関数の中で行う。`_shared/externalTools.ts` を変更したら `clayware-api` も、`_shared/boardTools.ts` を変更したら `clayware-api` も再デプロイする。

PAT と OAuth を受け付けるには、Edge Function のシークレット `CLAYWARE_JWT_SIGNING_KEY` に、プロジェクトの JWT シークレット（Legacy JWT secret）を入れる。ない場合、PAT と OAuth のトークンは 500「server not configured」で断られ、セッションの JWT だけが通る。OAuth にはさらに次を行う。

- Authentication › OAuth Server を有効にする（Authorization path は `/oauth/consent`、Dynamic client registration は ON）
- Site URL を本番のアプリにし、Redirect URLs に `<本番のアプリ>/oauth/consent**` を足す（同意画面で登録した人の確認メールが同意に戻るため）
- Authentication › Hooks の Customize Access Token に `public.custom_access_token_hook` を選ぶ。選ばないうちは、関数が OAuth のトークンを 500「OAuth access token hook not enabled」で断る
- 「Require current password when updating」と「Secure email change」を ON にする。Supabase Auth はトークンのロールを見ないので、これがないと、承認されたクライアントが本人のパスワードを変えられる
- MFA を使わない間は TOTP の登録を OFF、ID の手動リンク（Manual linking）とパスキーは OFF のままにする。どれも、承認されたクライアントが本人のトークンで操作でき、ログイン手段を足したり、本人を設定から締め出したりできる

非対称の署名鍵に移ったら、EC の秘密鍵の JWK を入れれば ES256 で署名する。

## 逆向き：Clayware のエージェントが外部サービスを使う

この文書は外部の AI が Clayware を操作する入口を扱う。Clayware のエージェント（run-agent）が Linear・Asana・任意の MCP / API を道具として使う接続は、Settings › Connectors で Space の owner が設定する。資格情報は Vault に置かれ、外部への書き込みは既定で毎回承認を待つ。エージェントは Clayware 自身を指す連携を使わず、Clayware の PAT は連携の資格情報として保存できない（エージェントは開始した人の権限で、盤面の道具をすでに持っている）。

### Google Drive（OAuth）

Google Drive は資格情報を貼り付けず、owner が Google にサインインしてつなぐ。スコープは `drive.file` だけなので、エージェントが扱えるのは Clayware が作ったファイルと利用者が選んだファイルに限られ、作ったファイルは接続した Google アカウントの名義になる。エージェントには `drive_search`・`drive_read`（読み取り）と `drive_create`・`drive_update`・`drive_create_folder`（書き込み、承認を通る）が出る。

アクセスは Google アカウントに付き、Space ごとには分かれない。同じ Google アカウントを 2 つの Space でつなぐと、どちらの Space のエージェントも、もう一方で Clayware が作ったファイルを見られる。また切断は Google で Clayware の許可全体を取り消すので、一方の Space で切断すると、同じアカウントをつないだ他の Space も次のリフレッシュで `oauth_expired`（再接続が必要）になる。

### GitHub（OAuth）

GitHub も資格情報を貼り付けず、owner が GitHub にサインインしてつなぐ（Settings › Connectors から）。スコープは `repo` で、サインインした人が触れるリポジトリを読み書きできる。この接続を、Element のコード変更（差分の取得、判定・行コメントの投稿、マージ）とエージェント（GitHub の MCP サーバー）の両方が使い、投稿・マージ・push はサインインした GitHub アカウントの名義になる。トークンは期限切れにならず、切断（GitHub の grant の取り消し）か、本人が GitHub の Settings › Applications で Clayware を外すまで使える。アクセスが GitHub アカウントに付き、一方の Space で切断すると同じアカウントの他の Space も切れるのは Google と同じ。

### サインインの流れ（共通）

サインインは Edge Function `integration-oauth` が行い、連携の行（`google-drive` なら Google、`github` なら GitHub）で相手を決める。ブラウザが JWT なしで `/go` と `/callback` に来るので `--no-verify-jwt` で配置し、`/start`・`/finish`・`/revoke` は関数の中で JWT を確かめる。コールバックはトークンを預かるだけで連携には保存せず、アプリに戻ったあと、サインイン中の利用者の JWT で `/finish` を呼んだときに、`/start` を呼んだ本人であり今もオーナーである場合だけ、同じ相手の行に保存する。他人が完了したサインインのトークンは、相手で取り消さずに捨てる（取り消すと、その人が自分の Space で使っている接続まで切れる）。

配置は順番を守る。アプリは `integrations.external_account` を読むので、先に migration `20261006090000_integration_oauth.sql` を本番に適用し、次に関数、最後にアプリを公開する。

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy integration-oauth --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy integration-test --project-ref rkugtcqztkkacvoylupw --use-api
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy run-agent --project-ref rkugtcqztkkacvoylupw --use-api
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy code-changes --project-ref rkugtcqztkkacvoylupw --use-api
```

Edge Function のシークレットに次を入れる。相手ごとのクライアントか `APP_ORIGIN` がない間、`GET /integration-oauth/status` はその相手を `false`（`{ "google": false, "github": false }`）で返し、画面は「… サインインはまだ設定されていません」と示して接続を押せなくする。

| シークレット | 内容 |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud の OAuth クライアント（ウェブアプリケーション）の ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | 同じクライアントのシークレット |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub の OAuth App の Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | 同じ OAuth App の Client secret |
| `APP_ORIGIN` | サインイン後に戻るアプリの origin（例 `https://clayware.example.com`）。パスは付けない。保存を確定する `/finish` はこのアプリから呼ばれるので、ない間はサインインを完了できない（コールバックは何も保存せず「APP_ORIGIN を設定してください」と返す） |

Google の OAuth クライアントには、承認済みのリダイレクト URI として `https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/integration-oauth/callback` を登録し、同意画面に `https://www.googleapis.com/auth/drive.file` を加える。GitHub の OAuth App（GitHub › Settings › Developer settings › OAuth Apps）は、Authorization callback URL に同じ URL を、Homepage URL に `APP_ORIGIN` を入れる。
