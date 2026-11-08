// The monthly budget every Athena driver judges a run against, in one
// place: the Space's own budget when the run belongs to a Space, else
// its starter's personal one; and what the month has already spent,
// counted on every other run in the same scope. execute, converse and
// the chat driver each carried this computation; it lives here now so
// the three can never drift apart on what "the budget" means.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** A person's own monthly budget for runs outside any Space. */
export const USER_MONTHLY_BUDGET_USD = 20;

export interface RunBudget { budget: number; spentBefore: number }

/**
 * The budget standing over a run, and the month's spend before it. The
 * run's own cost so far is excluded — the caller adds its live usage.
 */
export async function loadRunBudget(
  admin: SupabaseClient,
  run: { id: string; activity_space_id: string | null },
  userId: string,
): Promise<RunBudget> {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  let budget = USER_MONTHLY_BUDGET_USD;
  let spentQuery = admin.from("agent_runs").select("cost_usd").gte("created_at", monthStart.toISOString()).neq("id", run.id);
  if (run.activity_space_id) {
    const { data: space } = await admin.from("activity_spaces").select("ai_monthly_budget_usd").eq("id", run.activity_space_id).maybeSingle();
    budget = Number((space as { ai_monthly_budget_usd?: number | string | null } | null)?.ai_monthly_budget_usd ?? USER_MONTHLY_BUDGET_USD);
    spentQuery = spentQuery.eq("activity_space_id", run.activity_space_id);
  } else {
    spentQuery = spentQuery.is("activity_space_id", null).eq("triggered_by", userId);
  }
  const { data: spent } = await spentQuery;
  const spentBefore = ((spent ?? []) as { cost_usd: number | string }[])
    .reduce((s: number, r) => s + Number(r.cost_usd || 0), 0);
  return { budget, spentBefore };
}
