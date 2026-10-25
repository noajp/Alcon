'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useCurrentUserId } from '@/providers/authContext';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { useWorkers } from '@/ActivitySpace/sustainment/team/data';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { createElement, updateElement } from '@/ActivitySpace/execution/element/data';
import { fetchDataTableSchema } from '@/ActivitySpace/sustainment/table/data';
import { readAllPages } from '@/hooks/readAllPages';
import {
  buildCrmWorkspace, fieldsFor, measureValue, metricKind, metricValue, normalizeCrmStages, parseActivityLog, resolveStage,
  type CrmActivityRecord, type CrmActivityType, type CrmCompanyRecord, type CrmContactRecord, type CrmDeal,
  type CrmDealContactRecord, type CrmDealRecord, type CrmElementLinkRecord, type CrmLinkedElement, type CrmDealRole, type CrmFieldRecord, type CrmNextElement, type CrmPerson, type CrmPipelineRecord, type CrmWorkspace,
} from '@/ActivitySpace/sustainment/crm/crmModel';

const EMPTY: never[] = [];
const ACTIVITY_WINDOW = 3000;

function all<Row extends { id: string }>(label: string, table: string, spaceId: string, order = 'created_at') {
  return readAllPages<Row>(label, (from, to) => supabase.from(table).select('*', { count: 'exact' })
    .eq('activity_space_id', spaceId).order(order, { ascending: true }).order('id').range(from, to) as never, row => row.id);
}

/** Deal values the App writes. Company and contact may be given by name; a
 * new name creates the record in this Space. */
export interface CrmDealPatch {
  name?: string;
  stage?: string;
  amount?: number | null;
  currency?: string;
  probability?: number | null;
  closeDate?: string | null;
  /** When the deal was won or lost; defaults to today when it closes now. */
  closedOn?: string | null;
  ownerId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  initiativeId?: string | null;
  source?: string | null;
  lostReason?: string | null;
  custom?: Record<string, unknown>;
  /** Next step without an Element (no Object to file it in). */
  nextStep?: string | null;
  nextStepOn?: string | null;
  /** The day the contract renews or ends. */
  renewsOn?: string | null;
}

/** The CRM App's single source: the active Space's pipelines and records,
 * shared by every member. The sidebar and the main pane read the same queries. */
