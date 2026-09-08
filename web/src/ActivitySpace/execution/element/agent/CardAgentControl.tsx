'use client';

import { useEffect, useRef } from 'react';
import { useAgentRun } from '@/hooks/useSupabase';
import { getActiveDomainId } from '@/ActivitySpace/execution/domain/domainsStore';
import { StartAgentButton } from './StartAgentButton';

interface CardAgentControlProps {
  elementId: string;
  /** Called when a run finishes (e.g. to refresh the board so the card moves). */
  onFinished?: () => void;
}

// Self-contained ▶︎ agent control for kanban cards. Holds its own
// useAgentRun instance (idle until pressed, so the board doesn't fan out
// queries on load) and refreshes the board when a run reaches a terminal
// state.
export function CardAgentControl({ elementId, onFinished }: CardAgentControlProps) {
  const { run, isActive, starting, start, cancel } = useAgentRun(elementId, {
    autoLoad: false,
  });
  const wasActive = useRef(false);

  useEffect(() => {
    if (isActive) {
      wasActive.current = true;
    } else if (wasActive.current) {
      wasActive.current = false;
      onFinished?.();
    }
  }, [isActive, onFinished]);

  return (
    <StartAgentButton
      run={run}
      isActive={isActive}
      starting={starting}
      onStart={() => start({ domainId: getActiveDomainId(), triggeredFrom: 'board' })}
      onCancel={cancel}
      compact
    />
  );
}
