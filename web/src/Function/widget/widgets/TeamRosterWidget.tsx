'use client';

import { useMemo } from 'react';
import type { ElementWithDetails } from '@/types/database';
import { unreachableMarkProps } from '@/Function/shared/workerReach';
import { UnreachableAvatarTooltip, WorkerAvatar } from '@/Function/shared/WorkerAvatar';
import { useI18n } from '@/Function/i18n/I18nProvider';

interface Props {
  elements: ElementWithDetails[];
}

interface MemberStats {
  id: string;
  name: string;
  role: string | null;
  type: 'human' | 'ai_agent' | 'robot';
  /** Null when the Worker has no account — the roster marks them, since a
   *  count of Elements "on" somebody nothing reaches is a different number. */
  user_id: string | null;
  total: number;
  done: number;
  active: number;
}

export function TeamRosterWidget({ elements }: Props) {
  const { t } = useI18n();
  const members = useMemo(() => {
    const map = new Map<string, MemberStats>();
    for (const el of elements) {
      const assignees = el.assignees || [];
      for (const a of assignees) {
        if (!a.worker) continue;
        const w = a.worker;
        if (!map.has(w.id)) {
          map.set(w.id, {
            id: w.id,
            name: w.name,
            role: w.role,
            type: w.type,
            user_id: w.user_id,
            total: 0,
            done: 0,
            active: 0,
          });
        }
        const m = map.get(w.id)!;
        m.total += 1;
        if (el.status === 'done') m.done += 1;
        else if (el.status === 'in_progress') m.active += 1;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [elements]);

  if (members.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">{t('No one is assigned yet.')}</p>;
  }

  // Flat rows: the Worker's own avatar, name and role, then done / total as
  // a quiet figure. The avatar keeps the unreachable mark it always had.
  return (
    <div className="max-h-[280px] overflow-y-auto -mx-2">
      {members.map((m) => {
        const mark = unreachableMarkProps(m, m.name);
        return (
          <div key={m.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40">
            <UnreachableAvatarTooltip worker={m} name={m.name}>
              <span
                className={`inline-flex shrink-0 rounded-full ${mark.ringClass}`}
                title={mark.title}
                tabIndex={mark.tabIndex}
                aria-label={mark.ariaLabel}
                data-unreachable={mark.unreachable}
              >
                <WorkerAvatar worker={m} size={24} />
              </span>
            </UnreachableAvatarTooltip>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-foreground">{m.name}</p>
              {m.role && <p className="truncate text-[11px] text-muted-foreground">{m.role}</p>}
            </div>
            <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              <div>{m.done} / {m.total}</div>
              {m.active > 0 && <div>{t('{n} active', { n: m.active })}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
