// Formulas a workbook was saved without results for. Excel keeps each
// formula's last result in the file and recalculates on open; some exporters
// (Google Sheets among them) leave the results empty, so a viewer that only
// reads them shows blank cells and empty charts. Those cells are worked out
// here, across sheets, with an MIT formula engine loaded only when a workbook
// needs it. A formula the engine cannot work out shows its error, as Excel
// would.

export type CellValue = string | number | null;

/** One sheet's cells: value and, for a formula, its text. Keys are 'A1'. */
export type FormulaSheets = Map<string, Map<string, { value: CellValue; formula?: string }>>;

const colName = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

const flat = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]).flat(Infinity) : [v]);

/** True when some formula in the workbook has no saved result. */
export function needsRecalc(sheets: FormulaSheets): boolean {
  for (const cells of sheets.values()) for (const c of cells.values()) if (c.formula && (c.value === null || c.value === '')) return true;
  return false;
}

/** Fills in every formula cell that was saved without a result. */
export async function recalcMissing(sheets: FormulaSheets): Promise<void> {
  const { default: FormulaParser } = await import('fast-formula-parser');
  await arrayAware();
  const missing = (c: { value: CellValue; formula?: string }) => !!c.formula && (c.value === null || c.value === '');
  // Each sheet's last row, so a whole-column reference stops where the cells do.
  const lastRow = new Map<string, number>();
  for (const [name, cells] of sheets) {
    let max = 0;
    for (const k of cells.keys()) max = Math.max(max, Number(/\d+$/.exec(k)?.[0] ?? 0));
    lastRow.set(name, max);
  }

  // The engine cannot be re-entered (working one formula out from inside
  // another's breaks it), so formulas are worked out in passes: one that reads
  // a cell not worked out yet waits for a later pass.
  const pending = new Set<string>();
  for (const [sheet, cells] of sheets) for (const [ref, c] of cells) if (missing(c)) pending.add(`${sheet}!${ref}`);
  let blocked = false;
  let lastPass = false;

  const value = (sheet: string, row: number, col: number): CellValue => {
    const ref = `${colName(col)}${row}`;
    const cell = sheets.get(sheet)?.get(ref);
    if (!cell) return null;
    if (pending.has(`${sheet}!${ref}`)) {
      // In the last pass what is still waiting is a cycle: read it as 0.
      if (!lastPass) blocked = true;
      return 0;
    }
    return cell.value;
  };

  const evaluate = (sheet: string, ref: string, formula: string): CellValue => {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    let col = 0;
    for (const ch of m[1]) col = col * 26 + ch.charCodeAt(0) - 64;
    try {
      let r = parser.parse(formula, { sheet, row: Number(m[2]), col }, true) as unknown;
      if (Array.isArray(r)) r = flat(r)[0];
      if (r && typeof r === 'object' && 'error' in (r as object)) return String((r as { error: string }).error);
      if (typeof r === 'boolean') return r ? 'TRUE' : 'FALSE';
      // A reference to an empty cell stays empty, as in the Google Sheets
      // these files come from (Excel would show 0).
      return (r as CellValue) ?? null;
    } catch (e) {
      const hit = e instanceof Error ? /#[A-Z0-9/!?]+/.exec(e.message)?.[0] : null;
      return hit ?? '#VALUE!';
    }
  };

  const parser = new FormulaParser({
    onCell: ({ sheet, row, col }) => value(sheet, row, col),
    onRange: ({ sheet, from, to }) => {
      const out: CellValue[][] = [];
      const last = Math.min(to.row, lastRow.get(sheet) ?? 0);
      for (let r = from.row; r <= last; r++) {
        const line: CellValue[] = [];
        for (let c = from.col; c <= Math.min(to.col, 200); c++) line.push(value(sheet, r, c));
        out.push(line);
      }
      return out;
    },
    // IF is one of the engine's special functions: it is handed its arguments
    // unread, and reads them itself. As in an array formula, a range in the
    // condition gives a range back, with nothing (which AVERAGE and SUM skip)
    // where it is false.
    functionsNeedContext: {
      IF: (context: { utils: { extractRefValue: (a: unknown) => { val: unknown } } }, ...args: unknown[]) => {
        const [cond, yes, no] = args.map((a) => (a == null ? undefined : context.utils.extractRefValue(a).val));
        const at = (v: unknown, i: number, j: number) => (Array.isArray(v) ? (v as unknown[][])[i]?.[j] ?? (v as unknown[][])[0]?.[0] : v);
        const truthy = (c: unknown) => !!c && c !== 0 && c !== '' && c !== 'FALSE';
        const pick = (c: unknown, i: number, j: number) => (truthy(c) ? (args.length > 1 ? at(yes, i, j) ?? 0 : true) : args.length > 2 ? at(no, i, j) ?? 0 : null);
        if (Array.isArray(cond)) return (cond as unknown[][]).map((row, i) => row.map((c, j) => pick(c, i, j))) as never;
        const v = pick(cond, 0, 0);
        return (v === null ? false : v) as never;
      },
    },
    functions: {
      // An average over what an array formula gives back: its numbers only
      // (a false IF leaves nothing), as Excel does.
      AVERAGE: (...args) => {
        const nums: number[] = [];
        for (const a of args) {
          for (const v of flat(a.value)) {
            if (v && typeof v === 'object' && 'error' in (v as object)) return v as never;
            if (typeof v === 'number') nums.push(v);
            else if (!Array.isArray(a.value) && !a.isRangeRef && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) nums.push(Number(v));
          }
        }
        return nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : { error: '#DIV/0!' };
      },
      ISNUMBER: (x) => (Array.isArray(x.value)
        ? (x.value as unknown[][]).map((row) => row.map((v) => typeof v === 'number')) as never
        : typeof x.value === 'number'),
      // LOOKUP's vector form: the last value not greater than the one sought
      // (with a huge number sought, the last number in the range).
      LOOKUP: (sought, looked, result) => {
        const target = Number(sought.value);
        const keys = flat(looked.value);
        const vals = result ? flat(result.value) : keys;
        let hit = -1;
        keys.forEach((k, i) => { if (typeof k === 'number' && k <= target) hit = i; });
        return hit < 0 ? { error: '#N/A' } : (vals[hit] as CellValue);
      },
    },
  });

  for (let pass = 0; pending.size; pass++) {
    lastPass = pass >= 64;
    let progressed = false;
    for (const key of [...pending]) {
      const bang = key.lastIndexOf('!');
      const sheet = key.slice(0, bang), ref = key.slice(bang + 1);
      const cell = sheets.get(sheet)!.get(ref)!;
      blocked = false;
      const out = evaluate(sheet, ref, cell.formula!);
      if (blocked) continue;
      cell.value = out;
      pending.delete(key);
      progressed = true;
    }
    // Nothing moved: what is left reads itself. One last pass reads it as 0.
    if (!progressed) lastPass = true;
    if (pass > 64) break;
  }
}

