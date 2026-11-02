'use client';

import {
  GalleryHorizontal,
  ShieldCheck,
  House,
  Grid2x2,
  Settings,
  Bell,
  Calendar,
  BookOpen,
  ChartNoAxesColumn,
  ChartGantt,
  Grip,
  Spearhead,
  Milestone,
  GuidingStar,
  Portfolio,
  CompassRose,
  Layers,
  Users,
  AiGraph,
} from '@/ui/icons';
import { DomainIcon, ObjectIcon, ElementIcon, FilesIcon } from '@/Function/shared/conceptIcons';

// ── Nav / tab / item icons ───────────────────────────────────────────────
// Alcon's own glyphs (ui/icons): solid shapes on a 16-unit grid, the same
// family as every other icon in the app.
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
export const NavInboxIcon = ({ size = 20 }: { size?: number }) => <Bell size={size} strokeWidth={2} />;
export const NavCalendarIcon = ({ size = 20 }: { size?: number }) => <Calendar size={size} strokeWidth={2} />;
export const NavNoteIcon = ({ size = 20 }: { size?: number }) => <BookOpen size={size} strokeWidth={2} />;
export const NavDomainIcon = DomainIcon;
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <Spearhead size={size} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <ChartNoAxesColumn size={size} strokeWidth={2} />;
export const NavTimelineIcon = ({ size = 20 }: { size?: number }) => <ChartGantt size={size} strokeWidth={2} />;
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => <Users size={size} />;
// ModeRail layer marks.
export const NavStrategyModeIcon = ({ size = 20 }: { size?: number }) => <CompassRose size={size} />;
export const NavExecutionModeIcon = ({ size = 20 }: { size?: number }) => <Layers size={size} strokeWidth={2} />;
export const NavSustainmentModeIcon = ({ size = 20 }: { size?: number }) => <Grip size={size} strokeWidth={2} />;
// Strategy's units: the Vision above, its Portfolios of Initiatives below.
export const NavVisionIcon = ({ size = 20 }: { size?: number }) => <GuidingStar size={size} />;
export const NavPortfolioIcon = ({ size = 20 }: { size?: number }) => <Portfolio size={size} />;
// Phase — a Domain's period, reachable from an Initiative rather than the nav.
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} />;

export const NavFilesIcon = FilesIcon;
// AI — the conversation, as a pop-up or a screen of its own.
export const NavAiIcon = ({ size = 20 }: { size?: number }) => <AiGraph size={size} />;
// Audit — what an AI did, checked.
export const NavAuditIcon = ({ size = 20 }: { size?: number }) => <ShieldCheck size={size} strokeWidth={2} />;
