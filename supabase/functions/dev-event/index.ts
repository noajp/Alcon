// Ingress for events that happen outside the database.
//
// The self-build loop listens to the realtime stream. CI going red and a
// PR landing are events the loop needs, but they happen on GitHub, so this
// writes them into dev_events and they arrive on the same stream as everything
// else — one channel to drain instead of three.
//
// The reason this exists rather than having Actions talk to PostgREST directly:
// writing to the database needs the service role, and a workflow that holds the
// service role holds the whole database. Any install script in `npm ci` could
// read it out of the environment. This function holds the service role and CI
// holds a token that can do exactly one thing — file an event. If that token
// leaks, someone can post a fake CI failure, which is noise. If the service
// role leaked, they would own the data.
//
// Request:  POST { source, kind, ref?, title, url?, payload? }
//           header: x-dev-event-token
// Response: { id }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SOURCES = new Set(["github", "monitor", "agent", "human"]);

// Anything not on this list is rejected rather than stored. The loop dispatches
// on `kind`, so an unrecognised one is either a typo that would sit unnoticed
// in the ledger or someone probing — neither is worth persisting.
const KINDS = new Set([
  "ci_failed",
  "ci_passed",
  "pr_opened",
  "pr_merged",
  "review_comment",
  "stalled",
]);

interface Body {
  source?: string;
  kind?: string;
  ref?: string | null;
  title?: string;
  url?: string | null;
  payload?: unknown;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const expected = Deno.env.get("DEV_EVENT_TOKEN");
  if (!expected) return json({ error: "DEV_EVENT_TOKEN not configured" }, 500);

  const presented = req.headers.get("x-dev-event-token") ?? "";
  // Constant-time-ish: compare lengths first, then every byte, so a wrong token
  // does not reveal how much of it was right through timing.
  let ok = presented.length === expected.length;
  for (let i = 0; i < expected.length; i++) {
    ok = (presented.charCodeAt(i) === expected.charCodeAt(i)) && ok;
  }
  if (!ok) return json({ error: "unauthorized" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const source = String(body.source ?? "");
  const kind = String(body.kind ?? "");
  const title = String(body.title ?? "").trim();

  if (!SOURCES.has(source)) return json({ error: `unknown source: ${source}` }, 400);
  if (!KINDS.has(kind)) return json({ error: `unknown kind: ${kind}` }, 400);
  if (!title) return json({ error: "title is required" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "supabase env missing" }, 500);

  const res = await fetch(`${url}/rest/v1/dev_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      source,
      kind,
      ref: body.ref ?? null,
      // The listener prints this straight through as a notification, so cap it
      // here rather than letting a commit message become a wall of text.
      title: title.slice(0, 300),
      url: body.url ?? null,
      payload: body.payload ?? null,
    }),
  });

  if (!res.ok) return json({ error: `insert failed: ${await res.text()}` }, 502);

  const [row] = await res.json();
  return json({ id: row?.id });
});
