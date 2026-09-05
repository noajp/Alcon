"use client";

import { useRef, useState } from "react";
import { ChevronDown, Settings2, Trash2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { MenuShell, MENU_ROW } from "@/alcon/shared/menu";
import { useDataTables } from "@/alcon/table/data";
import { useWidgetTableData } from "@/hooks/useWidgetTableData";
import type { DataTableColumn, DataTableColumnType } from "@/types/database";
import { WidgetHeaderAction, useWidgetMeta } from "../WidgetFrame";
import type { WidgetProps } from "../types";
import {
  dataBars,
  displayCell,
  groupDataRows,
  normalizeDataViewParams,
  parseCell,
} from "./dataViewModel";

const INPUT =
  "h-8 min-w-0 w-full rounded-sm bg-transparent px-2 text-sm hover:bg-muted/40 focus:bg-muted/60 disabled:opacity-50";
const COLUMN_TYPES: DataTableColumnType[] = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
];

function Choice({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  return (
    <DropdownMenu onOpenChange={() => setSearch("")}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          align="start"
          disabled={disabled}
          aria-label={label}
          className="max-w-full"
        >
          <span className="truncate">
            {label}: {options.find((o) => o.id === value)?.label ?? "Choose…"}
          </span>
          <ChevronDown size={12} />
        </Button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" width="standard" align="start">
        <input
          autoFocus
          aria-label={`Find ${label.toLowerCase()}`}
          placeholder={`Choose ${label.toLowerCase()}…`}
          className={INPUT}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key !== "Escape" &&
              e.key !== "ArrowDown" &&
              e.key !== "Enter"
            )
              e.stopPropagation();
          }}
        />
        <div className="max-h-64 overflow-y-auto">
          {options
            .filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
            .map((o) => (
              <DropdownMenuItem
                className={MENU_ROW}
                key={o.id}
                onSelect={() => onChange(o.id)}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.id === value && <span>✓</span>}
              </DropdownMenuItem>
            ))}
        </div>
      </MenuShell>
    </DropdownMenu>
  );
}

