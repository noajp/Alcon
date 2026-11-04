import type { ToolDef, ToolResult } from "../_shared/boardTools.ts";
import { sanitizeName } from "../_shared/callerName.ts";
import {
  EXTERNAL_READ_TOOLS, EXTERNAL_WRITE_TOOLS, externalToolDefs, isReadTool, type ExternalTool,
} from "../_shared/externalTools.ts";

// The REST shape of the outside-caller tools. Every route is one tool from
// the allowlist in _shared/externalTools.ts — the list MCP offers — so the
// API can neither read nor write anything MCP cannot, and a tool's input
// schema is the route's query or body schema. Pure: index.ts does the HTTP.

export type Method = "GET" | "POST" | "PATCH" | "PUT";

export interface Route {
  method: Method;
  /** `{id}` is the one path parameter a route may have. */
  path: string;
  tool: ExternalTool;
  /** The tool argument the `{id}` segment fills. */
  idArg?: string;
  /** `{id}` must be a UUID (no display_id lookup behind it). */
  idIsUuid?: boolean;
  /** Answered 201 instead of 200. */
  creates?: boolean;
  summary: string;
}

export const ROUTES: readonly Route[] = [
  { method: "GET", path: "/domains", tool: "listMyDomains", summary: "Domains you belong to" },
  { method: "GET", path: "/objects", tool: "listObjects", summary: "Objects (archived ones excluded)" },
  { method: "GET", path: "/elements", tool: "listElements", summary: "Elements, filtered" },
  { method: "POST", path: "/elements", tool: "createElement", creates: true, summary: "Create an Element" },
  { method: "GET", path: "/elements/{id}", tool: "getElement", idArg: "id", summary: "One Element with its Sub-elements, labels, assignees and recent comments" },
  { method: "PATCH", path: "/elements/{id}", tool: "updateElement", idArg: "id", summary: "Update an Element's fields" },
  { method: "POST", path: "/elements/{id}/comments", tool: "addElementComment", idArg: "elementId", creates: true, summary: "Comment on an Element" },
  { method: "POST", path: "/elements/{id}/assignees", tool: "addElementAssignee", idArg: "elementId", summary: "Assign a Worker to an Element" },
  { method: "PUT", path: "/elements/{id}/labels", tool: "setElementLabels", idArg: "id", summary: "Replace an Element's labels" },
  { method: "POST", path: "/elements/{id}/subelements", tool: "createSubelement", idArg: "elementId", creates: true, summary: "Add a Sub-element (an Element under this one)" },
  { method: "PATCH", path: "/subelements/{id}", tool: "toggleSubelementComplete", idArg: "id", idIsUuid: true, summary: "Complete or reopen a Sub-element" },
  { method: "POST", path: "/elements/{id}/claim", tool: "claimElement", idArg: "elementId", summary: "Take the lease on an Element (who is working on it, on which branch)" },
  { method: "POST", path: "/elements/{id}/release", tool: "releaseElement", idArg: "elementId", summary: "Return the lease on an Element" },
  { method: "POST", path: "/elements/{id}/progress", tool: "logProgress", idArg: "elementId", creates: true, summary: "Report a plan or progress on an Element" },
  { method: "POST", path: "/elements/{id}/outcome", tool: "reportOutcome", idArg: "elementId", creates: true, summary: "Close work on an Element: completed, partial or blocked on a person" },
  { method: "GET", path: "/search", tool: "findByText", summary: "Find Elements by title or description" },
  { method: "GET", path: "/progress", tool: "getProgress", summary: "Status breakdown for a Domain or an Object" },
  { method: "GET", path: "/activity", tool: "getRecentActivity", summary: "Recent Element changes" },
  { method: "GET", path: "/workers", tool: "listWorkers", summary: "Workers you can assign" },
  { method: "GET", path: "/initiatives", tool: "listInitiatives", summary: "Initiatives you can see" },
  { method: "GET", path: "/initiatives/{id}", tool: "getInitiative", idArg: "id", idIsUuid: true, summary: "An Initiative's intent and the Objects that execute it" },
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApiError {
  status: 400 | 401 | 403 | 404 | 405 | 422 | 500;
  code: string;
  message: string;
  allow?: string;
}

function err(status: ApiError["status"], code: string, message: string, allow?: string): { ok: false; error: ApiError } {
  return { ok: false, error: { status, code, message, ...(allow ? { allow } : {}) } };
}

/**
 * Pure. The function's own path: Supabase hands the handler
 * `/alcon-api/elements` (and, behind some proxies, `/functions/v1/alcon-api/…`).
 */
export function apiPath(pathname: string): string {
  let p = pathname.replace(/^\/functions\/v1(?=\/|$)/, "").replace(/^\/alcon-api(?=\/|$)/, "");
  p = p.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/** Pure. The route for a method and path, its `{id}` value, or why there is none. */
export function matchRoute(
  method: string,
  path: string,
): { ok: true; route: Route; id: string | null } | { ok: false; error: ApiError } {
  const parts = segments(path);
  const allowed: Method[] = [];
  for (const route of ROUTES) {
    const pattern = segments(route.path);
    if (pattern.length !== parts.length) continue;
    let id: string | null = null;
    let matched = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === "{id}") {
        try {
          id = decodeURIComponent(parts[i]).trim();
        } catch {
          matched = false;
          break;
        }
        if (!id) matched = false;
      } else if (pattern[i] !== parts[i]) {
        matched = false;
      }
      if (!matched) break;
    }
    if (!matched) continue;
    if (route.method !== method) {
      allowed.push(route.method);
      continue;
    }
    return { ok: true, route, id };
  }
  if (allowed.length) {
    const allow = [...new Set(allowed), "OPTIONS"].join(", ");
    return err(405, "method_not_allowed", `${method} is not allowed on ${path}`, allow);
  }
  return err(404, "not_found", `No route for ${method} ${path}`);
}

