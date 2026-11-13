'use client';

import { useMemo, useState } from 'react';
import { PageSection } from '@/Function/shared/PageHead';
import { EmptyState } from '@/Function/shared/EmptyState';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatRelative } from '@/Function/shared/dateUtils';
import { FAILURE_COMPENSATE_LABEL, FAILURE_ESCALATE_LABEL, FAILURE_SOURCE_LABEL } from '@/Function/audit/auditModel';
import { OUTCOME_CAP, useStrategyEvaluation } from '@/hooks/strategyEvaluationData';
import {
  buildEvaluation,
  DEFAULT_EVALUATION_PERIOD,
  EVALUATION_PERIODS,
  type ArtifactSize,
  type DeliverableEvaluation,
  type ElementEvaluation,
  type EvaluationPeriod,
  type ObjectEvaluation,
  type Rate,
  type WorstRun,
} from './evaluationModel';
import { Stat } from './mission/MissionPanels';
import { EvaluationTrend } from './EvaluationTrend';

// The Strategy's Evaluation tab: a scrolling report over the records its
// finished runs already left (design: clayware-evaluation-tab-design §6).
// Aggregation is the pure evaluationModel's, by ELEMENT SET; this panel
// is presentation only. The surface shows verdicts and evidence — the
// minimum needed to judge — never raw error objects; a run's full step
// record is on its Element.
// The Overview's Evaluate panel (MissionEvaluatePanel) is untouched.
// Deliverable size is labelled as size wherever it renders (character
// counts, a "Short" flag) — never as quality, never a score (D8).
// PR3 adds the verifier's v3 scoring beside it: per-Checks-item
// results and per-artifact depth (substantial | thin | empty, the
// verifier's judgement with its one-line note) — shown only where a
// v3 verdict actually scored them; a period with no scored runs shows
// no scoring blocks at all (absence, not zero).

const PERIOD_LABEL: Record<EvaluationPeriod, string> = {
  '7d': '7 days',
  '28d': '28 days',
  '90d': '90 days',
  all: 'All',
};

/** The v3 depth vocabulary, as display labels (i18n keys). */
const DEPTH_LABEL: Record<string, string> = {
  substantial: 'Substantial',
  thin: 'Thin',
  empty: 'Empty',
};

function pct(rate: Rate): string | null {
  return rate.rate === null ? null : `${Math.round(rate.rate * 100)}%`;
}

/** A rate card's value: the rate when its denominator earns one, else
 *  the raw counts with the withholding said out loud. */
function rateValue(rate: Rate, counts: string): string {
  return pct(rate) ?? counts;
}

