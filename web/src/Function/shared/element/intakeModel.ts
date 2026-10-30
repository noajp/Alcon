import type { ElementStatus, Worker } from '@/types/database';
import { translate } from '@/Function/i18n/I18nProvider';
import { dayIndexOf } from '@/Function/shared/dateUtils';

export const INTAKE_LIMIT = 100;
export const INTAKE_TEXT_LIMIT = 500_000;
export type IntakeFormat = 'auto' | 'csv' | 'tsv' | 'lines';
export type IntakeField = 'title' | 'description' | 'status' | 'due_date' | 'assignee' | 'source_id' | 'source_url';
export type IntakeColumnMap = Record<IntakeField, number | null>;
export type IntakeWorker = Pick<Worker, 'id' | 'name' | 'email' | 'status'>;
export interface IntakeWarning { field: IntakeField; code: string; message: string }
export interface ElementImportRow {
  rowKey: string;
  sourceRow: number;
  title: string;
  description: string | null;
  status: ElementStatus;
  due_date: string | null;
  worker_id: string | null;
  source: { id: string | null; url: string | null; original_url: string | null; status: string | null; assignee: string | null; due_date: string | null };
  warnings: IntakeWarning[];
}
export interface ElementImportResult {
  saved: { rowKey: string; elementId: string }[];
  failed?: { rowKey: string; message: string }[];
}
/** The sender has evidence that no mutations from this attempt committed. */
export class ElementImportRejectedError extends Error {
  constructor(message: string) { super(message); this.name = 'ElementImportRejectedError'; }
}
export interface IntakeTable {
  format: Exclude<IntakeFormat, 'auto'>;
  headers: string[];
  rows: { sourceRow: number; cells: string[] }[];
  suggestedMap: IntakeColumnMap;
  errors: string[];
  fingerprint: string;
}
export interface IntakePreview { rows: ElementImportRow[]; errors: string[] }

export const INTAKE_FIELDS: { id: IntakeField; label: string }[] = [
  { id: 'title', label: 'Title' }, { id: 'description', label: 'Description' },
  { id: 'status', label: 'Status' }, { id: 'due_date', label: 'Due date' },
  { id: 'assignee', label: 'Assignee' }, { id: 'source_id', label: 'Original ID' },
  { id: 'source_url', label: 'Original link' },
];

// Ordered aliases favor an explicit identifier/email over a display label.
const HEADERS: Record<IntakeField, string[]> = {
  title: ['title', 'task name', 'issue title', 'name', 'element', 'タイトル', '名前', 'タスク名'],
  description: ['description', 'task description', 'issue description', 'task content', 'notes', '説明', '詳細', 'メモ'],
  status: ['status', 'task status', 'issue status', 'workflow status', 'completed', 'ステータス', '状態', '完了'],
  due_date: ['due date', 'due', 'deadline', '期日', '期限'],
  assignee: ['assignee email', 'assignee email address', 'assigned to email', 'worker id', 'assignee', 'assignees', 'assigned to', 'owner', '担当者', '担当'],
  source_id: ['task id', 'issue id', 'identifier', 'id', 'original id', '元id'],
  source_url: ['task url', 'issue url', 'url', 'link', 'source url', 'original link', 'リンク', '元url'],
};
const keyOf = (value: string) => value.trim().toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const emptyMap = (): IntakeColumnMap => ({ title: null, description: null, status: null, due_date: null, assignee: null, source_id: null, source_url: null });

