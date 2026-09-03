'use client';

// TableView — the "Tables" feature surface. User-managed databases
// (Notion-DB / Airtable / Supabase-Studio style), backed by `tables` /
// `table_columns` / `table_rows` / `table_cells` in Postgres. Independent
// of D/O/E — scoped per user via RLS on `tables.created_by`.
//
// Two-level shell:
//   - Root list: every table the signed-in user owns.
//   - Detail:   columns + rows for one table (read-only for now; add row /
//               edit cell land in follow-ups).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, FileText, Plus, Rows3, Columns3 } from 'lucide-react';
import { isCommitEnter, useEscapeLayer } from '@/alcon/shared/keyboard';
import { NavTableIcon } from '@/shell/sidebar/NavIcons';
import {
  useDataTables,
  createDataTable,
  addDataTableColumn,
  addDataTableColumns,
  addDataTableRow,
  bulkInsertDataTableRows,
  fetchDataTableSchema,
  setDataTableCell,
  type DataTable,
  type DataTableColumn,
  type DataTableRow,
  type DataTableColumnType,
  type DataTableWithRowCount,
} from '@/hooks/useSupabase';
import type { Json } from '@/types/database';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/ui/dropdown-menu';

export function TableView({
  activeTableId,
  onSelectTable,
}: {
  // Which table the main pane shows. The list of tables lives in the sidebar
  // (TableSidebar), which drives this through navigation — so selection is a
  // controlled prop here, not local state.
  activeTableId: string | null;
  onSelectTable: (id: string | null) => void;
}) {
  const { data: tables, loading, refetch } = useDataTables();
  const activeTable = activeTableId ? tables.find((t) => t.id === activeTableId) ?? null : null;
  const [newOpen, setNewOpen] = useState(false);

  // The sidebar's "+" dispatches this (it can't open the dialog itself since
  // the dialog lives here). Opening + creating stays a single owner.
  useEffect(() => {
    const open = () => setNewOpen(true);
    window.addEventListener('alcon:table-new', open);
    return () => window.removeEventListener('alcon:table-new', open);
  }, []);

  // Insert dropdown state — lives at the breadcrumb level (above the detail's
  // table divider). TableDetailView reports its current columns + reload
  // callback up here so the modals + handlers have what they need.
  const [insertColumnOpen, setInsertColumnOpen] = useState(false);
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  const [detailColumns, setDetailColumns] = useState<DataTableColumn[]>([]);
  const detailReloadRef = useRef<() => void>(() => {});
  const registerDetailReload = useCallback((reload: () => void) => {
    detailReloadRef.current = reload;
  }, []);

  // Drop out of detail mode if the active table is deleted / not found after
  // a refetch (e.g. the user removed it from another tab).
  useEffect(() => {
    if (activeTableId && !loading && !tables.some((t) => t.id === activeTableId)) {
      onSelectTable(null);
    }
  }, [activeTableId, tables, loading, onSelectTable]);

  // Reset detail state on table swap so a stale column set doesn't leak
  // between tables (Customers' columns showing in the new table's ImportCsv).
  useEffect(() => { setDetailColumns([]); }, [activeTableId]);

  const handleInsertRow = useCallback(async () => {
    if (!activeTable) return;
    try {
      await addDataTableRow(activeTable.id);
      detailReloadRef.current();
    } catch (e) {
      console.error('Failed to insert row', e);
    }
  }, [activeTable]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header — the open table's name (the list + "Add Table" live in the
          sidebar now, so there's no breadcrumb back to a list). The "+" is the
          detail Insert dropdown (row / column / import CSV). */}
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavTableIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground truncate">
          {activeTable ? activeTable.name : 'Table'}
        </span>
        <div className="flex-1" />
        {activeTable && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="Insert"
                aria-label="Insert"
                className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              >
                <Plus size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuItem onSelect={() => void handleInsertRow()} className="gap-2 text-[12px]">
                <Rows3 size={13} className="text-muted-foreground" />
                <span className="flex-1">Insert row</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setInsertColumnOpen(true)} className="gap-2 text-[12px]">
                <Columns3 size={13} className="text-muted-foreground" />
                <span className="flex-1">Insert column</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setImportCsvOpen(true)} className="gap-2 text-[12px]">
                <FileText size={13} className="text-muted-foreground" />
                <span className="flex-1">Import data from CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled className="gap-2 text-[12px] opacity-50">
                <Database size={13} className="text-muted-foreground" />
                <span className="flex-1">Import from Excel / Sheets</span>
                <span className="text-[10px] text-muted-foreground">Coming soon</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Body: the detail for the picked table. The list of tables lives in
          the sidebar now, so with nothing picked this pane just waits. */}
      <div className="flex-1 overflow-hidden">
        {activeTable ? (
          <TableDetailView
            table={activeTable}
            onColumnsChange={setDetailColumns}
            registerReload={registerDetailReload}
          />
        ) : loading && tables.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
            Loading…
          </div>
        ) : tables.length === 0 ? (
          <TablesEmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <div className="h-full flex items-center justify-center px-6 text-[13px] text-muted-foreground">
            Select a table from the sidebar.
          </div>
        )}
      </div>

      {newOpen && (
        <NewTableDialog
          onClose={() => setNewOpen(false)}
          onSaved={(id) => {
            setNewOpen(false);
            void refetch();
            // Tell the sidebar's own table list to refresh (it holds a
            // separate useDataTables instance), then open the new table.
            window.dispatchEvent(new CustomEvent('alcon:tables-changed'));
            onSelectTable(id);
          }}
        />
      )}
      {activeTable && insertColumnOpen && (
        <InsertColumnDialog
          tableId={activeTable.id}
          onClose={() => setInsertColumnOpen(false)}
          onSaved={() => {
            setInsertColumnOpen(false);
            detailReloadRef.current();
          }}
        />
      )}
      {activeTable && importCsvOpen && (
        <ImportCsvDialog
          tableId={activeTable.id}
          existingColumns={detailColumns}
          onClose={() => setImportCsvOpen(false)}
          onImported={() => {
            setImportCsvOpen(false);
            detailReloadRef.current();
          }}
        />
      )}
    </div>
  );
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