type Schema = {
  type?: string;
  properties?: Record<string, { type?: string; enum?: unknown[]; items?: { type?: string } }>;
  required?: string[];
  additionalProperties?: boolean;
};

const DEFS = new Map(externalToolDefs("read_write").map((d) => [d.name, d]));

export function toolDef(tool: ExternalTool): ToolDef {
  const def = DEFS.get(tool);
  if (!def) throw new Error(`No definition for ${tool}`);
  return def;
}

/** Pure. Query-string values typed by the tool's schema; a repeated or untypable value is refused. */
export function queryArgs(params: URLSearchParams, schema: Schema): { ok: true; args: Record<string, unknown> } | { ok: false; error: ApiError } {
  const args: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    if (values.length > 1) return err(422, "invalid_request", `"${key}" is given more than once`);
    const raw = values[0];
    const type = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key].type : undefined;
    if (type === "number") {
      const n = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(n)) return err(422, "invalid_request", `"${key}" must be a number`);
      args[key] = n;
    } else if (type === "boolean") {
      if (raw !== "true" && raw !== "false") return err(422, "invalid_request", `"${key}" must be true or false`);
      args[key] = raw === "true";
    } else {
      args[key] = raw;
    }
  }
  return { ok: true, args };
}

function typeOk(value: unknown, type: string | undefined, items?: { type?: string }): boolean {
  switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "array": return Array.isArray(value) && (!items?.type || value.every((v) => typeOk(v, items.type)));
    default: return true;
  }
}

/** Fields a write may clear with null. Any other null is refused. */
export const NULLABLE_FIELDS: ReadonlySet<string> = new Set(["due_date", "estimated_hours", "description"]);

/**
 * Pure. The arguments checked against the tool's input schema: no unknown
 * field, every required one present, each value of its type and in its enum.
 * Only NULLABLE_FIELDS may be null (updateElement clears due_date with null).
 */
