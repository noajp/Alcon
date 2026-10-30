'use client';

import { WorkerAvatarStack } from '@/Function/shared/WorkerAvatar';
import { useBoardPresence } from '@/hooks/useBoardPresence';
import type { WidgetSubject } from './types';

/** The other people on this board right now. Nothing when you are alone. */
export function BoardPresence({ subject }: { subject: WidgetSubject }) {
  const viewers = useBoardPresence(subject.kind, subject.id);
  if (!viewers.length) return null;
  const names = viewers.map((viewer) => viewer.name).join(', ');
  return (
    <span role="group" className="flex items-center" title={`Also here: ${names}`} aria-label={`Also viewing this board: ${names}`}>
      <WorkerAvatarStack workers={viewers.map((viewer) => ({ name: viewer.name }))} max={4} size={20} />
    </span>
  );
}
