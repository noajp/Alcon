// The things a Strategy is about, as rows of a Table: the candidate houses,
// the vendors, the accounts. A run saves what it found as records keyed on
// one column, so the next run reads and narrows them instead of finding them
// again in a report's prose. Pure: what to add and change is decided here;
// recordStore.ts reads and writes the Table.

import type { ToolDef } from "../_shared/boardTools.ts";

export type ColumnType = "text" | "number" | "date" | "checkbox";
export type Cell = string | number | boolean | null;
export type Record_ = Record<string, Cell>;

export interface ExistingColumn { id: string; name: string; type: string }
export interface ExistingRow { id: string; cells: Record<string, unknown> }

/** Records one call may save, and the columns one Table may have. */
export const MAX_RECORDS = 200;
export const MAX_COLUMNS = 40;

export const RECORD_TOOLS: ToolDef[] = [
  {
    name: "save_records",
    description: "この Strategy の表に、見つけた対象（候補・相手・物など）を行として保存する。key の列が同じ行は更新し、新しいものは足す。列は名前で指定し、ない列は作られる。成果物の文章に書くだけでなく、後の仕事が使う対象は必ずここに保存する。",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表の名前（例: 候補物件）。この Strategy の表に同じ名前があればそれに、なければ新しく作る" },
        key: { type: "string", description: "行を見分ける列の名前（例: URL、名前）。同じ値の行は同じ対象として更新する" },
        records: {
          type: "array",
          description: "行。列名 → 値。金額・広さ・件数などは単位を付けない数値で入れる（例: 家賃 198000、広さ 94.77）。単位は列名に書く（例: 家賃（円/月））。分からない値は null（空）にし、「未確認」などの文字を入れない。補足は別の列（備考など）に書く。日付は YYYY-MM-DD",
          items: { type: "object", additionalProperties: { type: ["string", "number", "boolean", "null"] } },
        },
      },
      required: ["table", "key", "records"],
      additionalProperties: false,
    },
  },
  {
    name: "read_records",
    description: "この Strategy の表の行を読む。前の仕事が保存した対象を、探し直さずに使うときに使う。",
    input_schema: {
      type: "object",
      properties: {
        table: { type: "string", description: "表の名前" },
        where: { type: "object", description: "列名 → 値。すべて一致する行だけ（省けば全部）", additionalProperties: { type: ["string", "number", "boolean"] } },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      required: ["table"],
      additionalProperties: false,
    },
  },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure. A record's value as a cell: strings trimmed, empty as null, others dropped. */
export function cellOf(v: unknown): Cell | undefined {
  if (v === null) return null;
  if (typeof v === "string") { const s = v.trim().slice(0, 5000); return s === "" ? null : s; }
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  return undefined;
}

/** Pure. The type a new column takes from the values it is first given. */
export function inferType(values: Cell[]): ColumnType {
  const present = values.filter((v) => v !== null);
  if (present.length === 0) return "text";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every((v) => typeof v === "boolean")) return "checkbox";
  if (present.every((v) => typeof v === "string" && DATE.test(v))) return "date";
  return "text";
}

/** Pure. A key value compared as text, so 101 and "101" are the same thing. */
export function keyOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.toLowerCase();
}

export interface UpsertPlan {
  newColumns: { name: string; type: ColumnType }[];
  inserts: Record_[];
  updates: { rowId: string; cells: Record_ }[];
  unchanged: number;
  /** Records left out, with why. */
  skipped: string[];
}

/**
 * Pure. What saving these records into a Table does: the columns to add,
 * the rows to add, and for an existing row (same key, compared as text) only
 * the cells whose value changes. A record without the key is skipped; two
 * records with one key merge, the later winning (the key keeps its first
 * spelling, and an existing row's key is never rewritten).
 */
