'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from '@/ui/icons';
import { useIntentBindingsForTargets, useStrategies } from '@/hooks/useSupabase';
import { collectDecisionReviews } from '@/ActivitySpace/strategy/initiative/initiativeReviewModel';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import type { WidgetHost } from '../types';
import {
  intentTrailRows,
  RELATIONSHIP_LABEL,
  type TrailRow,
  type TrailScope,
} from './intentTrailModel';
import { useI18n } from '@/Function/i18n/I18nProvider';

// =============================================================
// Decisions & assumptions — what this piece of work is standing on.
//
// The mirror of the Strategy's own Decisions and Assumptions sections, read
// from the other end: not "what did we bind this decision to" but "which
// decisions and assumptions reach me". For an Element that is the answer to
// "why does this exist"; for an Object it is every decision riding on its
// Elements; for a Phase it is the decision that moved its dates.
//
// Hidden when nothing reaches here. An Element nobody has bound anything to
// is the common case and an empty box would say "nobody wrote the strategy
// down", which is the Strategy's problem to show, not this Element's.
// =============================================================

export function IntentTrailWidget({ host }: { host: WidgetHost }) {
  const { t } = useI18n();
  const subjectId = host.subject.id ?? '';
  const subjectType =
    host.subject.kind === 'object' ? 'object'
    : host.subject.kind === 'phase' ? 'phase'
    : 'element';

  // An Object's Elements are targets too, and are named when a binding
  // reached the Object through one of them.
  const scope = useMemo<TrailScope>(() => {
    const contained = new Map<string, { type: 'element'; label: string }>();
    if (subjectType === 'object') {
      for (const el of host.elements) contained.set(el.id, { type: 'element', label: el.title });
    }
    return { subject: { type: subjectType, id: subjectId }, contained };
  }, [subjectType, subjectId, host.elements]);

  const targetIds = useMemo(
    () => [subjectId, ...scope.contained.keys()],
    [subjectId, scope],
  );

  const { bindings, intents, lineage, loading, error } = useIntentBindingsForTargets(targetIds);
  const { data: strategies } = useStrategies();

  // Sampled once per mount, above the early return, so the hook order cannot
  // depend on data — and so every row's review chip is judged against one
  // instant rather than a clock that moved between rows.
  const [now] = useState(() => new Date());

  // Newest review per decision. `collectDecisionReviews` is the Strategy
  // side's reader for the same rows, so the two surfaces agree on what
  // counts as an answer.
  const lastReviewedAt = useMemo(() => {
    const reviews = collectDecisionReviews(
      lineage.map((l) => ({
        id: l.id,
        intentId: l.intent_id,
        occurredAt: l.occurred_at,
        actorName: l.actor_name,
        actionKind: l.action_kind,
        body: l.body,
      })),
    );
    const out = new Map<string, string>();
    for (const [intentId, list] of reviews) {
      if (list[0]) out.set(intentId, list[0].occurredAt);
    }
    return out;
  }, [lineage]);

  const rows = useMemo(() => {
    const names = new Map(strategies.map((s) => [s.id, s.name]));
    return intentTrailRows(bindings, intents, scope, names, now, lastReviewedAt);
  }, [bindings, intents, scope, strategies, now, lastReviewedAt]);

  // An error is not emptiness. Hiding on a failed read would tell the reader
  // that nothing is bound here, which is a different and worse claim than
  // saying the read failed.
  useWidgetEmpty(!error && (loading || rows.length === 0));
  useWidgetMeta(rows.length > 0 ? String(rows.length) : null);

  if (error) {
    return (
      <p className="py-1 text-[12px] text-[var(--status-danger)]">
        {t('Could not read what this is standing on.')}
      </p>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <TrailRowView
          key={row.intentId}
          row={row}
          onOpenInitiative={() => {
            host.onNavigate?.({ strategyId: row.initiativeId });
            host.onViewChange?.('strategy');
          }}
          canOpen={Boolean(host.onNavigate)}
        />
      ))}
    </div>
  );
}

function TrailRowView({
  row,
  onOpenInitiative,
  canOpen,
}: {
  row: TrailRow;
  onOpenInitiative: () => void;
  canOpen: boolean;
}) {
  const { t } = useI18n();
  const tone =
    row.status === 'off_track' ? 'text-[var(--status-danger)]'
    : row.status === 'at_risk' ? 'text-[var(--status-warning)]'
    : row.status === 'done' ? 'text-muted-foreground'
    : null;
  const reviewTone =
    row.review && (row.review.state === 'overdue' || row.review.state === 'today')
      ? 'text-[var(--status-warning)]'
      : 'text-muted-foreground';

  return (
    <div className="py-2 space-y-1">
      {/* Kind and edge on one line, state on the right. The verb is the
          Strategy's own word for why the edge exists — kept, because
          "could falsify" and "delivers" are different reasons to care. */}
      <div className="flex items-center gap-1.5 text-[11px]">
        <span className="font-semibold text-muted-foreground">
          {row.kind === 'decision' ? t('Decision') : t('Assumption')}
        </span>
        <span className="text-muted-foreground/70 truncate">
          · {row.relationships.map((r) => t(RELATIONSHIP_LABEL[r])).join(' · ')}
        </span>
        <span className="flex-1" />
        {row.review ? (
          <span className={`shrink-0 tabular-nums ${reviewTone}`}>{row.review.label}</span>
        ) : tone ? (
          <span className={`shrink-0 ${tone}`}>{t(row.statusLabel)}</span>
        ) : null}
      </div>

      <p className="text-[12px] leading-5 text-foreground/90 line-clamp-2 break-words">{row.title}</p>

      {/* Reached through a child: name it, so the reader knows which of the
          Object's Elements the decision actually touched. */}
      {row.via && (
        <p className="text-[11px] text-muted-foreground truncate">{t('via {name}', { name: row.via })}</p>
      )}

      <button
        type="button"
        onClick={onOpenInitiative}
        disabled={!canOpen}
        className="group w-full flex items-center gap-1.5 -mx-1 px-1 py-0.5 rounded-sm text-left hover:bg-muted/40 focus-visible:bg-muted/40 transition-colors disabled:pointer-events-none"
      >
        <NavStrategyIcon size={12} className="shrink-0 text-muted-foreground" />
        <span className="flex-1 min-w-0 truncate text-[11px] text-muted-foreground group-hover:text-foreground">
          {row.initiativeName ?? t('Strategy')}
        </span>
        {canOpen && (
          <ChevronRight size={12} className="shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
        )}
      </button>
    </div>
  );
}
