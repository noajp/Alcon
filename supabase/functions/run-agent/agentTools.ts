import { BOARD_TOOLS, type ToolDef } from "../_shared/boardTools.ts";
import { RECORD_TOOLS } from "./records.ts";
import { STRATEGY_TOOLS } from "../_shared/strategyTools.ts";
import type { ToolKind } from "./loop.ts";

// What an Element-executing agent can do. The board and strategy tools are
// the same caller-scoped ones the Copilot and the MCP server use (RLS decides
// what each call may touch); the internal tools are how the agent reports.
// External services (integrations) add their own tools at run time.

export const INTERNAL_TOOLS: ToolDef[] = [
  {
    name: "record_plan",
    description: "作業の計画を宣言する。最初に一度呼ぶ。計画が大きく変わったら呼び直してよい。",
    input_schema: {
      type: "object",
      properties: { steps: { type: "array", items: { type: "string" }, description: "2〜8 個の手順" } },
      required: ["steps"],
      additionalProperties: false,
    },
  },
  {
    name: "log_progress",
    description: "進捗・判断・調べた結果を作業ログに残す。人が後から追えるように、節目ごとに短く書く。",
    input_schema: {
      type: "object",
      properties: { title: { type: "string" }, detail: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_subelement",
    description: "この Element の Sub-element（この Element を親に持つ Element）のうち、終えたものを完了（status done）にする。新しい Sub-element は作らない。",
    input_schema: {
      type: "object",
      properties: { subelement_id: { type: "string" }, note: { type: "string" } },
      required: ["subelement_id"],
      additionalProperties: false,
    },
  },
  {
    name: "save_artifact",
    description: "成果物（文書・表・下書き・データなど）を Element に保存する。Space の Artifacts にもファイル（markdown なら .md）として置かれ、Element を見られる人なら誰でも読める。title には版番号や日付を入れない：同じ title で保存し直すと、同じファイルの新しい版になる。任務が成果物を求めるときだけ使う。",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "成果物の本文" },
        format: { type: "string", enum: ["markdown", "html", "text", "csv", "json"] },
      },
      required: ["title", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "任務を終える。必ず最後に一度呼ぶ。outcome: completed（達成）/ partial（一部だけ）/ blocked（人の判断や資格情報が要る）。message は Element にコメントとして残る完了報告で、何をしたか・件数・失敗・残り・人に確認してほしいことを具体的に書く。",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["completed", "partial", "blocked"] },
        summary: { type: "string", description: "1 行の要約" },
        message: { type: "string", description: "完了報告（Markdown）" },
      },
      required: ["outcome", "summary", "message"],
      additionalProperties: false,
    },
  },
];

/**
 * Anthropic's server tools: web search and page fetch run on Anthropic's side
 * within the same model call, so they need no executor here. The current
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

/** The board tools an agent may use: reads, and everyday writes. No deletes, no bulk writes. */
export const AGENT_BOARD_TOOL_NAMES = [
  "listObjects", "listElements", "getElement", "findByText", "getProgress", "getRecentActivity", "listWorkers",
  "createElement", "updateElement", "addElementComment", "addElementAssignee", "setElementLabels",
  "createSubelement", "toggleSubelementComplete",
] as const;

export const AGENT_STRATEGY_TOOL_NAMES = ["listInitiatives", "getInitiative"] as const;

/** A round of a loop, for an Element whose definition names a metric. */
export const ROUND_TOOL: ToolDef = {
  name: "record_round",
  description: "ループの 1 周を記録する。計測した指標の値・変えたこと・残したか戻したかを書く。止める条件や点検の周に当たれば、答えで知らせる。",
  input_schema: {
    type: "object",
    properties: {
      value: { type: "number", description: "この周で計測した指標の値。計測できなかったら省く" },
      change: { type: "string", description: "この周で変えたこと（仮説と変更）" },
      kept: { type: "boolean", description: "変更を残したら true、戻したら false" },
      note: { type: "string" },
    },
    required: ["change", "kept"],
    additionalProperties: false,
  },
};

// Saving and reading the Strategy's Tables is the run's own work, like saving an artifact.
const INTERNAL = new Set([...INTERNAL_TOOLS.map((t) => t.name), ROUND_TOOL.name, ...RECORD_TOOLS.map((t) => t.name)]);
const BOARD = new Set<string>(AGENT_BOARD_TOOL_NAMES);
const STRATEGY = new Set<string>(AGENT_STRATEGY_TOOL_NAMES);

export function baseAgentTools(): ToolDef[] {
  const pick = (defs: ToolDef[], names: Set<string>) => defs.filter((d) => names.has(d.name));
  return [...INTERNAL_TOOLS, ...pick(BOARD_TOOLS, BOARD), ...pick(STRATEGY_TOOLS, STRATEGY)];
}

/** Integration tools are named `<prefix>__<tool>`; everything else is ours. */
export const INTEGRATION_SEPARATOR = "__";

export function baseKindOf(name: string): ToolKind | null {
  if (name === "finish") return "finish";
  if (INTERNAL.has(name)) return "internal";
  if (BOARD.has(name) || STRATEGY.has(name)) return "board";
  return null;
}

export function isStrategyTool(name: string): boolean {
  return STRATEGY.has(name);
}

/** Pure. A tool-name prefix for an integration, stable across a run's slices (keyed on its id). */
export function integrationPrefix(name: string, id: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 16);
  return `${base || "x"}_${id.replace(/-/g, "").slice(0, 4)}`;
}

/** Pure. "Echo Test · POST /notify × 3、Linear · create_issue" — one line for a batch of writes. */
export function approvalSummary(display: { integration: string; operation: string }[]): string {
  const groups = new Map<string, number>();
  for (const d of display) {
    const key = `${d.integration} · ${d.operation || "書き込み"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()].map(([k, n]) => (n > 1 ? `${k} × ${n}` : k)).join("、");
}
