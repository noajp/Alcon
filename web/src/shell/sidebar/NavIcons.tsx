'use client';

import {
  Presentation,
  ShieldCheck,
  House,
  Table2,
  Settings,
  Inbox,
  Calendar,
  Notebook,
  ChartArea,
  ChartGantt,
  Users,
  Compass,
  Milestone,
  Telescope,
  Folder,
  Stone,
  Blocks,
} from 'lucide-react';
import { DomainIcon, ObjectIcon, ElementIcon, CrmIcon } from '@/Function/shared/conceptIcons';

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
export const NavSlidesIcon = ({ size = 20 }: { size?: number }) => <Presentation size={size} strokeWidth={2} />;
export const NavObjectsIcon = ObjectIcon;
export const NavSettingsIcon = ({ size = 20 }: { size?: number }) => <Settings size={size} strokeWidth={2} />;
export const NavMyTasksIcon = ElementIcon;
export const NavInboxIcon = ({ size = 20 }: { size?: number }) => <Inbox size={size} strokeWidth={2} />;
export const NavCalendarIcon = ({ size = 20 }: { size?: number }) => <Calendar size={size} strokeWidth={2} />;
export const NavNoteIcon = ({ size = 20 }: { size?: number }) => <Notebook size={size} strokeWidth={2} />;
export const NavDomainIcon = DomainIcon;
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <Compass size={size} strokeWidth={2} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <ChartArea size={size} strokeWidth={2} />;
// Milestone and ChartGantt ink only 18 of Lucide's 24 units where Compass,
// Layers and Box ink 20, so next to them they read a size smaller. Scaling
// the glyph inside its box keeps the row layout and evens the optical size.
export const NavTimelineIcon = ({ size = 20 }: { size?: number }) => <ChartGantt size={size} strokeWidth={2} className="scale-110" />;
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => <Users size={size} strokeWidth={2} />;
// ModeRail layer marks. Sustainment keeps the website's mark; currentColor follows the theme.
export const NavStrategyModeIcon = ({ size = 20 }: { size?: number }) => <Stone size={size} strokeWidth={2} />;
export const NavExecutionModeIcon = ({ size = 20 }: { size?: number }) => <Blocks size={size} strokeWidth={2} />;
export const NavSustainmentModeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.51} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 12C9 8 7.8 6.5 5.5 6.5a5.5 5.5 0 0 0 0 11C7.8 17.5 9 16 12 12s4.2-5.5 6.5-5.5a5.5 5.5 0 0 1 0 11C16.2 17.5 15 16 12 12Z" transform="translate(1.5 1.5) scale(.875)" />
  </svg>
);
// Strategy's units: the Vision above, its Portfolios of Initiatives below.
export const NavVisionIcon = ({ size = 20 }: { size?: number }) => <Telescope size={size} strokeWidth={2} />;
export const NavPortfolioIcon = ({ size = 20 }: { size?: number }) => <Folder size={size} strokeWidth={2} />;
// Phase — a Domain's period, reachable from an Initiative rather than the nav.
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} className="scale-110" />;

export const NavCrmIcon = CrmIcon;
// Audit — what an AI did, checked.
export const NavAuditIcon = ({ size = 20 }: { size?: number }) => <ShieldCheck size={size} strokeWidth={2} />;
