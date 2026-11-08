// The credential history's reading (secure-login PR4): how one row
// of the credential_uses trail presents in the Audit app. The trail
// is value-free by construction — no writer can put a value in it —
// and this projection keeps it that way: a row shows the credential,
// the event, the person or run behind it, and the time. The detail
// column holds fixed codes only; a detail that is not a known code
// (the once-take's bookkeeping sentence, which names a request id)
// is an internal and is never shown. Pure.

import type { CredentialUse } from '@/types/database';

export type CredentialEvent = CredentialUse['event'];

export type CredentialHistoryFilter = 'all' | 'used' | 'changes' | 'problems';

/** The event's words, as the row's headline. */
export const CREDENTIAL_EVENT_LABEL: Record<CredentialEvent, string> = {
  stored: 'Stored',
  replaced: 'Replaced',
  deleted: 'Deleted',
  declined: 'Declined',
  used: 'Used',
  test_failed: 'Test failed',
  release_refused: 'Release refused',
};

/** The events that say a credential is in trouble — the filter a
 *  person answering a heartbeat candidate lands on. */
const PROBLEM_EVENTS: ReadonlySet<CredentialEvent> = new Set(['test_failed', 'release_refused']);

/** Tone per event, in the audit family's one-colour-per-meaning
 *  discipline: danger for a refusal or a proven-bad credential,
 *  warning for a decline, success-quiet for a spend, muted else. */
export const CREDENTIAL_EVENT_TONE: Record<CredentialEvent, string> = {
  stored: 'text-muted-foreground',
  replaced: 'text-muted-foreground',
  deleted: 'text-muted-foreground',
  declined: 'text-[var(--status-warning)]',
  used: 'text-[var(--status-success)]',
  test_failed: 'text-[var(--status-danger)]',
  release_refused: 'text-[var(--status-danger)]',
};

/** The known fixed codes a detail may carry, and their words. A
 *  detail outside this map is bookkeeping, not a fact for a person,
 *  and the row shows none of it. The sign-in outcome codes ride on
 *  'used' rows; 'auth_failed' rides on test_failed rows and is the
 *  last_test code besides. */
const DETAIL_LABEL: Record<string, string> = {
  auth_failed: 'Authentication failed',
  still_walled: 'The login wall stayed',
  page_moved: 'The page had moved',
  no_form: 'No sign-in form was found',
  no_pair: 'The credential did not arrive',
};

export interface CredentialHistoryRow {
  id: string;
  at: string;
  event: CredentialEvent;
  /** The credential in a person's words: a connection's name, a
   *  site login's origin, or the one-time kind named as itself. */
  credentialLabel: string;
  /** The origin involved, when it is not already the label. */
  origin: string | null;
  /** The known-code detail's words, or null when the detail is
   *  internal bookkeeping (or the event already says it). */
  detailLabel: string | null;
  /** Who stored / replaced / deleted / declined, when a person did
   *  it; null for spends and system-written rows. */
  actorName: string | null;
  /** The run that spent it, when a run did — the row opens it. */
  runId: string | null;
}

export interface CredentialHistoryNames {
  integrationName: ReadonlyMap<string, string>;
  siteOrigin: ReadonlyMap<string, string>;
  siteUsername: ReadonlyMap<string, string>;
  personName: ReadonlyMap<string, string>;
}

/** Pure. One trail row as the history shows it. A credential whose
 *  row was deleted keeps its story in the trail: the FK nulls, the
 *  kind and the origin remain, and the label falls back to them. */
export function credentialHistoryRow(use: CredentialUse, names: CredentialHistoryNames): CredentialHistoryRow {
  let credentialLabel: string;
  if (use.credential_kind === 'integration') {
    credentialLabel = (use.integration_id ? names.integrationName.get(use.integration_id) : null) ?? 'Removed connection';
  } else if (use.credential_kind === 'site') {
    const origin = use.origin ?? (use.site_credential_id ? names.siteOrigin.get(use.site_credential_id) : null) ?? null;
    const username = use.site_credential_id ? names.siteUsername.get(use.site_credential_id) : null;
    credentialLabel = username && origin ? `${origin} · ${username}` : origin ?? 'Site login';
  } else {
    credentialLabel = 'One-time credential';
  }
  const origin = use.credential_kind === 'integration' ? null : (use.origin ?? null);
  return {
    id: use.id,
    at: use.created_at,
    event: use.event,
    credentialLabel,
    origin: credentialLabel === origin || (origin !== null && credentialLabel.startsWith(origin)) ? null : origin,
    detailLabel: use.detail && use.detail !== 'signed_in' ? DETAIL_LABEL[use.detail] ?? null : null,
    actorName: use.actor_id ? names.personName.get(use.actor_id) ?? null : null,
    runId: use.run_id ?? null,
  };
}

/** Pure. The filter's rows, in the trail's own (newest-first) order. */
export function filterCredentialHistory(
  rows: readonly CredentialHistoryRow[],
  filter: CredentialHistoryFilter,
): CredentialHistoryRow[] {
  if (filter === 'all') return [...rows];
  if (filter === 'used') return rows.filter((r) => r.event === 'used');
  if (filter === 'problems') return rows.filter((r) => PROBLEM_EVENTS.has(r.event));
  return rows.filter((r) => r.event !== 'used' && !PROBLEM_EVENTS.has(r.event));
}
