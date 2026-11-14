// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { ySyncPlugin } from 'y-prosemirror';
import { schema } from '@/Function/notebook/pm/schema';
import { docToHtml } from '@/Function/notebook/pm/html';
import { FRAGMENT, seedFromHtml } from '@/Function/notebook/pm/collab';
import { linkItems, toggleChecked } from '@/Function/notebook/pm/commands';

// Two people editing one Note: each has an editor bound to a shared document,
// and the documents trade their changes as the wire would.

function pair(html: string) {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'wire') Y.applyUpdate(b, u, 'wire'); });
  b.on('update', (u: Uint8Array, origin: unknown) => { if (origin !== 'wire') Y.applyUpdate(a, u, 'wire'); });
  seedFromHtml(a, html);
  const view = (doc: Y.Doc) => new EditorView(document.createElement('div'), {
    state: EditorState.create({ schema, plugins: [ySyncPlugin(doc.getXmlFragment(FRAGMENT))] }),
  });
  return { a: view(a), b: view(b) };
}

const html = (v: EditorView) => docToHtml(v.state.doc);

/** The position just inside the end of the first text block holding `text`. */
function endOf(v: EditorView, text: string): number {
  let at = -1;
  v.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1 + node.content.size;
    return at < 0;
  });
  return at;
}

function itemPos(v: EditorView, text: string): number {
  let at = -1;
  v.state.doc.descendants((node, pos) => {
    if (at < 0 && node.type === schema.nodes.list_item && node.firstChild?.textContent === text) at = pos;
    return at < 0;
  });
  return at;
}

describe('editing a Note together', () => {
  const body = '<h1>Plan</h1><ul data-checklist="true"><li data-checked="false">todo</li></ul>'
    + '<table data-note-table="true"><colgroup><col style="width:120px"><col style="width:80px"></colgroup>'
    + '<tbody><tr><th>h1</th><th>h2</th></tr><tr><td>1</td><td>2</td></tr></tbody></table>'
    + '<pre data-lang="mermaid">graph TD; A--&gt;B</pre>';

  it('both start from the saved body', () => {
    const { a, b } = pair(body);
    expect(html(a)).toBe(body);
    expect(html(b)).toBe(body);
  });

  it("one's typing shows in the other's editor", () => {
    const { a, b } = pair(body);
    a.dispatch(a.state.tr.insertText(' now', endOf(a, 'Plan')));
    expect(html(b)).toContain('<h1>Plan now</h1>');
    b.dispatch(b.state.tr.insertText('!', endOf(b, '2')));
    expect(html(a)).toContain('<td>2!</td>');
    expect(html(a)).toBe(html(b));
  });

  it('checking a box and linking a line reach the other side', () => {
    const { a, b } = pair(body);
    toggleChecked(itemPos(a, 'todo'))(a.state, a.dispatch);
    expect(html(b)).toContain('<li data-checked="true">todo</li>');
    linkItems([{ pos: itemPos(b, 'todo'), elementId: 'e1' }])(b.state, b.dispatch);
    expect(html(a)).toContain('<li data-element-id="e1">todo</li>');
  });

  it('typing at once in two places keeps both', () => {
    const { a, b } = pair('<p>left</p><p>right</p>');
    a.dispatch(a.state.tr.setSelection(TextSelection.create(a.state.doc, endOf(a, 'left'))).insertText(' A'));
    b.dispatch(b.state.tr.setSelection(TextSelection.create(b.state.doc, endOf(b, 'right'))).insertText(' B'));
    expect(html(a)).toBe('<p>left A</p><p>right B</p>');
    expect(html(b)).toBe('<p>left A</p><p>right B</p>');
  });
});
