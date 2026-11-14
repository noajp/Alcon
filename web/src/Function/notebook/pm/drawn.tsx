'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { Decoration, EditorView, NodeView, ViewMutationRecord } from 'prosemirror-view';
import { Pencil, X } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { renderMermaid } from '@/Function/shared/MermaidDiagram';
import { parseEmbed, useEmbedHost } from '../editor/embedBlocks';
import { FILE_VIEW, FileBlock } from '../editor/fileBlocks';
import { isDrawnBlock } from './schema';

// A code block that is drawn rather than read: a ```mermaid diagram, or a
// ```clayware live view or file. Its source stays the block's text (that is
// what is saved and what everyone edits together); the drawing stands in its
// place and the source shows while the caret is in it.

interface Drawn {
  host: HTMLElement;
  lang: string;
  source: string;
  editing: boolean;
  /** Puts the caret at the end of the source. */
  edit: () => void;
  remove: () => void;
}

/** The drawn blocks of one editor, for it to draw into. */
export class DrawnRegistry {
  private items = new Map<number, Drawn>();
  private snapshot: [number, Drawn][] = [];
  private listeners = new Set<() => void>();
  private next = 1;

  add(item: Drawn): number { const key = this.next++; this.items.set(key, item); this.changed(); return key; }
  update(key: number, patch: Partial<Drawn>) {
    const prev = this.items.get(key);
    if (!prev) return;
    if (Object.entries(patch).every(([k, v]) => prev[k as keyof Drawn] === v)) return;
    this.items.set(key, { ...prev, ...patch });
    this.changed();
  }
  remove(key: number) { if (this.items.delete(key)) this.changed(); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snapshot;
  private changed() { this.snapshot = [...this.items]; for (const fn of this.listeners) fn(); }
}

const isEditing = (decorations: readonly Decoration[]) =>
  decorations.some((d) => (d as unknown as { spec?: { editing?: boolean } }).spec?.editing);

class DrawnView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private host: HTMLElement;
  private key: number;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined,
    decorations: readonly Decoration[], private registry: DrawnRegistry) {
    this.dom = document.createElement('div');
    this.dom.className = 'note-drawn';
    this.contentDOM = document.createElement('pre');
    this.contentDOM.setAttribute('data-lang', node.attrs.lang as string);
    this.host = document.createElement('div');
    this.host.className = 'note-drawn-view';
    this.host.contentEditable = 'false';
    this.dom.append(this.contentDOM, this.host);
    const editing = isEditing(decorations);
    this.dom.classList.toggle('is-editing', editing);
    this.key = registry.add({
      host: this.host, lang: node.attrs.lang as string, source: node.textContent, editing,
      edit: () => this.edit(), remove: () => this.removeNode(),
    });
  }

  private edit() {
    const pos = this.getPos();
    if (pos === undefined) return;
    const end = pos + 1 + this.node.content.size;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc, end)));
    this.view.focus();
  }

  private removeNode() {
    const pos = this.getPos();
    if (pos === undefined) return;
    this.view.dispatch(this.view.state.tr.delete(pos, pos + this.node.nodeSize));
    this.view.focus();
  }

  update(node: PMNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type || node.attrs.lang !== this.node.attrs.lang) return false;
    this.node = node;
    const editing = isEditing(decorations);
    this.dom.classList.toggle('is-editing', editing);
    this.registry.update(this.key, { source: node.textContent, editing });
    return true;
  }

  stopEvent(event: Event) { return this.host.contains(event.target as Node); }

  ignoreMutation(m: ViewMutationRecord) {
    if (m.type === 'selection') return false;
    return this.host.contains(m.target) || (m.target === this.dom && m.type === 'attributes');
  }

  destroy() { this.registry.remove(this.key); }
}

/** nodeViews entry: drawn code blocks get a drawing; the rest stay code. */
export function drawnNodeView(registry: DrawnRegistry) {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined, decorations: readonly Decoration[]) =>
    (isDrawnBlock(node) ? new DrawnView(node, view, getPos, decorations, registry) : (null as unknown as NodeView));
}

/** Draws every drawn block of one editor into its place. */
export function DrawnBlocks({ registry, editable }: { registry: DrawnRegistry; editable: boolean }) {
  const items = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return <>{items.map(([key, item]) => createPortal(<DrawnBlock item={item} editable={editable} />, item.host, String(key)))}</>;
}

function DrawnBlock({ item, editable }: { item: Drawn; editable: boolean }) {
  if (item.editing) return null;
  return item.lang === 'mermaid'
    ? <MermaidDrawing source={item.source} onEdit={editable ? item.edit : undefined} />
    : <EmbedDrawing source={item.source} editable={editable} onEdit={item.edit} onRemove={item.remove} />;
}

function MermaidDrawing({ source, onEdit }: { source: string; onEdit?: () => void }) {
  const { t } = useI18n();
  const [out, setOut] = useState<{ source: string; svg?: string; error?: string } | null>(null);
  useEffect(() => {
    if (!source.trim()) return;
    let live = true;
    void renderMermaid(source).then((r) => { if (live) setOut({ source, ...r }); });
    return () => { live = false; };
  }, [source]);
  const drawn = out?.source === source ? out : null;
  return (
    <div role="button" tabIndex={-1} title={t('Edit the diagram')}
      onMouseDown={(e) => { if (!onEdit) return; e.preventDefault(); onEdit(); }}
      className="flex min-h-11 cursor-text justify-center overflow-x-auto rounded-md bg-card px-3 py-2 [&_svg]:h-auto [&_svg]:max-w-full">
      {!source.trim() ? <p className="w-full text-[12px] text-muted-foreground">{t('Edit the diagram')}</p>
        : drawn?.svg
          // Mermaid's own sanitized SVG (securityLevel: 'strict').
          ? <div className="flex w-full justify-center" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
          : drawn?.error ? <p className="w-full text-[12px] text-[var(--status-danger)]">{t('Could not draw the diagram. Click to edit its source.')}</p>
            : <div className="h-11 w-full" />}
    </div>
  );
}

function EmbedDrawing({ source, editable, onEdit, onRemove }: { source: string; editable: boolean; onEdit: () => void; onRemove: () => void }) {
  const { t } = useI18n();
  const host = useEmbedHost();
  const spec = parseEmbed(source);
  return (
    <div className="group/embed relative rounded-md bg-card">
      {!spec ? <p className="px-3 py-2 text-[12px] text-[var(--status-danger)]">{t('This block cannot be read. Edit its source.')}</p>
        : spec.view === FILE_VIEW ? (typeof spec.id === 'string' ? <FileBlock id={spec.id} /> : null)
          : host ? host.render(spec)
            : <p className="px-3 py-2 text-[12px] text-muted-foreground">{t('This block shows on its own page.')}</p>}
      {editable && (
        <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/embed:opacity-100">
          <button type="button" title={t('Edit the source')} aria-label={t('Edit the source')}
            onMouseDown={(e) => { e.preventDefault(); onEdit(); }}
            className="flex size-6 items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil size={13} /></button>
          <button type="button" title={t('Remove the block')} aria-label={t('Remove the block')}
            onMouseDown={(e) => { e.preventDefault(); onRemove(); }}
            className="flex size-6 items-center justify-center rounded-md bg-card text-muted-foreground hover:bg-muted hover:text-foreground"><X size={13} /></button>
        </div>
      )}
    </div>
  );
}
