import type { Integration } from '@/types/database';
import type { Definition } from '@/hooks/definitionData';
import { INTEGRATION_PRESETS, presetById, type IntegrationPreset } from '@/AIP/connectors/catalog';
import { checkHarness, parseDefinition, type Diagnostic } from './harnessDefinition';

// What installing a harness still needs, as pure logic: the connectors its
// body names that the Space has not connected — where "connected" is the
// runtime's own test, an enabled integration row the name folds to (its own
// name, its preset's id or its preset's name). The editor's check, the
// install walk and the library's Needs state all read this, so they cannot
// disagree with the engine about what is missing.

export interface ConnectorNeed {
  /** The name as written in `# 使うコネクタ`. */
  name: string;
  /** The fixed preset the name resolves to (MCP/API only), or null: find it in the MCP Registry. */
  preset: IntegrationPreset | null;
  /** missing: no enabled connection answers to the name. reauth: an enabled
   *  connection answers, but its latest connection test failed — it reads as
   *  connected nowhere now; the remedy is the same dialog, re-opened. */
  kind: 'missing' | 'reauth';
}

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

/** The names a connection answers to: what the Space named it, and its preset's id and name. */
function aliasesOf(i: Pick<Integration, 'name' | 'preset'>): string[] {
  return [i.name, i.preset ?? '', presetById(i.preset)?.name ?? ''].filter(Boolean);
}

/**
 * A connection's latest test, read as a state — the web twin of the engine's
 * lastTestNeedsReauth (_shared/connectorNeeds.ts): the sign-in was refused,
 * or the latest test failed at all. A connection whose test failed is a
 * need, not a "have": counting it as connected is what made an expired
 * GitHub read as connected everywhere while every call through it failed.
 */
function lastTestNeedsReauth(lastTest: unknown): boolean {
  if (!lastTest || typeof lastTest !== 'object') return false;
  const t = lastTest as { ok?: unknown; code?: unknown };
  return t.ok === false || t.code === 'auth_failed' || t.code === 'oauth_expired' || t.code === 'oauth_required';
}

/** Every name the Space's enabled connections answer to — the `connected` list a harness is checked against. */
export function enabledConnectedNames(
  integrations: readonly Pick<Integration, 'name' | 'preset' | 'enabled'>[],
): string[] {
  return integrations.filter((i) => i.enabled).flatMap(aliasesOf);
}

function presetForName(name: string): IntegrationPreset | null {
  const key = fold(name);
  return INTEGRATION_PRESETS.find((p) => (p.kind === 'mcp' || p.kind === 'http') && (fold(p.id) === key || fold(p.name) === key)) ?? null;
}

/** The named connectors with no usable connection, in body order, de-duplicated by folded name. */
export function missingConnectors(
  names: string[],
  integrations: readonly (Pick<Integration, 'name' | 'preset' | 'enabled'> & { last_test?: unknown })[],
): ConnectorNeed[] {
  const byKey = new Map<string, (Pick<Integration, 'name' | 'preset' | 'enabled'> & { last_test?: unknown })[]>();
  for (const i of integrations) {
    if (!i.enabled) continue;
    for (const alias of aliasesOf(i)) {
      const key = fold(alias);
      byKey.set(key, [...(byKey.get(key) ?? []), i]);
    }
  }
  const seen = new Set<string>();
  const out: ConnectorNeed[] = [];
  for (const name of names) {
    const key = fold(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const matching = byKey.get(key) ?? [];
    if (!matching.length) out.push({ name, preset: presetForName(name), kind: 'missing' });
    else if (matching.every((i) => lastTestNeedsReauth(i.last_test))) out.push({ name, preset: presetForName(name), kind: 'reauth' });
  }
  return out;
}

/** The definition a piece of work follows, resolved the way the engine
 *  resolves it for a run (run-agent's loadDefinition): the first candidate
 *  slot that names an enabled definition wins — for an Element run, its
 *  own definition, then its Strategy's. A disabled definition is skipped
 *  as if its slot were empty. Null when no slot names a usable one. */
export function workDefinition(
  candidateIds: readonly (string | null | undefined)[],
  definitions: readonly Pick<Definition, 'id' | 'enabled'>[],
): string | null {
  const byId = new Map(definitions.map((d) => [d.id, d]));
  for (const id of candidateIds) {
    if (!id) continue;
    const def = byId.get(id);
    if (def?.enabled) return def.id;
  }
  return null;
}

/** The connectors the work's own definition names that the Space has not
 *  connected — what a start of this work would go without. Candidate ids
 *  in the engine's resolution order (the Element's own, then its
 *  Strategy's). No usable definition, no named connectors: nothing is
 *  missing, because nothing was promised. */
export function missingForWork(
  candidateIds: readonly (string | null | undefined)[],
  definitions: readonly Pick<Definition, 'id' | 'body' | 'enabled'>[],
  integrations: readonly Pick<Integration, 'name' | 'preset' | 'enabled'>[],
): ConnectorNeed[] {
  const id = workDefinition(candidateIds, definitions);
  const def = id ? definitions.find((d) => d.id === id) : null;
  if (!def) return [];
  return missingConnectors(parseDefinition(def.body).connectors, integrations);
}

/** A definition's install state against the Space's connections: what is missing, what the check says, and whether it is installed and passing. */
export function installReadiness(
  definition: Pick<Definition, 'body'>,
  integrations: readonly Pick<Integration, 'name' | 'preset' | 'enabled'>[],
): { missing: ConnectorNeed[]; diagnostics: Diagnostic[]; passing: boolean } {
  const parsed = parseDefinition(definition.body);
  const missing = missingConnectors(parsed.connectors, integrations);
  const diagnostics = checkHarness(parsed, { connected: enabledConnectedNames(integrations) });
  return { missing, diagnostics, passing: missing.length === 0 && !diagnostics.some((d) => d.severity === 'error') };
}
