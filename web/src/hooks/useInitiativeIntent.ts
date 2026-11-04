'use client';

import { useCallback, useRef } from 'react';
import { createIntent, useStrategyIntentBundle, type IntentBundle } from '@/hooks/useSupabase';
import { useInitiativeScope, type InitiativeScope } from '@/hooks/useInitiativeScope';
import { useCurrentUserId } from '@/providers/authContext';
import { useSpaceRole } from '@/Function/space/data';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useI18n } from '@/Function/i18n/I18nProvider';

// =============================================================
// One read, one root, for every section hanging off a Strategy's Intent.
//
// The root Intent is why this is shared and not duplicated. `intents` carries a
// partial unique index allowing exactly one parent-less row per Strategy, and
// both the decisions and the assumptions surface create children under it. Two
// sections each memoising their own creation would each insert on first use,
// and whichever landed second would lose to the index — on a Strategy that has
// never recorded anything, which is every Strategy the first time.
//
// The bundle is shared for the ordinary reason: it is eight queries, and asking
// for them twice on one page buys nothing.
// =============================================================

export interface InitiativeIntentState {
  initiativeId: string;
  data: IntentBundle | null;
  error: Error | null;
  refetch: () => void;
  /** The Strategy's root Intent id, creating it on first use. */
  ensureRoot: () => Promise<string>;
  scope: InitiativeScope;
  /** Set when the scope could not be read. An empty scope and a failed read
   *  look identical to a picker, and only one of them means "nothing to link". */
  scopeError: Error | null;
  /** Whether this viewer may write intents here — the Strategy's owner.
   *  Reading follows the Strategy (ADR 0022); writing does not, and every
   *  composer reads this one answer instead of finding out from a refusal. */
  canEdit: boolean;
  /** Why a composer is locked, or null when it is not. Empty while the owner
   *  is still being looked up — a "owner only" notice shown to the owner for
   *  a frame is a small lie, and a lookup that failed is not a refusal. */
  lockReason: string | null;
}

export function useInitiativeIntent(initiativeId: string, initiativeName: string, createdBy?: string | null): InitiativeIntentState {
  const userId = useCurrentUserId();
  const { t } = useI18n();
  // A surface that already holds the Strategy row passes its owner; a
  // widget that only knows the id asks once. Until either answers, nobody
  // can write — a composer that appears and then locks reads as a flicker,
  // but one that opens and then refuses reads as a broken promise.
  // The Space comes from the row too: an owner of the Strategy's Space
  // edits it as well as its creator.
  const owner = useQuery({
    queryKey: ['strategy-owner', initiativeId],
    enabled: !!initiativeId,
    staleTime: 60_000,
    queryFn: async (): Promise<{ createdBy: string | null; spaceId: string | null }> => {
      const { data, error } = await supabase.from('strategies').select('created_by, activity_space_id').eq('id', initiativeId).maybeSingle();
      if (error) throw error;
      return { createdBy: (data?.created_by as string | null) ?? null, spaceId: (data?.activity_space_id as string | null) ?? null };
    },
  });
  const ownsItsSpace = useSpaceRole(owner.data?.spaceId ?? null) === 'owner';
  const resolvedOwner = createdBy === undefined ? owner.data?.createdBy : createdBy;
  const canEdit = resolvedOwner !== undefined && canEditInitiative(userId, resolvedOwner, ownsItsSpace);
  const lockReason = canEdit
    ? null
    : owner.isError
      ? t("Could not tell who owns this Strategy — reload to try again")
      : resolvedOwner === undefined
        ? null
        : t("Only the Strategy's owner can change its intent");
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
    canEdit,
    lockReason,
  };
}
