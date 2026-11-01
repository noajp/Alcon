'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, Plus } from '@/ui/icons';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Crm } from '@/hooks/useCrm';
import { ACTIVITY_TYPES, fieldsFor, normalizeCrmStages, resolveStage, type CrmActivityRecord, type CrmActivityType, type CrmDealRecord, type CrmDealRole } from '@/Function/crm/crmModel';
import { historyLine, moneyList, relativeDay, ROLE_LABEL } from './crmFormat';
import { CrmPicker } from './CrmPicker';
import { CustomFields, EditableText, Property } from './CrmFields';
import { PageHead } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { CrmIcon } from '@/Function/shared/conceptIcons';
import { CrmRecordPage, RecordSection } from './CrmRecordPage';
import { CrmFiles } from './CrmFiles';
import { CrmRelatedWork } from './CrmRelatedWork';

const ACTIVITY_LABEL: Record<CrmActivityType, string> = { call: 'Call', email: 'Mail', meeting: 'Meeting', note: 'Memo' };

/** Deal totals per company or contact across every pipeline; currencies kept apart. */
function rollup(deals: readonly CrmDealRecord[]) {
  const open: Record<string, number> = {}; const won: Record<string, number> = {};
  let openCount = 0;
  for (const deal of deals) {
    const amount = deal.amount === null ? null : Number(deal.amount);
    const stage = deal.stage.toLowerCase();
    if (stage === 'won') { if (amount !== null) won[deal.currency] = (won[deal.currency] ?? 0) + amount; }
    else if (stage !== 'lost') { openCount += 1; if (amount !== null) open[deal.currency] = (open[deal.currency] ?? 0) + amount; }
  }
  return { open, won, openCount };
}

const lastTouch = (activities: readonly CrmActivityRecord[]) => activities.filter(entry => entry.kind !== 'stage' && entry.kind !== 'change').reduce<string | null>((latest, entry) => !latest || entry.occurred_on > latest ? entry.occurred_on : latest, null);

export function CrmCompanies({ crm, query, onOpen, selectedId }: { crm: Crm; query: string; onOpen: (id: string) => void; selectedId: string | null }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const rows = useMemo(() => {
    const terms = query.trim().toLowerCase();
    return crm.companies.filter(company => !terms || `${company.name} ${company.domain ?? ''} ${company.industry ?? ''}`.toLowerCase().includes(terms)).map(company => {
      const deals = crm.allDeals.filter(deal => deal.company_id === company.id);
      return { company, ...rollup(deals), contacts: crm.contacts.filter(contact => contact.company_id === company.id).length,
        owner: crm.people.find(person => person.id === company.owner_worker_id)?.name ?? null,
        last: lastTouch(crm.activities.filter(entry => entry.company_id === company.id)) };
    }).sort((a, b) => b.openCount - a.openCount || a.company.name.localeCompare(b.company.name));
  }, [crm.companies, crm.allDeals, crm.contacts, crm.people, crm.activities, query]);
  return <div className="space-y-4">
    <form className="flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); if (name.trim()) void crm.saveCompany(null, { name: name.trim() }).then(id => { setName(''); onOpen(id); }); }}>
      <input aria-label={t('New company')} placeholder={t('Add a company…')} value={name} onChange={event => setName(event.target.value)} className="h-8 min-w-0 flex-1 rounded-sm bg-muted/30 px-2 text-sm outline-none focus:bg-muted/60" />
      <Button type="submit" variant="ghost" disabled={!name.trim()}><Plus size={14} />{t('Add')}</Button>
    </form>
    {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
      <thead className="border-b border-[var(--border-subtle)] text-xs text-muted-foreground"><tr>{['Company', 'Owner', 'Contacts', 'Open deals', 'Open pipeline', 'Won', 'Last contact'].map(label =>
        <th key={label} scope="col" className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{t(label)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.company.id} onClick={() => onOpen(row.company.id)} aria-current={row.company.id === selectedId ? 'true' : undefined}
        className={`cursor-pointer hover:bg-muted/40 ${row.company.id === selectedId ? 'bg-muted/40' : ''}`}>
        <td className="max-w-72 py-2 pr-2"><button type="button" className="block max-w-full truncate rounded-sm text-left font-medium" onClick={event => { event.stopPropagation(); onOpen(row.company.id); }}>{row.company.name}</button>
          <span className="block truncate text-xs text-muted-foreground">{[row.company.industry, row.company.domain].filter(Boolean).join(' · ') || '—'}</span></td>
        <td className="px-2 py-2 text-muted-foreground">{row.owner ?? '—'}</td>
        <td className="px-2 py-2 tabular-nums">{row.contacts}</td>
        <td className="px-2 py-2 tabular-nums">{row.openCount}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{moneyList(row.open, locale)}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums">{moneyList(row.won, locale)}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{relativeDay(row.last, crm.today, locale, t)}</td>
      </tr>)}</tbody>
    </table></div> : <p className="py-8 text-sm text-muted-foreground">{query ? t('No companies match.') : t('No companies yet. Add one above, or they are created when you capture a deal.')}</p>}
  </div>;
}

