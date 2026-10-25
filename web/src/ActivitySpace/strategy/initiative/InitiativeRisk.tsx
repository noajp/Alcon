'use client';

import { ObjectIcon } from '@/Function/shared/conceptIcons';
import { STATUS } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  formatQuiet,
  type InitiativeRiskReport,
  type ObjectRisk,
  type RiskReason,
} from '@/Function/strategy/initiativeRiskModel';
import { ABSENCE_WINDOW_DAYS } from '@/Function/strategy/initiativeAssumptionModel';
import {
  holderAbsenceLabel,
  type InitiativeBusFactor,
  type SoleHolder,
} from '@/Function/strategy/initiativeBusFactorModel';

// =============================================================
// InitiativeRisk — the Initiative's cross-section.
//
// The burn-up above it says whether the Initiative is late. This says *what is
// hurting and where the next person goes*, which is the half a schedule can
// never answer. Read top to bottom it is one sentence: this much is wrong (the
// signal row), it is wrong here (the findings), this is who is already carrying
// it (the load), and this is what stops if one of them goes (the cover).
//
// Nothing on this surface is a count for its own sake. A row appears only when
// it fires, and a signal that cannot be measured says so instead of showing a
// confident zero — an unset due date is not an on-time Initiative.
// =============================================================

/** The pane, rendered against a report the caller has already read. The read
 *  is the caller's because the Initiative widget also needs the open count for
 *  its frame header, and a container that hid the report could not give it. */
export function InitiativeRiskView({
  report,
  busFactor = null,
  loading = false,
  error = null,
  onOpenObject,
}: {
  report: InitiativeRiskReport | null;
  busFactor?: InitiativeBusFactor | null;
  loading?: boolean;
  error?: Error | null;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {error ? (
        <p className="text-[12px] text-[var(--status-danger)] py-1">
          {t("Could not read the Initiative's execution state.")}
        </p>
      ) : loading && !report ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">{t('Reading execution state…')}</p>
      ) : !report || report.openTotal === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          {t('No open Elements under this Initiative yet — add Objects with live work to see where it hurts.')}
        </p>
      ) : (
        <div className="space-y-4">
          <SignalRow
            overdue={report.overdue}
            dueSoon={report.dueSoon}
            scheduled={report.scheduled}
            stalled={report.stalled}
            blocked={report.blocked}
          />

          {/* Unmeasured and on-time are not the same reading, and only one of
              them is good news. A Initiative whose Elements carry no due dates
              cannot be late — it can only be unmeasured, and saying "0 overdue"
              there would report the absence of data as the absence of risk. */}
          {report.scheduled === 0 ? (
            <p className="text-[11px] text-[var(--status-warning)]">
              {t("No due dates on any of the {n} open Elements — this Initiative's schedule is unmeasured, not clear.", { n: report.openTotal })}
            </p>
          ) : report.scheduled < report.openTotal ? (
            <p className="text-[11px] text-muted-foreground">
              {t('Measured against the {scheduled} of {total} open Elements that carry a due date.', { scheduled: report.scheduled, total: report.openTotal })}
            </p>
          ) : null}

          <Block label={t('Needs attention')}>
            <Findings risks={report.objects} onOpenObject={onOpenObject} />
          </Block>

          <Block label={t('Carried by')}>
            <Load
              rows={report.load}
              concentrated={report.concentration !== null}
              unstaffed={report.unstaffed}
            />
          </Block>

          {busFactor && (
            <Block label={t('Nobody else on it')}>
              <Cover busFactor={busFactor} />
            </Block>
          )}
        </div>
      )}
    </>
  );
}

/** A named list inside the pane. Two stacked lists of names and numbers are
 *  unreadable without saying what each one counts; the label sits below the
 *  section heading in weight and colour so it does not compete with it. */
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}

// =============================================================
// Signal row — four counts, each one an action if it is not zero.
// The tone is carried only by a firing count; a zero is a plain figure, so the
// eye lands on what is wrong instead of scanning four coloured numbers.
// =============================================================
function SignalRow({
  overdue,
  dueSoon,
  scheduled,
  stalled,
  blocked,
}: {
  overdue: number;
  dueSoon: number;
  scheduled: number;
  stalled: number;
  blocked: number;
}) {
  // Both date signals go dark together: with no due dates in the Initiative
  // neither of them is measuring anything, and a grey zero would read as calm.
  const dated = scheduled > 0;
  const { t } = useI18n();
  // Figures side by side, held apart by spacing rather than boxed as tiles.
  return (
    <div className="grid grid-cols-4 gap-4">
      <Signal label={t('Overdue')} value={dated ? overdue : null} tone="text-[var(--status-danger)]" />
      <Signal
        label={t('Due soon, not started')}
        value={dated ? dueSoon : null}
        tone="text-[var(--status-warning)]"
      />
      <Signal label={t('Stalled')} value={stalled} tone="text-[var(--status-danger)]" />
      <Signal label={t('Blocked')} value={blocked} tone={STATUS.blocked.color} />
    </div>
  );
}

