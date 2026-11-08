// Which of the connectors a harness names the Space has not connected —
// the server twin of web/src/AIP/harness/installFlow.ts's missingConnectors,
// with the same meaning, so the editor, the install walk and the engine
// cannot disagree about what is missing: a name is answered by an ENABLED
// integration row that folds to it — the name the Space gave the row, its
// preset's id, or its preset's display name. Pure.

/** Preset display names (web/src/AIP/connectors/catalog.ts): a harness may name a connector by any of them. */
export const CONNECTOR_PRESET_NAMES: Record<string, string> = {
  linear: "Linear", asana: "Asana", "google-drive": "Google Drive", github: "GitHub", slack: "Slack",
  deepseek: "DeepSeek", kimi: "Kimi", "custom-mcp": "Custom MCP", "custom-http": "Custom API", "custom-model": "Custom model API",
  // A connection the AI drafted and a person activated (G4): the preset
  // marks its provenance, so settings, reconcile and audits can tell it
  // from one a person built by hand.
  "ai-drafted": "AI drafted",
};

/** The fold connector names are matched by (the same fold as checkHarness and the web's installFlow). */
export const foldConnectorName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export interface ConnectorRowLike {
  name: string;
  preset: string | null;
  enabled: boolean;
  /** The row's latest connection test (integrations.last_test), when read. */
  last_test?: unknown;
}

/** The names one connection answers to: what the Space named it, and its preset's id and name. */
function aliasesOf(row: ConnectorRowLike): string[] {
  return [row.name, row.preset ?? "", CONNECTOR_PRESET_NAMES[row.preset ?? ""] ?? ""].filter(Boolean);
}

/**
 * Pure. A connection's latest test, read as a state: the sign-in was
 * refused (auth_failed / oauth_expired / oauth_required), or the latest
 * test failed at all — the connection is not one the work can rely on
 * until a person re-opens it in the connection dialog. A connection
 * whose test failed is a need, not a "have": counting it as connected
 * is what made an expired GitHub read as connected everywhere while
 * every call through it failed.
 */
export function lastTestNeedsReauth(lastTest: unknown): boolean {
  if (!lastTest || typeof lastTest !== "object") return false;
  const t = lastTest as { ok?: unknown; code?: unknown };
  return t.ok === false || t.code === "auth_failed" || t.code === "oauth_expired" || t.code === "oauth_required";
}

export type ConnectorNeedKind = "missing" | "reauth";

export interface ConnectorNeed {
  name: string;
  /** missing: no enabled row answers to the name. reauth: an enabled row
   *  answers, but its latest connection test failed. */
  kind: ConnectorNeedKind;
}

/**
 * Pure. The named connectors the Space still needs, in the order named,
 * de-duplicated by folded name — a name is answered only by an ENABLED
 * row that folds to it AND passed its latest connection test; a row
 * whose latest test failed makes the need a reauth.
 */
export function connectorNeeds(
  names: readonly string[],
  rows: readonly ConnectorRowLike[],
): ConnectorNeed[] {
  const byKey = new Map<string, ConnectorRowLike[]>();
  for (const row of rows) {
    if (!row.enabled) continue;
    for (const alias of aliasesOf(row)) {
      const key = foldConnectorName(alias);
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
  }
  const seen = new Set<string>();
  const out: ConnectorNeed[] = [];
  for (const name of names) {
    const key = foldConnectorName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const matching = byKey.get(key) ?? [];
    if (!matching.length) out.push({ name, kind: "missing" });
    else if (matching.every((r) => lastTestNeedsReauth(r.last_test))) out.push({ name, kind: "reauth" });
  }
  return out;
}

/** The named connectors with no usable connection, in the order named, de-duplicated by folded name. */
export function missingConnectorNames(
  names: readonly string[],
  rows: readonly ConnectorRowLike[],
): string[] {
  return connectorNeeds(names, rows).map((n) => n.name);
}
