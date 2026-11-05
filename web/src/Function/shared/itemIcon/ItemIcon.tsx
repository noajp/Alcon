'use client';

import { createElement, type ComponentType, type ReactNode } from 'react';
import * as GLYPH_MODULE from '@/ui/icons/glyphs';
import { DynamicIcon, type IconName } from '@/ui/icons/dynamic';
import type { IconProps } from '@/ui/icons/glyph';
import { itemColor, parseItemIcon } from './itemIconValue';

type Glyph = ComponentType<IconProps>;

/** Alcon's own concept marks, shown first in the picker. */
const FEATURED = ['GuidingStar', 'CompassRose', 'Spearhead', 'Milestone', 'Layers', 'Box', 'Component', 'Flag', 'Bot', 'Users', 'FileText', 'BookOpen', 'Calendar', 'Inbox', 'ShieldCheck', 'HeartHandshake'];

/** Alcon's own drawings by name, one entry per drawing (aliases dropped),
 *  its concept marks first. */
export const ALCON_GLYPHS: [name: string, Glyph][] = (() => {
  const seen = new Set<unknown>();
  const out: [string, Glyph][] = [];
  for (const [name, value] of Object.entries(GLYPH_MODULE)) {
    if (!/^[A-Z]/.test(name) || !value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    out.push([name, value as unknown as Glyph]);
  }
  const rank = (name: string) => { const i = FEATURED.indexOf(name); return i < 0 ? FEATURED.length : i; };
  return out.sort((a, b) => rank(a[0]) - rank(b[0]));
})();
const GLYPH_BY_NAME = new Map<string, Glyph>(
  Object.entries(GLYPH_MODULE).filter(([name, v]) => /^[A-Z]/.test(name) && v && typeof v === 'object') as [string, Glyph][],
);

/**
 * A Strategy's, Object's or Element's icon: its own when it has one (an
 * Alcon drawing, a standard icon or an emoji), else the concept's default
 * (`fallback`), in its own colour when it has one.
 */
export function ItemIcon({ icon, color, fallback, size = 16, className = '' }: {
  icon?: string | null;
  color?: string | null;
  fallback?: ReactNode;
  size?: number;
  className?: string;
}) {
  const value = parseItemIcon(icon);
  const tone = itemColor(color);
  const box = { width: size, height: size };
  const style = tone ? { ...box, color: tone } : box;
  const wrap = `inline-flex shrink-0 items-center justify-center ${className}`;

  if (value?.kind === 'emoji') {
    return <span aria-hidden className={wrap} style={{ ...box, fontSize: Math.round(size * 0.92), lineHeight: 1 }}>{value.text}</span>;
  }
  if (value?.kind === 'glyph') {
    const Glyph = GLYPH_BY_NAME.get(value.name);
    if (Glyph) return <span aria-hidden className={wrap} style={style}>{createElement(Glyph, { size })}</span>;
  }
  if (value?.kind === 'lucide') {
    return (
      <span aria-hidden className={wrap} style={style}>
        <DynamicIcon name={value.name as IconName} size={size} strokeWidth={2} fallback={() => <span style={box} />} />
      </span>
    );
  }
  return <span aria-hidden className={wrap} style={style}>{fallback}</span>;
}
