// The pure half of audit-approvals (ADR 0047): what a gateway sends to ask
// for a person's approval and to use one, and the signed proof it gets back
// when it uses it. index.ts does the HTTP and the database; the gateway
// verifies the proof with `readApprovalProof` before it sends anything.

import { verifySignature } from "./auditIntake.ts";

/** How long a proof is good for after it is issued: the gateway sends right
 * after redeeming, so a proof is never held for later. */
export const APPROVAL_PROOF_TTL_SECONDS = 10 * 60;
export const MAX_APPROVAL_BODY_BYTES = 16_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ID = /^[A-Za-z0-9._:-]{1,200}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const OPERATIONS = new Set(["read", "draft", "send", "money"]);
// Text the database cannot hold: NUL, and a surrogate without its pair.
const UNSTORABLE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export type ApprovalCall =
  | {
    action: "request";
    request_id: string;
    deployment_id: string;
    run_external_id: string;
    connector: string;
    operation: string;
    /** SHA-256 (lowercase hex) of the exact bytes the gateway will send. */
    input_hash: string;
    /** What the person reads to decide — never the document itself. */
    summary: string;
    /** How long the request may be decided and used, 5 to 1440 minutes. */
    valid_minutes: number | null;
  }
  | { action: "redeem"; approval_id: string; input_hash: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !UNSTORABLE.test(v);

/** The call's shape, every field checked; nothing is coerced. */
export function parseApprovalCall(raw: unknown): { ok: true; value: ApprovalCall } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "body is not an object" };
  if (raw.action === "redeem") {
    if (typeof raw.approval_id !== "string" || !UUID.test(raw.approval_id)) return { ok: false, error: "approval_id is not a uuid" };
    if (typeof raw.input_hash !== "string" || !HEX64.test(raw.input_hash)) return { ok: false, error: "input_hash is not 64 lowercase hex" };
    return { ok: true, value: { action: "redeem", approval_id: raw.approval_id, input_hash: raw.input_hash } };
  }
  if (raw.action !== "request") return { ok: false, error: "action is not request or redeem" };
  const { request_id, deployment_id, run_external_id, connector, operation, input_hash, summary, valid_minutes } = raw;
  if (typeof request_id !== "string" || !ID.test(request_id)) return { ok: false, error: "request_id is missing or malformed" };
  if (typeof deployment_id !== "string" || !UUID.test(deployment_id)) return { ok: false, error: "deployment_id is not a uuid" };
  if (typeof run_external_id !== "string" || !ID.test(run_external_id)) return { ok: false, error: "run_external_id is missing or malformed" };
  if (!text(connector, 200)) return { ok: false, error: "connector is missing or malformed" };
  if (typeof operation !== "string" || !OPERATIONS.has(operation)) return { ok: false, error: "operation is not one of read, draft, send, money" };
  if (typeof input_hash !== "string" || !HEX64.test(input_hash)) return { ok: false, error: "input_hash is not 64 lowercase hex" };
  if (!text(summary, 2000)) return { ok: false, error: "summary is missing or longer than 2000 characters" };
  if (valid_minutes !== undefined && valid_minutes !== null && !(Number.isInteger(valid_minutes) && (valid_minutes as number) >= 5 && (valid_minutes as number) <= 1440)) {
    return { ok: false, error: "valid_minutes is not an integer from 5 to 1440" };
  }
  return {
    ok: true,
    value: {
      action: "request", request_id, deployment_id, run_external_id, connector: connector as string, operation, input_hash,
      summary: summary as string, valid_minutes: (valid_minutes as number | null | undefined) ?? null,
    },
  };
}

/** What the database hands back when an approval is spent. */
export interface Redeemed {
  approval_id: string;
  space_id: string;
  deployment_id: string;
  run_external_id: string;
  connector: string;
  operation: string;
  input_hash: string;
  approved_by: string | null;
  approved_at: string;
  used_at: string;
}

export interface ApprovalProof {
  kind: "alcon.approval";
  approval_id: string;
  space_id: string;
  deployment_id: string;
  run_external_id: string;
  connector: string;
  operation: string;
  input_hash: string;
  approved_by: string | null;
  approved_at: string;
  issued_at: string;
  expires_at: string;
  /** Alcon's public key the proof is signed with (base64url, 43 chars). */
  signing_key: string;
}

/** The proof for a spent approval. Issued once, at the moment it is spent. */
export function buildApprovalProof(redeemed: Redeemed, signingKey: string): ApprovalProof {
  const issued = new Date(redeemed.used_at);
  return {
    kind: "alcon.approval",
    approval_id: redeemed.approval_id,
    space_id: redeemed.space_id,
    deployment_id: redeemed.deployment_id,
    run_external_id: redeemed.run_external_id,
    connector: redeemed.connector,
    operation: redeemed.operation,
    input_hash: redeemed.input_hash,
    approved_by: redeemed.approved_by,
    approved_at: redeemed.approved_at,
    issued_at: issued.toISOString(),
    expires_at: new Date(issued.getTime() + APPROVAL_PROOF_TTL_SECONDS * 1000).toISOString(),
    signing_key: signingKey,
  };
}

/**
 * The proof a gateway received, if it is Alcon's signature under the pinned
 * key, for the approval the gateway redeemed, for exactly the content it is
 * about to send — and the deployment, connector and operation it is about to
 * use — and not expired. Anything else and the gateway does not send.
 */
export async function readApprovalProof(
  pinnedKey: string, signature: string, body: Uint8Array,
  expect: { approvalId: string; inputHash: string; deploymentId: string; connector: string; operation: string; nowMs: number },
): Promise<ApprovalProof | null> {
  if (!(await verifySignature(pinnedKey, signature, body))) return null;
  let proof: ApprovalProof;
  try {
    proof = JSON.parse(new TextDecoder().decode(body)) as ApprovalProof;
  } catch {
    return null;
  }
  if (proof?.kind !== "alcon.approval" || proof.approval_id !== expect.approvalId || proof.input_hash !== expect.inputHash) return null;
  if (proof.deployment_id !== expect.deploymentId || proof.connector !== expect.connector || proof.operation !== expect.operation) return null;
  if (!(Date.parse(proof.expires_at) > expect.nowMs)) return null;
  return proof;
}
