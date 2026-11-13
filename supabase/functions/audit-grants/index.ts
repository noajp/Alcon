// The grants a gateway enforces, handed out signed (ADR 0046).
//
// Clayware holds the grants (deployment_grants, edited by the Space's owner in
// the Audit app); the gateway enforces them. The gateway asks with its
// Ed25519 key — the same key it sends records with (audit-intake) — and gets
// back the latest version of every deployment in that key's Space, signed
// with Clayware's own key. The gateway pins Clayware's public key at setup, so a
// table that did not come from Clayware is never enforced. Each table expires
// (GRANTS_TTL_SECONDS); past it the gateway stops send and money.
//
// Request:  POST (no body)
//           x-clayware-gateway-key: <workflow_gateway_keys.id>
//           x-clayware-timestamp:   <Unix seconds>
//           x-clayware-signature:   <base64url Ed25519 signature of grantsRequestText(key, timestamp)>
// Response: 200 <GrantsTable JSON>, x-clayware-signature: <base64url Ed25519 signature of the raw body>
//           401 no valid key, signature or timestamp
//           503 nothing decided — ask again
//
// Deployed without JWT verification: the signature is the authentication.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifySignature } from "../_shared/auditIntake.ts";
import {
  base64UrlEncode, buildGrantsTable, grantsRequestText, loadSigningKey, requestIsFresh, type DeploymentGrants,
} from "../_shared/auditGrants.ts";

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
  const signing = await loadSigningKey(Deno.env.get("AUDIT_GRANTS_SIGNING_KEY") ?? "");
  if (!url || !serviceKey || !signing) return json({ error: "grants signing is not configured" }, 500);
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  const keyId = req.headers.get("x-clayware-gateway-key") ?? req.headers.get("x-alcon-gateway-key") ?? "";
  const timestamp = req.headers.get("x-clayware-timestamp") ?? req.headers.get("x-alcon-timestamp") ?? "";
  const signature = req.headers.get("x-clayware-signature") ?? req.headers.get("x-alcon-signature") ?? "";
  if (!UUID.test(keyId) || !signature || !requestIsFresh(timestamp, Date.now())) return json({ error: "unauthorized" }, 401);

  // As at the intake: an unknown key, a revoked one and a bad signature all
  // answer the same.
  const keyRes = await fetch(
    `${url}/rest/v1/workflow_gateway_keys?id=eq.${keyId}&revoked_at=is.null&select=public_key`,
    { headers },
  );
  if (!keyRes.ok) return json({ error: "try again" }, 503);
  const [key] = await keyRes.json() as { public_key: string }[];
  const request = new TextEncoder().encode(grantsRequestText(keyId, timestamp));
  if (!key || !(await verifySignature(key.public_key, signature, request))) return json({ error: "unauthorized" }, 401);

  const res = await fetch(`${url}/rest/v1/rpc/workflow_grants_table`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _key_id: keyId }),
  });
  if (!res.ok) return json({ error: "try again" }, 503);
  const found = await res.json() as { space_id: string; deployments: DeploymentGrants[] } | null;
  // Revoked between the lookup and the read.
  if (!found) return json({ error: "unauthorized" }, 401);

  const table = buildGrantsTable({
    spaceId: found.space_id, keyId, signingKey: signing.publicKey, now: new Date(), deployments: found.deployments,
  });
  const body = new TextEncoder().encode(JSON.stringify(table));
  const sealed = await crypto.subtle.sign({ name: "Ed25519" }, signing.key, body as BufferSource);
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", "x-clayware-signature": base64UrlEncode(sealed), "Cache-Control": "no-store" },
  });
});
