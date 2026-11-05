// A definition: how a goal is to be carried out, as a person wrote it. It is
// Markdown with known headings; this file reads the parts the engine itself
// enforces (the metric a loop improves, the hard stops, how often to check,
// the output's shape) and leaves the rest as text the agent follows. Pure,
// so run-agent, the Planner and the tests read a definition the same way.
//
//   # 目的 / Goal              what the work is for
//   # 条件 / Conditions        the rules it works under
//   # 指標 / Metric            "- スコア（大きいほど良い）: how it is measured" — makes it a loop
//   # 進め方 / Procedure       one round, or the steps
//   # 止める条件 / Stop        目標 600,000 / $30 まで / 50 周まで, and free text
//   # 点検 / Checks (10周ごと)  the list a reviewer holds the work to
//   # 成果物の型 / Output       a fenced block (md / html / csv / json) the output must follow

export type OutputFormat = "markdown" | "html" | "csv" | "json";

export interface DefinitionMetric { name: string; direction: "max" | "min"; source: string }
export interface DefinitionStop { target: number | null; budgetUsd: number | null; maxRounds: number | null; text: string }
export interface DefinitionChecks { every: number | null; items: string[] }
export interface DefinitionOutput { format: OutputFormat; body: string }

export interface ParsedDefinition {
  sections: Record<SectionKey, string>;
  metric: DefinitionMetric | null;
  stop: DefinitionStop;
  checks: DefinitionChecks;
  output: DefinitionOutput | null;
}

export type SectionKey = "goal" | "conditions" | "metric" | "procedure" | "stop" | "checks" | "output";

const SECTION_NAMES: [SectionKey, RegExp][] = [
  ["goal", /^(目的|ゴール|goal|purpose)/i],
  ["conditions", /^(条件|前提|ルール|conditions?|rules)/i],
  ["metric", /^(指標|評価指標|metric|score)/i],
  ["procedure", /^(進め方|手順|ループ|procedure|steps|loop)/i],
  ["stop", /^(止める条件|終了条件|停止条件|stop)/i],
  ["checks", /^(点検|チェック|監査|checks?|audit)/i],
  ["output", /^(成果物の型|出力の型|成果物|output)/i],
];

/** Pure. The section a heading names, or null for a heading of the author's own. */
export function sectionOf(heading: string): SectionKey | null {
  const h = heading.trim();
  return SECTION_NAMES.find(([, re]) => re.test(h))?.[0] ?? null;
}

const bullets = (text: string) => text.split("\n").map((l) => /^\s*(?:[-*・]|\d+[.)])\s+(.+)$/.exec(l)?.[1]?.trim() ?? null).filter((x): x is string => !!x);

/** Pure. A number written with commas, 万 or k. */
function num(raw: string): number | null {
  const m = /([\d,]+(?:\.\d+)?)\s*(万|k|K)?/.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return m[2] === "万" ? n * 10_000 : m[2] ? n * 1000 : n;
}

