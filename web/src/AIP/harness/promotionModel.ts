import type { Json, PromotionBinding, PromotionDraft } from '@/types/database';
import { parseDefinition } from './harnessDefinition';

// The web twin of _shared/promotion.ts's reader-side pieces — the
// canonical JSON and the two hashes (so the review can show whether
// what is on the draft is still what was tested, and whether an update
// target has drifted), the binding and rehearsal-report readers, and
// the drift comparison. A test pins this file's hashes against the
// Deno originals: one definition of "the tested package" everywhere.

/** The fold connector names are matched by (connectorNeeds' fold). */
const foldConnectorName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

/** A JSON string with object keys sorted at every depth — the same
 *  canonical form the server hashes (integrationPlans.canonicalJson). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The structure hash of a definition (name + body) — a draft's tested
 *  hash, an existing definition's current hash, one function. */
export async function promotionStructureHashWeb(name: string, body: string): Promise<string> {
  return sha256Hex(canonicalJson({ name, body }));
}

export interface PromotionPackageWeb {
  name: string;
  body: string;
  binding: PromotionBinding;
}

/** The binding hash: Object + templates + trigger + the connector set
 *  the body names (sorted, folded). */
export async function promotionBindingHashWeb(pkg: PromotionPackageWeb): Promise<string> {
  const parsed = parseDefinition(pkg.body);
  const connectors = [...new Set(parsed.connectors.map((name) => foldConnectorName(name)))].sort();
  return sha256Hex(canonicalJson({
    objectId: pkg.binding.objectId,
    titleTemplate: pkg.binding.titleTemplate,
    descriptionTemplate: pkg.binding.descriptionTemplate,
    trigger: pkg.binding.trigger,
    connectors,
  }));
}

/** Tolerant reader for a stored binding (the server's reader, mirrored). */
export function readPromotionBindingWeb(raw: unknown): PromotionBinding {
  const empty: PromotionBinding = { objectId: null, titleTemplate: '', descriptionTemplate: '', trigger: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const b = raw as Record<string, unknown>;
  const t = b.trigger && typeof b.trigger === 'object' && !Array.isArray(b.trigger)
    ? (b.trigger as Record<string, unknown>) : null;
  return {
    objectId: typeof b.objectId === 'string' && b.objectId !== '' ? b.objectId : null,
    titleTemplate: typeof b.titleTemplate === 'string' ? b.titleTemplate : '',
    descriptionTemplate: typeof b.descriptionTemplate === 'string' ? b.descriptionTemplate : '',
    trigger: t && t.kind === 'schedule' && typeof t.cron === 'string' && t.cron.trim() !== ''
      ? {
        kind: 'schedule',
        cron: t.cron,
        timezone: typeof t.timezone === 'string' && t.timezone.trim() !== '' ? t.timezone : 'Asia/Tokyo',
      }
      : null,
  };
}

/** The package a draft currently proposes (its frozen, tested form). */
export function draftPackageWeb(draft: PromotionDraft): PromotionPackageWeb | null {
  if (!draft.name || !draft.body) return null;
  return { name: draft.name, body: draft.body, binding: readPromotionBindingWeb(draft.binding) };
}

// ── The rehearsal report, as the review reads it ───────────────────────

export interface RehearsalReadView { tool: string; ok: boolean; authFailure: boolean }
export interface RehearsalWriteView { tool: string; valid: boolean; problem: string | null }
export interface RehearsalReportView {
  reads: RehearsalReadView[];
  writes: RehearsalWriteView[];
  outcome: string | null;
  at: string | null;
}

export function readRehearsalReportWeb(raw: Json | null): RehearsalReportView {
  const empty: RehearsalReportView = { reads: [], writes: [], outcome: null, at: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const r = raw as Record<string, unknown>;
  const reads = (Array.isArray(r.reads) ? r.reads : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.tool === 'string' ? [{ tool: o.tool, ok: o.ok === true, authFailure: o.authFailure === true }] : [];
  });
  const writes = (Array.isArray(r.writes) ? r.writes : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.tool === 'string'
      ? [{ tool: o.tool, valid: o.valid === true, problem: typeof o.problem === 'string' ? o.problem : null }]
      : [];
  });
  return {
    reads, writes,
    outcome: typeof r.outcome === 'string' ? r.outcome : null,
    at: typeof r.at === 'string' ? r.at : null,
  };
}

// ── Drift (§4.8): cosmetic vs structural, the server's comparison ─────

export interface PromotionDriftView { drifted: boolean; aspects: string[] }

const sameJson = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);

/** Compares the activated form of a definition with its current form.
 *  Structural = the work itself changed; wording alone is not drift. */
export function promotionDriftWeb(
  activated: { name: string; body: string },
  current: { name: string; body: string },
): PromotionDriftView {
  const aspects: string[] = [];
  const a = parseDefinition(activated.body);
  const b = parseDefinition(current.body);
  if ((a.sections.goal !== '') !== (b.sections.goal !== '')) aspects.push('goal');
  const conn = (list: string[]) => [...new Set(list.map((n) => foldConnectorName(n)))].sort();
  if (!sameJson(conn(a.connectors), conn(b.connectors))) aspects.push('connectors');
  if (!sameJson(
    { budgetUsd: a.stop.budgetUsd, maxRounds: a.stop.maxRounds, target: a.stop.target },
    { budgetUsd: b.stop.budgetUsd, maxRounds: b.stop.maxRounds, target: b.stop.target },
  )) aspects.push('stop conditions');
  if (!sameJson(a.metric, b.metric)) aspects.push('measure');
  if (!sameJson(a.output, b.output)) aspects.push('output');
  const present = (sections: Record<string, string>) => Object.keys(sections).filter((k) => sections[k] !== '').sort();
  if (!sameJson(present(a.sections), present(b.sections))) aspects.push('sections');
  return { drifted: aspects.length > 0, aspects };
}