export function validateArgs(args: Record<string, unknown>, schema: Schema): ApiError | null {
  const props = schema.properties ?? {};
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(props, key) && schema.additionalProperties === false) {
      return { status: 422, code: "invalid_request", message: `Unknown field "${key}"` };
    }
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      return { status: 422, code: "invalid_request", message: `"${key}" is required` };
    }
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = Object.hasOwn(props, key) ? props[key] : undefined;
    if (!prop || value === undefined) continue;
    if (value === null) {
      if ((schema.required ?? []).includes(key)) return { status: 422, code: "invalid_request", message: `"${key}" is required` };
      if (!NULLABLE_FIELDS.has(key)) return { status: 422, code: "invalid_request", message: `"${key}" cannot be null` };
      continue;
    }
    if (!typeOk(value, prop.type, prop.items)) {
      const what = prop.type === "array" ? `an array of ${prop.items?.type ?? "values"}s` : `a ${prop.type}`;
      return { status: 422, code: "invalid_request", message: `"${key}" must be ${what}` };
    }
    if (prop.enum && !prop.enum.includes(value)) {
      return { status: 422, code: "invalid_request", message: `"${key}" must be one of ${prop.enum.join(", ")}` };
    }
  }
  return null;
}

export interface ApiCall {
  tool: ExternalTool;
  args: Record<string, unknown>;
  successStatus: 200 | 201;
}

/**
 * Pure. A request → the tool to run and its arguments, or the error to
 * answer with. `body` is the raw request body (ignored for GET).
 * A read-only caller is refused every write here, before any tool runs.
 */
export function planRequest(input: {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
  access: "read" | "read_write";
}): { ok: true; call: ApiCall } | { ok: false; error: ApiError } {
  const match = matchRoute(input.method, input.path);
  if (!match.ok) return match;
  const { route, id } = match;

  if (input.access !== "read_write" && !isReadTool(route.tool)) {
    return err(403, "forbidden", "This token is read-only");
  }
  if (route.idIsUuid && id !== null && !UUID_RE.test(id)) {
    return err(404, "not_found", `${route.tool === "getInitiative" ? "Initiative" : "Sub-element"} not found`);
  }

  const schema = toolDef(route.tool).input_schema as Schema;
  let args: Record<string, unknown>;
  if (route.method === "GET") {
    const q = queryArgs(input.query, schema);
    if (!q.ok) return q;
    args = q.args;
  } else {
    if ([...input.query.keys()].length > 0) {
      return err(422, "invalid_request", "Send the fields in the JSON body, not the query string");
    }
    let parsed: unknown = {};
    if (input.body.trim() !== "") {
      try {
        parsed = JSON.parse(input.body);
      } catch {
        return err(400, "bad_request", "The body is not valid JSON");
      }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return err(400, "bad_request", "The body must be a JSON object");
    }
    args = { ...(parsed as Record<string, unknown>) };
  }

  if (route.idArg && id !== null) {
    if (route.idArg in args) {
      return err(422, "invalid_request", `"${route.idArg}" comes from the path`);
    }
    args[route.idArg] = id;
  }

  const invalid = validateArgs(args, schema);
  if (invalid) return { ok: false, error: invalid };
  return { ok: true, call: { tool: route.tool, args, successStatus: route.creates ? 201 : 200 } };
}

/**
 * Pure. A refused tool call → its HTTP status. Something the caller cannot
 * see is "not found" (404) — never "forbidden" — so the API does not reveal
 * what exists outside their boundary. A write RLS refuses on a row they can
 * see is 403; a request the board rejects is 422.
 */
export function errorForToolFailure(message: string): ApiError {
  if (/not found/i.test(message)) return { status: 404, code: "not_found", message };
  if (/row-level security|permission denied|not allowed|not available to this connection/i.test(message)) {
    return { status: 403, code: "forbidden", message };
  }
  return { status: 422, code: "rejected", message };
}

