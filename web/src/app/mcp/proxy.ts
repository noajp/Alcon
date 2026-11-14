// Public MCP endpoint proxy (clayware.app/mcp).
//
// The MCP server itself is the `clayware-mcp` Supabase Edge Function. Its
// native URL exposes the Supabase project ref, which is fine functionally
// but ugly everywhere the endpoint is published (MCP Registry server.json,
// client directories, docs). This proxy is the public face: it forwards
// every request to the Edge Function and rewrites the few places where the
// upstream URL appears in responses — the `resource` field of the OAuth
// protected-resource metadata and the `resource_metadata` pointer in the
// 401 `WWW-Authenticate` header — so published URLs stay on clayware.app.
//
// The OAuth authorization server stays the Supabase Auth issuer on purpose:
// clients must talk to it directly for authorize/token/DCR, and its tokens
// carry that issuer. Only the resource URL is rebranded.

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://rkugtcqztkkacvoylupw.supabase.co"
).replace(/\/+$/, "");

const UPSTREAM_BASE = `${SUPABASE_URL}/functions/v1/clayware-mcp`;

function publicBase(request: Request): string {
  return `${new URL(request.url).origin}/mcp`;
}

const DROP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authorization",
  "proxy-connection",
]);

// Response headers that either break when the body is streamed through
// fetch (length/encoding describe the upstream hop, not this one) or leak
// Supabase gateway internals, including the project ref itself.
const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "content-encoding",
  "keep-alive",
  "transfer-encoding",
  "sb-project-ref",
  "sb-request-id",
  "sb-gateway-version",
  "x-sb-edge-region",
]);

export async function proxyToMcp(request: Request): Promise<Response> {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = request.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await request.arrayBuffer();

  const upstream = await fetch(UPSTREAM_BASE, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  const pub = publicBase(request);
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (DROP_RESPONSE_HEADERS.has(key.toLowerCase())) return;
    responseHeaders.set(key, value.split(UPSTREAM_BASE).join(pub));
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function protectedResourceMetadata(
  request: Request,
): Promise<Response> {
  const upstream = await fetch(
    `${UPSTREAM_BASE}/.well-known/oauth-protected-resource`,
    { headers: { accept: "application/json" } },
  );
  if (!upstream.ok) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
    });
  }
  const data = (await upstream.json()) as Record<string, unknown>;
  data.resource = publicBase(request);
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
