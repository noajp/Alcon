'use client';

// Element Type icon — three hexagons clustered like a honeycomb (one on
// top, two below). Custom glyph (lucide has no "3 hexagons"); represents the
// `type` facet of an Element. Accepts `size` (group-by chips) or `className`
// (rail / dropdown, where size-* + text-* set dimensions and colour).
export const ElementTypeIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 13.43 17.07 10.51 17.07 4.66 12 1.73 6.93 4.66 6.93 10.51Z" />
    <path d="M6.93 22.21 12 19.28 12 13.43 6.93 10.51 1.86 13.43 1.86 19.28Z" />
    <path d="M17.07 22.21 22.14 19.28 22.14 13.43 17.07 10.51 12 13.43 12 19.28Z" />
  </svg>
);

// AI Agent icon — a sideways "A" (apex pointing left, crossbar offset to
// the right). Custom glyph; sits beside the Smile / Note quick-actions on
// the Element detail to start or resume an autonomous agent run.
export const AgentIcon = ({ size = 15, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 12 L20 4" />
    <path d="M4 12 L20 20" />
    <path d="M14 7 L14 17" />
  </svg>
);

// Cabinet icon — an open document tray with sheets of paper fanning up out
// of it (custom glyph; lucide has no "documents in a tray"). The tray is a
// trapezoid with a front handle; three landscape sheets step up and narrow
// toward the back like a fanned stack, the front one showing a text line.
// Used for Note Cabinets in the sidebar.
export const CabinetIcon = ({ size = 16, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* fanned sheets (back → front), stepping up and narrowing */}
    <rect x="7.5" y="3.2" width="9" height="3.4" rx="0.8" />
    <rect x="6.5" y="5.9" width="11" height="3.6" rx="0.9" />
    <rect x="5.5" y="8.8" width="13" height="4.2" rx="1" />
    {/* text line on the front sheet */}
    <path d="M8 11h8" />
    {/* open tray (trapezoid, no top edge so the sheets sit inside) + handle */}
    <path d="M3 13 L5.6 20 H18.4 L21 13" />
    <path d="M10 16.4h4" />
  </svg>
);

// Object icon (3D cube)
export const ObjectIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);

// Home icon
export const HomeIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

// Settings icon
export const SettingsIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

// Account icon
export const AccountIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

// Chevron icon for tree navigation
export const ChevronIcon = ({ expanded = false, size = 16 }: { expanded?: boolean; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
  >
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);
