'use client';

import { ObjectIcon } from '@/alcon/shared/conceptIcons';
import { STATUS } from '@/shared/designTokens';
import {
  formatQuiet,
  type CampaignRiskReport,
  type ObjectRisk,
  type RiskReason,
} from '@/alcon/element/actions/campaignRiskModel';
import { useCampaignRisk } from '@/alcon/element/actions/useCampaignRisk';

// =============================================================
// CampaignRisk — the Campaign's cross-section.
//
// The burn-up above it says whether the Campaign is late. This says *what is
// hurting and where the next person goes*, which is the half a schedule can
// never answer. Read top to bottom it is one sentence: this much is wrong (the
// signal row), it is wrong here (the findings), and this is who is already
// carrying it (the load).
//
// Nothing on this surface is a count for its own sake. A row appears only when
// it fires, and a signal that cannot be measured says so instead of showing a
// confident zero — an unset due date is not an on-time Campaign.
// =============================================================

export function CampaignRisk({
  campaignId,
  onOpenObject,
}: {
  campaignId: string;
  /** Jump to the Object a finding points at. Objects span Domains, so the
   *  Object's Domain rides along for the caller to switch context. */
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  const { report, loading, error } = useCampaignRisk(campaignId);
  return (
    <CampaignRiskView report={report} loading={loading} error={error} onOpenObject={onOpenObject} />
  );
}

/** The pane with the reading already taken. Split from the container so the
 *  same markup can be rendered against a known report. */
export function CampaignRiskView({
  report,
  loading = false,
  error = null,
  onOpenObject,
}: {
  report: CampaignRiskReport | null;
  loading?: boolean;
  error?: Error | null;
  onOpenObject?: (objectId: string, domainId: string | null) => void;
}) {
  return (
    <section>
      <div className="h-px bg-border mb-3" />
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[13px] font-medium text-foreground/90">Risk &amp; Load</h2>
        {report && report.openTotal > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {report.openTotal} open
          </span>
        )}
      </div>

      {error ? (
        <p className="text-[12px] text-[var(--status-danger)] py-1">
          Could not read the Campaign&apos;s execution state.
        </p>
      ) : loading && !report ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">Reading execution state…</p>
      ) : !report || report.openTotal === 0 ? (
        <p className="text-[12px] text-muted-foreground/50 py-1">
          No open Elements under this Campaign yet — add Objects with live work to see where it hurts.
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
              them is good news. A Campaign whose Elements carry no due dates
              cannot be late — it can only be unmeasured, and saying "0 overdue"
              there would report the absence of data as the absence of risk. */}
          {report.scheduled === 0 ? (
            <p className="text-[11px] text-[var(--status-warning)]">
              No due dates on any of the {report.openTotal} open Elements — this Campaign&apos;s
              schedule is unmeasured, not clear.
            </p>
          ) : report.scheduled < report.openTotal ? (
            <p className="text-[11px] text-muted-foreground">
              Measured against the {report.scheduled} of {report.openTotal} open Elements that carry
              a due date.
            </p>
          ) : null}

          <Block label="Needs attention">
            <Findings risks={report.objects} onOpenObject={onOpenObject} />
          </Block>

          <Block label="Carried by">
            <Load
              rows={report.load}
              concentrated={report.concentration !== null}
              unstaffed={report.unstaffed}
            />
          </Block>
        </div>
      )}
    </section>
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
// The tone is carried only by a firing count; a zero stays grey so the eye
// lands on what is wrong instead of scanning four coloured numbers.
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
  // Both date signals go dark together: with no due dates in the Campaign
  // neither of them is measuring anything, and a grey zero would read as calm.
  const dated = scheduled > 0;
  return (
    <div className="grid grid-cols-4 rounded-md border border-border/60 overflow-hidden">
      <Signal label="Overdue" value={dated ? overdue : null} tone="text-[var(--status-danger)]" />
      <Signal
        label="Due soon, not started"
        value={dated ? dueSoon : null}
        tone="text-[var(--status-warning)]"
      />
      <Signal label="Stalled" value={stalled} tone="text-[var(--status-danger)]" />
      <Signal label="Blocked" value={blocked} tone={STATUS.blocked.color} />
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
    <div className="px-3 py-2 border-r border-border/60 last:border-r-0">
      <div
        className={`text-[18px] leading-[26px] font-semibold tabular-nums ${
          value === null ? 'text-muted-foreground/40' : value > 0 ? tone : 'text-muted-foreground/40'
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
  if (risks.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground/50 py-1">
        Every Object under this Campaign is moving — nothing needs reassigning right now.
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
          className="flex items-center gap-2 px-1 py-1.5 min-h-[2.375rem] rounded-md text-left transition-colors hover:bg-muted/20 focus-visible:bg-muted/40 disabled:pointer-events-none"
        >
          <ObjectIcon size={13} className="text-muted-foreground shrink-0" />
          <span className="text-[13px] font-[550] text-foreground truncate min-w-0">
            {risk.object.name}
          </span>
          <span className={`text-[11px] font-medium shrink-0 ${REASON_TONE[risk.reason]}`}>
            {REASON_LABEL[risk.reason]}
          </span>
          <span className="flex-1" />
          <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
            {describe(risk)}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The one line that tells the reader what to do about this row. */
function describe(risk: ObjectRisk): string {
  const quiet = risk.quietForMs === null ? null : formatQuiet(risk.quietForMs);
  switch (risk.reason) {
    case 'overdue':
      return `${risk.overdue} of ${risk.open} open past its date`;
    case 'stalled': {
      // The stalled Element's own silence, not the Object's — a neighbour being
      // edited would otherwise make a dead agent look two minutes old.
      const out = risk.stalledQuietMs === null ? null : formatQuiet(risk.stalledQuietMs);
      return `${risk.stalled} of ${risk.inFlight} in flight silent${out ? ` for ${out}` : ''}`;
    }
    case 'blocked':
      return `${risk.blocked} of ${risk.open} open blocked`;
    case 'due_soon':
      return `${risk.dueSoon} due by ${short(risk.dueSoonBy)}, none started`;
    default:
      return `${risk.open} open, none started${quiet ? ` for ${quiet}` : ''}`;
  }
}

/** `2026-09-03` → `Sep 3`. The year is noise on a three-day horizon. */
function short(date: string | null): string {
  if (date === null) return 'no date';
  const [, m, d] = date.split('-');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const name = month[Number(m) - 1];
  return name ? `${name} ${Number(d)}` : date;
}

// =============================================================
// Load — who is already carrying this Campaign.
//
// Headcount of open Elements per Worker, off `element_assignees` (the same
// edge the Workload surface aggregates). Not Workload's hour model: that one
// spreads estimated hours across start / due dates, and every Worker reads
// flat zero on a Campaign whose Elements carry no dates.
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
  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground/50 py-1">
        Nobody is assigned to the open work — every Element here is unstaffed.
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
              {row.open} open
            </span>
          </div>
        ))}
      </div>
      {rest > 0 && (
        <p className="text-[11px] text-muted-foreground mt-1">
          and {rest} more {rest === 1 ? 'Worker' : 'Workers'}
        </p>
      )}
      {unstaffed > 0 && (
        <p className="text-[11px] text-[var(--status-warning)] mt-1.5">
          {unstaffed} open {unstaffed === 1 ? 'Element has' : 'Elements have'} nobody on{' '}
          {unstaffed === 1 ? 'it' : 'them'}.
        </p>
      )}
      {concentrated && (
        <p className="text-[11px] text-[var(--status-warning)] mt-1.5">
          {top.name} holds {Math.round(top.share * 100)}% of the open work — this Campaign runs
          through one Worker. Add capacity or cut scope.
        </p>
      )}
    </div>
  );
}
