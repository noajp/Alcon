# 0032 — External callers authenticate with a PAT or OAuth; the function mints a short-lived user JWT

## 背景

外部の AI（Claude Code など）やスクリプトは、`alcon-mcp`（ADR 0026）を通じて本人の権限で盤面を読み書きする。ところが、渡せる資格情報は 1 時間で切れる Supabase のセッショントークンしかなく、DevTools の localStorage から取り出す必要があった。日常的には使えず、取り消す手段もない（ELE_PLT-005）。

本番の前提は次のとおり。JWT の署名は旧来の HS256（共有シークレット）だけで、JWKS は空。RLS は `auth.uid()` だけを読む。Edge Function の環境には、既定では JWT シークレットがない。

## 選択肢

- PAT の検証後の動き方：service role で動き、アプリ側で可視性を確かめる／PAT ごとに RLS の条件を足す／PAT の持ち主の短命な JWT を関数の中で発行し、その JWT で動く
- PAT の保存：平文／暗号化（復号できる）／ハッシュ（SHA-256）だけ
- 発行と取り消しの経路：テーブルへの直接の書き込みと RLS／SECURITY DEFINER の RPC
- 署名鍵：旧来の JWT シークレット（HS256）／新しい非対称の署名鍵（ES256）

## 決定

- **PAT は `alc_pat_` で始まる 32 バイトの乱数（base64url）。** `create_personal_access_token(name, expires_days, access)` が発行し、平文を返すのはこの 1 回だけ。DB には SHA-256 の 16 進だけを保存する（`personal_access_tokens.token_hash`）。名前は 1〜60 文字、有効期限は 30 日・90 日・無期限、権限は `read_write`（既定）か `read`。有効なトークンは 1 人 20 個まで。
- **持ち主だけが自分のトークンを一覧できる。** RLS は `user_id = auth.uid()` の SELECT だけで、`token_hash` の列は SELECT させない。挿入・更新・削除はブラウザから直接できず、発行と取り消しは RPC（`create_personal_access_token` / `revoke_personal_access_token`）だけが行う。
- **委任された呼び出しはトークンを管理できない。** `is_delegated_request()` は、JWT に `alcon_via`（PAT から発行した JWT）か `client_id`（OAuth のクライアントに発行された JWT）があれば真になる。発行・取り消しの RPC と一覧の RLS は、これが真なら拒む。外部の AI が自分の権限を延長したり、別のトークンを作ったりはできない。
- **関数は PAT を本人の 5 分間の JWT に交換する。** `_shared/callerAuth.ts` の `authenticateCaller` が、`alc_pat_` で始まるトークンを SHA-256 にし、service role で `resolve_personal_access_token` を呼ぶ（service role を使うのはこの照会だけ）。照会は、取り消し済み・期限切れのトークンと、BAN・削除・匿名のユーザーを拒み、最終使用日時とクライアント名を 1 分に 1 回だけ記録する。通ったら `_shared/delegatedAuth.ts` の `mintUserJwt` が `sub`＝本人、`role`／`aud`＝`authenticated`、`exp`＝5 分後、`alcon_via`、`pat_id` の JWT を署名し、anon key とその JWT で作ったクライアントでツールを動かす。`role` は決して `service_role` にしない（純粋関数 `buildUserClaims` で固定し、テストする）。それ以外のトークンは、これまでどおりセッションの JWT として `auth.getUser` で確かめる。
- **署名鍵は Edge Function のシークレット `ALCON_JWT_SIGNING_KEY`。** 今は旧来の JWT シークレットを入れ、HS256 で署名する。値が EC の秘密鍵の JWK なら、その `kid` で ES256 で署名するので、非対称鍵への移行は設定の変更だけで済む。鍵がなければ、PAT は照会の前に 500「server not configured」で断る。セッションの JWT の経路は影響を受けない。
- **読み取り専用のトークンには読み取りのツールだけを見せる。** `mcpTools('read')` は読み取りのツールだけを返すので、MCP の書き込みは許可リストで `INVALID_PARAMS` になる。REST（`alcon-api`）の書き込みの経路は 403 になる。
- **どのトークンで書いたかを残す。** Activity とコメントの名義は「Claude Code (MCP · token: laptop)」の形にする。トークン名は名前に使える文字だけに絞り、40 文字までにする。
- **エージェントは連携で Alcon 自身に入らない。** `run-agent` は、接続先がこのプロジェクトのホスト（`SUPABASE_URL` のホスト、`<ref>.supabase.co`、alcon-mcp も配信する旧来の `<ref>.functions.supabase.co`。大文字小文字・末尾のドット・ポートは問わない）である連携を使わない。エージェントは開始した人の RLS で盤面のツールをすでに持っている。`set_integration_secret` は、値のどこかに `alc_pat_` を含むもの（`Bearer alc_pat_…` や前に空白のあるものを含む）を拒み、PAT を連携の資格情報として預けられないようにする。
- **PAT はパスワードの変更やセッションの失効では取り消されない。** GitHub の PAT と同じく、トークンは本人が取り消すか期限が切れるまで有効。発行ダイアログで「使わなくなったトークンは取り消す。パスワードを変えても取り消されない」と示す。アカウントの BAN と削除は、照会の時点で拒む。
- **OAuth（ELE_PLT-004）は同じ入口に足す。** `authenticateCaller` のセッションの分岐の前に、`client_id` を持つ JWT の分岐を置く。許可が生きていることを確かめたら、`mintUserJwt({ via: 'oauth', clientId })` で同じ形の JWT にする。

