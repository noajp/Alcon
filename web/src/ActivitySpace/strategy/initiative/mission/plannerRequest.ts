// A request for the Planner, made from somewhere other than the Execution
// tab (the Strategy's conversation): the guidance to plan with. The Execution
// tab may not be on screen yet when it is made, so it is held until that
// tab's Planner takes it.

type Listener = (guidance: string) => void;

const pending = new Map<string, string>();
const listeners = new Map<string, Listener>();

/** Asks the Planner of this Strategy to draft a plan with this guidance. */
export function requestPlan(strategyId: string, guidance: string): void {
  const listener = listeners.get(strategyId);
  if (listener) listener(guidance);
  else pending.set(strategyId, guidance);
}

/** The Execution tab's Planner listens; a request made before it was on screen is delivered now. */
export function listenForPlanRequests(strategyId: string, listener: Listener): () => void {
  listeners.set(strategyId, listener);
  const waiting = pending.get(strategyId);
  if (waiting !== undefined) {
    pending.delete(strategyId);
    listener(waiting);
  }
  return () => { if (listeners.get(strategyId) === listener) listeners.delete(strategyId); };
}
