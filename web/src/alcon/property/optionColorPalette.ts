// Hand-picked pastel palette a new Select/Status option's background is
// drawn from at random, so a freshly-typed option isn't colorless while the
// user picks a real one. Not a semantic color system — same exception as
// alcon/shared/labelColor.ts (see COLOR_ALLOWLIST in
// scripts/designLintRules.mjs).
const OPTION_PASTELS = [
  '#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0',
  '#fce4ec', '#e0f2f1', '#f5f5f5',
];

export function randomOptionPastel(): string {
  return OPTION_PASTELS[Math.floor(Math.random() * OPTION_PASTELS.length)];
}
