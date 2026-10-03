# 0035 — OAuth integrations sign in through an Edge Function and keep their tokens in Vault

## 背景

エージェントが Google Drive のファイルを検索・読み取り・作成・更新できるようにしたい（ELE_AI-093）。Google Drive は貼り付ける API キーを持たず、利用者が Google にサインインして同意し、アクセストークンとリフレッシュトークンを受け取る OAuth で接続する。既存の連携（ADR 0027）は、オーナーが資格情報を貼り付けて Vault に置く形しかない。

Drive の API は範囲が広く、`drive` スコープを求めると利用者の Drive 全体を読み書きできてしまう。汎用の `http_request` で Drive を呼ばせると、エージェントが組み立てる URL やアップロードの形式を検査できない。

## 選択肢

- サインインの入口：ブラウザで Google のトークンを受け取り Vault に渡す／Edge Function がコードを交換し、トークンはブラウザに出さない
- コードを奪われたときの防御：state だけ／state + PKCE + 始めたブラウザの cookie
- スコープ：`drive`（全体）／`drive.readonly` + 書き込みは別途／`drive.file`（Alcon が作ったファイルと利用者が渡したファイルだけ）
- エージェントの道具：Drive も `http_request`／Drive 専用の型付きの道具

## 決定

- **サインインは Edge Function `integration-oauth` が行う。** `POST /start`（JWT、Space のオーナーだけ）が PKCE の verifier と 2 分限りの 1 回券を作り、アプリはその URL へ遷移する。`GET /go` が券を消費し、HttpOnly の cookie `ioauth`（`SameSite=Lax`、関数のパスだけ）に nonce を置いて Google へリダイレクトする。`GET /callback` は state の行を削除してから（1 回限り）期限（10 分）と cookie の nonce を確かめ、オーナーであることと行が Google Drive のままであることを確かめ直し、verifier でコードを交換する。トークンは関数の外に出ず、Vault にだけ入る。戻り先は Edge の秘密 `APP_ORIGIN` の固定の origin だけで、結果は `?integration_oauth=ok|error` で渡す。
- **サインイン中の状態は `integration_oauth_states` に置く。** 券・state・nonce はハッシュだけを保存し、どのブラウザのロールからも読み書きできない（RLS あり・ポリシーなし・権限なし）。連携の行を消すと一緒に消える。
- **トークンは Vault の `integration:<id>` に JSON で置く。** `{ v: 1, provider: "google", access_token, refresh_token, expires_at, scope }`。書けるのは service role の `store_integration_oauth_token` だけで、`set_integration_secret` は OAuth の連携の資格情報を受け付けない（消すことはできる）。接続したアカウント（Google のメールアドレス）は `integrations.external_account` に置き、メンバーは読めるが、ブラウザからは書けない。接続先や送り方を変えると、資格情報と一緒に消える。
- **スコープは `drive.file` だけ。** エージェントが扱えるのは、Alcon が作ったファイルと利用者が選んだファイルだけになる。コールバックは許可されたスコープに `drive.file` が含まれることを確かめる。作ったファイルの所有者は接続した Google アカウントで、画面はそれを「{email} の名義で作成されます」と示す。
- **トークンは使う直前に新しくする。** `resolveCredential` が、期限まで 2 分を切ったアクセストークンをリフレッシュして保存し直す。Google がリフレッシュトークンを拒んだら（`invalid_grant`）、`last_test` を `oauth_expired` にして、その連携を道具に出さない。
- **Drive は型付きの道具にする。** `drive_search`・`drive_read`（読み取り）と、`drive_create`・`drive_update`・`drive_create_folder`（書き込み）。URL は `www.googleapis.com` の定数から組み立て、ファイル ID は `^[A-Za-z0-9_-]{10,}$` に限る。書き込みは他の外部への書き込みと同じ承認を通る（ADR 0027）。作成の形式は html → Google ドキュメント、csv → スプレッドシート、text → テキストファイル。
- **切断は Google 側の取り消しから。** `POST /revoke` がリフレッシュトークンを Google で取り消してから保存したトークンを消し、その後に行を削除する。
- **OAuth クライアントが無い間は閉じる。** `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` が無い間、`GET /status` は `{ google: false }` を返し、画面は「Google サインインはまだ設定されていません」と示して接続を押せなくする。他の経路は `not_configured` で断る。

## 根拠

トークンをブラウザで受け取ると、Vault に入る前にページのスクリプトや拡張機能から読める。Edge Function でコードを交換すれば、トークンが存在する場所はサーバーと Vault だけになる。PKCE はコードだけを奪っても交換できないようにし、cookie の nonce はサインインを始めたブラウザでしか完了できないようにする。どちらか一方では、他人に用意したサインインを完了させる攻撃や、漏れたコードの使い回しのどちらかが残る。

`drive.file` なら、エージェントが誤って、あるいは指示を注入されて動いても、触れられるのは Alcon を通したファイルだけになる。全体のスコープは便利だが、承認を通る書き込みとは別に、読み取りだけで利用者の Drive 全体が漏れうる。

型付きの道具にすると、承認カードに「ファイルを作成「…」」のような意味のある操作名が出て、URL・アップロード形式・ファイル ID をサーバーで検査できる。

## 覆す条件

- 利用者が Alcon の外で作ったファイルを日常的に扱いたいという要求が出たら、Google Picker で選ばせる（`drive.file` のまま）か、スコープを広げるかを決め直す
- Google 以外の OAuth 連携を足すときは、`provider` ごとに設定とトークンの形を分け、この流れを共通にする
- 共有ドライブや所有者の移譲が要るようになったら、作成の名義をサービスアカウントにするかを含めて決め直す
