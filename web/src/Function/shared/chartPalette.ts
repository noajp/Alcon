// The colors every chart draws its series and slices in, chosen in
// Settings > Preferences. Each palette is CSS expressions over the theme's
// tokens, so it follows light and dark and the key color; a person's
// per-chart picks (chartColors) still win over it.

export type ChartPaletteKey = 'key-red' | 'key' | 'vivid';

const accent = (toward: string, pct: number) => `color-mix(in oklab, var(--accent-default), ${toward} ${pct}%)`;
const danger = (toward: string, pct: number) => `color-mix(in oklab, var(--status-danger), ${toward} ${pct}%)`;

export const CHART_PALETTES: readonly { key: ChartPaletteKey; label: string; colors: readonly string[] }[] = [
  {
    // The key color lifted to a pale blue, with red as the one contrast.
    key: 'key-red', label: 'Key color and red',
    colors: [
      accent('var(--text-primary)', 35), 'var(--status-danger)', 'var(--accent-default)',
      danger('var(--text-primary)', 40), accent('var(--text-primary)', 65), accent('var(--card)', 40),
    ],
  },
  {
    key: 'key', label: 'Key color',
    colors: [
      'var(--accent-default)', accent('var(--text-primary)', 40), accent('var(--card)', 35),
      accent('var(--text-primary)', 65), accent('var(--text-primary)', 20), accent('var(--card)', 55),
    ],
  },
  {
    key: 'vivid', label: 'Vivid',
    colors: ['var(--accent-default)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-1)'],
  },
];

export const DEFAULT_CHART_PALETTE: ChartPaletteKey = 'key-red';

/** Pure. A palette's colors; an unknown key reads as the default. */
export function chartPaletteColors(key: string): readonly string[] {
  return (CHART_PALETTES.find((p) => p.key === key) ?? CHART_PALETTES[0]).colors;
}
