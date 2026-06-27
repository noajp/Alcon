'use client';

import React from 'react';

// House — gently rounded pentagon with a slightly narrowed base and a
// horizontal "doorstep" line near the bottom (instead of a doorway box).
export const NavHomeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 23.5 L22.3 9.6 Q24 8 25.7 9.6 L40 23.5"/>
    <path d="M12 20.2 L12 38 Q12 41 15 41 L33 41 Q36 41 36 38 L36 20.2"/>
    <path d="M20.5 41 L20.5 33.5 Q20.5 31 24 31 Q27.5 31 27.5 33.5 L27.5 41"/>
  </svg>
);

// Chat — elliptical speech bubble with a small tail at the lower-left.
export const NavChatIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M24 9.5 C15.2 9.5 9 15.1 9 21.9 C9 25.5 10.8 28.7 13.6 30.9 C13.4 32.9 12.7 34.9 11.3 36.5 C10.8 37.1 11.2 38 12 37.9 C15.2 37.5 17.9 36 19.8 34.4 C21.1 34.7 22.5 34.8 24 34.8 C32.8 34.8 39 29.2 39 22.15 C39 15.1 32.8 9.5 24 9.5 Z"/>
  </svg>
);

export const NavActionsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="13" y2="17"/>
  </svg>
);

// Grid / table icon — used for the Tables sidebar entry (the user-managed
// Notion-DB-like data tables feature, independent of D/O/E).
export const NavTableIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="3" y1="15" x2="21" y2="15" />
    <line x1="9" y1="3" x2="9" y2="21" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);

export const NavObjectsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.18 13.78 L21.82 7.22 Q24 6 26.18 7.22 L37.82 13.78 Q40 15 40 17.5 L40 30.5 Q40 33 37.82 34.22 L26.18 40.78 Q24 42 21.82 40.78 L10.18 34.22 Q8 33 8 30.5 L8 17.5 Q8 15 10.18 13.78 Z"/>
    <path d="M24 24 L38.6 15.9 M24 24 L24 40.5 M24 24 L9.4 15.9"/>
  </svg>
);

export const NavSettingsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

export const NavMyTasksIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round">
    <g opacity="0.4" strokeWidth="2.8">
      <path d="M22.4 10 Q12 18 13.2 31.4"/>
      <path d="M25.6 10 Q36 18 34.8 31.4"/>
      <path d="M13.4 34.2 Q24 38.5 34.6 34.2"/>
    </g>
    <path d="M24 21.2 L24 10.7 M21.73 25.64 L13.28 31.72 M26.27 25.64 L34.72 31.72"/>
    <circle cx="24" cy="8.5" r="2.2"/>
    <circle cx="11.5" cy="33" r="2.2"/>
    <circle cx="36.5" cy="33" r="2.2"/>
    <circle cx="18" cy="20" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="30" cy="20" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="24" cy="24" r="2.9" fill="currentColor" stroke="none"/>
  </svg>
);

export const NavInboxIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
  </svg>
);

export const NavCalendarIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

export const NavOverviewIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
  </svg>
);

export const NavNoteIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 9.5 Q13 7 15.5 7 L29.5 7 L37 14.5 L37 38.5 Q37 41 34.5 41 L15.5 41 Q13 41 13 38.5 Z"/>
    <path d="M29.5 7 L29.5 12.5 Q29.5 14.5 31.5 14.5 L37 14.5"/>
    <path opacity="0.85" d="M18 23 L32 23 M18 29 L32 29"/>
    <path opacity="0.45" d="M18 35 L27 35"/>
  </svg>
);

export const NavBriefIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11z"/>
    <line x1="4" y1="9.5" x2="20" y2="9.5"/>
    <line x1="8" y1="13" x2="14" y2="13"/>
    <line x1="8" y1="16" x2="12" y2="16"/>
  </svg>
);

export const NavRoomIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18.5" r="3.2" fill="currentColor" stroke="none"/>
    <circle cx="18" cy="18.5" r="10.2"/>
    <circle cx="18" cy="18.5" r="15.5" opacity="0.42"/>
    <circle cx="31" cy="30.5" r="2.6" fill="currentColor" stroke="none"/>
    <circle cx="31" cy="30.5" r="8.3"/>
    <circle cx="31" cy="30.5" r="12.6" opacity="0.42"/>
  </svg>
);

