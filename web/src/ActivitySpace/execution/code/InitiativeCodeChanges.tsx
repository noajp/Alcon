'use client';

import { useMemo, useState } from 'react';
import { PageSection } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { readIntentCheck, type IntentVerdict } from '@/Function/codeReview/diffModel';
import { useCodeChangesForElements } from '@/hooks/codeChangeData';
import { CodeChangeRow } from './CodeChangesSection';
import { CodeReviewDialog } from './CodeReviewDialog';
import { INTENT_META, Pill } from './codeChangeLabels';

// The code changes shipped by the work under a Strategy's Objects, each
// with the AI's verdict against the intent — so the Strategy's owner sees
// whether the software being built is the software that was meant, and opens
// the diff in one click. Hidden while there are none.

interface ObjectLike { id: string; elements?: { id: string; title: string; display_id?: string | null }[] | null }

export function InitiativeCodeChanges({ objects }: { objects: readonly ObjectLike[] }) {
  const { t } = useI18n();
  const elements = useMemo(() => objects.flatMap((o) => o.elements ?? []), [objects]);
  const titleOf = useMemo(() => new Map(elements.map((e) => [e.id, e.display_id || e.title])), [elements]);
  const { data: changes } = useCodeChangesForElements(elements.map((e) => e.id));
  const [openId, setOpenId] = useState<string | null>(null);
  const open = changes.find((c) => c.id === openId) ?? null;

  const counts = useMemo(() => {
    const out: Record<IntentVerdict | 'unchecked', number> = { aligned: 0, partial: 0, misaligned: 0, unclear: 0, unchecked: 0 };
    for (const c of changes) {
      if (c.state === 'closed') continue;
      const v = readIntentCheck(c.intent_check)?.verdict;
      out[v ?? 'unchecked'] += 1;
    }
    return out;
  }, [changes]);

  if (changes.length === 0) return null;

  return (
    <PageSection title={t('Code changes')} action={
      <div className="flex items-center gap-1.5">
        {(['misaligned', 'partial', 'aligned'] as const).filter((v) => counts[v] > 0).map((v) => (
          <Pill key={v} tone={INTENT_META[v].tone}>{t(INTENT_META[v].label)} {counts[v]}</Pill>
        ))}
        {counts.unchecked > 0 && <Pill tone="neutral">{t('Not checked')} {counts.unchecked}</Pill>}
      </div>
    }>
      <div>
        {changes.slice(0, 20).map((c) => (
          <CodeChangeRow key={c.id} change={c} onOpen={() => setOpenId(c.id)}
            context={<span className="max-w-40 shrink-0 truncate text-[12px] text-muted-foreground">{titleOf.get(c.element_id)}</span>} />
        ))}
      </div>
      {open && <CodeReviewDialog change={open} open onOpenChange={(v) => { if (!v) setOpenId(null); }} />}
    </PageSection>
  );
}
