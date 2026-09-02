import type { ComponentType } from 'react';
import type {
  ExplorerData,
  ElementWithDetails,
  AlconObjectWithChildren,
} from '@/hooks/useSupabase';

// =============================================================
// Widget system — types
//
// A widget is a framed block a surface can host, move and remove. The model
// is deliberately two-axis:
//
//   Subject   what the board is ABOUT (an Object, a Campaign, a Phase, me).
//             NOT which screen it is on. A widget declares the subject kinds
//             it can render, so adding a surface costs zero widget edits —
//             the old system enumerated view names, so every new screen
//             meant touching every definition.
//
//   Zone      WHERE on the surface it sits — a full-width band above the
//             content, the main column, or the side rail. A widget declares
//             the zones it fits; the zone decides the frame it wears.
//
// Everything else (the frame, the picker, drag, remove) is shared, so a new
// widget is one file plus one registry entry.
// =============================================================

/** What a board is about. The subject is supplied by the host surface. */
export type SubjectKind = 'me' | 'domain' | 'object' | 'element' | 'campaign' | 'phase';

/** Where on a surface a widget sits. */
export type Zone = 'band' | 'main' | 'rail';

/** Width within its zone. Only the `main` zone is two columns wide. */
export type WidgetSize = 'half' | 'full';

/**
 * The chrome a widget wears. Not a free choice — it follows from the zone
 * (see ZONE_VARIANT), because a rail island and a main-column section are
 * two established looks in this app and mixing them per widget is how a
 * surface starts looking assembled rather than designed.
 */
export type FrameVariant = 'island' | 'section' | 'band';

export const ZONE_VARIANT: Record<Zone, FrameVariant> = {
  band: 'band',
  main: 'section',
  rail: 'island',
};

/** Grouping in the picker. Sentence-case labels live in WidgetPicker. */
export type WidgetGroup = 'core' | 'progress' | 'chart' | 'list' | 'plan';

export interface WidgetSubject {
  kind: SubjectKind;
  /** null for subjects that are not a row in a table (`me`). */
  id: string | null;
}

/**
 * What every widget is handed.
 *
 * The host resolves the subject — it already has the Object and its Elements
 * loaded — and passes that down. Anything else a widget needs (Workers,
 * Domains, custom columns, Campaigns) it fetches itself through `hooks/`.
 * That line is what keeps this from becoming the grab-bag the old
 * `WidgetContext` was turning into, where every new subject kind grew the
 * context for every existing widget.
 */
export interface WidgetHost {
  subject: WidgetSubject;
  /** Elements in the subject's scope. Empty for subjects that have none. */
  elements: ElementWithDetails[];
  /** Present when the subject is an Object. */
  object?: AlconObjectWithChildren;
  /** Present on space-wide boards (Home). */
  explorerData?: ExplorerData;
  onRefresh?: () => void;
  onNavigate?: (nav: { objectId?: string; strategyId?: string; domainId?: string | null }) => void;
  onViewChange?: (view: string) => void;
}

export type WidgetComponent = ComponentType<{ host: WidgetHost }>;

export interface WidgetDefinition {
  type: string;
  /** Frame title. Written as displayed — sentence case, never uppercased. */
  label: string;
  description?: string;
  group: WidgetGroup;
  /** Subject kinds this widget can render. */
  accepts: SubjectKind[];
  /** Zones it fits. A widget in two zones wears two different frames. */
  zones: Zone[];
  defaultSize?: WidgetSize;
  /** Only one instance per board (Properties, Description-like widgets). */
  singleton?: boolean;
  /**
   * False when the body draws its own edges — a full-bleed table, a chart.
   * The frame then supplies the border and nothing else.
   */
  padded?: boolean;
  /**
   * Lazy component. The definition owning its own import is what removed the
   * central `renderWidget` switch — every widget now code-splits by default
   * instead of one chart being special-cased.
   */
  load: () => Promise<WidgetComponent>;
}

/** One placed widget. `id` is per-instance so a board can hold two of a kind. */
export interface WidgetInstance {
  id: string;
  type: string;
  size?: WidgetSize;
}

export type BoardLayout = Record<Zone, WidgetInstance[]>;

export interface StoredBoard {
  version: number;
  zones: BoardLayout;
  /** Singleton types the user removed on purpose — see `reconcileBoard`. */
  dismissed?: string[];
}

export const ZONES: Zone[] = ['band', 'main', 'rail'];

export function emptyLayout(): BoardLayout {
  return { band: [], main: [], rail: [] };
}