export function useCrm(pipelineId?: string | null, { seed = false }: { seed?: boolean } = {}) {
  const qc = useQueryClient();
  const spaceId = useActiveSpaceId();
  const userId = useCurrentUserId();
  const enabled = !!spaceId && !!userId;
  const key = (part: string) => ['crm', spaceId, part];
  const options = { enabled, staleTime: 15_000, refetchOnWindowFocus: true };

  const pipelines = useQuery({ ...options, queryKey: key('pipelines'), queryFn: () => all<CrmPipelineRecord>('pipelines', 'crm_pipelines', spaceId!, 'order_index') });
  const deals = useQuery({ ...options, queryKey: key('deals'), queryFn: () => all<CrmDealRecord>('deals', 'crm_deals', spaceId!) });
  const companies = useQuery({ ...options, queryKey: key('companies'), queryFn: () => all<CrmCompanyRecord>('companies', 'crm_companies', spaceId!) });
  const contacts = useQuery({ ...options, queryKey: key('contacts'), queryFn: () => all<CrmContactRecord>('contacts', 'crm_contacts', spaceId!) });
  // The newest history only: health reads last contact from the deal, so older
  // entries matter only on a record's own timeline.
  const activities = useQuery({ ...options, queryKey: key('activities'), queryFn: async () => {
    const { data, error } = await supabase.from('crm_activities').select('*').eq('activity_space_id', spaceId!)
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(ACTIVITY_WINDOW);
    if (error) throw error;
    return (data ?? []) as CrmActivityRecord[];
  } });
  const fields = useQuery({ ...options, queryKey: key('fields'), queryFn: () => all<CrmFieldRecord>('fields', 'crm_fields', spaceId!, 'order_index') });
  const elementLinks = useQuery({ ...options, queryKey: key('element-links'), queryFn: () => all<CrmElementLinkRecord>('element links', 'crm_element_links', spaceId!) });
  // The linked Elements themselves, as far as the reader can see them.
  const linkedIds = useMemo(() => [...new Set((elementLinks.data ?? []).map(link => link.element_id))].sort(), [elementLinks.data]);
  const linkedElements = useQuery({
    ...options, enabled: enabled && linkedIds.length > 0, queryKey: [...key('linked-elements'), linkedIds],
    queryFn: async () => {
      const rows: CrmLinkedElement[] = [];
      for (let index = 0; index < linkedIds.length; index += 150) {
        const { data, error } = await supabase.from('elements').select('id,title,status,due_date,display_id').in('id', linkedIds.slice(index, index + 150));
        if (error) throw error;
        rows.push(...(data ?? []) as CrmLinkedElement[]);
      }
      return rows;
    },
  });
  const dealContacts = useQuery({ ...options, queryKey: key('deal-contacts'), queryFn: () => all<CrmDealContactRecord>('deal contacts', 'crm_deal_contacts', spaceId!) });
  const elementIds = useMemo(() => [...new Set((deals.data ?? []).map(deal => deal.next_element_id).filter((id): id is string => !!id))].sort(), [deals.data]);
  const elements = useQuery({
    ...options, enabled: enabled && elementIds.length > 0, queryKey: [...key('elements'), elementIds],
    queryFn: async () => {
      const rows: CrmNextElement[] = [];
      for (let index = 0; index < elementIds.length; index += 150) {
        const { data, error } = await supabase.from('elements').select('id,title,status,due_date,display_id').in('id', elementIds.slice(index, index + 150));
        if (error) throw error;
        rows.push(...(data ?? []) as CrmNextElement[]);
      }
      return rows;
    },
  });
  // The Table this Space's CRM used before it had its own records, offered once for import.
  const legacy = useQuery({
    ...options, queryKey: [...key('legacy'), userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('widget_boards').select('layout').eq('owner_id', userId!).eq('board_key', `crm:${spaceId}`).maybeSingle();
      if (error || !data) return null;
      const zones = (data.layout as { zones?: Record<string, { type?: string; params?: { kind?: string; tableId?: string; fields?: Record<string, string> } }[]> })?.zones ?? {};
      const planner = Object.values(zones).flat().find(item => item?.type === 'operations-planner' && (item.params?.kind ?? 'crm') === 'crm' && item.params?.tableId);
      return planner?.params?.tableId ? { tableId: planner.params.tableId, fields: planner.params.fields ?? {} } : null;
    },
  });
  const domainRows = useSustainmentDomains();
  const domains = useMemo(() => domainRows.data.map(domain => ({ id: domain.id, name: domain.name })), [domainRows.data]);
  const workers = useWorkers();
  const people: CrmPerson[] = useMemo(() => workers.data.map(worker => ({ id: worker.id, name: worker.name, type: worker.type, user_id: worker.user_id ?? null })), [workers.data]);
  const me = people.find(person => person.user_id === userId)?.id ?? null;

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['crm', spaceId] }), [qc, spaceId]);

  // Every Space starts with one pipeline, so the App always has somewhere to put
  // a deal. Only the main pane seeds, so two readers never create two. When the
  // Space's first pipeline exists but sits in a Domain this reader cannot see,
  // its slot is taken: the reader gets a Space-wide pipeline after it instead.
  const seeded = useRef<string | null>(null);
  useEffect(() => {
    if (!seed || !spaceId || !pipelines.data || pipelines.data.length || seeded.current === spaceId) return;
    seeded.current = spaceId;
    void (async () => {
      const first = await supabase.from('crm_pipelines').insert({ activity_space_id: spaceId, name: 'Sales', order_index: 0 });
      if (first.error?.code === '23505') await supabase.from('crm_pipelines').insert({ activity_space_id: spaceId, name: 'Sales', order_index: 1 });
      await invalidate();
    })();
  }, [seed, spaceId, pipelines.data, invalidate]);

  const pipeline = (pipelines.data ?? []).find(item => item.id === pipelineId) ?? pipelines.data?.[0] ?? null;
  const today = toDateOnlyString(new Date());
  const loaded = !!pipeline && !!deals.data && !!companies.data && !!contacts.data && !!activities.data && (elementIds.length === 0 || !!elements.data);
  const workspace = useMemo(() => loaded ? buildCrmWorkspace({
    pipeline: pipeline!, deals: deals.data!, companies: companies.data!, contacts: contacts.data!,
    activities: activities.data!, elements: elements.data ?? EMPTY, people,
  }, today) : null, [loaded, pipeline, deals.data, companies.data, contacts.data, activities.data, elements.data, people, today]);
  // Every pipeline's workspace, for what reads across pipelines — the scope's
  // overview, Today, the saved lists. Each keeps its own stages, currency and
  // rhythm; nothing here sums across currencies.
  const workspaces = useMemo(() => loaded ? (pipelines.data ?? []).map(item => item.id === pipeline!.id && workspace ? workspace : buildCrmWorkspace({
    pipeline: item, deals: deals.data!, companies: companies.data!, contacts: contacts.data!,
    activities: activities.data!, elements: elements.data ?? EMPTY, people,
  }, today)) : EMPTY as CrmWorkspace[], [loaded, pipelines.data, pipeline, workspace, deals.data, companies.data, contacts.data, activities.data, elements.data, people, today]);

  // ── Writes ────────────────────────────────────────────────────────────────
  const space = () => { if (!spaceId) throw new Error('Choose a Space first.'); return spaceId; };
  const check = <T,>(result: { data: T; error: { message: string } | null }): NonNullable<T> => {
    if (result.error) throw new Error(result.error.message);
    if (result.data === null) throw new Error('The record is not available to you.');
    return result.data as NonNullable<T>;
  };

  const resolved = useRef(new Map<string, string>());
  /** `domainId`: the Domain of the deal's own pipeline, which a new record joins. */
  async function companyFor(name: string, domainId: string | null = pipeline?.domain_id ?? null): Promise<string> {
    const lower = name.trim().toLowerCase();
    const known = resolved.current.get(`company:${lower}`) ?? (companies.data ?? []).find(company => company.name.trim().toLowerCase() === lower)?.id;
    if (known) return known;
    // A name another member added since this screen loaded is reused, not duplicated.
    const fresh = await supabase.from('crm_companies').select('id,name').eq('activity_space_id', space());
    const match = (fresh.data ?? []).find(company => (company.name as string).trim().toLowerCase() === lower);
    if (match) { resolved.current.set(`company:${lower}`, match.id as string); return match.id as string; }
    // A company met through a Domain's pipeline belongs to that Domain.
    const inserted = await supabase.from('crm_companies').insert({ activity_space_id: space(), name: name.trim(), owner_worker_id: me, domain_id: domainId }).select('id').single();
    const id = check(inserted).id as string;
    resolved.current.set(`company:${lower}`, id);
    return id;
  }
  async function contactFor(name: string, email: string | null, companyId: string | null, domainId: string | null = pipeline?.domain_id ?? null): Promise<string> {
    const lower = name.trim().toLowerCase();
    const cacheKey = `contact:${companyId ?? ''}:${lower}`;
    const cached = resolved.current.get(cacheKey);
    if (cached) return cached;
    const existing = (contacts.data ?? []).find(contact => contact.name.trim().toLowerCase() === lower && (!companyId || !contact.company_id || contact.company_id === companyId));
    if (existing) {
      if (email && !existing.email) check(await supabase.from('crm_contacts').update({ email }).eq('id', existing.id).select('id').single());
      resolved.current.set(cacheKey, existing.id);
      return existing.id;
    }
    const id = check(await supabase.from('crm_contacts').insert({ activity_space_id: space(), name: name.trim(), email, company_id: companyId, owner_worker_id: me, domain_id: domainId }).select('id').single()).id;
    resolved.current.set(cacheKey, id);
    return id;
  }

  /** Moves an open next-step Element from one owner to another. False when the
   * new owner could not be assigned (they cannot see the Element's Object). */
  async function moveStep(elementId: string | null, from: string | null, to: string | null): Promise<boolean> {
    const element = elementId ? (elements.data ?? []).find(item => item.id === elementId) : null;
    if (!element || ['done', 'cancelled'].includes(element.status)) return true;
    // The new owner first, so a step that cannot be reassigned keeps its old owner.
    if (to) {
      const { error } = await supabase.from('element_assignees').insert({ element_id: element.id, worker_id: to, role: 'assignee' });
      if (error && error.code !== '23505') return false;
    }
    if (from) await supabase.from('element_assignees').delete().eq('element_id', element.id).eq('worker_id', from).eq('role', 'assignee');
    return true;
  }

  /** Hands one person's CRM work to another — when someone leaves or moves:
   * their open deals (with the next steps' Elements), companies and contacts.
   * Won and lost deals keep who closed them. Each moved deal records the
   * hand-over in its history. */
  const handOver = async (from: string, to: string, note: string) => {
    // One transaction in the database: deals still open now, their next steps,
    // companies and contacts — all of it or none.
    try {
      const { data, error } = await supabase.rpc('crm_hand_over', {
        p_space: space(), p_from: from, p_to: to, p_note: note, p_today: today,
      });
      if (error) throw new Error(error.message);
      return data as { deals: number; companies: number; contacts: number; unassigned: number };
    } finally { await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['my-elements'] })]); }
  };

  /** Creates or updates a deal in one row write (company / contact rows first when named). */
  const saveDeal = async (dealId: string | null, patch: CrmDealPatch, extra?: { activity?: { type: CrmActivityType; text: string; date?: string }; quiet?: boolean; onNotice?: (notice: string) => void }): Promise<string> => {
    const row: Record<string, unknown> = {};
    let stepKept = false;
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.stage !== undefined) {
      row.stage = patch.stage;
      // Closing now is dated in the person's own calendar, not the server's;
      // a deal that was already closed keeps the day it closed.
      const closing = ['won', 'lost'].includes(patch.stage.toLowerCase());
      const wasClosed = !!dealId && ['won', 'lost'].includes(deals.data?.find(item => item.id === dealId)?.stage.toLowerCase() ?? '');
      if (closing && !wasClosed) row.closed_on = patch.closedOn ?? today;
    }
    if (patch.amount !== undefined) row.amount = patch.amount;
    if (patch.currency !== undefined) row.currency = patch.currency.toUpperCase();
    if (patch.probability !== undefined) row.probability = patch.probability === null ? null : Math.round(Math.min(100, Math.max(0, patch.probability)));
    if (patch.closeDate !== undefined) row.close_date = patch.closeDate;
    if (patch.ownerId !== undefined) row.owner_worker_id = patch.ownerId;
    if (patch.initiativeId !== undefined) row.initiative_id = patch.initiativeId;
    if (patch.source !== undefined) row.source = patch.source;
    if (patch.lostReason !== undefined) row.lost_reason = patch.lostReason;
    if (patch.custom !== undefined) row.custom = patch.custom;
    if (patch.nextStep !== undefined) row.next_step = patch.nextStep;
    if (patch.nextStepOn !== undefined) row.next_step_on = patch.nextStepOn;
    if (patch.renewsOn !== undefined) row.renews_on = patch.renewsOn;
    if (patch.companyId !== undefined) row.company_id = patch.companyId;
    // New records join the Domain of the deal's own pipeline, not the one on screen.
    const existingDeal = dealId ? deals.data?.find(item => item.id === dealId) : undefined;
    const domainId = (existingDeal ? (pipelines.data ?? []).find(item => item.id === existingDeal.pipeline_id) : pipeline)?.domain_id ?? null;
    if (patch.companyName) row.company_id = await companyFor(patch.companyName, domainId);
    if (patch.contactId !== undefined) row.contact_id = patch.contactId;
    if (patch.contactName) row.contact_id = await contactFor(patch.contactName, patch.contactEmail ?? null, (row.company_id as string | undefined) ?? null, domainId);
    try {
      let id = dealId;
      if (id) {
        const before = deals.data?.find(item => item.id === id);
        if (Object.keys(row).length) check(await supabase.from('crm_deals').update(row).eq('id', id).select('id').single());
        // A new owner takes the open next step with the deal.
        if (patch.ownerId !== undefined && before && before.owner_worker_id !== patch.ownerId) {
          stepKept = !(await moveStep(before.next_element_id, before.owner_worker_id, patch.ownerId));
          void qc.invalidateQueries({ queryKey: ['my-elements'] });
        }
      }
      else {
        const first = normalizeCrmStages(pipeline?.stages)[0];
        const stage = (row.stage as string | undefined) ?? first.id;
        id = check(await supabase.from('crm_deals').insert({
          activity_space_id: space(), pipeline_id: pipeline?.id, currency: pipeline?.currency ?? 'JPY',
          owner_worker_id: me, probability: resolveStage(stage, normalizeCrmStages(pipeline?.stages))?.probability ?? null,
          ...row, stage, name: (row.name as string | undefined) || pipeline?.record_label || 'New deal',
        }).select('id').single()).id;
      }
      if (extra?.activity) await logActivity(id!, extra.activity, { companyId: (row.company_id as string | null | undefined), contactId: (row.contact_id as string | null | undefined), quiet: true });
      if (stepKept) extra?.onNotice?.('The new owner cannot see the next step’s Object, so the next step stays with the previous owner.');
      return id!;
    } finally { if (!extra?.quiet) await invalidate(); }
  };

  /** Open the renewal of a won deal: a new deal in the pipeline renewals go
   * to, for the same customer and owner, due on the renewal date. */
  const startRenewal = async (dealId: string, name: string): Promise<{ id: string; pipelineId: string }> => {
    const source = deals.data?.find(item => item.id === dealId);
    if (!source) throw new Error('Deal not found');
    const from = (pipelines.data ?? []).find(item => item.id === source.pipeline_id);
    const target = from?.renewal_pipeline_id ? (pipelines.data ?? []).find(item => item.id === from.renewal_pipeline_id) : from;
    // Never fall back to another pipeline: the renewal would land where nobody expects it.
    if (!target) throw new Error('Renewals from this pipeline go to a pipeline you cannot see. Ask someone in its Domain to start it.');
    const stages = normalizeCrmStages(target.stages);
    try {
      const result = await supabase.from('crm_deals').insert({
        activity_space_id: space(), pipeline_id: target.id, name: name.trim().slice(0, 200), stage: stages[0].id, probability: stages[0].probability,
        amount: source.amount, currency: source.currency, company_id: source.company_id, contact_id: source.contact_id,
        owner_worker_id: source.owner_worker_id ?? me, initiative_id: source.initiative_id, renewal_of: source.id,
        // A renewal already late is due now, not in the past.
        close_date: source.renews_on && source.renews_on > today ? source.renews_on : today,
      }).select('id').single();
      // One renewal per deal: someone got there first, maybe where this reader cannot see.
      if (result.error?.code === '23505') throw new Error('This deal already has a renewal deal, perhaps in a pipeline you cannot see.');
      return { id: check(result).id as string, pipelineId: target.id };
    } finally { await invalidate(); }
  };

  /** A customer who will not renew: the deal leaves the renewal queue, and its
   * history keeps the date it would have renewed. */
  const declineRenewal = async (dealId: string, note: string) => {
    // Clear first: a failed note never leaves the deal half-declined and noted twice on retry.
    await saveDeal(dealId, { renewsOn: null }, { quiet: true });
    await logActivity(dealId, { type: 'note', text: note });
  };

  /** Links an Element to the company, contact or deal it is about. */
  const linkElement = async (elementId: string, target: { companyId?: string; contactId?: string; dealId?: string }) => {
    try {
      const result = await supabase.from('crm_element_links').insert({
        activity_space_id: space(), element_id: elementId,
        company_id: target.companyId ?? null, contact_id: target.contactId ?? null, deal_id: target.dealId ?? null,
      }).select('id').single();
      if (result.error?.code === '23505') return;
      if (result.error?.code === '42501') throw new Error('This Element is not in this Space, or you cannot see this record.');
      check(result);
    } finally { await invalidate(); }
  };
  const unlinkElement = async (linkId: string) => {
    try { check(await supabase.from('crm_element_links').delete().eq('id', linkId).select('id').single()); } finally { await invalidate(); }
  };
  /** Elements to link, by title or display ID, among those the reader can see in this Space. */
  const searchElements = async (query: string): Promise<CrmLinkedElement[]> => {
    const term = query.trim();
    if (!term) return [];
    const { data, error } = await supabase.rpc('crm_search_elements', { p_space: space(), p_query: term });
    if (error) throw new Error(error.message);
    return (data ?? []) as CrmLinkedElement[];
  };


  /** People on a deal beyond its main contact. A new name becomes a contact
   * at the deal's company. */
  const addDealContact = async (dealId: string, contact: { id?: string; name?: string }, role: CrmDealRole) => {
    const deal = deals.data?.find(item => item.id === dealId);
    const domainId = (pipelines.data ?? []).find(item => item.id === deal?.pipeline_id)?.domain_id ?? null;
    const contactId = contact.id ?? await contactFor(contact.name ?? '', null, deal?.company_id ?? null, domainId);
    // A name can resolve to someone already on the deal.
    if (contactId === deal?.contact_id || (dealContacts.data ?? []).some(row => row.deal_id === dealId && row.contact_id === contactId)) throw new Error('This person is already on the deal.');
    try {
      const result = await supabase.from('crm_deal_contacts').insert({ activity_space_id: space(), deal_id: dealId, contact_id: contactId, role }).select('id').single();
      if (result.error?.code === '23505') throw new Error('This person is already on the deal.');
      check(result);
    } finally { await invalidate(); }
  };
  const updateDealContact = async (id: string, patch: { role?: CrmDealRole; note?: string | null }) => {
    try { check(await supabase.from('crm_deal_contacts').update(patch).eq('id', id).select('id').single()); } finally { await invalidate(); }
  };
  const removeDealContact = async (id: string) => {
    try { check(await supabase.from('crm_deal_contacts').delete().eq('id', id).select('id').single()); } finally { await invalidate(); }
  };

  const logActivity = async (dealId: string, entry: { type: CrmActivityType; text: string; date?: string },
    links: { companyId?: string | null; contactId?: string | null; quiet?: boolean } = {}) => {
    const deal = deals.data?.find(item => item.id === dealId);
    const author = people.find(person => person.id === me)?.name ?? null;
    // Links taken from the deal are kept only when this writer can see them: a
    // deal can still point at a company or contact that has since moved into a
    // Domain this writer is not in. Links passed in were just chosen or created.
    const visible = (rows: { id: string }[] | undefined, id: string | null) => id && (rows ?? []).some(item => item.id === id) ? id : null;
    check(await supabase.from('crm_activities').insert({
      activity_space_id: space(), deal_id: dealId,
      company_id: links.companyId !== undefined ? links.companyId : visible(companies.data, deal?.company_id ?? null),
      contact_id: links.contactId !== undefined ? links.contactId : visible(contacts.data, deal?.contact_id ?? null),
      kind: entry.type, body: entry.text.trim().slice(0, 8000), occurred_on: entry.date ?? today, author_name: author,
    }).select('id').single());
    if (!links.quiet) await invalidate();
  };

  /** A touchpoint with a company or person outside any one deal. */
  const logRecordActivity = async (target: { companyId?: string | null; contactId?: string | null }, entry: { type: CrmActivityType; text: string }) => {
    const author = people.find(person => person.id === me)?.name ?? null;
    check(await supabase.from('crm_activities').insert({
      activity_space_id: space(), company_id: target.companyId ?? null, contact_id: target.contactId ?? null,
      kind: entry.type, body: entry.text.trim().slice(0, 8000), occurred_on: today, author_name: author,
    }).select('id').single());
    await invalidate();
  };

  /** The next step is an Element whenever someone can act on it: in the
   * pipeline's Object, assigned to the deal owner; or, with no Object, in my
   * own My Elements when the deal is mine. A colleague's deal without an
   * Object keeps the step on the deal itself, visible to the whole team.
   * Returns a notice when the step could not become the owner's Element. */
  const setNextStep = async (deal: Pick<CrmDeal, 'id' | 'name' | 'account' | 'ownerId' | 'nextElement'> & { number?: number; pipelineId?: string }, step: { title: string; due: string | null }): Promise<string | null> => {
    const title = step.title.trim();
    if (!title) throw new Error('Describe the next step.');
    const element = deal.nextElement && !['done', 'cancelled'].includes(deal.nextElement.status) ? deal.nextElement : null;
    // The deal's own pipeline decides where its next step lands, whichever
    // pipeline this screen happens to be on.
    const objectId = ((deal.pipelineId ? (pipelines.data ?? []).find(item => item.id === deal.pipelineId) : null) ?? pipeline)?.object_id ?? null;
    const mine = !deal.ownerId || deal.ownerId === me;
    let elementId = element?.id ?? null;
    let notice: string | null = null;
    if (element) await updateElement(element.id, { title, due_date: step.due });
    else if (objectId || mine) {
      const created = await createElement({
        title, due_date: step.due, start_date: step.due, status: 'todo', priority: 'medium',
        object_id: objectId, owner_id: objectId ? null : userId,
        description: `CRM${deal.number ? ` D-${deal.number}` : ''} · ${deal.name}${deal.account ? ` · ${deal.account}` : ''}`,
        labels: ['crm'],
      });
      elementId = created.id;
      if (deal.ownerId) {
        const { error } = await supabase.from('element_assignees').insert({ element_id: created.id, worker_id: deal.ownerId, role: 'assignee' });
        if (error) notice = 'The owner cannot see the pipeline’s Object, so the next step is unassigned. Give them access to the Object.';
      }
    } else notice = 'Saved on the deal. Choose an Object in Pipeline settings to make next steps Elements for their owners.';
    check(await supabase.from('crm_deals').update({ next_element_id: elementId, next_step: title, next_step_on: step.due }).eq('id', deal.id).select('id').single());
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['my-elements'] })]);
    return notice;
  };

  const completeNextStep = async (deal: CrmDeal) => {
    if (deal.nextElement && !['done', 'cancelled'].includes(deal.nextElement.status)) await updateElement(deal.nextElement.id, { status: 'done' });
    // The deal's own copy clears too, so people who cannot see the Element do not see a stale step.
    check(await supabase.from('crm_deals').update({ next_step: null, next_step_on: null }).eq('id', deal.id).select('id').single());
    if (deal.nextStep) await logActivity(deal.id, { type: 'note', text: `✓ ${deal.nextStep}` });
    await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: ['my-elements'] })]);
  };

  const deleteDeal = async (dealId: string) => { check(await supabase.from('crm_deals').delete().eq('id', dealId).select('id').single()); await invalidate(); };

  const savePipeline = async (id: string | null, patch: Partial<Omit<CrmPipelineRecord, 'id'>>): Promise<string> => {
    try {
      if (id) { check(await supabase.from('crm_pipelines').update(patch).eq('id', id).select('id').single()); return id; }
      return check(await supabase.from('crm_pipelines').insert({ activity_space_id: space(), ...patch }).select('id').single()).id;
    } finally { await invalidate(); }
  };
  const deletePipeline = async (id: string) => { check(await supabase.from('crm_pipelines').delete().eq('id', id).select('id').single()); await invalidate(); };

  const saveCompany = async (id: string | null, patch: Partial<Omit<CrmCompanyRecord, 'id' | 'created_at'>>): Promise<string> => {
    try {
      if (id) { check(await supabase.from('crm_companies').update(patch).eq('id', id).select('id').single()); return id; }
      return check(await supabase.from('crm_companies').insert({ activity_space_id: space(), owner_worker_id: me, ...patch }).select('id').single()).id;
    } finally { await invalidate(); }
  };
  const deleteCompany = async (id: string) => { check(await supabase.from('crm_companies').delete().eq('id', id).select('id').single()); await invalidate(); };
  const saveContact = async (id: string | null, patch: Partial<Omit<CrmContactRecord, 'id' | 'created_at'>>): Promise<string> => {
    try {
      if (id) { check(await supabase.from('crm_contacts').update(patch).eq('id', id).select('id').single()); return id; }
      return check(await supabase.from('crm_contacts').insert({ activity_space_id: space(), owner_worker_id: me, ...patch }).select('id').single()).id;
    } finally { await invalidate(); }
  };
  const deleteContact = async (id: string) => { check(await supabase.from('crm_contacts').delete().eq('id', id).select('id').single()); await invalidate(); };

  const saveField = async (id: string | null, patch: Partial<Omit<CrmFieldRecord, 'id'>>) => {
    try {
      if (id) check(await supabase.from('crm_fields').update(patch).eq('id', id).select('id').single());
      else {
        // A key may already be taken in a Domain this writer cannot see; the
        // database refuses it, and the field takes the next free suffix.
        for (let attempt = 0; ; attempt += 1) {
          const key = attempt && patch.key ? `${patch.key}_${attempt + 1}` : patch.key;
          const result = await supabase.from('crm_fields').insert({ activity_space_id: space(), ...patch, key }).select('id').single();
          if (result.error?.code === '23505' && attempt < 5) continue;
          check(result);
          break;
        }
      }
    } finally { await invalidate(); }
  };
  const deleteField = async (id: string) => { check(await supabase.from('crm_fields').delete().eq('id', id).select('id').single()); await invalidate(); };

  // ── Strategy: report the pipeline's figure into its Initiative measure ──
  const [measureError, setMeasureError] = useState<string | null>(null);
  const reported = useRef<string | null>(null);
  useEffect(() => {
    const p = workspace?.pipeline;
    // One writer (the main pane), and only from fresh data, never a cached stale view.
    if (!seed || !p?.measure_intent_id || !p.measure_metric || !workspace || deals.isFetching) return;
    // A field metric reports only while its field is one of this pipeline's number fields.
    const byField = metricKind(p.measure_metric) === 'field';
    if (byField && !fieldsFor(fields.data ?? [], 'deal', p.domain_id).some(field => field.type === 'number' && field.key === p.measure_field)) return;
    const value = metricValue(workspace.deals, p.measure_metric, p.currency, today, p.measure_field);
    // A field total reported as money depends on which currencies the won deals are in.
    const currencies = byField ? workspace.deals.filter(deal => deal.outcome === 'won').map(deal => `${deal.id}=${deal.currency}`).join(',') : '';
    const stamp = `${p.measure_intent_id}:${p.measure_metric}:${p.measure_field ?? ''}:${value}:${currencies}`;
    if (reported.current === stamp) return;
    reported.current = stamp;
    void (async () => {
      const { data, error } = await supabase.from('intents').select('actual_value,unit').eq('id', p.measure_intent_id!).maybeSingle();
      if (error || !data) { setMeasureError(error?.message ?? 'The linked success condition is not visible to you.'); return; }
      // Money goes only into the pipeline's own currency, at the condition's scale
      // (万円…); counts only into count units. Anything else is not written.
      // A field reported as money counts only deals in the pipeline's currency.
      const figure = byField ? metricValue(workspace.deals, p.measure_metric!, p.currency, today, p.measure_field, data.unit as string | null) : value;
      const written = measureValue(data.unit as string | null, p.measure_metric!, p.currency, figure);
      // Not written now; a later refresh tries again (the unit may have been corrected).
      if (written === null) { reported.current = null; setMeasureError(null); return; }
      if (Number(data.actual_value) === written) { setMeasureError(null); return; }
      const { error: writeError } = await supabase.from('intents').update({ actual_value: written, measured_at: new Date().toISOString() }).eq('id', p.measure_intent_id!).select('id').single();
      // Success conditions are written by the Initiative's owner; for anyone else the figure updates when they open the CRM.
      setMeasureError(writeError ? 'Only the Initiative’s owner can update this success condition. It updates when they open the CRM.' : null);
      if (!writeError) void qc.invalidateQueries({ queryKey: ['initiative-measures'] });
    })();
  }, [seed, workspace, deals.isFetching, today, qc, fields.data]);

  /** Moves a Table-based pipeline (the CRM's former store) into this Space's
   * records. Safe to run again: deals it already imported are skipped. */
  const importFromTable = async (tableId: string, mapping: Record<string, string>): Promise<number> => {
    const schema = await fetchDataTableSchema(tableId);
    const cell = (rowId: string, field: string) => mapping[field] ? schema.cellsByRow[rowId]?.[mapping[field]] ?? null : null;
    const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
    const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    const marker = `table:${tableId}`;
    const done = await readAllPages<{ id: string; custom: Record<string, unknown> }>('imported deals', (from, to) => supabase.from('crm_deals')
      .select('id,custom', { count: 'exact' }).eq('activity_space_id', space()).not('custom->>imported_from', 'is', null).order('id').range(from, to) as never, row => row.id);
    const imported = new Set(done.map(row => row.custom?.imported_from).filter(value => typeof value === 'string' && value.startsWith(marker)));
    const stages = normalizeCrmStages(pipeline?.stages);
    let count = 0;
    try {
      for (const row of schema.rows) {
        const name = text(cell(row.id, 'name'));
        const origin = `${marker}:${row.id}`;
        if (!name || imported.has(origin)) continue;
        const stage = text(cell(row.id, 'stage'))?.toLowerCase() ?? stages[0].id;
        const amount = typeof cell(row.id, 'amount') === 'number' ? cell(row.id, 'amount') as number : null;
        const probability = typeof cell(row.id, 'probability') === 'number' ? cell(row.id, 'probability') as number : null;
        const companyName = text(cell(row.id, 'account'));
        const companyId = companyName ? await companyFor(companyName) : null;
        const contactName = text(cell(row.id, 'contact'));
        const contactId = contactName ? await contactFor(contactName, text(cell(row.id, 'email')), companyId) : null;
        const dealId = await saveDeal(null, {
          name, stage: stage === 'open' ? stages[0].id : stage, amount, probability,
          currency: text(cell(row.id, 'currency'))?.toUpperCase() ?? pipeline?.currency ?? 'JPY', closeDate: date(cell(row.id, 'closeDate')),
          companyId, contactId, custom: { imported_from: origin },
          // A historical win keeps its own date rather than today's.
          closedOn: date(cell(row.id, 'closeDate')),
          nextStep: text(cell(row.id, 'nextStep')), nextStepOn: date(cell(row.id, 'nextActionDate')),
        }, { quiet: true });
        for (const entry of [...parseActivityLog(cell(row.id, 'activity'))].reverse()) {
          if (entry.type !== 'stage' && entry.type !== 'change') await logActivity(dealId, { type: entry.type, text: entry.text, date: entry.date ?? today }, { companyId, contactId, quiet: true });
        }
        const last = date(cell(row.id, 'lastContact'));
        if (last) check(await supabase.from('crm_deals').update({ last_contact_on: last }).eq('id', dealId).select('id').single());
        count += 1;
      }
    } finally { await invalidate(); }
    return count;
  };

  const error = pipelines.error ?? deals.error ?? companies.error ?? contacts.error ?? activities.error ?? fields.error ?? elements.error ?? null;
  return {
    spaceId, today, me, people, domains, workspace, workspaces, pipeline, legacyTable: legacy.data ?? null,
    pipelines: pipelines.data ?? EMPTY as CrmPipelineRecord[],
    companies: companies.data ?? EMPTY as CrmCompanyRecord[],
    contacts: contacts.data ?? EMPTY as CrmContactRecord[],
    activities: activities.data ?? EMPTY as CrmActivityRecord[],
    fields: fields.data ?? EMPTY as CrmFieldRecord[],
    dealContacts: dealContacts.data ?? EMPTY as CrmDealContactRecord[],
    elementLinks: elementLinks.data ?? EMPTY as CrmElementLinkRecord[],
    linkedElements: linkedElements.data ?? EMPTY as CrmLinkedElement[],
    nextElements: elements.data ?? EMPTY as CrmNextElement[],
    allDeals: deals.data ?? EMPTY as CrmDealRecord[],
    loading: enabled && !workspace && !error,
    error, measureError,
    refetch: invalidate,
    saveDeal, handOver, linkElement, unlinkElement, searchElements, startRenewal, declineRenewal, addDealContact, updateDealContact, removeDealContact, logActivity, logRecordActivity, setNextStep, completeNextStep, deleteDeal,
    savePipeline, deletePipeline, saveCompany, deleteCompany, saveContact, deleteContact, saveField, deleteField,
    importFromTable,
  };
}

export type Crm = ReturnType<typeof useCrm>;
