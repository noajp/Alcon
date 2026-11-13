// The public MCP registry (registry.modelcontextprotocol.io) as a directory
// of connectors a Space can add: each server that runs remotely over HTTPS
// becomes an entry with what adding it needs (the endpoint and how it
// authenticates). Servers that only run on a machine (packages) are left
// out: Clayware calls its connections from the cloud. Pure, so the
// connector-directory function and the tests read the registry alike.

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

export interface DirectoryEntry {
  /** The registry's name (reverse-DNS, e.g. com.notion/mcp). */
  id: string;
  title: string;
  description: string;
  endpoint: string;
  /** How a request carries the credential: none, a bearer token, or a named header. */
  auth: "none" | "bearer" | "header";
  authHeader: string | null;
  website: string | null;
  icon: string | null;
  version: string;
}

const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function httpsUrl(v: unknown): string | null {
  try {
    const u = new URL(String(v));
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

const GENERIC = new Set(["mcp", "server", "mcp-server", "mcp_server", "remote", "api"]);

/** Pure. A readable name from a registry name: its last part, or the
 *  organisation's when that part says nothing (com.notion/mcp → Notion). */
export function titleFromName(id: string): string {
  const [ns, last = ""] = id.split("/");
  const labels = ns.split(".");
  const word = GENERIC.has(last.toLowerCase()) ? (labels[1] ?? labels[0] ?? last) : last;
  const text = word.replace(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : id;
}

/** Pure. A registry server as a directory entry, or null when it cannot be called remotely. */
export function entryOf(raw: unknown): DirectoryEntry | null {
  const s = obj(obj(raw)?.server) ?? obj(raw);
  if (!s) return null;
  const remotes = (Array.isArray(s.remotes) ? s.remotes : []).map(obj).filter((r): r is Record<string, unknown> => !!r);
  // Streamable HTTP first: Clayware's MCP client speaks it.
  const remote = remotes.find((r) => r.type === "streamable-http" && httpsUrl(r.url)) ?? null;
  if (!remote) return null;
  const id = str(s.name, 200);
  if (!id) return null;
  const headers = (Array.isArray(remote.headers) ? remote.headers : []).map(obj).filter((h): h is Record<string, unknown> => !!h);
  const authHeader = headers.find((h) => /^authorization$/i.test(str(h.name))) ?? headers.find((h) => h.isSecret === true || h.isRequired === true) ?? null;
  const auth = !authHeader ? "none" : /^authorization$/i.test(str(authHeader.name)) ? "bearer" : "header";
  const icons = (Array.isArray(s.icons) ? s.icons : []).map(obj).filter((i): i is Record<string, unknown> => !!i);
  return {
    id,
    title: str(s.title, 120) || titleFromName(id),
    description: str(s.description, 400),
    endpoint: httpsUrl(remote.url)!,
    auth,
    authHeader: auth === "header" ? str(authHeader!.name, 100) : null,
    website: httpsUrl(s.websiteUrl),
    icon: httpsUrl(icons[0]?.src),
    version: str(s.version, 40),
  };
}

/** Pure. A page of the registry as entries: remote ones only, one per server. */
export function entriesOf(page: unknown): { entries: DirectoryEntry[]; nextCursor: string | null } {
  const p = obj(page);
  const seen = new Set<string>();
  const entries: DirectoryEntry[] = [];
  for (const raw of Array.isArray(p?.servers) ? p!.servers : []) {
    const e = entryOf(raw);
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push(e);
  }
  const next = obj(p?.metadata)?.nextCursor;
  return { entries, nextCursor: typeof next === "string" && next ? next : null };
}