function TableDetailView({
  table,
  onColumnsChange,
  registerReload,
}: {
  table: DataTable;
  // Reports the current schema's columns up to TableView so its Insert
  // dropdown's Import CSV modal can read them without a duplicate fetch.
  onColumnsChange?: (columns: DataTableColumn[]) => void;
  // Hands the parent a callable that re-fetches the schema. Called by the
  // parent after Insert row / Insert column / Import CSV completes.
  registerReload?: (reload: () => void) => void;
}) {
  const [columns, setColumns] = useState<DataTableColumn[]>([]);
  const [rows, setRows] = useState<DataTableRow[]>([]);
  const [cellsByRow, setCellsByRow] = useState<Record<string, Record<string, Json | null>>>({});
  const [loading, setLoading] = useState(true);
  // Pagination state — local to this detail view, doesn't survive table swap.
  const [pageSize, setPageSize] = useState<number>(30);
  const [page, setPage] = useState<number>(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchDataTableSchema(table.id);
      setColumns(s.columns);
      setRows(s.rows);
      setCellsByRow(s.cellsByRow);
    } catch (e) {
      console.error('Failed to load table schema', e);
    } finally {
      setLoading(false);
    }
  }, [table.id]);

  useEffect(() => { void load(); }, [load]);
  // Reset to page 1 whenever the page size changes so we never sit on an
  // out-of-range page (e.g. on p3 with 50/p, switching to 100/p).
  useEffect(() => { setPage(1); }, [pageSize, table.id]);
  // Push columns + reload up to TableView so its breadcrumb-level "+" menu
  // has the schema for ImportCsv and a way to refresh us after a write.
  useEffect(() => { onColumnsChange?.(columns); }, [columns, onColumnsChange]);
  useEffect(() => { registerReload?.(() => { void load(); }); }, [load, registerReload]);

  // Insert-row writes a blank row and reloads. Declared before the early
  // returns so its useCallback runs on every render path — keeping hook
  // order stable.
  const handleInsertRow = useCallback(async () => {
    try {
      await addDataTableRow(table.id);
      await load();
    } catch (e) {
      console.error('Failed to insert row', e);
    }
  }, [table.id, load]);

  if (loading && columns.length === 0 && rows.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (columns.length === 0) {
    return <EmptySchemaState tableId={table.id} onAddedColumn={() => void load()} />;
  }

  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const startIdx = (clampedPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, total);
  const pagedRows = rows.slice(startIdx, endIdx);

  return (
    <div className="flex h-full min-h-0 flex-col">
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
                      rowId={row.id}
                      value={cellsByRow[row.id]?.[c.id] ?? null}
                      onCommit={(next) => {
                        // Optimistic local patch so the cell shows the new value
                        // immediately even before the upsert resolves.
                        setCellsByRow((prev) => ({
                          ...prev,
                          [row.id]: { ...(prev[row.id] ?? {}), [c.id]: next },
                        }));
                      }}
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
              onChange={(e) => setPageSize(Number(e.target.value))}
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

// Editable cell — click to enter edit mode, blur / Enter saves, Escape
// cancels. Type-specific input (number / date / checkbox / select / text).
// Optimistic patch via onCommit so the parent's cellsByRow updates instantly;
// the actual upsert fires in the background and only logs on failure.
function EditableCell({
  column,
  rowId,
  value,
  onCommit,
}: {
  column: DataTableColumn;
  rowId: string;
  value: Json | null;
  onCommit: (next: Json | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the draft in sync when the parent passes a new value (e.g. after a
  // refetch). Without this the cell would freeze on an old optimistic value.
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  const save = async (raw: string) => {
    // Coerce per column type. `null` for empty strings on every type so cells
    // can be cleared. Numbers fall back to null when the input wasn't numeric.
    let next: Json | null = null;
    if (raw !== '') {
      if (column.type === 'number') {
        const n = Number(raw);
        next = Number.isFinite(n) ? n : null;
      } else if (column.type === 'checkbox') {
        next = raw === 'true' || raw === '1';
      } else {
        next = raw;
      }
    }
    setEditing(false);
    if (next === value) return; // no-op if unchanged
    onCommit(next);
    try {
      await setDataTableCell(rowId, column.id, next);
    } catch (e) {
      console.error('Failed to save cell', e);
    }
  };

  if (column.type === 'checkbox') {
    const checked = value === true;
    return (
      <td
        className="px-3 align-middle border-b border-r border-border/40 first:border-l"
        style={{ height: ROW_HEIGHT_PX }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {
            onCommit(!checked);
            void setDataTableCell(rowId, column.id, !checked).catch((e) => console.error(e));
          }}
          className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
        />
      </td>
    );
  }

  if (editing) {
    const inputType =
      column.type === 'number' ? 'number'
      : column.type === 'date' ? 'date'
      : 'text';
    return (
      <td
        className="px-1 align-middle border-b border-r border-border/40 first:border-l bg-foreground/[0.04]"
        style={{ height: ROW_HEIGHT_PX }}
      >
        <input
          ref={inputRef}
          type={inputType}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void save(draft); }
            if (e.key === 'Escape') {
              // Consumed: the cancel is this cell's level, not the view's.
              e.preventDefault();
              setEditing(false);
              setDraft(value == null ? '' : String(value));
            }
          }}
          className="w-full h-full bg-transparent px-2 text-[12px] text-foreground"
        />
      </td>
    );
  }

  return (
    <td
      className="px-3 align-middle border-b border-r border-border/40 text-foreground/85 whitespace-nowrap overflow-hidden text-ellipsis first:border-l cursor-cell hover:bg-foreground/[0.02]"
      style={{ height: ROW_HEIGHT_PX }}
      onDoubleClick={() => setEditing(true)}
      onClick={(e) => {
        // Single-click also opens edit mode when the cell is empty (Notion-y).
        if (value == null && !editing) setEditing(true);
      }}
    >
      {formatCell(value)}
    </td>
  );
}

// "Insert column" modal — name + type. Defaults to text; uses the same
// column-type set the migration accepts.
function InsertColumnDialog({
  tableId,
  onClose,
  onSaved,
}: {
  tableId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<DataTableColumnType>('text');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEscapeLayer(true, onClose);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await addDataTableColumn(tableId, name.trim(), type);
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Failed to add column');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
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
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors">Cancel</button>
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
  existingColumns,
  onClose,
  onImported,
}: {
  tableId: string;
  existingColumns: DataTableColumn[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEscapeLayer(true, onClose);

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
    if (!parsed) return;
    setImporting(true);
    setErr(null);
    try {
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
      await bulkInsertDataTableRows(tableId, values);
      onImported();
    } catch (e) {
      setErr((e as Error).message || 'Failed to import CSV');
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
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
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted/40 rounded-md transition-colors">Cancel</button>
          <button
            type="button"
            disabled={!parsed || importing}
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
function EmptySchemaState({
  tableId,
  onAddedColumn,
}: {
  tableId: string;
  onAddedColumn: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const seed = useCallback(async () => {
    setAdding(true);
    try {
      await addDataTableColumn(tableId, 'Name', 'text', 0);
      onAddedColumn();
    } catch (e) {
      console.error('Failed to add column', e);
    } finally {
      setAdding(false);
    }
  }, [tableId, onAddedColumn]);
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 py-12 text-center">
      <h3 className="text-[14px] font-semibold text-foreground mb-1">No columns yet</h3>
      <p className="text-[12px] text-muted-foreground mb-5 max-w-xs">
        Add a column to start defining this table's schema.
      </p>
      <button
        type="button"
        disabled={adding}
        onClick={() => void seed()}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-foreground text-background text-[12px] font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
      >
        <Plus size={12} />
        {adding ? 'Adding…' : 'Add "Name" column'}
      </button>
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