export function parseDefinition(body: string): ParsedDefinition {
  const sections = { goal: "", conditions: "", metric: "", procedure: "", stop: "", checks: "", output: "" } as Record<SectionKey, string>;
  let current: SectionKey | null = null;
  let checksHeading = "";
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence ? /^#{1,3}\s+(.+?)\s*$/.exec(line) : null;
    if (h) {
      const key = sectionOf(h[1]);
      if (key) { current = key; if (key === "checks") checksHeading = h[1]; continue; }
    }
    if (current) sections[current] += `${line}\n`;
  }
  for (const k of Object.keys(sections) as SectionKey[]) sections[k] = sections[k].trim();

  const metricLine = bullets(sections.metric)[0] ?? sections.metric.split("\n")[0] ?? "";
  const metric: DefinitionMetric | null = metricLine
    ? {
      name: metricLine.split(/[（(:：]/)[0].trim() || "指標",
      direction: /小さいほど|低いほど|少ないほど|lower|min/i.test(metricLine) ? "min" : "max",
      source: metricLine.split(/[:：]/).slice(1).join(":").trim(),
    }
    : null;

  const stopLines = bullets(sections.stop);
  const find = (re: RegExp) => { const l = stopLines.find((x) => re.test(x)); return l ? num(l.replace(/^[^\d]*/, "")) : null; };
  const stop: DefinitionStop = {
    target: find(/目標|target|到達|届いたら/i),
    budgetUsd: (() => { const l = stopLines.find((x) => /\$|ドル|usd|費用|予算/i.test(x)); const m = l && /\$\s*([\d,.]+)|([\d,.]+)\s*(?:ドル|usd)/i.exec(l); return m ? Number((m[1] ?? m[2]).replace(/,/g, "")) : null; })(),
    maxRounds: (() => { const l = stopLines.find((x) => /周|回|rounds?|iterations?/i.test(x) && !/前/.test(x)); const m = l && /([\d,]+)\s*(?:周|回|rounds?|iterations?)/i.exec(l); return m ? Number(m[1].replace(/,/g, "")) : null; })(),
    text: sections.stop,
  };

  const everyM = /(\d+)\s*(?:周|回|rounds?)\s*(?:ごと|おき|毎|each|every)/i.exec(checksHeading) ?? /every\s*(\d+)/i.exec(checksHeading);
  const checks: DefinitionChecks = { every: everyM ? Number(everyM[1]) : null, items: bullets(sections.checks) };

  let output: DefinitionOutput | null = null;
  if (sections.output) {
    const fence = /```\s*([a-zA-Z]*)\s*\n([\s\S]*?)```/.exec(sections.output);
    const lang = (fence?.[1] ?? "").toLowerCase();
    const format: OutputFormat = lang === "html" ? "html" : lang === "csv" ? "csv" : lang === "json" ? "json" : "markdown";
    const body = (fence ? fence[2] : sections.output).trim();
    if (body) output = { format, body };
  }
  return { sections, metric, stop, checks, output };
}

// ── The output's shape ───────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{[^}]*\}\}/g;
const norm = (s: string) => s.replace(PLACEHOLDER, "").replace(/\s+/g, " ").trim();

/** Pure. The fixed headings of a Markdown output shape, in order. */
export function shapeHeadings(body: string): string[] {
  return body.split("\n")
    .map((l) => /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(l.trim())?.[1] ?? null)
    .filter((h): h is string => !!h).map(norm).filter(Boolean);
}

/** Pure. What an output lacks against the shape it must follow (empty: it follows it). */
export function checkOutput(shape: DefinitionOutput, content: string, format: string): string[] {
  if (format !== shape.format) return [`format は ${shape.format} にしてください（今は ${format}）。`];
  const problems: string[] = [];
  const unfilled = () => { if (/\{\{[^}]*\}\}/.test(content)) problems.push("{{…}} が埋まっていない箇所があります。"); };
  switch (shape.format) {
    case "markdown": {
      const have = shapeHeadings(content);
      for (const h of shapeHeadings(shape.body)) if (!have.some((x) => x === h || x.startsWith(h))) problems.push(`見出し「${h}」がありません。`);
      unfilled();
      break;
    }
    case "html": {
      for (const style of shape.body.match(/<style[\s\S]*?<\/style>/gi) ?? []) if (!content.includes(style)) problems.push("型の <style> を変えずにそのまま含めてください。");
      for (const slot of new Set([...shape.body.matchAll(/data-slot="([^"]+)"/g)].map((m) => m[1]))) {
        if (!content.includes(`data-slot="${slot}"`)) problems.push(`data-slot="${slot}" の要素がありません。`);
      }
      unfilled();
      break;
    }
    case "csv": {
      const header = (s: string) => (s.split(/\r?\n/).find((l) => l.trim()) ?? "").split(",").map((c) => c.trim().replace(/^"|"$/g, "")).join(",");
      if (header(content) !== header(shape.body)) problems.push(`1 行目の見出しは「${header(shape.body)}」にしてください。`);
      break;
    }
    case "json": {
      let value: unknown;
      try { value = JSON.parse(content); } catch { problems.push("JSON として読めません。"); break; }
      let schema: { required?: unknown } | null = null;
      try { schema = JSON.parse(shape.body); } catch { /* not a schema: parsing is the only check */ }
      const required = Array.isArray(schema?.required) ? (schema!.required as unknown[]).filter((k): k is string => typeof k === "string") : [];
      const obj = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
      for (const k of required) if (!obj || !(k in obj)) problems.push(`項目「${k}」がありません。`);
      break;
    }
  }
  return problems;
}

