// A Strategy's Tables, read and written for a run (records.ts decides what
// changes). Tables, rows and cells go through the starter's JWT, so the
// Table's own RLS holds: a run saves into Tables its starter may write. The
// record of who read what (agent_table_reads) and the notice to a finished
// Element go through the service role, the engine's own bookkeeping.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { matchRows, planUpsert, staleNote, tableLine, type ExistingColumn } from "./records.ts";

export interface RecordScope {
  strategyId: string;
  domainId: string | null;
  elementId: string;
  runId: string;
  userId: string;
  agentName: string;
}

interface TableRow { id: string; name: string }

/** The Strategy the Element serves (through its Object), or null. */
export async function strategyOfElement(db: SupabaseClient, elementId: string): Promise<{ strategyId: string; domainId: string | null } | null> {
  const { data: el } = await db.from("elements").select("object_id").eq("id", elementId).maybeSingle();
  if (!el?.object_id) return null;
  const [{ data: link }, { data: obj }] = await Promise.all([
    db.from("strategy_objects").select("strategy_id").eq("object_id", el.object_id).limit(1).maybeSingle(),
    db.from("objects").select("domain_id").eq("id", el.object_id).maybeSingle(),
  ]);
  return link?.strategy_id ? { strategyId: link.strategy_id as string, domainId: (obj?.domain_id as string | null) ?? null } : null;
}

/** Lines for the run's context: the Strategy's Tables the starter can see. */
export async function strategyTableLines(db: SupabaseClient, strategyId: string): Promise<string[]> {
  const { data: tables } = await db.from("tables").select("id, name").eq("strategy_id", strategyId).eq("status", "active").order("created_at").limit(20);
  const list = (tables ?? []) as TableRow[];
  if (!list.length) return [];
  const ids = list.map((t) => t.id);
  const [{ data: cols }, { data: counts }] = await Promise.all([
    db.from("table_columns").select("table_id, name, order_index").in("table_id", ids).order("order_index"),
    db.rpc("table_row_counts", { p_table_ids: ids }),
  ]);
  const count = new Map(((counts ?? []) as { table_id: string; row_count: number }[]).map((c) => [c.table_id, Number(c.row_count)]));
  return list.map((t) => tableLine({
    name: t.name,
    columns: ((cols ?? []) as { table_id: string; name: string }[]).filter((c) => c.table_id === t.id).map((c) => c.name),
    rows: count.get(t.id) ?? 0,
  }));
}

async function findTable(db: SupabaseClient, strategyId: string, name: string): Promise<TableRow | null> {
  const { data } = await db.from("tables").select("id, name").eq("strategy_id", strategyId).eq("name", name).eq("status", "active").limit(1).maybeSingle();
  return (data as TableRow | null) ?? null;
}

/** A Table's columns and rows, with each row's cells by column name. */
async function loadTable(db: SupabaseClient, tableId: string) {
  const { data: cols, error: ce } = await db.from("table_columns").select("id, name, type, order_index").eq("table_id", tableId).order("order_index");
  if (ce) throw new Error(ce.message);
  const columns = (cols ?? []) as (ExistingColumn & { order_index: number })[];
  const rowIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("table_rows").select("id").eq("table_id", tableId).order("order_index").order("created_at").range(from, from + 999);
    if (error) throw new Error(error.message);
    rowIds.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
    if ((data ?? []).length < 1000) break;
  }
  const nameOf = new Map(columns.map((c) => [c.id, c.name]));
  const cells = new Map<string, Record<string, unknown>>(rowIds.map((id) => [id, {}]));
  for (let i = 0; i < rowIds.length; i += 200) {
    const { data, error } = await db.from("table_cells").select("row_id, column_id, value").in("row_id", rowIds.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { row_id: string; column_id: string; value: unknown }[]) {
      const name = nameOf.get(c.column_id);
      if (name) cells.get(c.row_id)![name] = c.value;
    }
  }
  return { columns, rows: rowIds.map((id) => ({ id, cells: cells.get(id)! })) };
}

/** Records the read, so a later change to the Table can tell this Element. */
async function noteRead(admin: SupabaseClient, scope: RecordScope, tableId: string) {
  await admin.from("agent_table_reads").upsert(
    { element_id: scope.elementId, table_id: tableId, run_id: scope.runId, read_at: new Date().toISOString() },
    { onConflict: "element_id,table_id" },
  );
}

export async function readRecords(db: SupabaseClient, admin: SupabaseClient, scope: RecordScope, input: Record<string, unknown>): Promise<string> {
  const name = String(input.table ?? "").trim();
  const table = name ? await findTable(db, scope.strategyId, name) : null;
  if (!table) throw new Error(`この Strategy に表「${name}」はありません。`);
  const { columns, rows } = await loadTable(db, table.id);
  await noteRead(admin, scope, table.id);
  const limit = typeof input.limit === "number" ? Math.min(Math.max(1, Math.floor(input.limit)), 500) : 200;
  const matched = matchRows(rows.map((r) => r.cells), input.where);
  return JSON.stringify({ table: table.name, columns: columns.map((c) => c.name), total: matched.length, rows: matched.slice(0, limit) }).slice(0, 60_000);
}

