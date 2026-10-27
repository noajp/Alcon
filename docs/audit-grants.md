# 権限表の配布（audit-grants）

ゲートウェイ（Metaxy の実行基盤）が守る権限を、Alcon から受け取るための口。設計の判断は [ADR 0046](adr/0046-grants-are-decided-in-alcon-and-handed-to-the-gateway-signed.md)。記録の送り方は [audit-intake](audit-intake.md)。

## 権限を決める

Space のオーナーが、Audit → ワークフロー → 「権限」タブで、接続ごとに 読む・下書き・送信・お金 を許可する。変えるたびに導入の版が1つ進む。委任トークン・OAuth・service role からは変えられない。

## 受け取り方

ゲートウェイは記録を送るのと同じ鍵で要求する。本文はない。

```
POST https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/audit-grants
x-alcon-gateway-key: <鍵 id>
x-alcon-timestamp:   <Unix 秒>
x-alcon-signature:   <"alcon-grants\n<鍵 id>\n<Unix 秒>" への Ed25519 署名、base64url>
```

時刻は Alcon の時計から5分以内。返事は次の本文と、本文のバイト列への Alcon の署名（`x-alcon-signature`）。

```json
{
  "kind": "alcon.grants",
  "space_id": "<uuid>",
  "key_id": "<鍵 id>",
  "signing_key": "<Alcon の公開鍵>",
  "issued_at": "2026-10-28T09:00:00.000Z",
  "expires_at": "2026-10-28T09:15:00.000Z",
  "deployments": [
    { "deployment_id": "<uuid>", "state": "live", "version": 3,
      "grants": [{ "connector": "Gmail", "operation": "read" }, { "connector": "Gmail", "operation": "send" }] }
  ]
}
```

| 状態 | 意味 |
|---|---|
| 200 | 権限表。署名を確かめてから使う |
| 401 | 鍵が未登録・失効済み、署名が違う、または時刻がずれている |
| 503 | 何も決めていない。少し待って取り直す |
| 500 | Alcon 側で署名鍵が設定されていない |

## ゲートウェイが守ること

- 本文の署名は、導入時に固定した Alcon の公開鍵で確かめる。本文の `signing_key` は鍵の差し替えに気づくための表示で、検証には使わない
- `key_id`・`space_id` が自分のものでない表、手元の表より `issued_at` が古い表は捨てる（古い署名済みの表を差し込まれて、新しい表を巻き戻されないため）
- 操作のたびに、手元の最新の表で判断する（参照実装は `supabase/functions/_shared/auditGrants.ts` の `decideOperation`）
  - 表がない・導入が表にない・導入が `paused` → 何もしない
  - `expires_at` を過ぎた → 送信とお金は止め、読む・下書きは続ける
  - 表にない接続と操作 → 止める
- 期限の前（目安は5分ごと）に取り直す
- 止めた操作も `result: "blocked"` で記録し、行った操作も止めた操作も、判断に使った `version` を記録の `grants_version` に入れる

## Alcon の署名鍵

署名鍵は関数の秘密 `AUDIT_GRANTS_SIGNING_KEY`（Ed25519 の秘密鍵、PKCS #8 DER を base64url）に置く。作り方と設定のしかた：

```bash
node -e 'const k=require("crypto").generateKeyPairSync("ed25519");require("fs").writeFileSync("grants.env","AUDIT_GRANTS_SIGNING_KEY="+k.privateKey.export({format:"der",type:"pkcs8"}).toString("base64url")+"\n",{mode:0o600});console.log(k.publicKey.export({format:"jwk"}).x)'
env -u SUPABASE_ACCESS_TOKEN supabase secrets set --env-file grants.env --project-ref rkugtcqztkkacvoylupw && rm grants.env
```

1行目が表示する公開鍵を、ゲートウェイの設定に固定する。

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy audit-grants --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```
