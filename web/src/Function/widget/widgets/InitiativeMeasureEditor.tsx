'use client';

import { useState } from 'react';
import { Button } from '@/ui/button';
import { InitiativeMeasures } from '@/ActivitySpace/strategy/initiative/InitiativeMeasures';
import { InitiativeIntentProvider, useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';

/** Reuse the same saved conditions from any strategic lens, even without a Measures widget. */
export function InitiativeMeasureEditor({ initiativeId, initiativeName, children }: {
  initiativeId: string;
  initiativeName: string;
  children?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);
  const initiative = useInitiativeIntentContext();
  return (
    <div className="px-3 py-1">
      <Button variant="ghost" size="xs" aria-expanded={editing}
        onClick={() => { setOpened(true); setEditing((value) => !value); }}>
        {editing ? 'Close editor' : 'Edit key results'}
      </Button>
      {!editing && children}
      {opened && <div hidden={!editing}>{initiative?.initiativeId === initiativeId
        ? <InitiativeMeasures initiative={initiative} inlineHeader />
        : <InitiativeIntentProvider initiativeId={initiativeId} initiativeName={initiativeName}>
            <NestedEditor />
          </InitiativeIntentProvider>}</div>}
    </div>
  );
}

function NestedEditor() {
  const initiative = useInitiativeIntentContext();
  return initiative ? <InitiativeMeasures initiative={initiative} inlineHeader /> : null;
}
