// Turns pasted spreadsheet text (CSV or tab-separated, with a header row) into
// item records. Headers are matched loosely in English and Japanese so an
// existing stock list can be pasted as-is. Pure: tested without a browser.

export interface ScmImportRow {
  line: number;
  sku: string;
  name: string;
  category: string | null;
  unit: string | null;
  supplier: string | null;
  unitCost: number | null;
  unitPrice: number | null;
  currency: string | null;
  moq: number | null;
  orderMultiple: number | null;
  leadTimeDays: number | null;
  location: string | null;
  onHand: number | null;
  dailyDemand: number | null;
}

export interface ScmImportResult { rows: ScmImportRow[]; errors: { line: number; message: string }[]; columns: string[] }

type Field = Exclude<keyof ScmImportRow, 'line'>;
const ALIASES: Record<Field, string[]> = {
  sku: ['sku', 'item code', 'code', '品番', '品目コード', 'コード', 'jan'],
  name: ['name', 'item', 'item name', 'description', '品名', '品目名', '商品名', '名称'],
  category: ['category', 'カテゴリ', 'カテゴリー', '分類'],
  unit: ['unit', 'uom', '単位'],
  supplier: ['supplier', 'vendor', '仕入先', 'サプライヤー', '発注先'],
  unitCost: ['unit cost', 'cost', '原価', '仕入単価', '単価'],
  unitPrice: ['unit price', 'price', 'selling price', '売価', '販売単価'],
  currency: ['currency', '通貨'],
  moq: ['moq', 'minimum order', '最小発注数', '最低発注数'],
  orderMultiple: ['order multiple', 'pack size', 'case size', '入数', '発注単位'],
  leadTimeDays: ['lead time', 'lead time days', 'lead time (days)', 'リードタイム', '納期'],
  location: ['location', 'warehouse', 'site', '拠点', '倉庫'],
  onHand: ['on hand', 'stock', 'quantity', 'qty', '在庫', '在庫数', '現在庫'],
  dailyDemand: ['daily demand', 'demand per day', '日販', '1日あたり需要', '日次需要'],
};
const NUMERIC: Field[] = ['unitCost', 'unitPrice', 'moq', 'orderMultiple', 'leadTimeDays', 'onHand', 'dailyDemand'];

const normalize = (value: string) => value.trim().toLowerCase().replace(/[_\s]+/g, ' ').replace(/[()（）]/g, m => (m === '（' ? '(' : m === '）' ? ')' : m));

/** Split one line, honouring double quotes, on the given delimiter. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { current += '"'; index++; }
      else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { out.push(current); current = ''; }
    else current += char;
  }
  out.push(current);
  return out.map(value => value.trim());
}

function parseNumber(value: string): number | null | 'invalid' {
  const cleaned = value.replace(/[,，\s¥$€£]/g, '').replace(/円$/, '');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 'invalid';
}

export function parseScmImport(text: string): ScmImportResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(line => line.trim());
  if (!lines.length) return { rows: [], errors: [{ line: 0, message: 'Paste a header row and at least one item.' }], columns: [] };
  const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : ';';
  const header = splitLine(lines[0], delimiter).map(normalize);
  const map = new Map<number, Field>();
  header.forEach((name, index) => {
    for (const [field, aliases] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (aliases.includes(name) && ![...map.values()].includes(field)) { map.set(index, field); return; }
    }
  });
  const columns = [...map.values()];
  const errors: ScmImportResult['errors'] = [];
  if (!columns.includes('sku') || !columns.includes('name')) {
    return { rows: [], errors: [{ line: 1, message: 'The header needs at least a SKU and a name column.' }], columns };
  }
  const rows: ScmImportRow[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((raw, offset) => {
    const line = offset + 2;
    const cells = splitLine(raw, delimiter);
    const row: ScmImportRow = { line, sku: '', name: '', category: null, unit: null, supplier: null, unitCost: null, unitPrice: null, currency: null, moq: null, orderMultiple: null, leadTimeDays: null, location: null, onHand: null, dailyDemand: null };
    let valid = true;
    for (const [index, field] of map) {
      const value = cells[index] ?? '';
      if (NUMERIC.includes(field)) {
        const parsed = parseNumber(value);
        if (parsed === 'invalid') { errors.push({ line, message: `${field} "${value}" is not a number of zero or more.` }); valid = false; }
        else (row as unknown as Record<string, unknown>)[field] = parsed;
      } else (row as unknown as Record<string, unknown>)[field] = value || (field === 'sku' || field === 'name' ? '' : null);
    }
    if (!row.sku || !row.name) { errors.push({ line, message: 'SKU and name are required.' }); valid = false; }
    if (row.currency && !/^[A-Za-z]{3}$/.test(row.currency)) { errors.push({ line, message: `Currency "${row.currency}" must be a three-letter code.` }); valid = false; }
    if (row.orderMultiple === 0) { errors.push({ line, message: 'Order multiple must be above zero.' }); valid = false; }
    const key = `${row.sku}\u0000${row.location ?? ''}`;
    if (valid && seen.has(key)) { errors.push({ line, message: `SKU ${row.sku} appears twice for the same location.` }); valid = false; }
    if (valid) { seen.add(key); rows.push({ ...row, currency: row.currency?.toUpperCase() ?? null }); }
  });
  return { rows, errors, columns };
}
