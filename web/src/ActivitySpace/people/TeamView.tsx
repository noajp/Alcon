'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LoaderCircle } from '@/ui/icons';
import { useTeamRoster } from '@/hooks/useTeamRoster';
import { useWorkerSkills } from '@/hooks/useWorkerSkills';
import { useEscapeLayer } from '@/Function/shared/keyboard';
import { standingCapacity } from '@/Function/shared/workerCapacity';
import { parseCapacityDraft } from '@/Function/team/teamRoster';
import { skillIndex } from '@/Function/team/people';
import { PersonPanel } from '@/ActivitySpace/people/PersonPanel';
import { FONT } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import type { Worker } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';

type SaveCapacity = (workerId: string, hours: number | null) => Promise<Worker>;

function CapacityField({ worker, canManage, onSave }: { worker: Worker; canManage: boolean; onSave: SaveCapacity }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  const inputId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEscapeLayer(editing, () => { if (!saving.current) setEditing(false); });

  const save = async () => {
    if (saving.current) return;
    let hours: number | null;
    try { hours = parseCapacityDraft(draft); }
    catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t('Enter a valid capacity.'));
      return;
    }
    if (hours === worker.capacity_hours_per_day) { setEditing(false); return; }
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      await onSave(worker.id, hours);
      if (mounted.current) setEditing(false);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? t(cause.message) : t('Could not save capacity. Try again.'));
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  };

  if (!editing) {
    const label = worker.capacity_hours_per_day === null
      ? t('{h} h/day · default', { h: standingCapacity(worker) })
      : t('{h} h/day', { h: standingCapacity(worker) });
    return canManage ? (
      <Button variant="ghost" size="sm" aria-label={t('Edit capacity for {name}: {label}', { name: worker.name, label })} onClick={() => {
        setDraft(worker.capacity_hours_per_day === null ? '' : String(worker.capacity_hours_per_day));
        setError(null);
        setEditing(true);
      }}>{label}</Button>
    ) : <span className={`${FONT.sm} px-2 text-muted-foreground tabular-nums`} title={t('Standing capacity')}>{label}</span>;
  }

  return (
    <form className="flex flex-col gap-2 w-full sm:w-72" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label htmlFor={inputId} className={`${FONT.sm} text-muted-foreground`}>{t('Standing hours per day')}</label>
      <div className="flex items-center gap-2">
        <input
          id={inputId} type="text" inputMode="decimal" autoFocus disabled={pending}
          className={`${FONT.base} h-8 w-20 px-2 rounded-md bg-transparent focus:bg-[var(--surface-raised)] tabular-nums`}
          value={draft} onChange={(event) => { setDraft(event.target.value); setError(null); }}
          placeholder={String(standingCapacity({ ...worker, capacity_hours_per_day: null }))}
          aria-invalid={Boolean(error)} aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
        />
        <Button type="submit" size="sm" disabled={pending}>{pending ? <><LoaderCircle size={12} className="animate-spin" />{t('Saving…')}</> : t('Save')}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(false)}>{t('Cancel')}</Button>
      </div>
      <span id={`${inputId}-hint`} className={`${FONT.xs} text-muted-foreground`}>{t('0–24 hours. Leave blank for the default.')}</span>
      {error && <p id={`${inputId}-error`} role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{error}</p>}
    </form>
  );
}

/** One Worker's profile — standing capacity, skills, what they are on —
 *  under their load when People focuses on them. */
export function PersonProfile({ workerId, onOpenElement }: { workerId: string; onOpenElement?: (elementId: string) => void }) {
  const roster = useTeamRoster();
  const workerIds = useMemo(() => roster.entries.map((entry) => entry.worker.id), [roster.entries]);
  const skills = useWorkerSkills(workerIds);
  const index = useMemo(() => skillIndex(skills.data.skills, skills.data.evidence, new Set(workerIds)), [skills.data, workerIds]);
  const entry = roster.entries.find((e) => e.worker.id === workerId);
  if (!entry) return null;
  return <div className="max-w-3xl py-5 pl-[30px] pr-6">
    <PersonPanel key={entry.worker.id} entry={entry} skills={skills} objectNames={roster.objectNames}
      skillSuggestions={index.map((row) => row.name)} onOpenElement={onOpenElement}
      capacity={<CapacityField worker={entry.worker} canManage={entry.canManage} onSave={roster.saveCapacity} />} />
  </div>;
}