/** Pure. A tool's outcome as the HTTP status and JSON body. */
export function toResponse(result: ToolResult, successStatus: 200 | 201): { status: number; body: unknown } {
  if (!result.ok) {
    const e = errorForToolFailure(result.error);
    return { status: e.status, body: { error: { code: e.code, message: e.message } } };
  }
  return { status: successStatus, body: result.meta ? { data: result.data, meta: result.meta } : { data: result.data } };
}

/**
 * Pure. The name a write is recorded under: "API", with the caller's own
 * name (X-Alcon-Client) in front when it gave one, and how it signed in —
 * "n8n (API · token: ops)", "API · token: ops", "Claude (API · OAuth)".
 */
export function apiActorLabel(client: string | null, token: string | null, oauthClient: string | null = null): string {
  if (oauthClient !== null) {
    const name = sanitizeName(client) || sanitizeName(oauthClient);
    return name ? `${name} (API · OAuth)` : "API · OAuth";
  }
  const name = sanitizeName(client);
  const tokenName = token === null ? null : sanitizeName(token);
  const door = tokenName === null ? "API" : tokenName ? `API · token: ${tokenName}` : "API · token";
  return name ? `${name} (${door})` : door;
}

// ---- OpenAPI ---------------------------------------------------------------

function routeParameters(route: Route, schema: Schema): unknown[] {
  const params: unknown[] = [];
  if (route.idArg) {
    params.push({
      name: "id",
      in: "path",
      required: true,
      description: route.idIsUuid ? "UUID" : "UUID or display_id (e.g. ELE_PLT-006)",
      schema: { type: "string" },
    });
  }
  if (route.method === "GET") {
    for (const [name, prop] of Object.entries(schema.properties ?? {})) {
      if (name === route.idArg) continue;
      params.push({ name, in: "query", required: (schema.required ?? []).includes(name), schema: prop });
    }
  }
  return params;
}

function bodySchema(route: Route, schema: Schema): { schema: Record<string, unknown>; required: string[] } {
  const properties: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    if (name === route.idArg) continue;
    properties[name] = NULLABLE_FIELDS.has(name) && prop.type ? { ...prop, type: [prop.type, "null"] } : prop;
  }
  const required = (schema.required ?? []).filter((k) => k !== route.idArg);
  return {
    schema: { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false },
    required,
  };
}

/** Pure. The OpenAPI 3.1 description of every route, built from the route table and the tools' schemas. */
export function openApiDocument(serverUrl: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    const def = toolDef(route.tool);
    const schema = def.input_schema as Schema;
    const error = { $ref: "#/components/responses/Error" };
    const errors = {
      ...(isReadTool(route.tool) ? {} : { "400": error, "403": error }),
      "401": error,
      "404": error,
      "405": error,
      "422": error,
      "500": error,
    };
    const body = route.method === "GET" ? null : bodySchema(route, schema);
    paths[route.path] ??= {};
    paths[route.path][route.method.toLowerCase()] = {
      operationId: route.tool,
      summary: route.summary,
      description: def.description,
      parameters: routeParameters(route, schema),
      ...(body
        ? { requestBody: { required: body.required.length > 0, content: { "application/json": { schema: body.schema } } } }
        : {}),
      responses: {
        [route.creates ? "201" : "200"]: { $ref: "#/components/responses/Data" },
        ...errors,
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Alcon API",
      version: "0.1.0",
      description: "Read and write the Alcon board as the person who issued the token. Reads: " +
        `${EXTERNAL_READ_TOOLS.length} routes; writes: ${EXTERNAL_WRITE_TOOLS.length} routes. ` +
        "Deletes and bulk changes are not offered.",
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "A personal access token (alc_pat_…) from Settings › Customize" },
      },
      responses: {
        Data: {
          description: "The result",
          content: { "application/json": { schema: { type: "object", properties: { data: {}, meta: { type: "object" } }, required: ["data"] } } },
        },
        Error: {
          description: "Why the request was refused",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  error: {
                    type: "object",
                    properties: { code: { type: "string" }, message: { type: "string" } },
                    required: ["code", "message"],
                  },
                },
                required: ["error"],
              },
            },
          },
        },
      },
    },
  };
}
