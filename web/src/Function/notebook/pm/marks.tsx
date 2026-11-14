'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { ElementProgressMark, getElementProgress } from '@/Function/shared/ElementProgressMark';
import { StatusPicker } from '@/Function/shared/StatusPicker';
import { statusLabel } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { refreshElementById, useElementById } from '@/hooks/elementData';
import type { ElementWithDetails } from '@/hooks/useSupabase';
import type { ElementStatus } from '@/types/database';
import { Portals } from './portals';
import { schema } from './schema';

// The mark a checklist line begins with is the app's Status mark, and works
// as Status does. A line made into an Element shows that Element's status and
// opens its Status menu. A line that is not an Element yet is a task waiting:
// Backlog, or Done once checked — clicking it checks it.

/** One line's mark: the place it is drawn, and which line it is. */
export interface LineMark {
  host: HTMLElement;
  elementId: string | null;
  checked: boolean;
  /** Where the mark stands: just inside its list item. */
  getPos: () => number | undefined;
}

/** The marks of one editor, for it to draw into. */
export class MarkRegistry extends Portals<LineMark> {}

const marksKey = new PluginKey<DecorationSet>('note-checklist-marks');
const { bullet_list, list_item } = schema.nodes;

/** Gives every checklist line a place for its mark, at the line's start. */
export function checklistMarks(registry: MarkRegistry): Plugin<DecorationSet> {
  const keys = new WeakMap<Node, number>();
  const build = (doc: PMNode) => {
    const decos: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type !== bullet_list || !node.attrs.checklist) return true;
      node.forEach((item, offset) => {
        if (item.type !== list_item) return;
        const elementId = (item.attrs.elementId as string | null) || null;
        const checked = item.attrs.checked === true;
        decos.push(Decoration.widget(pos + 1 + offset + 1, (_view, getPos) => {
          const host = document.createElement('span');
          host.className = 'note-mark';
          host.contentEditable = 'false';
          keys.set(host, registry.add({ host, elementId, checked, getPos }));
          return host;
        }, {
          side: -1,
          ignoreSelection: true,
          // The same line in the same state keeps its mark as the text around it changes.
          key: `mark:${elementId ?? ''}:${checked ? 1 : 0}`,
          stopEvent: () => true,
          destroy: (dom) => { const key = keys.get(dom); if (key !== undefined) registry.remove(key); },
        }));
      });
      return true;
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin<DecorationSet>({
    key: marksKey,
    state: {
      init: (_config, state) => build(state.doc),
      apply: (tr, prev) => (tr.docChanged ? build(tr.doc) : prev),
    },
    props: { decorations: (state) => marksKey.getState(state) },
  });
}

const MARK_BUTTON = 'flex size-4 items-center justify-center rounded-md transition-colors hover:bg-muted/40';

/** Draws every checklist line's mark into its place. */
export function ChecklistMarks({ registry, editable, elementsById, onToggle }: {
  registry: MarkRegistry;
  editable: boolean;
  /** The Elements the page already holds, by id (their lines read them live from here). */
  elementsById?: Record<string, ElementWithDetails>;
  /** Checks or unchecks a line that is not an Element. */
  onToggle: (mark: LineMark) => void;
}) {
  const marks = useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
  return <>{marks.map(([key, mark]) => createPortal(
    mark.elementId
      ? <ElementMark id={mark.elementId} known={elementsById?.[mark.elementId]} editable={editable} />
      : <TaskMark checked={mark.checked} editable={editable} onToggle={() => onToggle(mark)} />,
    mark.host, String(key),
  ))}</>;
}

/** A line that is not an Element: Backlog, or Done once checked. */
function TaskMark({ checked, editable, onToggle }: { checked: boolean; editable: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const mark = <ElementProgressMark status={checked ? 'done' : 'backlog'} size={16} />;
  if (!editable) return mark;
  const label = t(checked ? 'Mark as not done' : 'Mark as done');
  return (
    <button type="button" tabIndex={-1} title={label} aria-label={label} aria-pressed={checked} className={MARK_BUTTON}
      onMouseDown={(e) => { e.preventDefault(); onToggle(); }}>
      {mark}
    </button>
  );
}

/** A line made into an Element: its status, and its Status menu. */
function ElementMark({ id, known, editable }: { id: string; known?: ElementWithDetails; editable: boolean }) {
  const { t } = useI18n();
  // A page that holds the Element shows it live from there; elsewhere it is read by id.
  const read = useElementById(known ? null : id);
  const element = known ?? read.element;
  const status = (element?.status ?? 'backlog') as ElementStatus;
  const mark = (
    <ElementProgressMark status={status} size={16}
      progress={element ? getElementProgress(element as ElementWithDetails) : 0} />
  );
  if (!element || !editable) return mark;
  return (
    <StatusPicker element={element as ElementWithDetails} onChanged={() => refreshElementById(id)}
      trigger={(
        <button type="button" tabIndex={-1} className={MARK_BUTTON}
          title={t('Status: {value}', { value: t(statusLabel(status)) })}>
          {mark}
        </button>
      )} />
  );
}
