# Alcon asset relay — 中継連結基盤

ローカルで動くアプリや AI が、バックエンドの一行で Space に名乗り出て、承諾された時点で「資産」として認識され、以後の活動が Space に残る受け口。設計の判断は [ADR 0036](adr/0036-shadow-apps-join-a-space-by-announcing-through-the-asset-relay.md)、一行の SDK は [sdk/README.md](../sdk/README.md)。

- エンドポイント: `https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/asset-relay`
- 名乗り（`/hello`）は認証なし。以後は `Authorization: Bearer <資産トークン>`（`alc_ast_…`。名乗りの応答で一度だけ返る）
- 画面: Settings › Integrations › Connected assets（受け口の URL と Space の id の表示、承諾・取り消し、活動の一覧）

## 流れ

1. アプリが `POST /hello { space, name, kind?, manifest? }` で名乗る。応答で `asset_id` と `token` を受け取る。資産は `unclaimed`
2. Space のオーナーの Inbox に「… is asking to join this Space」が届く。Connected assets で内容（自己申告と観測）を見て **Accept** する。資産は `active`
3. アプリは `POST /events` で出来事を送る。承諾前の出来事も残るが、画面では未確認として示す
4. オーナーが **Revoke** すると `revoked`。次の呼び出しから 403。記録は残る

## 経路

| メソッド | パス | 認証 | 内容 |
|---|---|---|---|
| GET | `/` | — | 受け口の説明 |
| POST | `/hello` | — | 名乗り。`space`（Space の id、必須）`name`（必須）`kind`（`app` / `ai_agent` / `script` / `service` / `other`）`manifest`（16KB まで）。201 で `{ asset_id, token, status }`。`token` を同梱した名乗りは再起動の報告で、manifest を更新して 200 `{ asset_id, status }` |
| POST | `/events` | Bearer | `{ events: [{ kind, summary, payload?, occurred_at? }] }`（1 回 50 件、payload は 8KB まで）か、出来事 1 件。200 `{ recorded, status }` |
| GET | `/status` | Bearer | `{ asset_id, name, status, space, claimed_at }` |

エラーは `{ "error": { "code", "message" } }`。400（形が違う）、401（トークンが不明）、403（取り消し済み）、404（Space が無い）、413（大きすぎる）、429（その Space の未承諾の資産が 100 件を超えている）、500。

## データ

| 表 / 関数 | 内容 |
|---|---|
| `assets` | 名前・種類・状態（`unclaimed` / `active` / `revoked`）・`manifest`（自己申告）・`observed`（受け口が見たもの）・トークンのハッシュと先頭・承諾した人と日時・最終確認・出来事の件数。メンバーは読める（ハッシュを除く） |
| `asset_events` | `kind` / `summary` / `payload` / `occurred_at`。メンバーは読める |
| `announce_asset` / `resolve_asset_token` / `touch_asset` / `record_asset_events` | service role だけが呼ぶ。関数が使う |
| `accept_asset` / `revoke_asset` | Space のオーナーが呼ぶ |

名乗りは Space のオーナーに `notifications.kind = 'asset_announced'` で届く。

## 配置

migration を先に適用し、関数は `--no-verify-jwt` で配置する（トークンは関数が自分で確かめる）。

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy asset-relay --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```

必要な秘密は `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` だけ（Edge Functions に既定で入る）。

## 試す

```bash
RELAY=https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/asset-relay
curl -sS -X POST "$RELAY/hello" -H 'content-type: application/json' \
  -d '{"space":"<Space の id>","name":"kessan-terminal","kind":"app","manifest":{"runtime":"node 22"}}'
# → {"asset_id":"…","token":"alc_ast_…","status":"unclaimed",…}
curl -sS -X POST "$RELAY/events" -H "authorization: Bearer alc_ast_…" -H 'content-type: application/json' \
  -d '{"kind":"closed-books","summary":"Q3 closed","payload":{"fy":2026}}'
```
