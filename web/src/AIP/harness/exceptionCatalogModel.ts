import { isFailureClass, MAX_DECLARED_GIVE_UP, MAX_DECLARED_RETRY, type CompensatePolicy, type EscalateTarget, type FailureClass } from './harnessDefinition';
import type { CatalogException } from '@/hooks/customizeData';
import type { ExceptionInstall } from '@/hooks/exceptionData';

// The exception catalog's payload contract, read on the web side. The
// engine's reader is supabase/functions/_shared/failurePolicy.ts'
// parseExceptionEntry; the two are twins by necessity (the web cannot
// import the functions tree) and apply the same fail-closed rules: a
// payload outside the row rules reads as NO entry — never as a partial
// one. What the panel shows and what the engine will do are read from
// the same contract, so a summary here cannot promise what resolution
// would not deliver.

export interface ExceptionRowSummary {
  failureClass: FailureClass;
  retry: number | null;
  compensate: CompensatePolicy | null;
  escalate: EscalateTarget;
  giveUpAfter: number | null;
}

export interface ExceptionEntrySummary {
  /** The failures the entry speaks to (null = no condition). */
  match: { errorClass: FailureClass | null; destinationPattern: string | null; tool: string | null };
  rows: ExceptionRowSummary[];
}

const isCompensatePolicy = (v: unknown): v is CompensatePolicy => v === 'auto' || v === 'ask' || v === 'never';
const isEscalateTarget = (v: unknown): v is EscalateTarget => v === 'owner' || v === 'strategy' || v === 'inbox';
const isBoundedInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** A catalog exception's payload, read as its summary — null when the
 *  payload is outside the contract (the engine treats it the same). */
export function parseExceptionPayload(raw: unknown): ExceptionEntrySummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const m = r.match && typeof r.match === 'object' && !Array.isArray(r.match)
    ? r.match as Record<string, unknown> : {};
  if (m.error_class != null && !isFailureClass(m.error_class)) return null;
  const errorClass = (m.error_class as FailureClass | null) ?? null;
  if (m.destination_pattern != null && typeof m.destination_pattern !== 'string') return null;
  const destinationPattern = (m.destination_pattern as string | null) ?? null;
  if (destinationPattern !== null) {
    try { new RegExp(destinationPattern); } catch { return null; }
  }
  if (m.tool != null && typeof m.tool !== 'string') return null;
  const tool = (m.tool as string | null) ?? null;
  if (!Array.isArray(r.response) || r.response.length === 0) return null;
  const rows: ExceptionRowSummary[] = [];
  const seen = new Set<FailureClass>();
  for (const rawRow of r.response) {
    if (!rawRow || typeof rawRow !== 'object' || Array.isArray(rawRow)) return null;
    const row = rawRow as Record<string, unknown>;
    const cls = row.class == null ? errorClass : isFailureClass(row.class) ? row.class : null;
    if (!cls || seen.has(cls)) return null;
    seen.add(cls);
    if (row.retry != null && !isBoundedInt(row.retry, 0, MAX_DECLARED_RETRY)) return null;
    if (row.compensate != null && !isCompensatePolicy(row.compensate)) return null;
    if (!isEscalateTarget(row.escalate)) return null;
    if (row.give_up_after != null && !isBoundedInt(row.give_up_after, 1, MAX_DECLARED_GIVE_UP)) return null;
    rows.push({
      failureClass: cls,
      retry: (row.retry as number | null) ?? null,
      compensate: (row.compensate as CompensatePolicy | null) ?? null,
      escalate: row.escalate,
      giveUpAfter: (row.give_up_after as number | null) ?? null,
    });
  }
  return { match: { errorClass, destinationPattern, tool }, rows };
}

/** How an exception entry stands in this Space (the design's §5.4):
 *  not installed, installed at the catalog's current version, an
 *  update waiting (the catalog moved; taking it is a person's act),
 *  or installed but switched off. */
export type ExceptionInstallState =
  | { kind: 'not-installed' }
  | { kind: 'current'; version: number }
  | { kind: 'update-available'; installedVersion: number; catalogVersion: number }
  | { kind: 'disabled'; version: number };

export function exceptionInstallState(
  item: Pick<CatalogException, 'version'>,
  install: Pick<ExceptionInstall, 'version' | 'enabled'> | null,
): ExceptionInstallState {
  if (!install) return { kind: 'not-installed' };
  if (!install.enabled) return { kind: 'disabled', version: install.version };
  if (item.version > install.version) {
    return { kind: 'update-available', installedVersion: install.version, catalogVersion: item.version };
  }
  return { kind: 'current', version: install.version };
}