function Signal({
  label,
  value,
  tone,
}: {
  label: string;
  /** null = the input this count needs is missing, so there is no number to show. */
  value: number | null;
  tone: string;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`text-[18px] leading-[26px] font-semibold tabular-nums ${
          value === null ? 'text-muted-foreground/40' : value > 0 ? tone : 'text-foreground'
        }`}
      >
        {value === null ? '—' : value}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

// =============================================================
// Findings — the Objects that need somebody, worst first.
//
// Stalled and idle are kept apart on purpose. Stalled means work was picked up
// and went quiet: go find out why. Idle means nobody ever picked it up: staff
// it. One label for both would name the symptom and hide the remedy.
// =============================================================
const REASON_LABEL: Record<RiskReason, string> = {
  overdue: 'Overdue',
  stalled: 'Stalled',
  blocked: 'Blocked',
  due_soon: 'Due soon',
  idle: 'Nothing in flight',
};

const REASON_TONE: Record<RiskReason, string> = {
  overdue: 'text-[var(--status-danger)]',
  stalled: 'text-[var(--status-danger)]',
  blocked: STATUS.blocked.color,
  due_soon: 'text-[var(--status-warning)]',
  idle: 'text-[var(--status-warning)]',
};

function Findings({
  risks,
  onOpenObject,
}: {
  risks: ObjectRisk[];
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { t, locale } = useI18n();
  if (risks.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground/50 py-1">
        {t('Every Object under this Initiative is moving — nothing needs reassigning right now.')}
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {risks.map((risk) => (
        <button
          key={risk.object.id}
          type="button"
          disabled={!onOpenObject}
          onClick={() => onOpenObject?.(risk.object.id, risk.object.domainId ?? null)}
          className="flex items-center gap-2 px-2 py-1 min-h-8 rounded-md text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 disabled:pointer-events-none"
        >
          <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
          <span className="text-[13px] font-medium text-foreground truncate min-w-0">
            {risk.object.name}
          </span>
          <span className={`text-[11px] font-medium shrink-0 ${REASON_TONE[risk.reason]}`}>
            {t(REASON_LABEL[risk.reason])}
          </span>
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {describe(risk, t, locale)}
          </span>
        </button>
      ))}
    </div>
  );
}

type T = (message: string, values?: Record<string, string | number>) => string;

/** The one line that tells the reader what to do about this row. */
function describe(risk: ObjectRisk, t: T, locale: string): string {
  const quiet = risk.quietForMs === null ? null : formatQuiet(risk.quietForMs);
  switch (risk.reason) {
    case 'overdue':
      return t('{n} of {open} open past its date', { n: risk.overdue, open: risk.open });
    case 'stalled': {
      // The stalled Element's own silence, not the Object's — a neighbour being
      // edited would otherwise make a dead agent look two minutes old.
      const out = risk.stalledQuietMs === null ? null : formatQuiet(risk.stalledQuietMs);
      return out
        ? t('{n} of {inFlight} in flight silent for {time}', { n: risk.stalled, inFlight: risk.inFlight, time: out })
        : t('{n} of {inFlight} in flight silent', { n: risk.stalled, inFlight: risk.inFlight });
    }
    case 'blocked':
      return t('{n} of {open} open blocked', { n: risk.blocked, open: risk.open });
    case 'due_soon':
      return t('{n} due by {date}, none started', { n: risk.dueSoon, date: short(risk.dueSoonBy, t, locale) });
    default:
      return quiet
        ? t('{n} open, none started for {time}', { n: risk.open, time: quiet })
        : t('{n} open, none started', { n: risk.open });
  }
}

/** `2026-09-03` → `Sep 3`. The year is noise on a three-day horizon. */
function short(date: string | null, t: T, locale: string): string {
  if (date === null) return t('no date');
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

// =============================================================
// Load — who is already carrying this Initiative.
//
// Headcount of open Elements per Worker, off `element_assignees` (the same
// edge the Workload surface aggregates). Not Workload's hour model: that one
// spreads estimated hours across start / due dates, and every Worker reads
// flat zero on a Initiative whose Elements carry no dates.
// =============================================================
function Load({
  rows,
  concentrated,
  unstaffed,
}: {
  rows: { workerId: string; name: string; open: number; share: number }[];
  concentrated: boolean;
  /** Open Elements with nobody on them — the staffing gap belongs next to the
   *  staffing list, which is where the reader decides who picks it up. */
  unstaffed: number;
}) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground/50 py-1">
        {t('Nobody is assigned to the open work — every Element here is unstaffed.')}
      </p>
    );
  }
  const top = rows[0];
  const visible = rows.slice(0, 5);
  const rest = rows.length - visible.length;

  return (
    <div>
      <div className="flex flex-col">
        {visible.map((row) => (
          <div key={row.workerId} className="flex items-center gap-2 h-7">
            <span className="text-[12px] text-foreground truncate w-32 shrink-0">{row.name}</span>
            <span className="h-1.5 flex-1 rounded-full bg-[var(--surface-strong)] overflow-hidden">
              <span
                className="block h-full rounded-full bg-[var(--accent-default)]"
                style={{ width: `${Math.round(row.share * 100)}%` }}
              />
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums w-16 text-right shrink-0">
              {t('{n} open', { n: row.open })}
            </span>
          </div>
        ))}
      </div>
      {rest > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {rest === 1 ? t('and 1 more Worker') : t('and {n} more Workers', { n: rest })}
        </p>
      )}
      {unstaffed > 0 && (
        <p className="text-[11px] text-[var(--status-warning)] mt-1.5">
          {unstaffed === 1 ? t('1 open Element has nobody on it.') : t('{n} open Elements have nobody on them.', { n: unstaffed })}
        </p>
      )}
      {concentrated && (
        <p className="text-[11px] text-[var(--status-warning)] mt-1.5">
          {t('{name} holds {pct}% of the open work — this Initiative runs through one Worker. Add capacity or cut scope.', { name: top.name, pct: Math.round(top.share * 100) })}
        </p>
      )}
    </div>
  );
}

