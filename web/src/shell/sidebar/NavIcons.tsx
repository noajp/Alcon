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
// Drawn on a 48-grid, viewBox-cropped to read at the same optical size as the
// Lucide icons. The `active` overlay fills orange (--rail-active-icon) with a
// per-layer reveal animation (rail-anim-* in globals.css).
export const NavActionIcon = ({ size = 20, active = false }: { size?: number; active?: boolean }) => {
  const glyph = (
    <>
      <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/>
      <path strokeWidth="2.6" d="M35.3 17.5 A 13 13 0 0 1 35.3 30.5"/>
      <path strokeWidth="2.6" d="M30.5 35.3 A 13 13 0 0 1 17.5 35.3"/>
      <path strokeWidth="2.6" d="M12.7 30.5 A 13 13 0 0 1 12.7 17.5"/>
      <path strokeWidth="2.6" d="M17.5 12.7 A 13 13 0 0 1 30.5 12.7"/>
    </>
  );
  return (
    <svg width={size} height={size} viewBox="8.25 8.25 31.5 31.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {/* gray base stays visible; orange reveals on top when active */}
      {glyph}
      {active && <g key="on" className="rail-anim-burst" style={{ color: 'var(--rail-active-icon)' }}>{glyph}</g>}
    </svg>
  );
};

export const NavMaterializationIcon = ({ size = 20, active = false }: { size?: number; active?: boolean }) => {
  const glyph = (
    <>
      <path d="M17 11.5 L31 11.5 L38 20.5 L24 37.5 L10 20.5 Z"/>
      <path opacity="0.85" d="M10 20.5 L38 20.5"/>
      <path d="M17 11.5 L20 20.5 L24 37.5"/>
      <path d="M31 11.5 L28 20.5 L24 37.5"/>
      <path opacity="0.85" d="M20 20.5 L28 20.5"/>
    </>
  );
  return (
    <svg width={size} height={size} viewBox="7 7.5 34 34" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      {/* gray base stays visible; orange wipes in on top when active */}
      {glyph}
      {active && <g key="on" className="rail-anim-wipe" style={{ color: 'var(--rail-active-icon)' }}>{glyph}</g>}
    </svg>
  );
};

export const NavExecutionIcon = ({ size = 20, active = false }: { size?: number; active?: boolean }) => (
  <svg width={size} height={size} viewBox="8 8 32 32" fill="none" stroke="currentColor" strokeWidth="2.65" strokeLinecap="round" strokeLinejoin="round">
    {/* gray base stays visible; orange ring + square draw over it when active */}
    <circle cx="24" cy="24" r="13" opacity="0.3"/>
    <path d="M24 11 A 13 13 0 1 1 11.37 26.97"/>
    <circle cx="24" cy="11" r="2.1" fill="currentColor" stroke="none"/>
    <rect x="19.5" y="19.5" width="9" height="9" rx="2.3"/>
    {active && (
      <g key="on" style={{ color: 'var(--rail-active-icon)' }}>
        <path className="rail-anim-draw" pathLength={100} d="M24 11 A 13 13 0 1 1 11.37 26.97"/>
        <rect className="rail-anim-draw" pathLength={100} x="19.5" y="19.5" width="9" height="9" rx="2.3"/>
        <circle className="rail-anim-pop" cx="24" cy="11" r="2.1" fill="currentColor" stroke="none"/>
      </g>
    )}
  </svg>
);
