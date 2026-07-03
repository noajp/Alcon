'use client';

import {
  House, MessageSquare, Zap, Table2, Settings, Inbox, Calendar,
  LayoutDashboard, FileText, NotebookPen, Hash, BarChart3, Target,
  AlignLeft, Users, Share2, Search, Workflow,
} from 'lucide-react';
import { DomainIcon, ObjectIcon, ElementIcon } from '@/alcon/shared/conceptIcons';

// ── Nav / tab / item icons ───────────────────────────────────────────────
// Everything outside the ModeRail uses Lucide at strokeWidth 2. Lucide draws on
// a 24-unit grid, so the on-screen stroke = strokeWidth × renderSize / 24 — at
// 16px that's ~1.33px, which reads cleanly without looking hairline-thin (1.5
// would render ~1.0px). The ModeRail keeps Lucide's House for Home and the
// three custom layer brand glyphs (Action / Materialization / Execution) that
// encode the A/M/E product concept.
//
// The Execution units (Domain / Object / Element) don't redeclare their glyph
// here — they re-export the canonical concept icons from conceptIcons.tsx so
// the concept↔icon pairing lives in exactly one place.
export const NavHomeIcon = ({ size = 20 }: { size?: number }) => <House size={size} strokeWidth={2} />;
export const NavChatIcon = ({ size = 20 }: { size?: number }) => <MessageSquare size={size} strokeWidth={2} />;
export const NavActionsIcon = ({ size = 20 }: { size?: number }) => <Zap size={size} strokeWidth={2} />;
export const NavTableIcon = ({ size = 20 }: { size?: number }) => <Table2 size={size} strokeWidth={2} />;
export const NavObjectsIcon = ObjectIcon;
export const NavSettingsIcon = ({ size = 20 }: { size?: number }) => <Settings size={size} strokeWidth={2} />;
export const NavMyTasksIcon = ElementIcon;
export const NavInboxIcon = ({ size = 20 }: { size?: number }) => <Inbox size={size} strokeWidth={2} />;
export const NavCalendarIcon = ({ size = 20 }: { size?: number }) => <Calendar size={size} strokeWidth={2} />;
export const NavOverviewIcon = ({ size = 20 }: { size?: number }) => <LayoutDashboard size={size} strokeWidth={2} />;
export const NavNoteIcon = ({ size = 20 }: { size?: number }) => <FileText size={size} strokeWidth={2} />;
export const NavBriefIcon = ({ size = 20 }: { size?: number }) => <NotebookPen size={size} strokeWidth={2} />;
export const NavRoomIcon = ({ size = 20 }: { size?: number }) => <Hash size={size} strokeWidth={2} />;
export const NavDashboardIcon = ({ size = 20 }: { size?: number }) => <LayoutDashboard size={size} strokeWidth={2} />;
export const NavAnalysisIcon = ({ size = 20 }: { size?: number }) => <BarChart3 size={size} strokeWidth={2} />;
export const NavDomainIcon = DomainIcon;
export const NavSystemIcon = NavDomainIcon;
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <Target size={size} strokeWidth={2} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <AlignLeft size={size} strokeWidth={2} />;
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => <Users size={size} strokeWidth={2} />;
export const NavGraphIcon = ({ size = 20 }: { size?: number }) => <Share2 size={size} strokeWidth={2} />;
export const NavSearchIcon = ({ size = 20 }: { size?: number }) => <Search size={size} strokeWidth={2} />;
export const NavDiagramIcon = ({ size = 20 }: { size?: number }) => <Workflow size={size} strokeWidth={2} />;

