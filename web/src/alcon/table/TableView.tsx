'use client';

import { useWorkspaceActions } from '@/shell/WorkspaceActionsContext';
import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, Rows3, Columns3 } from 'lucide-react';
import { isCommitEnter, useEscapeLayer } from '@/alcon/shared/keyboard';
import { NavTableIcon } from '@/shell/sidebar/NavIcons';
import {
  useDataTables, createDataTable, addDataTableColumn, addDataTableColumns,
  bulkInsertDataTableRows,
  type DataTable, type DataTableColumn, type DataTableColumnType,
} from '@/hooks/useSupabase';
import { useTableData } from './useTableData';
import type { Json } from '@/types/database';
import { Button } from '@/ui/button';
import { MENU_WIDTH } from '@/alcon/shared/menu';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
} from '@/ui/dropdown-menu';

type TableSource = ReturnType<typeof useTableData>;
interface TableViewProps {
  activeTableId: string | null;
  onSelectTable: (id: string | null) => void;
}

// A table switch discards only that table's transient editors and dialogs.
// Reads and in-flight writes remain keyed to their original Table in the cache.
export function TableView(props: TableViewProps) {
  return <TableSurface key={props.activeTableId ?? '__none__'} {...props} />;
}

function TableSurface({ activeTableId, onSelectTable }: TableViewProps) {
  const { data: tables, loading, error: listError, refetch } = useDataTables();
  const activeTable = tables.find((table) => table.id === activeTableId) ?? null;
  const source = useTableData(activeTableId);
  const [newOpen, setNewOpen] = useState(false);
  const [insertColumnOpen, setInsertColumnOpen] = useState(false);
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const insertingRow = useRef(false);
  const { subscribeTableCreate } = useWorkspaceActions();
  useEffect(() => subscribeTableCreate(() => setNewOpen(true)), [subscribeTableCreate]);

  useEffect(() => {
    if (activeTableId && !loading && !listError && !tables.some((table) => table.id === activeTableId)) {
      onSelectTable(null);
    }
  }, [activeTableId, tables, loading, listError, onSelectTable]);

  const handleInsertRow = async () => {
    if (!activeTable || source.saving || insertingRow.current) return;
    insertingRow.current = true;
    setWriteError(null);
    try { await source.createRow(); }
    catch (error) { setWriteError(errorMessage(error, 'Could not insert row.')); }
    finally { insertingRow.current = false; }
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="h-12 flex items-center gap-2 px-4 border-b border-[var(--border-subtle)] shrink-0">
        <NavTableIcon size={12} />
        <span className="text-xs font-semibold text-foreground truncate">{activeTable?.name ?? 'Table'}</span>
        <div className="flex-1" />
        {source.saving && <span role="status" className="text-xs text-muted-foreground">Saving…</span>}
        {activeTable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label="Insert" disabled={!source.data || !!source.error || source.saving}>
                <Plus size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={MENU_WIDTH.standard}>
              <DropdownMenuItem onSelect={() => void handleInsertRow()}><Rows3 size={14} />Insert row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setInsertColumnOpen(true)}><Columns3 size={14} />Insert column</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setImportCsvOpen(true)}><FileText size={14} />Import data from CSV</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {listError && <TableError message="Could not load Tables." onRetry={refetch} />}
      {writeError && <TableError message={writeError} onRetry={() => void handleInsertRow()} />}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTable ? (
          <TableDetailView table={activeTable} source={source} />
        ) : loading ? (
          <div role="status" className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
        ) : listError ? null : tables.length === 0 ? (
          <TablesEmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <div className="h-full flex items-center justify-center px-6 text-sm text-muted-foreground">Select a table from the sidebar.</div>
        )}
      </div>
      {newOpen && <NewTableDialog onClose={() => setNewOpen(false)} onSaved={(id) => {
        setNewOpen(false);
        refetch();
        onSelectTable(id);
      }} />}
      {activeTable && insertColumnOpen && <InsertColumnDialog
        source={source}
        onClose={() => setInsertColumnOpen(false)}
        onSaved={() => setInsertColumnOpen(false)}
      />}
      {activeTable && importCsvOpen && <ImportCsvDialog
        tableId={activeTable.id}
        source={source}
        existingColumns={source.data?.columns ?? []}
        onClose={() => setImportCsvOpen(false)}
        onImported={() => setImportCsvOpen(false)}
      />}
    </div>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message : fallback;
}

