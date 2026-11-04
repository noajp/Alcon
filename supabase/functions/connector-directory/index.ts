// connector-directory — the public MCP registry, searched for connectors a
// Space can add (Settings › Customize › Connectors › Discover). The browser
// cannot read the registry itself (no CORS), so this passes a search through
// and answers only the remote servers, as entries (_shared/connectorDirectory.ts).
//
//   GET ?q=<search>&cursor=<next>  (JWT) → { entries, nextCursor }
//
// Reads a public, read-only API; nothing is stored.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { REGISTRY_URL, entriesOf } from "../_shared/connectorDirectory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "content-type": "application/json", "cache-control": "private, max-age=300" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // The platform checks the JWT (verify_jwt); a body is accepted for supabase-js invoke.
  let q = "", cursor = "";
  const url = new URL(req.url);
  q = url.searchParams.get("q") ?? "";
  cursor = url.searchParams.get("cursor") ?? "";
  if (req.method === "POST") {
    try {
      const b = await req.json() as { q?: unknown; cursor?: unknown };
      if (typeof b.q === "string") q = b.q;
      if (typeof b.cursor === "string") cursor = b.cursor;
    } catch { /* empty body */ }
  }
  const target = new URL(REGISTRY_URL);
  target.searchParams.set("version", "latest");
  target.searchParams.set("limit", "60");
  if (q.trim()) target.searchParams.set("search", q.trim().slice(0, 100));
  if (cursor) target.searchParams.set("cursor", cursor.slice(0, 300));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(target, { headers: { accept: "application/json" }, signal: ctl.signal });
    if (!res.ok) return json({ error: `the registry answered ${res.status}` }, 502);
    return json(entriesOf(await res.json()));
  } catch (e) {
    return json({ error: e instanceof Error && e.name === "AbortError" ? "the registry did not answer in time" : "could not reach the registry" }, 502);
  } finally {
    clearTimeout(t);
  }
});
