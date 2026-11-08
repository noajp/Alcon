// The heartbeat's credential inspection (secure-login PR4, design
// §5): anomalous credential use, derived from the credential_uses
// trail alone — never from model text, never from a value (the
// trail holds none). Pure: the heartbeat driver reads the Space's
// rows (as the enabling owner, under the trail's owner-only RLS)
// and hands them here; what qualifies, and under which fingerprint
// version, is decided in this file where tests can pin it.
//
// Four anomalies, each a candidate only — heartbeat v1 notifies,
// it never acts, and no signal here can touch a credential:
//
//   - release refused, repeatedly: the runner's triple-origin gate
//     keeps saying no for one origin — probing, or a credential
//     aimed at the wrong place; either way a person should look.
//   - authentication failing, repeatedly: a credential the world
//     keeps refusing (test_failed rows: connection tests, run
//     refusals, sign-ins the wall rejected) — reauth churn made
//     visible as a pattern, not one card at a time.
//   - stored and never used: a standing credential nothing has
//     spent since it was stored — standing trust with no work to
//     show for it, worth an owner's glance (delete what is not
//     needed). Only credentials whose storing is itself on the
//     trail qualify: the audit can only swear to what it watched
//     from birth.
//   - a one-time credential spent by no recorded run: the take
//     writes its row at the spend and the spender annotates its
//     run; a row still unattributed a day later was spent by
//     something the record cannot name.

import type { HeartbeatSignal } from "./heartbeatSnapshot.ts";

export interface CredentialUseFact {
  id: string;
  credential_kind: "integration" | "site" | "once";
  integration_id: string | null;
  site_credential_id: string | null;
  event: "stored" | "replaced" | "deleted" | "declined" | "used" | "test_failed" | "release_refused";
  run_id: string | null;
  origin: string | null;
  created_at: string;
}

export interface CredentialNames {
  /** A connection's display name by its row id. */
  integrationName: ReadonlyMap<string, string>;
  /** A site credential's origin by its row id. */
  siteOrigin: ReadonlyMap<string, string>;
}

/** The recent window the repeated-event anomalies count over. */
export const ANOMALY_WINDOW_DAYS = 7;
/** Repetitions at which a repeated-event anomaly stands, and the
 *  counts at which it is told again: the fingerprint carries the
 *  highest milestone reached, so a pattern that keeps growing is
 *  re-raised as it grows, and a steady one is told once (plus the
 *  snapshot's one escalation). */
export const ANOMALY_MILESTONES = [3, 5, 10, 25] as const;
/** A stored credential must stand unused at least this long. */
export const UNUSED_MIN_AGE_DAYS = 30;
/** A one-time spend older than this with no run named on it is
 *  unattributed for good — annotation happens at the spend. */
export const UNKNOWN_USE_GRACE_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const AUDIT_PLACE = "監査の「資格情報の履歴」で確認できます";
const SETTINGS_PLACE = "Settings › Customize で確認できます";

function milestoneOf(count: number): number | null {
  let best: number | null = null;
  for (const m of ANOMALY_MILESTONES) if (count >= m) best = m;
  return best;
}

interface Group {
  key: string;
  /** The group's rows, oldest first. */
  rows: CredentialUseFact[];
  label: string;
}

