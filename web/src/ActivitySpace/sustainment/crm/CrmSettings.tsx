'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { OperationsSetup } from '@/ActivitySpace/sustainment/operations/OperationsSetup';
import { normalizeCrmStages, stageSlug, type CrmStage } from './crmModel';
import type { Crm } from './useCrm';

const INPUT = 'h-8 min-w-0 rounded-sm bg-muted/30 px-2 text-sm outline-none hover:bg-muted/40 focus:bg-muted/60';

function StagesEditor({ crm }: { crm: Crm }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CrmStage[]>(crm.stages);
  const [saved, setSaved] = useState(false);
  const counts = new Map<string, number>();
  for (const deal of crm.workspace?.deals ?? []) if (deal.outcome === 'open' && deal.stage) counts.set(deal.stage.id, (counts.get(deal.stage.id) ?? 0) + 1);
  const update = (index: number, patch: Partial<CrmStage>) => { setSaved(false); setDraft(current => current.map((stage, i) => i === index ? { ...stage, ...patch } : stage)); };
  const move = (index: number, by: number) => { setSaved(false); setDraft(current => { const next = [...current]; const [item] = next.splice(index, 1); next.splice(index + by, 0, item); return next; }); };
  const valid = draft.every(stage => stage.label.trim()) && new Set(draft.map(stage => stage.id)).size === draft.length && !draft.some(stage => ['won', 'lost'].includes(stage.id));
  return <section className="space-y-3">
    <div className="space-y-1"><h2 className="text-sm font-medium">{t('Pipeline stages')}</h2>
      <p className="text-xs text-muted-foreground">{t('Open stages in order. Won and Lost are always available. A stage’s likelihood is applied when a deal moves into it, unless the deal’s likelihood was set by hand.')}</p></div>
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
      <Button variant="primary" size="sm" disabled={!valid} onClick={() => { const stages = normalizeCrmStages(draft); crm.setParams({ crmStages: stages }); setDraft(stages); setSaved(true); }}>{t('Save stages')}</Button>
      {saved && <span role="status" className="text-xs text-muted-foreground">{t('Saved')}</span>}
    </div>
  </section>;
}

function Thresholds({ crm }: { crm: Crm }) {
  const { t } = useI18n();
  const [horizon, setHorizon] = useState(String(crm.params.horizonDays));
  const [followUp, setFollowUp] = useState(String(crm.params.followUpDays));
  const valid = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 3650;
  const dirty = horizon !== String(crm.params.horizonDays) || followUp !== String(crm.params.followUpDays);
  return <section className="space-y-3">
    <h2 className="text-sm font-medium">{t('Forecast and follow-up')}</h2>
    <div className="flex flex-wrap gap-6">
      <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Forecast period (days)')}</span>
        <input inputMode="numeric" className={`${INPUT} w-24 tabular-nums text-foreground`} value={horizon} aria-invalid={!valid(horizon) || undefined} onChange={event => setHorizon(event.target.value)} /></label>
      <label className="space-y-1 text-xs text-muted-foreground"><span className="block">{t('Flag after days without contact')}</span>
        <input inputMode="numeric" className={`${INPUT} w-24 tabular-nums text-foreground`} value={followUp} aria-invalid={!valid(followUp) || undefined} onChange={event => setFollowUp(event.target.value)} /></label>
    </div>
    <Button variant="secondary" size="sm" disabled={!dirty || !valid(horizon) || !valid(followUp)}
      onClick={() => crm.setParams({ horizonDays: Number(horizon), followUpDays: Number(followUp) })}>{t('Apply')}</Button>
  </section>;
}

export function CrmSettings({ crm, onOpenTable, onDone }: { crm: Crm; onOpenTable?: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setup = <OperationsSetup params={crm.params} tables={crm.tables.data} columns={crm.data?.columns ?? []}
    onChange={patch => crm.setParams(typeof patch === 'function' ? patch(crm.params) : patch)} onDone={onDone} />;
  if (!crm.workspace) return <div className="space-y-4">{crm.params.tableId && !crm.eligible && !crm.loading && <p role="alert" className="text-sm text-muted-foreground">{t('The connected Table is no longer available. Choose another below.')}</p>}{setup}</div>;
  return <div className="max-w-3xl space-y-10">
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{t('Data')}</h2>
      <p className="text-xs text-muted-foreground">{t('Deals are rows in the Table “{name}”. Edit it there for bulk changes or imports; this App reads the same rows.', { name: crm.data?.table.name ?? '' })}</p>
      <div className="flex flex-wrap gap-2">
        {onOpenTable && <Button variant="ghost" size="sm" onClick={onOpenTable}>{t('Open in Table')}</Button>}
        {crm.missingColumns.length > 0 && <Button variant="secondary" size="sm" disabled={adding} onClick={() => {
          setAdding(true); setError(null);
          crm.addMissingColumns().catch(cause => setError(cause instanceof Error ? cause.message : t('Could not add the columns.'))).finally(() => setAdding(false));
        }}>{adding ? t('Adding…') : t('Add {fields} columns', { fields: crm.missingColumns.map(field => t(field.label)).join(', ') })}</Button>}
      </div>
      {error && <p role="alert" className="text-xs text-[var(--status-danger)]">{error}</p>}
      <details className="pt-2"><summary className="w-fit cursor-pointer rounded-sm py-1 text-xs text-muted-foreground hover:text-foreground">{t('Change column mapping or Table')}</summary>{setup}</details>
    </section>
    <StagesEditor key={JSON.stringify(crm.stages)} crm={crm} />
    <Thresholds key={`${crm.params.horizonDays}:${crm.params.followUpDays}`} crm={crm} />
  </div>;
}
