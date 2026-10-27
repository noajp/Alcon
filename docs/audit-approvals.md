# 承認の依頼と証明（audit-approvals）

ゲートウェイ（Metaxy の実行基盤）が、人の判断が要る操作の前に承認を求め、送る直前にその承認を1回だけ使うための口。設計の判断は [ADR 0047](adr/0047-approvals-are-bound-to-the-content-and-spent-once-when-the-proof-is-issued.md)。鍵と署名は [audit-intake](audit-intake.md)、Alcon の公開鍵は [audit-grants](audit-grants.md) と同じ。

## 送り方

本文は JSON。記録を送るのと同じ鍵で、生の本文に署名する。

```
POST https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/audit-approvals
x-alcon-gateway-key: <鍵 id>
x-alcon-signature:   <生の本文バイト列への Ed25519 署名、base64url>
```

### 1. 依頼する

```json
{ "action": "request", "request_id": "appr-000123", "deployment_id": "<uuid>", "run_external_id": "PO-1042",
  "connector": "Gmail", "operation": "send", "input_hash": "<送る内容の SHA-256、小文字16進>",
  "summary": "PO-1042 の納期回答を ACME 商事に送る", "valid_minutes": 1440 }
```

- `input_hash` は、ゲートウェイが実際に送るバイト列の SHA-256。内容が1バイトでも変われば別の承認が要る
- `summary` は判断する人が読む文（2000字まで）。書類の中身は入れない
- `valid_minutes` は判断と使用の期限（5〜1440分、省略時は1440）
- 同じ `request_id` を送り直すと、同じ依頼が返る（`held`）。同じ id で中身が違えば拒否される。新しく依頼し直すとき（`mismatch`・`used`・`expired`・応答の取りこぼしのあと）は、新しい `request_id` を使う
- 依頼は Space のオーナーの Inbox に届く

### 2. 引き換える（送る直前）

```json
{ "action": "redeem", "approval_id": "<依頼で返った id>", "input_hash": "<これから送る内容の SHA-256>" }
```

| 状態 | 意味 | ゲートウェイがすること |
|---|---|---|
| 200 | 承認を消費した。本文が証明、`x-alcon-signature` がその署名 | 証明を確かめてから送る |
| 202 `pending` | まだ判断されていない | 待って引き換え直す |
| 409 `rejected` | 却下された（`note` に理由） | 送らない |
| 409 `mismatch` | 送ろうとしている内容が承認された内容と違う。消費していない | 送らない。新しく依頼する |
| 409 `used` | もう使われた | 送らない |
| 409 `expired` | 期限切れ | 送らない。新しく依頼する |
| 409 `refused` | 承認がない、または別の鍵が依頼したもの | 送らない |
| 400 / 401 / 413 / 503 | 本文の形が違う / 鍵か署名が違う / 16KB を超えた / 何も決めていない | 直す / 鍵を確かめる / 縮める / 引き換え直す |

証明は消費した時に1回だけ発行される。応答を受け取れなかったときは、その承認はもう使えないので、新しい `request_id` で依頼し直す。引き換えられるのは依頼した鍵だけ。

```json
{ "kind": "alcon.approval", "approval_id": "<uuid>", "space_id": "<uuid>", "deployment_id": "<uuid>",
  "run_external_id": "PO-1042", "connector": "Gmail", "operation": "send", "input_hash": "<…>",
  "approved_by": "<判断した人の名前>", "approved_at": "…", "issued_at": "…", "expires_at": "<issued_at の10分後>",
  "signing_key": "<Alcon の公開鍵>" }
```

## ゲートウェイが守ること

- 証明の署名を、導入時に固定した Alcon の公開鍵で確かめる（権限表と同じ鍵。`kind` が `alcon.approval` でないものは証明ではない）
- `approval_id`・`input_hash`・`deployment_id`・`connector`・`operation` が、引き換えたものとこれから行う操作と一致し、`expires_at` 前であることを確かめてから送る（参照実装は `supabase/functions/_shared/auditApprovals.ts` の `readApprovalProof`）
- 承認の結果は、記録（[audit-intake](audit-intake.md)）の `kind: "approval"` の手順として残す

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy audit-approvals --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```