export const NavDashboardIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
    <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
  </svg>
);

export const NavAnalysisIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

export const NavDomainIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round">
    <path opacity="0.4" d="M9 12 L9 36 M39 12 L39 36"/>
    <path d="M10.99 11.07 L22.01 5.93 Q24 5 25.99 5.93 L37.01 11.07 Q39 12 37.01 12.93 L25.99 18.07 Q24 19 22.01 18.07 L10.99 12.93 Q9 12 10.99 11.07 Z"/>
    <path opacity="0.62" d="M10.99 23.07 L22.01 17.93 Q24 17 25.99 17.93 L37.01 23.07 Q39 24 37.01 24.93 L25.99 30.07 Q24 31 22.01 30.07 L10.99 24.93 Q9 24 10.99 23.07 Z"/>
    <path d="M10.99 35.07 L22.01 29.93 Q24 29 25.99 29.93 L37.01 35.07 Q39 36 37.01 36.93 L25.99 42.07 Q24 43 22.01 42.07 L10.99 36.93 Q9 36 10.99 35.07 Z"/>
  </svg>
);

// Legacy alias kept for backward compat during migration
export const NavSystemIcon = NavDomainIcon;

// Strategy: Δ (delta) — change/progress symbol. Drawn as a filled outline
// with the inner cutout shifted left so the right diagonal carries the
// calligraphic stress (right stroke visibly thicker than left). Matches
// how the Greek capital is set in serif / old-style faces.
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M24 9 L28.4 39.5 L33 39.5 Z" fill="currentColor" stroke="none"/>
    <path d="M22.9 7.3 L13.3 38.6 Q12.5 41 15.2 41 L32.8 41 Q35.5 41 34.7 38.6 L25.1 7.3 Q24 4.8 22.9 7.3 Z"/>
  </svg>
);

// Workload — three stacked horizontal bars of varying length, suggesting
// how capacity is distributed across workers.
export const NavWorkloadIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5"  width="14" height="3" rx="1" />
    <rect x="3" y="10.5" width="18" height="3" rx="1" />
    <rect x="3" y="16" width="9"  height="3" rx="1" />
  </svg>
);

export const NavTeamsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
  </svg>
);

export const NavGraphIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);

export const NavSearchIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

export const NavActivityIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/>
    <path strokeWidth="2.1" d="M35.3 17.5 A 13 13 0 0 1 35.3 30.5"/>
    <path strokeWidth="2.1" d="M30.5 35.3 A 13 13 0 0 1 17.5 35.3"/>
    <path strokeWidth="2.1" d="M12.7 30.5 A 13 13 0 0 1 12.7 17.5"/>
    <path strokeWidth="2.1" d="M17.5 12.7 A 13 13 0 0 1 30.5 12.7"/>
  </svg>
);

export const NavMaterializationIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 11.5 L31 11.5 L38 20.5 L24 37.5 L10 20.5 Z"/>
    <path opacity="0.85" d="M10 20.5 L38 20.5"/>
    <path d="M17 11.5 L20 20.5 L24 37.5"/>
    <path d="M31 11.5 L28 20.5 L24 37.5"/>
    <path opacity="0.85" d="M20 20.5 L28 20.5"/>
  </svg>
);

export const NavExecutionIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="24" cy="24" r="13" opacity="0.3"/>
    <path d="M24 11 A 13 13 0 1 1 11.37 26.97"/>
    <circle cx="24" cy="11" r="2.1" fill="currentColor" stroke="none"/>
    <rect x="19.5" y="19.5" width="9" height="9" rx="2.3"/>
  </svg>
);

// Diagram — one node on the left linked by smooth connectors to two rounded
// nodes on the right (a small relationship/graph glyph).
export const NavDiagramIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="4.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 24 C24 24 24 13 31 13"/>
    <path d="M17 24 C24 24 24 35 31 35"/>
    <rect x="5" y="18.5" width="12" height="11" rx="2.6"/>
    <rect x="31" y="7.5" width="12" height="11" rx="2.6"/>
    <rect x="31" y="29.5" width="12" height="11" rx="2.6"/>
  </svg>
);

