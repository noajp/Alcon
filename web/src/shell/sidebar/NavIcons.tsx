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
// Strategy's nested sub-views (Approach / Planning / Phase).
export const NavApproachIcon = ({ size = 20 }: { size?: number }) => <Pyramid size={size} strokeWidth={2} />;
export const NavPlanningIcon = ({ size = 20 }: { size?: number }) => <ListTree size={size} strokeWidth={2} />;
export const NavPhaseIcon = ({ size = 20 }: { size?: number }) => <Milestone size={size} strokeWidth={2} />;
