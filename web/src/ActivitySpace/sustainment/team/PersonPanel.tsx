'use client';

import { useId, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, X } from 'lucide-react';
import { ReachHint, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { formatElementDate, toDateOnlyString } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { displayIdOf } from '@/ActivitySpace/execution/element/displayId';
import { assignmentHistory, evidenceCandidates, SKILL_LEVELS, skillKey, skillLevelLabel } from '@/ActivitySpace/sustainment/team/people';
import type { TeamElement, TeamRosterEntry } from '@/ActivitySpace/sustainment/team/teamRoster';
import type { useWorkerSkills } from '@/hooks/useWorkerSkills';
import { FIELD, FONT, STATUS } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import type { WorkerSkill, WorkerSkillLevel } from '@/types/database';

type Skills = ReturnType<typeof useWorkerSkills>;

const SELECT = `${FIELD.base} ${FONT.sm} h-7 px-2 bg-transparent`;

function ElementLine({ element, onOpenElement, trailing }: {
  element: TeamElement;
  onOpenElement?: (elementId: string) => void;
  trailing?: React.ReactNode;
}) {
  const { t } = useI18n();
  const status = STATUS[element.status ?? 'todo'];
  const content = <>
    <span className={`size-2 rounded-full shrink-0 ${status.dot}`} aria-label={status.label} />
    {displayIdOf(element) && <span className={`${FONT.mono} shrink-0`}>{displayIdOf(element)}</span>}
    <span className="flex-1 truncate">{element.title}</span>
    <span className={`${FONT.xs} shrink-0 text-muted-foreground`}>{element.due_date ? formatElementDate(element.due_date) : t('No due date')}</span>
  </>;
  return <li className="flex items-center gap-1">
    {onOpenElement
      ? <Button variant="ghost" size="md" align="start" className="flex-1 min-w-0" onClick={() => onOpenElement(element.id)}>{content}</Button>
      : <div className={`${FONT.base} flex flex-1 min-w-0 items-center gap-2 h-8 px-3`}>{content}</div>}
    {trailing}
  </li>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <section className="space-y-2">
    <div>
      <h3 className={`${FONT.lg} text-foreground`}>{title}</h3>
      {hint && <p className={`${FONT.sm} text-muted-foreground`}>{hint}</p>}
    </div>
    {children}
  </section>;
}

function SkillRow({ skill, entry, evidenceIds, skills, onOpenElement, onError }: {
  skill: WorkerSkill;
  entry: TeamRosterEntry;
  evidenceIds: string[];
  skills: Skills;
  onOpenElement?: (elementId: string) => void;
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const known = useMemo(() => new Map(entry.elements.map((element) => [element.id, element])), [entry.elements]);
  const attached = useMemo(() => new Set(evidenceIds), [evidenceIds]);
  const shown = evidenceIds.map((id) => known.get(id)).filter((element): element is TeamElement => Boolean(element));
  const elsewhere = evidenceIds.length - shown.length;
  const candidates = evidenceCandidates(entry, attached);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try { await action(); }
    catch (cause) { onError(cause instanceof Error ? t(cause.message) : t('Could not save. Try again.')); }
    finally { setBusy(false); }
  };

  return <li className="border-b border-[var(--border-subtle)] last:border-b-0">
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span className={`${FONT.base} font-medium text-foreground flex-1 min-w-32 truncate`}>{skill.name}</span>
      {entry.canManage
        ? <select aria-label={t('Level of {name}', { name: skill.name })} className={SELECT} value={skill.level} disabled={busy}
          onChange={(event) => { void run(() => skills.setLevel(skill.id, Number(event.target.value) as WorkerSkillLevel)); }}>
          {SKILL_LEVELS.map((row) => <option key={row.level} value={row.level}>{t(row.label)}</option>)}
        </select>
        : <span className={`${FONT.sm} text-muted-foreground px-2`}>{t(skillLevelLabel(skill.level))}</span>}
      <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((value) => !value)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('{n} evidence', { n: evidenceIds.length })}
      </Button>
      {entry.canManage && <Button variant="ghost" size="icon-sm" aria-label={t('Remove {name}', { name: skill.name })} disabled={busy}
        onClick={() => { void run(() => skills.removeSkill(skill.id)); }}><X size={12} /></Button>}
    </div>
    {open && <div id={listId} className="pb-3 pl-2 space-y-2">
      {shown.length === 0 && elsewhere === 0
        ? <p className={`${FONT.sm} text-muted-foreground`}>{t('No evidence yet. Link done Elements that show this skill.')}</p>
        : <ul className="space-y-1">{shown.map((element) => <ElementLine key={element.id} element={element} onOpenElement={onOpenElement}
          trailing={entry.canManage && <Button variant="ghost" size="icon-sm" aria-label={t('Remove evidence {title}', { title: element.title })} disabled={busy}
            onClick={() => { void run(() => skills.removeEvidence(skill.id, element.id)); }}><X size={12} /></Button>} />)}</ul>}
      {elsewhere > 0 && <p className={`${FONT.sm} text-muted-foreground`}>{t('{n} more from work outside this Space', { n: elsewhere })}</p>}
      {entry.canManage && (candidates.length > 0
        ? <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (pick) void run(async () => { await skills.addEvidence(skill.id, pick); setPick(''); });
        }}>
          <select aria-label={t('Done Element to link as evidence')} className={`${SELECT} flex-1 min-w-48`} value={pick} disabled={busy} onChange={(event) => setPick(event.target.value)}>
            <option value="">{t('Choose a done Element…')}</option>
            {candidates.map((element) => <option key={element.id} value={element.id}>{[displayIdOf(element), element.title].filter(Boolean).join(' ')}</option>)}
          </select>
          <Button type="submit" size="sm" disabled={busy || !pick}>{t('Link evidence')}</Button>
        </form>
        : <p className={`${FONT.sm} text-muted-foreground`}>{t('No other done Elements assigned to them in this Space.')}</p>)}
    </div>}
  </li>;
}

