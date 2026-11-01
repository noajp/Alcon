import type { CopilotAttachment, CopilotContext } from './useAlconCopilot';

// "Ask the AI about this" from anywhere: the AI pop-up opens with the
// question and its files in the composer — sent at once, or left there for
// the person to finish. The page opens the pop-up; the pop-up fills itself.

export const ASK_AI_EVENT = 'alcon:ask-ai';

export interface AskAiDetail {
  prompt: string;
  attachments: CopilotAttachment[];
  /** Send it straight away (otherwise it waits in the composer). */
  send?: boolean;
  /** Where the question is about (the file's Element or Object), over the pop-up's own. */
  context?: Pick<CopilotContext, 'elementId' | 'objectId'>;
}

export function askAi(detail: AskAiDetail): void {
  window.dispatchEvent(new CustomEvent<AskAiDetail>(ASK_AI_EVENT, { detail }));
}
