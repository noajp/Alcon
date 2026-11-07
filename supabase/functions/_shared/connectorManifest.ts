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
//         "rules": [{ "when": { "repo": "acme/*" }, "permission": "allow" }],
//         "input": { "repo": {…}, "number": {…}, "body": {…} }, "required": ["repo", "number", "body"],
//         "http": { "method": "POST", "path": "/repos/{repo}/issues/{number}/comments", "body": ["body"] } },
//       { "name": "list_files", "action": "drive.list", "effect": "read", "mcp": "list_files" }
//     ],
//     "aliases": { "find_issues": "issues.search" }
//   }
//
// A command's rules bind its permission to the call's arguments. Each rule
// names input fields and a pattern for each (`*` matches any run of
// characters, case is ignored); the first rule whose fields all match
// decides, under any delegation. A command denied as a whole but allowed by
// a rule is an allowlist: only the calls a rule lets through can happen.

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

/** A permission bound to the call's arguments: every field in `when` must match. */
export interface CommandRule {
  when: Record<string, string>;
  permission: Permission;
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
  /** Argument-bound permissions, first match wins. */
  rules: CommandRule[];
}

export interface Manifest {
  commands: ManifestCommand[];
  aliases: Record<string, string>;
}

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const PERMISSIONS = new Set(["allow", "ask", "deny"]);
const NAME = /^[a-z][a-z0-9_]{0,47}$/;
const FIELD = /^[A-Za-z0-9_.-]{1,64}$/;
export const MAX_RULES = 50;

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

/** Pure. The rules stored on a command; one that cannot be read is left out. */
export function parseRules(raw: unknown): CommandRule[] {
  const rules: CommandRule[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const x = obj(r);
    const when = obj(x?.when);
    if (!x || !when || typeof x.permission !== "string" || !PERMISSIONS.has(x.permission)) continue;
    const fields = Object.entries(when).filter(([k, v]) => FIELD.test(k) && typeof v === "string" && v.length <= 500) as [string, string][];
    if (!fields.length || fields.length !== Object.keys(when).length) continue;
    rules.push({ when: Object.fromEntries(fields), permission: x.permission as Permission });
    if (rules.length >= MAX_RULES) break;
  }
  return rules;
}

