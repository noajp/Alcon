// Public MCP endpoint: clayware.app/mcp — a streaming proxy in front of
// the clayware-mcp Edge Function. See ./proxy.ts for why this exists and
// what it rewrites. Edge runtime so SSE responses stream without the
// serverless duration limits that would cut long tool calls short.
import { proxyToMcp } from "./proxy";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return proxyToMcp(request);
}

export function POST(request: Request) {
  return proxyToMcp(request);
}

export function DELETE(request: Request) {
  return proxyToMcp(request);
}

export function OPTIONS(request: Request) {
  return proxyToMcp(request);
}
