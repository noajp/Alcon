// A person's approval for a gateway's operation, asked for and used once
// (ADR 0047).
//
// The gateway asks before an operation that needs a person (sending a reply,
// moving money): which deployment and run, which connector and operation,
// the SHA-256 of the exact content, and a summary for the person. The
// request reaches the Space's owners in their Inbox. When the gateway is
// ready to send, it redeems the approval with the hash of what it is about to
// send; the database spends it once, and only for that hash, and this
// function signs the proof with Clayware's key. Content changed after the
// approval, a second use, an expired or a rejected approval get no proof.
//
// Request:  POST <JSON: { action: "request", ... } | { action: "redeem", approval_id, input_hash }>
//           x-clayware-gateway-key: <workflow_gateway_keys.id>
//           x-clayware-signature:   <base64url Ed25519 signature of the raw body>
// Response: request — 200 { status: requested | held, approval_id, expires_at } · 409 { status: refused, reason }
//           redeem  — 200 <ApprovalProof JSON>, x-clayware-signature: <signature of the raw body>
//                     202 { status: pending } · 409 { status: rejected | used | expired | mismatch | refused }
//           400 malformed · 401 no valid key or signature · 413 too large · 503 nothing decided — ask again
//
// Deployed without JWT verification: the signature is the authentication.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifySignature } from "../_shared/auditIntake.ts";
import { base64UrlEncode, loadSigningKey } from "../_shared/auditGrants.ts";
import { MAX_APPROVAL_BODY_BYTES, buildApprovalProof, parseApprovalCall, type Redeemed } from "../_shared/auditApprovals.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // One Clayware key signs both what the gateway may do (audit-grants) and what
  // a person approved; the proof's `kind` keeps the two apart.
  const signing = await loadSigningKey(Deno.env.get("AUDIT_GRANTS_SIGNING_KEY") ?? "");
  if (!url || !serviceKey || !signing) return json({ error: "approval signing is not configured" }, 500);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const keyId = req.headers.get("x-clayware-gateway-key") ?? req.headers.get("x-alcon-gateway-key") ?? "";
  const signature = req.headers.get("x-clayware-signature") ?? req.headers.get("x-alcon-signature") ?? "";
  if (!UUID.test(keyId) || !signature) return json({ error: "unauthorized" }, 401);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_APPROVAL_BODY_BYTES) return json({ error: "body too large" }, 413);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > MAX_APPROVAL_BODY_BYTES) return json({ error: "body too large" }, 413);

  // As at the intake: an unknown key, a revoked one and a bad signature all
  // answer the same.
  const keyRes = await fetch(
    `${url}/rest/v1/workflow_gateway_keys?id=eq.${keyId}&revoked_at=is.null&select=public_key`,
    { headers },
  );
  if (!keyRes.ok) return json({ error: "try again" }, 503);
  const [key] = await keyRes.json() as { public_key: string }[];
  if (!key || !(await verifySignature(key.public_key, signature, body))) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  const parsed = parseApprovalCall(raw);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const call = parsed.value;

  const rpc = (name: string, args: Record<string, unknown>) =>
    fetch(`${url}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(args) });

  if (call.action === "request") {
    const res = await rpc("workflow_approval_request", {
      _key_id: keyId, _request_id: call.request_id, _deployment_id: call.deployment_id,
      _run_external_id: call.run_external_id, _connector: call.connector, _operation: call.operation,
      _input_hash: call.input_hash, _summary: call.summary, _valid_minutes: call.valid_minutes,
    });
    if (!res.ok) return json({ error: "try again" }, 503);
    const outcome = await res.json() as { status: string; key_revoked?: boolean };
    if (outcome.key_revoked) return json({ error: "unauthorized" }, 401);
    return json(outcome, outcome.status === "refused" ? 409 : 200);
  }

  const res = await rpc("workflow_approval_redeem", { _key_id: keyId, _approval_id: call.approval_id, _input_hash: call.input_hash });
  if (!res.ok) return json({ error: "try again" }, 503);
  const outcome = await res.json() as { status: string; key_revoked?: boolean } & Partial<Redeemed>;
  if (outcome.key_revoked) return json({ error: "unauthorized" }, 401);
  if (outcome.status === "pending") return json(outcome, 202);
  if (outcome.status !== "redeemed") return json(outcome, 409);

  // Spent: this is the only time its proof is issued.
  const proof = buildApprovalProof(outcome as Redeemed, signing.publicKey);
  const proofBody = new TextEncoder().encode(JSON.stringify(proof));
  const sealed = await crypto.subtle.sign({ name: "Ed25519" }, signing.key, proofBody as BufferSource);
  return new Response(proofBody, {
    status: 200,
    headers: { "Content-Type": "application/json", "x-clayware-signature": base64UrlEncode(sealed), "Cache-Control": "no-store" },
  });
});
