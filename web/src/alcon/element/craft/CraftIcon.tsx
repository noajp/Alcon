// Custom "Craft" icon — a stylized page/canvas with a small spark in the
// top-right corner. Suggests "place content on a blank canvas" + the AI
// assist that ships alongside it. Designed to read at 11–16px.
//
// Drop-in replacement for a lucide-react icon: same `size` + `className`
// + ...rest props (so it can be used wherever a small icon goes).

import type { SVGProps } from 'react';

interface Props extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number | string;
}

export function CraftIcon({ size = 16, className, ...rest }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {/* Canvas / page with a folded top-right corner */}
      <path d="M 3 3.5 a 1 1 0 0 1 1 -1 H 9.2 L 11.7 5 V 12.5 a 1 1 0 0 1 -1 1 H 4 a 1 1 0 0 1 -1 -1 z" />
      <path d="M 9.2 2.5 V 5 H 11.7" />
      {/* Spark accent — outside the page, top-right */}
      <path d="M 13.5 2.4 v 2.2 M 12.4 3.5 h 2.2" strokeWidth={1.2} />
    </svg>
  );
}
