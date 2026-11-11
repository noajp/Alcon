'use client';

import { useMemo } from 'react';
import { ElementProgressMark } from '@/Function/shared/ElementProgressMark';
import { WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { useWorkers } from '@/hooks/teamData';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { statusLabel } from '@/shared/designTokens';
import type { ElementStatus } from '@/types/database';
import type { ElementListItem } from './chartSpec';

// Elements the AI lists in an answer, drawn as raised cards: the Status
// mark the rest of the app uses, the title, and who is on it as faces —
// never a table of ids. A name the Space does not know still shows, as
// its initial.

export function ChatElementList({ items }: { items: ElementListItem[] }) {
  const { t } = useI18n();
  const { data: workers } = useWorkers();
  const byName = useMemo(() => new Map((workers ?? []).map((w) => [w.name.trim().toLowerCase(), w])), [workers]);
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => {
        const people = item.assignees.map((n) => byName.get(n.toLowerCase()) ?? { name: n });
        return (
          <div key={`${item.title}-${i}`}
            className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 shadow-[var(--shadow-card)] dark:bg-[var(--surface-rail)]">
            <span className="flex shrink-0" title={t(statusLabel(item.status))}>
              <ElementProgressMark status={item.status as ElementStatus} size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-foreground" title={item.title}>{item.title}</span>
            {item.due && <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{item.due}</span>}
            {people.length > 0 && <WorkerAvatarStack workers={people} size={20} />}
          </div>
        );
      })}
    </div>
  );
}
