'use client';

import { useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useAuthContext } from '@/providers/AuthProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import type { InboxBucket } from '@/Function/codeReview/diffModel';
import { useReviewInbox } from '@/hooks/codeChangeData';
import type { NavigationState } from '@/types/navigation';
import { CodeChangeStateIcon } from './codeChangeLabels';

// The Reviews mode's sidebar: the Space's pull requests in the inbox's four
// groups, each row marked by its state. Picking one opens its review in the
// main pane; Overview goes back to the page that connects GitHub.

const GROUPS: { id: InboxBucket; label: string; folded?: boolean }[] = [
  { id: 'review', label: 'Needs your review' },
  { id: 'mine', label: 'Yours' },
  { id: 'open', label: 'Other open' },
  { id: 'done', label: 'Merged and closed', folded: true },
];

export function ReviewsSidebar({ navigation, onNavigate, onOpen }: {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuthContext();
  const inbox = useReviewInbox(useActiveSpaceId(), user?.id ?? null);
  const [folded, setFolded] = useState<Set<InboxBucket>>(() => new Set(GROUPS.filter((g) => g.folded).map((g) => g.id)));
  const selected = navigation.codeChangeId ?? null;

  const open = (id: string | null) => { onNavigate({ codeChangeId: id }); onOpen(); };
  const toggle = (id: InboxBucket) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <>
      <SidebarSectionLabel>{t('Reviews')}</SidebarSectionLabel>
      <SidebarRow active={!selected} icon={<LayoutGrid size={16} />} label={t('Overview')} onClick={() => open(null)} />
      {GROUPS.map((g) => {
        const rows = inbox.data.filter((e) => e.bucket === g.id);
        if (rows.length === 0 && g.id !== 'review') return null;
        const isFolded = folded.has(g.id);
        return (
          <div key={g.id}>
            <button type="button" onClick={() => toggle(g.id)} aria-expanded={!isFolded}
              className="mt-4 mb-0.5 flex h-7 w-full items-center gap-1 px-2.5 text-left text-[12px] font-medium text-muted-foreground/80 hover:text-foreground">
              <DisclosureTriangle open={!isFolded} />
              <span className="flex-1 truncate">{t(g.label)}</span>
              {rows.length > 0 && <span className="text-[11px] tabular-nums">{rows.length}</span>}
            </button>
            {!isFolded && rows.length === 0 && (
              <p className="px-2.5 py-1 text-[12px] text-muted-foreground/70">{t('Nothing is waiting on your review.')}</p>
            )}
            {!isFolded && rows.slice(0, 50).map(({ change, element }) => (
              <SidebarRow key={change.id} active={selected === change.id}
                icon={<CodeChangeStateIcon state={change.state} size={14} />}
                label={change.title || `${change.repo}#${change.number}`}
                title={`${change.title}\n${change.repo}#${change.number}${element ? ` · ${element.display_id ?? element.title}` : ''}`}
                onClick={() => open(change.id)} />
            ))}
          </div>
        );
      })}
    </>
  );
}
