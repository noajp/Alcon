// The pure half of audit-grants (ADR 0046): how a gateway asks for its
// grants, what the signed table it receives looks like, and how it decides
// an operation from that table. index.ts does the HTTP and the database; the
// gateway runs `decideOperation` (or its own copy of it) before every
// operation, so this file is its reference.

import { base64UrlDecode, verifySignature } from "./auditIntake.ts";

/** How long a table is good for. Past it, send and money stop until a fresh
 * one arrives; read and draft go on with the last table held. The intake
 * judges stale sends by the same span (workflow_step_outside_grant). */
export const GRANTS_TTL_SECONDS = 15 * 60;
/** How far a request's timestamp may sit from Alcon's clock. */
export const REQUEST_SKEW_SECONDS = 5 * 60;

export type GrantOperation = "read" | "draft" | "send" | "money";
export type Operation = GrantOperation | "none";

export interface Grant {
  connector: string;
  operation: GrantOperation;
}

export interface DeploymentGrants {
  deployment_id: string;
  state: "trial" | "live" | "paused";
  /** 0 until the deployment is first granted anything. */
  version: number;
  grants: Grant[];
}

export interface GrantsTable {
  kind: "alcon.grants";
  space_id: string;
  key_id: string;
  /** Alcon's public key the table is signed with (base64url, 43 chars). */
  signing_key: string;
  issued_at: string;
  expires_at: string;
  deployments: DeploymentGrants[];
}

/** What the gateway signs to ask for its table: no body, so the request is
 * the key and the moment, and an old request cannot be replayed for long. */
export function grantsRequestText(keyId: string, timestamp: string): string {
  return `alcon-grants\n${keyId}\n${timestamp}`;
}

/** Whether a request timestamp (Unix seconds) is close enough to now. */
export function requestIsFresh(timestamp: string, nowMs: number): boolean {
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  return Math.abs(Number(timestamp) - nowMs / 1000) <= REQUEST_SKEW_SECONDS;
}

export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return btoa(String.fromCharCode(...view)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Alcon's signing key from its secret (PKCS #8, base64url), with the public
 * half the table names. */
export async function loadSigningKey(pkcs8: string): Promise<{ key: CryptoKey; publicKey: string } | null> {
  const bytes = base64UrlDecode(pkcs8);
  if (!bytes) return null;
  try {
    const key = await crypto.subtle.importKey("pkcs8", bytes as BufferSource, { name: "Ed25519" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    if (!jwk.x) return null;
    return { key, publicKey: jwk.x };
  } catch {
    return null;
  }
}

/** The table as it is sent: the deployments in id order, each one's grants
 * sorted, so the same grants always read as the same bytes. */
export function buildGrantsTable(input: {
  spaceId: string; keyId: string; signingKey: string; now: Date; deployments: DeploymentGrants[];
}): GrantsTable {
  const order = (a: Grant, b: Grant) => a.connector < b.connector ? -1 : a.connector > b.connector ? 1 : a.operation < b.operation ? -1 : a.operation > b.operation ? 1 : 0;
  return {
    kind: "alcon.grants",
    space_id: input.spaceId,
    key_id: input.keyId,
    signing_key: input.signingKey,
    issued_at: input.now.toISOString(),
    expires_at: new Date(input.now.getTime() + GRANTS_TTL_SECONDS * 1000).toISOString(),
    deployments: [...input.deployments]
      .sort((a, b) => a.deployment_id < b.deployment_id ? -1 : a.deployment_id > b.deployment_id ? 1 : 0)
      .map((d) => ({ ...d, grants: [...d.grants].sort(order) })),
  };
}

/**
 * The table a gateway received, if `signature` is Alcon's signature of
 * `body` under the key the gateway pinned, the table is for this gateway's
 * key, and it is not older than the one the gateway already holds — so an
 * old signed table replayed at the gateway cannot roll its grants back. The
 * gateway pins Alcon's public key when it is set up, and never takes it from
 * the table itself.
 */
export async function readGrantsTable(
  pinnedKey: string, signature: string, body: Uint8Array, expect: { keyId: string; held: GrantsTable | null },
): Promise<GrantsTable | null> {
  if (!(await verifySignature(pinnedKey, signature, body))) return null;
  let table: GrantsTable;
  try {
    table = JSON.parse(new TextDecoder().decode(body)) as GrantsTable;
  } catch {
    return null;
  }
  if (table?.kind !== "alcon.grants" || !Array.isArray(table.deployments) || table.key_id !== expect.keyId) return null;
  const issued = Date.parse(table.issued_at);
  if (Number.isNaN(issued)) return null;
  if (expect.held && (table.space_id !== expect.held.space_id || issued < Date.parse(expect.held.issued_at))) return null;
  return table;
}

export type Decision =
  | { allowed: true; grants_version: number | null }
  | { allowed: false; grants_version: number | null; reason: "no table" | "unknown deployment" | "paused" | "expired" | "outside grant" };

/**
 * Whether the gateway may perform an operation, from the last table it
 * holds. The safe side wins: no table, an unknown deployment or a paused one
 * allow nothing; an expired table still allows read and draft but not send
 * or money. The version goes on the step the gateway records, allowed or not
 * — a refused attempt is recorded as blocked. The intake marks a step
 * outside the grants only when that version leaves the operation out; a
 * refusal for a paused deployment or an expired table is blocked but inside
 * them.
 */
export function decideOperation(table: GrantsTable | null, nowMs: number, deploymentId: string, connector: string | null, operation: Operation): Decision {
  const deployment = table?.deployments.find((d) => d.deployment_id === deploymentId);
  const version = deployment?.version ?? null;
  if (operation === "none") return { allowed: true, grants_version: version };
  if (!table) return { allowed: false, grants_version: null, reason: "no table" };
  if (!deployment) return { allowed: false, grants_version: null, reason: "unknown deployment" };
  if (deployment.state === "paused") return { allowed: false, grants_version: version, reason: "paused" };
  const expired = !(Date.parse(table.expires_at) > nowMs);
  if (expired && (operation === "send" || operation === "money")) return { allowed: false, grants_version: version, reason: "expired" };
  if (!connector || !deployment.grants.some((g) => g.connector === connector && g.operation === operation)) {
    return { allowed: false, grants_version: version, reason: "outside grant" };
  }
  return { allowed: true, grants_version: version };
}
