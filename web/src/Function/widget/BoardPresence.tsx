'use client';

import { PresenceStack } from '@/Function/shared/PresenceStack';
import { useBoardPresence } from '@/hooks/usePresence';
import type { WidgetSubject } from './types';

/** The other people on this board right now. Nothing when you are alone. */
export function BoardPresence({ subject }: { subject: WidgetSubject }) {
  return <PresenceStack viewers={useBoardPresence(subject.kind, subject.id)} />;
}
