'use client';

import { useState } from 'react';
import { Bot, X } from '@/ui/icons';
import { PageSection } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { readIntentCheck } from '@/Function/codeReview/diffModel';
import { useCodeChangeActions, useCodeChanges } from '@/hooks/codeChangeData';
import type { CodeChange } from '@/types/database';
import { CodeChangeStateIcon, INTENT_META, LineCounts, Pill, StatePill } from './codeChangeLabels';
import { CodeReviewDialog } from './CodeReviewDialog';

// An Element's code changes: the pull requests that carry it out, linked by
// the agent working the Element through the Space's GitHub integration.
// Opening one shows its diff beside the intent it was built for.

export function CodeChangesSection({ elementId }: { elementId: string }) {
  const { t } = useI18n();
  const { data: changes } = useCodeChanges(elementId);
  const { unlink } = useCodeChangeActions(elementId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = changes.find((c) => c.id === openId) ?? null;

  // None linked: nothing on the page.
  if (changes.length === 0) return null;

  return (
    <PageSection title={t('Code changes')}>
      <div>
        {changes.map((c) => (
          <CodeChangeRow key={c.id} change={c} onOpen={() => setOpenId(c.id)}
            onUnlink={() => unlink.mutate(c.id)} />
        ))}
      </div>
      {open && <CodeReviewDialog change={open} open onOpenChange={(v) => { if (!v) setOpenId(null); }} />}
    </PageSection>
  );
}

export function CodeChangeRow({ change, onOpen, onUnlink, context }: {
  change: CodeChange; onOpen: () => void; onUnlink?: () => void;
  /** Shown before the title — e.g. the Element on a Strategy's list. */
  context?: React.ReactNode;
}) {
  const { t } = useI18n();
  const check = readIntentCheck(change.intent_check);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className="group/cc flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px] hover:bg-muted/40"
    >
      <CodeChangeStateIcon state={change.state} />
      {context}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{change.title || `${change.repo}#${change.number}`}</span>
      {change.linked_via === 'agent' && <span title={t('Opened by an agent')}><Bot size={12} className="shrink-0 text-muted-foreground" /></span>}
      <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">{change.repo.split('/')[1]}#{change.number}</span>
      <LineCounts additions={change.additions} deletions={change.deletions} />
      {check && <Pill tone={INTENT_META[check.verdict].tone}>{t(INTENT_META[check.verdict].label)}</Pill>}
      {change.ci_state && (
        change.ci_url ? (
          <a
            href={change.ci_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { e.stopPropagation(); }}
            title={t('Open the CI run')}
            className="shrink-0"
          >
            <Pill tone={change.ci_state === 'passed' ? 'success' : 'danger'}>{t(change.ci_state === 'passed' ? 'CI passed' : 'CI failed')}</Pill>
          </a>
        ) : (
          <Pill tone={change.ci_state === 'passed' ? 'success' : 'danger'}>{t(change.ci_state === 'passed' ? 'CI passed' : 'CI failed')}</Pill>
        )
      )}
      <StatePill state={change.state} />
      {onUnlink && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onUnlink(); }}
          aria-label={t('Unlink')}
          title={t('Unlink')}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover/cc:opacity-100 focus-visible:opacity-100"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
