// Who is calling, and with what client (ADR 0032).
//
//   alc_pat_…   a personal access token. Hashed and resolved with the service
//               role (resolve_personal_access_token — that lookup and nothing
//               else), then exchanged for a five-minute JWT for its owner.
//               The returned client carries that JWT, so RLS applies exactly
//               as in the app. The token's access ('read' / 'read_write')
//               decides which tools the caller is offered.
//   other       a Supabase session JWT, verified with auth.getUser and used
//               as is (the path alcon-mcp has always had).
//
// The service role never reaches board data here. Without
// ALCON_JWT_SIGNING_KEY a PAT is refused with 500 "server not configured"
// before any lookup; session JWTs keep working.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  bearerToken, DelegatedAuthNotConfigured, isPersonalAccessToken, isWellFormedPersonalAccessToken,
  mintUserJwt, parseSigningKey, sha256Hex,
} from "./delegatedAuth.ts";

export type CallerAccess = "read" | "read_write";
export type CallerVia = "session" | "pat";

export interface Caller {
  userId: string;
  /** The personal access token's name for via 'pat'; null for a session. */
  label: string | null;
  via: CallerVia;
  access: CallerAccess;
  /** A client that runs as the caller (RLS applies). */
  db: SupabaseClient;
}

export type CallerAuthResult =
  | { ok: true; caller: Caller }
  | { ok: false; status: 401 | 500; error: string; detail: string };

const INVALID_PAT = "token is invalid, expired or revoked";

function unauthorized(detail: string): CallerAuthResult {
  return { ok: false, status: 401, error: "unauthorized", detail };
}

function notConfigured(detail = "server not configured"): CallerAuthResult {
  return { ok: false, status: 500, error: "server not configured", detail };
}

function userClient(url: string, anonKey: string, jwt: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Authenticates the request's bearer token. `client` is the name the caller
 * goes by (e.g. "Claude Code"); it is stored as the token's last client.
 */
export async function authenticateCaller(req: Request, opts: { client?: string } = {}): Promise<CallerAuthResult> {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) return notConfigured("server env not configured");

  const token = bearerToken(req.headers.get("Authorization"));
  if (!token) return unauthorized("missing bearer token");

  if (isPersonalAccessToken(token)) return await viaPersonalAccessToken(token, url, anonKey, opts.client ?? null);

  // ELE_PLT-004 (OAuth) branches here: an access token issued to a registered
  // client is a JWT whose payload carries `client_id`. Verify the grant (the
  // client is still authorised, the grant is not revoked), then mint with
  // mintUserJwt({ userId, via: "oauth", clientId }) or pass it through, and
  // report via "oauth" so the Activity names the client. Until then such a
  // JWT is treated as the session it is.
  return await viaSession(token, url, anonKey);
}

async function viaSession(token: string, url: string, anonKey: string): Promise<CallerAuthResult> {
  const db = userClient(url, anonKey, token);
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return unauthorized("token is invalid or expired");
  return { ok: true, caller: { userId: user.id, label: null, via: "session", access: "read_write", db } };
}

async function viaPersonalAccessToken(token: string, url: string, anonKey: string, client: string | null): Promise<CallerAuthResult> {
  if (!isWellFormedPersonalAccessToken(token)) return unauthorized(INVALID_PAT);
  // Fail closed before the lookup, so a misconfigured function neither
  // accepts tokens nor marks them used.
  const rawKey = Deno.env.get("ALCON_JWT_SIGNING_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!parseSigningKey(rawKey) || !serviceKey) return notConfigured();

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("resolve_personal_access_token", {
    p_hash: await sha256Hex(token),
    p_client: client,
  });
  if (error) {
    console.error("[callerAuth] token lookup failed", error.message);
    return { ok: false, status: 500, error: "token lookup failed", detail: "token lookup failed" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { user_id: string; id: string; name: string; access: string }
    | null
    | undefined;
  if (!row?.user_id) return unauthorized(INVALID_PAT);

  let jwt: string;
  try {
    jwt = await mintUserJwt({ userId: row.user_id, via: "pat", patId: row.id }, rawKey);
  } catch (e) {
    if (e instanceof DelegatedAuthNotConfigured) return notConfigured();
    console.error("[callerAuth] could not mint a user token", e instanceof Error ? e.message : String(e));
    return notConfigured("could not sign a user token");
  }
  return {
    ok: true,
    caller: {
      userId: row.user_id,
      label: row.name,
      via: "pat",
      // Anything but an explicit read_write is read-only.
      access: row.access === "read_write" ? "read_write" : "read",
      db: userClient(url, anonKey, jwt),
    },
  };
}
