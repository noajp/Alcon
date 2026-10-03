# Alcon MCP サーバー

外部の AI（Claude Code、Claude、ChatGPT など）やスクリプトから、接続した本人の権限で盤面を読み書きする入口。設計の判断は [ADR 0026](adr/0026-external-ai-reaches-the-board-through-mcp-with-the-callers-rls.md)、認証は [ADR 0031](adr/0031-external-callers-authenticate-with-a-pat-or-oauth-and-get-a-short-lived-user-jwt.md)。

- エンドポイント: `https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/alcon-mcp`
- 方式: Streamable HTTP（状態を持たない。POST で JSON-RPC を 1 件送り、JSON で応答を受け取る）
- 認証: `Authorization: Bearer <個人用アクセストークン>`（`alc_pat_…`）

## できること

| 読み取り | 書き込み |
|---|---|
| listMyDomains / listObjects / listElements / getElement / findByText / getProgress / getRecentActivity / listWorkers / listInitiatives / getInitiative | createElement / updateElement / addElementComment / addElementAssignee / setElementLabels / createSubelement / toggleSubelementComplete |

削除、一括変更、Object 間の移動、Object の編集はできない。見える範囲と書ける範囲は、アプリでの本人の権限（RLS）と同じ。書き込みは Element の Activity に「… — via Claude Code (MCP · token: laptop)」の形で、どのトークン経由かまで記録され、コメントは AI 名で投稿される。

担当にできるのは、Element と同じ Space の Worker だけ（[ADR 0028](adr/0028-workers-belong-to-a-space.md)）。`listWorkers` は `elementId` を渡すとその Element に割り当てられる Worker を、`objectId` / `domainId` を渡すとその Domain を見られる人を、引数なしなら本人が属する Space 全体の Worker を返す。`addElementAssignee` は Space の外の Worker を `Worker is outside this Element's Space` で断り、`createElement` の `assigneeWorkerIds` は割り当てられない Worker を飛ばして `assigneeError` に名前を返す。

## 認証

個人用アクセストークン（PAT）を使う。アプリの Settings › Integrations の「Alcon へ接続する」で発行する。

- 名前、有効期限（30 日・90 日・無期限）、権限（読み取りと書き込み／読み取りのみ）を選ぶ。平文が表示されるのは発行したときの 1 回だけで、DB にはハッシュだけが残る
- 一覧には、権限・有効期限・最終使用日時と接続元が出る。取り消すと、次の要求から 401 になる
- 関数はトークンを本人の 5 分間の JWT に交換して動くので、見える範囲と書ける範囲はアプリでの本人の権限と同じ。読み取りのみのトークンには読み取りのツールだけが見え、書き込みは `Unknown tool` で断られる
- 外部の AI やスクリプトは、トークンを発行・取り消し・一覧できない（アプリからだけ）
- 有効なトークンは 1 人 20 個まで
- パスワードを変更しても、トークンは取り消されない。使わなくなったトークンは取り消す

Supabase のセッションの JWT（1 時間で切れる）も受け付けるが、検証用の代替手段にとどめる。claude.ai や ChatGPT のコネクタで使う OAuth は ELE_PLT-004 で追加する。

## Claude Code から接続する

トークンを発行すると、それを埋め込んだコマンドがコピーボタン付きで表示される。

```bash
claude mcp add --transport http alcon "https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/alcon-mcp?client=Claude%20Code" --header "Authorization: Bearer alc_pat_…"
```

`?client=` に書いた名前が記録に使われる。省略した場合は、User-Agent から判別する。Authorization ヘッダーを送れる MCP クライアントやスクリプトなら、同じ方法で接続できる。

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy alcon-mcp --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```

`--no-verify-jwt` を付けるのは、トークンがない場合や、期限切れ・取り消し済みの場合に、関数自身が MCP の形式に沿った 401（`WWW-Authenticate` 付き）を返すため。トークンの検証は関数の中で行う。`_shared/boardTools.ts` を変更したら、`alcon-copilot` も再デプロイする。

PAT を受け付けるには、Edge Function のシークレット `ALCON_JWT_SIGNING_KEY` に、プロジェクトの JWT シークレット（Legacy JWT secret）を入れる。ない場合、PAT は 500「server not configured」で断られ、セッションの JWT だけが通る。非対称の署名鍵に移ったら、EC の秘密鍵の JWK を入れれば ES256 で署名する。

## 逆向き：Alcon のエージェントが外部サービスを使う

この文書は外部の AI が Alcon を操作する入口を扱う。Alcon のエージェント（run-agent）が Linear・Asana・任意の MCP / API を道具として使う接続は、Settings › Integrations の「外部サービスをつなぐ」で Space の owner が設定する。資格情報は Vault に置かれ、外部への書き込みは既定で毎回承認を待つ。設計は [ADR 0027](adr/0027-agents-act-on-elements-with-the-callers-rls-and-stop-for-approval.md)。エージェントは Alcon 自身を指す連携を使わず、Alcon の PAT は連携の資格情報として保存できない（エージェントは開始した人の権限で、盤面の道具をすでに持っている）。
