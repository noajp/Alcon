'use client';

import { useMemo } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { fetchMyElements } from '@/hooks/myElementsData';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { ActionIcon } from '@/Function/shared/elementAction';
import { isElementAction, isHumanAction } from '@/Function/shared/elementActionKinds';
import { formatDateOnly, formatRelative, isOverdue, daysUntil } from '@/Function/shared/dateUtils';
import { requestElementDetail } from '@/Function/shared/element/elementDetailRequest';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { NavigationState } from '@/types/navigation';

// A person's Overview: what matters about their work right now, read from the
// Elements assigned to them. One line of summary, what waits on them, what is
// coming up, and what they finished lately — each row opens its Element.

const OPEN = (e: ElementWithDetails) => e.status !== 'done' && e.status !== 'cancelled';

function Row({ el, right, onOpen }: { el: ElementWithDetails; right?: React.ReactNode; onOpen: (el: ElementWithDetails) => void }) {
  const action = isElementAction(el.action) ? el.action : null;
  return (
    <li>
      <button type="button" onClick={() => onOpen(el)}
        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-foreground/[0.04]">
        <ElementProgressMark size={14} status={el.status} progress={getElementProgress(el)} />
        {action && <ActionIcon action={action} size={13} />}
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{el.title}</span>
        {right && <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{right}</span>}
      </button>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function ProfileOverview({ userId, onNavigate, onViewChange }: {
  userId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t, locale } = useI18n();
  // The same cache as My Elements, so switching tabs reads it once.
  const mine = useQuery({
    queryKey: ['my-elements', userId] as const,
    queryFn: () => fetchMyElements(userId!),
    enabled: !!userId,
    placeholderData: keepPreviousData,
  });
  const elements = useMemo(() => mine.data?.elements ?? [], [mine.data]);

  const view = useMemo(() => {
    const open = elements.filter(OPEN);
    const overdue = open.filter((e) => isOverdue(e.due_date));
    const thisWeek = open.filter((e) => e.due_date && !isOverdue(e.due_date) && daysUntil(e.due_date) <= 7);
    const yourTurn = open.filter((e) => isElementAction(e.action) && isHumanAction(e.action));
    const comingUp = open.filter((e) => e.due_date && !isOverdue(e.due_date))
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? '')).slice(0, 6);
    const finished = elements.filter((e) => e.status === 'done')
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '')).slice(0, 6);
    return { open, overdue, thisWeek, yourTurn, comingUp, finished };
  }, [elements]);

  const openElement = (el: ElementWithDetails) => {
    requestElementDetail(el.id);
    onNavigate({ objectId: el.object_id ?? null });
    onViewChange?.('objects');
  };

  if (!userId || mine.isPending) return <p role="status" className="px-2 text-[13px] text-muted-foreground">{t('Loading…')}</p>;

  return (
    <div className="space-y-8">
      <Section title={t('Summary')}>
        <p className="px-2 text-[13px] leading-6 text-foreground/90">
          {t('{open} open Elements · {overdue} overdue · {week} due this week · {turn} waiting on your judgment', {
            open: view.open.length, overdue: view.overdue.length, week: view.thisWeek.length, turn: view.yourTurn.length,
          })}
        </p>
      </Section>

      {(view.overdue.length > 0 || view.yourTurn.length > 0) && (
        <Section title={t('Needs you')}>
          <ul>
            {[...view.overdue, ...view.yourTurn.filter((e) => !view.overdue.includes(e))].slice(0, 8).map((el) => (
              <Row key={el.id} el={el} onOpen={openElement}
                right={el.due_date && isOverdue(el.due_date) ? <span className="text-[var(--status-danger)]">{formatDateOnly(el.due_date, locale)}</span> : null} />
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('Coming up')}>
        {view.comingUp.length === 0
          ? <p className="px-2 text-[13px] text-muted-foreground">{t('Nothing due ahead.')}</p>
          : <ul>{view.comingUp.map((el) => <Row key={el.id} el={el} onOpen={openElement} right={formatDateOnly(el.due_date, locale)} />)}</ul>}
      </Section>

      <Section title={t('Activity')}>
        {view.finished.length === 0
          ? <p className="px-2 text-[13px] text-muted-foreground">{t('Nothing finished yet.')}</p>
          : <ul>{view.finished.map((el) => <Row key={el.id} el={el} onOpen={openElement} right={formatRelative(el.updated_at)} />)}</ul>}
      </Section>
    </div>
  );
}
