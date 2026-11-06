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
  Milestone,
  GuidingStar,
  CompassRose,
  Users,
  AiGraph,
  Zap,
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
// A Strategy's mark: the guiding star — what it aims for.
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <GuidingStar size={size} className={className} />
);
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => <ChartNoAxesColumn size={size} strokeWidth={2} />;
export const NavTimelineIcon = ({ size = 20 }: { size?: number }) => <ChartGantt size={size} strokeWidth={2} />;
export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => <Users size={size} />;
// Automation — what runs on its own.
export const NavAutomationIcon = ({ size = 20 }: { size?: number }) => <Zap size={size} strokeWidth={2} />;
// The Workspace mode's mark (command palette, mode metadata).
export const NavStrategyModeIcon = ({ size = 20 }: { size?: number }) => <CompassRose size={size} />;
// Phase — a Domain's period, reachable from a Strategy rather than the nav.
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} />;

export const NavFilesIcon = FilesIcon;
// AI — the conversation, as a pop-up or a screen of its own.
export const NavAiIcon = ({ size = 20 }: { size?: number }) => <AiGraph size={size} />;
// Audit — what an AI did, checked.
export const NavAuditIcon = ({ size = 20 }: { size?: number }) => <ShieldCheck size={size} strokeWidth={2} />;
