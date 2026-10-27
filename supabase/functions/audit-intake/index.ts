// The intake for the AI audit ledger (ADR 0045).
//
// A gateway (the execution side that holds the customer's credentials) sends
// what happened at each joint of a run, in batches from its outbox. Writing
// the ledger needs the service role; the gateway holds only an Ed25519 key
// registered to one Space, so a leaked key can append to that Space's ledger
// and nothing else, and a revoked key nothing at all.
//
// Request:  POST <batch JSON> (shape: _shared/auditIntake.ts)
//           x-alcon-gateway-key: <workflow_gateway_keys.id>
//           x-alcon-signature:   <base64url Ed25519 signature of the raw body>
// Response: 200 { status: accepted | duplicate, runs_added, steps_added }
//           409 { status: rejected, reason }  — nothing from the batch was written
//           400 / 401 / 413 for a request that is not a readable, signed batch
//
// Deployed without JWT verification: the signature is the authentication.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  MAX_BODY_BYTES, batchChainProblem, parseBatch, sha256Hex, verifySignature,
} from "../_shared/auditIntake.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "supabase env missing" }, 500);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const keyId = req.headers.get("x-alcon-gateway-key") ?? "";
  const signature = req.headers.get("x-alcon-signature") ?? "";
  if (!UUID.test(keyId) || !signature) return json({ error: "unauthorized" }, 401);

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "batch too large" }, 413);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_BODY_BYTES) return json({ error: "batch too large" }, 413);

  // An unknown key, a revoked one and a bad signature all answer the same,
  // so the response does not tell a prober which key ids exist.
  const keyRes = await fetch(
    `${url}/rest/v1/workflow_gateway_keys?id=eq.${keyId}&revoked_at=is.null&select=public_key`,
    { headers },
  );
  if (!keyRes.ok) return json({ error: "key lookup failed" }, 502);
  const [key] = await keyRes.json() as { public_key: string }[];
  if (!key || !(await verifySignature(key.public_key, signature, body))) {
    return json({ error: "unauthorized" }, 401);
  }

  // From here the sender is a registered gateway, so every rejection is kept
  // where the Space's owner can read it.
  const bodyDigest = await sha256Hex(body);
  const reject = async (batchId: string, reason: string) => {
    await fetch(`${url}/rest/v1/rpc/workflow_intake_reject`, {
      method: "POST",
      headers,
      body: JSON.stringify({ _key_id: keyId, _batch_id: batchId, _body_digest: bodyDigest, _reason: reason }),
    });
    return json({ status: "rejected", reason }, 409);
  };

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return reject("(unreadable)", "body is not JSON");
  }
  const parsed = parseBatch(raw);
  const batchId = typeof (raw as { batch_id?: unknown })?.batch_id === "string"
    ? String((raw as { batch_id: string }).batch_id).slice(0, 200)
    : "(unreadable)";
  if (!parsed.ok) return reject(batchId, parsed.error);

  const chainProblem = await batchChainProblem(parsed.value.steps);
  if (chainProblem) return reject(parsed.value.batch_id, chainProblem);

  const res = await fetch(`${url}/rest/v1/rpc/workflow_intake`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      _key_id: keyId,
      _batch_id: parsed.value.batch_id,
      _body_digest: bodyDigest,
      _runs: parsed.value.runs,
      _steps: parsed.value.steps,
    }),
  });
  if (!res.ok) return json({ error: `intake failed: ${await res.text()}` }, 502);
  const outcome = await res.json() as { status: string; reason?: string };
  return json(outcome, outcome.status === "rejected" ? 409 : 200);
});
