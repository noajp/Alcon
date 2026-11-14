// Some MCP clients probe the bare /.well-known/oauth-protected-resource
// path without the resource-path suffix. Serve the same metadata document
// as /.well-known/oauth-protected-resource/mcp so both probes succeed.
import { protectedResourceMetadata } from "../../mcp/proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return protectedResourceMetadata(request);
}
