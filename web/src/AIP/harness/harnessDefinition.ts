// A harness: how a kind of work is carried out by AI, as a person wrote it.
// It is Markdown with known headings (stored in the `definitions` table);
// this file reads the parts the engine itself enforces (the metric a loop
// improves, the hard stops, how often to check, the output's shape, the
// connectors it uses, how a Strategy is broken down, who takes the work) and leaves the rest as
// text the agent follows, and checks a harness before it is used
// (checkHarness). Pure, so run-agent, the Planner, the editor and the tests
// read a harness the same way. The editor's copy,
// web/src/AIP/harness/harnessDefinition.ts, is this file byte for
// byte (a test keeps them equal): change this one and copy it over.
//
//   # 目的 / Goal              what the work is for
//   # 条件 / Conditions        the rules it works under — including freshness
//                              declarations ("- 価格の鮮度: 30分まで"): how old
//                              a fact of a type may be before a finish's claim
//                              to it counts as stale (see DEFAULT_FRESHNESS)
//   # 指標 / Metric            "- スコア（大きいほど良い）: how it is measured" — makes it a loop
//   # 進め方 / Procedure       one round, or the steps
//   # 止める条件 / Stop        目標 600,000 / $30 まで / 50 周まで, and free text
//   # 点検 / Checks (10周ごと)  the list a reviewer holds the work to
//   # 成果物の型 / Output       a fenced block (md / html / csv / json) the output must follow
//   # 使うコネクタ / Connectors "- GitHub": the connectors the work needs
//   # 分け方 / Breakdown       how the Planner breaks a Strategy into Objects and Elements
//   # 担当の決め方 / Assignment which person of the Space the Planner gives a person's task to

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
  /** The connectors the work needs, by name as the Space connected them. */
  connectors: string[];
  /** Freshness bounds declared in Conditions, by data type: the max age (ms)
   *  a fact of that type may have before a finish's claim to it is stale.
   *  Declared only — freshnessTableOf layers these over the defaults. */
  freshness: FreshnessTable;
}

/** How old a fact of a data type may be, in ms, before a claim to it is stale. */
export type FreshnessTable = Record<string, number>;

export type SectionKey = "goal" | "conditions" | "metric" | "procedure" | "stop" | "checks" | "output" | "connectors" | "breakdown" | "assignment";

