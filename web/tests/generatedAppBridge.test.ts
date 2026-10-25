import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { appDocument } from '../src/Function/widget/generated/runtime';
import { statePatch } from '../src/Function/widget/generated/model';

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
    // The save names the state it started from, so the host need not guess it.
    expect(save.base).toEqual({});
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
  it('reports the content height, and stops asking for more when content grows with the frame', () => {
    const messages: Record<string, unknown>[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    let observe: (() => void) | null = null;
    let contentBottom = 300;
    const win = { innerHeight: 240, scrollY: 0, addEventListener: () => {} };
    class FakeResizeObserver { constructor(fn: () => void) { observe = fn; } observe() {} }
    const child = { getBoundingClientRect: () => ({ height: contentBottom, width: 100, bottom: contentBottom }) };
    const html = appDocument({ title: 'tall', html: '<p>Tall</p>', css: '', js: '' }, {}, { objectId: 'scope', objectName: '' }, 'channel', {});
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, { parent, ResizeObserver: FakeResizeObserver, window: win, document: { addEventListener: () => {}, body: { children: [child] } }, getComputedStyle: () => ({ paddingBottom: '16px', marginBottom: '0px' }), setTimeout: () => 1, clearTimeout: () => {} });
    const sizes = () => messages.filter(m => m.type === 'size').map(m => m.height);
    observe!();
    expect(sizes()).toEqual([316]);
    // Real content: the host grows the frame, the content stays; then rows are added one by one.
    win.innerHeight = 316; observe!();
    for (const bottom of [337, 374, 411, 448]) { contentBottom = bottom; observe!(); win.innerHeight = bottom + 16; observe!(); }
    expect(sizes()).toEqual([316, 353, 390, 427, 464]);
    // Content sized to the frame: it grows exactly as much as the frame did, so the frame stops there.
    messages.length = 0;
    contentBottom = win.innerHeight; win.innerHeight += 0; observe!();
    win.innerHeight += 32; contentBottom += 32; observe!();
    win.innerHeight += 32; contentBottom += 32; observe!();
    expect(sizes().every(h => (h as number) <= win.innerHeight)).toBe(true);
  });
  it('keeps an app from replacing the names the host relies on', () => {
    const messages: Record<string, unknown>[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    const html = appDocument({ title: 'names', html: '<p>Names</p>', css: '', js: "function measure(intent){return intent.kind;}function send(){throw new Error('app send');}const __alconMeasure=1;" }, {}, { objectId: 'scope', objectName: '' }, 'channel', {});
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, { parent, window: { addEventListener: (type: string, fn: (event: unknown) => void) => { if (type === 'message') listeners.push(fn); } }, document: { addEventListener: () => {} }, setTimeout: () => 1, clearTimeout: () => {} });
    listeners.forEach(fn => fn({ source: parent, data: { channel: 'channel', type: 'start' } }));
    return new Promise<void>(resolve => setTimeout(() => {
      expect(messages.some(m => m.type === 'ready')).toBe(true);
      expect(messages.filter(m => m.type === 'error').map(m => m.message)).toEqual([]);
      expect(messages.filter(m => m.type === 'ready')).toHaveLength(1);
      resolve();
    }, 0));
  });
  it('starts a second save from what the app held, not from an answer it has not seen yet', async () => {
    const messages: Record<string, unknown>[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const parent = { postMessage: (message: Record<string, unknown>) => messages.push(message) };
    // Two fields saved back to back, each from the state the app holds at that moment.
    const html = appDocument({ title: 'fields', html: '<p>Fields</p>', css: '', js: "alcon.save({...alcon.state,a:1});alcon.save({...alcon.state,b:2});" }, { kept: true }, { objectId: 'scope', objectName: '' }, 'channel', {});
    const script = html.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, { parent, window: { addEventListener: (_: string, fn: (event: unknown) => void) => listeners.push(fn) }, document: { addEventListener: () => {} }, setTimeout: () => 1, clearTimeout: () => {} });
    listeners.forEach(fn => fn({ source: parent, data: { channel: 'channel', type: 'start' } }));
    const saves = messages.filter(m => m.type === 'save');
    expect(saves.map(m => [m.value, m.base])).toEqual([
      [{ kept: true, a: 1 }, { kept: true }],
      [{ kept: true, b: 2 }, { kept: true }],
    ]);
    // Against its own base the second save changes only b; it does not unset a.
    expect(statePatch(saves[1].base as never, saves[1].value as never)).toEqual({ set: { b: 2 }, unset: [] });
  });
});
