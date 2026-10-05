'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useExplorerData } from '@/Function/shared/ExplorerDataContext';
import { useStrategies } from '@/ActivitySpace/strategy/initiative/strategyData';
import { useInitiativeMeasures } from '@/hooks/useInitiativeMeasures';
import type { Crm } from '@/hooks/useCrm';
import { fieldKey, fieldOptions, measureValue, metricKind, metricValue, normalizeCrmStages, readUnit, stageSlug, type CrmFieldRecord, type CrmMetric, type CrmStage } from './crmModel';
import { money } from './crmFormat';
import { CrmPicker } from './CrmPicker';

const message = (cause: unknown) => cause instanceof Error ? cause.message : 'Could not save. Try again.';
const INPUT = 'h-8 min-w-0 rounded-sm bg-muted/30 px-2 text-sm outline-none hover:bg-muted/40 focus:bg-muted/60';

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="space-y-3">
    <div className="space-y-1"><h2 className="text-sm font-medium">{title}</h2>{description && <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>}</div>
    {children}
  </section>;
}

function Basics({ crm }: { crm: Crm }) {
  const { t } = useI18n();
  const pipeline = crm.pipeline!;
  const [name, setName] = useState(pipeline.name);
  const [label, setLabel] = useState(pipeline.record_label ?? '');
  const [currency, setCurrency] = useState(pipeline.currency);
  const [horizon, setHorizon] = useState(String(pipeline.horizon_days));
  const [followUp, setFollowUp] = useState(String(pipeline.follow_up_days));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const days = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 3650;
  const valid = !!name.trim() && /^[A-Za-z]{3}$/.test(currency) && days(horizon) && days(followUp) && label.trim().length <= 40;
  return <Section title={t('Pipeline')} description={t('Each pipeline has its own stages, currency and rhythm — for example new business, renewals or partners. Records (companies, contacts) are shared across pipelines.')}>
    <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Name')}</span><input className={`${INPUT} w-full text-foreground`} value={name} onChange={event => { setName(event.target.value); setSaved(false); }} /></label>
      <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('What you call a deal here')}</span><input className={`${INPUT} w-full text-foreground`} placeholder={t('Deal')} value={label} onChange={event => { setLabel(event.target.value); setSaved(false); }} /></label>
      <div className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Domain')}</span>
        <CrmPicker label={t('Domain')} value={pipeline.domain_id} placeholder={t('Whole Space')}
          options={crm.domains.map(domain => ({ id: domain.id, label: domain.name }))}
          onChange={id => { setError(null); crm.savePipeline(pipeline.id, { domain_id: id }).catch(cause => setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'))); }} />
        <span className="block">{t('Only people who can see the Domain see this pipeline and its deals.')}</span>
      </div>
      <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Default currency')}</span><input className={`${INPUT} w-24 text-foreground`} maxLength={3} value={currency} onChange={event => { setCurrency(event.target.value.toUpperCase()); setSaved(false); }} /></label>
      <div className="flex gap-3">
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Forecast period (days)')}</span><input inputMode="numeric" className={`${INPUT} w-24 tabular-nums text-foreground`} value={horizon} onChange={event => { setHorizon(event.target.value); setSaved(false); }} /></label>
        <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Flag after days without contact')}</span><input inputMode="numeric" className={`${INPUT} w-24 tabular-nums text-foreground`} value={followUp} onChange={event => { setFollowUp(event.target.value); setSaved(false); }} /></label>
      </div>
    </div>
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={!valid} onClick={() => {
        setError(null);
        crm.savePipeline(pipeline.id, { name: name.trim(), record_label: label.trim() || null, currency, horizon_days: Number(horizon), follow_up_days: Number(followUp) })
          .then(() => setSaved(true)).catch(cause => setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')));
      }}>{t('Save')}</Button>
      {saved && <span role="status" className="text-xs text-muted-foreground">{t('Saved')}</span>}
      {error && <span role="alert" className="text-xs text-[var(--status-danger)]">{error}</span>}
    </div>
  </Section>;
}

function Stages({ crm }: { crm: Crm }) {
  const { t } = useI18n();
  const pipeline = crm.pipeline!;
  const [draft, setDraft] = useState<CrmStage[]>(normalizeCrmStages(pipeline.stages));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const deal of crm.workspace?.deals ?? []) if (deal.outcome === 'open' && deal.stage) counts.set(deal.stage.id, (counts.get(deal.stage.id) ?? 0) + 1);
  const update = (index: number, patch: Partial<CrmStage>) => { setSaved(false); setDraft(current => current.map((stage, i) => i === index ? { ...stage, ...patch } : stage)); };
  const move = (index: number, by: number) => { setSaved(false); setDraft(current => { const next = [...current]; const [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next; }); };
  const valid = draft.every(stage => stage.label.trim() && stage.id) && new Set(draft.map(stage => stage.id)).size === draft.length && !draft.some(stage => ['won', 'lost'].includes(stage.id));
  return <Section title={t('Pipeline stages')} description={t('Open stages in order. Won and Lost are always available. A stage’s likelihood is applied when a deal moves into it, unless the deal’s likelihood was set by hand.')}>
    <ol className="space-y-1.5">
      {draft.map((stage, index) => <li key={index} className="flex flex-wrap items-center gap-2">
        <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
        <input aria-label={t('Stage name')} className={`${INPUT} w-48`} value={stage.label}
          onChange={event => update(index, { label: event.target.value, ...(counts.has(stage.id) ? {} : { id: stageSlug(event.target.value) }) })} />
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input aria-label={t('Likelihood for {stage}', { stage: stage.label })} inputMode="numeric" className={`${INPUT} w-16 text-right tabular-nums`} value={stage.probability}
            onChange={event => update(index, { probability: Math.min(100, Math.max(0, Number(event.target.value.replace(/\D/g, '')) || 0)) })} />%
        </label>
        <span className="w-20 text-xs text-muted-foreground">{counts.get(stage.id) ? t('{n} deals', { n: counts.get(stage.id)! }) : ''}</span>
        <Button variant="ghost" size="icon-xs" aria-label={t('Move up')} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></Button>
        <Button variant="ghost" size="icon-xs" aria-label={t('Move down')} disabled={index === draft.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></Button>
        <Button variant="ghost" size="icon-xs" aria-label={t('Remove stage')} disabled={draft.length === 1 || counts.has(stage.id)} title={counts.has(stage.id) ? t('Move its deals first') : undefined}
          onClick={() => { setSaved(false); setDraft(current => current.filter((_, i) => i !== index)); }}><Trash2 size={12} /></Button>
      </li>)}
    </ol>
    {!valid && <p role="alert" className="text-xs text-[var(--status-danger)]">{t('Each stage needs a unique name other than Won or Lost.')}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="ghost" size="sm" disabled={draft.length >= 12} onClick={() => { setSaved(false); setDraft(current => [...current, { id: `stage-${current.length + 1}`, label: t('New stage'), probability: 50 }]); }}><Plus size={14} />{t('Add stage')}</Button>
      <Button variant="secondary" size="sm" disabled={!valid} onClick={() => { const stages = normalizeCrmStages(draft); setError(null); crm.savePipeline(pipeline.id, { stages }).then(() => { setDraft(stages); setSaved(true); }).catch(cause => setError(message(cause))); }}>{t('Save stages')}</Button>
      {saved && <span role="status" className="text-xs text-muted-foreground">{t('Saved')}</span>}
      {error && <span role="alert" className="text-xs text-[var(--status-danger)]">{error}</span>}
    </div>
  </Section>;
}

const METRICS: { id: CrmMetric; label: string }[] = [
  { id: 'won_count_quarter', label: 'Deals won this quarter' }, { id: 'won_count_year', label: 'Deals won this year' }, { id: 'won_count_total', label: 'Deals won to date' },
  { id: 'won_quarter', label: 'Won this quarter' }, { id: 'won_year', label: 'Won this year' }, { id: 'won_total', label: 'Won to date' },
  { id: 'weighted', label: 'Weighted pipeline' }, { id: 'open', label: 'Open pipeline' },
];

function Connections({ crm }: { crm: Crm }) {
  const { t, locale } = useI18n();
  const pipeline = crm.pipeline!;
  const { objects } = useExplorerData();
  const strategies = useStrategies();
  const { measures } = useInitiativeMeasures(strategies.data.map(item => item.id));
  const names = new Map(strategies.data.map(item => [item.id, item.name]));
  const metric = pipeline.measure_metric ?? 'won_quarter';
  const value = crm.workspace ? metricValue(crm.workspace.deals, metric, pipeline.currency, crm.today) : null;
  const linked = measures.find(measure => measure.id === pipeline.measure_intent_id);
  const written = value === null ? null : measureValue(linked?.unit, metric, pipeline.currency, value);
  const unit = readUnit(linked?.unit);
  // Why nothing would be written, in the person's terms.
  const mismatch = !linked || written !== null || value === null ? null
    : unit.kind === 'rate' ? t('“{unit}” is a rate or a per-period figure; the CRM cannot write into it.', { unit: linked.unit ?? '' })
    : unit.kind === 'unknown' ? t('Alcon cannot tell whether “{unit}” is money or a count. Use a currency (円, JPY) or a count (社, 件) as the unit.', { unit: linked.unit ?? '' })
    : unit.kind === 'money' && metricKind(metric) === 'amount' ? t('This success condition is in {currency}; this pipeline reports in {pipeline}.', { currency: unit.currency, pipeline: pipeline.currency })
    : unit.kind === 'count' ? t('This success condition counts “{unit}”. Choose a number of deals won.', { unit: linked.unit ?? '' })
    : t('This success condition is an amount. Choose an amount won or in the pipeline.');
  const [error, setError] = useState<string | null>(null);
  const save = (patch: Parameters<Crm['savePipeline']>[1]) => { setError(null); crm.savePipeline(pipeline.id, patch).catch(cause => setError(message(cause))); };
  return <Section title={t('Connections')} description={t('How this pipeline meets Execution and Strategy. Next steps become Elements in the Object you choose, assigned to each deal’s owner. The figure you choose is written into an Initiative’s success condition when its owner opens the CRM.')}>
    <div className="max-w-2xl space-y-2">
      <div className="grid grid-cols-[180px_minmax(0,1fr)] items-center gap-2">
        <span className="text-xs text-muted-foreground">{t('Next steps go to')}</span>
        <CrmPicker label={t('Object for next steps')} value={pipeline.object_id} placeholder={t('None — your own deals go to My Elements')}
          options={objects.map(object => ({ id: object.id, label: object.name }))} onChange={id => save({ object_id: id })} />
        <span className="text-xs text-muted-foreground">{t('Reports into')}</span>
        <CrmPicker label={t('Success condition')} value={pipeline.measure_intent_id} placeholder={t('No Initiative')}
          options={measures.map(measure => ({ id: measure.id, label: measure.title, hint: names.get(measure.strategy_id ?? '') ?? null }))}
          onChange={id => save({ measure_intent_id: id, measure_metric: id ? metric : null })} />
        {pipeline.measure_intent_id && <>
          <span className="text-xs text-muted-foreground">{t('As')}</span>
          <div className="flex flex-wrap gap-1">{METRICS.map(item => <Button key={item.id} shape="tab" size="xs" variant={metric === item.id ? 'secondary' : 'ghost'} aria-pressed={metric === item.id}
            onClick={() => save({ measure_metric: item.id })}>{t(item.label)}</Button>)}</div>
        </>}
      </div>
      {pipeline.measure_intent_id && mismatch && <p role="alert" className="text-xs text-[var(--status-warning)]">{mismatch} {t('Nothing is written until they match.')}</p>}
      {pipeline.measure_intent_id && linked && written !== null && <p className="text-xs text-muted-foreground">{t('Currently reporting {value}.', { value: unit.kind === 'money' || unit.kind === 'count' ? `${written.toLocaleString(locale)} ${linked?.unit ?? ''}`.trim() : metricKind(metric) === 'count' ? String(written) : money(written, pipeline.currency, locale) })}</p>}
      {crm.measureError && <p role="alert" className="text-xs text-[var(--status-danger)]">{t(crm.measureError)}</p>}
      {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p>}
    </div>
  </Section>;
}

const FIELD_TYPES: CrmFieldRecord['type'][] = ['text', 'number', 'date', 'select', 'checkbox'];
const TYPE_LABEL: Record<CrmFieldRecord['type'], string> = { text: 'Text', number: 'Number', date: 'Date', select: 'Choice', checkbox: 'Checkbox' };
const ENTITY_LABEL = { deal: 'Deals', company: 'Companies', contact: 'Contacts' } as const;

function Fields({ crm }: { crm: Crm }) {
  const { t } = useI18n();
  const [entity, setEntity] = useState<CrmFieldRecord['entity']>('deal');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CrmFieldRecord['type']>('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A new field belongs to the open pipeline's Domain unless chosen otherwise.
  const [scope, setScope] = useState<string | null>(crm.pipeline?.domain_id ?? null);
  const list = crm.fields.filter(field => field.entity === entity);
  const domainName = (id: string | null) => id ? crm.domains.find(domain => domain.id === id)?.name ?? t('Domain') : t('Whole Space');
  async function add() {
    setError(null);
    try {
      await crm.saveField(null, {
        entity, label: label.trim(), type, key: fieldKey(label, list.map(field => field.key)),
        options: type === 'select' ? options.split(/[,\n、]/).map(item => item.trim()).filter(Boolean) : [],
        order_index: list.length, domain_id: scope,
      });
      setLabel(''); setOptions('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('Could not save. Try again.')); }
  }
  return <Section title={t('Your fields')} description={t('Add what your organisation tracks that the standard record does not — a contract type, a region, a regulatory ID. A field of a Domain appears only on that Domain’s records; a Space field appears everywhere.')}>
    <div role="group" aria-label={t('Record kind')} className="flex gap-1">{(['deal', 'company', 'contact'] as const).map(item =>
      <Button key={item} shape="tab" size="sm" variant={entity === item ? 'secondary' : 'ghost'} aria-pressed={entity === item} onClick={() => setEntity(item)}>{t(ENTITY_LABEL[item])}</Button>)}</div>
    <ul className="max-w-2xl divide-y divide-[var(--border-subtle)]">{list.map(field => <li key={field.id} className="flex items-center gap-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{field.label}</span>
      <span className="max-w-40 truncate text-xs text-muted-foreground">{domainName(field.domain_id)}</span>
      <span className="text-xs text-muted-foreground">{t(TYPE_LABEL[field.type])}{field.type === 'select' && ` · ${fieldOptions(field).join(', ')}`}</span>
      <Button variant="ghost" size="icon-xs" aria-label={t('Remove field {name}', { name: field.label })} onClick={() => { setError(null); crm.deleteField(field.id).catch(cause => setError(message(cause))); }}><Trash2 size={12} /></Button>
    </li>)}{!list.length && <li className="py-2 text-xs text-muted-foreground">{t('No fields yet.')}</li>}</ul>
    <div className="flex max-w-2xl flex-wrap items-center gap-2">
      <input aria-label={t('Field name')} placeholder={t('Field name')} className={`${INPUT} w-48`} value={label} onChange={event => setLabel(event.target.value)} />
      <div className="flex gap-1">{FIELD_TYPES.map(item => <Button key={item} shape="tab" size="xs" variant={type === item ? 'secondary' : 'ghost'} aria-pressed={type === item} onClick={() => setType(item)}>{t(TYPE_LABEL[item])}</Button>)}</div>
      {type === 'select' && <input aria-label={t('Choices')} placeholder={t('Choices, separated by commas')} className={`${INPUT} w-64`} value={options} onChange={event => setOptions(event.target.value)} />}
      <CrmPicker label={t('Shown in')} value={scope} placeholder={t('Whole Space')} options={crm.domains.map(domain => ({ id: domain.id, label: domain.name }))} onChange={setScope} />
      <Button size="sm" variant="secondary" disabled={!label.trim() || (type === 'select' && !options.trim())} onClick={() => void add()}><Plus size={14} />{t('Add field')}</Button>
    </div>
    {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p>}
  </Section>;
}

function PipelinesList({ crm, onSelect }: { crm: Crm; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pipeline = crm.pipeline!;
  const count = crm.allDeals.filter(deal => deal.pipeline_id === pipeline.id).length;
  return <Section title={t('Pipelines')}>
    <div className="flex flex-wrap items-center gap-2">
      {crm.pipelines.map(item => <Button key={item.id} shape="tab" size="sm" variant={item.id === pipeline.id ? 'secondary' : 'ghost'} aria-pressed={item.id === pipeline.id} onClick={() => onSelect(item.id)}>{item.name}</Button>)}
      <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; setError(null); crm.savePipeline(null, { name: name.trim(), currency: pipeline.currency, order_index: Math.max(1, ...crm.pipelines.map(item => item.order_index + 1)) }).then(id => { setName(''); onSelect(id); }).catch(cause => setError(message(cause))); }}>
        <input aria-label={t('New pipeline')} placeholder={t('New pipeline…')} className={`${INPUT} w-44`} value={name} onChange={event => setName(event.target.value)} />
        <Button type="submit" size="sm" variant="ghost" disabled={!name.trim()}><Plus size={14} />{t('Add')}</Button>
      </form>
    </div>
    {crm.pipelines.length > 1 && (confirm
      ? <div className="flex items-center gap-2"><span className="text-xs">{t('Delete “{name}” and its {n} deals?', { name: pipeline.name, n: count })}</span>
        <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>{t('Cancel')}</Button>
        <Button size="sm" variant="danger" onClick={() => { setError(null); crm.deletePipeline(pipeline.id).then(() => { setConfirm(false); onSelect(crm.pipelines.find(item => item.id !== pipeline.id)!.id); }).catch(cause => setError(message(cause))); }}>{t('Delete')}</Button></div>
      : <Button size="xs" variant="ghost" onClick={() => setConfirm(true)}><Trash2 size={12} />{t('Delete this pipeline')}</Button>)}
    {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p>}
  </Section>;
}

function Import({ crm }: { crm: Crm }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ busy: boolean; done?: number; error?: string }>({ busy: false });
  if (!crm.legacyTable) return null;
  return <Section title={t('Bring in your earlier pipeline')} description={t('Your CRM used to read a Table. Import its deals, companies, contacts and activity into this pipeline. The Table itself is not changed.')}>
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={state.busy || state.done !== undefined} onClick={() => {
        setState({ busy: true });
        crm.importFromTable(crm.legacyTable!.tableId, crm.legacyTable!.fields).then(done => setState({ busy: false, done }))
          .catch(cause => setState({ busy: false, error: cause instanceof Error ? cause.message : t('Could not import.') }));
      }}>{state.busy ? t('Importing…') : t('Import from Table')}</Button>
      {state.done !== undefined && <span role="status" className="text-xs text-muted-foreground">{t('{n} deals imported.', { n: state.done })}</span>}
      {state.error && <span role="alert" className="text-xs text-[var(--status-danger)]">{state.error}</span>}
    </div>
  </Section>;
}

/** What an organisation may shape: pipelines, stages, words, links and fields.
 * The record types and calculations stay standard. */
export function CrmSettings({ crm, onSelectPipeline }: { crm: Crm; onSelectPipeline: (id: string) => void }) {
  if (!crm.pipeline) return null;
  return <div className="max-w-3xl space-y-10">
    <PipelinesList crm={crm} onSelect={onSelectPipeline} />
    <Basics key={`basics:${crm.pipeline.id}`} crm={crm} />
    <Stages key={`stages:${crm.pipeline.id}:${JSON.stringify(crm.pipeline.stages)}`} crm={crm} />
    <Connections crm={crm} />
    <Fields crm={crm} />
    <Import crm={crm} />
  </div>;
}