// ── Loops ────────────────────────────────────────────────────────────────────

/** Pure. Whether a loop must stop after this round, and why (null: go on). */
export function loopStop(def: ParsedDefinition, rounds: { value: number | null }[], costUsd: number): string | null {
  const values = rounds.map((r) => r.value).filter((v): v is number => typeof v === "number");
  if (def.stop.target != null && def.metric && values.length) {
    const best = def.metric.direction === "max" ? Math.max(...values) : Math.min(...values);
    if (def.metric.direction === "max" ? best >= def.stop.target : best <= def.stop.target) return `目標 ${def.stop.target} に到達しました（最良 ${best}）。`;
  }
  if (def.stop.maxRounds != null && rounds.length >= def.stop.maxRounds) return `上限の ${def.stop.maxRounds} 周に達しました。`;
  if (def.stop.budgetUsd != null && costUsd >= def.stop.budgetUsd) return `費用の上限 $${def.stop.budgetUsd} に達しました。`;
  return null;
}

/** Pure. Whether this round is one the checks fall on. */
export function checksDue(def: ParsedDefinition, round: number): boolean {
  return def.checks.items.length > 0 && def.checks.every != null && round > 0 && round % def.checks.every === 0;
}

/** Pure. What the agent is told: the definition is the person's, and it governs. */
export function definitionPrompt(name: string, body: string, def: ParsedDefinition): string {
  const loop = def.metric
    ? `\n\n## この定義はループ型\n指標「${def.metric.name}」（${def.metric.direction === "max" ? "大きいほど良い" : "小さいほど良い"}）を改善する。1 周ごとに必ず record_round を呼び、計測した値・変えたこと・残したか戻したかを記録する。止める条件はエンジンも判定し、満たしたら知らせる。`
    : "";
  const shape = def.output ? `\n\n## 成果物の型\n成果物は format: ${def.output.format} で save_artifact し、「成果物の型」に従う。外れた成果物は保存の時点で差し戻される。` : "";
  return `# 定義「${name}」（依頼した人が定めた進め方。これに従う）
${body.slice(0, 40_000)}${loop}${shape}`;
}

/** Pure. How the engine read a definition — what it will enforce and what
 *  it found missing — so the person can check the reading before any work
 *  runs on it. */
export function definitionReading(def: ParsedDefinition): { reads: string[]; missing: string[] } {
  const reads: string[] = [];
  const missing: string[] = [];
  if (def.sections.goal) reads.push(`目的: ${def.sections.goal.split("\n")[0].slice(0, 120)}`);
  else missing.push("目的（# 目的）がありません");
  if (def.metric) reads.push(`指標: ${def.metric.name}（${def.metric.direction === "max" ? "大きいほど良い" : "小さいほど良い"}）。ループ型として 1 周ごとに記録させます`);
  const stop: string[] = [];
  if (def.stop.target != null) stop.push(`目標値 ${def.stop.target}`);
  if (def.stop.budgetUsd != null) stop.push(`費用 $${def.stop.budgetUsd}`);
  if (def.stop.maxRounds != null) stop.push(`${def.stop.maxRounds} 周`);
  if (stop.length) reads.push(`止める条件（エンジンが判定）: ${stop.join("・")}`);
  else if (def.sections.stop) reads.push("止める条件: 数値として読み取れるものはなく、文章としてエージェントに渡します");
  else missing.push(def.metric ? "ループ型なのに止める条件（# 止める条件）がありません" : "止める条件（# 止める条件）がありません");
  if (def.checks.items.length) reads.push(`点検: ${def.checks.items.length} 項目${def.checks.every ? `、${def.checks.every} 周ごと` : ""}`);
  if (def.output) reads.push(`成果物の型: ${def.output.format}${def.output.format === "markdown" ? `（見出し ${shapeHeadings(def.output.body).length} 個を保存時に確かめます）` : ""}`);
  else missing.push("成果物の型（# 成果物の型）がないため、保存時に型を確かめません");
  return { reads, missing };
}
