// RFC 9728 protected-resource metadata for the public MCP endpoint
// (resource: https://clayware.app/mcp). Proxied from the clayware-mcp
// Edge Function with the resource URL rewritten to clayware.app;
// authorization_servers intentionally remains the Supabase Auth issuer.
import { protectedResourceMetadata } from "../../../mcp/proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return protectedResourceMetadata(request);
}
