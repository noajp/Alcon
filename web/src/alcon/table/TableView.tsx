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

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { NavTableIcon } from '@/shell/sidebar/NavIcons';
import {
  useDataTables,
  createDataTable,
  addDataTableColumn,
  fetchDataTableSchema,
  type DataTable,
  type DataTableColumn,
  type DataTableRow,
  type DataTableWithRowCount,
} from '@/hooks/useSupabase';
import type { Json } from '@/types/database';

export function TableView() {
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const { data: tables, loading, refetch } = useDataTables();
  const activeTable = activeTableId ? tables.find((t) => t.id === activeTableId) ?? null : null;
  const [newOpen, setNewOpen] = useState(false);

  // Drop out of detail mode if the active table is deleted / not found after
  // a refetch (e.g. the user removed it from another tab).
  useEffect(() => {
    if (activeTableId && !loading && !tables.some((t) => t.id === activeTableId)) {
      setActiveTableId(null);
    }
  }, [activeTableId, tables, loading]);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Hierarchy header: "Table" → "Table › [name]" */}
      <div className="h-10 flex items-center gap-1 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <button
          type="button"
          onClick={() => setActiveTableId(null)}
          className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[12px] font-semibold transition-colors ${
            activeTable
              ? 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
              : 'text-foreground'
          }`}
        >
          <NavTableIcon size={12} />
          Table
        </button>
        {activeTable && (
          <>
            <ChevronRight size={12} className="text-muted-foreground/50 flex-shrink-0" />
            <span className="px-1.5 py-0.5 text-[12px] font-semibold text-foreground truncate">
              {activeTable.name}
            </span>
          </>
        )}
        <div className="flex-1" />
        {!activeTable && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            title="Add Table"
            aria-label="Add Table"
            className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Body: list when no table picked, detail otherwise. */}
      <div className="flex-1 overflow-hidden">
        {activeTable ? (
          <TableDetailView table={activeTable} />
        ) : loading && tables.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[12px] text-muted-foreground">
            Loading…
          </div>
        ) : tables.length === 0 ? (
          <TablesEmptyState onCreate={() => setNewOpen(true)} />
        ) : (
          <TableListView tables={tables} onSelect={setActiveTableId} />
        )}
      </div>

      {newOpen && (
        <NewTableDialog
          onClose={() => setNewOpen(false)}
          onSaved={(id) => {
            setNewOpen(false);
            void refetch();
            setActiveTableId(id);
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

// ─── List of tables ───────────────────────────────────────────────────────
function TableListView({
  tables,
  onSelect,
}: {
  tables: DataTableWithRowCount[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="h-full overflow-auto px-2 pb-2">
      <div className="grid grid-cols-[1fr_120px_120px_140px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium sticky top-0 bg-card z-10">
        <span>Name</span>
        <span>Status</span>
        <span className="text-right">Rows</span>
        <span className="text-right">Updated</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {tables.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="w-full grid grid-cols-[1fr_120px_120px_140px] gap-3 px-4 py-3.5 min-h-[3.25rem] bg-transparent hover:bg-muted/30 border border-border rounded transition-colors items-center text-left"
          >
            <div className="flex items-start gap-2 min-w-0">
              <NavTableIcon size={13} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-foreground/95 truncate">{t.name}</div>
                {t.description && (
                  <div className="text-[11px] text-muted-foreground line-clamp-1">{t.description}</div>
                )}
              </div>
            </div>
            <div className="text-[12px]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success)]" />
                <span className="capitalize">{t.status}</span>
              </span>
            </div>
            <div className="text-[12px] text-muted-foreground tabular-nums text-right">
              {t.rowCount}
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums text-right">
              {formatRelative(t.updated_at)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Detail (columns + rows) ──────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [30, 50, 100] as const;
const ROW_HEIGHT_PX = 36; // every body cell renders at this exact height — keeps the grid even

function TableDetailView({ table }: { table: DataTable }) {
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
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="text-[11px] text-muted-foreground/70">
              {columns.map((c) => (
                <th
                  key={c.id}
                  className="px-3 text-left font-medium border border-border/60 bg-card"
                  style={{ height: ROW_HEIGHT_PX }}
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
                  className="px-3 py-8 text-center text-[12px] text-muted-foreground border border-border/40"
                >
                  No rows yet.
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.id} style={{ height: ROW_HEIGHT_PX }}>
                  {columns.map((c) => {
                    const v = cellsByRow[row.id]?.[c.id];
                    return (
                      <td
                        key={c.id}
                        className="px-3 align-middle border border-border/40 text-foreground/85 whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ height: ROW_HEIGHT_PX }}
                      >
                        {formatCell(v)}
                      </td>
                    );
                  })}
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
              className="w-full bg-card rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !saving && name.trim()) void save();
                if (e.key === 'Escape') onClose();
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
              className="w-full bg-card rounded-md px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 resize-none"
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

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  const days = Math.floor(diff / day);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
