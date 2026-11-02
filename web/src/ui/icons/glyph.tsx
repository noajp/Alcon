'use client';

import { forwardRef, useId, type ReactNode, type SVGProps } from 'react';

// =============================================================
// Alcon's own icons, drawn on a 16-unit grid.
//
// Two kinds of mark, one family:
//   things   — the concepts and places (a Domain, a Table, the trash): a solid
//              shape, slim rather than square, with fine knockouts for its
//              inner detail (a table's cells, a shield's check). Solid reads
//              at small sizes and shows the selected row as brighter.
//   actions  — the verbs (add, close, check, go): a 1.5 line with round ends,
//              as such marks are drawn everywhere.
// A thing may carry a line for its secondary part (the lower layers of
// Execution, a pole under a flag).
//
// Each glyph takes Lucide's props (size, className, strokeWidth, color…), so a
// component can swap one for the other; strokeWidth is ignored — the weight
// belongs to the drawing, not the caller.
// =============================================================

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string;
  strokeWidth?: number | string;
  absoluteStrokeWidth?: boolean;
  color?: string;
}

interface Drawing {
  /** Solid shapes, in the icon's colour. */
  solid?: ReactNode;
  /** Lines (1.5, round ends), in the icon's colour. */
  line?: ReactNode;
  /** Knocked out of the solid shapes: lines by default; give a shape its own fill to cut an area. */
  cut?: ReactNode;
}

// design-lint-ignore — a mask is luminance: white keeps, black cuts; not a UI colour.
const KEEP = '#fff';
// design-lint-ignore — a mask is luminance: white keeps, black cuts; not a UI colour.
const CUT = '#000';

/** Makes a glyph component from its drawing. */
export function glyph(displayName: string, drawing: Drawing) {
  const Glyph = forwardRef<SVGSVGElement, IconProps>(function Glyph(
    { size = 24, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absolute, color, style, ...rest },
    ref,
  ) {
    void _strokeWidth; void _absolute;
    const id = useId();
    const mask = drawing.cut ? `alcon-icon-${id.replace(/:/g, '')}` : null;
    return (
      <svg ref={ref} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"
        style={color ? { color, ...style } : style} {...rest}>
        {mask && (
          <defs>
            <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">
              <rect width="16" height="16" fill={KEEP} />
              <g fill="none" stroke={CUT} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">{drawing.cut}</g>
            </mask>
          </defs>
        )}
        {drawing.solid && <g mask={mask ? `url(#${mask})` : undefined}>{drawing.solid}</g>}
        {drawing.line && (
          <g fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">{drawing.line}</g>
        )}
      </svg>
    );
  });
  Glyph.displayName = displayName;
  return Glyph;
}

/** A filled area knocked out of a glyph (inside `cut`). */
export const hole = { fill: CUT, stroke: 'none' } as const;

/** Pure. A gear's outline: `teeth` flat-topped teeth around a ring. */
export function gearPath(cx: number, cy: number, outer: number, inner: number, teeth: number): string {
  const pts: string[] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const at = (r: number, t: number) => `${(cx + r * Math.cos(t)).toFixed(2)} ${(cy + r * Math.sin(t)).toFixed(2)}`;
    pts.push(at(inner, a - step * 0.36), at(outer, a - step * 0.2), at(outer, a + step * 0.2), at(inner, a + step * 0.36));
  }
  return `M${pts.join('L')}Z`;
}
