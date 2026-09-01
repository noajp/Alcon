// Running a `.in(column, ids)` filter over a list whose length follows the
// size of the board.
//
// PostgREST puts the filter in the query string, so an `.in()` list costs URL
// length rather than rows: past a few hundred ids the request line is longer
// than the proxy in front of the API will accept, and the failure only ever
// shows up on a board large enough that nobody's fixture reproduces it.
//
// Everything here is a plain function over a caller-supplied runner — no
// Supabase import — so the chunking and the failure handling can be tested
// without a client.

import type { PostgrestError } from '@supabase/supabase-js';

/**
 * A UUID plus its separator costs ~37 bytes of query string, so 100 ids hold
 * one list near 3.7KB — under the 8KB request line that is the smallest limit
 * in common proxy configurations, with room left for the select list and for
 * a second `.in()` on the same query.
 */
export const IN_CHUNK_SIZE = 100;

/** Chunks are independent round-trips. Four in flight hides the latency of a
 *  long list without turning one list into a connection storm. */
const MAX_IN_FLIGHT = 4;

/** What a PostgREST query resolves to, narrowed to the parts this cares about. */
export type ChunkResult<Row> = { data: Row[] | null; error: PostgrestError | null };

/** Split `ids` into runs of at most `size`, in order. */
export function chunkIds(ids: readonly string[], size: number = IN_CHUNK_SIZE): string[][] {
  if (size < 1) throw new Error('chunkIds: size must be at least 1');
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}

/**
 * Run `run` once per chunk of `ids` and concatenate the rows in chunk order.
 * An empty list resolves to `[]` without touching the network — PostgREST
 * never sees `in.()`.
 *
 * A chunk's error is thrown, never folded into a short result: a query that
 * failed must not be readable as "no rows". The first failure stops the
 * remaining chunks.
 *
 * Repeated ids are collapsed first. A single `in.()` matches a row once
 * however many times its id appears; split across chunks it would not, and
 * the duplicate would reach the caller.
 *
 * Chunking splits one global ORDER BY into per-chunk ordering, so a caller
 * that depends on the order of the whole list passes `compare` to restore it.
 * The sort is stable, leaving rows the comparator ties in chunk order.
 */
export async function selectIn<Row>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<ChunkResult<Row>>,
  options?: { compare?: (a: Row, b: Row) => number },
): Promise<Row[]> {
  if (ids.length === 0) return [];

  const chunks = chunkIds(Array.from(new Set(ids)));
  const rows: Row[][] = new Array(chunks.length);
  let next = 0;
  let failed = false;
  let failure: unknown;

  const fail = (cause: unknown) => {
    if (!failed) {
      failed = true;
      failure = cause;
    }
  };

  // Each worker takes the next unclaimed chunk, so a slow chunk holds up only
  // itself. Rows land at the chunk's own index, which keeps the concatenation
  // in id order no matter what order the responses arrive in.
  const worker = async (): Promise<void> => {
    while (!failed && next < chunks.length) {
      const index = next++;
      try {
        const { data, error } = await run(chunks[index]);
        if (error) return fail(error);
        rows[index] = data ?? [];
      } catch (cause) {
        return fail(cause);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(MAX_IN_FLIGHT, chunks.length) }, () => worker()),
  );

  if (failed) throw failure;

  const all = rows.flat();
  return options?.compare ? all.sort(options.compare) : all;
}
