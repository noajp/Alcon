// A connector manifest: the policy an integration's use is held to. It
// declares the commands the agent may call — each a canonical action, read
// or write, allowed / asked for / denied — and, for an API integration, how
// a command becomes a request under the integration's base URL. With a
// manifest only declared commands reach the agent; aliases resolve to the
// canonical action so a permission cannot be slipped under another name.
// Pure: run-agent and the tests read a manifest the same way.
//
//   {
//     "version": 1,
//     "defaults": { "read": "allow", "write": "ask" },
//     "commands": [
//       { "name": "search_issues", "action": "issues.search", "effect": "read",
//         "description": "…", "input": { "q": { "type": "string" } }, "required": ["q"],
//         "http": { "method": "GET", "path": "/search/issues", "query": ["q"] } },
//       { "name": "comment", "action": "issues.comment", "effect": "write", "permission": "ask",
//         "input": { "repo": {…}, "number": {…}, "body": {…} }, "required": ["repo", "number", "body"],
//         "http": { "method": "POST", "path": "/repos/{repo}/issues/{number}/comments", "body": ["body"] } },
//       { "name": "list_files", "action": "drive.list", "effect": "read", "mcp": "list_files" }
//     ],
//     "aliases": { "find_issues": "issues.search" }
//   }

export type Effect = "read" | "write";
export type Permission = "allow" | "ask" | "deny";

export interface HttpMapping {
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Under the integration's base URL; `{name}` is filled from the input. */
  path: string;
  query: string[];
  /** Input fields sent as the JSON body ("*" sends every field not used elsewhere). */
  body: string[];
}

export interface ManifestCommand {
  name: string;
  action: string;
  effect: Effect;
  permission: Permission;
  description: string;
  input: Record<string, unknown>;
  required: string[];
  http: HttpMapping | null;
  /** The MCP tool this command is, for an MCP integration. */
  mcp: string | null;
}

export interface Manifest {
  commands: ManifestCommand[];
  aliases: Record<string, string>;
}

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const PERMISSIONS = new Set(["allow", "ask", "deny"]);
const NAME = /^[a-z][a-z0-9_]{0,47}$/;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Pure. A manifest from stored JSON, with what was wrong with it. A command
 *  that cannot be read is left out, never guessed. */
export function parseManifest(raw: unknown): { manifest: Manifest; errors: string[] } {
  const errors: string[] = [];
  const m = obj(raw);
  if (!m) return { manifest: { commands: [], aliases: {} }, errors: ["manifest はオブジェクトにしてください"] };
  const defaults = obj(m.defaults) ?? {};
  const def = (effect: Effect): Permission => {
    const v = defaults[effect];
    return typeof v === "string" && PERMISSIONS.has(v) ? v as Permission : effect === "read" ? "allow" : "ask";
  };
  const commands: ManifestCommand[] = [];
  const seen = new Set<string>();
  for (const [i, c] of (Array.isArray(m.commands) ? m.commands : []).entries()) {
    const x = obj(c);
    const name = typeof x?.name === "string" ? x.name : "";
    if (!x || !NAME.test(name)) { errors.push(`commands[${i}]: name は英小文字・数字・_ で書いてください`); continue; }
    if (seen.has(name)) { errors.push(`commands[${i}]: ${name} が重複しています`); continue; }
    const effect = x.effect === "write" ? "write" : x.effect === "read" ? "read" : null;
    if (!effect) { errors.push(`${name}: effect は read か write にしてください`); continue; }
    const permission = typeof x.permission === "string" && PERMISSIONS.has(x.permission) ? x.permission as Permission : def(effect);
    let http: HttpMapping | null = null;
    const h = obj(x.http);
    if (h) {
      const method = String(h.method ?? "GET").toUpperCase();
      const path = typeof h.path === "string" ? h.path : "";
      if (!METHODS.has(method) || !path.startsWith("/")) { errors.push(`${name}: http の method / path が読めません`); continue; }
      // A read must not be able to change anything.
      if (effect === "read" && method !== "GET" && method !== "HEAD") { errors.push(`${name}: read のコマンドは GET か HEAD にしてください`); continue; }
      http = { method: method as HttpMapping["method"], path, query: strings(h.query), body: strings(h.body) };
    }
    const mcp = typeof x.mcp === "string" && x.mcp ? x.mcp : null;
    if (!http && !mcp) { errors.push(`${name}: http か mcp のどちらかが必要です`); continue; }
    seen.add(name);
    commands.push({
      name, effect, permission, http, mcp,
      action: typeof x.action === "string" && x.action.trim() ? x.action.trim() : name,
      description: typeof x.description === "string" ? x.description.slice(0, 1000) : "",
      input: obj(x.input) ?? {},
      required: strings(x.required),
    });
  }
  const aliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(m.aliases) ?? {})) if (typeof v === "string") aliases[k] = v;
  return { manifest: { commands, aliases }, errors };
}

/** Pure. The canonical action a name stands for: its own, or the one an alias points to. */
export function canonicalAction(manifest: Manifest, name: string): string | null {
  const direct = manifest.commands.find((c) => c.name === name);
  if (direct) return direct.action;
  return manifest.aliases[name] ?? null;
}

/** Pure. The permission an action has: a denial on any command of that action wins. */
export function permissionOf(manifest: Manifest, action: string): Permission {
  const of = manifest.commands.filter((c) => c.action === action).map((c) => c.permission);
  if (of.length === 0) return "deny";
  if (of.includes("deny")) return "deny";
  return of.includes("ask") ? "ask" : "allow";
}

/** Pure. The commands offered to the agent: every declared one not denied. */
export function offeredCommands(manifest: Manifest): ManifestCommand[] {
  return manifest.commands.filter((c) => permissionOf(manifest, c.action) !== "deny");
}

/** Pure. A command's tool input schema. */
export function commandSchema(c: ManifestCommand): Record<string, unknown> {
  return { type: "object", properties: c.input, required: c.required, additionalProperties: false };
}

/**
 * Pure. The request a command makes: its method, the path with `{name}`
 * filled (each value URL-encoded, so it cannot leave its segment), the
 * query and the body. An error when a required input or a path value is
 * missing.
 */
export function requestFor(c: ManifestCommand, input: Record<string, unknown>): { method: string; path: string; query: Record<string, unknown>; body?: unknown } | { error: string } {
  if (!c.http) return { error: `${c.name} は API のコマンドではありません` };
  for (const r of c.required) if (input[r] === undefined || input[r] === null || input[r] === "") return { error: `${r} が必要です` };
  const used = new Set<string>();
  let missing: string | null = null;
  const path = c.http.path.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    used.add(key);
    const v = input[key];
    if (v === undefined || v === null || v === "") { missing = key; return ""; }
    return encodeURIComponent(String(v));
  });
  if (missing) return { error: `${missing} が必要です` };
  const query: Record<string, unknown> = {};
  for (const q of c.http.query) if (input[q] !== undefined) { query[q] = input[q]; used.add(q); }
  if (c.http.method === "GET" || c.http.method === "HEAD") return { method: c.http.method, path, query };
  const body: Record<string, unknown> = {};
  const all = c.http.body.includes("*");
  for (const [k, v] of Object.entries(input)) {
    if (used.has(k)) continue;
    if (all || c.http.body.includes(k)) body[k] = v;
  }
  return { method: c.http.method, path, query, body };
}
