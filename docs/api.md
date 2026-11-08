# Alcon REST API

スクリプト、ノーコードツール、他の SaaS から、トークンを発行した本人の権限で Alcon のデータを読み書きする入口。MCP（[mcp.md](mcp.md)）と同じツールを HTTP の形で出している。

- ベース URL: `https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/alcon-api`
- 認証: `Authorization: Bearer <個人用アクセストークン>`（`alc_pat_…`。Settings › Customize の「Alcon へ接続する」で発行）
- 名乗り（任意）: `X-Alcon-Client: n8n` を送ると、書き込みの記録が「n8n (API · token: ops)」になる。送らなければ「API · token: ops」
- 機械可読の仕様: `GET /openapi.json`（OpenAPI 3.1。トークンなしで読める）

## 経路

| メソッド | パス | 内容 | 入力 |
|---|---|---|---|
| GET | `/domains` | 参加している Domain | — |
| GET | `/objects` | Object（アーカイブ済みは除く） | `domainId` |
| GET | `/elements` | Element の一覧（既定 50 件、最大 200） | `domainId` `objectId` `status` `priority` `dueWithinDays` `overdueOnly` `limit` |
| GET | `/elements/{id}` | Element の詳細（Sub-element・ラベル・担当・直近のコメント） | — |
| GET | `/search` | タイトル・説明の部分一致 | `query`（必須） `domainId` `limit` |
| GET | `/progress` | ステータスの内訳・完了率・遅延 | `domainId` か `objectId` |
| GET | `/activity` | 最近の Element の変更 | `domainId` `objectId` `limit` |
| GET | `/workers` | 担当にできる Worker | `elementId` `objectId` `domainId` |
| GET | `/initiatives` | 見える Strategy | `parentId` `status` |
| GET | `/initiatives/{id}` | Strategy の意図と、実行する Object | — |
| POST | `/elements` | Element を作る（201） | `objectId` `title`（必須） `description` `status` `priority` `type` `due_date` `labels` `assigneeWorkerIds` |
| PATCH | `/elements/{id}` | Element を更新する | `title` `description` `status` `priority` `type` `due_date`（`null` で解除） `estimated_hours` `labels` |
| POST | `/elements/{id}/comments` | コメントする（201） | `body`（必須） |
| POST | `/elements/{id}/assignees` | Worker を担当にする | `workerId`（必須） |
| PUT | `/elements/{id}/labels` | ラベルを置き換える | `labels`（必須） |
| POST | `/elements/{id}/subelements` | Sub-element を足す（201） | `title`（必須） |
| PATCH | `/subelements/{id}` | Sub-element を完了（`done`）・再開（`todo`）する | `isCompleted`（省略で反転） |
| POST | `/elements/{id}/claim` | 着手を宣言する（lease を取る） | `branch` `session` |
| POST | `/elements/{id}/release` | lease を返す | `session` |
| POST | `/elements/{id}/progress` | 計画・進捗を報告する（201） | `title`（必須） `detail` `steps` `session` |
| POST | `/elements/{id}/outcome` | 作業を締めくくる（201） | `outcome`（必須。`completed / partial / blocked`） `summary`（必須） `message`（必須） `session` |

`{id}` は Element なら UUID か display_id（`ELE_PLT-006` など）、Strategy と Sub-element は UUID。GET の入力はクエリ文字列、それ以外は JSON の本文で渡す。`null` を渡せるのは `due_date`・`estimated_hours`・`description`（消す）だけ。ステータスは `backlog / todo / in_progress / review / done / blocked / cancelled`、優先度は `urgent / high / medium / low`、日付は `YYYY-MM-DD`。

Sub-element は、親の Element（`parent_id`）を持つ普通の Element で、親と同じ Object に入る。`/elements/{id}` の `subElements` に並び、それ自体も Element として読み書きできる。

削除、一括変更、Object 間の移動、Object の編集はできない（MCP と同じ）。見える範囲と書ける範囲は、アプリでの本人の権限（RLS）と同じ。担当にできるのは Element と同じ Space の Worker だけ。読み取りのみのトークンは GET だけが通る。着手・報告の4経路の振る舞いは [mcp.md](mcp.md) の「Element を進めるとき」と同じ。

## 応答

成功すると `{ "data": …, "meta": { "rows": … } }` を返す（`meta` はツールが返したときだけ付く）。失敗すると次のステータスと `{ "error": { "code", "message" } }` を返す。

| ステータス | code | いつ |
|---|---|---|
| 400 | `bad_request` | 本文が JSON のオブジェクトでない |
| 401 | `unauthorized` | トークンがない、無効、期限切れ、取り消し済み |
| 403 | `forbidden` | 読み取りのみのトークンで書き込んだ。書き込みを権限（RLS）が拒んだ。見えない Object・存在しない Object への Element の作成もここに入る |
| 404 | `not_found` | 経路がない。対象がない、または本人に見えない |
| 405 | `method_not_allowed` | そのパスにないメソッド（`Allow` ヘッダーに使えるもの） |
| 422 | `invalid_request` / `rejected` | 未知のフィールド、必須の欠落、型・選択肢の不一致。Alcon が受け付けなかった |
| 500 | `server_error` | サーバーの設定がない、または照会に失敗した |

見えない Element は 403 ではなく 404 になる。境界の外に何があるかは返さない。

## 例

```bash
export ALCON_TOKEN=alc_pat_…
export ALCON_API=https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/alcon-api
```

Object の未完了の Element を読む:

```bash
curl -s "$ALCON_API/elements?objectId=<Object の UUID>&status=todo" -H "Authorization: Bearer $ALCON_TOKEN"
```

Element を作る:

```bash
curl -s -X POST "$ALCON_API/elements" -H "Authorization: Bearer $ALCON_TOKEN" -H "Content-Type: application/json" -d '{"objectId":"<Object の UUID>","title":"週次レポートを送る","due_date":"2026-10-10"}'
```

ステータスを変えてコメントする:

```bash
curl -s -X PATCH "$ALCON_API/elements/ELE_PLT-006" -H "Authorization: Bearer $ALCON_TOKEN" -H "Content-Type: application/json" -d '{"status":"in_progress"}'
```

```bash
curl -s -X POST "$ALCON_API/elements/ELE_PLT-006/comments" -H "Authorization: Bearer $ALCON_TOKEN" -H "Content-Type: application/json" -d '{"body":"着手しました"}'
```

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy alcon-api --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```

`--no-verify-jwt` を付けるのは、トークンがない・無効な場合に、関数自身がこの API の形式の 401 を返すため。トークンの検証は関数の中で行う。`_shared/externalTools.ts` を変更したら `alcon-mcp` も、`_shared/boardTools.ts` を変更したら `alcon-mcp` も再デプロイする。`alcon-copilot` はツールなし JSON 応答だけの関数で、`_shared/attachments.ts` と `_shared/models.ts` にのみ依存する（チャットは run-agent が担う）。PAT を受け付けるには、Edge Function のシークレット `ALCON_JWT_SIGNING_KEY` が要る（[mcp.md](mcp.md) のデプロイを参照）。
