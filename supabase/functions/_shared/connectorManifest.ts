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
//
// Manifest v2 (back-half B2) adds two declarations a v1 manifest simply
// does not carry; a manifest without them parses exactly as before.
//   verify: on a write command — after the write runs, the engine reads
//     the target back through the named read command and compares the
//     read-back state with the write's intent (verifyReads.ts):
//       "verify": { "command": "get_file", "expect": { "title": "title" },
//                   "delay_ms": 500 }
//     `expect` maps a read-back field to a write-input field name (or a
//     literal the read-back must carry). A verify must name a read
//     command of the same manifest — anything else is a parse error and
//     the command is left out, because a verify that cannot run must
//     never read as a verify that passed.
//   reversibility: on any command — "contained" | "wide" | "none", the
//     blast-radius lane input B7's graduated autonomy reads. Absent is
//     derived (reversibilityOf): a critical class → "none", any other
//     write → "wide", a read → none of the lanes.
//   quota (B11): on a write command — { "writes_per_hour": n }, the
//     most writes to one target the command may settle within an hour
//     before the circuit breaker holds the next one for a person. It
//     is the breaker's same-target check with the manifest's own
//     number (_shared/breakers.ts), so like verify it is enforcement:
//     a malformed quota is a parse error and the command is left out,
//     never read as "no limit".
//   undo (B9): on a write command — { "command": <a write command of
//     the same manifest>, "input": { <arg>: <field name or literal> } },
//     the compensation that rolls the write back when a run fails
//     after it landed. The input mapping reads exactly like verify's
//     expect: a string value naming a field of the write's input ⊕
//     result state takes that field's value; anything else is a
//     literal. An undo is a promise about recovery, so like verify
//     and quota it is enforcement: a malformed declaration, or one
//     naming a command that is missing, not a write, or the command
//     itself, is a parse error and the command is left out — never
//     read as a compensation that merely never fires. The payload a
//     landed write leaves is resolved and recorded at execution time
//     (_shared/compensation.ts), bound, never re-derived later.
//   transform (P1T): on any command — the name of a server-side pure
//     function that shapes the service's raw answer into the form a
//     reader works from (a Gmail message resource into its headers
//     and plain-text body). The names live in a closed code-side
//     registry (_shared/manifestTransforms.ts): a manifest may only
//     name one that exists — an unknown name is a parse error and
//     the command is left out, exactly as a verify may only name a
//     read command that exists. First-party manifests carry these;
//     a G4 draft never may (connectorDraft.ts refuses them outright),
//     so a drafted manifest cannot invent a code reference.

export type Effect = "read" | "write";
export type Permission = "allow" | "ask" | "deny";

/** How far a call's effects reach, declared or derived: the lane input
 *  graduated autonomy (B7) reads. "contained" — a bad call costs a revert
 *  of one contained thing; "wide" — shared state, many readers; "none" —
 *  hard to reverse (sends, money, deletes, contracts). */
export type Reversibility = "contained" | "wide" | "none";

/**
 * A write's read-back declaration (manifest v2): after the write runs,
 * the named read command reads the target state back and its fields are
 * compared with the write's intent. `expect` maps a read-back field to
 * either a write-input field name or a literal value (verifyReads.ts
 * holds the exact reading). `delayMs` is the one bounded retry's wait
 * for read-after-write inconsistency — default 0, capped at parse time.
 */
export interface VerifyDeclaration {
  command: string;
  expect: Record<string, unknown>;
  delayMs: number;
}

/**
 * A write command's quota (manifest v2, back-half B11): the most writes
 * to one target this command may settle within an hour before the
 * circuit breaker holds the next one for a person. It overrides the
 * breaker's standing same-target default for this command — the quota
 * is the same check with the manifest's own number (design §B11).
 */
export interface CommandQuota {
  writesPerHour: number;
}

/**
 * A write command's compensation declaration (manifest v2, back-half
 * B9): the write that rolls this write back. `command` names another
 * write command of the same manifest; `input` maps that command's
 * arguments to scalars read the way verify's expect reads them — a
 * string naming a field of the write's input ⊕ result state takes
 * the field's value (the input wins over the result state), any
 * other value is a literal. Arguments the mapping does not name are
 * not passed; a required argument of the undo command the mapping
 * leaves unfilled makes the recorded payload incomplete, and an
 * incomplete payload is reported, never partially executed
 * (_shared/compensation.ts).
 */
export interface UndoDeclaration {
  command: string;
  input: Record<string, unknown>;
}

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

/**
 * How one call reads on an approval card: the action as a person reads
 * it, the labeled fields worth deciding on (by argument name), and the
 * argument whose value is the content preview. Presentation only —
 * enforcement never reads it — so a malformed block is dropped whole
 * rather than repaired, and a connection test must not wipe one a person
 * (or an earlier draft) wrote.
 */
