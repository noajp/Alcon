// OAuth protected-resource metadata, served under the MCP path for
// clients that look for it relative to the resource URL (the shape the
// upstream Edge Function itself uses). The canonical RFC 9728 location
// (/.well-known/oauth-protected-resource/mcp) serves the same document.
import { protectedResourceMetadata } from "../../proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return protectedResourceMetadata(request);
}