/** Pure. Whether a value matches a pattern: `*` is any run of characters, case is ignored. */
export function globMatch(pattern: string, value: string): boolean {
  const re = pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${re}$`, "is").test(value);
}

/** The text a scalar input value is matched as; objects and missing values never match. */
function scalar(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/** Pure. Whether every field a rule names matches the call's input. */
export function ruleMatches(rule: CommandRule, input: Record<string, unknown>): boolean {
  return Object.entries(rule.when).every(([field, pattern]) => {
    const v = scalar(input[field]);
    return v !== null && globMatch(pattern, v);
  });
}

/**
 * Pure. What a call to a command may do: the first of its rules that
 * matches the input, else the permission of its action. `rule` is the index
 * of the rule that decided, or null when the command's own permission did.
 */
export function decide(manifest: Manifest, command: ManifestCommand, input: Record<string, unknown>): { permission: Permission; rule: number | null } {
  const i = command.rules.findIndex((r) => ruleMatches(r, input));
  if (i >= 0) return { permission: command.rules[i].permission, rule: i };
  return { permission: permissionOf(manifest, command.action), rule: null };
}

/** Pure. The input fields a standing approval can be bound to: short scalar values without a wildcard. */
export function rememberableFields(input: Record<string, unknown>): string[] {
  return Object.entries(input)
    .filter(([k, v]) => FIELD.test(k) && scalar(v) !== null && String(v).length <= 200 && !String(v).includes("*"))
    .map(([k]) => k);
}

/**
 * Pure. The rule that lets these calls through from now on, bound to the
 * chosen fields: each must be rememberable and hold the same value in every
 * call. An error when it cannot be made.
 */
export function ruleFromCalls(inputs: Record<string, unknown>[], fields: string[]): CommandRule | { error: string } {
  if (!inputs.length || !fields.length) return { error: "条件にする項目を選んでください。" };
  const when: Record<string, string> = {};
  for (const f of fields) {
    if (!inputs.every((i) => rememberableFields(i).includes(f))) return { error: `${f} は条件にできません。` };
    const values = new Set(inputs.map((i) => String(i[f])));
    if (values.size !== 1) return { error: `${f} の値が呼び出しごとに違うので、条件にできません。` };
    when[f] = [...values][0];
  }
  return { when, permission: "allow" };
}

/**
 * Pure. Stored manifest JSON with a rule added to a command, ahead of the
 * rules already there, or null when the command is not in it. The same
 * condition is not stored twice.
 */
export function withRule(raw: unknown, commandName: string, rule: CommandRule): Record<string, unknown> | null {
  const m = obj(raw);
  const commands = Array.isArray(m?.commands) ? m!.commands : null;
  if (!m || !commands) return null;
  const key = JSON.stringify(Object.entries(rule.when).sort());
  let found = false;
  const next = commands.map((c) => {
    const x = obj(c);
    if (!x || x.name !== commandName) return c;
    found = true;
    const rest = parseRules(x.rules).filter((r) => JSON.stringify(Object.entries(r.when).sort()) !== key);
    return { ...x, rules: [rule, ...rest].slice(0, MAX_RULES) };
  });
  return found ? { ...m, commands: next } : null;
}

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
      rules: parseRules(x.rules),
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

/** Pure. The commands offered to the agent: every declared one not denied,
 *  and a denied one some rule still lets through. */
export function offeredCommands(manifest: Manifest): ManifestCommand[] {
  return manifest.commands.filter((c) => permissionOf(manifest, c.action) !== "deny" || c.rules.some((r) => r.permission !== "deny"));
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

export type CriticalClass = "send" | "money" | "delete" | "contract";

// Critical operations: the ones a person must be able to stop every time —
// sending something out, moving money, deleting, or binding the
// organisation (an order, a signature, a subscription). The manifest has
// no criticality field, so the class is derived from the only fields it
// does have: the command's names and its HTTP mapping. Whole tokens only,
// so "postpone" is not "post" and "sender" is not "send".
//
// This is a floor, not a guarantee: a write whose names avoid every token
// below is an ordinary write and keeps the delegation behaviour. An
// explicit per-command flag belongs to manifest authoring, not to this
// derivation.
const CRITICAL_TOKENS: [CriticalClass, string[]][] = [
  ["delete", ["delete", "destroy", "erase", "purge", "remove", "drop", "trash", "revoke"]],
  ["money", ["pay", "payment", "payments", "charge", "charges", "refund", "refunds", "transfer", "transfers", "payout", "payouts", "purchase", "purchases", "withdraw", "withdrawal", "deposit", "billing", "invoice", "invoices"]],
  ["contract", ["contract", "contracts", "sign", "signature", "agreement", "agreements", "quote", "quotes", "order", "orders", "checkout", "subscribe", "subscription", "subscriptions"]],
  ["send", ["send", "mail", "email", "message", "messages", "notify", "notification", "notifications", "publish", "post", "comment", "comments", "reply", "replies", "announce", "invite", "invites", "share", "dm"]],
];

/** Pure. A name broken into whole tokens: camelCase humps, snake_case, kebab, dots and slashes all separate. */
function nameTokens(text: string): string[] {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Pure. The critical class a write's name carries, or null. First class in
 * the order delete → money → contract → send wins. A read is never
 * critical. Shared core: a manifest command's fields and a typed tool's
 * name (Google Drive's tools) are judged the same way.
 */
export function criticalClassForTokens(text: string, effect: Effect): CriticalClass | null {
  if (effect !== "write") return null;
  const tokens = new Set(nameTokens(text));
  for (const [cls, words] of CRITICAL_TOKENS) if (words.some((w) => tokens.has(w))) return cls;
  return null;
}

/** Pure. A command's critical class from its own fields; an HTTP DELETE is a delete whatever its names say. */
export function criticalClassOf(command: Pick<ManifestCommand, "name" | "action" | "effect" | "http" | "mcp">): CriticalClass | null {
  if (command.effect !== "write") return null;
  if (command.http?.method === "DELETE") return "delete";
  return criticalClassForTokens([command.action, command.name, command.mcp ?? "", command.http?.path ?? ""].join(" "), command.effect);
}

/** Pure. A command name from a tool's: lower case, letters, digits and _. */
export function commandNameOf(tool: string): string {
  const base = tool.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(base) ? base : `t_${base}`).slice(0, 48) || "tool";
}

/**
 * Pure. An MCP integration's manifest from the tools its server lists: one
 * command per tool, read or write as the server marks it, under the defaults
 * (read allowed, write asked). A command a person already set keeps its
 * permission; a tool the server no longer lists drops out; a hand-declared
 * API command stays. Written by integration-test after each connection test,
 * so what a person sees in the dialog is what the engine enforces.
 */
export function manifestFromTools(tools: { name: string; description?: string; readOnly: boolean }[], existing: unknown): Record<string, unknown> {
  const prior = obj(existing);
  const priorCommands = (Array.isArray(prior?.commands) ? prior!.commands : []).map(obj).filter((c): c is Record<string, unknown> => !!c);
  const byTool = new Map(priorCommands.filter((c) => typeof c.mcp === "string").map((c) => [c.mcp as string, c]));
  const used = new Set<string>(priorCommands.filter((c) => !c.mcp && typeof c.name === "string").map((c) => c.name as string));
  const commands: Record<string, unknown>[] = priorCommands.filter((c) => !c.mcp);
  for (const t of tools) {
    const before = byTool.get(t.name);
    let name = typeof before?.name === "string" && NAME.test(before.name) ? before.name : commandNameOf(t.name);
    for (let i = 2; used.has(name); i++) name = `${commandNameOf(t.name).slice(0, 44)}_${i}`;
    used.add(name);
    const effect: Effect = t.readOnly ? "read" : "write";
    commands.push({
      name, action: typeof before?.action === "string" ? before.action : name, effect,
      ...(typeof before?.permission === "string" && PERMISSIONS.has(before.permission) ? { permission: before.permission } : {}),
      ...(Array.isArray(before?.rules) && before!.rules.length ? { rules: before!.rules } : {}),
      description: (t.description ?? "").slice(0, 1000),
      mcp: t.name,
    });
  }
  return { version: 1, defaults: obj(prior?.defaults) ?? { read: "allow", write: "ask" }, commands, ...(obj(prior?.aliases) ? { aliases: prior!.aliases } : {}) };
}
