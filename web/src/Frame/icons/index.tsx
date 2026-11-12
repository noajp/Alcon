'use client';

// The Type icon — a circle, a triangle and a square: "what kind of thing".
// Stands for the `type` facet of an Element or Object. Accepts `size`
// (group-by chips) or `className` (rail / dropdown, where size-* + text-*
// set dimensions and colour).
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
    <path d="M8.3 10a.7.7 0 0 1-.63-1.08l3.74-6a.7.7 0 0 1 1.2 0l3.7 6A.7.7 0 0 1 15.7 10z" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <circle cx="17.5" cy="17.5" r="3.5" />
  </svg>
);

// Object concept icon — re-exported from the canonical concept-icon source so
// the cube glyph never drifts from the sidebar nav / detail-rail Object icon.
export { ObjectIcon } from '@/Function/shared/conceptIcons';
