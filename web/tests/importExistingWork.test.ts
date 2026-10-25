import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementImportRejectedError, parseIntake, normalizeIntake } from '@/Function/shared/element/intakeModel';

const server = vi.hoisted(() => ({ userId: '00000000-0000-0000-0000-000000000001' as string | null, rpc: vi.fn(), changed: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getCurrentUserId: async () => server.userId, supabase: { rpc: server.rpc } }));
vi.mock('@/lib/queryClient', () => ({ getQueryClient: () => ({ invalidateQueries: server.invalidate }) }));
vi.mock('@/Function/space/domainsStore', () => ({ notifyDomainsChanged: server.changed }));
import { clearPendingWorkImport, importExistingWork, readPendingWorkImport, rememberPendingWorkImport, resolveExistingWork, type PendingWorkImport, type WorkImportTarget } from '@/hooks/importExistingWork';

const user = '00000000-0000-0000-0000-000000000001';
const space = '10000000-0000-0000-0000-000000000001';
const object = '30000000-0000-0000-0000-000000000001';
const target: WorkImportTarget = { userId: user, spaceId: space, batchId: '90000000-0000-0000-0000-000000000001', objectId: null, domainId: null, projectName: 'Customer launch' };
const table = parseIntake('First\nSecond');
const rows = normalizeIntake(table, table.suggestedMap, []).rows;
const result = () => ({ objectId: object, replayed: false, saved: rows.map((row, index) => ({ rowKey: row.rowKey, elementId: `40000000-0000-0000-0000-00000000000${index + 1}` })) });
const pending = (): PendingWorkImport => ({ version: 1, target: structuredClone(target), rows: structuredClone(rows) });
class MemoryStorage {
  entries = new Map<string, string>();
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
}

describe('atomic import client', () => {
  beforeEach(() => {
    server.userId = user;
    server.rpc.mockReset().mockResolvedValue({ data: result(), error: null });
    server.changed.mockReset(); server.invalidate.mockReset();
  });

  it('rejects empty/oversize imports before sending an RPC', async () => {
    await expect(importExistingWork(target, [])).rejects.toThrow('1 to 100');
    await expect(importExistingWork(target, Array.from({ length: 101 }, (_, index) => ({ ...rows[0], rowKey: `row-${index}` })))).rejects.toThrow('1 to 100');
    expect(server.rpc).not.toHaveBeenCalled();
  });
  it('requires the account that owns the pending request', async () => {
    server.userId = null;
    await expect(importExistingWork(target, rows)).rejects.toThrow('Sign in');
    server.userId = '00000000-0000-0000-0000-000000000002';
    await expect(importExistingWork(target, rows)).rejects.toThrow('account changed');
    expect(server.rpc).not.toHaveBeenCalled();
  });
  it('rejects a missing destination, invalid batch ID, or duplicate row keys', async () => {
    await expect(importExistingWork({ ...target, projectName: '' }, rows)).rejects.toThrow('Name this project');
    await expect(importExistingWork({ ...target, batchId: '' }, rows)).rejects.toThrow('destination');
    await expect(importExistingWork(target, [rows[0], rows[0]])).rejects.toThrow('unique row');
    expect(server.rpc).not.toHaveBeenCalled();
  });
  it('sends one complete RPC and invalidates views only after a complete confirmed result', async () => {
    expect(await importExistingWork(target, rows)).toEqual({ saved: result().saved, objectId: object });
    expect(server.rpc).toHaveBeenCalledExactlyOnceWith('import_existing_work', {
      p_space_id: space, p_batch_id: target.batchId, p_object_id: null, p_domain_id: null,
      p_project_name: 'Customer launch', p_rows: rows,
    });
    expect(server.changed).toHaveBeenCalledOnce();
    expect(server.invalidate).toHaveBeenCalledWith({ queryKey: ['nowWork'] });
  });
  it.each([
    () => ({ ...result(), saved: [] }),
    () => ({ ...result(), saved: [null, result().saved[1]] }),
    () => ({ ...result(), saved: [result().saved[0], result().saved[0]] }),
    () => ({ ...result(), saved: result().saved.map((row) => ({ ...row, elementId: result().saved[0].elementId })) }),
    () => ({ ...result(), saved: result().saved.map((row) => ({ ...row, rowKey: 'unrelated' })) }),
    () => ({ ...result(), objectId: 'unverified' }),
    () => ({ ...result(), replayed: undefined }),
  ])('keeps an incomplete or inconsistent response unconfirmed', async (invalid) => {
    server.rpc.mockResolvedValue({ data: invalid(), error: null });
    await expect(importExistingWork(target, rows)).rejects.toThrow('could not be confirmed');
    expect(server.changed).not.toHaveBeenCalled();
    expect(server.invalidate).not.toHaveBeenCalled();
  });
  it('checks an existing project response against its requested destination', async () => {
    await expect(importExistingWork({ ...target, objectId: '30000000-0000-0000-0000-000000000009' }, rows)).rejects.toThrow('could not be confirmed');
  });
  it('resends the unchanged batch after a lost response and accepts a verified server receipt', async () => {
    server.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Network response lost' } }).mockResolvedValueOnce({ data: { ...result(), replayed: true }, error: null });
    await expect(importExistingWork(target, rows)).rejects.toThrow('Network response lost');
    expect(await importExistingWork(target, rows)).toEqual({ saved: result().saved, objectId: object });
    expect(server.rpc.mock.calls[0]).toEqual(server.rpc.mock.calls[1]);
  });

  it('distinguishes an SQL rollback from transport uncertainty and evidence of a prior commit', async () => {
    server.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Worker no longer available' } });
    await expect(importExistingWork(target, rows)).rejects.toBeInstanceOf(ElementImportRejectedError);
    server.rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'Fetch failed' } });
    await expect(importExistingWork(target, rows)).rejects.not.toBeInstanceOf(ElementImportRejectedError);
    server.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P2002', message: 'Imported work has been removed' } });
    await expect(importExistingWork(target, rows)).rejects.not.toBeInstanceOf(ElementImportRejectedError);
    server.rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'This import was already used with different contents' } });
    await expect(importExistingWork(target, rows)).rejects.not.toBeInstanceOf(ElementImportRejectedError);
  });

  it('resolves an uncertain request using its original identity, and rejects unconfirmed outcomes', async () => {
    server.rpc.mockResolvedValueOnce({ data: { committed: false, available: false }, error: null });
    expect(await resolveExistingWork(target)).toEqual({ committed: false, available: false });
    expect(server.rpc).toHaveBeenLastCalledWith('resolve_work_import', { p_space_id: space, p_batch_id: target.batchId });
    server.rpc.mockResolvedValueOnce({ data: { committed: true, available: false }, error: null });
    expect(await resolveExistingWork(target)).toEqual({ committed: true, available: false });
    server.rpc.mockResolvedValueOnce({ data: {}, error: null });
    await expect(resolveExistingWork(target)).rejects.toThrow('could not be confirmed');
    server.userId = null;
    await expect(resolveExistingWork(target)).rejects.toThrow('account');
  });
});