// ── ModeRail custom layer brand glyphs (A / M / E) — kept ────────────────
// Dot-grid glyphs on a 48×48 canvas (fill-only, no stroke). The `active`
// overlay fills orange (--rail-active-icon) with a per-layer reveal
// animation (rail-anim-* in globals.css). Rendered larger than other rail
// icons (see ModeRail.tsx) since the dot pattern reads smaller at equal size.
export const NavActionIcon = ({ size = 20, active = false }: { size?: number; active?: boolean }) => {
  const glyph = (
    <g fill="currentColor" stroke="none">
      <rect x="21.7" y="5.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="18.45" y="11.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="24.95" y="11.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="15.2" y="18.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="28.2" y="18.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="11.95" y="24.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="31.45" y="24.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="8.7" y="31.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="15.2" y="31.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="28.2" y="31.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="34.7" y="31.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="5.45" y="37.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="11.95" y="37.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="18.45" y="37.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="24.95" y="37.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="31.45" y="37.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="37.95" y="37.7" width="4.6" height="4.6" rx="1.6"/>
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {/* gray base stays visible; orange reveals on top when active */}
      {glyph}
      {active && <g key="on" className="rail-anim-burst" style={{ color: 'var(--rail-active-icon)' }}>{glyph}</g>}
    </svg>
  );
};

export const NavMaterializationIcon = ({ size = 20, active = false }: { size?: number; active?: boolean }) => {
  const glyph = (
    <g fill="currentColor" stroke="none">
      <rect x="12.7" y="7.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="21.7" y="7.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="30.7" y="7.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="6.2" y="16.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="13.9" y="16.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="21.7" y="16.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="29.5" y="16.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="37.2" y="16.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="11.3" y="23.3" width="4.6" height="4.6" rx="1.6"/>
      <rect x="32.1" y="23.3" width="4.6" height="4.6" rx="1.6"/>
      <rect x="21.7" y="25.2" width="4.6" height="4.6" rx="1.6"/>
      <rect x="16.4" y="30.4" width="4.6" height="4.6" rx="1.6"/>
      <rect x="27" y="30.4" width="4.6" height="4.6" rx="1.6"/>
      <rect x="21.7" y="37.7" width="4.6" height="4.6" rx="1.6"/>
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {/* gray base stays visible; orange wipes in on top when active */}
      {glyph}
      {active && <g key="on" className="rail-anim-wipe" style={{ color: 'var(--rail-active-icon)' }}>{glyph}</g>}
    </svg>
  );
};

export const NavExecutionIcon = ({ size = 20, active = false }: { size?: number; active?: boolean }) => {
  const glyph = (
    <g fill="currentColor" stroke="none">
      <rect x="21.7" y="4.9" width="4.6" height="4.6" rx="1.6"/>
      <rect x="36.3" y="13.3" width="4.6" height="4.6" rx="1.6"/>
      <rect x="36.3" y="30.1" width="4.6" height="4.6" rx="1.6"/>
      <rect x="21.7" y="38.5" width="4.6" height="4.6" rx="1.6"/>
      <rect x="7.1" y="30.1" width="4.6" height="4.6" rx="1.6"/>
      <rect x="7.1" y="13.3" width="4.6" height="4.6" rx="1.6"/>
      <rect x="29" y="9.1" width="4.6" height="4.6" rx="1.6"/>
      <rect x="36.3" y="21.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="29" y="34.3" width="4.6" height="4.6" rx="1.6"/>
      <rect x="14.4" y="34.3" width="4.6" height="4.6" rx="1.6"/>
      <rect x="7.1" y="21.7" width="4.6" height="4.6" rx="1.6"/>
      <rect x="14.4" y="9.1" width="4.6" height="4.6" rx="1.6"/>
      <rect x="21.7" y="15.3" width="4.6" height="4.6" rx="1.6" transform="rotate(45 24 17.6)"/>
      <rect x="28.1" y="21.7" width="4.6" height="4.6" rx="1.6" transform="rotate(45 30.4 24)"/>
      <rect x="21.7" y="28.1" width="4.6" height="4.6" rx="1.6" transform="rotate(45 24 30.4)"/>
      <rect x="15.3" y="21.7" width="4.6" height="4.6" rx="1.6" transform="rotate(45 17.6 24)"/>
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {/* gray base stays visible; orange bursts in on top when active */}
      {glyph}
      {active && <g key="on" className="rail-anim-burst" style={{ color: 'var(--rail-active-icon)' }}>{glyph}</g>}
    </svg>
  );
};
