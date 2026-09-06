// ⌘K's "Create" group — the three creation actions (el_UXQ-010) that must
// stay reachable from an empty query and from the English/Japanese verbs a
// user might type ("create" / "new" / 作成). Kept as data + a pure matcher
// here (not JSX) so the matching rules are unit-testable without rendering
// the palette — see web/tests/paletteCreateCommands.test.ts.

export type CreateCommandId = 'create-element' | 'create-object' | 'create-initiative';

export interface CreateCommandSpec {
  id: CreateCommandId;
  /** Displayed exactly as-is. el_UXQ-010 requires the English "New Element"
   *  label to stay put even though "作成" must also match it — the Japanese
   *  keyword lives in `aliases`, never in the label. */
  label: string;
  /** Lowercase match keywords (English + Japanese). Never shown — only read
   *  by matchesCreateCommand. */
  aliases: string[];
}

// Declaration order is display order: Execution unit → Execution container →
// Strategy container, the same top-to-bottom reading as CLAUDE.md's concept
// model. filterCreateCommands preserves this order regardless of query.
export const CREATE_COMMANDS: CreateCommandSpec[] = [
  {
    id: 'create-element',
    label: 'New Element',
    aliases: ['create', '作成', '要素'],
  },
  {
    id: 'create-object',
    label: 'New Object',
    aliases: ['create', '作成', 'オブジェクト'],
  },
  {
    id: 'create-initiative',
    label: 'New Initiative',
    aliases: ['create', '作成', 'キャンペーン'],
  },
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** True when `query` should surface `spec` in the Create group. A blank
 *  query always matches — the group is meant to be visible at rest. */
export function matchesCreateCommand(spec: CreateCommandSpec, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  if (normalize(spec.label).includes(q)) return true;
  return spec.aliases.some((alias) => normalize(alias).includes(q));
}

/** CREATE_COMMANDS filtered for `query`, in fixed declaration order. */
export function filterCreateCommands(query: string): CreateCommandSpec[] {
  return CREATE_COMMANDS.filter((spec) => matchesCreateCommand(spec, query));
}