export interface SaveResult { table: string; created: boolean; added: number; updated: number; unchanged: number; skipped: string[]; notified: number }

export async function saveRecords(db: SupabaseClient, admin: SupabaseClient, scope: RecordScope, input: Record<string, unknown>): Promise<SaveResult> {
  const name = String(input.table ?? "").trim().slice(0, 200);
  const key = String(input.key ?? "").trim().slice(0, 100);
  const records = Array.isArray(input.records) ? input.records : [];
  if (!name || !key) throw new Error("table と key が必要です。");
  let table = await findTable(db, scope.strategyId, name);
  const created = !table;
  if (!table) {
    const { data, error } = await db.from("tables")
      .insert({ name, strategy_id: scope.strategyId, domain_id: scope.domainId, created_by: scope.userId, description: "エージェントが Strategy の対象を保存する表" })
      .select("id, name").single();
    if (error || !data) throw new Error(`表を作れませんでした: ${error?.message ?? ""}`);
    table = data as TableRow;
  }
  const { columns, rows } = await loadTable(db, table.id);
  const plan = planUpsert(columns, rows, key, records);

  const colId = new Map(columns.map((c) => [c.name, c.id]));
  let order = columns.reduce((m, c) => Math.max(m, c.order_index ?? 0), -1);
  for (const c of plan.newColumns) {
    const { data, error } = await db.from("table_columns").insert({ table_id: table.id, name: c.name, type: c.type, order_index: ++order }).select("id").single();
    if (error || !data) throw new Error(`列「${c.name}」を作れませんでした: ${error?.message ?? ""}`);
    colId.set(c.name, data.id as string);
  }
  const cellRows = (rowId: string, cells: Record<string, unknown>) =>
    Object.entries(cells).flatMap(([n, value]) => (colId.has(n) ? [{ row_id: rowId, column_id: colId.get(n)!, value, updated_at: new Date().toISOString() }] : []));

  if (plan.inserts.length) {
    const base = rows.length;
    const { data: newRows, error } = await db.from("table_rows")
      .insert(plan.inserts.map((_, i) => ({ table_id: table!.id, order_index: base + i }))).select("id, order_index");
    if (error || !newRows) throw new Error(`行を足せませんでした: ${error?.message ?? ""}`);
    const ids = (newRows as { id: string; order_index: number }[]).sort((a, b) => a.order_index - b.order_index).map((r) => r.id);
    const cells = plan.inserts.flatMap((rec, i) => cellRows(ids[i], rec));
    for (let i = 0; i < cells.length; i += 500) {
      const { error: e } = await db.from("table_cells").upsert(cells.slice(i, i + 500), { onConflict: "row_id,column_id" });
      if (e) throw new Error(`値を書けませんでした: ${e.message}`);
    }
  }
  if (plan.updates.length) {
    const cells = plan.updates.flatMap((u) => cellRows(u.rowId, u.cells));
    for (let i = 0; i < cells.length; i += 500) {
      const { error: e } = await db.from("table_cells").upsert(cells.slice(i, i + 500), { onConflict: "row_id,column_id" });
      if (e) throw new Error(`値を書けませんでした: ${e.message}`);
    }
    await db.from("table_rows").update({ updated_at: new Date().toISOString() }).in("id", plan.updates.map((u) => u.rowId));
  }
  // The run that wrote the Table has read it too.
  await noteRead(admin, scope, table.id);
  const notified = plan.inserts.length || plan.updates.length
    ? await tellStaleReaders(db, admin, scope, table, plan.inserts.length, plan.updates.length)
    : 0;
  return { table: table.name, created, added: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchanged, skipped: plan.skipped, notified };
}

/**
 * A finished Element that worked from this Table before it changed is sent
 * back for review, with a comment saying which Table changed and how. The
 * read is cleared, so one change tells it once; its next run reads anew.
 */
async function tellStaleReaders(db: SupabaseClient, admin: SupabaseClient, scope: RecordScope, table: TableRow, added: number, updated: number): Promise<number> {
  const { data: reads } = await admin.from("agent_table_reads").select("element_id").eq("table_id", table.id).neq("element_id", scope.elementId);
  const ids = ((reads ?? []) as { element_id: string }[]).map((r) => r.element_id);
  if (!ids.length) return 0;
  const { data: done } = await db.from("elements").select("id").in("id", ids).eq("status", "done");
  let told = 0;
  for (const { id } of (done ?? []) as { id: string }[]) {
    const { error } = await db.from("elements").update({ status: "review" }).eq("id", id);
    if (error) continue;
    await admin.from("element_comments").insert({
      element_id: id, author_id: scope.userId, author_kind: "ai_agent", author_name: scope.agentName,
      content: staleNote(table.name, added, updated),
    });
    await admin.from("agent_table_reads").delete().eq("element_id", id).eq("table_id", table.id);
    told++;
  }
  return told;
}
