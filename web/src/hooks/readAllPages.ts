import { selectIn } from '@/hooks/chunkedIn';

export interface CountedRows<Row> {
  data: Row[] | null;
  error: { message: string } | null;
  count: number | null;
}

const PAGE_SIZE = 500;
const MAX_ROWS_PER_READ = 100_000;

/** An IN filter bounds URL length, not result length. Every query used by a
 * scoped surface must also read every server page, including a server configured with
 * a row cap smaller than our requested page. Exact counts make a short or
 * shifting result an explicit failure instead of a misleading partial result. */
export async function readAllPages<Row>(
  label: string,
  run: (from: number, to: number) => PromiseLike<CountedRows<Row>>,
  identity: (row: Row) => string,
): Promise<Row[]> {
  const rows: Row[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  do {
    const result = await run(rows.length, rows.length + PAGE_SIZE - 1);
    if (result.error) throw new Error(`Unable to read ${label}: ${result.error.message}`);
    if (result.count === null || !Number.isSafeInteger(result.count) || result.count < 0) {
      throw new Error(`Unable to verify the complete ${label} data. Refresh and try again.`);
    }
    if (result.count > MAX_ROWS_PER_READ) {
      throw new Error(`${label} exceeds the read limit. Narrow the scope and try again.`);
    }
    if (total !== null && total !== result.count) {
      throw new Error(`${label} changed while reading. Refresh and try again.`);
    }
    total = result.count;
    const page = result.data ?? [];
    if (page.length === 0 && rows.length < total) {
      throw new Error(`The ${label} data was incomplete. Refresh and try again.`);
    }
    for (const row of page) {
      const key = identity(row);
      if (seen.has(key)) throw new Error(`${label} changed while reading. Refresh and try again.`);
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > total) throw new Error(`${label} changed while reading. Refresh and try again.`);
  } while (rows.length < total);
  return rows;
}

/** `readAllPages` over a long id list: chunked so the `.in()` filter stays
 *  under the request-line limit, every chunk read to its last page. */
export function readAllIn<Row>(
  label: string,
  ids: readonly string[],
  run: (chunk: string[], from: number, to: number) => PromiseLike<CountedRows<Row>>,
  identity: (row: Row) => string,
): Promise<Row[]> {
  return selectIn<Row>(ids, async (chunk) => ({
    data: await readAllPages(label, (from, to) => run(chunk, from, to), identity),
    error: null,
  }));
}

export const rowId = (row: { id: string }) => row.id;
export const uniqueById = <Row extends { id: string }>(rows: Row[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