// =============================================================
// Cover — what stops if one of them goes.
//
// The load list above answers how full each Worker is, which is a question
// about this week and is solved by moving work. This one answers whether
// anybody else could pick their work up, which is solved by teaching somebody
// or hiring them and therefore has to be seen months earlier. Two lists,
// because a single "at risk" number would let the slow problem hide inside the
// fast one until the day it fires.
//
// The denominator is stated rather than assumed. On a board where one assignee
// per Element is the ordinary shape, a large count here is a description of the
// board and not yet an alarm; what makes it an alarm is a name against a date.
// =============================================================
function Cover({ busFactor }: { busFactor: InitiativeBusFactor }) {
  const { t } = useI18n();
  const { holders, single, openTotal } = busFactor;
  if (holders.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground/50 py-1">
        {openTotal === 0
          ? t('No open Elements to cover.')
          : t('Every staffed Element here has a second person on it — no single Worker is holding work alone.')}
      </p>
    );
  }

  const visible = holders.slice(0, 5);
  const rest = holders.length - visible.length;
  const exposed = holders.filter((h) => h.away);
  const soleCount = exposed[0]?.sole ?? 0;
  const soleElements = soleCount === 1 ? t('1 open Element') : t('{n} open Elements', { n: soleCount });

  return (
    <div>
      <div className="flex flex-col">
        {visible.map((holder) => (
          <HolderRow key={holder.workerId} holder={holder} />
        ))}
      </div>
      {rest > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">
          {rest === 1 ? t('and 1 more Worker') : t('and {n} more Workers', { n: rest })}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground mt-1.5">
        {single === 1
          ? t('1 of {total} open Elements has exactly one person on it.', { total: openTotal })
          : t('{n} of {total} open Elements have exactly one person on them.', { n: single, total: openTotal })}
      </p>
      {/* One sentence, for the worst of them. The rest are named in the rows
          above with their own dates; repeating the whole reading per Worker
          would turn the warning into a wall nobody finishes. */}
      {exposed.length > 0 && (
        <p className="text-[11px] text-[var(--status-warning)] mt-1.5">
          {exposed[0].dueWhileAway > 0
            ? t('{name} has no hours on {away} of the next {window} days and is the only person on {elements}, {due} of them due while away. Brief a second person or move the dates.', { name: exposed[0].name, away: exposed[0].awayDays, window: ABSENCE_WINDOW_DAYS, elements: soleElements, due: exposed[0].dueWhileAway })
            : t('{name} has no hours on {away} of the next {window} days and is the only person on {elements}. Brief a second person or move the dates.', { name: exposed[0].name, away: exposed[0].awayDays, window: ABSENCE_WINDOW_DAYS, elements: soleElements })}
          {exposed.length > 1
            ? ` ${exposed.length === 2 ? t('1 more sole holder is away in the same window.') : t('{n} more sole holders are away in the same window.', { n: exposed.length - 1 })}`
            : ''}
        </p>
      )}
    </div>
  );
}

function HolderRow({ holder }: { holder: SoleHolder }) {
  const { t } = useI18n();
  const absence = holderAbsenceLabel(holder);
  return (
    <div className="flex items-center gap-2 h-7">
      <span className="text-[12px] text-foreground truncate w-32 shrink-0">{holder.name}</span>
      {absence && (
        <span className="text-[11px] font-medium text-[var(--status-warning)] shrink-0">
          {absence}
        </span>
      )}
      <span className="flex-1" />
      <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
        {t('{n} alone', { n: holder.sole })}
      </span>
    </div>
  );
}
