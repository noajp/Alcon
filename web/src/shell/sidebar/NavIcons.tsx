'use client';

import {
  GalleryHorizontal,
  ShieldCheck,
  House,
  Grid2x2,
  Settings,
  Inbox,
  Calendar,
  BookOpen,
  ChartNoAxesColumn,
  ChartGantt,
  Infinity as InfinityIcon,
  Compass,
  Milestone,
  Telescope,
  Folder,
  Stone,
  MessageCircle,
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
export const NavTableIcon = ({ size = 20 }: { size?: number }) => <Grid2x2 size={size} strokeWidth={2} />;
export const NavSlidesIcon = ({ size = 20 }: { size?: number }) => <GalleryHorizontal size={size} strokeWidth={2} />;
export const NavObjectsIcon = ObjectIcon;
export const NavSettingsIcon = ({ size = 20 }: { size?: number }) => <Settings size={size} strokeWidth={2} />;
export const NavMyTasksIcon = ElementIcon;
export const NavInboxIcon = ({ size = 20 }: { size?: number }) => <Inbox size={size} strokeWidth={2} />;
export const NavCalendarIcon = ({ size = 20 }: { size?: number }) => <Calendar size={size} strokeWidth={2} />;
export const NavNoteIcon = ({ size = 20 }: { size?: number }) => <BookOpen size={size} strokeWidth={2} />;
export const NavDomainIcon = DomainIcon;
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <Compass size={size} strokeWidth={2} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <ChartNoAxesColumn size={size} strokeWidth={2} />;
// Milestone and ChartGantt ink only 18 of Lucide's 24 units where Compass,
// Layers and Box ink 20, so next to them they read a size smaller. Scaling
// the glyph inside its box keeps the row layout and evens the optical size.
export const NavTimelineIcon = ({ size = 20 }: { size?: number }) => <ChartGantt size={size} strokeWidth={2} className="scale-110" />;
// Lucide's user-group, which arrived after the lucide-react version pinned
// here; the paths are Lucide's own (ISC).
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17 21v-1a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v1M19 10h1a2 2 0 0 1 2 2v1M5 10H4a2 2 0 0 0-2 2v1" />
    <circle cx="12" cy="11" r="3" /><circle cx="18" cy="4" r="2" /><circle cx="6" cy="4" r="2" />
  </svg>
);
// ModeRail layer marks.
export const NavStrategyModeIcon = ({ size = 20 }: { size?: number }) => <Stone size={size} strokeWidth={2} />;
export const NavExecutionModeIcon = ({ size = 20 }: { size?: number }) => <Blocks size={size} strokeWidth={2} />;
export const NavSustainmentModeIcon = ({ size = 20 }: { size?: number }) => <InfinityIcon size={size} strokeWidth={2} />;
// Strategy's units: the Vision above, its Portfolios of Initiatives below.
export const NavVisionIcon = ({ size = 20 }: { size?: number }) => <Telescope size={size} strokeWidth={2} />;
export const NavPortfolioIcon = ({ size = 20 }: { size?: number }) => <Folder size={size} strokeWidth={2} />;
// Phase — a Domain's period, reachable from an Initiative rather than the nav.
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} className="scale-110" />;

export const NavCrmIcon = CrmIcon;
// AI — the conversation, as a pop-up or a screen of its own.
export const NavAiIcon = ({ size = 20 }: { size?: number }) => <MessageCircle size={size} strokeWidth={2} />;
// Audit — what an AI did, checked.
export const NavAuditIcon = ({ size = 20 }: { size?: number }) => <ShieldCheck size={size} strokeWidth={2} />;
