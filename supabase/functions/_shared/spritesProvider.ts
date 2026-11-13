// The Sprites provider client (coding capability PR1): a thin REST
// client over the documented Sprites API (https://api.sprites.dev),
// behind workspaces.ts' WorkspaceProvider seam. No SDK dependency —
// the Edge runtime has fetch, and the operations the governed path
// needs are five:
//
//   create    POST   /v1/sprites                                  { name, labels }
//   destroy   DELETE /v1/sprites/{name}                           (204; 404 = already gone)
//   policy    POST   /v1/sprites/{name}/policy/network            { rules: [{ domain, action }] } → 204
//   writeFile PUT    /v1/sprites/{name}/fs/write?path=…&workingDir=/&mkdirParents=true[&mode=…]
//   service   PUT    /v1/sprites/{name}/services/{service}?duration=5s   { cmd, args }
//
// Auth is a Bearer token from the environment (SPRITES_API_TOKEN —
// the name the provider's own tooling uses; SPRITES_API_URL
// overrides the base URL the same way). The token is a server-side
// function secret: it is read from env, sent only to the provider,
// and never lands in a record, a step, or an error message. When it
// is absent the provider does not exist — spritesConfigFromEnv
// answers null and provisioning fails closed with an honest
// "not configured" (the Gmail-banner pattern), never a fallback to
// the ungoverned hand-provisioned runner.

import {
  createSpriteBody, networkPolicyBody,
  type NetworkRule, type WorkspaceProvider,
} from "./workspaces.ts";

export interface SpritesConfig {
  token: string;
  baseUrl: string;
  /** Where the deployment publishes the runner build (a single
   *  file — sdk/node/runner's clayware-runner.mjs). Without it a
   *  sprite can be created but never booted: provisioning gates on
   *  it separately, so the two absences word differently. */
  runnerUrl: string | null;
}

/** The provider's configuration from the environment, or null when
 *  no account is configured. Secret NAMES only — no value is ever
 *  embedded in code. */
export function spritesConfigFromEnv(get: (name: string) => string | undefined): SpritesConfig | null {
  const token = get("SPRITES_API_TOKEN")?.trim();
  if (!token) return null;
  return {
    token,
    baseUrl: (get("SPRITES_API_URL")?.trim() || "https://api.sprites.dev").replace(/\/+$/, ""),
    runnerUrl: get("WORKSPACE_RUNNER_URL")?.trim() || null,
  };
}

/** A provider failure. The message carries the HTTP status and a
 *  slice of the provider's answer — never the token, never a header. */
export class SpritesError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "SpritesError";
    this.status = status;
  }
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const CREATE_TIMEOUT_MS = 120_000;
const CALL_TIMEOUT_MS = 30_000;
/** The service-create answer is a startup log stream: watched just
 *  long enough to know the create landed, then let go — the service
 *  itself is the sprite's to keep alive, not this call's. */
const SERVICE_WATCH_MS = 15_000;

/** A Sprites client over an injected fetch (tests drive the seam). */
export function createSpritesProvider(config: SpritesConfig, fetchFn: FetchFn = fetch): WorkspaceProvider {
  const call = async (path: string, init: RequestInit, timeoutMs: number): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchFn(`${config.baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${config.token}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new SpritesError(0, `sprites request failed: ${e instanceof Error ? e.message.slice(0, 200) : "network error"}`);
    }
    return res;
  };
  const fail = async (what: string, res: Response): Promise<never> => {
    const body = await res.text().catch(() => "");
    throw new SpritesError(res.status, `${what} (status ${res.status}): ${body.slice(0, 300)}`);
  };

  return {
    id: "sprites",

    async create(name, labels) {
      const res = await call("/v1/sprites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createSpriteBody(name, labels)),
      }, CREATE_TIMEOUT_MS);
      if (!res.ok) return fail("create sprite failed", res);
      const info = await res.json().catch(() => ({})) as { name?: unknown; status?: unknown };
      return {
        name: typeof info.name === "string" ? info.name : name,
        status: typeof info.status === "string" ? info.status : "unknown",
      };
    },

    async destroy(name) {
      const res = await call(`/v1/sprites/${encodeURIComponent(name)}`, { method: "DELETE" }, CALL_TIMEOUT_MS);
      // 404 is the desired end state reached by another path.
      if (!res.ok && res.status !== 204 && res.status !== 404) return fail("destroy sprite failed", res);
    },

    async setNetworkPolicy(name, rules: readonly NetworkRule[]) {
      const res = await call(`/v1/sprites/${encodeURIComponent(name)}/policy/network`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(networkPolicyBody(rules)),
      }, CALL_TIMEOUT_MS);
      if (!res.ok && res.status !== 204) return fail("set network policy failed", res);
    },

    async writeFile(name, path, content, mode) {
      const url = new URL(`${config.baseUrl}/v1/sprites/${encodeURIComponent(name)}/fs/write`);
      url.searchParams.set("path", path);
      url.searchParams.set("workingDir", "/");
      url.searchParams.set("mkdirParents", "true");
      if (mode) url.searchParams.set("mode", mode);
      let res: Response;
      try {
        res = await fetchFn(url.toString(), {
          method: "PUT",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/octet-stream" },
          body: content,
          signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
      } catch (e) {
        throw new SpritesError(0, `sprites request failed: ${e instanceof Error ? e.message.slice(0, 200) : "network error"}`);
      }
      if (!res.ok) return fail("write file failed", res);
    },

    async putService(name, service, spec) {
      const res = await call(
        `/v1/sprites/${encodeURIComponent(name)}/services/${encodeURIComponent(service)}?duration=5s`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cmd: spec.cmd, args: spec.args }),
        },
        SERVICE_WATCH_MS,
      );
      if (!res.ok) return fail("create service failed", res);
      // The answer streams the service's first seconds of logs. The
      // create has landed once the status said so; drain briefly so
      // the connection closes cleanly, and never let the watching
      // fail the provisioning.
      try { await res.text(); } catch { /* the stream is observational */ }
    },
  };
}
