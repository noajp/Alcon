import type React from 'react';
import { VIEW_REGISTRY, type ViewId } from '@/shell/viewRegistry';
import { NavHomeIcon, NavActivityIcon, NavMaterializationIcon, NavExecutionIcon } from '@/shell/sidebar/NavIcons';

// The three-layer spine of the product, plus Home. Each layer is a stage in
// the descent from abstract to concrete:
//
//   Home → Activity → Materialization → Execution
//   (活動行為)      (具体化行為)         (実行行為)
//
// The ModeRail picks the LAYER (A / M / E + Home); the sidebar's grid
// launcher picks the APP within the active layer. `AppTab.activeView`
// still holds the concrete view id — a layer is just the grouping above it.

export type LayerId = 'home' | 'activity' | 'materialization' | 'execution';

export interface LayerApp {
  /** The activity view this app maps to (what MainContent switches on). */
  view: ViewId;
  /** Launcher label — may differ from the registry label (e.g. Talk → room). */
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

export interface LayerMeta {
  id: LayerId;
  /** Single-letter glyph shown in the ModeRail as fallback. */
  letter: string;
  label: string;
  /** Icon shown in the ModeRail. `active` triggers the selected orange animation. */
  icon: React.ComponentType<{ size?: number; active?: boolean }>;
  /** App the layer opens to when it has no remembered last app. */
  defaultApp: ViewId;
  apps: LayerApp[];
}

const app = (view: ViewId, label?: string): LayerApp => ({
  view,
  label: label ?? VIEW_REGISTRY[view].label,
  icon: VIEW_REGISTRY[view].icon!,
});

export const LAYERS: LayerMeta[] = [
  {
    // Home's surfaces (My Elements / Inbox) are listed directly in the sidebar
    // as nav rows — switching between them is a sidebar click, not a launcher
    // choice — so it has no launcher grid.
    id: 'home',
    letter: 'H',
    label: 'Home',
    icon: NavHomeIcon,
    defaultApp: 'my-elements',
    apps: [],
  },
  {
    id: 'activity',
    letter: 'A',
    label: 'Activity',
    icon: NavActivityIcon,
    defaultApp: 'chat',
    apps: [app('chat'), app('room', 'Talk')],
  },
  {
    id: 'materialization',
    letter: 'M',
    label: 'Materialization',
    icon: NavMaterializationIcon,
    defaultApp: 'note',
    apps: [app('note'), app('strategy'), app('diagram')],
  },
  {
    // Execution is a single surface (the Domain tree), not a set of swappable
    // apps — so it has no launcher grid. defaultApp is where the ModeRail
    // button lands.
    id: 'execution',
    letter: 'E',
    label: 'Execution',
    icon: NavExecutionIcon,
    defaultApp: 'projects',
    apps: [],
  },
];

// view → layer. Built from each layer's apps, then extended with the views
// that aren't launcher apps but still belong to a layer's surface (Data /
// Reference live under Execution; the 'home' placeholder under Home).
const VIEW_TO_LAYER: Record<string, LayerId> = (() => {
  const map: Record<string, LayerId> = {};
  for (const layer of LAYERS) {
    for (const a of layer.apps) map[a.view] = layer.id;
  }
  // Home surfaces — no launcher apps, mapped here directly.
  map.home = 'home';
  map['my-elements'] = 'home';
  map.inbox = 'home';
  map.notes = 'materialization';
  map.brief = 'materialization';
  // Execution surfaces — no launcher apps, so they're mapped here directly.
  map.projects = 'execution';
  map.mytasks = 'execution';
  map.domains = 'execution';
  map.actions = 'execution';
  map.tables = 'execution';
  map.reference = 'execution';
  return map;
})();

/** The layer a view belongs to, or null for layer-less surfaces (settings). */
export function layerOf(view: string): LayerId | null {
  return VIEW_TO_LAYER[view] ?? null;
}

export function getLayer(id: LayerId): LayerMeta {
  return LAYERS.find((l) => l.id === id)!;
}