export function CrmContacts({ crm, query, onOpen, selectedId }: { crm: Crm; query: string; onOpen: (id: string) => void; selectedId: string | null }) {
  const { t, locale } = useI18n();
  const [name, setName] = useState('');
  const companies = new Map(crm.companies.map(company => [company.id, company.name]));
  const terms = query.trim().toLowerCase();
  const rows = crm.contacts.filter(contact => !terms || `${contact.name} ${contact.email ?? ''} ${contact.title ?? ''} ${companies.get(contact.company_id ?? '') ?? ''}`.toLowerCase().includes(terms))
    .map(contact => ({ contact, company: contact.company_id ? companies.get(contact.company_id) ?? null : null,
      deals: dealsOf(crm, contact.id).deals.length,
      last: lastTouch(crm.activities.filter(entry => entry.contact_id === contact.id)) }))
    .sort((a, b) => a.contact.name.localeCompare(b.contact.name));
  return <div className="space-y-4">
    <form className="flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); if (name.trim()) void crm.saveContact(null, { name: name.trim() }).then(id => { setName(''); onOpen(id); }); }}>
      <input aria-label={t('New contact')} placeholder={t('Add a contact…')} value={name} onChange={event => setName(event.target.value)} className="h-8 min-w-0 flex-1 rounded-sm bg-muted/30 px-2 text-sm outline-none focus:bg-muted/60" />
      <Button type="submit" variant="ghost" disabled={!name.trim()}><Plus size={14} />{t('Add')}</Button>
    </form>
    {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-[13px]">
      <thead className="border-b border-[var(--border-subtle)] text-xs text-muted-foreground"><tr>{['Contact', 'Company', 'Email', 'Phone', 'Deals', 'Last contact'].map(label =>
        <th key={label} scope="col" className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{t(label)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.contact.id} onClick={() => onOpen(row.contact.id)} aria-current={row.contact.id === selectedId ? 'true' : undefined}
        className={`cursor-pointer hover:bg-muted/40 ${row.contact.id === selectedId ? 'bg-muted/40' : ''}`}>
        <td className="max-w-64 py-2 pr-2"><button type="button" className="block max-w-full truncate rounded-sm text-left font-medium" onClick={event => { event.stopPropagation(); onOpen(row.contact.id); }}>{row.contact.name}</button>
          <span className="block truncate text-xs text-muted-foreground">{row.contact.title ?? '—'}</span></td>
        <td className="max-w-48 truncate px-2 py-2">{row.company ?? '—'}</td>
        <td className="max-w-56 truncate px-2 py-2 text-muted-foreground">{row.contact.email ?? '—'}</td>
        <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{row.contact.phone ?? '—'}</td>
        <td className="px-2 py-2 tabular-nums">{row.deals}</td>
        <td className="whitespace-nowrap px-2 py-2 tabular-nums text-muted-foreground">{relativeDay(row.last, crm.today, locale, t)}</td>
      </tr>)}</tbody>
    </table></div> : <p className="py-8 text-sm text-muted-foreground">{query ? t('No contacts match.') : t('No contacts yet. Add one above, or they are created when you capture a deal.')}</p>}
  </div>;
}