function AddSkill({ workerId, skills, suggestions, onError }: {
  workerId: string;
  skills: Skills;
  suggestions: string[];
  onError: (message: string | null) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [level, setLevel] = useState<WorkerSkillLevel>(2);
  const [busy, setBusy] = useState(false);
  const listId = useId();
  return <form className="flex flex-wrap items-center gap-2 pt-1" aria-busy={busy} onSubmit={async (event) => {
    event.preventDefault();
    setBusy(true);
    onError(null);
    try { await skills.addSkill(workerId, name, level); setName(''); }
    catch (cause) { onError(cause instanceof Error ? t(cause.message) : t('Could not save. Try again.')); }
    finally { setBusy(false); }
  }}>
    <Input aria-label={t('Skill name')} placeholder={t('Add a skill, e.g. React or Triage')} list={listId} value={name} disabled={busy}
      maxLength={60} className="h-7 flex-1 min-w-48" onChange={(event) => setName(event.target.value)} />
    <datalist id={listId}>{suggestions.map((value) => <option key={value} value={value} />)}</datalist>
    <select aria-label={t('Level')} className={SELECT} value={level} disabled={busy} onChange={(event) => setLevel(Number(event.target.value) as WorkerSkillLevel)}>
      {SKILL_LEVELS.map((row) => <option key={row.level} value={row.level}>{t(row.label)}</option>)}
    </select>
    <Button type="submit" size="sm" disabled={busy || !name.trim()}>{t('Add skill')}</Button>
  </form>;
}

export function PersonPanel({ entry, skills, objectNames, skillSuggestions, capacity, onOpenWorkload, onOpenElement }: {
  entry: TeamRosterEntry;
  skills: Skills;
  objectNames: ReadonlyMap<string, string>;
  skillSuggestions: string[];
  capacity: React.ReactNode;
  onOpenWorkload?: (workerId?: string) => void;
  onOpenElement?: (elementId: string) => void;
}) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const { worker, activeElements } = entry;
  const typeLabel = worker.type === 'ai_agent' ? t('AI agent') : worker.type === 'robot' ? t('Robot') : null;
  const context = [t(entry.membership), ...entry.domainNames].join(' · ');
  const today = toDateOnlyString(new Date());
  const mine = skills.data.skills.filter((skill) => skill.worker_id === worker.id)
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  const evidenceBySkill = new Map<string, string[]>();
  for (const row of skills.data.evidence) evidenceBySkill.set(row.skill_id, [...(evidenceBySkill.get(row.skill_id) ?? []), row.element_id]);
  const history = assignmentHistory(entry.elements, objectNames);
  const doneCount = entry.elements.filter((element) => element.status === 'done').length;
  const period = (from: string, to: string) => from && to
    ? (from === to ? formatElementDate(from) : `${formatElementDate(from)} – ${formatElementDate(to)}`)
    : '';

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start gap-3">
      <WorkerAvatar worker={worker} size={40} />
      <div className="flex-1 min-w-48">
        <div className="flex items-center gap-2">
          <h2 className={`${FONT.xl} text-foreground truncate`}>{worker.name}</h2>
          {typeLabel && <span className={`${FONT.xs} text-muted-foreground flex items-center gap-1`}><Bot size={12} />{typeLabel}</span>}
          <ReachHint worker={worker} />
        </div>
        <p className={`${FONT.sm} text-muted-foreground`}>{worker.role ? `${worker.role} · ` : ''}{context}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {capacity}
        {onOpenWorkload && <Button variant="ghost" size="sm" onClick={() => onOpenWorkload(worker.id)}>{t('Workload')}</Button>}
      </div>
    </div>

    <Section title={t('Skills')} hint={t('What they know, at what level, and the done Elements that show it.')}>
      {error && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{error}</p>}
      {skills.error && <p role="alert" className={`${FONT.sm} text-[var(--status-danger)]`}>{t('Could not load skills.')}</p>}
      {skills.loading ? <p role="status" className={`${FONT.sm} text-muted-foreground`}>{t('Loading skills…')}</p>
        : mine.length === 0
          ? <p className={`${FONT.sm} text-muted-foreground`}>{entry.canManage ? t('No skills yet. Add what they know, then link done Elements as evidence.') : t('No skills recorded yet.')}</p>
          : <ul>{mine.map((skill) => <SkillRow key={skill.id} skill={skill} entry={entry} evidenceIds={evidenceBySkill.get(skill.id) ?? []}
            skills={skills} onOpenElement={onOpenElement} onError={setError} />)}</ul>}
      {entry.canManage && <AddSkill workerId={worker.id} skills={skills} onError={setError}
        suggestions={skillSuggestions.filter((name) => !mine.some((skill) => skillKey(skill.name) === skillKey(name)))} />}
    </Section>

    <Section title={t('Assignments')} hint={t('Read from the Elements assigned to them — nothing to enter. {done} done of {total}.', { done: doneCount, total: entry.elements.length })}>
      {history.length === 0 ? <p className={`${FONT.sm} text-muted-foreground`}>{t('No assignments in this Space yet.')}</p>
        : <table className={`${FONT.base} w-full`}>
          <thead className={`${FONT.xs} text-muted-foreground text-left`}>
            <tr><th className="font-normal py-1">{t('Object')}</th><th className="font-normal py-1 text-right">{t('Done')}</th>
              <th className="font-normal py-1 text-right">{t('Open')}</th><th className="font-normal py-1 pl-4 hidden sm:table-cell">{t('Period')}</th></tr>
          </thead>
          <tbody>{history.map((row) => <tr key={row.objectId} className="border-t border-[var(--border-subtle)]">
            <td className="py-1.5 pr-2 truncate max-w-0 w-full">{row.objectName || t('Object outside this Space')}</td>
            <td className="py-1.5 text-right tabular-nums whitespace-nowrap">{row.done}/{row.total}</td>
            <td className="py-1.5 text-right tabular-nums">{row.open}</td>
            <td className={`py-1.5 pl-4 whitespace-nowrap text-muted-foreground hidden sm:table-cell ${FONT.sm}`}>{period(row.first, row.last)}</td>
          </tr>)}</tbody>
        </table>}
    </Section>

    <Section title={t('Open Elements')} hint={activeElements.some((element) => element.due_date && element.due_date.slice(0, 10) < today)
      ? t('{n} overdue', { n: activeElements.filter((element) => element.due_date && element.due_date.slice(0, 10) < today).length }) : undefined}>
      {activeElements.length === 0 ? <p className={`${FONT.sm} text-muted-foreground`}>{t('Nothing open.')}</p>
        : <ul className="space-y-1">{activeElements.map((element) => <ElementLine key={element.id} element={element} onOpenElement={onOpenElement} />)}</ul>}
    </Section>
  </div>;
}