export function planUpsert(columns: ExistingColumn[], rows: ExistingRow[], key: string, records: unknown[]): UpsertPlan {
  const skipped: string[] = [];
  const clean: Record_[] = [];
  for (const [i, r] of records.slice(0, MAX_RECORDS).entries()) {
    if (!r || typeof r !== "object" || Array.isArray(r)) { skipped.push(`${i + 1} 件目: 行がオブジェクトではありません`); continue; }
    const rec: Record_ = {};
    for (const [k, v] of Object.entries(r)) {
      const name = k.trim().slice(0, 100);
      const c = cellOf(v);
      if (name && c !== undefined) rec[name] = c;
    }
    if (keyOf(rec[key]) === null) { skipped.push(`${i + 1} 件目: ${key} がありません`); continue; }
    clean.push(rec);
  }
  if (records.length > MAX_RECORDS) skipped.push(`${MAX_RECORDS} 件を超えた分（${records.length - MAX_RECORDS} 件）は保存していません`);

  // Merge records that name the same thing.
  const byKey = new Map<string, Record_>();
  for (const rec of clean) {
    const k = keyOf(rec[key])!;
    const prev = byKey.get(k);
    // The first spelling of the key stands.
    byKey.set(k, prev ? { ...prev, ...rec, [key]: prev[key] } : rec);
  }

  const known = new Map(columns.map((c) => [c.name, c]));
  const newColumns: { name: string; type: ColumnType }[] = [];
  const names = [...new Set([...byKey.values()].flatMap((r) => Object.keys(r)))];
  // The key column first, so a new Table opens on it.
  names.sort((a, b) => (a === key ? -1 : b === key ? 1 : 0));
  for (const name of names) {
    if (known.has(name)) continue;
    if (columns.length + newColumns.length >= MAX_COLUMNS) { skipped.push(`列「${name}」: 列が ${MAX_COLUMNS} を超えるため作っていません`); continue; }
    newColumns.push({ name, type: inferType([...byKey.values()].map((r) => r[name] ?? null)) });
  }
  const usable = new Set([...columns.map((c) => c.name), ...newColumns.map((c) => c.name)]);

  const existing = new Map<string, ExistingRow>();
  for (const row of rows) {
    const k = keyOf(row.cells[key]);
    if (k !== null && !existing.has(k)) existing.set(k, row);
  }
  const inserts: Record_[] = [];
  const updates: { rowId: string; cells: Record_ }[] = [];
  let unchanged = 0;
  for (const [k, rec] of byKey) {
    const cells: Record_ = {};
    for (const [name, v] of Object.entries(rec)) if (usable.has(name)) cells[name] = v;
    const row = existing.get(k);
    if (!row) { inserts.push(cells); continue; }
    const changed: Record_ = {};
    for (const [name, v] of Object.entries(cells)) {
      if (name === key) continue; // the row is that thing already; its key keeps its spelling
      const before = row.cells[name] ?? null;
      if (!same(before, v)) changed[name] = v;
    }
    if (Object.keys(changed).length) updates.push({ rowId: row.id, cells: changed });
    else unchanged++;
  }
  return { newColumns, inserts, updates, unchanged, skipped };
}

function same(a: unknown, b: Cell): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null;
  return typeof a !== "object" && String(a) === String(b);
}

/** Pure. Rows that match every `where` value (compared as text). */
export function matchRows(rows: Record<string, unknown>[], where: unknown): Record<string, unknown>[] {
  if (!where || typeof where !== "object" || Array.isArray(where)) return rows;
  const want = Object.entries(where as Record<string, unknown>).map(([k, v]) => [k, keyOf(v)] as const);
  return rows.filter((r) => want.every(([k, v]) => keyOf(r[k]) === v));
}

/** Pure. One line for the run's context: a Table, its columns and size. */
export function tableLine(t: { name: string; columns: string[]; rows: number }): string {
  return `- 表「${t.name}」: ${t.rows} 行、列 ${t.columns.slice(0, 20).join(" / ") || "(なし)"}`;
}

/** Pure. What a finished Element is told when a Table it read has changed since. */
export function staleNote(table: string, added: number, updated: number): string {
  const what = [added ? `${added} 行追加` : "", updated ? `${updated} 行更新` : ""].filter(Boolean).join("・");
  return `**見直しが必要かもしれません** — この Element が使った表「${table}」が、完了の後に変わりました（${what}）。成果が今の表と合っているか確かめてください。`;
}
