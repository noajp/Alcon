// Lets any surface hand the Copilot a question with its context: the shell
// opens the panel, the panel sends. A window event keeps surfaces from
// depending on where the panel is mounted.

export const COPILOT_ASK_EVENT = 'alcon:copilot-ask';

export interface CopilotAsk {
  text: string;
  viewLabel?: string;
  spaceId?: string;
}

export function askCopilot(request: CopilotAsk) {
  window.dispatchEvent(new CustomEvent<CopilotAsk>(COPILOT_ASK_EVENT, { detail: request }));
}
