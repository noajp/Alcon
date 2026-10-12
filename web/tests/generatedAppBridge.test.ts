import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { appDocument } from '../src/Function/widget/generated/runtime';

describe('app data message boundary', () => {
  it('waits for the matching parent and channel before exposing a read result', async () => {
    const messages: Record<string, unknown>[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const html = appDocument({ title: 'read', usesObjectData: true, html: '<p>Read</p>', css: '', js: "const value=await alcon.readContext();parent.postMessage({observed:value},'*');" }, {}, { objectId: 'scope', objectName: '' }, 'channel', {});
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, { parent, window: { addEventListener: (_: string, fn: (event: unknown) => void) => listeners.push(fn) }, document: { addEventListener: () => {} }, setTimeout: () => 1, clearTimeout: () => {} });
    const dispatch = (source: unknown, data: unknown) => listeners.forEach(fn => fn({ source, data }));
    dispatch(parent, { channel: 'channel', type: 'start' });
    const request = messages.find(m => m.type === 'read-context')!;
    expect(request.id).toBe(1);
    dispatch({}, { channel: 'channel', type: 'context', id: 1, value: 'spoofed' });
    dispatch(parent, { channel: 'wrong', type: 'context', id: 1, value: 'wrong' });
    await Promise.resolve();
    expect(messages.some(m => 'observed' in m)).toBe(false);
    dispatch(parent, { channel: 'channel', type: 'context', id: 1, value: { elements: [] } });
    await Promise.resolve();
    expect(messages.find(m => 'observed' in m)?.observed).toEqual({ elements: [] });
  });
  it('takes the merged state from a save and tells the app when someone else saved', async () => {
    const messages: Record<string, unknown>[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const html = appDocument({ title: 'shared', html: '<p>Shared</p>', css: '', js: "alcon.onChange(state=>parent.postMessage({seen:state},'*'));await alcon.save({mine:1});parent.postMessage({after:alcon.state},'*');" }, {}, { objectId: 'scope', objectName: '' }, 'channel', {});
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, { parent, window: { addEventListener: (_: string, fn: (event: unknown) => void) => listeners.push(fn) }, document: { addEventListener: () => {} }, setTimeout: () => 1, clearTimeout: () => {} });
    const dispatch = (source: unknown, data: unknown) => listeners.forEach(fn => fn({ source, data }));
    dispatch(parent, { channel: 'channel', type: 'start' });
    const save = messages.find(m => m.type === 'save')!;
    expect(save.value).toEqual({ mine: 1 });
    // The answer carries what another person saved in the meantime.
    dispatch(parent, { channel: 'channel', type: 'saved', id: save.id, value: { mine: 1, theirs: 2 } });
    await Promise.resolve(); await Promise.resolve();
    expect(messages.find(m => 'after' in m)?.after).toEqual({ mine: 1, theirs: 2 });
    dispatch({}, { channel: 'channel', type: 'state', value: { spoofed: true } });
    dispatch(parent, { channel: 'wrong', type: 'state', value: { wrong: true } });
    expect(messages.some(m => 'seen' in m)).toBe(false);
    dispatch(parent, { channel: 'channel', type: 'state', value: { mine: 1, theirs: 3 } });
    expect(messages.find(m => 'seen' in m)?.seen).toEqual({ mine: 1, theirs: 3 });
  });
});
