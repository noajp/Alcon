'use client';

import {
  House, MessageSquare, Zap, Table2, Settings, Inbox, Calendar,
  LayoutDashboard, Notebook, NotebookPen, Hash, BarChart3,
  AlignLeft, Users, Share2, Search, Workflow, Compass, ListTree, Milestone, Pyramid,
} from 'lucide-react';
import { DomainIcon, ObjectIcon, ElementIcon } from '@/alcon/shared/conceptIcons';

// ── Nav / tab / item icons ───────────────────────────────────────────────
// Everything uses Lucide at strokeWidth 2. Lucide draws on a 24-unit grid, so
// the on-screen stroke = strokeWidth × renderSize / 24 — at 16px that's
// ~1.33px, which reads cleanly without looking hairline-thin (1.5 would
// render ~1.0px).
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
export const NavNoteIcon = ({ size = 20 }: { size?: number }) => <Notebook size={size} strokeWidth={2} />;
export const NavBriefIcon = ({ size = 20 }: { size?: number }) => <NotebookPen size={size} strokeWidth={2} />;
export const NavRoomIcon = ({ size = 20 }: { size?: number }) => <Hash size={size} strokeWidth={2} />;
export const NavDashboardIcon = ({ size = 20 }: { size?: number }) => <LayoutDashboard size={size} strokeWidth={2} />;
export const NavAnalysisIcon = ({ size = 20 }: { size?: number }) => <BarChart3 size={size} strokeWidth={2} />;
export const NavDomainIcon = DomainIcon;
export const NavSystemIcon = NavDomainIcon;
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <Compass size={size} strokeWidth={2} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <AlignLeft size={size} strokeWidth={2} />;
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => <Users size={size} strokeWidth={2} />;
export const NavGraphIcon = ({ size = 20 }: { size?: number }) => <Share2 size={size} strokeWidth={2} />;
export const NavSearchIcon = ({ size = 20 }: { size?: number }) => <Search size={size} strokeWidth={2} />;
export const NavDiagramIcon = ({ size = 20 }: { size?: number }) => <Workflow size={size} strokeWidth={2} />;
export const NavApproachIcon = ({ size = 20 }: { size?: number }) => <Pyramid size={size} strokeWidth={2} />;
export const NavPlanningIcon = ({ size = 20 }: { size?: number }) => <ListTree size={size} strokeWidth={2} />;
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} />;

// ── Layer brand glyphs (A / M / E) ────────────────────────────────────────
// Dot-grid glyphs on a 48×48 canvas (fill-only, no stroke). Used as small
// icons next to the Action / Materialization / Execution section headers in
// the sidebar.
export const NavActionIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="currentColor" stroke="none">
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
  </svg>
);

export const NavMaterializationIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="currentColor" stroke="none">
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
  </svg>
);

export const NavExecutionIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="currentColor" stroke="none">
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
  </svg>
);
