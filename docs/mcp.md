# Alcon MCP サーバー

外部の AI（Claude Code、Claude、ChatGPT など）から、接続した本人の権限で盤面を読み書きする入口。設計の判断は [ADR 0026](adr/0026-external-ai-reaches-the-board-through-mcp-with-the-callers-rls.md)。

- エンドポイント: `https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/alcon-mcp`
- 方式: Streamable HTTP（状態を持たない。POST で JSON-RPC を 1 件送り、JSON で応答を受け取る）
- 認証: `Authorization: Bearer <Supabase のアクセストークン>`

## できること

| 読み取り | 書き込み |
|---|---|
| listMyDomains / listObjects / listElements / getElement / findByText / getProgress / getRecentActivity / listWorkers / listInitiatives / getInitiative | createElement / updateElement / addElementComment / addElementAssignee / setElementLabels / createSubelement / toggleSubelementComplete |

削除、一括変更、Object 間の移動、Object の編集はできない。見える範囲と書ける範囲は、アプリでの本人の権限（RLS）と同じ。書き込みは Element の Activity に「… — via Claude Code (MCP)」の形で記録され、コメントは AI 名で投稿される。

担当にできるのは、Element と同じ Space の Worker だけ（[ADR 0028](adr/0028-workers-belong-to-a-space.md)）。`listWorkers` は `elementId` を渡すとその Element に割り当てられる Worker を、`objectId` / `domainId` を渡すとその Domain を見られる人を、引数なしなら本人が属する Space 全体の Worker を返す。`addElementAssignee` は Space の外の Worker を `Worker is outside this Element's Space` で断り、`createElement` の `assigneeWorkerIds` は割り当てられない Worker を飛ばして `assigneeError` に名前を返す。

## Claude Code から接続する

接続コマンドとエンドポイントは、アプリの Settings › Integrations の「Alcon へ接続する」にも出ている（コピーボタン付き）。

アクセストークンは、ログイン中の Alcon で DevTools を開き、`localStorage` にある `sb-rkugtcqztkkacvoylupw-auth-token` の `access_token` から取り出す。有効期限は 1 時間。claude.ai や ChatGPT のコネクタで使えるように、OAuth での接続を ELE_PLT-004 で追加する。

```bash
claude mcp add --transport http alcon "https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/alcon-mcp?client=Claude%20Code" --header "Authorization: Bearer <access_token>"
```

`?client=` に書いた名前が記録に使われる。省略した場合は、User-Agent から判別する。

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy alcon-mcp --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```

`--no-verify-jwt` を付けるのは、トークンがない場合や期限切れの場合に、関数自身が MCP の形式に沿った 401（`WWW-Authenticate` 付き）を返すため。トークンの検証は関数の中で行う。`_shared/boardTools.ts` を変更したら、`alcon-copilot` も再デプロイする。

## 逆向き：Alcon のエージェントが外部サービスを使う

この文書は外部の AI が Alcon を操作する入口を扱う。Alcon のエージェント（run-agent）が Linear・Asana・任意の MCP / API を道具として使う接続は、Settings › Integrations の「外部サービスをつなぐ」で Space の owner が設定する。資格情報は Vault に置かれ、外部への書き込みは既定で毎回承認を待つ。設計は [ADR 0027](adr/0027-agents-act-on-elements-with-the-callers-rls-and-stop-for-approval.md)。