const SECTION_NAMES: [SectionKey, RegExp][] = [
  ["goal", /^(目的|ゴール|goal|purpose)/i],
  ["conditions", /^(条件|前提|ルール|conditions?|rules)/i],
  ["metric", /^(指標|評価指標|metric|score)/i],
  ["procedure", /^(進め方|手順|ループ|procedure|steps|loop)/i],
  ["stop", /^(止める条件|終了条件|停止条件|stop)/i],
  ["checks", /^(点検|チェック|監査|checks?|audit)/i],
  ["output", /^(成果物の型|出力の型|成果物|output)/i],
  ["connectors", /^(使うコネクタ|コネクタ|connectors?)/i],
  ["breakdown", /^(分け方|分解の仕方|分解|breakdown|decomposition)/i],
  ["assignment", /^(担当の決め方|担当|assignment)/i],
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
  const sections = { goal: "", conditions: "", metric: "", procedure: "", stop: "", checks: "", output: "", connectors: "", breakdown: "", assignment: "" } as Record<SectionKey, string>;
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
  const connectors = [...new Set(bullets(sections.connectors).map((c) => c.split(/[（(:：]/)[0].trim()).filter(Boolean))];
  const freshness = parseFreshness(sections.conditions);
  return { sections, metric, stop, checks, output, connectors, freshness };
}

// ── Freshness: how old a fact may be before a claim to it is stale ─────────
// A finish states facts as typed claims (finishClaims.ts); code, not the
// verifier, judges whether a claim's source is fresh enough for its data
// type. Every definition inherits the shipped bounds below; its Conditions
// may override per type ("- 価格の鮮度: 30分まで", "- freshness (stock): 12
// hours") or declare bounds for its own types. A type with no bound anywhere
// carries no freshness obligation — a source is still required when the run
// read the world.

const MINUTE_MS = 60_000;

/** The freshness bounds every definition inherits (owner-tunable posture). */
export const DEFAULT_FRESHNESS: FreshnessTable = {
  price: 30 * MINUTE_MS,               // prices / quotes: 30 minutes
  availability: 24 * 60 * MINUTE_MS,   // inventory / availability: 1 day
  org: 30 * 24 * 60 * MINUTE_MS,       // org / people facts: 30 days
  legal: 7 * 24 * 60 * MINUTE_MS,      // regulatory / legal text: 7 days
};

const FRESHNESS_TYPES: [string, RegExp][] = [
  ["price", /価格|料金|相場|単価|見積|price|quote|cost/i],
  ["availability", /在庫|空き|空席|予約状況|availability|inventory|stock/i],
  ["org", /組織|人物|会社|担当者|org|people|person|company/i],
  ["legal", /法規|法令|規約|約款|legal|regulation/i],
];

/** Pure. The shipped data type a name or sentence names, or null. */
export function freshnessKeyFor(text: string): string | null {
  return FRESHNESS_TYPES.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** Pure. The key a freshness table is indexed by for a type name: the
 *  shipped type when the name names one, else the folded name itself — so a
 *  definition's own type ("天気") and a claim's type meet at the same key. */
export function freshnessLookupKey(name: string): string {
  return freshnessKeyFor(name) ?? fold(name);
}

/** Pure. A duration written in a Conditions bullet ("30分", "12 hours"):
 *  its length in ms and where it starts, so the text before it can be read
 *  as the type's name. */
function parseDuration(text: string): { ms: number; index: number } | null {
  const m = /(\d+(?:\.\d+)?)\s*(ヶ月|カ月|月|分|時間|日|週|minutes?|mins?|hours?|hrs?|days?|weeks?|months?)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const unit = u === "分" || u.startsWith("min") ? MINUTE_MS
    : u === "時間" || u.startsWith("hour") || u.startsWith("hr") ? 60 * MINUTE_MS
    : u === "日" || u.startsWith("day") ? 24 * 60 * MINUTE_MS
    : u === "週" || u.startsWith("week") ? 7 * 24 * 60 * MINUTE_MS
    : 30 * 24 * 60 * MINUTE_MS; // ヶ月・カ月・月・months
  return { ms: n * unit, index: m.index };
}

/** Pure. The freshness bounds a Conditions section declares, by lookup key. */
function parseFreshness(conditions: string): FreshnessTable {
  const out: FreshnessTable = {};
  for (const b of bullets(conditions)) {
    if (!/鮮度|fresh/i.test(b)) continue;
    const d = parseDuration(b);
    if (!d) continue;
    const named = freshnessKeyFor(b);
    if (named) { out[named] = d.ms; continue; }
    const name = b.slice(0, d.index).replace(/鮮度|fresh(ness)?/gi, "").replace(/[（()）]/g, "").replace(/[\s:：=のはまで]+$/u, "").trim();
    if (name) out[fold(name)] = d.ms;
  }
  return out;
}

/** Pure. The bounds a run lives under: the shipped defaults, overridden per
 *  type by the definition's own declarations. */
export function freshnessTableOf(def: ParsedDefinition | null): FreshnessTable {
  return { ...DEFAULT_FRESHNESS, ...(def?.freshness ?? {}) };
}

// ── Checking a harness ───────────────────────────────────────────────────────

export type Severity = "error" | "warning" | "hint";

/** One thing a check found: a stable code, how serious it is, and how to fix it. */
export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  fix?: string;
}

/** What a harness is checked against: the Space's connections (name or preset), when known. */
export interface HarnessContext {
  connected?: string[] | null;
}

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

/**
 * Pure. What is wrong or missing in a harness, errors first. An error means
 * the engine cannot run it as written (a loop that never stops); a warning,
 * that it runs but not as the author likely meant; a hint, something worth
 * adding. Codes are stable so the editor and tests can refer to them.
 */
export function checkHarness(def: ParsedDefinition, ctx: HarnessContext = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const machineStop = def.stop.target != null || def.stop.budgetUsd != null || def.stop.maxRounds != null;
  if (!def.sections.goal) {
    out.push({ code: "H001", severity: "error", message: "目的がありません。", fix: "「# 目的」の見出しを作り、この仕事が何のためかを 1〜2 行で書いてください。" });
  }
  if (def.metric && !machineStop) {
    out.push({ code: "H002", severity: "error", message: "指標を改善し続けるループなのに、エンジンが判定できる止める条件がありません。止まらずに回り続けます。", fix: "「# 止める条件」に「- 50 周まで」「- 費用 $30 まで」「- 目標 600,000」のどれかを書いてください。" });
  }
  if (!def.metric && !def.sections.stop) {
    out.push({ code: "H003", severity: "warning", message: "止める条件がありません。", fix: "「# 止める条件」に、どこまでやったら終わりか、どこで人に聞くかを書いてください。" });
  } else if (def.sections.stop && !machineStop) {
    out.push({ code: "H004", severity: "hint", message: "止める条件に数値がないので、エンジンは判定せず、文章として AI に渡します。", fix: "上限を強制したいときは「- 費用 $10 まで」や「- 20 周まで」を足してください。" });
  }
  if (ctx.connected) {
    const have = new Set(ctx.connected.map(fold));
    for (const c of def.connectors) {
      if (!have.has(fold(c))) out.push({ code: "H005", severity: "warning", message: `コネクタ「${c}」がこの Space につながっていません。`, fix: "設定 › AI › コネクタでつなぐか、「# 使うコネクタ」から外してください。" });
    }
  }
  if (!def.output) {
    out.push({ code: "H006", severity: "hint", message: "成果物の型がないので、保存時に形を確かめません。", fix: "「# 成果物の型」に、見出しだけの Markdown などを ``` で囲んで書いてください。" });
  }
  const rank: Record<Severity, number> = { error: 0, warning: 1, hint: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
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
