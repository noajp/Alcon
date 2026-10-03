# 0035 — OAuth integrations sign in through an Edge Function and keep their tokens in Vault

## 背景

エージェントが Google Drive のファイルを検索・読み取り・作成・更新できるようにしたい（ELE_AI-093）。Google Drive は貼り付ける API キーを持たず、利用者が Google にサインインして同意し、アクセストークンとリフレッシュトークンを受け取る OAuth で接続する。既存の連携（ADR 0027）は、オーナーが資格情報を貼り付けて Vault に置く形しかない。

Drive の API は範囲が広く、`drive` スコープを求めると利用者の Drive 全体を読み書きできてしまう。汎用の `http_request` で Drive を呼ばせると、エージェントが組み立てる URL やアップロードの形式を検査できない。

サインインの URL は、それを作った Alcon の利用者の手を離れても使える。ある Space のオーナーが自分の JWT で作った URL を他人に踏ませ、その人が Google で同意すると、他人の Google アカウントがオーナーの Space の連携に入ってしまう。サインインを完了したブラウザと、サインインを始めた Alcon の利用者が同じであることを、保存の前に確かめる必要がある。

## 選択肢

- サインインの入口：ブラウザで Google のトークンを受け取り Vault に渡す／Edge Function がコードを交換し、トークンはブラウザに出さない
- コードを奪われたときの防御：state だけ／state + PKCE + 始めたブラウザの cookie
- 保存の確定：コールバックで保存する／コールバックはトークンを預かるだけにし、始めた本人の JWT で確定させる
- スコープ：`drive`（全体）／`drive.readonly` + 書き込みは別途／`drive.file`（Alcon が作ったファイルと利用者が渡したファイルだけ）
- エージェントの道具：Drive も `http_request`／Drive 専用の型付きの道具

## 決定

