'use client';

import { GitCompare, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from '@/ui/icons';
import type { CodeChange } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { CriterionVerdict, IntentVerdict, ReviewState } from '@/Function/codeReview/diffModel';

// The words and tones a code change is shown with — in the Element's list, on
// the Initiative, and in the review screen. Labels are English source strings
// for t().

/** The mark for code review as a whole (the rail, the Reviews page). */
export const CodeChangeIcon = GitCompare;

const STATE_ICON: Record<CodeChange['state'], { icon: typeof GitPullRequest; color: string }> = {
  open: { icon: GitPullRequest, color: 'text-[var(--status-success)]' },
  draft: { icon: GitPullRequestDraft, color: 'text-muted-foreground' },
  merged: { icon: GitMerge, color: 'text-[var(--accent-hover)]' },
  closed: { icon: GitPullRequestClosed, color: 'text-[var(--status-danger)]' },
};

/** One pull request's mark: its shape and colour say whether it is open, a
 *  draft, merged or closed. */
export function CodeChangeStateIcon({ state, size = 13, className = '' }: { state: CodeChange['state']; size?: number; className?: string }) {
  const { icon: Icon, color } = STATE_ICON[state] ?? STATE_ICON.open;
  return <Icon size={size} className={`shrink-0 ${color} ${className}`} />;
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[var(--status-success-subtle)] text-[var(--status-success)]',
  warning: 'bg-[var(--status-warning-subtle)] text-[var(--status-warning)]',
  danger: 'bg-[var(--status-danger-subtle)] text-[var(--status-danger)]',
  accent: 'bg-[var(--accent-subtle)] text-[var(--accent-hover)]',
  neutral: 'bg-[var(--surface-strong)] text-[var(--text-secondary)]',
};

const STATE_META: Record<CodeChange['state'], { label: string; tone: Tone }> = {
  open: { label: 'Open PR', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
  merged: { label: 'Merged', tone: 'accent' },
  closed: { label: 'Closed', tone: 'danger' },
};

export const INTENT_META: Record<IntentVerdict, { label: string; tone: Tone }> = {
  aligned: { label: 'Matches intent', tone: 'success' },
  partial: { label: 'Partly matches', tone: 'warning' },
  misaligned: { label: 'Off intent', tone: 'danger' },
  unclear: { label: 'Unclear', tone: 'neutral' },
};

export const CRITERION_META: Record<CriterionVerdict, { label: string; tone: Tone }> = {
  met: { label: 'Met', tone: 'success' },
  partial: { label: 'Partly', tone: 'warning' },
  not_met: { label: 'Not met', tone: 'danger' },
  contradicts: { label: 'Contradicts', tone: 'danger' },
  unclear: { label: 'Unclear', tone: 'neutral' },
};

export const TEAM_META: Record<ReviewState['overall'], { label: string; tone: Tone }> = {
  matches: { label: 'Team: as intended', tone: 'success' },
  needs_changes: { label: 'Team: needs changes', tone: 'danger' },
  pending: { label: 'Awaiting review', tone: 'neutral' },
};

/** What each kind of intent is called. */
export const INTENT_KIND_LABEL: Record<string, string> = {
  element: 'Element',
  subelement: 'Sub-element',
  master: 'Purpose',
  measure: 'Success condition',
  assumption: 'Assumption',
  decision: 'Decision',
};

export function Pill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function StatePill({ state }: { state: CodeChange['state'] }) {
  const { t } = useI18n();
  const meta = STATE_META[state] ?? STATE_META.open;
  return <Pill tone={meta.tone}>{t(meta.label)}</Pill>;
}

export function LineCounts({ additions, deletions, title }: { additions: number | null; deletions: number | null; title?: string }) {
  if (additions == null && deletions == null) return null;
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums" title={title}>
      <span className="text-[var(--status-success)]">+{additions ?? 0}</span>{' '}
      <span className="text-[var(--status-danger)]">−{deletions ?? 0}</span>
    </span>
  );
}
