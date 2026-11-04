// The browser on a person's own computer, as an agent's tools. A runner
// (sdk/node/alcon-runner.mjs) announces itself to the Space through the asset
// relay with the capability "browser"; once the person accepts it, their runs
// may ask it to open, read and click pages in a Chrome profile of its own.
// The call goes into asset_calls; the runner takes it, does it and answers.
// The runner refuses form submissions unless it was started to allow them, so
// these tools only read: no approval is asked. Pure: index.ts does the I/O.

import type { ToolDef } from "../_shared/boardTools.ts";

export const RUNNER_PREFIX = "pc_";

/** How recently a runner must have asked for work to count as on. */
export const RUNNER_ONLINE_MS = 2 * 60_000;

const PAGE_NOTE = "答えは、そのページの URL・タイトル・本文（長いと途中まで）・リンクの一覧（文字と URL）。";

export const RUNNER_TOOLS: ToolDef[] = [
  {
    name: "pc_open",
    description: `依頼した人の PC のブラウザで URL を開いて読む。検索では中身が取れない一覧ページ・検索結果・詳細ページに使う。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
  },
  {
    name: "pc_read",
    description: `PC のブラウザで今開いているページを読み直す。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "pc_click",
    description: `PC のブラウザで、見えている文字（リンク・ボタン・タブ・「次へ」など）をクリックし、移った先を読む。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: { text: { type: "string", description: "クリックする要素に書かれた文字" } }, required: ["text"], additionalProperties: false },
  },
  {
    name: "pc_type",
    description: `PC のブラウザで入力欄（検索欄・絞り込み条件など）に文字を入れる。submit が true なら Enter を押して結果を読む。${PAGE_NOTE}`,
    input_schema: {
      type: "object",
      properties: {
        field: { type: "string", description: "入力欄のラベル・プレースホルダ・近くの文字" },
        text: { type: "string" },
        submit: { type: "boolean" },
      },
      required: ["field", "text"],
      additionalProperties: false,
    },
  },
  {
    name: "pc_back",
    description: `PC のブラウザで前のページに戻って読む。${PAGE_NOTE}`,
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const NAMES = new Set(RUNNER_TOOLS.map((t) => t.name));

export function isRunnerTool(name: string): boolean {
  return NAMES.has(name);
}

/** Pure. The runner's own name for a tool: pc_open → open. */
export function runnerOperation(name: string): string {
  return name.startsWith(RUNNER_PREFIX) ? name.slice(RUNNER_PREFIX.length) : name;
}

export interface RunnerRow { id: string; name: string; manifest: unknown; last_seen_at: string | null }

/** Pure. The runner a run may use: one that offers a browser and asked for
 *  work recently, the most recent first. */
export function pickRunner(rows: readonly RunnerRow[], now: number): RunnerRow | null {
  const live = rows.filter((r) => {
    const caps = r.manifest && typeof r.manifest === "object" ? (r.manifest as { capabilities?: unknown }).capabilities : null;
    const browser = Array.isArray(caps) && caps.includes("browser");
    return browser && !!r.last_seen_at && now - new Date(r.last_seen_at).getTime() <= RUNNER_ONLINE_MS;
  });
  live.sort((a, b) => new Date(b.last_seen_at!).getTime() - new Date(a.last_seen_at!).getTime());
  return live[0] ?? null;
}

/** Pure. One line for the run log. */
export function runnerStep(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "pc_open": return `PC: 開く ${String(input.url ?? "")}`;
    case "pc_click": return `PC: クリック「${String(input.text ?? "")}」`;
    case "pc_type": return `PC: 入力「${String(input.field ?? "")}」← ${String(input.text ?? "")}`;
    case "pc_back": return "PC: 戻る";
    default: return "PC: 読む";
  }
}

/** Pure. The runner's answer as the agent reads it. */
export function runnerResultText(result: unknown): string {
  const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
  const links = Array.isArray(r.links) ? (r.links as { text?: unknown; href?: unknown }[]) : [];
  const lines = [
    `URL: ${String(r.url ?? "")}`,
    `タイトル: ${String(r.title ?? "")}`,
    "",
    String(r.text ?? "").slice(0, 14_000),
  ];
  if (links.length) {
    lines.push("", "# リンク");
    for (const l of links.slice(0, 120)) lines.push(`- ${String(l.text ?? "").slice(0, 80)} → ${String(l.href ?? "")}`);
  }
  if (r.note) lines.push("", `注: ${String(r.note)}`);
  return lines.join("\n").slice(0, 20_000);
}
