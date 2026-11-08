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
};

/** The fold connector names are matched by (the same fold as checkHarness and the web's installFlow). */
export const foldConnectorName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export interface ConnectorRowLike {
  name: string;
  preset: string | null;
  enabled: boolean;
}

/** The names one connection answers to: what the Space named it, and its preset's id and name. */
function aliasesOf(row: ConnectorRowLike): string[] {
  return [row.name, row.preset ?? "", CONNECTOR_PRESET_NAMES[row.preset ?? ""] ?? ""].filter(Boolean);
}

/** The named connectors with no enabled connection, in the order named, de-duplicated by folded name. */
export function missingConnectorNames(
  names: readonly string[],
  rows: readonly ConnectorRowLike[],
): string[] {
  const have = new Set(rows.filter((r) => r.enabled).flatMap(aliasesOf).map(foldConnectorName));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = foldConnectorName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!have.has(key)) out.push(name);
  }
  return out;
}
