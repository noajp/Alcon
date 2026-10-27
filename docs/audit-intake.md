# 記録の受け口（audit-intake）

ゲートウェイ（Metaxy の実行基盤）が、関節で残した記録を Alcon の監査台帳へ送るための口。設計の判断は [ADR 0045](adr/0045-the-audit-intake-takes-signed-batches-that-continue-the-gateways-chain.md)、台帳そのものは [ADR 0044](adr/0044-the-ai-audit-ledger-keeps-records-without-documents.md)。

## 鍵の登録

ゲートウェイは Ed25519 の鍵ペアを作り、公開鍵（生の32バイトを base64url・パディングなし、43文字）を Space のオーナーが `workflow_gateway_keys` に登録する。返る `id` がゲートウェイの鍵 id。鍵を替えるときは新しく登録し、古い鍵は `revoked_at` を入れて失効させる。

## 送り方

```
POST https://rkugtcqztkkacvoylupw.supabase.co/functions/v1/audit-intake
x-alcon-gateway-key: <鍵 id>
x-alcon-signature:   <生の本文バイト列への Ed25519 署名、base64url>
Content-Type: application/json
```

```json
{
  "batch_id": "outbox-000123",
  "runs": [
    { "deployment_id": "<uuid>", "external_id": "PO-1042", "template_version": 1,
      "subject_ref": "PO-1042", "subject_digest": "<鍵つきダイジェスト>", "started_at": "2026-10-27T01:02:03.000000Z" }
  ],
  "steps": [
    { "deployment_id": "<uuid>", "event_id": "ev-0001", "run_external_id": "PO-1042",
      "step_key": "read_order", "kind": "start", "connector": "mail", "operation": "read", "result": "ok",
      "actor_kind": "ai_agent", "actor_name": "受注係", "reason": null,
      "occurred_at": "2026-10-27T01:02:03.123456Z", "duration_ms": 420,
      "prev_digest": "<前の記録の digest。導入の最初は 0 が64個>", "digest": "<この記録の digest>" }
  ]
}
```

- 時刻は `YYYY-MM-DDTHH:MM:SS.ffffffZ`（UTC・マイクロ秒6桁）だけを受け付ける
- `kind` は start / step / approval / exception / end、`operation` は read / draft / send / money / none、`result` は ok / failed / blocked / waiting / approved / returned、`actor_kind` は ai_agent / human / system
- `steps` は導入ごとに鎖の順に並べる。手順が指す実行は、同じまとめの `runs` か、前に送ったまとめに含める
- `digest` は、次のフィールドをこの順に「UTF-8 のバイト長 + `:` + 値」（null は空文字）で連結した文字列の SHA-256（小文字16進）：`prev_digest, deployment_id, event_id, run_external_id, step_key, kind, connector, operation, result, actor_kind, actor_name, reason, occurred_at, duration_ms`。参照実装は `supabase/functions/_shared/auditIntake.ts` の `eventDigest`
- 1回のまとめは 1000 件・1MB まで

## 返事

| 状態 | 意味 | ゲートウェイがすること |
|---|---|---|
| 200 `accepted` | 書き込んだ（`runs_added` / `steps_added`） | 箱から消す |
| 200 `duplicate` | 同じまとめを受け入れ済み。何も書いていない | 箱から消す |
| 409 `rejected` | 何も書いていない。`reason` に理由 | 送り直しても通らない。鎖の切れ目なら、抜けた記録から送り直す |
| 401 | 鍵が未登録・失効済み、または署名が違う | 鍵を確かめる |
| 400 / 413 / 502 | 読めない要求・大きすぎる・一時的な失敗 | 502 は同じ `batch_id` で送り直す |

署名の通ったまとめは、受け入れも拒否も `workflow_intake_batches` に残る。

## デプロイ

```bash
env -u SUPABASE_ACCESS_TOKEN supabase functions deploy audit-intake --project-ref rkugtcqztkkacvoylupw --no-verify-jwt --use-api
```

`--no-verify-jwt` を付けるのは、ゲートウェイが JWT を持たず、署名で認証するため。