export interface CommandPresent {
  /** The action as a person reads it: "Create a pull request". */
  title?: string;
  /** Ordered labeled fields, by argument name. */
  fields?: { arg: string; label: string }[];
  /** The argument whose value is the content preview (a body, a file's content, a message). */
  preview?: string;
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
  /** How a call reads on an approval card, when the manifest says. */
  present: CommandPresent | null;
  /** The read-back that proves this write landed (writes only), when declared. */
  verify: VerifyDeclaration | null;
  /** The declared blast radius, when the manifest says; null derives it. */
  reversibility: Reversibility | null;
  /** The declared write quota (B11), when the manifest says; null
   *  leaves the breaker's standing same-target default in force. */
  quota: CommandQuota | null;
  /** The declared compensation (B9), when the manifest says; null
   *  leaves the write with nothing that rolls it back — a failure
   *  report then names it as uncompensatable. Writes only: a read's
   *  undo declaration is read and discarded by the parser. */
  undo: UndoDeclaration | null;
  /** The named response transform (P1T), when the manifest says: a
   *  pure function in the closed registry (manifestTransforms.ts)
   *  shapes this command's live answer before anyone reads it. Null
   *  leaves the answer exactly as the service returned it. */
  transform: string | null;
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
export const MAX_PRESENT_FIELDS = 8;

/**
 * Pure. A command's presentation block, or null when it carries none —
 * or when what it carries is not in the one accepted shape (a title of
 * at most 120 chars, at most 8 labeled fields with labels of at most 40
 * chars, a preview naming an argument). A bad block is dropped whole,
 * never fatal: a manifest is data a connection test rewrites, and a
 * presentation mistake must not break enforcement.
 */
export function parsePresent(raw: unknown): CommandPresent | null {
  const x = obj(raw);
  if (!x) return null;
  const present: CommandPresent = {};
  if (x.title !== undefined) {
    if (typeof x.title !== "string" || !x.title.trim() || x.title.length > 120) return null;
    present.title = x.title;
  }
  if (x.fields !== undefined) {
    if (!Array.isArray(x.fields) || x.fields.length > MAX_PRESENT_FIELDS) return null;
    const fields: { arg: string; label: string }[] = [];
    for (const f of x.fields) {
      const y = obj(f);
      if (!y || typeof y.arg !== "string" || !FIELD.test(y.arg)
        || typeof y.label !== "string" || !y.label.trim() || y.label.length > 40) return null;
      fields.push({ arg: y.arg, label: y.label });
    }
    if (fields.length) present.fields = fields;
  }
  if (x.preview !== undefined) {
    if (typeof x.preview !== "string" || !FIELD.test(x.preview)) return null;
    present.preview = x.preview;
  }
  return present.title || present.fields || present.preview ? present : null;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);

export const MAX_VERIFY_EXPECT = 16;
export const MAX_VERIFY_DELAY_MS = 5000;
const REVERSIBILITIES = new Set(["contained", "wide", "none"]);

/**
 * Pure. A command's verify declaration: undefined when it carries none,
 * null when what it carries is malformed, the declaration otherwise.
 * Malformed is distinct from absent because the caller treats it as a
 * parse error (a verify is enforcement, not presentation): an expect
 * map of at most 16 fields, each value a JSON value of at most 500
 * chars serialized, and a delay that clamps into [0, 5000] — the cap is
 * part of the declaration's meaning, so an over-large one is read as
 * the cap rather than failing the manifest.
 */
export function parseVerify(raw: unknown): VerifyDeclaration | null | undefined {
  if (raw === undefined) return undefined;
  const x = obj(raw);
  if (!x) return null;
  if (typeof x.command !== "string" || !NAME.test(x.command)) return null;
  const expectRaw = obj(x.expect);
  if (!expectRaw) return null;
  const entries = Object.entries(expectRaw);
  if (!entries.length || entries.length > MAX_VERIFY_EXPECT) return null;
  for (const [k, v] of entries) {
    if (!FIELD.test(k)) return null;
    try { if (JSON.stringify(v)?.length > 500) return null; } catch { return null; }
  }
  let delayMs = 0;
  if (x.delay_ms !== undefined) {
    if (typeof x.delay_ms !== "number" || !Number.isFinite(x.delay_ms)) return null;
    delayMs = Math.min(MAX_VERIFY_DELAY_MS, Math.max(0, Math.floor(x.delay_ms)));
  }
  return { command: x.command, expect: { ...expectRaw }, delayMs };
}

/** Pure. A command's declared reversibility; an unreadable value is
 *  absent (the derivation in reversibilityOf is the designed default,
 *  so a typo falls back to it rather than inventing a fourth lane). */
export function parseReversibility(raw: unknown): Reversibility | null {
  return typeof raw === "string" && REVERSIBILITIES.has(raw) ? raw as Reversibility : null;
}

export const MAX_QUOTA_WRITES_PER_HOUR = 100_000;

/**
 * Pure. A command's quota declaration: undefined when it carries none,
 * null when what it carries is malformed, the declaration otherwise.
 * Malformed is distinct from absent for the same reason as verify: a
 * quota is enforcement, so a writes_per_hour that is not a whole
 * number in [1, MAX] is a parse error at the caller, never a limit
 * that silently reads as none.
 */
export function parseQuota(raw: unknown): CommandQuota | null | undefined {
  if (raw === undefined) return undefined;
  const x = obj(raw);
  if (!x) return null;
  const n = x.writes_per_hour;
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > MAX_QUOTA_WRITES_PER_HOUR) return null;
  return { writesPerHour: n };
}

