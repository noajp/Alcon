'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/ui/button';
import { TextComposer } from '@/ui/text-composer';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { Crm } from '@/hooks/useCrm';
import { ACTIVITY_TYPES, normalizeCrmStages, resolveStage, type CrmActivityRecord, type CrmActivityType, type CrmDealRecord } from './crmModel';
import { moneyList, relativeDay } from './crmFormat';
import { CrmPicker } from './CrmPicker';
import { CustomFields, EditableText, Property } from './CrmFields';

const ACTIVITY_LABEL: Record<CrmActivityRecord['kind'], string> = { call: 'Call', email: 'Mail', meeting: 'Meeting', note: 'Memo', stage: 'Stage' };

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

const lastTouch = (activities: readonly CrmActivityRecord[]) => activities.filter(entry => entry.kind !== 'stage').reduce<string | null>((latest, entry) => !latest || entry.occurred_on > latest ? entry.occurred_on : latest, null);

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
      <thead className="text-xs text-muted-foreground"><tr>{['Company', 'Owner', 'Contacts', 'Open deals', 'Open pipeline', 'Won', 'Last contact'].map(label =>
        <th key={label} scope="col" className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{t(label)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.company.id} onClick={() => onOpen(row.company.id)} aria-current={row.company.id === selectedId ? 'true' : undefined}
        className={`cursor-pointer border-t border-[var(--border-subtle)] hover:bg-muted/30 ${row.company.id === selectedId ? 'bg-muted/40' : ''}`}>
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
      deals: crm.allDeals.filter(deal => deal.contact_id === contact.id).length,
      last: lastTouch(crm.activities.filter(entry => entry.contact_id === contact.id)) }))
    .sort((a, b) => a.contact.name.localeCompare(b.contact.name));
  return <div className="space-y-4">
    <form className="flex max-w-md gap-2" onSubmit={event => { event.preventDefault(); if (name.trim()) void crm.saveContact(null, { name: name.trim() }).then(id => { setName(''); onOpen(id); }); }}>
      <input aria-label={t('New contact')} placeholder={t('Add a contact…')} value={name} onChange={event => setName(event.target.value)} className="h-8 min-w-0 flex-1 rounded-sm bg-muted/30 px-2 text-sm outline-none focus:bg-muted/60" />
      <Button type="submit" variant="ghost" disabled={!name.trim()}><Plus size={14} />{t('Add')}</Button>
    </form>
    {rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-[13px]">
      <thead className="text-xs text-muted-foreground"><tr>{['Contact', 'Company', 'Email', 'Phone', 'Deals', 'Last contact'].map(label =>
        <th key={label} scope="col" className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{t(label)}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.contact.id} onClick={() => onOpen(row.contact.id)} aria-current={row.contact.id === selectedId ? 'true' : undefined}
        className={`cursor-pointer border-t border-[var(--border-subtle)] hover:bg-muted/30 ${row.contact.id === selectedId ? 'bg-muted/40' : ''}`}>
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

function RecordShell({ title, subtitle, onClose, onDelete, children }: { title: string; subtitle: string; onClose: () => void; onDelete: () => Promise<void>; children: React.ReactNode }) {
  const { t } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <aside aria-label={title} className="flex h-full w-full min-w-0 flex-col bg-card">
    <div className="flex items-start gap-2 px-5 pb-3 pt-5">
      <div className="min-w-0 flex-1"><p className="px-1 text-[11px] text-muted-foreground">{subtitle}</p><h2 className="truncate px-1 text-lg font-semibold">{title}</h2></div>
      <Button variant="ghost" size="icon-sm" aria-label={t('Close panel')} onClick={onClose}><X size={14} /></Button>
    </div>
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6">
      {children}
      <section className="flex justify-end border-t border-[var(--border-subtle)] pt-4">
        {confirm ? <span className="flex items-center gap-2"><span className="text-xs">{t('Delete this record? Its deals stay, without this link.')}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
          <Button size="sm" variant="danger" onClick={() => { setError(null); onDelete().then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'))); }}>{t('Delete')}</Button></span>
          : <Button size="sm" variant="ghost" aria-label={t('Delete')} onClick={() => setConfirm(true)}><Trash2 size={14} /></Button>}
        {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p>}
      </section>
    </div>
  </aside>;
}

function Timeline({ crm, entries, onLog }: { crm: Crm; entries: readonly CrmActivityRecord[]; onLog: (type: CrmActivityType, text: string) => Promise<void> }) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState('');
  const [type, setType] = useState<CrmActivityType>('call');
  const [busy, setBusy] = useState(false);
  const log = async () => { if (!note.trim()) return; setBusy(true); try { await onLog(type, note.trim()); setNote(''); } finally { setBusy(false); } };
  const sorted = [...entries].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at)).slice(0, 60);
  return <section aria-label={t('Activity')} className="space-y-3">
    <h3 className="text-xs font-medium text-muted-foreground">{t('Activity')}</h3>
    <TextComposer rows={2} aria-label={t('Log activity')} placeholder={t('What happened?')} value={note} disabled={busy}
      onChange={event => setNote(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void log(); } }}
      hint={<span className="flex flex-wrap gap-1">{ACTIVITY_TYPES.map(item => <Button key={item} shape="tab" size="xs" variant={type === item ? 'secondary' : 'ghost'} aria-pressed={type === item} onClick={() => setType(item)}>{t(ACTIVITY_LABEL[item])}</Button>)}</span>}
      action={<Button size="xs" variant="primary" disabled={busy || !note.trim()} onClick={() => void log()}>{t('Log')}</Button>} />
    {sorted.length ? <ol className="space-y-3">{sorted.map(entry => <li key={entry.id} className="space-y-0.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{t(ACTIVITY_LABEL[entry.kind])}</span><span>{relativeDay(entry.occurred_on, crm.today, locale, t)}</span>
        {entry.deal_id && <span className="truncate">· {crm.allDeals.find(deal => deal.id === entry.deal_id)?.name}</span>}</div>
      <p className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${entry.kind === 'stage' ? 'text-muted-foreground' : ''}`}>{entry.body}</p>
    </li>)}</ol> : <p className="text-xs text-muted-foreground">{t('No activity yet.')}</p>}
  </section>;
}

function DealList({ crm, deals, onOpenDeal }: { crm: Crm; deals: readonly CrmDealRecord[]; onOpenDeal: (deal: CrmDealRecord) => void }) {
  const { t } = useI18n();
  if (!deals.length) return null;
  return <section className="space-y-1"><h3 className="text-xs font-medium text-muted-foreground">{t('Deals')}</h3>
    <ul className="space-y-1">{deals.map(deal => {
      const pipeline = crm.pipelines.find(item => item.id === deal.pipeline_id);
      const stage = resolveStage(deal.stage, normalizeCrmStages(pipeline?.stages));
      return <li key={deal.id}><button type="button" className="flex w-full items-center gap-2 rounded-sm text-left text-[13px] hover:bg-muted/30" onClick={() => onOpenDeal(deal)}>
        <span className="tabular-nums text-xs text-muted-foreground">D-{deal.number}</span><span className="min-w-0 flex-1 truncate">{deal.name}</span>
        <span className="text-xs text-muted-foreground">{stage ? t(stage.label) : deal.stage}</span>
      </button></li>;
    })}</ul></section>;
}

export function CrmCompanyPanel({ crm, companyId, onClose, onOpenDeal, onOpenContact }: {
  crm: Crm; companyId: string; onClose: () => void; onOpenDeal: (deal: CrmDealRecord) => void; onOpenContact: (id: string) => void;
}) {
  const { t } = useI18n();
  const company = crm.companies.find(item => item.id === companyId);
  const [contactName, setContactName] = useState('');
  if (!company) return null;
  const save = (patch: Parameters<Crm['saveCompany']>[1]) => crm.saveCompany(company.id, patch);
  const contacts = crm.contacts.filter(contact => contact.company_id === company.id);
  return <RecordShell title={company.name} subtitle={t('Company')} onClose={onClose} onDelete={() => crm.deleteCompany(company.id)}>
    <section className="space-y-1">
      <Property label={t('Name')}><EditableText label={t('Name')} value={company.name} onSave={value => value ? save({ name: String(value) }) : Promise.reject(new Error('A name is required.'))} /></Property>
      <Property label={t('Owner')}><CrmPicker label={t('Owner')} value={company.owner_worker_id} placeholder={t('Unassigned')} options={crm.people.map(person => ({ id: person.id, label: person.name }))} onChange={id => void save({ owner_worker_id: id })} /></Property>
      <Property label={t('Website')}><EditableText label={t('Website')} value={company.domain} placeholder="example.com" onSave={value => save({ domain: value as string | null })} /></Property>
      <Property label={t('Industry')}><EditableText label={t('Industry')} value={company.industry} onSave={value => save({ industry: value as string | null })} /></Property>
      <Property label={t('Notes')}><EditableText multiline label={t('Notes')} value={company.notes} onSave={value => save({ notes: value as string | null })} /></Property>
      <CustomFields fields={crm.fields.filter(field => field.entity === 'company')} values={company.custom ?? {}} onSave={custom => save({ custom })} />
    </section>
    <section className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{t('Contacts')}</h3>
      <ul className="space-y-1">{contacts.map(contact => <li key={contact.id}><button type="button" className="flex w-full items-baseline gap-2 rounded-sm text-left text-[13px] hover:bg-muted/30" onClick={() => onOpenContact(contact.id)}>
        <span className="truncate">{contact.name}</span><span className="truncate text-xs text-muted-foreground">{contact.title ?? contact.email}</span></button></li>)}</ul>
      <form className="flex gap-2" onSubmit={event => { event.preventDefault(); if (contactName.trim()) void crm.saveContact(null, { name: contactName.trim(), company_id: company.id }).then(() => setContactName('')); }}>
        <input aria-label={t('New contact')} placeholder={t('Add a contact…')} value={contactName} onChange={event => setContactName(event.target.value)} className="h-7 min-w-0 flex-1 rounded-sm bg-muted/30 px-2 text-xs outline-none focus:bg-muted/60" />
        <Button type="submit" size="xs" variant="ghost" disabled={!contactName.trim()}>{t('Add')}</Button>
      </form>
    </section>
    <DealList crm={crm} deals={crm.allDeals.filter(deal => deal.company_id === company.id)} onOpenDeal={onOpenDeal} />
    <Timeline crm={crm} entries={crm.activities.filter(entry => entry.company_id === company.id)} onLog={(type, text) => crm.logRecordActivity({ companyId: company.id }, { type, text })} />
  </RecordShell>;
}

export function CrmContactPanel({ crm, contactId, onClose, onOpenDeal, onOpenCompany }: {
  crm: Crm; contactId: string; onClose: () => void; onOpenDeal: (deal: CrmDealRecord) => void; onOpenCompany: (id: string) => void;
}) {
  const { t } = useI18n();
  const contact = crm.contacts.find(item => item.id === contactId);
  if (!contact) return null;
  const save = (patch: Parameters<Crm['saveContact']>[1]) => crm.saveContact(contact.id, patch);
  return <RecordShell title={contact.name} subtitle={t('Contact')} onClose={onClose} onDelete={() => crm.deleteContact(contact.id)}>
    <section className="space-y-1">
      <Property label={t('Name')}><EditableText label={t('Name')} value={contact.name} onSave={value => value ? save({ name: String(value) }) : Promise.reject(new Error('A name is required.'))} /></Property>
      <Property label={t('Company')}>
        <div className="flex items-center gap-1">
          <CrmPicker label={t('Company')} value={contact.company_id} placeholder={t('No company')} options={crm.companies.map(company => ({ id: company.id, label: company.name }))}
            onChange={id => void save({ company_id: id })} onCreate={name => void crm.saveCompany(null, { name }).then(id => save({ company_id: id }))} />
          {contact.company_id && <Button variant="ghost" size="xs" onClick={() => onOpenCompany(contact.company_id!)}>{t('Open')}</Button>}
        </div>
      </Property>
      <Property label={t('Title')}><EditableText label={t('Title')} value={contact.title} onSave={value => save({ title: value as string | null })} /></Property>
      <Property label={t('Email')}><EditableText label={t('Email')} value={contact.email} onSave={value => save({ email: value as string | null })} /></Property>
      <Property label={t('Phone')}><EditableText label={t('Phone')} value={contact.phone} onSave={value => save({ phone: value as string | null })} /></Property>
      <Property label={t('Owner')}><CrmPicker label={t('Owner')} value={contact.owner_worker_id} placeholder={t('Unassigned')} options={crm.people.map(person => ({ id: person.id, label: person.name }))} onChange={id => void save({ owner_worker_id: id })} /></Property>
      <CustomFields fields={crm.fields.filter(field => field.entity === 'contact')} values={contact.custom ?? {}} onSave={custom => save({ custom })} />
    </section>
    <DealList crm={crm} deals={crm.allDeals.filter(deal => deal.contact_id === contact.id)} onOpenDeal={onOpenDeal} />
    <Timeline crm={crm} entries={crm.activities.filter(entry => entry.contact_id === contact.id)} onLog={(type, text) => crm.logRecordActivity({ contactId: contact.id, companyId: contact.company_id }, { type, text })} />
  </RecordShell>;
}