function Timeline({ crm, entries, onLog }: { crm: Crm; entries: readonly CrmActivityRecord[]; onLog: (type: CrmActivityType, text: string) => Promise<void> }) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState('');
  const [type, setType] = useState<CrmActivityType>('call');
  const [busy, setBusy] = useState(false);
  const log = async () => { if (!note.trim()) return; setBusy(true); try { await onLog(type, note.trim()); setNote(''); } finally { setBusy(false); } };
  const sorted = [...entries].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).slice(0, 60);
  return <RecordSection title={t('Activity')}><div className="max-w-2xl space-y-3">
    <TextComposer rows={2} aria-label={t('Log activity')} placeholder={t('What happened?')} value={note} disabled={busy}
      onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void log(); } }}
      hint={<span className="flex flex-wrap gap-1">{ACTIVITY_TYPES.map(item => <Button key={item} shape="tab" size="xs" variant={type === item ? 'secondary' : 'ghost'} aria-pressed={type === item} onClick={() => setType(item)}>{t(ACTIVITY_LABEL[item])}</Button>)}</span>}
      action={<Button size="xs" variant="primary" disabled={busy || !note.trim()} onClick={() => void log()}>{t('Log')}</Button>} />
    {sorted.length ? <ol className="space-y-3">{sorted.map(entry => <li key={entry.id} className="space-y-0.5">
      {(() => {
        const deal = entry.deal_id ? crm.allDeals.find(item => item.id === entry.deal_id) : undefined;
        const stages = normalizeCrmStages(crm.pipelines.find(pipeline => pipeline.id === deal?.pipeline_id)?.stages);
        const line = historyLine(entry.kind, entry.body, stages, locale, t);
        return <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{line.label}</span><span>{relativeDay(entry.occurred_on, crm.today, locale, t)}</span>
            {deal && <span className="truncate">· {deal.name}</span>}{entry.author_name && <span className="truncate">· {entry.author_name}</span>}</div>
          <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${line.quiet ? 'text-muted-foreground' : ''}`}>{line.text}</p>
        </>;
      })()}
    </li>)}</ol> : <p className="text-xs text-muted-foreground">{t('No activity yet.')}</p>}
  </div></RecordSection>;
}

/** Deals a person is on: as the main contact, or with a part in the decision. */
const dealsOf = (crm: Crm, contactId: string) => {
  const roles = new Map(crm.dealContacts.filter(row => row.contact_id === contactId).map(row => [row.deal_id, row.role]));
  return { deals: crm.allDeals.filter(deal => deal.contact_id === contactId || roles.has(deal.id)), roles };
};

function DealList({ crm, deals, onOpenDeal, roles }: { crm: Crm; deals: readonly CrmDealRecord[]; onOpenDeal: (deal: CrmDealRecord) => void; roles?: ReadonlyMap<string, CrmDealRole> }) {
  const { t } = useI18n();
  if (!deals.length) return null;
  return <RecordSection title={t('Deals')}>
    <ul className="max-w-2xl space-y-1">{deals.map(deal => {
      const pipeline = crm.pipelines.find(item => item.id === deal.pipeline_id);
      const stage = resolveStage(deal.stage, normalizeCrmStages(pipeline?.stages));
      return <li key={deal.id}><button type="button" className="flex w-full items-center gap-2 rounded-sm text-left text-[13px] hover:bg-muted/30" onClick={() => onOpenDeal(deal)}>
        <span className="tabular-nums text-xs text-muted-foreground">D-{deal.number}</span><span className="min-w-0 flex-1 truncate">{deal.name}</span>
        {roles?.get(deal.id) && <span className="text-xs text-muted-foreground">{t(ROLE_LABEL[roles.get(deal.id)!])}</span>}
        <span className="text-xs text-muted-foreground">{stage ? t(stage.label) : deal.stage}</span>
      </button></li>;
    })}</ul></RecordSection>;
}

export function CrmCompanyPage({ crm, companyId, onBack, onOpenCompanies, onOpenDeal, onOpenContact, onOpenElement, onOpenDomain }: {
  crm: Crm; companyId: string; onBack: () => void; onOpenCompanies: () => void; onOpenDeal: (deal: CrmDealRecord) => void; onOpenContact: (id: string) => void; onOpenElement?: (id: string) => void;
  /** Opens one of the Space's Domains in Execution. */
  onOpenDomain?: (id: string) => void;
}) {
  const { t } = useI18n();
  const company = crm.companies.find(item => item.id === companyId);
  const [contactName, setContactName] = useState('');
  if (!company) return null;
  const save = (patch: Parameters<Crm['saveCompany']>[1]) => crm.saveCompany(company.id, patch);
  const contacts = crm.contacts.filter(contact => contact.company_id === company.id);
  const rail = <RailCard title={t('Properties')} padded>
    <div className="space-y-1">
      <Property label={t('Owner')}><CrmPicker label={t('Owner')} value={company.owner_worker_id} placeholder={t('Unassigned')} options={crm.people.map(person => ({ id: person.id, label: person.name }))} onChange={id => void save({ owner_worker_id: id })} /></Property>
      <Property label={t('Domain')}><CrmPicker label={t('Domain')} value={company.domain_id} placeholder={t('Whole Space')} options={crm.domains.map(domain => ({ id: domain.id, label: domain.name }))} onChange={id => void save({ domain_id: id })} /></Property>
      {/* The same body as one of our own Domains: a sister company, a department billed internally. */}
      <Property label={t('Is our Domain')}>
        <div className="flex items-center gap-1">
          {/* A Domain this reader cannot see is named as such, and left alone. */}
          {company.own_domain_id && !crm.domains.some(domain => domain.id === company.own_domain_id)
            ? <span className="px-1.5 text-[13px] text-muted-foreground">{t('A Domain you cannot see')}</span>
            : <CrmPicker label={t('Is our Domain')} value={company.own_domain_id ?? null} placeholder={t('An outside organisation')}
              options={crm.domains.map(domain => ({ id: domain.id, label: domain.name }))} onChange={id => void save({ own_domain_id: id })} />}
          {company.own_domain_id && onOpenDomain && crm.domains.some(domain => domain.id === company.own_domain_id) &&
            <Button variant="ghost" size="icon-xs" aria-label={t('Open Domain')} onClick={() => onOpenDomain(company.own_domain_id!)}><ArrowUpRight size={12} /></Button>}
        </div>
      </Property>
      <Property label={t('Website')}><EditableText label={t('Website')} value={company.domain} placeholder="example.com" onSave={value => save({ domain: value as string | null })} /></Property>
      <Property label={t('Industry')}><EditableText label={t('Industry')} value={company.industry} onSave={value => save({ industry: value as string | null })} /></Property>
      <CustomFields fields={fieldsFor(crm.fields, 'company', company.domain_id)} values={company.custom ?? {}} onSave={custom => save({ custom })} />
    </div>
  </RailCard>;
  return <CrmRecordPage crumbs={[{ label: t('Companies'), onClick: onOpenCompanies }, { label: company.name }]} onBack={onBack}
    onDelete={() => crm.deleteCompany(company.id)} deleteLabel={t('Delete this record? Its deals stay, without this link.')} rail={rail}>
    <PageHead icon={<CrmIcon size={18} />} title={company.name} description={company.notes ?? ''} canEdit
      titleLabel={t('Name')} titlePlaceholder={t('Name')} descriptionLabel={t('Notes')} descriptionPlaceholder={t('Notes')}
      onSaveTitle={name => save({ name }).then(() => {})} onSaveDescription={notes => save({ notes: notes || null }).then(() => {})} />
    <RecordSection title={t('Contacts')}>
      <ul className="max-w-2xl space-y-1">{contacts.map(contact => <li key={contact.id}><button type="button" className="flex w-full items-baseline gap-2 rounded-sm text-left text-[13px] hover:bg-muted/30" onClick={() => onOpenContact(contact.id)}>
        <span className="truncate">{contact.name}</span><span className="truncate text-xs text-muted-foreground">{contact.title ?? contact.email}</span></button></li>)}</ul>
      <form className="flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); if (contactName.trim()) void crm.saveContact(null, { name: contactName.trim(), company_id: company.id }).then(() => setContactName('')); }}>
        <input aria-label={t('New contact')} placeholder={t('Add a contact…')} value={contactName} onChange={event => setContactName(event.target.value)} className="h-7 min-w-0 flex-1 rounded-sm bg-muted/30 px-2 text-xs outline-none focus:bg-muted/60" />
        <Button type="submit" size="xs" variant="ghost" disabled={!contactName.trim()}>{t('Add')}</Button>
      </form>
    </RecordSection>
    <DealList crm={crm} deals={crm.allDeals.filter(deal => deal.company_id === company.id)} onOpenDeal={onOpenDeal} />
    <CrmRelatedWork crm={crm} target={{ companyId: company.id }} onOpenElement={onOpenElement} />
    <CrmFiles owner={{ kind: 'company', id: company.id }} />
    <Timeline crm={crm} entries={crm.activities.filter(entry => entry.company_id === company.id)} onLog={(type, text) => crm.logRecordActivity({ companyId: company.id }, { type, text })} />
  </CrmRecordPage>;
}

export function CrmContactPage({ crm, contactId, onBack, onOpenContacts, onOpenDeal, onOpenCompany, onOpenElement }: {
  crm: Crm; contactId: string; onBack: () => void; onOpenContacts: () => void; onOpenDeal: (deal: CrmDealRecord) => void; onOpenCompany: (id: string) => void; onOpenElement?: (id: string) => void;
}) {
  const { t } = useI18n();
  const contact = crm.contacts.find(item => item.id === contactId);
  if (!contact) return null;
  const save = (patch: Parameters<Crm['saveContact']>[1]) => crm.saveContact(contact.id, patch);
  const rail = <RailCard title={t('Properties')} padded>
    <div className="space-y-1">
      <Property label={t('Company')}>
        <div className="flex items-center gap-1">
          <CrmPicker label={t('Company')} value={contact.company_id} placeholder={t('No company')} options={crm.companies.map(company => ({ id: company.id, label: company.name }))}
            onChange={id => void save({ company_id: id })} onCreate={name => void crm.saveCompany(null, { name }).then(id => save({ company_id: id }))} />
          {contact.company_id && <Button variant="ghost" size="icon-xs" aria-label={t('Open')} onClick={() => onOpenCompany(contact.company_id!)}><ArrowUpRight size={12} /></Button>}
        </div>
      </Property>
      <Property label={t('Title')}><EditableText label={t('Title')} value={contact.title} onSave={value => save({ title: value as string | null })} /></Property>
      <Property label={t('Email')}><EditableText label={t('Email')} value={contact.email} onSave={value => save({ email: value as string | null })} /></Property>
      <Property label={t('Phone')}><EditableText label={t('Phone')} value={contact.phone} onSave={value => save({ phone: value as string | null })} /></Property>
      <Property label={t('Owner')}><CrmPicker label={t('Owner')} value={contact.owner_worker_id} placeholder={t('Unassigned')} options={crm.people.map(person => ({ id: person.id, label: person.name }))} onChange={id => void save({ owner_worker_id: id })} /></Property>
      <Property label={t('Domain')}><CrmPicker label={t('Domain')} value={contact.domain_id} placeholder={t('Whole Space')} options={crm.domains.map(domain => ({ id: domain.id, label: domain.name }))} onChange={id => void save({ domain_id: id })} /></Property>
      <CustomFields fields={fieldsFor(crm.fields, 'contact', contact.domain_id)} values={contact.custom ?? {}} onSave={custom => save({ custom })} />
    </div>
  </RailCard>;
  return <CrmRecordPage crumbs={[{ label: t('Contacts'), onClick: onOpenContacts }, { label: contact.name }]} onBack={onBack}
    onDelete={() => crm.deleteContact(contact.id)} deleteLabel={t('Delete this record? Its deals stay, without this link.')} rail={rail}>
    <PageHead icon={<CrmIcon size={18} />} title={contact.name} description="" canEdit
      titleLabel={t('Name')} titlePlaceholder={t('Name')} descriptionLabel="" descriptionPlaceholder=""
      onSaveTitle={name => save({ name }).then(() => {})} />
    <DealList crm={crm} {...dealsOf(crm, contact.id)} onOpenDeal={onOpenDeal} />
    <CrmRelatedWork crm={crm} target={{ contactId: contact.id }} onOpenElement={onOpenElement} />
    <Timeline crm={crm} entries={crm.activities.filter(entry => entry.contact_id === contact.id)} onLog={(type, text) => crm.logRecordActivity({ contactId: contact.id, companyId: contact.company_id }, { type, text })} />
  </CrmRecordPage>;
}
