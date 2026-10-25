'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/ui/dialog';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ApproachCommand, DomainApproachData } from '@/hooks/useDomainApproaches';
import { conditionAssessment, RESULT_LABELS } from '@/Function/domain/approachModel';
import type { ApproachCondition, ApproachContribution, DomainApproach } from '@/Function/domain/approachModel';

export type ApproachEditorTarget =
  | { kind: 'approach'; approach?: DomainApproach }
  | { kind: 'condition'; approach: DomainApproach; condition?: ApproachCondition }
  | { kind: 'contribution'; approach: DomainApproach; condition: ApproachCondition; contribution?: ApproachContribution }
  | { kind: 'assessment'; approach: DomainApproach; condition: ApproachCondition }
  | { kind: 'review'; approach: DomainApproach };
interface Field { name: string; label: string; type?: 'textarea' | 'date' | 'select'; required?: boolean; options?: { value: string; label: string }[]; disabled?: boolean }
const inputClass = 'w-full min-w-0 rounded-md border-0 bg-muted/40 px-3 py-2 text-sm focus:bg-accent';
const options = (items: Record<string, string>) => Object.entries(items).map(([value, label]) => ({ value, label }));

export function ApproachEditor({ target, data, objects, open, onOpenChange, onReload, onSave }: {
  target: ApproachEditorTarget; data: DomainApproachData; objects: { id: string; name: string }[];
  open: boolean; onOpenChange: (open: boolean) => void; onReload: () => void; onSave: (command: ApproachCommand) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const a = target.approach;
  const seed = target.kind === 'approach' ? a : target.kind === 'condition' ? target.condition : target.kind === 'contribution' ? target.contribution : undefined;
  const [values, setValues] = useState<Record<string, string>>(() => ({
    title: '', expected_change: '', hypothesis: '', assumptions: '', review_trigger: '', review_date: '', strategy_id: '', measure_id: '',
    kind: 'outcome', required: 'true', success_criteria: '', object_id: '', role: 'primary', rationale: '', sequence_note: '',
    result: 'unverified', observation: '', evidence_source: '', observed_on: '', reasoning: '', action: 'continue', changes: '', next_review_date: '',
    ...Object.fromEntries(Object.entries(seed ?? {}).map(([key, value]) => [key, value == null ? '' : String(value)])),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusAfterSave = useRef(false);
  useEffect(() => {
    if (!saving && focusAfterSave.current) {
      focusAfterSave.current = false;
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, [saving]);
  const [more, setMore] = useState(target.kind === 'condition');
  let fields: Field[];
  if (target.kind === 'approach') fields = [
    { name: 'title', label: t('Approach'), required: true },
    { name: 'strategy_id', label: t('Contributes to Initiative'), type: 'select', required: true, disabled: Boolean(a), options: data.initiatives.map(i => ({ value: i.id, label: i.name })) },
    { name: 'measure_id', label: t('Initiative success condition (optional)'), type: 'select', options: data.measures.filter(m => m.strategy_id === values.strategy_id).map(m => ({ value: m.id, label: m.title })) },
    { name: 'expected_change', label: t('What should change?'), type: 'textarea', required: true },
    { name: 'hypothesis', label: t('Why should this combination of work produce that change?'), type: 'textarea', required: true },
    { name: 'assumptions', label: t('Assumptions and constraints'), type: 'textarea' },
    { name: 'review_trigger', label: t('What would make us reconsider?'), type: 'textarea' },
    { name: 'review_date', label: t('Review on'), type: 'date' },
  ];
  else if (target.kind === 'condition') fields = [
    { name: 'title', label: t('What must become true?'), required: true },
    { name: 'kind', label: t('Condition type'), type: 'select', required: true, options: options({ outcome: t('Outcome'), readiness: t('Readiness'), learning: t('Learning question') }) },
    { name: 'required', label: t('Required to proceed?'), type: 'select', required: true, options: options({ true: t('Required'), false: t('Supporting condition') }) },
    { name: 'success_criteria', label: t('How will we establish it?'), type: 'textarea', required: true },
    { name: 'review_date', label: t('Review on'), type: 'date' },
  ];
  else if (target.kind === 'contribution') fields = [
    { name: 'object_id', label: t('Contributing Object'), type: 'select', required: true, disabled: Boolean(target.contribution), options: objects.filter(o => target.contribution || !data.contributions.some(c => c.condition_id === target.condition.id && c.object_id === o.id)).map(o => ({ value: o.id, label: o.name })) },
    { name: 'role', label: t('Role in meeting this condition'), type: 'select', required: true, options: options({ primary: t('Primary'), alternative: t('Alternative'), supporting: t('Supporting') }) },
    { name: 'rationale', label: t('Why is this Object needed?'), type: 'textarea', required: true },
    { name: 'sequence_note', label: t('Priority, sequence and constraints'), type: 'textarea' },
  ];
  else if (target.kind === 'assessment') fields = [
    { name: 'result', label: t('Assessment'), type: 'select', required: true, options: options({ unverified: t('Unverified'), met: t('Met'), not_met: t('Not met'), refuted: t('Premise refuted') }) },
    { name: 'observation', label: t('Observed facts'), type: 'textarea', required: true },
    { name: 'evidence_source', label: t('Evidence source / reference'), required: true },
    { name: 'observed_on', label: t('Observed on'), type: 'date', required: true },
    { name: 'reasoning', label: t('Interpretation and judgment rationale'), type: 'textarea', required: true },
  ];
  else fields = [
    { name: 'action', label: t('Decision'), type: 'select', required: true, options: options({ continue: t('Continue'), change: t('Change'), stop: t('Stop') }) },
    { name: 'reasoning', label: t('Why, given the evidence and uncertainty?'), type: 'textarea', required: true },
    { name: 'changes', label: t('What should change in the approach, Objects or Initiative?'), type: 'textarea', required: values.action === 'change' },
    { name: 'next_review_date', label: t('Next review'), type: 'date' },
  ];
  const latest = data.approaches.find(row => row.id === a?.id);
  const versionSensitive = target.kind === 'review' || target.kind === 'assessment' || (target.kind === 'approach' && Boolean(a)) || (target.kind === 'condition' && Boolean(target.condition)) || (target.kind === 'contribution' && Boolean(target.contribution));
  const outdated = versionSensitive && Boolean(a) && (!latest || (target.kind === 'assessment' ? latest.plan_revision !== a!.plan_revision : latest.revision !== a!.revision));
  const title = t({ approach: a ? 'Edit approach' : 'New approach', condition: 'Success condition', contribution: 'Connect Object', assessment: 'Record assessment', review: 'Review approach' }[target.kind]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || outdated || !data.canEdit) return;
    if (fields.some(f => f.required && !values[f.name]?.trim())) { setError(t('Complete the required fields.')); return; }
    lock.current = true; setSaving(true); setError(null);
    const v = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]));
    let command: ApproachCommand;
    if (target.kind === 'approach') command = { kind: 'approach', id: a?.id, revision: a?.revision, values: {
      title: v.title, strategy_id: v.strategy_id, measure_id: v.measure_id || null, expected_change: v.expected_change,
      hypothesis: v.hypothesis, assumptions: v.assumptions, review_trigger: v.review_trigger, review_date: v.review_date || null,
    } };
    else if (target.kind === 'condition') command = { kind: 'condition', id: target.condition?.id, approachId: target.approach.id, revision: target.approach.revision, values: {
      title: v.title, kind: v.kind as ApproachCondition['kind'], required: v.required === 'true', success_criteria: v.success_criteria, review_date: v.review_date || null,
    } };
    else if (target.kind === 'contribution') command = { kind: 'contribution', id: target.contribution?.id, approachId: target.approach.id, revision: target.approach.revision, values: {
      condition_id: target.condition.id, object_id: v.object_id, role: v.role as ApproachContribution['role'], rationale: v.rationale, sequence_note: v.sequence_note,
    } };
    else if (target.kind === 'assessment') command = { kind: 'assessment', approachId: target.approach.id, values: {
      condition_id: target.condition.id, plan_revision: target.approach.plan_revision, result: v.result as 'met' | 'not_met' | 'unverified' | 'refuted', observation: v.observation, evidence_source: v.evidence_source, observed_on: v.observed_on, reasoning: v.reasoning,
    } };
    else command = { kind: 'review', approachId: target.approach.id, values: {
      expected_revision: target.approach.revision, action: v.action as 'continue' | 'change' | 'stop', reasoning: v.reasoning, changes: v.changes, next_review_date: v.next_review_date || null,
    } };
    try {
      await onSave(command);
      if (target.kind === 'condition' && !target.condition) {
        setValues(prev => ({ ...prev, title: '', success_criteria: '' }));
        focusAfterSave.current = true;
      }
      if (!(target.kind === 'condition' && !target.condition && more)) onOpenChange(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (cause as { message?: string })?.message ?? t('Unable to save. Your draft is retained.')); }
    finally { lock.current = false; setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={next => { if (!lock.current) onOpenChange(next); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{target.kind === 'approach' ? t('Connect an Initiative to a testable approach in this Domain. Readers need access to both.') : target.kind === 'review' ? t('The current approach, conditions and evidence are saved with this decision. Apply changes through the linked Objects or Initiative.') : target.kind === 'assessment' ? t('Keep observed facts separate from interpretation. Earlier assessments remain in the history.') : target.approach?.title}</DialogDescription>
      {target.kind === 'review' && <div className="space-y-2 text-xs">
        <p className="font-medium">{t('Current basis · {title}', { title: target.approach.title })}</p>
        {data.conditions.filter(c => c.approach_id === target.approach.id).map(c => <p key={c.id}>{c.required ? t('Required') : t('Supporting')} · {c.title} · {t(RESULT_LABELS[conditionAssessment(c, target.approach, data.assessments).status])}</p>)}
        <p className="text-muted-foreground">{t('Affected Objects · {names}', { names: [...new Set(data.contributions.filter(c => c.approach_id === target.approach.id).map(c => c.object_id))].map(id => objects.find(o => o.id === id)?.name ?? t('Unavailable')).join(', ') || t('None connected') })}</p>
      </div>}
      {outdated && <div role="alert" className="space-y-2 text-sm"><p>{t('This approach changed while you were editing. Review the latest version before saving. Your draft is still here.')}</p><Button variant="secondary" disabled={saving || !latest} onClick={onReload}>{t('Discard draft and load latest')}</Button></div>}
      {!data.canEdit && <p role="alert" className="text-sm">{t('Editing is unavailable until access and current data can be verified. Your draft is retained.')}</p>}
      <form ref={formRef} onSubmit={submit} className="space-y-4">
        <fieldset disabled={saving || !data.canEdit} className="space-y-4">
          {fields.map(f => <label key={f.name} className="block space-y-1 text-xs text-muted-foreground">
            <span>{f.label}{f.required && ' *'}</span>
            {f.type === 'select' ? <select className={inputClass} aria-label={f.label} required={f.required} disabled={f.disabled} value={values[f.name]} onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value, ...(f.name === 'strategy_id' ? { measure_id: '' } : {}) }))}>
              <option value="">{t('Choose…')}</option>{f.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select> : f.type === 'textarea' ? <textarea className={inputClass} rows={3} required={f.required} value={values[f.name]} onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value }))} />
              : <input className={inputClass} type={f.type ?? 'text'} required={f.required} value={values[f.name]} onChange={e => setValues(prev => ({ ...prev, [f.name]: e.target.value }))} />}
          </label>)}
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {target.kind === 'condition' && !target.condition && <label className="mr-auto flex items-center gap-2 text-xs"><input type="checkbox" checked={more} disabled={saving} onChange={e => setMore(e.target.checked)} />{t('Add another')}</label>}
          <Button type="button" variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>{t('Close')}</Button>
          <Button type="submit" disabled={saving || outdated || !data.canEdit}>{saving ? t('Saving…') : t('Save')}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