export function StrategyEvaluationPanel({ objects }: {
  /** The Strategy's Objects with their Elements (missionProps' shape). */
  objects: { id: string; name: string; elements?: { id: string; title: string; display_id?: string | null }[] }[];
}) {
  const { t } = useI18n();
  const [period, setPeriod] = useState<EvaluationPeriod>(DEFAULT_EVALUATION_PERIOD);
  const elementIds = useMemo(
    () => [...new Set(objects.flatMap((o) => (o.elements ?? []).map((e) => e.id)))],
    [objects],
  );
  const { data, loading } = useStrategyEvaluation(elementIds, period);
  const [now] = useState(() => Date.now());
  const report = useMemo(() => buildEvaluation({
    objects: objects.map((o) => ({
      id: o.id,
      name: o.name,
      elements: (o.elements ?? []).map((e) => ({ id: e.id, title: e.title, display_id: e.display_id ?? null })),
    })),
    outcomes: data.outcomes,
    runs: data.runs,
    artifacts: data.artifacts,
    calibrations: data.calibrations,
    candidates: data.candidates,
    tests: data.tests,
    definitionNames: data.definitionNames,
    period,
    now,
  }), [objects, data, period, now]);

  const [openObject, setOpenObject] = useState<string | null>(null);
  const [openElement, setOpenElement] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);

  const h = report.headline;
  const signalled = h.accepted + h.rejected + h.rework;

  return (
    <div className="space-y-6">
      {/* Period — a segmented control; periods are the tab's own, not
          the rollup windows (there is no Strategy rollup scope). */}
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border/60 p-0.5" role="group" aria-label={t('Period')}>
          {EVALUATION_PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={`h-6 rounded px-2.5 text-[12px] font-medium transition-colors ${period === p ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {t(PERIOD_LABEL[p])}
            </button>
          ))}
        </div>
        {data.truncated && (
          <span className="text-[11px] text-muted-foreground">{t('Showing the latest {n} finishes', { n: OUTCOME_CAP.toLocaleString() })}</span>
        )}
      </div>

      {loading ? (
        <p className="text-[13px] text-muted-foreground">{t('Loading…')}</p>
      ) : h.finishes === 0 ? (
        <EmptyState art="initiative"
          title="No evaluation records yet"
          description="Evaluation reads finished runs and the judgements people made about them. Nothing has finished in this period yet." />
      ) : (
        <>
          {/* Headline — six cards, each naming its denominator. Rates
              render only at n >= 5 (evaluationModel's RATE_MIN_N). */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label={t('Finishes')} value={String(h.finishes)}
              sub={t('{completed} completed · {partial} partial · {blocked} blocked', { completed: h.completed, partial: h.partial, blocked: h.blocked })} />
            <Stat label={t('Verifier pass rate')}
              value={rateValue(h.passRate, `${h.pass} / ${h.pass + h.fail}`)}
              sub={h.passRate.rate === null
                ? t('Only {n} checked — no rate yet', { n: h.pass + h.fail })
                : t('{n} finishes were not checked', { n: h.unchecked })} />
            <Stat label={t('Human agreement')}
              value={rateValue(h.agreementRate, `${h.accepted} / ${signalled}`)}
              sub={h.agreementRate.rate === null
                ? t('Only {n} judged — no rate yet', { n: signalled })
                : t('{n} still waiting for a person’s judgement (up to 35 days)', { n: h.unsignalled })} />
            <Stat label={t('Send-backs')}
              value={rateValue(h.sendBackRate, String(h.rework))}
              sub={t('{n} sent back for rework', { n: h.rework })} />
            <Stat label={t('Top failure')}
              value={h.topFailure ? h.topFailure.failureClass : '—'}
              sub={t('{n} finishes failed', { n: h.failedFinishes })} />
            <Stat label={t('Cost per accepted finish')}
              value={h.costPerAccepted === null ? '—' : `$${h.costPerAccepted.toFixed(2)}`}
              sub={t('Total spend {amount}', { amount: `$${h.costUsd.toFixed(2)}` })} />
            {/* PR3, headline-adjacent: the thin/empty deliverable count
                exists only once a v3 verdict has scored a run in this
                period — before that the card is absent, not zero. */}
            {h.scoring.scoredRuns > 0 && (
              <Stat label={t('Thin deliverables')}
                value={String(h.scoring.thinDeliverables)}
                sub={t('Judged thin or empty by the verifier, of {n} scored finishes', { n: h.scoring.scoredRuns })} />
            )}
          </div>

          {/* Per-Checks-item results (PR3): the definitions' declared
              bars, worst first — present only when a scored run in
              period carried item results. */}
          {report.checksItems.length > 0 && (
            <PageSection title={t('Checks items')}>
              <ul className="space-y-1 text-[13px]">
                {report.checksItems.map((c) => (
                  <li key={c.item} className="flex items-center gap-2">
                    <span className="flex-1 text-foreground">{c.item}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('Passed {pass} · Partial {partial} · Failed {fail}', { pass: c.pass, partial: c.partial, fail: c.fail })}
                    </span>
                  </li>
                ))}
              </ul>
            </PageSection>
          )}

          <EvaluationTrend buckets={report.trend} />

          {/* Failure mix, in full. */}
          {h.failureMix.length > 0 && (
            <PageSection title={t('Failure mix')}>
              <ul className="space-y-1 text-[13px]">
                {h.failureMix.map((m) => (
                  <li key={m.failureClass} className="flex items-center gap-2">
                    <span className="flex-1 text-foreground">{m.failureClass}</span>
                    <span className="tabular-nums text-muted-foreground">{m.count}</span>
                  </li>
                ))}
              </ul>
            </PageSection>
          )}

          {/* Per-Object rows, worst first (evaluationModel's named sort). */}
          <PageSection title={t('Objects')}>
            <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
              {report.objects.map((o) => (
                <ObjectRow key={o.objectId} object={o}
                  open={openObject === o.objectId}
                  onToggle={() => setOpenObject(openObject === o.objectId ? null : o.objectId)}
                  openElement={openElement}
                  onToggleElement={(id) => setOpenElement(openElement === id ? null : id)}
                  openRun={openRun}
                  onToggleRun={(id) => setOpenRun(openRun === id ? null : id)}
                  />
              ))}
            </ul>
          </PageSection>

          {/* Definitions at work — calibration and test state for the
              definitions this Strategy's runs actually used. Resolving
              a candidate stays in the Harnesses drill-down; this block
              only flags it. */}
          {report.definitions.length > 0 && (
            <PageSection title={t('Definitions at work')}>
              <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
                {report.definitions.map((d) => (
                  <li key={d.definitionId} className="px-3 py-2.5 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{d.name}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {t('{n} finishes', { n: d.finishes })}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                      <div>{t('Passed {pass} · Failed {fail} · Unchecked {unchecked}', { pass: d.pass, fail: d.fail, unchecked: d.unchecked })}</div>
                      {d.calibration && (
                        <div>{t('Calibration: {pairs} pairs · false pass {fp} · false fail {ff}', {
                          pairs: d.calibration.pairs, fp: d.calibration.falsePass, ff: d.calibration.falseFail,
                        })}</div>
                      )}
                      {d.candidate && (
                        <div className="text-foreground/80">{t('Revision candidate open: {reason}', { reason: d.candidate.reason })}</div>
                      )}
                      {d.tests.total > 0 && (
                        <div>{t('Tests: {passing} passing · {failing} failing · {stale} stale', {
                          passing: d.tests.passing, failing: d.tests.failing, stale: d.tests.stale,
                        })}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </PageSection>
          )}

          {/* Deliverables — the period's artifacts across the Strategy,
              worst-first by size signal then recency (the model's named
              order). The block is omitted when the period produced
              none. Size is stated as size; the verifier's judgement
              appears only where its evidence names the artifact. */}
          {report.deliverables.length > 0 && (
            <PageSection title={t('Deliverables')}>
              <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
                {report.deliverables.map((d) => (
                  <DeliverableRow key={d.artifact.id} deliverable={d}
                    open={openArtifact === d.artifact.id}
                    onToggle={() => setOpenArtifact(openArtifact === d.artifact.id ? null : d.artifact.id)} />
                ))}
              </ul>
            </PageSection>
          )}
        </>
      )}
    </div>
  );
}

/** The size signal as text: characters, the markdown section count
 *  when there is one, and the Short flag when the size is below the
 *  format's floor. Size words only — never a quality word. */
function ArtifactSizeText({ size }: { size: ArtifactSize }) {
  const { t } = useI18n();
  return (
    <span className="shrink-0 tabular-nums">
      {t('{n} characters', { n: size.chars.toLocaleString() })}
      {size.sections !== null ? ` · ${t('{n} sections', { n: size.sections })}` : ''}
      {size.short ? <> · <span className="text-foreground/80">{t('Short')}</span></> : ''}
    </span>
  );
}

/** The verifier evidence linked to one artifact: the verdict of the
 *  run whose evidence names it, with that verdict's gaps — the
 *  verifier's own words about a deliverable it actually read. Renders
 *  nothing when no verdict names the artifact. */
function ArtifactVerifier({ deliverable: d }: { deliverable: DeliverableEvaluation }) {
  const { t } = useI18n();
  if (!d.verifier) return null;
  return (
    <div>
      <div className="text-foreground">{t('Shown to the verifier')} · {t('Verdict')}: {d.verifier.result}</div>
      {d.verifier.gaps.map((g, i) => <div key={i}>• {g}</div>)}
    </div>
  );
}

/** The verifier's depth judgement on one artifact (PR3): the depth
 *  word, and — when `withNote` — its one-line reason. Renders nothing
 *  when the producing verdict did not judge this artifact. Depth is a
 *  judgement word, stated beside (never merged with) the size text. */
function ArtifactDepth({ deliverable: d, withNote }: { deliverable: DeliverableEvaluation; withNote?: boolean }) {
  const { t } = useI18n();
  if (!d.depth) return null;
  return (
    <span>
      {t('Depth')}: {t(DEPTH_LABEL[d.depth.depth] ?? d.depth.depth)}
      {withNote && d.depth.note ? ` — ${d.depth.note}` : ''}
    </span>
  );
}

function DeliverableRow({ deliverable: d, open, onToggle }: {
  deliverable: DeliverableEvaluation;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <li className="px-3 py-2">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{d.artifact.title}</span>
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">{d.elementTitle}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{d.artifact.format}</span>
        {d.depth && (
          <span className="shrink-0 text-[11px] text-foreground/80">{t(DEPTH_LABEL[d.depth.depth] ?? d.depth.depth)}</span>
        )}
        <span className="shrink-0 text-[11px] text-muted-foreground"><ArtifactSizeText size={d.size} /></span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatRelative(d.artifact.updated_at)}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-[12px] text-muted-foreground">
          {d.depth && <div><ArtifactDepth deliverable={d} withNote /></div>}
          <ArtifactVerifier deliverable={d} />
          {/* The content itself, rendered as the Overview's Deliverables
              panel renders it (#7: one rendering, two homes). */}
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-muted)] p-2.5 text-[12px] text-foreground">{d.artifact.content}</pre>
        </div>
      )}
    </li>
  );
}

function ObjectRow({ object: o, open, onToggle, openElement, onToggleElement, openRun, onToggleRun }: {
  object: ObjectEvaluation;
  open: boolean;
  onToggle: () => void;
  openElement: string | null;
  onToggleElement: (id: string) => void;
  openRun: string | null;
  onToggleRun: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <li className="px-3 py-2">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{o.name}</span>
        {o.finishes === 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground/60">—</span>
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {t('{n} finishes', { n: o.finishes })}
            {pct(o.passRate) ? ` · ${t('pass')} ${pct(o.passRate)}` : ''}
            {` · ${t('Send-backs')} ${o.rework}`}
            {o.topFailureClass ? ` · ${o.topFailureClass}` : ''}
            {` · $${o.costUsd.toFixed(2)}`}
          </span>
        )}
      </button>
      {open && o.elements.map((e) => (
        <ElementRow key={e.elementId} element={e}
          open={openElement === e.elementId}
          onToggle={() => onToggleElement(e.elementId)}
          openRun={openRun} onToggleRun={onToggleRun} />
      ))}
    </li>
  );
}

function ElementRow({ element: e, open, onToggle, openRun, onToggleRun }: {
  element: ElementEvaluation;
  open: boolean;
  onToggle: () => void;
  openRun: string | null;
  onToggleRun: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="ml-3 mt-1.5 border-l border-border/50 pl-3">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
          {e.displayId ? `${e.displayId} ` : ''}{e.title}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {e.finishes === 0 ? '—' : t('{pass} passed · {fail} failed · {unchecked} unchecked · {revisions} revisions', {
            pass: e.pass, fail: e.fail, unchecked: e.unchecked, revisions: e.revisions,
          })}
          {e.lastFinishedAt ? ` · ${formatRelative(e.lastFinishedAt)}` : ''}
        </span>
      </button>
      {open && e.worstRuns.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {e.worstRuns.map((r) => (
            <WorstRunRow key={r.outcomeId} run={r}
              open={openRun === r.runId}
              onToggle={() => onToggleRun(r.runId)}
              />
          ))}
        </ul>
      )}
      {open && e.worstRuns.length === 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground">{t('No runs need a second look in this period.')}</p>
      )}
    </div>
  );
}

function WorstRunRow({ run: r, open, onToggle }: {
  run: WorstRun;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const verdict = r.run?.verdict;
  const detail = r.run?.finishDetail;
  const failure = r.run?.failureDetail;
  return (
    <li className="rounded-md bg-[var(--surface-muted)] px-2.5 py-2 text-[12px]">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1 truncate text-foreground">
          {r.verdictResult ?? t('Unchecked')} · {r.humanSignal} · {formatRelative(r.finishedAt)}
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">${r.costUsd.toFixed(2)}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 text-muted-foreground">
          {verdict && (
            <div>
              <div className="text-foreground">
                {t('Verdict')}: {verdict.result}
                {verdict.checkedAt ? ` · ${formatRelative(verdict.checkedAt)}` : ''}
                {` · ${t('{n} revisions', { n: verdict.revisions })}`}
              </div>
              {verdict.gaps.map((g, i) => <div key={i}>• {g}</div>)}
              {/* PR3: this run's per-item results, in the definition's
                  declaration order, as sealed. */}
              {verdict.checks && verdict.checks.length > 0 && (
                <div>
                  <div className="text-foreground">{t('Checks items')}</div>
                  {verdict.checks.map((c) => (
                    <div key={c.item}>• {c.item}: {c.result}</div>
                  ))}
                </div>
              )}
              {verdict.claims && (
                <div>{t('Claims: {sourced} of {total} sourced · {stale} stale', {
                  sourced: verdict.claims.sourced, total: verdict.claims.total, stale: verdict.claims.stale,
                })}</div>
              )}
              {verdict.verify && verdict.verify.mismatched > 0 && (
                <div>{t('Read-backs: {mismatched} of {checked} writes did not match', {
                  mismatched: verdict.verify.mismatched, checked: verdict.verify.checked,
                })}</div>
              )}
            </div>
          )}
          {detail && detail.unconfirmed.length > 0 && (
            <div>
              <div className="text-foreground">{t('Unconfirmed')}</div>
              {detail.unconfirmed.map((u, i) => <div key={i}>• {u}</div>)}
            </div>
          )}
          {failure && (
            <div>
              <div className="text-foreground">{t('Failure')}: {failure.failureClass}</div>
              <div>
                {t(FAILURE_COMPENSATE_LABEL[failure.compensate.policy] ?? failure.compensate.policy)}
                {' · '}
                {t('from {source}', { source: t(FAILURE_SOURCE_LABEL[failure.compensate.source] ?? failure.compensate.source) })}
                {failure.escalate ? ` · ${t('Escalates to {target}', { target: t(FAILURE_ESCALATE_LABEL[failure.escalate.target] ?? failure.escalate.target) })}` : ''}
              </div>
            </div>
          )}
          {r.artifacts.length > 0 && (
            <div>
              <div className="text-foreground">{t('Deliverables')}</div>
              {r.artifacts.map((d) => (
                <div key={d.artifact.id}>
                  • {d.artifact.title} ({d.artifact.format}) · <ArtifactSizeText size={d.size} />
                  {/* The run's gaps render at run level above; here the
                      row only marks that the verifier was shown THIS
                      artifact and what it returned. The Deliverables
                      block carries the gaps on the artifact row. */}
                  {d.verifier ? ` · ${t('Shown to the verifier')}: ${d.verifier.result}` : ''}
                  {/* PR3: the depth judgement on this artifact, beside
                      its size — the note lives on the Deliverables row. */}
                  {d.depth ? <> · <ArtifactDepth deliverable={d} /></> : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