function TableError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="flex items-center gap-2 px-4 py-2 text-xs text-destructive">
    <span className="flex-1">{message}</span><Button variant="ghost" size="xs" onClick={onRetry}>Retry</Button>
  </div>;
}

// ─── Empty state ──────────────────────────────────────────────────────────
function TablesEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 select-none">
      <div className="w-12 h-12 rounded-xl border border-muted-foreground/40 flex items-center justify-center mb-4 text-muted-foreground">
        <NavTableIcon size={22} />
      </div>
      <h2 className="text-[15px] font-semibold text-foreground mb-1.5">No tables yet</h2>
      <p className="text-[13px] text-muted-foreground text-center max-w-xs mb-6">
        Create a Table to store and query rows of your own — customers, inquiries, anything.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-foreground text-background text-[13px] font-medium hover:bg-foreground/90 transition-colors"
      >
        <Plus size={14} />
        Create Table
      </button>
    </div>
  );
}

// ─── Detail (columns + rows) ──────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;
const ROW_HEIGHT_PX = 36; // every body cell renders at this exact height — keeps the grid even

function TableDetailView({ table, source }: { table: DataTable; source: TableSource }) {
  const { columns = [], rows = [], cellsByRow = {} } = source.data ?? {};
  const [pageSize, setPageSize] = useState<number>(30);
  const [page, setPage] = useState(1);
  const retry = () => { void source.refetch(); };

  if (!source.data) {
    return source.error ? <TableError message="Could not load this Table." onRetry={retry} /> : (
      <div role="status" className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading…</div>
    );
  }
  if (columns.length === 0) {
    return <><TableReadError source={source} /><EmptySchemaState source={source} /></>;
  }

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const startIdx = (clampedPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pagedRows = rows.slice(startIdx, endIdx);

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={table.name}>
      <TableReadError source={source} />
      <div className="flex-1 overflow-auto">
        {/*
          border-separate (not border-collapse) so each cell owns its full
          background — collapsed borders share edges between cells, and on
          Chrome/Safari that lets body rows peek through the sticky header
          on scroll. With separate borders + a solid header bg, the header
          completely hides anything scrolling under it.
        */}
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <thead className="sticky top-0 z-20">
            <tr className="text-[11px] text-muted-foreground/70">
              {columns.map((c) => (
                <th
                  key={c.id}
                  className="px-3 text-left font-medium border-b border-r border-border/60 bg-card first:border-l"
                  style={{ height: ROW_HEIGHT_PX, borderTopWidth: 1, borderTopColor: 'var(--border)' }}
                  title={c.type}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {total === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-8 text-center text-[12px] text-muted-foreground border-b border-r border-border/40 first:border-l"
                >
                  No rows yet.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.id} style={{ height: ROW_HEIGHT_PX }}>
                  {columns.map((c) => (
                    <EditableCell
                      key={c.id}
                      column={c}
                      value={cellsByRow[row.id]?.[c.id] ?? null}
                      disabled={source.saving || !!source.error}
                      onSave={(next) => source.setCell(row.id, c.id, next)}
                    />
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer pagination — visible whenever the table has rows. */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-4 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground bg-card flex-shrink-0">
          <span className="tabular-nums">
            {`${startIdx + 1}-${endIdx} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={clampedPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-6 px-2 rounded-md tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              Prev
            </button>
            {pagePillRange(clampedPage, pageCount).map((n, i) =>
              n === '…' ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground/60 select-none">…</span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  className={`h-6 min-w-[1.5rem] px-1.5 rounded-md tabular-nums transition-colors ${
                    clampedPage === n
                      ? 'bg-foreground/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              disabled={clampedPage === pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              className="h-6 px-2 rounded-md tabular-nums text-muted-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              Next
            </button>
          </div>
          <label className="inline-flex items-center gap-1.5">
            <span>Row/Page:</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="h-6 bg-card border border-border/60 rounded-md px-1.5 text-[11px] text-foreground tabular-nums cursor-pointer hover:bg-muted/40"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      )}

    </div>
  );
}

function TableReadError({ source }: { source: TableSource }) {
  return source.error ? <TableError message="Could not refresh this Table. Displaying the last saved data." onRetry={() => { void source.refetch(); }} /> : null;
}

// Pending drafts stay local to the editor; the shared cache contains only
// confirmed data. Failure restores the saved value and retains a retry action.
function EditableCell({ column, value, disabled, onSave }: {
  column: DataTableColumn;
  value: Json | null;
  disabled: boolean;
  onSave: (value: Json | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ value: Json | null } | null>(null);
  const [failure, setFailure] = useState<{ value?: Json | null; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editingRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select?.(); }
  }, [editing]);

  const begin = () => {
    if (disabled || savingRef.current) return;
    setDraft(formatCell(value));
    setFailure(null);
    editingRef.current = true;
    setEditing(true);
  };
  const commit = async (next: Json | null) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setPending({ value: next });
    setFailure(null);
    try { await onSave(next); }
    catch (error) { setFailure({ value: next, message: errorMessage(error, 'Could not save cell.') }); }
    finally { savingRef.current = false; setPending(null); }
  };
  const save = () => {
    // Enter unmounts the input, which also fires blur. Escape clears this flag
    // before unmounting so it can never reach the write path.
    if (!editingRef.current) return;
    editingRef.current = false;
    setEditing(false);
    let next: Json | null = draft === '' ? null : draft;
    if (column.type === 'number' && draft !== '') {
      const number = Number(draft);
      if (!Number.isFinite(number)) {
        setFailure({ message: 'Enter a valid number.' });
        return;
      }
      next = number;
    }
    if (next !== value) void commit(next);
  };
  const displayed = pending ? pending.value : value;

  return (
    <td className="px-1 align-middle border-b border-r border-[var(--border-subtle)] first:border-l" style={{ height: ROW_HEIGHT_PX }} aria-busy={!!pending}>
      {column.type === 'checkbox' ? (
        <input type="checkbox" aria-label={column.name} checked={displayed === true}
          disabled={disabled || !!pending} onChange={() => void commit(displayed !== true)}
          className="mx-2 size-4 cursor-pointer accent-[var(--accent-default)] disabled:opacity-50" />
      ) : editing ? (
        <input ref={inputRef} type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
          aria-label={column.name} value={draft} onChange={(event) => setDraft(event.target.value)}
          onBlur={save} onKeyDown={(event) => {
            if (isCommitEnter(event)) { event.preventDefault(); save(); }
            if (event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation();
              editingRef.current = false; setEditing(false);
            }
          }}
          className="w-full h-8 bg-muted/40 px-2 text-xs text-foreground" />
      ) : (
        <Button variant="ghost" size="sm" align="start" className="w-full font-normal"
          aria-label={`Edit ${column.name}: ${formatCell(displayed) || 'Empty'}`}
          disabled={disabled || !!pending} onClick={begin}>
          <span className="truncate">{formatCell(displayed) || <span className="text-muted-foreground">—</span>}</span>
          {pending && <span className="sr-only">Saving…</span>}
        </Button>
      )}
      {failure && <div role="alert" className="flex items-center gap-1 px-2 py-1 text-xs text-destructive">
        <span>{failure.message}</span>
        {'value' in failure && <Button variant="ghost" size="xs" disabled={disabled} onClick={() => void commit(failure.value ?? null)}>Retry</Button>}
      </div>}
    </td>
  );
}

// "Insert column" modal — name + type. Defaults to text; uses the same
// column-type set the migration accepts.
function InsertColumnDialog({
  source,
  onClose,
  onSaved,
}: {
  source: TableSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DataTableColumnType>('text');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const savingRef = useRef(false);
  const close = () => { if (!savingRef.current) onClose(); };
  useEscapeLayer(true, close);

  const save = async () => {
    if (!name.trim() || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      await source.createColumn(name.trim(), type);
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Failed to add column');
      setSaving(false);
    } finally { savingRef.current = false; }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={close}>
      <div className="w-[420px] rounded-lg bg-background shadow-xl border border-border/60" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border/60">
          <div className="text-[13px] font-semibold text-foreground">Insert column</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">Name</div>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Phone"
              className="w-full bg-card rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 border-none"
              onKeyDown={(e) => {
                if (isCommitEnter(e) && name.trim() && !saving) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">Type</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as DataTableColumnType)}
              className="w-full bg-card rounded-md px-3 py-2 text-[13px] text-foreground border-none"
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Select</option>
              <option value="checkbox">Checkbox</option>
            </select>
          </div>
          {err && <div className="text-[12px] text-rose-400">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-border/60 flex items-center justify-end gap-2">
          <button type="button" onClick={close} className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors">Cancel</button>
          <button type="button" disabled={!name.trim() || saving} onClick={() => void save()} className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50">
            {saving ? 'Adding…' : 'Add column'}
          </button>
        </div>
      </div>
    </div>
  );
}

// "Import data from CSV" modal — file picker, preview the parsed rows, then
// commit (creates missing columns + bulk-inserts the rows). Column matching
// is by case-insensitive header name: matches an existing column → reuse it;
// no match → create a new text column.
function ImportCsvDialog({
  tableId,
  source,
  existingColumns,
  onClose,
  onImported,
}: {
  tableId: string;
  source: TableSource;
  existingColumns: DataTableColumn[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const importingRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const close = () => { if (!importingRef.current) onClose(); };
  useEscapeLayer(true, close);

  const handleFile = async (file: File) => {
    setErr(null);
    try {
      const text = await file.text();
      const lines = parseCsv(text);
      if (lines.length === 0) throw new Error('CSV is empty');
      const headers = lines[0].map((h) => h.trim()).filter(Boolean);
      const rows = lines.slice(1).filter((r) => r.some((c) => c !== ''));
      setParsed({ headers, rows });
    } catch (e) {
      setErr((e as Error).message || 'Failed to parse CSV');
    }
  };

  const runImport = async () => {
    if (!parsed || importingRef.current || failed) return;
    importingRef.current = true;
    setImporting(true);
    setErr(null);
    try {
      await source.runWrite(async () => {
        const { headers, rows } = parsed;
        // Resolve each header to an existing column (case-insensitive match) or
        // create it. New columns default to 'text' — the user can change the
        // type from the column header later.
        const byName = new Map<string, DataTableColumn>();
        for (const c of existingColumns) byName.set(c.name.toLowerCase(), c);
        const toCreate: { name: string; type: DataTableColumnType }[] = [];
        for (const h of headers) {
          if (!byName.has(h.toLowerCase())) toCreate.push({ name: h, type: 'text' });
        }
        let newCols: DataTableColumn[] = [];
        if (toCreate.length > 0) {
          const startOrder = existingColumns.length;
          newCols = await addDataTableColumns(tableId, toCreate, startOrder);
          for (const c of newCols) byName.set(c.name.toLowerCase(), c);
        }
        // Build {columnId → value} per row.
        const values = rows.map((cells) => {
          const obj: Record<string, Json | null> = {};
          for (let i = 0; i < headers.length; i++) {
            const col = byName.get(headers[i].toLowerCase());
            if (!col) continue;
            const raw = (cells[i] ?? '').trim();
            obj[col.id] = raw === '' ? null : raw;
          }
          return obj;
        });
        const rowOrder = (source.data?.rows.reduce((max, row) => Math.max(max, row.order_index ?? -1), -1) ?? -1) + 1;
        await bulkInsertDataTableRows(tableId, values, rowOrder);
      });
      onImported();
    } catch (e) {
      setErr(`${errorMessage(e, 'Could not import CSV.')} Some changes may already be saved. Review the Table before importing again.`);
      setFailed(true);
      setImporting(false);
    } finally { importingRef.current = false; }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={close}>
      <div className="w-[640px] max-h-[80vh] flex flex-col rounded-lg bg-background shadow-xl border border-border/60" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border/60">
          <div className="text-[13px] font-semibold text-foreground">Import data from CSV</div>
        </div>
        <div className="px-5 py-4 flex-1 overflow-auto">
          {!parsed ? (
            <div className="border-2 border-dashed border-border/60 rounded-lg p-8 text-center">
              <p className="text-[12px] text-muted-foreground mb-3">
                Drop a .csv file or pick one. First row is treated as the column header.
              </p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
                className="block mx-auto text-[12px] text-foreground"
              />
            </div>
          ) : (
            <>
              <div className="text-[11px] text-muted-foreground mb-2 tabular-nums">
                {parsed.rows.length} rows × {parsed.headers.length} columns — preview of first 5 rows:
              </div>
              <div className="overflow-auto border border-border/60 rounded-md">
                <table className="w-full text-[11px] border-collapse">
                  <thead className="bg-card sticky top-0">
                    <tr>
                      {parsed.headers.map((h, i) => (
                        <th key={i} className="px-2 py-1.5 text-left border-b border-r border-border/60 text-muted-foreground/70 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {parsed.headers.map((_, j) => (
                          <td key={j} className="px-2 py-1 border-b border-r border-border/40 text-foreground/85 whitespace-nowrap">{row[j] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Headers that match existing columns will reuse them. New headers will be added as <span className="text-foreground">Text</span> columns (you can change the type after import).
              </p>
            </>
          )}
          {err && <div className="mt-3 text-[12px] text-rose-400">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-border/60 flex items-center justify-between gap-2">
          {parsed && (
            <button type="button" onClick={() => setParsed(null)} className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors">
              ← Pick another file
            </button>
          )}
          <div className="flex-1" />
          <button type="button" onClick={close} className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors">Cancel</button>
          <button
            type="button"
            disabled={!parsed || importing || failed}
            onClick={() => void runImport()}
            className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Tiny CSV parser — handles "quoted, commas", embedded "quotes", \r\n / \n.
// Good enough for files exported from Excel / Sheets; not a full RFC4180.
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQ = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') { continue; }
    if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  // Trailing line without newline.
  if (field !== '' || row.length > 0) { row.push(field); out.push(row); }
  return out;
}

// Build a compact page list (1 … current-1, current, current+1 … last) so the
// pager doesn't render a button per page when total is large.
function pagePillRange(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push('…');
  for (let n = left; n <= right; n++) out.push(n);
  if (right < total - 1) out.push('…');
  out.push(total);
  return out;
}

// ─── Empty-schema state (no columns yet) ──────────────────────────────────
function EmptySchemaState({ source }: { source: TableSource }) {
  const [error, setError] = useState<string | null>(null);
  const adding = useRef(false);
  const seed = async () => {
    if (adding.current || source.saving || source.error) return;
    adding.current = true;
    setError(null);
    try { await source.createColumn('Name', 'text'); }
    catch (error) { setError(errorMessage(error, 'Could not add column.')); }
    finally { adding.current = false; }
  };
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-foreground mb-1">No columns yet</h3>
      <p className="text-xs text-muted-foreground mb-4 max-w-xs">Add a column to start defining this Table.</p>
      <Button variant="primary" size="sm" disabled={source.saving || !!source.error} onClick={() => void seed()}>
        <Plus size={14} />{source.saving ? 'Adding…' : 'Add "Name" column'}
      </Button>
      {error && <TableError message={error} onRetry={() => void seed()} />}
    </div>
  );
}

// ─── New Table dialog ─────────────────────────────────────────────────────
function NewTableDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEscapeLayer(true, onClose);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const created = await createDataTable({
        name: name.trim(),
        description: description.trim() || null,
      });
      // Seed a default "Name" text column so the detail view has a schema
      // to render against without the user having to add one first.
      try {
        await addDataTableColumn(created.id, 'Name', 'text', 0);
      } catch (e) {
        // Non-fatal: the table exists, the column add failed (RLS, etc.).
        // EmptySchemaState handles the no-columns case.
        console.warn('Default column add failed', e);
      }
      onSaved(created.id);
    } catch (e) {
      setErr((e as Error).message || 'Failed to create table');
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="w-[420px] rounded-lg bg-background shadow-xl border border-border/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-border/60">
          <div className="text-[13px] font-semibold text-foreground">New Table</div>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">Name</div>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customers"
              className="w-full bg-card rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 border-none"
              onKeyDown={(e) => {
                if (isCommitEnter(e) && !saving && name.trim()) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">
              Description <span className="opacity-60">(optional)</span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this table store?"
              rows={2}
              className="w-full bg-card rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 resize-none border-none"
            />
          </div>
          {err && <div className="text-[12px] text-rose-400">{err}</div>}
        </div>
        <div className="px-5 py-3 border-t border-border/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || saving}
            onClick={() => void save()}
            className="px-3 py-1.5 text-[12px] font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatCell(v: Json | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

