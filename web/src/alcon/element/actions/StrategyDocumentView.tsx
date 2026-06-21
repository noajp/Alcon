'use client';

import { useMemo } from 'react';
import { AlertCircle, Calendar, Eye, Sparkles, TrendingDown, User } from 'lucide-react';
import { useStrategyIntentBundle } from '@/hooks/useSupabase';
import type { StrategyWithObjects, IntentAudit, IntentPrediction, IntentResource } from '@/types/database';

// =============================================================
// StrategyDocumentView — the "Strategy Document" detail page that
// sits behind a single Strategy. Mirrors the design's:
//
//   Title + subtitle
//   meta row (status / owner / target / object count / updated)
//   KPI strip (HEALTH / AUDIT / BELIEF / RESOURCE)
//   認識の層 (Episteme) 2x2     ← filled in P2
//   実践の層 (Praxis) 2x2       ← filled in P3
//
// Until intents/audits/predictions/etc. are seeded the 2x2 panels
// show their structural axes + an empty hint, NOT a fake number,
// because seeing a fabricated "0/100 At risk" reads as broken
// rather than blank.
// =============================================================

export function StrategyDocumentView({ strategy }: { strategy: StrategyWithObjects }) {
  const { data, loading } = useStrategyIntentBundle(strategy.id);

  // Pull the freshest readings off the bundle. `audits` / `predictions` /
  // `resources` / `escalations` are sorted desc by their respective time
  // columns in the hook, so [0] is always "latest".
  const latestAudit = data?.audits[0] ?? null;
  const latestPrediction = data?.predictions[0] ?? null;
  const latestResource = data?.resources[0] ?? null;
  const openEscalations = useMemo(
    () => (data?.escalations ?? []).filter((e) => e.status === 'awaiting'),
    [data?.escalations],
  );

  const masterStatus = data?.master?.status ?? null;
  const healthLabel = labelForStatus(masterStatus);
  const healthTone = toneForStatus(masterStatus);

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-[1100px] mx-auto px-8 py-10">

        {/* Title block */}
        <DocumentHeader strategy={strategy} masterTitle={data?.master?.title ?? null} masterSubtitle={data?.master?.subtitle ?? null} />

        {/* Meta row */}
        <MetaRow
          status={healthLabel}
          statusTone={healthTone}
          decidedBy={data?.master?.decided_by_name ?? null}
          decidedRole={data?.master?.decided_by_role ?? null}
          horizon={data?.master?.horizon ?? null}
          objectCount={strategy.objectIds.length}
          updatedAt={strategy.updated_at}
        />

        {/* KPI strip */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 rounded-lg border border-border/60 overflow-hidden bg-[var(--surface-raised)]/30">
          <KpiCell
            label="HEALTH"
            value={healthLabel}
            valueTone={healthTone}
            hint={openEscalations.length > 0 ? `${openEscalations.length} escalation${openEscalations.length === 1 ? '' : 's'} open` : 'No open escalations'}
            withDot
          />
          <KpiCell
            label="AUDIT"
            value={latestAudit ? `${latestAudit.score}` : '—'}
            unit={latestAudit ? '/100' : undefined}
            valueTone={auditTone(latestAudit?.score)}
            hint={auditDeltaHint(latestAudit)}
          />
          <KpiCell
            label="BELIEF"
            value={beliefValue(latestPrediction)}
            valueTone={beliefTone(latestPrediction)}
            hint={beliefHint(latestPrediction)}
          />
          <KpiCell
            label="RESOURCE"
            value={resourceValue(latestResource)}
            valueTone={resourceTone(latestResource)}
            hint={resourceHint(latestResource)}
            noBorderRight
          />
        </div>

        {/* 認識の層 — placeholder for P2 */}
        <LayerHeader
          ja="認識の層"
          en="Episteme"
          tagline="戦略が本当に正しいか"
        />
        <PlaceholderMatrix
          axisXLeft={{ ja: '過去を見る', en: 'PAST' }}
          axisXRight={{ ja: '未来を見る', en: 'FUTURE' }}
          axisYTop={{ ja: '主張', en: 'CLAIM' }}
          axisYBottom={{ ja: '現実', en: 'REALITY' }}
          cells={[
            { num: '04', name: 'Lineage',    icon: <Calendar size={14} />, jaPrompt: '誰が決めたか',   enPrompt: 'Who decided what, and when' },
            { num: '01', name: 'Intent',     icon: <Sparkles size={14} />, jaPrompt: '何を主張してるか', enPrompt: 'What we claim to achieve' },
            { num: '02', name: 'Audit',      icon: <Eye size={14} />,      jaPrompt: '実態はどうか',     enPrompt: 'Whether reality matches the claim' },
            { num: '03', name: 'Prediction', icon: <TrendingDown size={14} />, jaPrompt: '達成できそうか', enPrompt: 'Whether the org believes it will happen' },
          ]}
          isLoading={loading}
          isEmpty={!data || (data.master === null && data.subs.length === 0)}
        />

        {/* 実践の層 — placeholder for P3 */}
        <LayerHeader
          ja="実践の層"
          en="Praxis"
          tagline="行動が主張を裏付けているか"
        />
        <PlaceholderMatrix
          axisXLeft={{ ja: '検証する', en: 'VERIFY' }}
          axisXRight={{ ja: '動く',     en: 'ACT' }}
          axisYTop={{ ja: '下向き ↓',  en: '' }}
          axisYBottom={{ ja: '上向き ↑', en: '' }}
          cells={[
            { num: '05', name: 'Resource',    icon: <Eye size={14} />,        jaPrompt: '裏付けはあるか',     enPrompt: 'Does investment back the claim?' },
            { num: '07', name: 'Next Action', icon: <Sparkles size={14} />,   jaPrompt: '次に何をするか',     enPrompt: 'What to do about what we learned' },
            { num: '08', name: 'Alignment',   icon: <AlertCircle size={14} />, jaPrompt: '部品同士は整合か',   enPrompt: 'Do parts contradict the whole?' },
            { num: '06', name: 'Escalation',  icon: <TrendingDown size={14} />, jaPrompt: '戦略を突き返す',  enPrompt: 'Push back when the strategy is wrong' },
          ]}
          isLoading={loading}
          isEmpty={!data || (data.master === null && data.subs.length === 0)}
        />

        {/* If there's no Intent yet, prompt the user to seed one. The 2x2s
            above just label the structure — this is the actionable nudge. */}
        {data && data.master === null && !loading && (
          <div className="mt-8 mb-12 rounded-lg border border-dashed border-border bg-[var(--surface-raised)]/40 px-6 py-8 text-center">
            <div className="text-[12px] uppercase tracking-[2px] text-[var(--text-tertiary)] font-medium mb-2">
              No Master Intent yet
            </div>
            <div className="text-[14px] text-[var(--text-secondary)] max-w-[480px] mx-auto">
              The Strategy Document needs a Master Intent before the dashboards above can come alive.
              Define what this Strategy is claiming to achieve, which dimensions it captures, and which
              it deliberately drops.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================
// Sub-pieces
// =============================================================

function DocumentHeader({
  strategy,
  masterTitle,
  masterSubtitle,
}: {
  strategy: StrategyWithObjects;
  masterTitle: string | null;
  masterSubtitle: string | null;
}) {
  // Fall back to the Strategy's own name/description until a Master
  // Intent is defined. The Strategy row is always present; the Master
  // Intent is the editorial title once seeded.
  return (
    <div className="flex items-start gap-4">
      <div className="w-10 h-10 rounded-md bg-[var(--surface-raised)] border border-border/60 flex items-center justify-center flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-[var(--text-secondary)]">
          <path fillRule="evenodd" d="M12 1 L21 22 L3 22 Z M11.5 7 L7 19.5 L15 19.5 Z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-[28px] leading-[34px] font-semibold tracking-[-0.01em] text-foreground">
          {masterTitle ?? strategy.name}
        </h1>
        {(masterSubtitle ?? strategy.description) && (
          <p className="mt-1 text-[14px] leading-[22px] text-[var(--text-secondary)] max-w-[700px]">
            {masterSubtitle ?? strategy.description}
          </p>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  status,
  statusTone,
  decidedBy,
  decidedRole,
  horizon,
  objectCount,
  updatedAt,
}: {
  status: string;
  statusTone: Tone;
  decidedBy: string | null;
  decidedRole: string | null;
  horizon: string | null;
  objectCount: number;
  updatedAt: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2">
      <Chip>
        <span className={`w-1.5 h-1.5 rounded-full ${toneDotBg(statusTone)}`} />
        <span className={toneTextClass(statusTone)}>{status}</span>
      </Chip>
      {decidedBy && (
        <Chip>
          <User size={11} className="text-[var(--text-tertiary)]" />
          {decidedBy}{decidedRole ? ` · ${decidedRole}` : ''}
        </Chip>
      )}
      {horizon && (
        <Chip>
          <Calendar size={11} className="text-[var(--text-tertiary)]" />
          Target {formatHorizon(horizon)}
        </Chip>
      )}
      <Chip>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text-tertiary)]">
          <path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10" />
        </svg>
        {objectCount} Object{objectCount === 1 ? '' : 's'}
      </Chip>
      <span className="text-[12px] text-[var(--text-tertiary)] ml-1">
        Updated {formatRelativeShort(updatedAt)}
      </span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 bg-[var(--surface-raised)]/50 text-[12px] text-[var(--text-secondary)]">
      {children}
    </span>
  );
}

function KpiCell({
  label,
  value,
  unit,
  valueTone = 'neutral',
  hint,
  withDot = false,
  noBorderRight = false,
}: {
  label: string;
  value: string;
  unit?: string;
  valueTone?: Tone;
  hint?: string;
  withDot?: boolean;
  noBorderRight?: boolean;
}) {
  return (
    <div className={`px-5 py-4 ${noBorderRight ? '' : 'border-r border-border/60'} border-b lg:border-b-0 border-border/60`}>
      <div className="text-[11px] uppercase tracking-[2px] text-[var(--text-tertiary)] font-medium">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {withDot && (
          <span className={`w-2 h-2 rounded-full ${toneDotBg(valueTone)} inline-block mr-1`} />
        )}
        <span className={`text-[22px] font-semibold tracking-[-0.01em] ${toneTextClass(valueTone)}`}>
          {value}
        </span>
        {unit && <span className="text-[12px] text-[var(--text-tertiary)]">{unit}</span>}
      </div>
      {hint && (
        <div className="mt-1 text-[12px] text-[var(--text-tertiary)]">{hint}</div>
      )}
    </div>
  );
}

function LayerHeader({ ja, en, tagline }: { ja: string; en: string; tagline: string }) {
  return (
    <div className="mt-10 mb-4 flex items-center gap-3">
      <span className="w-[3px] h-5 rounded bg-[var(--accent-default)]" />
      <span className="text-[15px] font-semibold text-foreground">{ja}</span>
      <span className="text-[12px] text-[var(--text-tertiary)] uppercase tracking-[2px]">· {en}</span>
      <span className="text-[12px] text-[var(--text-tertiary)] ml-2">{tagline}</span>
    </div>
  );
}

function PlaceholderMatrix({
  axisXLeft,
  axisXRight,
  axisYTop,
  axisYBottom,
  cells,
  isLoading,
  isEmpty,
}: {
  axisXLeft: { ja: string; en: string };
  axisXRight: { ja: string; en: string };
  axisYTop: { ja: string; en: string };
  axisYBottom: { ja: string; en: string };
  cells: Array<{ num: string; name: string; icon: React.ReactNode; jaPrompt: string; enPrompt: string }>;
  isLoading: boolean;
  isEmpty: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 overflow-hidden bg-[var(--surface-raised)]/30">
      {/* X-axis labels (top row) */}
      <div className="grid grid-cols-[80px_1fr_1fr] border-b border-border/60">
        <div />
        <div className="px-5 py-3 text-center border-r border-border/60">
          <div className="text-[12px] text-foreground">{axisXLeft.ja}</div>
          {axisXLeft.en && <div className="text-[10px] uppercase tracking-[2px] text-[var(--text-tertiary)] mt-0.5">{axisXLeft.en}</div>}
        </div>
        <div className="px-5 py-3 text-center">
          <div className="text-[12px] text-foreground">{axisXRight.ja}</div>
          {axisXRight.en && <div className="text-[10px] uppercase tracking-[2px] text-[var(--text-tertiary)] mt-0.5">{axisXRight.en}</div>}
        </div>
      </div>

      {/* Row 1: Y-axis top + 2 cells */}
      <div className="grid grid-cols-[80px_1fr_1fr] border-b border-border/60">
        <AxisYLabel ja={axisYTop.ja} en={axisYTop.en} />
        <MatrixCell {...cells[0]} loading={isLoading} empty={isEmpty} borderR />
        <MatrixCell {...cells[1]} loading={isLoading} empty={isEmpty} />
      </div>

      {/* Row 2: Y-axis bottom + 2 cells */}
      <div className="grid grid-cols-[80px_1fr_1fr]">
        <AxisYLabel ja={axisYBottom.ja} en={axisYBottom.en} />
        <MatrixCell {...cells[2]} loading={isLoading} empty={isEmpty} borderR />
        <MatrixCell {...cells[3]} loading={isLoading} empty={isEmpty} />
      </div>
    </div>
  );
}

function AxisYLabel({ ja, en }: { ja: string; en: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 border-r border-border/60 py-6">
      <div className="text-[12px] text-foreground">{ja}</div>
      {en && <div className="text-[10px] uppercase tracking-[2px] text-[var(--text-tertiary)]">{en}</div>}
    </div>
  );
}

function MatrixCell({
  num,
  name,
  icon,
  jaPrompt,
  enPrompt,
  loading,
  empty,
  borderR,
}: {
  num: string;
  name: string;
  icon: React.ReactNode;
  jaPrompt: string;
  enPrompt: string;
  loading: boolean;
  empty: boolean;
  borderR?: boolean;
}) {
  return (
    <div className={`px-6 py-6 min-h-[180px] ${borderR ? 'border-r border-border/60' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-[var(--surface-raised)] border border-border/40 flex items-center justify-center text-[var(--text-tertiary)]">
          {icon}
        </span>
        <span className="text-[11px] text-[var(--text-tertiary)] font-mono">{num}</span>
        <span className="text-[14px] font-semibold text-foreground">{name}</span>
      </div>
      <div className="mt-3 text-[13px] text-foreground">{jaPrompt}</div>
      <div className="text-[12px] text-[var(--text-tertiary)] mt-0.5">{enPrompt}</div>
      <div className="mt-4 text-[12px] text-[var(--text-tertiary)] italic">
        {loading ? 'Loading…' : empty ? 'Seed a Master Intent to populate.' : 'Coming soon.'}
      </div>
    </div>
  );
}

// =============================================================
// Display helpers — keep the JSX focused on layout, push the
// "what color is the number" logic into one place.
// =============================================================

type Tone = 'neutral' | 'good' | 'warn' | 'danger' | 'muted';

function toneTextClass(t: Tone): string {
  switch (t) {
    case 'good':   return 'text-[var(--status-success)]';
    case 'warn':   return 'text-[var(--status-warning)]';
    case 'danger': return 'text-[var(--status-danger)]';
    case 'muted':  return 'text-[var(--text-tertiary)]';
    default:       return 'text-foreground';
  }
}

function toneDotBg(t: Tone): string {
  switch (t) {
    case 'good':   return 'bg-[var(--status-success)]';
    case 'warn':   return 'bg-[var(--status-warning)]';
    case 'danger': return 'bg-[var(--status-danger)]';
    case 'muted':  return 'bg-[var(--text-tertiary)]';
    default:       return 'bg-[var(--text-secondary)]';
  }
}

function labelForStatus(s: string | null): string {
  switch (s) {
    case 'on_track':  return 'On track';
    case 'at_risk':   return 'At risk';
    case 'off_track': return 'Off track';
    case 'done':      return 'Done';
    default:          return '—';
  }
}

function toneForStatus(s: string | null): Tone {
  switch (s) {
    case 'on_track':  return 'good';
    case 'at_risk':   return 'warn';
    case 'off_track': return 'danger';
    case 'done':      return 'good';
    default:          return 'muted';
  }
}

function auditTone(score: number | undefined): Tone {
  if (score == null) return 'muted';
  if (score >= 70) return 'good';
  if (score >= 50) return 'warn';
  return 'danger';
}

function auditDeltaHint(a: IntentAudit | null): string {
  if (!a) return 'No audit run yet';
  if (a.delta_30d == null) return `${a.suspected_count} suspected of ${a.total_elements}`;
  const sign = a.delta_30d >= 0 ? '+' : '';
  return `${sign}${a.delta_30d} in 30d`;
}

function beliefValue(p: IntentPrediction | null): string {
  if (!p) return '—';
  if (p.official_report == null) return `${p.probability}%`;
  return `${p.probability}%`;
}

function beliefTone(p: IntentPrediction | null): Tone {
  if (!p) return 'muted';
  if (p.official_report == null) return 'neutral';
  const gap = p.official_report - p.probability;
  if (gap >= 30) return 'danger';
  if (gap >= 15) return 'warn';
  return 'good';
}

function beliefHint(p: IntentPrediction | null): string {
  if (!p) return 'No predictions yet';
  if (p.official_report == null) return 'Market vote';
  const gap = p.official_report - p.probability;
  return `${gap}pt divergence`;
}

function resourceValue(r: IntentResource | null): string {
  if (!r || r.actual_share == null) return '—';
  return `${r.actual_share.toFixed(1)}%`;
}

function resourceTone(r: IntentResource | null): Tone {
  if (!r || r.declared_share == null || r.actual_share == null) return 'muted';
  // If actual is way below declared priority, that's an alert.
  if (r.declared_share - r.actual_share > 50) return 'danger';
  if (r.declared_share - r.actual_share > 20) return 'warn';
  return 'good';
}

function resourceHint(r: IntentResource | null): string {
  if (!r) return 'Not measured';
  if (r.allocated_headcount != null && r.total_headcount != null) {
    return `${r.allocated_headcount} of ${r.total_headcount} people`;
  }
  return 'Headcount unknown';
}

function formatHorizon(iso: string): string {
  // 'YYYY-MM-DD' → "Q4 2027" style.
  const [y, m] = iso.split('-');
  const month = parseInt(m, 10);
  const q = Math.ceil(month / 3);
  return `Q${q} ${y}`;
}

function formatRelativeShort(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return 'today';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export type { Tone };
