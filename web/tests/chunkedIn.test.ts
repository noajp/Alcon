import { describe, it, expect } from 'vitest';
import { chunkIds, selectIn, IN_CHUNK_SIZE, type ChunkResult } from '@/hooks/chunkedIn';

const ids = (n: number, prefix = 'id') =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** Stands in for a PostgREST error object — only the shape matters here. */
const pgError = (message: string) =>
  ({ message, details: '', hint: '', code: 'PGRST000' }) as unknown as NonNullable<
    ChunkResult<never>['error']
  >;

/** Records the chunks it was handed and answers with one row per id. */
function recorder(rows: (id: string) => unknown = (id) => ({ id })) {
  const calls: string[][] = [];
  const run = (chunk: string[]) => {
    calls.push(chunk);
    return Promise.resolve({ data: chunk.map(rows), error: null });
  };
  return { calls, run };
}

describe('chunkIds', () => {
  it('returns nothing for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });

  it('keeps a short list in one chunk', () => {
    expect(chunkIds(['a', 'b', 'c'], 10)).toEqual([['a', 'b', 'c']]);
  });

  it('splits at the boundary and keeps order', () => {
    expect(chunkIds(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('defaults to the size the URL budget allows', () => {
    expect(chunkIds(ids(IN_CHUNK_SIZE + 1))).toHaveLength(2);
  });

  it('rejects a size that would never terminate', () => {
    expect(() => chunkIds(['a'], 0)).toThrow();
  });
});

describe('selectIn', () => {
  it('never queries for an empty id list', async () => {
    const { calls, run } = recorder();
    await expect(selectIn([], run)).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('sends exactly one request at the chunk boundary', async () => {
    const { calls, run } = recorder();
    const list = ids(IN_CHUNK_SIZE);

    const rows = await selectIn(list, run);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(list);
    expect(rows).toHaveLength(IN_CHUNK_SIZE);
  });

  it('splits one past the boundary, leaving a single id in the second chunk', async () => {
    const { calls, run } = recorder();
    const list = ids(IN_CHUNK_SIZE + 1);

    const rows = await selectIn(list, run);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(list.slice(0, IN_CHUNK_SIZE));
    expect(calls[1]).toEqual([list[IN_CHUNK_SIZE]]);
    expect(rows).toHaveLength(IN_CHUNK_SIZE + 1);
  });

  it('concatenates chunks in id order even when the later chunk answers first', async () => {
    const list = ids(IN_CHUNK_SIZE * 2);
    const delays = [30, 0];
    let call = 0;

    const rows = await selectIn<{ id: string }>(list, (chunk) => {
      const wait = delays[call++] ?? 0;
      return new Promise((resolve) =>
        setTimeout(() => resolve({ data: chunk.map((id) => ({ id })), error: null }), wait),
      );
    });

    expect(rows.map((r) => r.id)).toEqual(list);
  });

  it('collapses repeated ids the way a single in.() would', async () => {
    const { calls, run } = recorder();

    const rows = await selectIn(['a', 'b', 'a', 'b'], run);

    expect(calls).toEqual([['a', 'b']]);
    expect(rows).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('restores a global order that chunking split up', async () => {
    const list = ids(IN_CHUNK_SIZE + 2);
    // Each chunk comes back sorted within itself, descending by rank.
    const rank = (id: string) => Number(id.split('-')[1]);
    const rows = await selectIn<{ id: string; rank: number }>(
      list,
      (chunk) =>
        Promise.resolve({
          data: chunk
            .map((id) => ({ id, rank: rank(id) }))
            .sort((a, b) => b.rank - a.rank),
          error: null,
        }),
      { compare: (a, b) => b.rank - a.rank },
    );

    expect(rows.map((r) => r.rank)).toEqual(
      [...list.map(rank)].sort((a, b) => b - a),
    );
  });

  it('rejects with the failing chunk error instead of returning a short list', async () => {
    const list = ids(IN_CHUNK_SIZE * 2);
    const boom = pgError('permission denied for table elements');

    const promise = selectIn(list, (chunk) =>
      chunk.includes(list[IN_CHUNK_SIZE])
        ? Promise.resolve({ data: null, error: boom })
        : Promise.resolve({ data: chunk.map((id) => ({ id })), error: null }),
    );

    await expect(promise).rejects.toBe(boom);
  });

  it('surfaces a failure even when every other chunk succeeded', async () => {
    const list = ids(IN_CHUNK_SIZE * 3);
    let seen = 0;

    await expect(
      selectIn(list, (chunk) => {
        seen++;
        return seen === 1
          ? Promise.resolve({ data: null, error: pgError('statement timeout') })
          : Promise.resolve({ data: chunk.map((id) => ({ id })), error: null });
      }),
    ).rejects.toMatchObject({ message: 'statement timeout' });
  });

  it('propagates a rejection from the runner itself', async () => {
    const list = ids(IN_CHUNK_SIZE + 1);
    const network = new Error('fetch failed');

    await expect(
      selectIn(list, () => Promise.reject(network)),
    ).rejects.toBe(network);
  });

  it('keeps at most four chunks in flight', async () => {
    const list = ids(IN_CHUNK_SIZE * 10);
    let inFlight = 0;
    let peak = 0;

    await selectIn<{ id: string }>(list, (chunk) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve({ data: chunk.map((id) => ({ id })), error: null });
        }, 1),
      );
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
