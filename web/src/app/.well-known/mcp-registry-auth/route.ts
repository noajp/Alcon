// MCP Registry domain proof (app.clayware namespace): the registry fetches
// this line to prove the publisher controls clayware.app, then accepts the
// signed login made with the matching private key. Served as a route
// handler because public/.well-known is not served by this app.
export function GET() {
  return new Response("v=MCPv1; k=ed25519; p=OYYgC/kPgJ+BWBJatf1+U8Sv5/GRHFLcOZ/Lt98uF3Y=\n", {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
