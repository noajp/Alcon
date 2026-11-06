'use client';

import { useState } from 'react';
import { AlertTriangle, Github, HelpCircle, RefreshCw, Sparkles } from '@/ui/icons';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { formatAge } from '@/Function/shared/dateUtils';
import { formatDisplayName, getCachedDisplayNames } from '@/Function/settings/preferencesStore';
import { FONT } from '@/shared/designTokens';
import { isCheckStale, readIntentCheck, reviewState, type ReviewVerdict } from '@/Function/codeReview/diffModel';
import { useCodeChangeReviews, useElementIntent, useRetryPublish, useSubmitCodeReview } from '@/hooks/codeChangeData';
import type { CodeChange } from '@/types/database';
import { CRITERION_META, INTENT_KIND_LABEL, INTENT_META, Pill, TEAM_META } from './codeChangeLabels';

// The right-hand column of the review screen: what the change was meant to
// do (the Element and its Strategies' intent), the AI's reading of whether
// the diff does it, and the team's verdicts. The point of the screen is this
// column — the diff is the evidence.

interface Props {
  change: CodeChange;
  onCheck: () => void;
  checking: boolean;
  checkError: string | null;
  onOpenFile: (path: string) => void;
}

export function IntentPanel({ change, onCheck, checking, checkError, onOpenFile }: Props) {
  const { t } = useI18n();
  const intent = useElementIntent(change.element_id);
  const check = readIntentCheck(change.intent_check);
  const stale = isCheckStale(check, change.head_sha);

  return (
    <div className="space-y-6 p-4">
      {/* What it was for */}
      <section className="space-y-2">
        <h3 className={FONT.label}>{t('Intent')}</h3>
        {intent.isPending && <p className="text-[12px] text-muted-foreground">{t('Loading…')}</p>}
        {intent.data && (
          <>
            <div>
              <div className="text-[13px] font-medium text-foreground">
                {intent.data.element.display_id && <span className="mr-1.5 font-mono text-[11px] text-muted-foreground">{intent.data.element.display_id}</span>}
                {intent.data.element.title}
              </div>
              {intent.data.element.description?.trim() && (
                <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-[12px] text-[var(--text-secondary)]">{intent.data.element.description}</p>
              )}
              {intent.data.subElements.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {intent.data.subElements.map((s, i) => (
                    <li key={i} className="flex gap-1.5 text-[12px] text-[var(--text-secondary)]">
                      <span className="text-muted-foreground">{s.done ? '☑' : '☐'}</span>{s.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {intent.data.initiatives.length === 0 && (
              <p className="text-[12px] text-muted-foreground">{t('This Element’s Object serves no Strategy, so only the Element itself is the intent.')}</p>
            )}
            {intent.data.initiatives.map((ini) => (
              <div key={ini.id} className="rounded-md bg-[var(--surface-raised)] p-2.5">
                <div className="text-[12px] font-medium text-foreground">{ini.name}</div>
                {ini.description?.trim() && <p className="mt-0.5 line-clamp-3 text-[12px] text-[var(--text-secondary)]">{ini.description}</p>}
                {ini.intents.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {ini.intents.map((x) => (
                      <li key={x.id} className="text-[12px]">
                        <span className="mr-1.5 text-[11px] text-muted-foreground">{t(INTENT_KIND_LABEL[x.kind] ?? 'Decision')}</span>
                        <span className="text-foreground">{x.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </>
        )}
      </section>

      {/* The AI's reading */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className={FONT.label}>{t('Intent check')}</h3>
          <div className="flex-1" />
          <Button variant={check ? 'ghost' : 'primary'} size="xs" onClick={onCheck} disabled={checking}>
            <Sparkles size={12} />{checking ? t('Checking…') : check ? t('Check again') : t('Check against intent')}
          </Button>
        </div>
        {checkError && <p className="text-[12px] text-[var(--status-danger)]">{checkError}</p>}
        {!check && !checking && (
          <p className="text-[12px] text-muted-foreground">{t('AI reads the diff against the intent above and says, criterion by criterion, whether the change carries it out.')}</p>
        )}
        {check && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={INTENT_META[check.verdict].tone}>{t(INTENT_META[check.verdict].label)}</Pill>
              {check.at && <span className="text-[11px] text-muted-foreground">{formatAge(check.at, true)}</span>}
              {stale && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--status-warning)]">
                  <AlertTriangle size={11} />{t('New commits since this check')}
                </span>
              )}
            </div>
            {check.summary && <p className="text-[12px] text-foreground">{check.summary}</p>}
            {check.criteria.length > 0 && (
              <ul className="space-y-2">
                {check.criteria.map((c, i) => (
                  <li key={i} className="text-[12px]">
                    <div className="flex items-start gap-2">
                      <Pill tone={CRITERION_META[c.verdict].tone}>{t(CRITERION_META[c.verdict].label)}</Pill>
                      <div className="min-w-0 flex-1">
                        <div className="text-foreground">
                          <span className="mr-1 text-[11px] text-muted-foreground">{t(INTENT_KIND_LABEL[c.kind] ?? 'Element')}</span>
                          {c.intent}
                        </div>
                        {c.evidence && <p className="mt-0.5 text-[var(--text-secondary)]">{c.evidence}</p>}
                        {c.files.length > 0 && (
                          <div className="mt-0.5 flex flex-wrap gap-x-2">
                            {c.files.map((f) => (
                              <button key={f} type="button" onClick={() => onOpenFile(f)} className="font-mono text-[11px] text-[var(--accent-hover)] hover:underline">
                                {f.split('/').pop()}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {check.outOfScope.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('Outside the intent')}</div>
                <ul className="space-y-1">
                  {check.outOfScope.map((o, i) => (
                    <li key={i} className="text-[12px]">
                      <button type="button" onClick={() => onOpenFile(o.path)} className="font-mono text-[11px] text-[var(--accent-hover)] hover:underline">{o.path}</button>
                      <span className="ml-1.5 text-[var(--text-secondary)]">{o.note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {check.questions.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] text-muted-foreground">{t('For the team to confirm')}</div>
                <ul className="space-y-1">
                  {check.questions.map((q, i) => (
                    <li key={i} className="flex gap-1.5 text-[12px] text-foreground"><HelpCircle size={12} className="mt-0.5 shrink-0 text-muted-foreground" />{q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <TeamVerdicts change={change} />
    </div>
  );
}

function TeamVerdicts({ change }: { change: CodeChange }) {
  const { t } = useI18n();
  const { user, profile } = useAuthContext();
  const reviews = useCodeChangeReviews(change.id);
  const submit = useSubmitCodeReview(change.id);
  const retry = useRetryPublish(change.id);
  const [note, setNote] = useState('');
  const state = reviewState(reviews.data ?? [], change.head_sha);
  // What was said, and any verdict that did not reach GitHub.
  const notes = (reviews.data ?? []).filter((r) => r.body.trim() || r.github_error).slice(-8).reverse();

  const send = (verdict: ReviewVerdict) => {
    if (verdict === 'comment' && !note.trim()) return;
    submit.mutate(
      { verdict, body: note.trim(), head_sha: change.head_sha, reviewer_name: formatDisplayName(profile?.display_name, user?.email, getCachedDisplayNames()) },
      { onSuccess: () => setNote('') },
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={FONT.label}>{t('Team review')}</h3>
        <div className="flex-1" />
        <Pill tone={TEAM_META[state.overall].tone}>{t(TEAM_META[state.overall].label)}</Pill>
      </div>
      <p className="text-[12px] text-muted-foreground">{t('Does this software do what was intended? Each person’s latest verdict counts; a verdict on an older commit stops counting when new commits arrive.')}</p>
      <p className="text-[12px] text-muted-foreground">{t('Verdicts and line comments are also posted to the pull request on GitHub.')}</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={t('What matches or misses the intent…')}
        className="w-full resize-none rounded-md bg-[var(--surface-strong)] px-2 py-1.5 text-[12px] outline-none"
      />
      {submit.error && <p className="text-[12px] text-[var(--status-danger)]">{(submit.error as Error).message}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" size="xs" disabled={submit.isPending} onClick={() => send('matches')}>{t('As intended')}</Button>
        <Button variant="danger" size="xs" disabled={submit.isPending} onClick={() => send('needs_changes')}>{t('Needs changes')}</Button>
        <Button variant="ghost" size="xs" disabled={submit.isPending || !note.trim()} onClick={() => send('comment')}>{t('Comment')}</Button>
      </div>
      {state.latest.length > 0 && (
        <ul className="space-y-1 pt-1">
          {state.latest.map((r) => (
            <li key={r.reviewer_id} className={`flex items-center gap-2 text-[12px] ${r.stale ? 'opacity-60' : ''}`}>
              <span className="min-w-0 flex-1 truncate text-foreground">{r.reviewer_name ?? t('Unknown')}</span>
              {r.stale && <span className="text-[11px] text-muted-foreground">{t('older commit')}</span>}
              <Pill tone={r.verdict === 'matches' ? 'success' : 'danger'}>{r.verdict === 'matches' ? t('As intended') : t('Needs changes')}</Pill>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="space-y-2 border-t border-[var(--border-default)] pt-2">
          {notes.map((r) => (
            <li key={r.id} className="text-[12px]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{r.reviewer_name ?? t('Unknown')}</span>
                <span className="text-[11px] text-muted-foreground">{formatAge(r.created_at, true)}</span>
                {r.github_review_id != null && <span className="text-muted-foreground" title={t('Posted to GitHub')}><Github size={11} /></span>}
                {r.github_error && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[var(--status-warning)]" title={r.github_error}>
                    <AlertTriangle size={11} />{t('Not on GitHub')}
                    {r.reviewer_id === user?.id && (
                      <button type="button" onClick={() => retry.mutate({ reviewId: r.id })} disabled={retry.isPending}
                        className="inline-flex items-center gap-0.5 text-[var(--accent-hover)] hover:underline">
                        <RefreshCw size={10} />{t('Retry')}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {r.body.trim() && <p className="whitespace-pre-wrap text-[var(--text-secondary)]">{r.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