/** RFC-style quoted cells, including escaped quotes and embedded newlines. */
function readDelimited(text: string, delimiter: string): { rows: string[][]; error: string | null } {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let endedQuote = false;
  const endCell = () => { cells.push(cell); cell = ''; endedQuote = false; };
  const endRow = () => { endCell(); if (cells.some((value) => value.trim())) rows.push(cells); cells = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; }
        else { quoted = false; endedQuote = true; }
      } else cell += char;
    } else if (char === delimiter) endCell();
    else if (char === '\n' || char === '\r') {
      endRow();
      if (char === '\r' && text[index + 1] === '\n') index += 1;
    } else if (char === '"' && !cell.trim() && !endedQuote) { cell = ''; quoted = true; }
    else if (endedQuote && char.trim()) return { rows: [], error: translate('Unexpected text after a quoted cell. Check the pasted table.') };
    else if (!endedQuote) cell += char;
    if (cells.length > 256) return { rows: [], error: translate('This table has too many columns. Paste only the fields for one project.') };
    if (rows.length > INTAKE_LIMIT + 1) return { rows: [], error: translate('Paste at most {n} Elements at a time. Nothing has been imported.', { n: INTAKE_LIMIT }) };
  }
  if (quoted) return { rows: [], error: translate('A quoted cell is not closed. Paste the complete CSV or switch to a line list.') };
  if (cell || cells.length) endRow();
  return { rows, error: null };
}

function suggestIntakeColumns(headers: readonly string[]): IntakeColumnMap {
  const normalized = headers.map(keyOf);
  const map = emptyMap();
  for (const field of INTAKE_FIELDS) {
    for (const alias of HEADERS[field.id]) {
      const index = normalized.indexOf(alias);
      if (index >= 0) { map[field.id] = index; break; }
    }
  }
  return map;
}

export function parseIntake(text: string, options: { format?: IntakeFormat; hasHeader?: boolean } = {}): IntakeTable {
  if (text.length > INTAKE_TEXT_LIMIT) return {
    format: options.format === 'auto' || !options.format ? 'lines' : options.format,
    headers: [], rows: [], suggestedMap: emptyMap(), errors: [translate('This paste is too large. Start with one project and fewer than {n} Elements.', { n: INTAKE_LIMIT })], fingerprint: 'oversize',
  };
  const cleaned = text.replace(/^\uFEFF/, '');
  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? '';
  let format = options.format ?? 'auto';
  if (format === 'auto') {
    if (firstLine.includes('\t')) format = 'tsv';
    else {
      const first = readDelimited(firstLine, ',');
      format = (first.rows[0]?.length ?? 0) > 1 && Object.values(suggestIntakeColumns(first.rows[0] ?? [])).some((column) => column !== null) ? 'csv' : 'lines';
    }
  }
  const base: IntakeTable = { format, headers: [], rows: [], suggestedMap: emptyMap(), errors: [], fingerprint: hash(cleaned) };
  if (!cleaned.trim()) return { ...base, errors: [translate('Paste a table or one Element title per line.')] };
  if (format === 'lines') {
    base.headers = ['Title'];
    base.suggestedMap.title = 0;
    base.rows = cleaned.split(/\r\n|\n|\r/).map((value, index) => ({ sourceRow: index + 1, cells: [value.replace(/^\s*(?:[-*•]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '').trim()] })).filter((row) => row.cells[0]);
  } else {
    const parsed = readDelimited(cleaned, format === 'csv' ? ',' : '\t');
    if (parsed.error) return { ...base, errors: [parsed.error] };
    const hasHeader = options.hasHeader !== false;
    const width = Math.max(0, ...parsed.rows.map((row) => row.length));
    if (width > 256) return { ...base, errors: [translate('This table has too many columns. Paste only the fields for one project.')] };
    base.headers = Array.from({ length: width }, (_, index) => hasHeader ? parsed.rows[0]?.[index]?.trim() || translate('Column {n}', { n: index + 1 }) : translate('Column {n}', { n: index + 1 }));
    base.rows = parsed.rows.slice(hasHeader ? 1 : 0).map((cells, index) => ({ sourceRow: index + (hasHeader ? 2 : 1), cells }));
    base.suggestedMap = suggestIntakeColumns(base.headers);
    if (!hasHeader && width === 1) base.suggestedMap.title = 0;
  }
  if (base.rows.length > INTAKE_LIMIT) return { ...base, rows: [], errors: [translate('Paste at most {n} Elements at a time. Nothing has been imported.', { n: INTAKE_LIMIT })] };
  if (!base.rows.length) base.errors.push(translate('No Element rows found below the column names.'));
  return base;
}

const STATUS_MAP: Record<string, ElementStatus> = {
  backlog: 'backlog', todo: 'todo', 'to do': 'todo', open: 'todo', 'not started': 'todo', false: 'todo',
  'in progress': 'in_progress', started: 'in_progress', doing: 'in_progress',
  review: 'review', 'in review': 'review', 'in testing': 'review',
  done: 'done', complete: 'done', completed: 'done', closed: 'done', resolved: 'done', true: 'done',
  blocked: 'blocked', cancelled: 'cancelled', canceled: 'cancelled',
  未着手: 'todo', 未完了: 'todo', 進行中: 'in_progress', 対応中: 'in_progress', 確認中: 'review',
  完了: 'done', 保留: 'blocked', 中止: 'cancelled',
};

/** Only explicit year-first date-only values; no locale or timezone guessing. */
function parseIntakeDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match || Number(match[1]) < 1) return null;
  const day = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return dayIndexOf(day) === null ? null : day;
}

