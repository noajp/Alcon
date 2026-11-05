// The verbs an Element can ask for (elements.action), without the icons, so
// the server-side lists and the tests read the same table.

/** Verbs only a person can carry: weighing, settling, saying yes, telling. */
const HUMAN_ACTIONS = ['judge', 'decide', 'approve', 'answer'] as const;
/** Verbs an AI can carry with its tools (or a person, when assigned). */
const WORK_ACTIONS = ['plan', 'research', 'create', 'execute', 'verify', 'report', 'send', 'delegate', 'monitor'] as const;

export const ELEMENT_ACTIONS = [...HUMAN_ACTIONS, ...WORK_ACTIONS] as const;
export type ElementAction = (typeof ELEMENT_ACTIONS)[number];

export function isElementAction(v: unknown): v is ElementAction {
  return typeof v === 'string' && (ELEMENT_ACTIONS as readonly string[]).includes(v);
}

export function isHumanAction(a: ElementAction): boolean {
  return (HUMAN_ACTIONS as readonly string[]).includes(a);
}
