// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { FRAGMENT, hashText, seedFromHtml } from '@/Function/notebook/pm/collab';
import { docToHtml } from '@/Function/notebook/pm/html';
import { schema } from '@/Function/notebook/pm/schema';

const html = '<h1>Plan</h1><ul data-checklist="true"><li data-element-id="e1">Ship</li></ul>';
const read = (doc: Y.Doc) => docToHtml(yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema));

describe('starting a shared Note', () => {
  it('fills an empty shared document with the saved body', () => {
    const doc = new Y.Doc();
    seedFromHtml(doc, html);
    expect(read(doc)).toBe(html);
  });

  it('two people starting at once end with one copy, not two', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedFromHtml(a, html);
    seedFromHtml(b, html);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(read(a)).toBe(html);
    expect(read(b)).toBe(html);
  });

  it('leaves a document someone is already editing alone', () => {
    const doc = new Y.Doc();
    seedFromHtml(doc, '<p>first</p>');
    seedFromHtml(doc, '<p>second</p>');
    expect(read(doc)).toBe('<p>first</p>');
  });

  it('hashes to a stable, non-zero id', () => {
    expect(hashText('x')).toBe(hashText('x'));
    expect(hashText('x')).not.toBe(hashText('y'));
    expect(hashText('')).toBeGreaterThan(0);
  });
});
