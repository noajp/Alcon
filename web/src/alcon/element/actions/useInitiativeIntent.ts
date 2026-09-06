'use client';

import { useCallback, useRef } from 'react';
import { createIntent, useStrategyIntentBundle, type IntentBundle } from '@/hooks/useSupabase';
import { useInitiativeScope, type InitiativeScope } from '@/alcon/element/actions/useInitiativeScope';

// =============================================================
// One read, one root, for every section hanging off a Initiative's Intent.
//
// The root Intent is why this is shared and not duplicated. `intents` carries a
// partial unique index allowing exactly one parent-less row per Initiative, and
// both the decisions and the assumptions surface create children under it. Two
// sections each memoising their own creation would each insert on first use,
// and whichever landed second would lose to the index — on a Initiative that has
// never recorded anything, which is every Initiative the first time.
//
// The bundle is shared for the ordinary reason: it is eight queries, and asking
// for them twice on one page buys nothing.
// =============================================================

export interface InitiativeIntentState {
  initiativeId: string;
  data: IntentBundle | null;
  error: Error | null;
  refetch: () => void;
  /** The Initiative's root Intent id, creating it on first use. */
  ensureRoot: () => Promise<string>;
  scope: InitiativeScope;
  /** Set when the scope could not be read. An empty scope and a failed read
   *  look identical to a picker, and only one of them means "nothing to link". */
  scopeError: Error | null;
}

export function useInitiativeIntent(initiativeId: string, initiativeName: string): InitiativeIntentState {
  const { data, error, refetch } = useStrategyIntentBundle(initiativeId);
  const { scope, error: scopeError } = useInitiativeScope(initiativeId);

  // The in-flight creation, held so two quick submits share one insert rather
  // than racing the unique index. Cleared on failure so a retry can start over.
  const pending = useRef<Promise<string> | null>(null);
  const master = data?.master ?? null;

  const ensureRoot = useCallback(async () => {
    if (master) return master.id;
    if (!pending.current) {
      pending.current = createIntent({
        strategy_id: initiativeId,
        parent_intent_id: null,
        kind: 'master',
        title: initiativeName,
        status: 'on_track',
        order_index: 0,
      })
        .then((intent) => intent.id)
        .catch((e) => {
          pending.current = null;
          throw e;
        });
    }
    return pending.current;
  }, [master, initiativeId, initiativeName]);

  return {
    initiativeId,
    data,
    error,
    refetch,
    ensureRoot,
    scope,
    scopeError,
  };
}
