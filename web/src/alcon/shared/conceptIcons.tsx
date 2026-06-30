import { Layers, Box, Component } from 'lucide-react';

/**
 * Canonical concept → glyph mapping for the Execution layer's three units.
 *
 *   Domain  → Layers     (the 3-layer stack — the top-level container)
 *   Object  → Box        (the mid-level structural unit)
 *   Element → Component  (the smallest executable unit)
 *
 * This is the single source of truth for the concept↔icon pairing. Every
 * surface — ModeRail / sidebar nav, Object & Element detail rails, list rows,
 * pickers, empty states — imports its glyph from here, so the mapping can
 * never drift between two places. Change a concept's icon once, here.
 *
 * All three share one signature (size / strokeWidth / className) so they're
 * drop-in interchangeable wherever a concept mark is rendered.
 */
type ConceptIconProps = { size?: number; strokeWidth?: number; className?: string };

const makeConceptIcon = (Glyph: typeof Layers, displayName: string) => {
  const ConceptIcon = ({ size = 16, strokeWidth = 2, className }: ConceptIconProps) => (
    <Glyph size={size} strokeWidth={strokeWidth} className={className} />
  );
  ConceptIcon.displayName = displayName;
  return ConceptIcon;
};

export const DomainIcon = makeConceptIcon(Layers, 'DomainIcon');
export const ObjectIcon = makeConceptIcon(Box, 'ObjectIcon');
export const ElementIcon = makeConceptIcon(Component, 'ElementIcon');
