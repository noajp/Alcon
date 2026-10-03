'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUserId, supabase } from '@/lib/supabase';
import { createElement } from '@/ActivitySpace/execution/element/data';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { readAllPages } from './readAllPages';
import {
  addDays, compareScenario, DEFAULT_POLICY, planScm,
  type ScmDemandPoint, type ScmInput, type ScmItem, type ScmLocation, type ScmMovementKind, type ScmPlan,
  type ScmPolicy, type ScmPoStatus, type ScmProposal, type ScmPurchaseOrder, type ScmScenario, type ScmStock, type ScmSupplier,
} from '@/ActivitySpace/sustainment/scm/scmEngine';
import { generateScmSample } from '@/ActivitySpace/sustainment/scm/scmSample';
import type { ScmImportRow } from '@/ActivitySpace/sustainment/scm/scmImport';

// Everything SCM reads and writes. One query per Space loads the whole supply
// chain; the planner runs in the browser over that snapshot, and every write
// invalidates it. RLS scopes every table to members of the Space.

export interface ScmSupplierRecord extends ScmSupplier { contact: string | null; email: string | null; notes: string | null }
export interface ScmRun { id: string; ranAt: string; summary: ScmRunSummary }
export interface ScmRunSummary {
  created: { poId: string; number: number; supplier: string; location: string; total: number; currency: string; status: ScmPoStatus; lines: number }[];
  skipped: number;
  trigger: 'manual' | 'autopilot';
  status?: 'running' | 'failed';
  error?: string;
}

export interface ScmMovementRecord {
  id: string; itemId: string; locationId: string; kind: ScmMovementKind; quantity: number;
  occurredOn: string; poId: string | null; note: string | null; createdAt: string;
  /** The movement this one reverses, and whether this one has been reversed. */
  reversesId: string | null; reversed: boolean;
}
export interface ScmLedgerFilter { itemId?: string | null; locationId?: string | null; kind?: ScmMovementKind | null; from?: string | null; to?: string | null }

/** The stock ledger, newest first, a page at a time. */
export function useScmLedger(spaceId: string | null, filter: ScmLedgerFilter, limit: number) {
  const query = useQuery({
    queryKey: [...KEY(spaceId), 'ledger', filter, limit],
    enabled: !!spaceId,
    // "Show more" keeps the rows on screen while the longer page loads; a new
    // filter starts empty rather than showing the previous filter's rows.
    placeholderData: (previous, previousQuery) => previousQuery && JSON.stringify(previousQuery.queryKey[3]) === JSON.stringify(filter) ? previous : undefined,
    queryFn: async () => {
      let request = supabase.from('scm_movements').select('*', { count: 'exact' }).eq('activity_space_id', spaceId!);
      if (filter.itemId) request = request.eq('item_id', filter.itemId);
      if (filter.locationId) request = request.eq('location_id', filter.locationId);
      if (filter.kind) request = request.eq('kind', filter.kind);
      if (filter.from) request = request.gte('occurred_on', filter.from);
      if (filter.to) request = request.lte('occurred_on', filter.to);
      const { data, error, count } = await request.order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).order('id').range(0, limit - 1);
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map((row: Row) => String(row.id));
      const reversed = new Set<string>();
      for (let index = 0; index < ids.length; index += 100) {
        const { data: hits, error: hitError } = await supabase.from('scm_movements').select('reverses_id').in('reverses_id', ids.slice(index, index + 100));
        if (hitError) throw new Error(hitError.message);
        for (const hit of hits ?? []) reversed.add(String((hit as Row).reverses_id));
      }
      return {
        total: count ?? 0,
        rows: (data ?? []).map((row: Row): ScmMovementRecord => ({
          id: String(row.id), itemId: String(row.item_id), locationId: String(row.location_id), kind: row.kind as ScmMovementKind,
          quantity: num(row.quantity), occurredOn: String(row.occurred_on), poId: (row.po_id as string | null) ?? null,
          note: (row.note as string | null) ?? null, createdAt: String(row.created_at),
          reversesId: (row.reverses_id as string | null) ?? null, reversed: reversed.has(String(row.id)),
        })),
      };
    },
  });
  return { data: query.data ?? null, loading: query.isLoading, error: query.error as Error | null };
}

