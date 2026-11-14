// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { docToHtml, htmlToDoc } from '@/Function/notebook/pm/html';
import { schema } from '@/Function/notebook/pm/schema';
import { noteKeymap, pmRedo, pmUndo, shortcuts } from '@/Function/notebook/pm/plugins';
import { MarkRegistry, checklistMarks } from '@/Function/notebook/pm/marks';
import { toggleChecked } from '@/Function/notebook/pm/commands';

// What the keys do to a Note's body.

/** An editor on `html` with the caret `offset` characters into the block that reads `text`. */
function editor(html: string, text: string, offset = text.length) {
  const doc = htmlToDoc(html);
  let at = -1;
  doc.descendants((node, pos) => { if (at < 0 && node.isTextblock && node.textContent === text) at = pos + 1 + offset; return at < 0; });
  const state = EditorState.create({ schema, doc, plugins: [...noteKeymap(pmUndo, pmRedo), shortcuts()] });
  const view = new EditorView(document.createElement('div'), { state });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
  return view;
}

function press(view: EditorView, key: string, mods: { shiftKey?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', { key, ...mods });
  return view.someProp('handleKeyDown', (handle) => handle(view, event)) ?? false;
}

/** Types `text` the way a keyboard does (so the shortcuts see it). */
function typeText(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp('handleTextInput', (handle) => handle(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)))) {
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  }
}

describe('Enter in a list', () => {
  const list = '<ul data-checklist="true"><li data-element-id="e1">ship it</li><li data-checked="true">done</li></ul>';

  it('after a line made an Element starts a line of its own, not a second line of that Element', () => {
    const view = editor(list, 'ship it');
    expect(press(view, 'Enter')).toBe(true);
    expect(docToHtml(view.state.doc)).toBe(
      '<ul data-checklist="true"><li data-element-id="e1">ship it</li><li data-checked="false"></li><li data-checked="true">done</li></ul>');
  });

  it('after a checked line starts an unchecked one', () => {
    const view = editor(list, 'done');
    press(view, 'Enter');
    expect(docToHtml(view.state.doc)).toContain('<li data-checked="true">done</li><li data-checked="false"></li>');
  });

  it('in the middle of a linked line leaves the link on the first half', () => {
    const view = editor(list, 'ship it', 4);
    press(view, 'Enter');
    expect(docToHtml(view.state.doc)).toContain('<li data-element-id="e1">ship</li><li data-checked="false">&nbsp;it</li>');
  });

  it('in a plain list starts a plain item', () => {
    const view = editor('<ul><li>a</li></ul>', 'a');
    press(view, 'Enter');
    expect(docToHtml(view.state.doc)).toBe('<ul><li>a</li><li></li></ul>');
  });
});

describe('Shift-Enter', () => {
  it('breaks the line inside its block', () => {
    const view = editor('<p>ab</p>', 'ab', 1);
    expect(press(view, 'Enter', { shiftKey: true })).toBe(true);
    expect(docToHtml(view.state.doc)).toBe('<p>a<br>b</p>');
  });

  it('adds a line to code', () => {
    const view = editor('<pre>ab</pre>', 'ab', 1);
    press(view, 'Enter', { shiftKey: true });
    expect(docToHtml(view.state.doc)).toBe('<pre>a\nb</pre>');
  });
});

describe('"[] " at the start of a line', () => {
  it('makes it a checklist line, unchecked', () => {
    const view = editor('<p></p>', '');
    typeText(view, '[] ');
    expect(docToHtml(view.state.doc)).toBe('<ul data-checklist="true"><li data-checked="false"></li></ul>');
  });

  it('carries on a checklist just above', () => {
    const view = editor('<ul data-checklist="true"><li data-checked="true">a</li></ul><p></p>', '');
    typeText(view, '[] ');
    expect(docToHtml(view.state.doc)).toBe('<ul data-checklist="true"><li data-checked="true">a</li><li data-checked="false"></li></ul>');
  });
});

describe('a list typed under another', () => {
  it('"- " under a checklist starts a list of its own', () => {
    const view = editor('<ul data-checklist="true"><li data-checked="false">todo</li></ul><p></p>', '');
    typeText(view, '- ');
    expect(docToHtml(view.state.doc)).toBe('<ul data-checklist="true"><li data-checked="false">todo</li></ul><ul><li></li></ul>');
  });

  it('"- " under a bulleted list carries it on', () => {
    const view = editor('<ul><li>a</li></ul><p></p>', '');
    typeText(view, '- ');
    expect(docToHtml(view.state.doc)).toBe('<ul><li>a</li><li></li></ul>');
  });
});

describe("a checklist line's mark", () => {
  function marked(html: string) {
    const registry = new MarkRegistry();
    const view = new EditorView(document.createElement('div'), {
      state: EditorState.create({ schema, doc: htmlToDoc(html), plugins: [checklistMarks(registry)] }),
    });
    const marks = () => registry.getSnapshot().map(([, m]) => ({ of: m.host.parentElement?.textContent, elementId: m.elementId, checked: m.checked }));
    return { view, registry, marks };
  }

  it('stands at the start of every checklist line, and of no other list', () => {
    const { marks } = marked('<ul data-checklist="true"><li data-checked="false">a</li><li data-checked="true">b</li><li data-element-id="e1">c</li></ul><ul><li>plain</li></ul>');
    expect(marks()).toEqual([
      { of: 'a', elementId: null, checked: false },
      { of: 'b', elementId: null, checked: true },
      { of: 'c', elementId: 'e1', checked: false },
    ]);
  });

  it('knows its line: checking from the mark checks that line', () => {
    const { view, registry, marks } = marked('<p>intro</p><ul data-checklist="true"><li data-checked="false">a</li><li data-checked="false">b</li></ul>');
    const second = registry.getSnapshot()[1][1];
    toggleChecked(second.getPos()! - 1)(view.state, view.dispatch);
    expect(docToHtml(view.state.doc)).toContain('<li data-checked="false">a</li><li data-checked="true">b</li>');
    expect(marks().map((m) => m.checked)).toEqual([false, true]);
  });

  it('is not part of what is saved, and goes when its line does', () => {
    const { view, marks } = marked('<ul data-checklist="true"><li data-checked="false">a</li><li data-checked="false">b</li></ul><p>x</p>');
    expect(docToHtml(view.state.doc)).toBe('<ul data-checklist="true"><li data-checked="false">a</li><li data-checked="false">b</li></ul><p>x</p>');
    view.dispatch(view.state.tr.delete(0, view.state.doc.firstChild!.nodeSize));
    expect(marks()).toEqual([]);
  });
});
