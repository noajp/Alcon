// Which tool definitions a run loads up front. The board, the definition's
// round, and the person's own runner are always there; a connection's tools
// are many (a GitHub server alone brings dozens) and most runs use a few.
// Past a handful they are deferred: the model sees only their names through
// the tool search tool and loads a definition when it searches for it.
// Deferred definitions stay out of the cached prefix, so a search appends
// and never invalidates the cache. Pure: index.ts and the tests share it.

import type { ToolDef } from "./boardTools.ts";

/** A tool as a run freezes it: whether it was deferred is part of the prefix. */
export type RunToolDef = ToolDef & { defer?: boolean };

/** Connection tools beyond this many are deferred (the search step costs a
 *  turn, which pays only once there are more than a model needs at a glance). */
export const DEFER_AFTER = 10;

export const TOOL_SEARCH = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" } as const;

/** Pure. The tools with deferral decided: the always-loaded ones untouched,
 *  the rest deferred together when there are more than `limit` of them. */
export function withDeferral(always: ToolDef[], deferrable: ToolDef[], limit = DEFER_AFTER): RunToolDef[] {
  const defer = deferrable.length > limit && always.length > 0;
  return [...always, ...deferrable.map((t) => (defer ? { ...t, defer: true } : t))];
}

/** Pure. True when the run needs the tool search tool. */
export function needsToolSearch(tools: RunToolDef[]): boolean {
  return tools.some((t) => t.defer);
}

/**
 * Pure. The `tools` entries the request sends: loaded tools first with the
 * cache mark on the last of them (a deferred tool may not carry one), then
 * the deferred ones. Another provider gets no deferral and no search.
 */
export function toolParamsFor(tools: RunToolDef[], cache: Record<string, unknown>, external: boolean): Record<string, unknown>[] {
  const plain = (t: RunToolDef) => ({ name: t.name, description: t.description, input_schema: t.input_schema });
  if (external) return tools.map((t, i) => ({ ...plain(t), ...(i === tools.length - 1 ? cache : {}) }));
  const loaded = tools.filter((t) => !t.defer);
  const deferred = tools.filter((t) => t.defer);
  return [
    ...loaded.map((t, i) => ({ ...plain(t), ...(i === loaded.length - 1 ? cache : {}) })),
    ...deferred.map((t) => ({ ...plain(t), defer_loading: true })),
  ];
}
