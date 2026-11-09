// What a Copilot turn created in Alcon, as a record the panel can draw
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
  kind: "element" | "object" | "strategy";
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