export const MAX_UNDO_FIELDS = 16;

/**
 * Pure. A command's undo declaration: undefined when it carries none,
 * null when what it carries is malformed, the declaration otherwise.
 * Malformed is distinct from absent for the same reason as verify and
 * quota: an undo is enforcement — a promise about recovery — so a
 * declaration that cannot be read (not an object, no usable command
 * name, an input that is not a map of at most 16 scalar values of at
 * most 500 chars serialized) is a parse error at the caller, never a
 * compensation that silently reads as none. Whether the named
 * command can serve as an undo at all (it exists in the manifest, is
 * a write, is not the command itself) is the caller's second pass,
 * mirroring verify's.
 */
export function parseUndo(raw: unknown): UndoDeclaration | null | undefined {
  if (raw === undefined) return undefined;
  const x = obj(raw);
  if (!x) return null;
  if (typeof x.command !== "string" || !NAME.test(x.command)) return null;
  const inputRaw = obj(x.input);
  if (!inputRaw) return null;
  const entries = Object.entries(inputRaw);
  if (entries.length > MAX_UNDO_FIELDS) return null;
  for (const [k, v] of entries) {
    if (!FIELD.test(k)) return null;
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return null;
    try { if (JSON.stringify(v)?.length > 500) return null; } catch { return null; }
  }
  return { command: x.command, input: { ...inputRaw } };
}

/**
 * The response-transform names a manifest may reference (P1T): the
 * grammar's side of the closed registry — the implementations live
 * in manifestTransforms.ts, which executes them. This module stays
 * import-free (the web's type check reads it directly), so the names
 * are spelled here and the three lists — this one, the registry's
 * keys, and the web twin's set in draftModel.ts — are pinned equal
 * by manifestTransforms.test.ts: a transform is added in all three
 * places, in code review, or it does not exist.
 */
export const RESPONSE_TRANSFORM_NAMES: readonly string[] = ["gmail_message"];

/**
 * Pure. A command's response-transform reference (P1T): undefined
 * when it carries none, null when what it carries cannot be one —
 * not a string in the name shape, or a name the registry does not
 * hold. Malformed is distinct from absent for the same reason as
 * verify: the reference is code, not data, so a name that resolves
 * to nothing must never survive as a shaping that merely never runs.
 */
export function parseTransform(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !NAME.test(raw) || !RESPONSE_TRANSFORM_NAMES.includes(raw)) return null;
  return raw;
}

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
    const verify = parseVerify(x.verify);
    if (verify === null) { errors.push(`${name}: verify の形が読めません（command と expect が必要です）`); continue; }
    const quota = parseQuota(x.quota);
    if (quota === null) { errors.push(`${name}: quota の形が読めません（writes_per_hour は 1 以上の整数にしてください）`); continue; }
    // An undo on a read is read and discarded: nothing a read does
    // needs rolling back, and a stray declaration must not cost the
    // read its place. On a write it is parsed in full — malformed is
    // a parse error, as with verify and quota.
    const undo = effect === "write" ? parseUndo(x.undo) : undefined;
    if (undo === null) { errors.push(`${name}: undo の形が読めません（command と input が必要です）`); continue; }
    const transform = parseTransform(x.transform);
    if (transform === null) { errors.push(`${name}: transform の名前が読めません（登録された整形の名前だけが使えます）`); continue; }
    seen.add(name);
    commands.push({
      name, effect, permission, http, mcp,
      action: typeof x.action === "string" && x.action.trim() ? x.action.trim() : name,
      description: typeof x.description === "string" ? x.description.slice(0, 1000) : "",
      input: obj(x.input) ?? {},
      required: strings(x.required),
      rules: parseRules(x.rules),
      present: parsePresent(x.present),
      verify: verify ?? null,
      reversibility: parseReversibility(x.reversibility),
      quota: quota ?? null,
      undo: undo ?? null,
      transform: transform ?? null,
    });
  }
  // A verify is only as real as its target: it must sit on a write and
  // name a read command of this same manifest. Anything else is a parse
  // error and the command is left out — a declaration that cannot run
  // must never survive as one that merely never fires.
  const effectByName = new Map(commands.map((c) => [c.name, c.effect]));
  const kept = commands.filter((c) => {
    if (c.verify) {
      if (c.effect !== "write") { errors.push(`${c.name}: verify は write のコマンドにだけ宣言できます`); return false; }
      if (effectByName.get(c.verify.command) !== "read") { errors.push(`${c.name}: verify の ${c.verify.command} は read のコマンドではありません`); return false; }
    }
    // An undo is only as real as its target, the same discipline from
    // the other side: it must name a write command of this same
    // manifest, and never the command itself — a write whose rollback
    // is itself would re-run the very thing that failed.
    if (c.undo) {
      if (c.undo.command === c.name) { errors.push(`${c.name}: undo は自分自身を指せません`); return false; }
      if (effectByName.get(c.undo.command) !== "write") { errors.push(`${c.name}: undo の ${c.undo.command} は write のコマンドではありません`); return false; }
    }
    return true;
  });
  const aliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(m.aliases) ?? {})) if (typeof v === "string") aliases[k] = v;
  return { manifest: { commands: kept, aliases }, errors };
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

