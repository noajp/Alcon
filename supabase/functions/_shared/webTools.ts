/**
 * Anthropic's server tools: web search and page fetch run on Anthropic's side
 * within the same model call, so they need no executor. Every entry that
 * calls the model takes them: a run, a conversation, the Copilot panel. The current
 * Sonnet and Opus take the variants that filter results with code; other
 * models get plain search only. `max_uses` caps one model call; research
 * needs room (5 ran out before a single market survey had its numbers), and
 * the run's cost cap still bounds the whole.
 */
export function webTools(model: string): Record<string, unknown>[] {
  const filtering = model === "claude-sonnet-5-5" || model === "claude-opus-5-5";
  if (!filtering) return [{ type: "web_search_20250305", name: "web_search", max_uses: 15 }];
  return [
    { type: "web_search_20260209", name: "web_search", max_uses: 15 },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 10 },
  ];
}

/** Pure. One line for the run log per server-tool call in a response. */
export function webSteps(content: { type: string; name?: string; input?: unknown }[]): string[] {
  return content.filter((b) => b.type === "server_tool_use").map((b) => {
    const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
    if (b.name === "web_search") return `Web 検索: ${String(input.query ?? "")}`;
    if (b.name === "web_fetch") return `Web ページ: ${String(input.url ?? "")}`;
    // The search tools filter their results with code under the hood.
    if (b.name === "code_execution") return "検索結果を絞り込み";
    if (b.name === "tool_search_tool_bm25") return `道具を探す: ${String(input.query ?? "")}`;
    return `${b.name ?? "server tool"}`;
  });
}
