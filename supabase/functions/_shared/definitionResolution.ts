// Which definition a slot resolves to, shared by every server consumer
// (run-agent, plan-initiative, automations) so they cannot drift: a
// disabled definition behaves as if its slot were empty. Hierarchical
// slots fall through to the next candidate; a slot that is the whole
// contract (an automation's binding) is checked with usableDefinition and
// refused by the caller instead.

export interface DefinitionCandidate { id: string; name: string; enabled: boolean }
export interface DefinitionResolution { id: string | null; skippedDisabled: string[] }

/** First enabled candidate wins; the disabled names before it are reported. */
export function resolveDefinition(candidates: (DefinitionCandidate | null | undefined)[]): DefinitionResolution {
  const skippedDisabled: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    if (c.enabled) return { id: c.id, skippedDisabled };
    skippedDisabled.push(c.name);
  }
  return { id: null, skippedDisabled };
}

/** An automation's sole binding: the row itself, or null when missing/disabled. */
export function usableDefinition<T extends { enabled: boolean }>(row: T | null): T | null {
  return row && row.enabled ? row : null;
}
