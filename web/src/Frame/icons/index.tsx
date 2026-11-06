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

// Object concept icon — re-exported from the canonical concept-icon source so
// the cube glyph never drifts from the sidebar nav / detail-rail Object icon.
export { ObjectIcon } from '@/Function/shared/conceptIcons';