export function normalizeIntake(table: IntakeTable, columns: IntakeColumnMap, workers: readonly IntakeWorker[], assigneeMap: Readonly<Record<string, string | null>> = {}): IntakePreview {
  const errors = [...table.errors];
  if (columns.title === null) errors.push(translate('Choose the column that contains Element titles.'));
  const used = Object.values(columns).filter((column): column is number => column !== null);
  if (new Set(used).size !== used.length) errors.push(translate('Each source column can map to only one field.'));
  if (used.some((column) => !Number.isInteger(column) || column < 0 || column >= table.headers.length)) errors.push(translate('A selected column is no longer available. Check the column mapping.'));
  if (errors.length) return { rows: [], errors };
  const rows = table.rows.map(({ sourceRow, cells }): ElementImportRow => {
    const read = (field: IntakeField) => columns[field] === null ? '' : (cells[columns[field]!] ?? '').trim();
    const warnings: IntakeWarning[] = [];
    const warn = (field: IntakeField, code: string, message: string) => warnings.push({ field, code, message });
    const title = read('title');
    if (!title) errors.push(translate('Row {n} has no title. Add a title or remove that row from the paste.', { n: sourceRow }));
    if (title.length > 500) errors.push(translate('Row {n} has a title longer than 500 characters.', { n: sourceRow }));
    const description = read('description') || null;
    if (description && description.length > 20_000) errors.push(translate('Row {n} has a description longer than 20,000 characters. Keep the original document as a link.', { n: sourceRow }));
    const rawStatus = read('status');
    const statusKey = keyOf(rawStatus);
    const knownStatus = Object.prototype.hasOwnProperty.call(STATUS_MAP, statusKey);
    const status = knownStatus ? STATUS_MAP[statusKey] : 'todo';
    if (rawStatus && !knownStatus) warn('status', 'unknown_status', translate('“{value}” is not recognized. It will become To Do.', { value: rawStatus }));
    const rawDate = read('due_date');
    const due_date = rawDate ? parseIntakeDate(rawDate) : null;
    if (rawDate && !due_date) warn('due_date', 'unparsed_date', translate('“{value}” was not interpreted. Due date will be empty; use YYYY-MM-DD to set it.', { value: rawDate }));
    const rawAssignee = read('assignee');
    let worker_id: string | null = null;
    if (rawAssignee && Object.prototype.hasOwnProperty.call(assigneeMap, rawAssignee)) {
      const chosen = assigneeMap[rawAssignee];
      if (chosen !== null) {
        const worker = workers.find((candidate) => candidate.id === chosen && candidate.status !== 'inactive');
        if (worker) worker_id = worker.id;
        else warn('assignee', 'invalid_assignee_mapping', translate('The Worker chosen for “{value}” is no longer available. Choose again or leave it unassigned.', { value: rawAssignee }));
      }
    } else if (rawAssignee) {
      const rawKey = rawAssignee.toLocaleLowerCase();
      const email = rawAssignee.match(/^[^<>]*<([^<>]+)>$/)?.[1].trim().toLocaleLowerCase();
      const exact = workers.filter((worker) => worker.id.toLocaleLowerCase() === rawKey || worker.email?.trim().toLocaleLowerCase() === (email ?? rawKey));
      const matches = exact.length ? exact : workers.filter((worker) => worker.name.trim().toLocaleLowerCase() === rawKey);
      if (matches.length === 1 && matches[0].status !== 'inactive') worker_id = matches[0].id;
      else warn('assignee', matches.length > 1 ? 'ambiguous_assignee' : matches[0]?.status === 'inactive' ? 'inactive_assignee' : 'unknown_assignee', translate('“{value}” cannot be matched to one active Worker. It will remain unassigned.', { value: rawAssignee }));
    }
    const originalUrl = read('source_url');
    let url: string | null = null;
    if (originalUrl) {
      try { const parsed = new URL(originalUrl); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') url = originalUrl; } catch { /* Retain original text without turning it into a link. */ }
      if (!url) warn('source_url', 'invalid_url', translate('The original link is not an HTTP(S) URL. Its text will be retained without an active link.'));
    }
    if (cells.length > table.headers.length) errors.push(translate('Row {n} has more cells than the column mapping.', { n: sourceRow }));
    const source = { id: read('source_id') || null, url, original_url: originalUrl || null, status: rawStatus || null, assignee: rawAssignee || null, due_date: rawDate || null };
    // Leave room for PostgreSQL jsonb's spacing within its 8,000-byte bound.
    if (new TextEncoder().encode(JSON.stringify(source)).length > 7900) errors.push(translate('Row {n} has source references that are too long. Shorten the original ID or link before importing.', { n: sourceRow }));
    return {
      rowKey: `${table.fingerprint}:${sourceRow}`, sourceRow, title, description, status, due_date, worker_id,
      source, warnings,
    };
  });
  if (new TextEncoder().encode(JSON.stringify(rows)).length > 1_000_000) errors.push(translate('The reviewed import is too large to save together. Start with a smaller selection.'));
  return { rows, errors };
}

/** Recover an editable paste after a server-confirmed rejection, preserving provenance. */
export function intakeTextFromRows(rows: readonly ElementImportRow[]): string {
  const quote = (value: string | null) => `"${(value ?? '').replace(/"/g, '""')}"`;
  return ['Title,Description,Status,Due Date,Assignee,Original ID,Original Link', ...rows.map((row) => [
    row.title, row.description, row.source.status ?? row.status, row.source.due_date ?? row.due_date,
    row.source.assignee, row.source.id, row.source.original_url ?? row.source.url,
  ].map(quote).join(','))].join('\n');
}

/** Unreported rows stay retryable; partial success never gets re-submitted. */
export function reconcileIntakeResult(rows: readonly ElementImportRow[], result: ElementImportResult): { saved: Record<string, string>; failed: Record<string, string> } {
  const saved: Record<string, string> = {};
  const failed: Record<string, string> = {};
  for (const row of rows) {
    const successes = result.saved.filter((item) => item.rowKey === row.rowKey && item.elementId);
    const failure = result.failed?.find((item) => item.rowKey === row.rowKey);
    if (successes.length === 1 && !failure) saved[row.rowKey] = successes[0].elementId;
    else failed[row.rowKey] = failure?.message || translate('Could not confirm this row was saved. Retry to confirm the same import.');
  }
  return { saved, failed };
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return `intake-${(result >>> 0).toString(36)}`;
}