- **サインインは Edge Function `integration-oauth` が行う。** `POST /start`（JWT、Space のオーナーだけ）が PKCE の verifier と 2 分限りの 1 回券を作り、アプリはその URL へ遷移する。`GET /go` が券を消費し、HttpOnly の cookie `ioauth`（`SameSite=Lax`、関数のパスだけ）に nonce を置いて Google へリダイレクトする。`GET /callback` は state を取り（1 回限り）、期限（10 分）と cookie の nonce を確かめ、verifier でコードを交換し、許可されたスコープに `drive.file` があることを確かめる。
- **コールバックは保存しない。保存は始めた本人が `/finish` で確定する。** コールバックはトークンを Vault の `integration-oauth-pending:<サインインの id>` に預け（`stash_integration_oauth_pending`）、1 回限り・10 分の完了ハンドルを作って、ブラウザを `APP_ORIGIN/?integration_oauth=finish&handle=…` に戻す。保存するのはハンドルのハッシュだけ。アプリはサインイン中の利用者の JWT で `POST /finish { handle }` を呼ぶ。`/finish` は預けたトークンを 1 回だけ受け取り（`take_integration_oauth_pending`。受け取ったサインインは消える）、呼んだ人が `/start` を呼んだ本人で、期限内で、今も Space のオーナーで、行が Google Drive のままであるときだけ連携に保存する。そうでなければトークンを捨てる。Google での取り消しはしない。取り消すと、その Google アカウントに対する Alcon の許可全体が消え、その人が自分の Space で使っている接続まで切れるため。捨てたトークンは誰も持っていない。トークンはブラウザにも URL にも出ない。
- **`APP_ORIGIN` が無ければ完了できない。** `/finish` へ戻る先が無いので、`/status` は `{ google: false }` を返し、`/start` は `not_configured` で断る。コールバックに来たサインインも保存せずに消し、「APP_ORIGIN を設定してください」と返す。戻り先は `APP_ORIGIN` の固定の origin だけ。
- **サインイン中の状態は `integration_oauth_states` に置く。** 券・state・nonce・完了ハンドルはハッシュだけを保存し、どのブラウザのロールからも読み書きできない（RLS あり・ポリシーなし・権限なし）。行が消えると（受け取り・期限切れ・連携の削除）、預けたトークンもトリガで Vault から消える。
- **トークンは Vault の `integration:<id>` に JSON で置く。** `{ v: 1, provider: "google", access_token, refresh_token, expires_at, scope }`。書けるのは service role の `store_integration_oauth_token` だけで、`set_integration_secret` は OAuth の連携の資格情報を受け付けない（消すことはできる）。接続したアカウント（Google のメールアドレス）は `integrations.external_account` に置き、メンバーは読めるが、ブラウザからは書けない。接続先や送り方を変えると、資格情報と一緒に消える。
- **スコープは `drive.file` だけ。** 認可 URL に `include_granted_scopes` を付けないので、許可は `drive.file` だけのまま。エージェントが扱えるのは、Alcon が作ったファイルと利用者が選んだファイルだけになる。作ったファイルの所有者は接続した Google アカウントで、画面はそれを「{email} の名義で作成されます」と示す。
- **アクセスは Google アカウントと Alcon の OAuth クライアントの組に付く。** `drive.file` で見えるファイルは Space ごとに分かれない。同じ Google アカウントを 2 つの Space でつなぐと、どちらの Space のエージェントも、もう一方で Alcon が作ったファイルを見られる。Google の取り消しはそのアカウントに対する Alcon の許可全体を取り消すので、一方の Space で切断すると、同じアカウントをつないだ他の Space も次のリフレッシュで `oauth_expired` になる。画面はどちらも、接続の説明と切断の確認で示す。
- **トークンは使う直前に新しくする。** `resolveCredential` が、期限まで 2 分を切ったアクセストークンをリフレッシュして保存し直す。保存は、Vault のリフレッシュトークンがリフレッシュを始めたときのもの（SHA-256 で照合）のままである場合だけ行う。その間に別のアカウントでつなぎ直されたり切断されたりしていたら書かず、その実行にはトークンを渡さない。消す操作は常に行う。Google がリフレッシュトークンを拒んだら（`invalid_grant`）、`last_test` を `oauth_expired` にして、その連携を道具に出さない。
- **Drive は型付きの道具にする。** `drive_search`・`drive_read`（読み取り）と、`drive_create`・`drive_update`・`drive_create_folder`（書き込み）。URL は `www.googleapis.com` の定数から組み立て、ファイル ID は `^[A-Za-z0-9_-]{10,}$` に限る。書き込みは他の外部への書き込みと同じ承認を通る（ADR 0027）。作成の形式は html → Google ドキュメント、csv → スプレッドシート、text → テキストファイル。
- **切断は Google 側の取り消しから。** `POST /revoke` がリフレッシュトークンを Google で取り消してから保存したトークンを消し、その後に行を削除する。Google が取り消しを確かめられなかったとき（`revoked: false`）は、画面が Google アカウントの「サードパーティによるアクセス」から手で外すよう伝える。
- **設定が揃うまでは閉じる。** `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `APP_ORIGIN` のどれかが無い間、`GET /status` は `{ google: false }` を返し、画面は「Google サインインはまだ設定されていません」と示して接続を押せなくする。`/revoke` 以外の経路は `not_configured` で断る。
- **配置は migration が先。** アプリは `integrations.external_account` を select するので、migration を本番に適用してからアプリを公開する。関数も migration の RPC を呼ぶので同じ順に置く。

## 根拠

トークンをブラウザで受け取ると、Vault に入る前にページのスクリプトや拡張機能から読める。Edge Function でコードを交換すれば、トークンが存在する場所はサーバーと Vault だけになる。PKCE はコードだけを奪っても交換できないようにし、cookie の nonce はサインインを始めたブラウザでしか完了できないようにする。

ただし cookie が結び付けるのは「券を使ったブラウザ」であって、「`/start` を呼んだ Alcon の利用者」ではない。券を含む URL を他人に踏ませれば、その人のブラウザに cookie が付き、その人の同意でサインインが完了する。保存を `/finish` に移し、始めた本人の JWT で確定させることで、他人が完了したサインインは本人のものにならず、Google で取り消されて消える。完了ハンドルは戻り先の URL に載るが、1 回限り・10 分で、それだけでは保存できない（本人の JWT が要る）。

`drive.file` なら、エージェントが誤って、あるいは指示を注入されて動いても、触れられるのは Alcon を通したファイルだけになる。全体のスコープは便利だが、承認を通る書き込みとは別に、読み取りだけで利用者の Drive 全体が漏れうる。

リフレッシュの書き込みを照合付きにするのは、遅れて終わったリフレッシュが、その間のつなぎ直し（別のアカウントかもしれない）や切断を上書きし、古いアカウントのトークンを復活させないため。

型付きの道具にすると、承認カードに「ファイルを作成「…」」のような意味のある操作名が出て、URL・アップロード形式・ファイル ID をサーバーで検査できる。

## 覆す条件

- 利用者が Alcon の外で作ったファイルを日常的に扱いたいという要求が出たら、Google Picker で選ばせる（`drive.file` のまま）か、スコープを広げるかを決め直す
- Space ごとにファイルの見え方を分けたいという要求が出たら、Space ごとに別の OAuth クライアントを使うか、サービスアカウントにするかを決め直す
- Google 以外の OAuth 連携を足すときは、`provider` ごとに設定とトークンの形を分け、この流れを共通にする
- 共有ドライブや所有者の移譲が要るようになったら、作成の名義をサービスアカウントにするかを含めて決め直す
