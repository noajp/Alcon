import type { Definition } from '@/hooks/definitionData';
import type { CatalogDefinition } from '@/hooks/customizeData';

// How an installed harness stands against the catalog it came from, as
// pure logic: the panel renders these relations, and nothing else in the
// app decides that an update exists. An update is claimed only when the
// catalog's recorded version is ahead of the version the copy recorded —
// never from dates or from the text merely differing.

export type CatalogRelation =
  | { kind: 'local' }                                                     // source_id is null
  | { kind: 'orphaned'; sourceId: string }                                // source_id names no catalog row
  | { kind: 'legacy-unknown'; catalogVersion: number; differs: boolean }  // source_version is null, not backfilled
  | { kind: 'current'; version: number; differs: boolean }                // source_version === catalog version
  | { kind: 'update-available'; installedVersion: number; catalogVersion: number; differs: boolean };

export function catalogRelation(
  definition: Pick<Definition, 'name' | 'body' | 'source_id' | 'source_version'>,
  item: CatalogDefinition | null,
): CatalogRelation {
  if (definition.source_id == null) return { kind: 'local' };
  if (!item) return { kind: 'orphaned', sourceId: definition.source_id };
  // The catalog description is not copied into a definition, so only the
  // name and the body can differ.
  const differs = definition.name !== item.name || definition.body !== item.body;
  if (definition.source_version == null) return { kind: 'legacy-unknown', catalogVersion: item.version, differs };
  if (item.version > definition.source_version) {
    return { kind: 'update-available', installedVersion: definition.source_version, catalogVersion: item.version, differs };
  }
  return { kind: 'current', version: definition.source_version, differs };
}

/** Lines removed from the installed body and added by the catalog body, by a line-wise longest common subsequence. */
export function lineDiffCounts(installedBody: string, catalogBody: string): { removed: number; added: number } {
  const a = installedBody.split('\n');
  const b = catalogBody.split('\n');
  // LCS length over lines; bodies are short (hundreds of lines at most).
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  const common = prev[b.length];
  return { removed: a.length - common, added: b.length - common };
}

/** The definitions a picker may offer for a new binding: the enabled ones, in library order. */
export function enabledDefinitions<T extends Pick<Definition, 'enabled'>>(definitions: readonly T[]): T[] {
  return definitions.filter((d) => d.enabled);
}
