'use client';

import { useEffect, useRef, useState } from 'react';
import { Link2, X } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Crm } from '@/hooks/useCrm';
import type { CrmLinkedElement } from '@/Function/crm/crmModel';
import { RecordSection } from './CrmRecordPage';
import { relativeDay } from './crmFormat';

const DONE = new Set(['done', 'cancelled']);

/** The work about a company, contact or deal: Elements linked to it, and —
 * for a company or contact — the next steps of its deals. Open work first, so
 * when a counterpart fails, what it touches is one list. */
export function CrmRelatedWork({ crm, target, onOpenElement }: {
  crm: Crm;
  target: { companyId?: string; contactId?: string; dealId?: string };
  onOpenElement?: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CrmLinkedElement[]>([]);
  const [error, setError] = useState<string | null>(null);

  const links = crm.elementLinks.filter(link =>
    (target.companyId && link.company_id === target.companyId) || (target.contactId && link.contact_id === target.contactId) || (target.dealId && link.deal_id === target.dealId));
  // A company's or contact's deals carry their next steps; those count as its work too.
  // A contact's deals include those they are involved in, not only as main contact.
  const involved = new Set(target.contactId ? crm.dealContacts.filter(row => row.contact_id === target.contactId).map(row => row.deal_id) : []);
  const deals = crm.allDeals.filter(deal => (target.companyId && deal.company_id === target.companyId)
    || (target.contactId && (deal.contact_id === target.contactId || involved.has(deal.id))));
  type Row = { key: string; linkId: string | null; element: CrmLinkedElement | undefined; via: string | null };
  const candidates: Row[] = [
    ...links.map(link => ({ key: link.id, linkId: link.id, element: crm.linkedElements.find(item => item.id === link.element_id), via: null })),
    ...deals.filter(deal => deal.next_element_id && !links.some(link => link.element_id === deal.next_element_id))
      .map(deal => ({ key: `step:${deal.id}`, linkId: null, element: crm.nextElements.find(item => item.id === deal.next_element_id), via: `D-${deal.number} ${deal.name}` })),
  ];
  // One row per Element: two deals can share a next step, and a step can also be linked.
  const seen = new Set<string>();
  const rows = candidates.filter((row): row is Row & { element: CrmLinkedElement } => !!row.element && !seen.has(row.element.id) && !!seen.add(row.element.id))
    .sort((a, b) => Number(DONE.has(a.element.status)) - Number(DONE.has(b.element.status)) || (a.element.due_date ?? '9999').localeCompare(b.element.due_date ?? '9999'));
  const linked = new Set(rows.map(row => row.element.id));

  // The search function is new on every render; the latest one is read at call time.
  const search = useRef(crm.searchElements);
  useEffect(() => { search.current = crm.searchElements; });
  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      search.current(query).then(found => { if (live) { setResults(found); setError(null); } })
        .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : String(cause)); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  const run = (work: Promise<unknown>) => { setError(null); work.catch(cause => setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'))); };
  const choices = query.trim() ? results.filter(item => !linked.has(item.id)) : [];

  return <RecordSection title={t('Related work')}>
    <div className="max-w-2xl space-y-2">
      {rows.length > 0 && <ul className="-mx-1.5">{rows.map(({ key, linkId, element, via }) => <li key={key} className="group flex items-center gap-2 rounded-md px-1.5 text-[13px] transition-colors hover:bg-muted/40 has-[:focus-visible]:bg-muted/40">
        <span className={`size-1.5 shrink-0 rounded-full ${DONE.has(element.status) ? 'bg-muted-foreground/30' : 'bg-muted-foreground'}`} />
        <button type="button" disabled={!onOpenElement} className="min-w-0 flex-1 truncate py-1 text-left outline-none"
          onClick={() => onOpenElement?.(element.id)}>
          {element.display_id && <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">{element.display_id}</span>}
          <span className={DONE.has(element.status) ? 'text-muted-foreground line-through' : undefined}>{element.title}</span>
          {via && <span className="ml-1.5 text-xs text-muted-foreground">· {t('next step of {deal}', { deal: via })}</span>}
        </button>
        {element.due_date && <span className="shrink-0 text-xs text-muted-foreground">{relativeDay(element.due_date, crm.today, locale, t)}</span>}
        {linkId && <ButtonAppearanceProvider appearance="inline"><Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={t('Unlink {title}', { title: element.title })} onClick={() => run(crm.unlinkElement(linkId))}><X size={12} /></Button></ButtonAppearanceProvider>}
      </li>)}</ul>}
      <label className="flex h-8 items-center gap-2 rounded-sm bg-muted/30 px-2 text-muted-foreground focus-within:bg-muted/60 hover:bg-muted/40">
        <Link2 size={14} className="shrink-0" />
        <input type="search" aria-label={t('Link an Element')} placeholder={t('Link an Element — search by title or ID')} value={query}
          onChange={event => { setQuery(event.target.value); if (!event.target.value.trim()) setResults([]); }}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
      {choices.length > 0 && <ul className="space-y-0.5">{choices.map(item => <li key={item.id}>
        <button type="button" className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-[13px] hover:bg-muted/40"
          onClick={() => { run(crm.linkElement(item.id, target)); setQuery(''); setResults([]); }}>
          {item.display_id && <span className="text-xs tabular-nums text-muted-foreground">{item.display_id}</span>}
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </button>
      </li>)}</ul>}
      {!rows.length && !query && <p className="text-xs text-muted-foreground">{t('Link the Elements about this record — vetting, quotes, deliveries — so its work is one list.')}</p>}
      {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(error)}</p>}
    </div>
  </RecordSection>;
}
