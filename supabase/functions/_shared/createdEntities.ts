// What a Copilot turn created in Clayware, as a record the panel can draw
// as cards. The creation tools already answer with the rows they made;
// until now the turn assembly reported only a row count to the driver,
// so "what was created" survived nowhere but the model's prose. This
// extractor is the one reading of those result shapes: it turns a
// create-family result into card records, defensively — anything
// unrecognised yields undefined and the tool event behaves exactly as
// it did before. Pure — no I/O, so the shapes are pinned by tests.
//
// The record is a snapshot as created: title, and for an Element its
// display_id and status at birth. The card reads the row live by id
// and shows this only while that read loads, or if the row has since
// been deleted — never as the displayed truth over a live row.

export interface CreatedEntity {
  kind: "element" | "object" | "strategy" | "pull_request";
  id: string;
  /** The Element's title / the Object's or Strategy's name, as created. */
  title: string;
  /** An Element's display_id (ELE-NNN), when its result carried one. */
  displayId?: string;
  /** An Element's status at creation. */
  status?: string;
  /** An Element's Object, when its result carried it (single creates
   *  do; a batch's rows do not — the card's live read resolves it). */
  objectId?: string;
  /** A pull request's own facts (coding capability PR3): its id is
   *  the code_changes row's — the durable Clayware-side record whose
   *  state the card re-reads live — and these are the snapshot the
   *  card falls back to, as with every kind here. */
  url?: string;
  repo?: string;
  number?: number;
  state?: string;
}

function rowOf(data: unknown): Record<string, unknown> | null {
  return data !== null && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : null;
}

function text(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** One Element row (createElement / createSubelement / a batch row) as
 *  a card record; undefined when the row does not carry an id and a
 *  title — a card without either would be a lie about what was made. */
function elementOf(row: Record<string, unknown>): CreatedEntity | undefined {
  const id = text(row.id);
  const title = text(row.title);
  if (!id || !title) return undefined;
  return {
    kind: "element",
    id,
    title,
    ...(text(row.display_id) ? { displayId: text(row.display_id) } : {}),
    ...(text(row.status) ? { status: text(row.status) } : {}),
    ...(text(row.object_id) ? { objectId: text(row.object_id) } : {}),
  };
}

/**
 * Pure. The entities one catalog call created, from its result data:
 * the create family only (createElement / createSubelement — a single
 * row; createElements — data.created[]; createObject — a single row;
 * createInitiative — a single row). Every other tool, and any result
 * whose shape is not the family's, yields undefined.
 */
export function createdOf(toolName: string, data: unknown): CreatedEntity[] | undefined {
  switch (toolName) {
    case "createElement":
    case "createSubelement": {
      const row = rowOf(data);
      const entity = row ? elementOf(row) : undefined;
      return entity ? [entity] : undefined;
    }
    case "createElements": {
      const rows = rowOf(data)?.created;
      if (!Array.isArray(rows)) return undefined;
      const entities = rows
        .map((r) => (rowOf(r) ? elementOf(rowOf(r)!) : undefined))
        .filter((e): e is CreatedEntity => e !== undefined);
      return entities.length ? entities : undefined;
    }
    case "createObject": {
      const row = rowOf(data);
      const id = row ? text(row.id) : undefined;
      const title = row ? text(row.name) : undefined;
      return id && title ? [{ kind: "object", id, title }] : undefined;
    }
    case "createInitiative": {
      const row = rowOf(data);
      const id = row ? text(row.id) : undefined;
      const title = row ? text(row.name) : undefined;
      return id && title ? [{ kind: "strategy", id, title }] : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Pure. A pull request the coding publish opened, as a card record:
 * the code_changes row the PR was linked into (coding capability
 * PR3, design §8) — the row is the card's identity because it is
 * what carries the PR's live state in Clayware; the snapshot fields
 * are the fallback while that read loads, as with every kind here.
 * Anything without the row's id, a title and the PR's URL is not a
 * card: a card without them would be a lie about what was made.
 */
export function pullRequestCreatedOf(change: {
  id?: unknown; title?: unknown; url?: unknown; repo?: unknown; number?: unknown; state?: unknown;
}): CreatedEntity | undefined {
  const id = text(change.id);
  const title = text(change.title);
  const url = text(change.url);
  if (!id || !title || !url) return undefined;
  return {
    kind: "pull_request",
    id,
    title,
    url,
    ...(text(change.repo) ? { repo: text(change.repo) } : {}),
    ...(typeof change.number === "number" && change.number > 0 ? { number: change.number } : {}),
    ...(text(change.state) ? { state: text(change.state) } : {}),
  };
}