describe('pending import recovery', () => {
  let storage: MemoryStorage;
  beforeEach(() => { storage = new MemoryStorage(); });

  it('restores the reviewed rows and the same batch after a simulated reload', () => {
    const request = pending();
    rememberPendingWorkImport(storage, request);
    const reloadedStorage = new MemoryStorage();
    reloadedStorage.entries = new Map(storage.entries);
    expect(readPendingWorkImport(reloadedStorage, user, space)).toEqual(request);
    expect(readPendingWorkImport(reloadedStorage, user, space)).not.toBe(request);
  });
  it('separates users and Spaces and rejects a tampered embedded scope', () => {
    rememberPendingWorkImport(storage, pending());
    expect(readPendingWorkImport(storage, 'other-user', space)).toBeNull();
    expect(readPendingWorkImport(storage, user, 'other-space')).toBeNull();
    const [key] = [...storage.entries.keys()];
    storage.setItem(key, JSON.stringify({ ...pending(), target: { ...target, userId: 'other-user' } }));
    expect(() => readPendingWorkImport(storage, user, space)).toThrow('could not be restored');
  });
  it('refuses to overwrite unresolved work, while allowing an identical retry', () => {
    const request = pending();
    rememberPendingWorkImport(storage, request);
    expect(() => rememberPendingWorkImport(storage, request)).not.toThrow();
    expect(() => rememberPendingWorkImport(storage, { ...request, target: { ...target, batchId: '90000000-0000-0000-0000-000000000002' } })).toThrow('previous import');
    expect(() => rememberPendingWorkImport(storage, { ...request, rows: rows.slice(0, 1) })).toThrow('previous import');
    expect(readPendingWorkImport(storage, user, space)).toEqual(request);
  });
  it('only releases the confirmed batch and then allows a new import', () => {
    rememberPendingWorkImport(storage, pending());
    const nextTarget = { ...target, batchId: '90000000-0000-0000-0000-000000000002' };
    expect(() => clearPendingWorkImport(storage, nextTarget)).toThrow('different import');
    clearPendingWorkImport(storage, target);
    expect(readPendingWorkImport(storage, user, space)).toBeNull();
    rememberPendingWorkImport(storage, { ...pending(), target: nextTarget });
    expect(readPendingWorkImport(storage, user, space)?.target.batchId).toBe(nextTarget.batchId);
  });
  it('keeps malformed stored data blocking rather than silently losing its retry identity', () => {
    rememberPendingWorkImport(storage, pending());
    const [key] = [...storage.entries.keys()];
    storage.setItem(key, '{broken');
    expect(() => readPendingWorkImport(storage, user, space)).toThrow('could not be restored');
    expect(() => rememberPendingWorkImport(storage, pending())).toThrow('could not be restored');
    expect(storage.getItem(key)).toBe('{broken');
  });
  it('does not pretend an unavailable browser store retained the request', () => {
    expect(() => rememberPendingWorkImport({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, pending())).toThrow('No request was sent');
  });
});
