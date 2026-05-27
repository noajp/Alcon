'use client';

import React from 'react';

// House — gently rounded pentagon with a slightly narrowed base and a
// horizontal "doorstep" line near the bottom (instead of a doorway box).
export const NavHomeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.09 4.17 L17.64 9.04 Q19 10.5 19 12.5 L19 18.5 Q19 21 16.5 21 L7.5 21 Q5 21 5 18.5 L5 12.5 Q5 10.5 6.37 9.04 L10.91 4.17 Q12 3 13.09 4.17 Z"/>
    <path d="M9 17.5h6"/>
  </svg>
);

// Chat — elliptical speech bubble with a small tail at the lower-left.
export const NavChatIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5 A9 8 0 1 1 9 18.04 L6.2 19.6 L6 16.46 A9 8 0 0 1 12 2.5 Z"/>
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

export const NavObjectsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

export const NavSettingsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
  </svg>
);

export const NavMyTasksIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
    <circle cx="21.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="4.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="6.8" cy="19.6" r="1.2" fill="currentColor" stroke="none" />
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11z"/>
    <line x1="8" y1="9" x2="16" y2="9"/>
    <line x1="8" y1="12" x2="16" y2="12"/>
    <line x1="8" y1="15" x2="13" y2="15"/>
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11z"/>
    <line x1="8" y1="9" x2="16" y2="9"/>
    <line x1="8" y1="13" x2="13" y2="13"/>
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
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.15" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5.5 4.5 9.25 12 13l7.5-3.75L12 5.5Z" />
    <path d="M4.5 12.25 12 16l7.5-3.75" />
    <path d="M4.5 15.25 12 19l7.5-3.75" />
  </svg>
);

// Legacy alias kept for backward compat during migration
export const NavSystemIcon = NavDomainIcon;

// Strategy: Δ (delta) — change/progress symbol. Drawn as a filled outline
// with the inner cutout shifted left so the right diagonal carries the
// calligraphic stress (right stroke visibly thicker than left). Matches
// how the Greek capital is set in serif / old-style faces.
export const NavStrategyIcon = ({ size = 20, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    className={className}
  >
    <path
      fillRule="evenodd"
      d="M12 1 L21 22 L3 22 Z M11.5 7 L7 19.5 L15 19.5 Z"
    />
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

type NavItem = { id: string; icon: React.ComponentType<{ size?: number }>; label: string; disabled?: boolean };

export const ICON_BAR_LAYERS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Home',
    items: [
      { id: 'home', icon: NavHomeIcon, label: 'Home' },
    ],
  },
  {
    label: 'Action',
    items: [
      { id: 'note', icon: NavNoteIcon, label: 'Note' },
      { id: 'room', icon: NavRoomIcon, label: 'Room' },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'domains', icon: NavDomainIcon, label: 'Domains' },
      { id: 'projects', icon: NavObjectsIcon, label: 'Objects' },
      { id: 'mytasks', icon: NavMyTasksIcon, label: 'Elements' },
    ],
  },
];
