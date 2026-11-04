'use client';

import { DescriptionEditor } from '@/Function/shared/DescriptionEditor';
import { setActiveDomainId } from '@/Function/space/domainsStore';

import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ElementWithDetails, AlconObjectWithChildren } from '@/hooks/useSupabase';
import { updateObject } from '@/hooks/useSupabase';
import { ObjectIcon } from '@/shell/icons';
import { PageIcon, PAGE_TITLE, PAGE_TITLE_WEIGHT } from '@/Function/shared/PageHead';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  useBoard,
  WidgetSurface,
  WidgetZone,
  OBJECT_OVERVIEW_BOARD,
  type WidgetHost,
  type Zone,
} from '@/Function/widget';

/** Overview renders all three zones: a band above, the document column, the rail. */
const SURFACE_ZONES: Zone[] = ['band', 'main', 'rail'];

// =============================================================
// Object Overview — a document with a widget board around it.
//
// The spine is fixed and is NOT a widget: the Object's icon, its name, and
// its description. Those are the Object, not a view of it, and a surface
// whose every block can be removed has no identity left.
//
// Everything else — Properties, Strategy intent, Milestones —
// is a placed widget. The default board (`OBJECT_OVERVIEW_BOARD`) reproduces
// the hand-written layout block for block, so nothing moved when this became
// a board; what changed is that the blocks can now be rearranged, removed,
// and added to, and that any other surface can host the same ones.
// =============================================================

interface OverviewViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
  onRefresh?: () => void;
  onNavigate?: (nav: { objectId?: string | null; strategyId?: string }) => void;
  /** Switch the active top-level activity — the Strategy rows use this to
   *  jump out to the Strategy surface. */
  onViewChange?: (view: string) => void;
}

/**
 * Auto-grow a textarea to fit its content. Robust against the "measured
 * while the column was 0-width → wrapped into 14 lines → stuck at 400px"
 * bug: re-measures on `value` change AND whenever the element's WIDTH
 * changes (via ResizeObserver). Width-only guard prevents the height we
 * write from feeding back into an observer loop.
 */
function useAutoGrowTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    measure();
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w !== lastWidth) {
        lastWidth = w;
        measure();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, value]);
}

export function OverviewView({
  elements,
  object,
  onRefresh,
  onNavigate,
  onViewChange,
}: OverviewViewProps) {
  const { t } = useI18n();
  const explorerData = useExplorerData();
  // The name as an always-editable seamless textarea, mirroring
  // ElementDetailView's inline header (transparent, no border/ring,
  // auto-grow, save on blur — no Edit button, no view/edit toggle); the
  // description is the shared DescriptionEditor.
  const [title, setTitle] = useState(object.name);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrowTextarea(titleRef, title);

  // Re-sync from props when the Object switches or is saved elsewhere.
  useEffect(() => {
    setTitle(object.name);
  }, [object.id, object.name]);

  const handleTitleSave = async () => {
    const next = title.trim();
    if (next && next !== object.name) {
      try {
        await updateObject(object.id, { name: next });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save name:', err);
      }
    }
  };

  const handleDescriptionSave = async (description: string) => {
    if (description !== (object.description || '')) {
      try {
        await updateObject(object.id, { description: description || null });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to save description:', err);
      }
    }
  };

  const board = useBoard('object-overview', OBJECT_OVERVIEW_BOARD, object.id);

  const host = useMemo<WidgetHost>(
    () => ({
      subject: { kind: 'object', id: object.id },
      elements,
      object,
      explorerData,
      onRefresh,
      onNavigate: nav => {
        if (nav.domainId && !nav.objectId) {
          setActiveDomainId(nav.domainId);
          onNavigate?.({ objectId: null });
          onViewChange?.('domain-overview');
        } else onNavigate?.(nav);
      },
      onViewChange,
    }),
    [object, elements, explorerData, onRefresh, onNavigate, onViewChange],
  );

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-7xl mx-auto px-8 py-8">
        <WidgetSurface board={board} host={host} zones={SURFACE_ZONES}>
          {/* items-start: don't let the (often taller) rail stretch the main
              column. A stretched block column was the layout that made the
              title/description textareas mis-measure and balloon. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
            {/* ───────────── Main column ───────────── */}
            {/* pl-6: indent the editorial content off the left rail so it
                reads as a document rather than flush against the sidebar. */}
            <div className="space-y-6 min-w-0">
              {/* Icon stacked above the name; the name sits flush with the
                  column's left edge so it lines up with the description. */}
              <div>
                <PageIcon><ObjectIcon size={18} /></PageIcon>
                <textarea
                  ref={titleRef}
                  value={title}
                  rows={1}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      (e.currentTarget as HTMLTextAreaElement).blur();
                    }
                  }}
                  className={`w-full bg-transparent border-none resize-none overflow-hidden ${PAGE_TITLE}`}
                  style={PAGE_TITLE_WEIGHT}
                  placeholder={t('Object name')}
                />
                {/* Band — how it is going, right under the name (a progress
                    line by default), before anything is read. */}
                <WidgetZone zone="band" className="mt-3" />
              </div>

              <section>
                <DescriptionEditor key={object.id} value={object.description ?? ''}
                  placeholder={t('Add description…')} onSave={handleDescriptionSave} />
              </section>

              <WidgetZone zone="main" columns={1} />
            </div>

            {/* ───────────── Side column ───────────── */}
            <aside className="min-w-0">
              <WidgetZone zone="rail" />
            </aside>
          </div>
        </WidgetSurface>
      </div>
    </div>
  );
}