let patched = false;

/** The engine applies + - * / ^ and comparisons to single values; Excel's
 *  array formulas apply them element by element (PRODUCT(1+B2:B9)). Its
 *  operators are a shared module, so they are taught that once. */
async function arrayAware() {
  if (patched) return;
  patched = true;
  const mod = await import('fast-formula-parser/formulas/operators');
  const ops = ((mod as { default?: unknown }).default ?? mod) as { Infix: Record<string, (...a: unknown[]) => unknown> };
  for (const name of ['mathOp', 'compareOp', 'concatOp'] as const) {
    const scalar = ops.Infix[name];
    ops.Infix[name] = (a: unknown, op: unknown, b: unknown, isA: unknown, isB: unknown) => {
      // A range comes in as rows of values without the array flag; a single
      // cell's value does not.
      const arrA = Array.isArray(a), arrB = Array.isArray(b);
      if (!arrA && !arrB) return scalar(a, op, b, isA, isB);
      if (arrA && (a as unknown[][]).length === 1 && (a as unknown[][])[0]?.length === 1 && !arrB) return scalar((a as unknown[][])[0][0], op, b, false, isB);
      const A = arrA ? (a as unknown[][]) : null, B = arrB ? (b as unknown[][]) : null;
      const rows = Math.max(A?.length ?? 1, B?.length ?? 1);
      const cols = Math.max(A?.[0]?.length ?? 1, B?.[0]?.length ?? 1);
      const at = (m: unknown[][] | null, v: unknown, i: number, j: number) => (m ? m[Math.min(i, m.length - 1)]?.[Math.min(j, (m[0]?.length ?? 1) - 1)] : v);
      return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => scalar(at(A, a, i, j), op, at(B, b, i, j), false, false)));
    };
  }
}