## 根拠

service role で動かすと、可視性の判定をすべてアプリ側で正しく書き続ける必要があり、1 か所の漏れが他人のデータの読み書きになる（ADR 0026・0027 で避けた形）。PAT ごとに RLS の条件を足すと、すべてのポリシーに手が入る。本人の JWT を発行すれば、RLS は `auth.uid()` を読むだけでよく、アプリと同じ境界がそのまま効く。JWT は 5 分で切れ、関数の外に出ないので、取り消したトークンは次の要求から 401 になる。

平文や復号できる形で保存すると、DB の読み取りがそのまま本人へのなりすましになる。トークンは十分な乱数なので、ソルトのない SHA-256 で照合できる。

テーブルへの直接の書き込みを許すと、`token_hash` を自分で選べてしまい、上限や有効期限の検査も RLS に詰め込むことになる。RPC にすれば、乱数の生成・ハッシュ・上限・委任の拒否を 1 か所で強制できる。

パスワードの変更で PAT を失効させると、CI や常駐のスクリプトが、本人の気づかないところで止まる。トークンは本人が名前を付けて発行し、一覧で最終使用を確かめて個別に取り消せるので、セッションとは別の寿命を持たせる。乗っ取りが疑われるときは、パスワードの変更とは別にトークンを取り消す必要があり、そのことを発行の画面で伝える。

本番の署名は HS256 だけなので、今は共有シークレットで署名するしかない。鍵の形を値から判別すれば、非対称鍵へ移るときにコードを変えずに済む。

## 覆す条件

- プロジェクトを非対称の署名鍵に移したら、`ALCON_JWT_SIGNING_KEY` を EC の秘密鍵の JWK に替え、旧来のシークレットを失効させる。その鍵を Supabase の JWKS に載せる手順も決める
- 5 分の JWT では長い要求（大量の読み取り）が途中で切れる例が出たら、1 要求ごとに発行し直すか、有効期限を延ばすかを決め直す
- トークンを Space や Domain の単位で絞りたい（本人の権限より狭くしたい）という要求が出たら、RLS とは別に、トークンの範囲を判定する層を設計する
- 最終使用の記録を監査に使いたいという要求が出たら、1 分に 1 回の記録ではなく、要求ごとの記録を別の表に置く
- パスワードの変更やサインアウト（全端末）で PAT も失効させてほしいという要求が出たら、`auth.users` の変更に合わせてトークンを取り消すトリガか、照会時の比較を足す
- PostgREST に PAT で直接入りたいという要求が出たら、PAT を JWT に交換するエンドポイントを設けるか、ゲートウェイで交換する（REST の入口は `alcon-api`。ADR 0033）