/**
 * Pure. A command's reversibility lane: the declared value wins; absent
 * one, a critical class is "none" (hard to reverse by definition), any
 * other write is "wide", and a read sits in no lane (null). Lane 1
 * ("contained") exists only by declaration — a command earns the
 * narrowest lane by saying so, never by derivation (design §4.1).
 */
export function reversibilityOf(command: ManifestCommand): Reversibility | null {
  if (command.reversibility) return command.reversibility;
  if (command.effect !== "write") return null;
  return criticalClassOf(command) ? "none" : "wide";
}

/** Pure. A command name from a tool's: lower case, letters, digits and _. */
export function commandNameOf(tool: string): string {
  const base = tool.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return (/^[a-z]/.test(base) ? base : `t_${base}`).slice(0, 48) || "tool";
}

/**
 * The verify declarations the built-in GitHub MCP server's key writes
 * carry (back-half B2, PR3): a file write is proven by reading the file
 * back and comparing its content; a pull request by reading it back and
 * comparing the branches it was opened between. Both are "contained" —
 * one file reverts with one write, one PR closes with one call.
 * Stamped by manifestFromTools only when the verify target is itself
 * listed, read-only, by the same server — so the declaration is
 * self-consistent by construction on any server that happens to share
 * a tool name — and never over a declaration already stored: what a
 * person (or an earlier draft) declared is theirs, and a connection
 * test must not wipe it, exactly like `present`.
 */
const BUILTIN_VERIFY: Record<string, { verifyTool: string; expect: Record<string, unknown>; reversibility: Reversibility }> = {
  create_or_update_file: { verifyTool: "get_file_contents", expect: { content: "content" }, reversibility: "contained" },
  create_pull_request: { verifyTool: "get_pull_request", expect: { head: "head", base: "base" }, reversibility: "contained" },
};

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
      ...(obj(before?.present) ? { present: before!.present } : {}),
      ...(obj(before?.verify) ? { verify: before!.verify } : {}),
      ...(parseReversibility(before?.reversibility) ? { reversibility: before!.reversibility } : {}),
      ...(obj(before?.quota) ? { quota: before!.quota } : {}),
      ...(obj(before?.undo) ? { undo: before!.undo } : {}),
      ...(typeof before?.transform === "string" && before.transform ? { transform: before.transform } : {}),
      description: (t.description ?? "").slice(0, 1000),
      mcp: t.name,
    });
  }
  // The built-in verify declarations, stamped where the stored manifest
  // does not already carry the person's own (see BUILTIN_VERIFY above).
  const readOnlyByTool = new Map(tools.map((t) => [t.name, t.readOnly]));
  const nameByTool = new Map<string, string>();
  for (const c of commands) if (typeof c.mcp === "string" && typeof c.name === "string") nameByTool.set(c.mcp, c.name);
  for (const c of commands) {
    if (typeof c.mcp !== "string") continue;
    const builtin = BUILTIN_VERIFY[c.mcp];
    if (!builtin) continue;
    if (c.verify === undefined && readOnlyByTool.get(builtin.verifyTool) === true) {
      const target = nameByTool.get(builtin.verifyTool);
      if (target) c.verify = { command: target, expect: { ...builtin.expect } };
    }
    if (c.reversibility === undefined) c.reversibility = builtin.reversibility;
  }
  return { version: 1, defaults: obj(prior?.defaults) ?? { read: "allow", write: "ask" }, commands, ...(obj(prior?.aliases) ? { aliases: prior!.aliases } : {}) };
}
