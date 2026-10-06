import { Layers, Box, Component, MessageCircle, Handshake } from 'lucide-react';

/**
 * Canonical concept → glyph mapping for the Execution layer's three units.
 *
 *   Domain  → Layers        (the 3-layer stack — the top-level container)
 *   Object  → Box           (the mid-level structural unit)
 *   Element → Component     (the smallest executable unit)
 *   Message → MessageCircle (anything someone said: a comment, a
 *                            notification about one)
 *
 * The message glyph is round on purpose. A speech bubble is the one mark in
 * this set that stands for an utterance rather than a container, and the
 * square-cornered variant read as a third box beside Object and Element —
 * which is exactly the confusion the mapping exists to prevent.
 *
 * This is the single source of truth for the concept↔icon pairing. Every
 * surface — sidebar nav, Object & Element detail rails, list rows, pickers,
 * empty states — imports its glyph from here, so the mapping can never drift
 * between two places. Change a concept's icon once, here.
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

/**
 * Comments and notifications about them. One glyph, because they are
 * one idea seen from three places — a comment on an Element, a message in a
 * conversation, and the Inbox row that tells you one arrived are all "somebody
 * said something".
 */
export const MessageIcon = makeConceptIcon(MessageCircle, 'MessageIcon');

export const CrmIcon = makeConceptIcon(Handshake, 'CrmIcon');
