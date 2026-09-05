'use client';

import {
  House, Table2, Settings, Inbox, Calendar,
  LayoutDashboard, Notebook, BarChart3,
  ChartArea, ChartGantt, Users, Share2, Search, Workflow, Compass, Milestone,
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
export const NavTableIcon = ({ size = 20 }: { size?: number }) => <Table2 size={size} strokeWidth={2} />;
export const NavObjectsIcon = ObjectIcon;
export const NavSettingsIcon = ({ size = 20 }: { size?: number }) => <Settings size={size} strokeWidth={2} />;
export const NavMyTasksIcon = ElementIcon;
export const NavInboxIcon = ({ size = 20 }: { size?: number }) => <Inbox size={size} strokeWidth={2} />;
export const NavCalendarIcon = ({ size = 20 }: { size?: number }) => <Calendar size={size} strokeWidth={2} />;
export const NavOverviewIcon = ({ size = 20 }: { size?: number }) => <LayoutDashboard size={size} strokeWidth={2} />;
export const NavNoteIcon = ({ size = 20 }: { size?: number }) => <Notebook size={size} strokeWidth={2} />;
export const NavDashboardIcon = ({ size = 20 }: { size?: number }) => <LayoutDashboard size={size} strokeWidth={2} />;
export const NavAnalysisIcon = ({ size = 20 }: { size?: number }) => <BarChart3 size={size} strokeWidth={2} />;
export const NavDomainIcon = DomainIcon;
export const NavSystemIcon = NavDomainIcon;
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <Compass size={size} strokeWidth={2} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <ChartArea size={size} strokeWidth={2} />;
export const NavTimelineIcon = ({ size = 20 }: { size?: number }) => <ChartGantt size={size} strokeWidth={2} />;
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => <Users size={size} strokeWidth={2} />;
export const NavGraphIcon = ({ size = 20 }: { size?: number }) => <Share2 size={size} strokeWidth={2} />;
export const NavSearchIcon = ({ size = 20 }: { size?: number }) => <Search size={size} strokeWidth={2} />;
export const NavDiagramIcon = ({ size = 20 }: { size?: number }) => <Workflow size={size} strokeWidth={2} />;
// ModeRail layer marks: direction, forward action, and continuity.
// Geometry matches the approved website marks; currentColor follows the theme.
export const NavStrategyModeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.22 19.95 21.3H4.05L12 2.22ZM12 4.3 5.25 20.5H15.646L12 4.3Z" fill="currentColor" fillRule="evenodd" />
  </svg>
);
export const NavExecutionModeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3 4 8 8-8 8M13 4l8 8-8 8" />
  </svg>
);
export const NavSustainmentModeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.51} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 12C9 8 7.8 6.5 5.5 6.5a5.5 5.5 0 0 0 0 11C7.8 17.5 9 16 12 12s4.2-5.5 6.5-5.5a5.5 5.5 0 0 1 0 11C16.2 17.5 15 16 12 12Z" transform="translate(1.5 1.5) scale(.875)" />
  </svg>
);
// Strategy's nested sub-view.
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} />;