/** Group recent rows of one event by the credential they belong to. */
function groupRecent(
  rows: readonly CredentialUseFact[],
  event: CredentialUseFact["event"],
  cutoff: number,
  keyOf: (r: CredentialUseFact) => string | null,
  labelOf: (r: CredentialUseFact) => string,
): Group[] {
  const groups = new Map<string, Group>();
  const recent = rows
    .filter((r) => r.event === event && new Date(r.created_at).getTime() >= cutoff)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of recent) {
    const key = keyOf(r);
    if (!key) continue;
    const g = groups.get(key) ?? { key, rows: [], label: labelOf(r) };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** The repeated-event signals (refusals, auth failures): a group
 *  stands when its count reaches a milestone; it has stood since
 *  the milestone-th event — the moment the pattern became one. */
function repeatedSignals(
  groups: readonly Group[],
  kind: "credential_refused" | "credential_auth_failed",
  describe: (label: string, count: number) => string,
): HeartbeatSignal[] {
  const out: HeartbeatSignal[] = [];
  for (const g of groups) {
    const milestone = milestoneOf(g.rows.length);
    if (milestone === null) continue;
    out.push({
      kind,
      id: g.key,
      since: g.rows[milestone - 1].created_at,
      version: `n${milestone}`,
      label: describe(g.label, g.rows.length),
      place: AUDIT_PLACE,
    });
  }
  return out;
}

/** Pure. The wake's credential signals from the Space's trail. */
export function credentialAnomalySignals(
  rows: readonly CredentialUseFact[],
  names: CredentialNames,
  now: Date,
): HeartbeatSignal[] {
  const cutoff = now.getTime() - ANOMALY_WINDOW_DAYS * DAY_MS;
  const signals: HeartbeatSignal[] = [];

  // ── Release refused, repeatedly, for one origin ──────────────────
  signals.push(...repeatedSignals(
    groupRecent(rows, "release_refused", cutoff,
      (r) => r.origin ?? r.site_credential_id,
      (r) => r.origin ?? names.siteOrigin.get(r.site_credential_id ?? "") ?? "サイト"),
    "credential_refused",
    (label, count) => `${label} へのサインイン情報の受け渡しが ${count} 回拒否されました`,
  ));

  // ── Authentication failing, repeatedly, for one credential ───────
  signals.push(...repeatedSignals(
    groupRecent(rows, "test_failed", cutoff,
      (r) => r.integration_id ?? r.site_credential_id,
      (r) => r.integration_id
        ? `連携「${names.integrationName.get(r.integration_id) ?? "接続"}」`
        : (r.origin ?? names.siteOrigin.get(r.site_credential_id ?? "") ?? "サイト")),
    "credential_auth_failed",
    (label, count) => `${label} の資格情報が ${count} 回認証に失敗しました`,
  ));

  // ── Stored, and never spent since ────────────────────────────────
  const latestStore = new Map<string, { at: string; label: string }>();
  const usedAfter = new Set<string>();
  const keyOf = (r: CredentialUseFact): string | null =>
    r.integration_id ? `integration:${r.integration_id}` : r.site_credential_id ? `site:${r.site_credential_id}` : null;
  const labelOf = (r: CredentialUseFact): string => r.integration_id
    ? `連携「${names.integrationName.get(r.integration_id) ?? "接続"}」`
    : (r.origin ?? names.siteOrigin.get(r.site_credential_id ?? "") ?? "サイト");
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of sorted) {
    const key = keyOf(r);
    if (!key) continue;
    if (r.event === "stored" || r.event === "replaced") {
      latestStore.set(key, { at: r.created_at, label: labelOf(r) });
      usedAfter.delete(key);
    } else if (r.event === "used" && latestStore.has(key)) {
      usedAfter.add(key);
    }
  }
  for (const [key, store] of latestStore) {
    if (usedAfter.has(key)) continue;
    const ageDays = Math.floor((now.getTime() - new Date(store.at).getTime()) / DAY_MS);
    if (ageDays < UNUSED_MIN_AGE_DAYS) continue;
    signals.push({
      kind: "credential_unused",
      id: key,
      since: store.at,
      // A re-store restarts the clock and is a new standing to
      // judge: the fingerprint carries the storing it judges.
      version: store.at,
      label: `${store.label} の資格情報は、保存から ${ageDays} 日使われていません`,
      place: SETTINGS_PLACE,
    });
  }

  // ── A one-time spend no run ever claimed ─────────────────────────
  for (const r of rows) {
    if (r.credential_kind !== "once" || r.event !== "used" || r.run_id) continue;
    const at = new Date(r.created_at).getTime();
    if (at < cutoff || now.getTime() - at < UNKNOWN_USE_GRACE_HOURS * HOUR_MS) continue;
    signals.push({
      kind: "credential_unknown_use",
      id: r.id,
      since: r.created_at,
      label: "1回限りの資格情報が、実行にひも付かない形で使われました",
      place: AUDIT_PLACE,
    });
  }

  return signals.sort((a, b) => a.since.localeCompare(b.since));
}
