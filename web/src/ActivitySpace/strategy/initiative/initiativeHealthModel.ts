// One Strategy's health, read off its Elements — for a list row.
//
// The Strategy page already has the full cross-section (initiativeRiskModel:
// overdue / stalled / blocked / due-soon, per Object, per Worker). A list row
// cannot carry that and should not try; it needs the three things a person
// scans the Strategy list for: how far along, how recently anything moved, and
// whether something is on fire. This file derives exactly those, and reuses
// the risk model's own predicates so the row and the page can never disagree
// about what "stalled" or "overdue" means — provided the caller hands it the
// same RiskObjects (with Domain thresholds) the page uses; see
// useInitiativeHealth. Counts are as visible to the viewer: RLS hides what
// it hides, on the row exactly as on the page.
//
// Pure. `now` is a parameter; the caller owns the clock.

import {
  computeInitiativeRisk,
  lastSignalAt,
  type InitiativeRiskOptions,
  type InitiativeRiskReport,
  type RiskElement,
  type RiskObject,
} from '@/Function/strategy/initiativeRiskModel';
import { completionOf } from '@/Function/shared/completion';

export interface InitiativeHealth {
  /** Elements homed in the Strategy's Objects, cancelled ones excluded. */
  total: number;
  done: number;
  /** 0–100, or null when there is nothing to measure against. */
  progressPct: number | null;
  /** Newest progress signal across the Strategy's Elements, or null when no
   *  Element has ever reported. */
  lastActivityAt: number | null;
  /** The risk model's counts for this Strategy's scope. */
  risk: Pick<InitiativeRiskReport, 'openTotal' | 'overdue' | 'stalled' | 'blocked' | 'scheduled'>;
  /**
   * Whether "overdue" is a measurement here at all. With no dated open
   * Element, overdue: 0 is not "on time" — it is unmeasured, and the row must
   * say so rather than borrow the healthy case's silence (el_OPS-031's rule:
   * a word must weigh what it points at).
   */
  scheduleMeasured: boolean;
}

export function computeInitiativeHealth(
  objects: RiskObject[],
  elements: RiskElement[],
  now: number,
  options: InitiativeRiskOptions = {},
): InitiativeHealth {
  const scope = new Set(objects.map((o) => o.id));
  const scoped = elements.filter((el) => el.objectIds.some((id) => scope.has(id)));
  const { done, total, pct } = completionOf(scoped);

  let lastActivityAt: number | null = null;
  for (const el of scoped) {
    const t = lastSignalAt(el);
    if (t !== null && (lastActivityAt === null || t > lastActivityAt)) lastActivityAt = t;
  }

  // The caller attaches each Object's Domain thresholds, so "stalled" here is
  // the same judgement the Strategy page makes — not the model default.
  const report = computeInitiativeRisk(objects, scoped, now, options);

  return {
    total,
    done,
    progressPct: total > 0 ? pct : null,
    lastActivityAt,
    risk: {
      openTotal: report.openTotal,
      overdue: report.overdue,
      stalled: report.stalled,
      blocked: report.blocked,
      scheduled: report.scheduled,
    },
    scheduleMeasured: report.scheduled > 0,
  };
}
