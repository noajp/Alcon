// The AI agents Clayware knows by name: each provider's logo, the Worker made
// for it (its name and the model it runs), and how an existing Worker is
// recognised as one of them — by its model, else its name. Any AI agent
// Worker of a known provider wears that provider's logo wherever an avatar
// is drawn (assignees, comments, mentions), unless it has an image of its own.

export type AiProvider = 'claude' | 'openai' | 'gemini' | 'deepseek' | 'grok' | 'mistral';

export interface AiAgentPreset { provider: AiProvider; name: string; model: string }

/** The AI agents offered before a Space has made them, in this order. */
export const AI_AGENT_PRESETS: readonly AiAgentPreset[] = [
  { provider: 'claude', name: 'Claude', model: 'claude-opus-5-5' },
  { provider: 'openai', name: 'ChatGPT', model: 'gpt' },
  { provider: 'gemini', name: 'Gemini', model: 'gemini' },
  { provider: 'deepseek', name: 'DeepSeek', model: 'deepseek' },
  { provider: 'grok', name: 'Grok', model: 'grok' },
  { provider: 'mistral', name: 'Mistral', model: 'mistral' },
];

const MATCHERS: readonly [AiProvider, RegExp][] = [
  ['claude', /claude|anthropic/],
  ['openai', /chatgpt|openai|\bgpt|^o\d/],
  ['gemini', /gemini|bard/],
  ['deepseek', /deepseek/],
  ['grok', /grok|\bxai\b/],
  ['mistral', /mistral|mixtral|codestral/],
];

/** Pure. The provider an AI agent Worker belongs to — by its model, else its
 *  name; null for a person or an agent of no known provider. */
export function aiProviderOf(worker: { type?: string | null; ai_model?: string | null; name?: string | null } | null | undefined): AiProvider | null {
  if (!worker || worker.type !== 'ai_agent') return null;
  for (const text of [worker.ai_model, worker.name]) {
    const s = (text ?? '').toLowerCase().trim();
    if (!s) continue;
    const hit = MATCHERS.find(([, re]) => re.test(s));
    if (hit) return hit[0];
  }
  return null;
}

// Each provider's own logo, from svgl (svgl.app), kept in public/ai-logos so
// an avatar never waits on another site. A logo drawn for one theme has its
// other-theme version beside it.
const LOGOS: Record<AiProvider, { light: string; dark?: string }> = {
  claude: { light: '/ai-logos/claude.svg' },
  openai: { light: '/ai-logos/openai.svg', dark: '/ai-logos/openai-dark.svg' },
  gemini: { light: '/ai-logos/gemini.svg' },
  deepseek: { light: '/ai-logos/deepseek.svg' },
  grok: { light: '/ai-logos/grok.svg', dark: '/ai-logos/grok-dark.svg' },
  mistral: { light: '/ai-logos/mistral.svg' },
};

/** A provider's logo, in the version for the current theme. */
export function AiMark({ provider, size = 16 }: { provider: AiProvider; size?: number }) {
  const { light, dark } = LOGOS[provider];
  const img = (src: string, className?: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- a small static logo; next/image adds nothing here
    <img src={src} alt="" width={size} height={size} draggable={false} className={`object-contain ${className ?? ''}`} style={{ width: size, height: size }} />
  );
  return dark ? <>{img(light, 'dark:hidden')}{img(dark, 'hidden dark:block')}</> : img(light);
}
