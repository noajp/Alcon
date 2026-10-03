# 0034 — MCP clients sign in through Supabase's OAuth server, and their tokens work only through Alcon

## 背景

claude.ai のカスタムコネクタと ChatGPT の MCP コネクタは、URL を登録すると OAuth（MCP の認可仕様：保護リソースのメタデータ、動的クライアント登録、PKCE）でサインインを求める。トークンを貼る欄はないので、PAT（ADR 0032）では接続できない（ELE_PLT-004）。

Supabase Auth には OAuth 2.1 のサーバー機能がある。クライアントの動的登録・PKCE・トークンの発行と更新・同意の一覧と取り消しを持ち、同意画面だけをアプリ側に置く。発行されるアクセストークンは、普通の Supabase の JWT（`role=authenticated`）に `client_id` を足したもの。

## 選択肢

- 認可サーバー：Supabase の OAuth サーバー／Next.js 側に自前の認可層（動的登録・PKCE・トークン）
- 発行されたトークンの扱い：そのまま使う（PostgREST にも入れる）／アクセストークンのフックでロールを替え、Alcon の関数だけで使えるようにする
- クライアントにできること：本人の権限すべて／PAT と同じく、同意のときに「読み取りと書き込み」か「読み取りのみ」を選ぶ

## 決定

- **認可サーバーは Supabase の OAuth サーバー。** `alcon-mcp` は保護リソースで、`/functions/v1/alcon-mcp/.well-known/oauth-protected-resource` に RFC 9728 のメタデータ（`authorization_servers` は `https://<ref>.supabase.co/auth/v1`）を出す。401 の `WWW-Authenticate` は `resource_metadata` でそこを指す。ゲートウェイは関数のためにホストの直下の `/.well-known` を出せないので、メタデータは関数の下に置く。
- **同意画面は `/oauth/consent`。** クライアント名と戻り先のホスト、「本人として、本人の権限の範囲で動く」こと、できないこと（削除・一括変更・Object 間の移動・Object の編集）を示し、「読み取りと書き込み」（既定）か「読み取りのみ」を選んで承認する。サインインしていなければ、その場でサインインする（URL は保たれる）。戻り先は Supabase が登録済みの URI と照合したものだけで、画面は `javascript:` などのスキームを開かない。
- **クライアントに許したことは `oauth_client_access` に置く。** 同意の前に `set_oauth_client_access` で書き、行がなければ読み取りのみ。Settings › Integrations の「接続中のアプリ」で、権限を替えたり、切断（`revokeGrant`。クライアントのセッションと更新トークンが消える）したりできる。どちらの書き込みも委任された呼び出しからは拒む（`is_delegated_request()`）。
- **OAuth のトークンで盤面に届くのは Alcon の関数だけ。** `custom_access_token_hook` が、`client_id` のあるトークンのロールを、テーブルの権限を持たない `alcon_oauth_client` に替える。PostgREST・Storage・Realtime に直接持ち込んでも盤面は読み書きできず、届くのは `alcon-mcp` / `alcon-api` を通したときだけになる。誰でも実行できる可視性の判定関数（`user_can_see_*` など）は、本人について真偽を返すだけで行は返さない。アプリのセッション（`client_id` がない）は変えない。関数はこのロールのないトークンを 500「OAuth access token hook not enabled」で断り、フックを有効にし忘れたまま許可リストの外へ開くことはない。
- **Supabase Auth 自体への呼び出しは、トークンが本人のセッションである限り届く。** ロールを替えても、Supabase Auth はロールを見ない。パスワードの変更は「Require current password when updating」で、メールアドレスの変更は「Secure email change」で本人の確認を必須にし、OAuth のクライアントがアカウントを乗っ取れないようにする（設定は運用の前提）。それでも届くのは、全端末からのサインアウトと、本人の OAuth の同意の一覧・取り消しで、どちらもデータには触れない。
- **関数は OAuth のトークンを PAT と同じく本人の 5 分間の JWT に交換する。** `authenticateCaller` が `client_id` のある JWT を `auth.getUser` で確かめ（切断した同意にはセッションが残っていない）、service role で `resolve_oauth_caller` を呼んで、同意が生きていることとクライアント名・許した権限を読み、`mintUserJwt({ via: 'oauth', clientId })` で動く。読み取りのみなら、読み取りのツールだけを見せる。
- **記録の名義は「Claude (MCP · OAuth)」。** クライアントが登録した名前を、名前に使える文字だけに絞って使う。

## 根拠

自前の認可層は、動的登録・PKCE・更新トークンのローテーション・取り消しを正しく書き続ける必要がある。Supabase のサーバーは追加料金なしでそれを持ち、同意の一覧と取り消しの API もある。Alcon が持つのは同意画面と、クライアントに許したことだけでよい。

OAuth のトークンをそのまま使うと、claude.ai や ChatGPT が持つトークンで PostgREST を直接呼べ、MCP の許可リストで外した削除や一括変更ができてしまう（ADR 0026・0033 の決定が助言に変わる）。ロールを替えれば、許可リストと「読み取りのみ」が盤面への実際の境界になる。Supabase は `resource`（RFC 8707）でトークンの宛先を縛らないので、ロールで縛る。動的登録では誰でもクライアントを作れるので、同意画面で戻り先を示すことに加え、アカウントの変更に本人の確認を求める設定を前提にする。

既定を読み取りのみにしないのは、コネクタを付ける目的の多くが Element の作成や更新だから。同意画面で選べ、あとから替えられるので、選んだ結果を本人が確かめられる。

## 覆す条件

- claude.ai や ChatGPT が `openid` のスコープを求めて HS256 の ID トークンで失敗したら、プロジェクトを非対称の署名鍵に移す（自分で作った ES256 の鍵を取り込み、同じ JWK を `ALCON_JWT_SIGNING_KEY` に入れる）
- Supabase がトークンの宛先（`resource`）を縛れるようになったら、ロールの付け替えをやめて宛先で縛るかを決め直す
- クライアントを Space や Domain の単位で絞りたいという要求が出たら、PAT と合わせて、トークンの範囲を判定する層を設計する
- アクセストークンのフックを別の目的にも使うことになったら、OAuth の分岐を壊さないように 1 つの関数にまとめ、テストで固定する
