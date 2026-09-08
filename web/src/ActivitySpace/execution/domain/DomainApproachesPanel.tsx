'use client';

import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/ui/button';
import { WidgetHeaderAction, useWidgetMeta } from '@/Function/widget/WidgetFrame';
import type { WidgetHost } from '@/Function/widget/types';
import type { ApproachCommand, DomainApproachData } from '@/hooks/useDomainApproaches';
import { ApproachEditor, type ApproachEditorTarget } from './ApproachEditor';
import { approachAttention, approachReview, effectiveReviewDate, conditionAssessment, sharedApproachObjects, RESULT_LABELS, ROLE_LABELS, type DomainApproach, type ApproachAssessment } from './approachModel';

export function DomainApproachesPanel({ data, objects, host, onSave }: {
  data: DomainApproachData; objects: { id: string; name: string }[]; host: WidgetHost;
  onSave: (command: ApproachCommand) => Promise<unknown>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<ApproachEditorTarget | null>(null);
  const [open, setOpen] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const actionLock = useRef(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const today = new Date().toLocaleDateString('en-CA');
  const attention = data.approaches.flatMap(a => approachAttention(a, data, today).map(reason => ({ approach: a, reason })));
  const shared = sharedApproachObjects(data);
  const current = data.approaches.find(a => a.id === selected) ?? attention[0]?.approach ?? data.approaches[0];
  useWidgetMeta(data.approaches.length ? attention.length ? `${attention.length} to review` : String(data.approaches.length) : null);
  function edit(target: ApproachEditorTarget) {
    setEditor(previous => previous && editorIdentity(previous) === editorIdentity(target) ? previous : target);
    setOpen(true);
  }
  const author = (id: string) => data.authors.find(a => a.id === id)?.display_name || `Member ${id.slice(0, 8)}`;
  function objectButton(id: string) {
    const object = objects.find(o => o.id === id);
    return object ? <Button key={id} variant="ghost" size="xs" className="h-auto max-w-full whitespace-normal py-1 text-left" onClick={() => host.onNavigate?.({ objectId: id, domainId: host.subject.id })}>{object.name}</Button> : <span key={id} className="text-xs text-muted-foreground">Object unavailable</span>;
  }
  function evidence(record: ApproachAssessment) {
    return <div key={record.id} className="space-y-1 py-2 text-xs">
      <p className="font-medium">{RESULT_LABELS[record.result]} · Observed {record.observed_on}</p>
      <p className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">Observation — </span>{record.observation}</p>
      <p className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">Source — </span>{record.evidence_source}</p>
      <p className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">Judgment — </span>{record.reasoning}</p>
      <p className="text-muted-foreground">{author(record.author_id)} · {new Date(record.created_at).toLocaleString()} · Plan v{record.plan_revision}</p>
    </div>;
  }
  return <div className="space-y-6">
    {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    <WidgetHeaderAction>{data.canEdit && <Button variant="ghost" size="xs" onClick={() => edit({ kind: 'approach' })}><Plus size={14} />New approach</Button>}</WidgetHeaderAction>
    {!data.approaches.length ? <div className="space-y-3 py-4">
      <p className="text-sm">How will the work in this Domain realize an Initiative?</p>
      <p className="max-w-2xl text-xs text-muted-foreground">Describe the expected change, define what must become true, and connect the Objects that can make it happen. Assess the evidence before deciding what to continue, change or stop.</p>
      {data.canEdit && <Button variant="secondary" onClick={() => edit({ kind: 'approach' })}>Create the first approach</Button>}
    </div> : <>
      <section aria-label="Needs judgment" className="space-y-2">
        <h3 className="text-sm font-medium">Needs judgment</h3>
        {attention.length ? <div className="max-h-52 space-y-1 overflow-y-auto">{attention.map(({ approach, reason }, index) => <Button key={`${approach.id}:${index}`} variant="ghost" align="start" className="h-auto w-full justify-start whitespace-normal py-2 text-left" onClick={() => setSelected(approach.id)}><span className="min-w-0 break-words"><span className="font-medium">{approach.title}</span><span className="text-muted-foreground"> · {reason}</span></span></Button>)}</div>
          : <p className="text-xs text-muted-foreground">No review flags in the recorded conditions. This does not establish that the strategy has succeeded.</p>}
      </section>
      {shared.length > 0 && <section aria-label="Shared Objects" className="space-y-2">
        <h3 className="text-sm font-medium">Shared Objects · compare commitments</h3>
        <p className="text-xs text-muted-foreground">The same Object supports multiple active approaches in this Domain. Compare its roles and sequence before changing the work.</p>
        {shared.map(([objectId, rows]) => <div key={objectId} className="space-y-1">{objectButton(objectId)}{rows.map(row => <div key={row.id} className="flex flex-wrap items-baseline gap-1 pl-2 text-xs">
          <Button variant="ghost" size="xs" onClick={() => setSelected(row.approach_id)}>{data.approaches.find(a => a.id === row.approach_id)?.title}</Button>
          <span className="text-muted-foreground">{ROLE_LABELS[row.role]} · {row.sequence_note || row.rationale}</span>
        </div>)}</div>)}
      </section>}
      <div className="flex flex-wrap gap-1" aria-label="Approaches">{data.approaches.map(a => <Button key={a.id} variant={current?.id === a.id ? 'secondary' : 'ghost'} aria-pressed={current?.id === a.id} onClick={() => setSelected(a.id)}>{a.title}{approachReview(a, data.reviews)?.action === 'stop' ? ' · Stopped' : ''}</Button>)}</div>
      {current && renderApproachDetail(current)}
    </>}
    {!data.canEdit && <p className="text-xs text-muted-foreground">Domain owners and admins can edit approaches and record judgments.</p>}
    {editor && <ApproachEditor key={`${editorIdentity(editor)}:${editorEpoch}`} target={editor} data={data} objects={objects} open={open} onOpenChange={setOpen} onReload={() => {
      const approach = data.approaches.find(a => a.id === editor.approach?.id);
      if (!approach) return;
      const next = { ...editor, approach };
      if ('condition' in next && next.condition) next.condition = data.conditions.find(c => c.id === next.condition?.id) ?? next.condition;
      if ('contribution' in next && next.contribution) next.contribution = data.contributions.find(c => c.id === next.contribution?.id) ?? next.contribution;
      setEditor(next); setEditorEpoch(v => v + 1);
    }} onSave={async command => {
      await onSave(command);
      if (!(command.kind === 'condition' && !command.id)) setEditor(null);
    }} />}
  </div>;

  function renderApproachDetail(a: DomainApproach) {
    const conditions = data.conditions.filter(c => c.approach_id === a.id);
    const reviews = data.reviews.filter(r => r.approach_id === a.id).sort((x, y) => y.created_at.localeCompare(x.created_at));
    const reviewDate = effectiveReviewDate(a, data.reviews);
    const initiative = data.initiatives.find(i => i.id === a.strategy_id);
    const measure = data.measures.find(m => m.id === a.measure_id);
    return <section aria-label={a.title} className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="break-words text-base font-semibold">{a.title}</h3>{data.canEdit && <div className="flex gap-1"><Button variant="ghost" onClick={() => edit({ kind: 'approach', approach: a })}>Edit approach</Button><Button variant="secondary" onClick={() => edit({ kind: 'review', approach: a })}>Review</Button></div>}</div>
        <Button variant="ghost" align="start" className="h-auto max-w-full whitespace-normal text-left" onClick={() => host.onNavigate?.({ strategyId: a.strategy_id })}>Initiative · {initiative?.name ?? 'Unavailable'}</Button>
        {a.measure_id && <p className="text-xs text-muted-foreground">Success condition · {measure?.title ?? 'Unavailable'}</p>}
        <p className="whitespace-pre-wrap break-words text-sm">{a.expected_change}</p>
        <dl className="space-y-2 text-xs">
          <div><dt className="font-medium">Working hypothesis</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{a.hypothesis}</dd></div>
          {a.assumptions && <div><dt className="font-medium">Assumptions and constraints</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{a.assumptions}</dd></div>}
          <div><dt className="font-medium">Reconsider when</dt><dd className="whitespace-pre-wrap break-words text-muted-foreground">{a.review_trigger || 'No trigger recorded'}{reviewDate && ` · Review ${reviewDate}`}</dd></div>
        </dl>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between"><h4 className="text-sm font-medium">Success conditions</h4>{data.canEdit && <Button variant="ghost" size="xs" onClick={() => edit({ kind: 'condition', approach: a })}><Plus size={14} />Add condition</Button>}</div>
        {!conditions.length && <p className="text-xs text-muted-foreground">Define an outcome, readiness requirement or learning question before judging this approach.</p>}
        {conditions.map(c => {
          const assessment = conditionAssessment(c, a, data.assessments);
          const links = data.contributions.filter(l => l.condition_id === c.id);
          const history = data.assessments.filter(r => r.condition_id === c.id).sort((x, y) => y.created_at.localeCompare(x.created_at));
          return <div key={c.id} className="space-y-2 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h5 className="break-words text-sm font-medium">{c.title}</h5><p className="text-xs text-muted-foreground">{c.required ? 'Required' : 'Supporting'} · {c.kind} · {RESULT_LABELS[assessment.status]}</p></div>{data.canEdit && <div className="flex gap-1"><Button variant="ghost" size="xs" onClick={() => edit({ kind: 'condition', approach: a, condition: c })}>Edit</Button><Button variant="secondary" size="xs" onClick={() => edit({ kind: 'assessment', approach: a, condition: c })}>Assess</Button></div>}</div>
            <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{c.success_criteria}{c.review_date && ` · Review ${c.review_date}`}</p>
            {links.map(link => <div key={link.id} className="space-y-1 pl-2 text-xs"><div className="flex flex-wrap items-center gap-1">{objectButton(link.object_id)}<span className="text-muted-foreground">{ROLE_LABELS[link.role]}</span>{data.canEdit && <><Button variant="ghost" size="xs" onClick={() => edit({ kind: 'contribution', approach: a, condition: c, contribution: link })}>Edit role</Button><Button variant="ghost" size="xs" disabled={removing !== null} onClick={async () => {
              if (actionLock.current) return;
              actionLock.current = true; setRemoving(link.id); setActionError(null);
              try { await onSave({ kind: 'disconnect', id: link.id, revision: a.revision }); }
              catch (error) { setActionError((error as { message?: string })?.message ?? 'Unable to disconnect Object.'); }
              finally { actionLock.current = false; setRemoving(null); }
            }}>{removing === link.id ? 'Disconnecting…' : 'Disconnect'}</Button></>}</div><p className="whitespace-pre-wrap break-words text-muted-foreground">{link.rationale}{link.sequence_note && ` · ${link.sequence_note}`}</p></div>)}
            {data.canEdit && <Button variant="ghost" size="xs" onClick={() => edit({ kind: 'contribution', approach: a, condition: c })}>Connect Object</Button>}
            {assessment.latest && evidence(assessment.latest)}
            {history.length > 1 && <details className="text-xs"><summary className="cursor-pointer py-2 text-muted-foreground">Earlier assessments ({history.length - 1})</summary>{history.filter(r => r.id !== assessment.latest?.id).map(evidence)}</details>}
          </div>;
        })}
      </div>
      <div className="space-y-2"><h4 className="text-sm font-medium">Review history</h4>{!reviews.length && <p className="text-xs text-muted-foreground">No judgment recorded yet.</p>}{reviews.map(r => <details key={r.id} className="text-xs">
        <summary className="cursor-pointer py-2 font-medium">{r.action === 'continue' ? 'Continue' : r.action === 'change' ? 'Change' : 'Stop'} · {author(r.author_id)} · {new Date(r.created_at).toLocaleString()}</summary>
        <div className="space-y-2 pb-3"><p className="whitespace-pre-wrap break-words">{r.reasoning}</p>{r.changes && <p className="whitespace-pre-wrap break-words">Agreed changes — {r.changes}</p>}{r.next_review_date && <p>Next review · {r.next_review_date}</p>}
          <p className="font-medium">Basis at decision time · Plan v{r.snapshot.approach.plan_revision}</p><p className="whitespace-pre-wrap break-words">{r.snapshot.approach.expected_change} · {r.snapshot.approach.hypothesis}</p>
          {r.snapshot.conditions.map(c => <div key={c.id}><p className="font-medium">{c.title} · {RESULT_LABELS[conditionAssessment(c, r.snapshot.approach, r.snapshot.assessments).status]}</p><p className="text-muted-foreground">{c.success_criteria}</p></div>)}
          <details><summary className="cursor-pointer py-1">Evidence recorded at that time</summary>{r.snapshot.assessments.map(evidence)}</details>
          <div className="flex flex-wrap items-center gap-1"><span>Affected work</span>{[...new Set(r.snapshot.contributions.map(c => c.object_id))].map(objectButton)}</div>
          <Button variant="ghost" size="xs" onClick={() => host.onNavigate?.({ strategyId: a.strategy_id })}>Open Initiative to revisit intent</Button>
        </div>
      </details>)}</div>
    </section>;
  }
}

function editorIdentity(t: ApproachEditorTarget) {
  return `${t.kind}:${t.approach?.id ?? 'new'}:${'condition' in t ? t.condition?.id ?? 'new' : ''}:${'contribution' in t ? t.contribution?.id ?? 'new' : ''}`;
}