/** Drafts stay local until a confirmed write. Esc cancels an edit, failed writes keep it. */
function EditValue({
  value,
  label,
  onSave,
  disabled,
  type = "text",
}: {
  value: string;
  label: string;
  onSave: (value: string) => Promise<unknown>;
  disabled?: boolean;
  type?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (draft === null || draft === value || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="min-w-0">
      <input
        aria-label={label}
        aria-invalid={!!error}
        className={INPUT}
        type={type}
        value={draft ?? value}
        disabled={disabled || saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(null);
            setError(null);
          }
        }}
      />
      {saving && (
        <span className="px-2 text-xs text-muted-foreground" role="status">
          Saving…
        </span>
      )}
      {error && (
        <div className="px-2 text-xs text-destructive" role="alert">
          {error}
          <Button variant="ghost" size="xs" onClick={() => void save()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function DataViewWidget({ params: rawParams, setParams }: WidgetProps) {
  const params = normalizeDataViewParams(rawParams);
  const tables = useDataTables();
  const source = useWidgetTableData(params.tableId);
  const [configure, setConfigure] = useState(!params.tableId);
  const [editData, setEditData] = useState(false);
  const [newTable, setNewTable] = useState("");
  const [newColumn, setNewColumn] = useState("");
  const [columnType, setColumnType] = useState<DataTableColumnType>("text");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    label: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const newColumnInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const data = source.data;
  useWidgetMeta(
    data ? `${data.table.name} · ${data.rows.length}` : null,
  );
  const change = (patch: Partial<typeof params>) =>
    setParams(patch);
  async function run(action: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const columnOptions =
    data?.columns.map((c) => ({ id: c.id, label: c.name })) ?? [];
  const columns =
    data?.columns.filter(
      (c) => params.columnIds === undefined || params.columnIds.includes(c.id),
    ) ?? [];
  function cell(rowId: string, column: DataTableColumn) {
    const value = data?.cellsByRow[rowId]?.[column.id];
    if (column.type === "checkbox")
      return (
        <label className="flex h-8 items-center gap-2 px-2 text-sm">
          <input
            type="checkbox"
            aria-label={column.name}
            checked={value === true}
            disabled={saving}
            onChange={(e) =>
              void run(() => source.setCell(rowId, column.id, e.target.checked))
            }
          />
          <span>{displayCell(value)}</span>
        </label>
      );
    return (
      <EditValue
        label={column.name}
        value={displayCell(value)}
        disabled={saving}
        onSave={(text) =>
          source.setCell(rowId, column.id, parseCell(text, column.type))
        }
        type={column.type === "date" ? "date" : "text"}
      />
    );
  }
  const showEditor = params.view === "table" || editData;
  return (
    <>
      <WidgetHeaderAction>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => setConfigure(!configure)}
          aria-label="Configure data widget"
          aria-expanded={configure}
        >
          <Settings2 size={12} />
          Configure
        </Button>
      </WidgetHeaderAction>
      <div
        className="space-y-3"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (confirm) setConfirm(null);
            else setConfigure(false);
          }
        }}
      >
        {(configure || !params.tableId) && (
          <div className="space-y-2">
            <Choice
              label="Table"
              value={params.tableId}
              options={(tables.data ?? []).map((t) => ({
                id: t.id,
                label: t.name,
              }))}
              disabled={saving}
              onChange={(tableId) => {
                change({
                  tableId,
                  labelColumnId: null,
                  valueColumnId: null,
                  groupColumnId: null,
                  columnIds: undefined,
                });
                setConfirm(null);
                setError(null);
              }}
            />
            {tables.loading && (
              <p className="text-xs text-muted-foreground">Loading tables…</p>
            )}
            {tables.error && (
              <p role="alert" className="text-sm text-destructive">
                Could not load tables.
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void tables.refetch()}
                >
                  Retry
                </Button>
              </p>
            )}
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const table = await source.createTable(newTable.trim());
                  change({
                    tableId: table.id,
                    labelColumnId: null,
                    valueColumnId: null,
                    groupColumnId: null,
                    columnIds: undefined,
                  });
                  setNewTable("");
                  setEditData(true);
                });
              }}
            >
              <input
                aria-label="New table name"
                placeholder="Name a new table…"
                className={INPUT}
                value={newTable}
                onChange={(e) => setNewTable(e.target.value)}
                disabled={saving}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={saving || !newTable.trim()}
              >
                Create table
              </Button>
            </form>
            {data && (
              <>
                <p className="px-2 text-xs text-muted-foreground">Widget title</p>
                <EditValue
                  value={params.title ?? ""}
                  label="Widget title"
                  onSave={async (title) => change({ title })}
                />
                <Choice
                  label="View"
                  value={params.view}
                  options={[
                    { id: "table", label: "Table" },
                    { id: "cards", label: "Cards" },
                    { id: "bar", label: "Bars" },
                  ]}
                  onChange={(view) =>
                    change({ view: view as typeof params.view })
                  }
                />
                <Choice
                  label="Label"
                  value={params.labelColumnId ?? ""}
                  options={[{ id: "", label: "Row number" }, ...columnOptions]}
                  onChange={(id) => change({ labelColumnId: id || null })}
                />
                {params.view === "cards" && (
                  <Choice
                    label="Group by"
                    value={params.groupColumnId ?? ""}
                    options={[{ id: "", label: "None" }, ...columnOptions]}
                    onChange={(id) => change({ groupColumnId: id || null })}
                  />
                )}
                {params.view === "bar" && (
                  <Choice
                    label="Value"
                    value={params.valueColumnId}
                    options={data.columns
                      .filter((c) => c.type === "number")
                      .map((c) => ({ id: c.id, label: c.name }))}
                    onChange={(valueColumnId) => change({ valueColumnId })}
                  />
                )}
                <div className="flex flex-wrap gap-3 px-2">
                  {data.columns.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={columns.some((column) => column.id === c.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setParams((current) => {
                            const selected = normalizeDataViewParams(current).columnIds ?? data.columns.map((column) => column.id);
                            return { columnIds: checked
                              ? [...new Set([...selected, c.id])]
                              : selected.filter((id) => id !== c.id) };
                          });
                        }}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <EditValue
                      value={data.table.name}
                      label="Table name"
                      disabled={saving}
                      onSave={(name) => source.renameTable(name)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete table"
                    disabled={saving}
                    onClick={() =>
                      setConfirm({
                        label: `Delete “${data.table.name}” and all its rows and columns? Every widget using this table will lose its data.`,
                        run: async () => {
                          await source.deleteTable();
                          change({ tableId: null });
                        },
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
        {source.loading && (
          <p className="text-sm text-muted-foreground" role="status">
            Loading data…
          </p>
        )}
        {source.error && (
          <div role="alert" className="text-sm text-destructive">
            Could not load this table.
            <Button
              variant="ghost"
              size="xs"
              onClick={() => void source.refetch()}
            >
              Retry
            </Button>
          </div>
        )}
        {!params.tableId && (
          <p className="text-sm text-muted-foreground">
            Choose a table or create one. Add your own columns and rows, then
            display the same data as a table, cards, or chart.
          </p>
        )}
        {params.tableId && !source.loading && !source.error && !data && (
          <p className="text-sm text-muted-foreground">
            This table is unavailable. Choose another table in Configure.
          </p>
        )}
        {data && (
          <>
            {params.view !== "table" && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setEditData(!editData)}
                aria-expanded={editData}
              >
                {editData ? "Hide data editor" : "Edit data"}
              </Button>
            )}
            {!data.rows.length && (
              <p className="text-sm text-muted-foreground">
                No rows yet. Add columns and rows in the data editor.
              </p>
            )}
            {showEditor && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        {columns.map((column) => (
                          <th
                            key={column.id}
                            className="min-w-32 text-left font-medium"
                          >
                            <div className="flex items-center">
                              <EditValue
                                value={column.name}
                                label={`Rename ${column.name}`}
                                disabled={saving}
                                onSave={(name) =>
                                  source.renameColumn(column.id, name)
                                }
                              />
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Delete column ${column.name}`}
                                disabled={saving}
                                onClick={() =>
                                  setConfirm({
                                    label: `Delete “${column.name}” and every value in this column?`,
                                    run: () => source.deleteColumn(column.id),
                                  })
                                }
                              >
                                <Trash2 size={12} />
                              </Button>
                            </div>
                            <span className="px-2 text-xs font-normal text-muted-foreground">
                              {column.type}
                            </span>
                          </th>
                        ))}
                        <th className="w-8">
                          <span className="sr-only">Row actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, index) => (
                        <tr
                          key={row.id}
                          className="border-t border-[var(--border-subtle)]"
                        >
                          {columns.map((column) => (
                            <td key={column.id}>{cell(row.id, column)}</td>
                          ))}
                          <td>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Delete row ${index + 1}`}
                              disabled={saving}
                              onClick={() =>
                                setConfirm({
                                  label: `Delete row ${index + 1} and its values?`,
                                  run: () => source.deleteRow(row.id),
                                })
                              }
                            >
                              <Trash2 size={12} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!columns.length && (
                  <p className="text-xs text-muted-foreground">
                    Add a column or select visible columns in Configure.
                  </p>
                )}
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await source.createColumn(newColumn.trim(), columnType);
                      change({ columnIds: undefined });
                      setNewColumn("");
                      requestAnimationFrame(() =>
                        newColumnInput.current?.focus(),
                      );
                    });
                  }}
                >
                  <input
                    ref={newColumnInput}
                    aria-label="New column name"
                    placeholder="Name a column…"
                    className={`${INPUT} flex-1`}
                    value={newColumn}
                    disabled={saving}
                    onChange={(e) => setNewColumn(e.target.value)}
                  />
                  <Choice
                    label="Type"
                    value={columnType}
                    disabled={saving}
                    options={COLUMN_TYPES.map((id) => ({ id, label: id }))}
                    onChange={(id) => setColumnType(id as DataTableColumnType)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    type="submit"
                    disabled={saving || !newColumn.trim()}
                  >
                    Add column
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    disabled={saving || !data.columns.length}
                    onClick={() => void run(() => source.createRow())}
                  >
                    Add row
                  </Button>
                </form>
              </>
            )}
            {params.view === "cards" && (
              <div className="space-y-4">
                {groupDataRows(
                  data.rows,
                  data.cellsByRow,
                  params.groupColumnId,
                ).map((group) => (
                  <section key={group.key} className="space-y-2">
                    {group.label && (
                      <h3 className="text-sm font-medium">
                        {group.label}{" "}
                        <span className="text-muted-foreground">
                          {group.rows.length}
                        </span>
                      </h3>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {group.rows.map((row) => (
                        <article
                          key={row.id}
                          className="rounded-md border border-[var(--border-subtle)] p-3"
                        >
                          {params.labelColumnId && (
                            <h4 className="mb-2 break-words text-sm font-medium">
                              {displayCell(
                                data.cellsByRow[row.id]?.[params.labelColumnId],
                              ) || "Untitled"}
                            </h4>
                          )}
                          <dl className="space-y-2">
                            {columns
                              .filter((c) => c.id !== params.labelColumnId)
                              .map((column) => (
                                <div key={column.id}>
                                  <dt className="text-xs text-muted-foreground">
                                    {column.name}
                                  </dt>
                                  <dd className="whitespace-pre-wrap break-words text-sm">
                                    {displayCell(
                                      data.cellsByRow[row.id]?.[column.id],
                                    ) || "—"}
                                  </dd>
                                </div>
                              ))}
                          </dl>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {params.view === "bar" && (
              <DataBars
                rows={dataBars(
                  data.rows,
                  data.cellsByRow,
                  params.labelColumnId,
                  params.valueColumnId,
                )}
                valueLabel={
                  data.columns.find((c) => c.id === params.valueColumnId)?.name
                }
              />
            )}
          </>
        )}
        {confirm && (
          <div role="alert" className="space-y-2 rounded-md bg-muted/40 p-3">
            <p className="text-sm">{confirm.label}</p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={saving}
                onClick={() =>
                  void run(async () => {
                    await confirm.run();
                    setConfirm(null);
                  })
                }
              >
                Delete
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={() => setConfirm(null)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {saving && (
          <p role="status" className="text-xs text-muted-foreground">
            Saving…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error} Try the action again.
          </p>
        )}
      </div>
    </>
  );
}
function DataBars({
  rows,
  valueLabel,
}: {
  rows: { id: string; label: string; value: number }[];
  valueLabel?: string;
}) {
  if (!valueLabel)
    return (
      <p className="text-sm text-muted-foreground">
        Choose a numeric value column in Configure.
      </p>
    );
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground">
        No numeric readings in {valueLabel} yet. Empty and invalid readings are
        excluded.
      </p>
    );
  return (
    <div
      className="h-64 w-full"
      role="img"
      aria-label={`${valueLabel}: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
          <XAxis dataKey="label" stroke="var(--text-secondary)" />
          <YAxis stroke="var(--text-secondary)" />
          <Tooltip
            contentStyle={{
              background: "var(--surface-overlay)",
              borderColor: "var(--border-subtle)",
            }}
          />
          <Bar dataKey="value" name={valueLabel} fill="var(--accent-default)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