export interface ScmData {
  spaceId: string;
  today: string;
  policy: ScmPolicy;
  hasPolicy: boolean;
  locations: ScmLocation[];
  suppliers: ScmSupplierRecord[];
  items: ScmItem[];
  stock: ScmStock[];
  demand: ScmDemandPoint[];
  orders: (ScmPurchaseOrder & { rationale: string | null; elementId: string | null; createdAt: string })[];
  runs: ScmRun[];
}

const KEY = (spaceId: string | null) => ['scm', spaceId] as const;
const num = (value: unknown, fallback = 0) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};
const numOrNull = (value: unknown) => value === null || value === undefined ? null : num(value);

type Row = Record<string, unknown>;

type Page = PromiseLike<{ data: Row[] | null; error: { message: string } | null; count: number | null }>;

async function all(label: string, table: string, spaceId: string, columns = '*', or?: string) {
  return readAllPages<Row>(label, (from, to) => {
    let query = supabase.from(table).select(columns, { count: 'exact' }).eq('activity_space_id', spaceId);
    if (or) query = query.or(or);
    return query.order('id').range(from, to) as unknown as Page;
  }, row => String(row.id));
}

async function fetchScm(spaceId: string, today: string): Promise<ScmData> {
  const { data: policyRow, error: policyError } = await supabase.from('scm_policies').select('*').eq('activity_space_id', spaceId).maybeSingle();
  if (policyError) throw new Error(policyError.message);
  const policy: ScmPolicy = policyRow ? {
    serviceLevel: num(policyRow.service_level, DEFAULT_POLICY.serviceLevel), horizonDays: num(policyRow.horizon_days, DEFAULT_POLICY.horizonDays),
    reviewDays: num(policyRow.review_days, DEFAULT_POLICY.reviewDays), lookbackDays: num(policyRow.lookback_days, DEFAULT_POLICY.lookbackDays),
    orderingCost: num(policyRow.ordering_cost), holdingRate: num(policyRow.holding_rate, DEFAULT_POLICY.holdingRate),
    autopilotEnabled: !!policyRow.autopilot_enabled, autoApproveLimit: num(policyRow.auto_approve_limit),
    monthlyBudget: numOrNull(policyRow.monthly_budget), currency: String(policyRow.currency ?? 'JPY'),
  } : DEFAULT_POLICY;
  const since = addDays(today, -365);
  const [locations, suppliers, items, stock, orders, demand, runs] = await Promise.all([
    all('locations', 'scm_locations', spaceId),
    all('suppliers', 'scm_suppliers', spaceId),
    all('items', 'scm_items', spaceId),
    readAllPages<Row>('stock', (from, to) => supabase.from('scm_stock').select('*', { count: 'exact' }).eq('activity_space_id', spaceId)
      .order('item_id').order('location_id').range(from, to) as unknown as Page, row => `${row.item_id}:${row.location_id}`),
    all('purchase orders', 'scm_purchase_orders', spaceId, '*, scm_po_lines(*)', `ordered_on.gte.${since},status.in.(draft,approved,sent,partial)`),
    readAllPages<Row>('demand history', (from, to) => supabase.rpc('scm_demand_history', { p_space: spaceId, p_since: addDays(today, -policy.lookbackDays) }, { count: 'exact' })
      .range(from, to) as unknown as Page,
    row => `${row.item_id}:${row.location_id}:${row.day}`),
    supabase.from('scm_autopilot_runs').select('*').eq('activity_space_id', spaceId).order('ran_at', { ascending: false }).limit(20),
  ]);
  if (runs.error) throw new Error(runs.error.message);
  return {
    spaceId, today, policy, hasPolicy: !!policyRow,
    locations: locations.map(row => ({ id: String(row.id), name: String(row.name), code: (row.code as string | null) ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    suppliers: suppliers.map(row => ({
      id: String(row.id), name: String(row.name), leadTimeDays: num(row.lead_time_days, 14), currency: String(row.currency),
      contact: (row.contact as string | null) ?? null, email: (row.email as string | null) ?? null, notes: (row.notes as string | null) ?? null,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    items: items.map(row => ({
      id: String(row.id), sku: String(row.sku), name: String(row.name), unit: String(row.unit), category: (row.category as string | null) || null,
      supplierId: (row.supplier_id as string | null) ?? null, unitCost: num(row.unit_cost), unitPrice: numOrNull(row.unit_price),
      currency: String(row.currency), leadTimeDays: numOrNull(row.lead_time_days), moq: num(row.moq), orderMultiple: num(row.order_multiple, 1),
      serviceLevel: numOrNull(row.service_level), baselineDailyDemand: numOrNull(row.baseline_daily_demand), active: row.active !== false,
    })).sort((a, b) => a.sku.localeCompare(b.sku)),
    stock: stock.map(row => ({ itemId: String(row.item_id), locationId: String(row.location_id), onHand: num(row.on_hand) })),
    demand: demand.map(row => ({ itemId: String(row.item_id), locationId: String(row.location_id), day: String(row.day), quantity: num(row.quantity) })),
    orders: orders.map(row => ({
      id: String(row.id), number: num(row.number), supplierId: String(row.supplier_id), locationId: String(row.location_id),
      status: row.status as ScmPoStatus, orderedOn: String(row.ordered_on), expectedOn: String(row.expected_on),
      receivedOn: (row.received_on as string | null) ?? null, currency: String(row.currency), source: (row.source === 'autopilot' || row.source === 'copilot' ? row.source : 'human') as ScmPurchaseOrder['source'],
      rationale: (row.rationale as string | null) ?? null, elementId: (row.element_id as string | null) ?? null, createdAt: String(row.created_at),
      lines: ((row.scm_po_lines as Row[] | null) ?? []).map(line => ({
        id: String(line.id), itemId: String(line.item_id), quantity: num(line.quantity), unitCost: num(line.unit_cost), receivedQuantity: num(line.received_quantity),
      })),
    })).sort((a, b) => b.number - a.number),
    runs: (runs.data ?? []).map(row => ({ id: String(row.id), ranAt: String(row.ran_at), summary: row.summary as ScmRunSummary })),
  };
}

function scmToday() {
  return toDateOnlyString(new Date());
}

export function useScmData(spaceId: string | null) {
  const today = scmToday();
  const query = useQuery({
    queryKey: [...KEY(spaceId), today],
    queryFn: () => fetchScm(spaceId!, today),
    enabled: !!spaceId,
    staleTime: 30_000,
  });
  return { data: query.data ?? null, loading: query.isLoading, error: query.error as Error | null, refetch: query.refetch };
}

// The baseline plan is computed once per snapshot and shared by every surface
// that shows it (sidebar counts, the main pane, the item detail).
const planCache = new WeakMap<ScmData, ScmPlan>();
function scmInput(data: ScmData, scenario?: ScmScenario): ScmInput {
  return { ...data, scenario };
}
export function useScmPlan(data: ScmData | null): ScmPlan | null {
  return useMemo(() => {
    if (!data) return null;
    const cached = planCache.get(data);
    if (cached) return cached;
    const plan = planScm(scmInput(data));
    planCache.set(data, plan);
    return plan;
  }, [data]);
}
export function useScmScenario(data: ScmData | null, scenario: ScmScenario | null) {
  const baseline = useScmPlan(data);
  return useMemo(() => {
    if (!data || !baseline || !scenario) return null;
    const plan = planScm(scmInput(data, scenario));
    return { plan, delta: compareScenario(baseline, plan) };
  }, [data, baseline, scenario]);
}

// ---------------------------------------------------------------------------
// Writes

/** Throws the server's message; a select that returned no row is an error too. */
async function check<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

export interface ScmItemDraft {
  sku: string; name: string; unit: string; category: string | null; supplierId: string | null;
  unitCost: number; unitPrice: number | null; currency: string; leadTimeDays: number | null;
  moq: number; orderMultiple: number; serviceLevel: number | null; baselineDailyDemand: number | null;
}
export interface ScmSupplierDraft { name: string; contact: string | null; email: string | null; leadTimeDays: number; currency: string; notes: string | null }
export interface ScmOrderDraft {
  supplierId: string; locationId: string; status: ScmPoStatus; orderedOn: string; expectedOn: string; currency: string;
  source: 'human' | 'autopilot'; rationale: string | null; lines: { itemId: string; quantity: number; unitCost: number }[];
}

const itemRow = (draft: ScmItemDraft) => ({
  sku: draft.sku.trim(), name: draft.name.trim(), unit: draft.unit.trim() || 'pcs', category: draft.category?.trim() || null,
  supplier_id: draft.supplierId, unit_cost: draft.unitCost, unit_price: draft.unitPrice, currency: draft.currency.toUpperCase(),
  lead_time_days: draft.leadTimeDays, moq: draft.moq, order_multiple: draft.orderMultiple, service_level: draft.serviceLevel,
  baseline_daily_demand: draft.baselineDailyDemand,
});
const supplierRow = (draft: ScmSupplierDraft) => ({
  name: draft.name.trim(), contact: draft.contact?.trim() || null, email: draft.email?.trim() || null,
  lead_time_days: draft.leadTimeDays, currency: draft.currency.toUpperCase(), notes: draft.notes?.trim() || null,
});

const SIGN: Record<ScmMovementKind, 1 | -1 | 0> = { receipt: 1, transfer_in: 1, issue: -1, transfer_out: -1, adjust: 0 };

async function insertChunks(table: string, rows: Row[], size = 500) {
  for (let index = 0; index < rows.length; index += size) await check(supabase.from(table).insert(rows.slice(index, index + size)));
}

export function useScmActions(spaceId: string | null) {
  const queryClient = useQueryClient();
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: KEY(spaceId) }), [queryClient, spaceId]);
  const space = useCallback(() => {
    if (!spaceId) throw new Error('Choose a Space first.');
    return spaceId;
  }, [spaceId]);

  return useMemo(() => {
    const done = async <T,>(work: Promise<T>) => { try { return await work; } finally { await refresh(); } };

    /** Lines are written while the order is a draft, so a failed line insert
     * can be undone; the order then moves to its intended status. */
    async function createOrder(draft: ScmOrderDraft) {
      const activity_space_id = space();
      if (!draft.lines.length) throw new Error('Add at least one line.');
      const order = await check(supabase.from('scm_purchase_orders').insert({
        activity_space_id, supplier_id: draft.supplierId, location_id: draft.locationId, status: 'draft',
        ordered_on: draft.orderedOn, expected_on: draft.expectedOn < draft.orderedOn ? draft.orderedOn : draft.expectedOn,
        currency: draft.currency, source: draft.source, rationale: draft.rationale,
      }).select('id, number').single());
      try {
        await check(supabase.from('scm_po_lines').insert(draft.lines.map(line => ({
          activity_space_id, po_id: order.id, item_id: line.itemId, quantity: line.quantity, unit_cost: line.unitCost,
        }))));
      } catch (cause) {
        // Never leave an order without lines.
        await supabase.from('scm_purchase_orders').delete().eq('id', order.id);
        throw cause;
      }
      if (draft.status !== 'draft') {
        try { await check(supabase.from('scm_purchase_orders').update({ status: draft.status }).eq('id', order.id)); }
        catch (cause) {
          // A draft nobody asked for is worse than no order: undo it.
          await supabase.from('scm_purchase_orders').delete().eq('id', order.id);
          throw cause;
        }
      }
      return order as { id: string; number: number };
    }

    /** An order beyond the autopilot's authority becomes an Element in the approver's queue. */
    async function escalate(order: { id: string; number: number }, proposal: Pick<ScmProposal, 'supplierName' | 'locationName' | 'total' | 'currency' | 'needBy' | 'authority' | 'lines'>, reason: string) {
      const userId = await getCurrentUserId();
      if (!userId) return null;
      const lines = proposal.lines.map(line => `- ${line.sku} ${line.name}: ${line.quantity} × ${line.unitCost.toLocaleString()} = ${line.value.toLocaleString()}`);
      const element = await createElement({
        title: `Approve PO-${order.number}: ${proposal.supplierName} → ${proposal.locationName} (${proposal.currency} ${Math.round(proposal.total).toLocaleString()})`,
        description: [
          reason, '',
          `Supplier: ${proposal.supplierName}`, `Deliver to: ${proposal.locationName}`,
          `Total: ${proposal.currency} ${Math.round(proposal.total).toLocaleString()}`,
          proposal.needBy ? `Needed before: ${proposal.needBy}` : null,
          '', 'Lines', ...lines, '',
          'Approve or change the draft in SCM › Orders. The order is not placed until it is approved.',
        ].filter(line => line !== null).join('\n'),
        owner_id: userId, status: 'todo', priority: proposal.needBy ? 'urgent' : 'high',
        due_date: proposal.needBy ?? null, labels: ['scm', 'approval'],
      });
      await check(supabase.from('scm_purchase_orders').update({ element_id: element.id }).eq('id', order.id));
      void queryClient.invalidateQueries({ queryKey: ['my-elements'] });
      return element;
    }

    /**
     * place: a person places the order (approved). draft: a person saves it
     * for approval. autopilot: the planner acts — approved only within the
     * authority the policy grants, otherwise drafted for approval — and logs
     * the run.
     */
    async function placeProposals(proposals: ScmProposal[], options: { mode: 'place' | 'draft' | 'autopilot'; policy: ScmPolicy; today: string; explain: (proposal: ScmProposal) => string; minHoursSinceLastRun?: number }) {
      const activity_space_id = space();
      // An autopilot run is claimed in the database first: across tabs and
      // members only one run proceeds; the others stop before writing.
      let runId: string | null = null;
      if (options.mode === 'autopilot') {
        runId = await check(supabase.rpc('scm_claim_autopilot_run', { p_space: activity_space_id, p_min_hours: options.minHoursSinceLastRun ?? 0.01 })) as unknown as string | null;
        if (!runId) return null;
      }
      const created: ScmRunSummary['created'] = [];
      let skipped = 0;
      try {
      for (const proposal of proposals) {
        if (!proposal.lines.length) { skipped += 1; continue; }
        const status: ScmPoStatus = options.mode === 'place' ? 'approved'
          : options.mode === 'autopilot' && options.policy.autopilotEnabled && proposal.authority === 'auto' ? 'approved' : 'draft';
        const rationale = options.explain(proposal);  // evidence travels with the order
        const order = await createOrder({
          supplierId: proposal.supplierId, locationId: proposal.locationId, status, orderedOn: options.today, expectedOn: proposal.expectedOn,
          currency: proposal.currency, source: options.mode === 'autopilot' ? 'autopilot' : 'human', rationale,
          lines: proposal.lines.map(line => ({ itemId: line.itemId, quantity: line.quantity, unitCost: line.unitCost })),
        });
        if (status === 'draft') await escalate(order, proposal, rationale).catch(() => null);
        created.push({ poId: order.id, number: order.number, supplier: proposal.supplierName, location: proposal.locationName, total: proposal.total, currency: proposal.currency, status, lines: proposal.lines.length });
      }
      } catch (cause) {
        // A failure mid-run leaves the orders already written; the run log records them and the error.
        const error = cause instanceof Error ? cause.message : String(cause);
        if (runId) await supabase.from('scm_autopilot_runs').update({ summary: { created, skipped, trigger: 'autopilot', status: 'failed', error } }).eq('id', runId);
        throw cause;
      }
      const summary: ScmRunSummary = { created, skipped, trigger: options.mode === 'autopilot' ? 'autopilot' : 'manual' };
      if (runId) await check(supabase.from('scm_autopilot_runs').update({ summary }).eq('id', runId));
      return summary;
    }

    return {
      refresh,
      savePolicy: (policy: ScmPolicy) => done(check(supabase.from('scm_policies').upsert({
        activity_space_id: space(), service_level: policy.serviceLevel, horizon_days: policy.horizonDays, review_days: policy.reviewDays,
        lookback_days: policy.lookbackDays, ordering_cost: policy.orderingCost, holding_rate: policy.holdingRate,
        autopilot_enabled: policy.autopilotEnabled, auto_approve_limit: policy.autoApproveLimit, monthly_budget: policy.monthlyBudget,
        currency: policy.currency.toUpperCase(), updated_at: new Date().toISOString(),
      }))),
      saveLocation: (id: string | null, draft: { name: string; code: string | null }) => done(id
        ? check(supabase.from('scm_locations').update({ name: draft.name.trim(), code: draft.code?.trim() || null }).eq('id', id))
        : check(supabase.from('scm_locations').insert({ activity_space_id: space(), name: draft.name.trim(), code: draft.code?.trim() || null }))),
      deleteLocation: (id: string) => done(check(supabase.from('scm_locations').delete().eq('id', id))),
      saveSupplier: (id: string | null, draft: ScmSupplierDraft) => done(id
        ? check(supabase.from('scm_suppliers').update(supplierRow(draft)).eq('id', id))
        : check(supabase.from('scm_suppliers').insert({ activity_space_id: space(), ...supplierRow(draft) }))),
      deleteSupplier: (id: string) => done(check(supabase.from('scm_suppliers').delete().eq('id', id))),
      saveItem: (id: string | null, draft: ScmItemDraft, opening?: { locationId: string; quantity: number } | null) => done((async () => {
        const activity_space_id = space();
        let itemId = id;
        if (id) await check(supabase.from('scm_items').update(itemRow(draft)).eq('id', id));
        else itemId = (await check(supabase.from('scm_items').insert({ activity_space_id, ...itemRow(draft) }).select('id').single())).id as string;
        if (!id && opening && itemId) {
          await check(supabase.rpc('scm_count_stock', { p_item: itemId, p_location: opening.locationId, p_counted: opening.quantity, p_on: scmToday(), p_note: 'Opening stock' }));
        }
        return itemId;
      })()),
      setItemActive: (id: string, active: boolean) => done(check(supabase.from('scm_items').update({ active }).eq('id', id))),
      deleteItem: (id: string) => done(check(supabase.from('scm_items').delete().eq('id', id))),
      recordMovement: (entry: { itemId: string; locationId: string; kind: Exclude<ScmMovementKind, 'transfer_in' | 'transfer_out'>; quantity: number; occurredOn: string; note: string | null }) => done((async () => {
        const sign = SIGN[entry.kind];
        const quantity = sign === 0 ? entry.quantity : sign * Math.abs(entry.quantity);
        if (!quantity) throw new Error('Enter a quantity other than zero.');
        await check(supabase.from('scm_movements').insert({
          activity_space_id: space(), item_id: entry.itemId, location_id: entry.locationId, kind: entry.kind, quantity,
          occurred_on: entry.occurredOn, note: entry.note?.trim() || null,
        }));
      })()),
      transfer: (entry: { itemId: string; from: string; to: string; quantity: number; occurredOn: string; note: string | null }) => done((async () => {
        if (entry.from === entry.to) throw new Error('Choose two different locations.');
        if (!(entry.quantity > 0)) throw new Error('Enter a quantity above zero.');
        const activity_space_id = space();
        const note = entry.note?.trim() || 'Transfer';
        // One request: both legs are written or neither is.
        await check(supabase.from('scm_movements').insert([
          { activity_space_id, item_id: entry.itemId, location_id: entry.from, kind: 'transfer_out', quantity: -entry.quantity, occurred_on: entry.occurredOn, note },
          { activity_space_id, item_id: entry.itemId, location_id: entry.to, kind: 'transfer_in', quantity: entry.quantity, occurred_on: entry.occurredOn, note },
        ]));
      })()),
      countStock: (itemId: string, locationId: string, counted: number, on: string, note: string | null) =>
        done(check(supabase.rpc('scm_count_stock', { p_item: itemId, p_location: locationId, p_counted: counted, p_on: on, p_note: note || null }))),
      createOrder: (draft: ScmOrderDraft) => done(createOrder(draft)),
      /** Approving or rejecting a draft also closes the approval Element it raised. */
      /** Moves an order on only from the status the person saw, so a stale
       * screen cannot approve a rejected draft or cancel a receipt in progress.
       * Approving or rejecting a draft also closes the approval Element it raised. */
      setOrderStatus: (id: string, from: ScmPoStatus, status: ScmPoStatus) => done((async () => {
        const { data: rows, error } = await supabase.from('scm_purchase_orders').update({ status }).eq('id', id).eq('status', from).select('element_id');
        if (error) throw new Error(error.message);
        if (!rows?.length) throw new Error('This order changed since you opened it. Refresh and try again.');
        const elementId = (rows[0] as Row).element_id as string | null;
        if (elementId && (status === 'approved' || status === 'cancelled')) {
          // The Element belongs to whoever drafted the order; if this person
          // cannot close it, the order still moves and the Element stays open.
          await supabase.from('elements').update({ status: status === 'approved' ? 'done' : 'cancelled' }).eq('id', elementId);
          void queryClient.invalidateQueries({ queryKey: ['my-elements'] });
        }
      })()),
      /** Changes an open order: its date, and its lines all-or-nothing (quantity 0
       * removes a line). The database keeps at least one line, refuses closed
       * orders and cuts below what was received, and closes a partly received
       * order once nothing is left open. */
      updateOrder: (id: string, patch: { expectedOn?: string; lines?: { id: string; quantity: number }[]; add?: { itemId: string; quantity: number; unitCost: number }[] }) => done((async () => {
        if (patch.expectedOn) await check(supabase.from('scm_purchase_orders').update({ expected_on: patch.expectedOn }).eq('id', id));
        if (patch.lines?.length || patch.add?.length) {
          await check(supabase.rpc('scm_update_po_lines', {
            p_po: id,
            p_changes: (patch.lines ?? []).map(line => ({ line_id: line.id, quantity: line.quantity })),
            p_adds: (patch.add ?? []).map(line => ({ item_id: line.itemId, quantity: line.quantity, unit_cost: line.unitCost })),
          }));
        }
      })()),
      /** Only a draft can be deleted; anything placed is cancelled so its history stays. */
      deleteDraftOrder: (id: string) => done((async () => {
        const { data: rows, error } = await supabase.from('scm_purchase_orders').delete().eq('id', id).eq('status', 'draft').select('element_id');
        if (error) throw new Error(error.message);
        if (!rows?.length) throw new Error('This order changed since you opened it. Refresh and try again.');
        const elementId = (rows[0] as Row).element_id as string | null;
        if (elementId) {
          await supabase.from('elements').update({ status: 'cancelled' }).eq('id', elementId);
          void queryClient.invalidateQueries({ queryKey: ['my-elements'] });
        }
      })()),
      /** The ledger is never edited: a mistaken movement is undone by an opposite adjustment. */
      reverseMovement: (movement: ScmMovementRecord, today: string, note: string) => done((async () => {
        if (movement.poId) throw new Error('A receipt against a purchase order is corrected with a stock count, so the order keeps its received quantity.');
        if (movement.kind === 'transfer_in' || movement.kind === 'transfer_out') throw new Error('Transfers are undone with a transfer back.');
        const { error } = await supabase.from('scm_movements').insert({
          activity_space_id: space(), item_id: movement.itemId, location_id: movement.locationId, kind: 'adjust', quantity: -movement.quantity,
          occurred_on: today, note, reverses_id: movement.id,
        });
        // Another window reversed it first; the unique index keeps it to one.
        if (error?.code === '23505') throw new Error('This movement has already been reversed.');
        if (error) throw new Error(error.message);
      })()),
      receiveOrder: (id: string, lines: { lineId: string; quantity: number }[], receivedOn: string) =>
        done(check(supabase.rpc('scm_receive_po', { p_po: id, p_lines: lines.map(line => ({ line_id: line.lineId, quantity: line.quantity })), p_received_on: receivedOn }))),
      placeProposals: (proposals: ScmProposal[], options: Parameters<typeof placeProposals>[1]) => done(placeProposals(proposals, options)),
      /** Items matched by SKU are updated, new SKUs created; suppliers and
       * locations are matched by name and created when missing. Stock is set
       * by a count, so the ledger records the difference. */
      importRows: (rows: ScmImportRow[], current: ScmData) => done((async () => {
        const activity_space_id = space();
        const suppliers = new Map(current.suppliers.map(supplier => [supplier.name.trim().toLowerCase(), supplier.id]));
        const locations = new Map(current.locations.map(location => [location.name.trim().toLowerCase(), location.id]));
        for (const row of rows) {
          const name = row.supplier?.trim();
          if (name && !suppliers.has(name.toLowerCase())) {
            const created = await check(supabase.from('scm_suppliers').insert({ activity_space_id, name, lead_time_days: row.leadTimeDays ?? 14, currency: row.currency ?? current.policy.currency }).select('id').single());
            suppliers.set(name.toLowerCase(), created.id as string);
          }
        }
        if (!locations.size && rows.some(row => row.onHand !== null)) {
          const created = await check(supabase.from('scm_locations').insert({ activity_space_id, name: rows.find(row => row.location)?.location ?? 'Main' }).select('id, name').single());
          locations.set(String(created.name).toLowerCase(), created.id as string);
        }
        for (const row of rows) {
          const name = row.location?.trim();
          if (name && !locations.has(name.toLowerCase())) {
            const created = await check(supabase.from('scm_locations').insert({ activity_space_id, name }).select('id').single());
            locations.set(name.toLowerCase(), created.id as string);
          }
        }
        const existing = new Map(current.items.map(item => [item.sku, item.id]));
        let items = 0;
        let counts = 0;
        for (const row of rows) {
          const patch: Row = { sku: row.sku.trim(), name: row.name.trim() };
          if (row.category !== null) patch.category = row.category;
          if (row.unit !== null) patch.unit = row.unit;
          if (row.supplier) patch.supplier_id = suppliers.get(row.supplier.trim().toLowerCase()) ?? null;
          if (row.unitCost !== null) patch.unit_cost = row.unitCost;
          if (row.unitPrice !== null) patch.unit_price = row.unitPrice;
          if (row.currency !== null) patch.currency = row.currency;
          if (row.moq !== null) patch.moq = row.moq;
          if (row.orderMultiple !== null) patch.order_multiple = row.orderMultiple;
          if (row.dailyDemand !== null) patch.baseline_daily_demand = row.dailyDemand;
          let itemId = existing.get(patch.sku as string);
          if (itemId) await check(supabase.from('scm_items').update(patch).eq('id', itemId));
          else {
            if (patch.currency === undefined) patch.currency = current.policy.currency;
            itemId = (await check(supabase.from('scm_items').insert({ activity_space_id, ...patch }).select('id').single())).id as string;
            existing.set(patch.sku as string, itemId);
          }
          items += 1;
          if (row.onHand !== null) {
            const locationId = row.location ? locations.get(row.location.trim().toLowerCase()) : [...locations.values()][0];
            if (locationId) {
              await check(supabase.rpc('scm_count_stock', { p_item: itemId, p_location: locationId, p_counted: row.onHand, p_on: current.today, p_note: 'Imported stock' }));
              counts += 1;
            }
          }
        }
        return { items, counts };
      })()),
      loadSample: (today: string) => done((async () => {
        const activity_space_id = space();
        const { count } = await supabase.from('scm_items').select('id', { count: 'exact', head: true }).eq('activity_space_id', activity_space_id);
        if (count) throw new Error('Sample data can only be loaded into an empty SCM.');
        const sample = generateScmSample(today);
        const ids = new Map<string, string>();
        const id = (key: string) => { let value = ids.get(key); if (!value) { value = crypto.randomUUID(); ids.set(key, value); } return value; };
        await insertChunks('scm_locations', sample.locations.map(location => ({ id: id(`l:${location.key}`), activity_space_id, name: location.name, code: location.code })));
        await insertChunks('scm_suppliers', sample.suppliers.map(supplier => ({ id: id(`s:${supplier.key}`), activity_space_id, name: supplier.name, contact: supplier.contact, email: supplier.email, lead_time_days: supplier.leadTimeDays, currency: supplier.currency, notes: supplier.notes })));
        await insertChunks('scm_items', sample.items.map(item => ({
          id: id(`i:${item.key}`), activity_space_id, sku: item.sku, name: item.name, unit: item.unit, category: item.category,
          supplier_id: id(`s:${item.supplierKey}`), unit_cost: item.unitCost, unit_price: item.unitPrice, currency: 'JPY', moq: item.moq, order_multiple: item.orderMultiple,
        })));
        await insertChunks('scm_purchase_orders', sample.orders.map(order => ({
          id: id(`p:${order.key}`), activity_space_id, supplier_id: id(`s:${order.supplierKey}`), location_id: id(`l:${order.locationKey}`),
          status: 'draft', ordered_on: order.orderedOn, expected_on: order.expectedOn, received_on: order.receivedOn, currency: 'JPY', source: 'human',
        })), 200);
        await insertChunks('scm_po_lines', sample.orders.flatMap(order => order.lines.map(line => ({
          activity_space_id, po_id: id(`p:${order.key}`), item_id: id(`i:${line.itemKey}`), quantity: line.quantity, unit_cost: line.unitCost, received_quantity: line.receivedQuantity,
        }))));
        // Lines go in while the orders are drafts; then each order takes its status.
        for (const status of [...new Set(sample.orders.map(order => order.status))]) {
          const ids = sample.orders.filter(order => order.status === status).map(order => id(`p:${order.key}`));
          for (let index = 0; index < ids.length; index += 100) await check(supabase.from('scm_purchase_orders').update({ status }).in('id', ids.slice(index, index + 100)));
        }
        await insertChunks('scm_movements', sample.movements.map(movement => ({
          activity_space_id, item_id: id(`i:${movement.itemKey}`), location_id: id(`l:${movement.locationKey}`), kind: movement.kind,
          quantity: movement.quantity, occurred_on: movement.occurredOn, po_id: movement.poKey ? id(`p:${movement.poKey}`) : null, note: movement.note,
        })));
        await check(supabase.from('scm_policies').upsert({
          activity_space_id, service_level: 0.95, horizon_days: 60, review_days: 7, lookback_days: 90, ordering_cost: 3000, holding_rate: 0.2,
          autopilot_enabled: false, auto_approve_limit: 150000, monthly_budget: 6000000, currency: 'JPY',
        }));
      })()),
      clearAll: () => done(check(supabase.rpc('scm_reset_space', { p_space: space() }))),
    };
  }, [queryClient, refresh, space]);
}

export type ScmActions = ReturnType<typeof useScmActions>;
