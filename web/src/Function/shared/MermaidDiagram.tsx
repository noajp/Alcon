'use client';

import { formatError } from './formatError';
import { useEffect, useState } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';

// Mermaid diagrams (```mermaid blocks in Markdown), drawn wherever Markdown
// is shown — an Element's description, the AI's answers. The library is
// large, so it loads the first time a diagram appears. `securityLevel:
// 'strict'` has Mermaid sanitize its SVG and refuse script and HTML labels,
// so what a description says cannot run in the page.

type Mermaid = typeof import('mermaid').default;
let loading: Promise<Mermaid> | null = null;
const load = () => (loading ??= import('mermaid').then((m) => m.default));

/** Whether the app is in a dark theme (globals.css: the `dark` variant). */
const isDark = () => typeof document !== 'undefined' && !!document.querySelector('.dark, .theme-midnight, .theme-carbon, .theme-graphite');

/** A token's colour as opaque rgb, any alpha laid over the card it sits on
 *  (Mermaid mixes colours itself and reads neither variables nor alpha). */
function tokenColor(name: string, over?: [number, number, number]): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  probe.remove();
  const m = raw.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/);
  if (!m) return raw;
  const [r, g, b, a = 1] = m.slice(1).map((v) => (v === undefined ? undefined : Number(v))) as number[];
  const base = over ?? [r, g, b];
  const mix = (c: number, i: number) => Math.round(c * (a ?? 1) + base[i] * (1 - (a ?? 1)));
  return `rgb(${mix(r, 0)}, ${mix(g, 1)}, ${mix(b, 2)})`;
}

/** Clayware's look for a diagram: nodes as raised cards with a quiet edge and
 *  rounded corners, muted connectors, labels in the page's font and size. */
function claywareTheme() {
  const cardRgb = (tokenColor('--card').match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number) as [number, number, number];
  const card = tokenColor('--card');
  const node = tokenColor('--muted', cardRgb);
  const text = tokenColor('--foreground', cardRgb);
  const quiet = tokenColor('--muted-foreground', cardRgb);
  const edge = tokenColor('--border-strong', cardRgb);
  const accent = tokenColor('--accent-default', cardRgb);
  return {
    theme: 'base' as const,
    themeVariables: {
      background: card, mainBkg: node, primaryColor: node, secondaryColor: node, tertiaryColor: card,
      primaryTextColor: text, secondaryTextColor: text, tertiaryTextColor: text, textColor: text, nodeTextColor: text,
      primaryBorderColor: edge, secondaryBorderColor: edge, tertiaryBorderColor: edge, nodeBorder: edge, clusterBorder: edge,
      clusterBkg: card, lineColor: quiet, edgeLabelBackground: card, titleColor: text,
      actorBkg: node, actorBorder: edge, actorTextColor: text, signalColor: quiet, signalTextColor: text, noteBkgColor: node, noteBorderColor: edge, noteTextColor: text,
      activationBkgColor: node, activationBorderColor: accent,
      fontSize: '13px',
    },
    // Corners rounded and lines thin, as the page's own cards and rules.
    themeCSS: `
      .node rect, .node polygon, .node circle, .cluster rect { stroke-width: 1px; }
      .node rect, .cluster rect { rx: 8px; ry: 8px; }
      .edgePath .path, .flowchart-link { stroke-width: 1.4px; }
      .edgeLabel rect, .labelBkg { opacity: 1; }
    `,
  };
}

const cache = new Map<string, string>();
let seq = 0;

/** A diagram's SVG, or why it could not be drawn. Cached per source and theme. */
export async function renderMermaid(code: string): Promise<{ svg: string } | { error: string }> {
  const dark = isDark();
  const key = `${dark ? 'd' : 'l'}:${code}`;
  const hit = cache.get(key);
  if (hit) return { svg: hit };
  try {
    const mermaid = await load();
    // Labels as SVG text (not HTML in foreignObject, which strict mode
    // empties), measured in the page's own font.
    const font = getComputedStyle(document.body).fontFamily || 'sans-serif';
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', fontFamily: font, ...claywareTheme(),
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true, curve: 'basis', padding: 14, nodeSpacing: 36, rankSpacing: 44 },
    });
    const { svg: drawn } = await mermaid.render(`clayware-mermaid-${++seq}`, code);
    // Laid out once off screen, in the page's font, to fit its frame.
    const holder = document.createElement('div');
    holder.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;font-family:${font}`;
    holder.innerHTML = drawn;
    document.body.appendChild(holder);
    fitMermaidSvg(holder);
    const svg = holder.innerHTML;
    holder.remove();
    cache.set(key, svg);
    return { svg };
  } catch (e) {
    return { error: formatError(e) };
  }
}

/** Fits a drawn diagram's frame to what it actually drew. Mermaid sizes
 *  the SVG from text it measured off screen, which can come out narrower
 *  than the text in the page — the right of the diagram was cut off. */
function fitMermaidSvg(container: Element | null): void {
  const svg = container?.querySelector('svg');
  if (!svg) return;
  const b = svg.getBBox();
  if (!b.width || !b.height) return;
  const pad = 8;
  svg.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
  svg.style.maxWidth = `${b.width + pad * 2}px`;
}

/** A ```mermaid block drawn as its diagram; its source, with the reason, when it cannot be. */
export function MermaidDiagram({ code }: { code: string }) {
  const { t } = useI18n();
  const [out, setOut] = useState<{ svg: string } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    void renderMermaid(code).then((r) => { if (live) setOut(r); });
    return () => { live = false; };
  }, [code]);
  if (!out) return <div className="h-24 animate-pulse rounded-md bg-muted/40" aria-busy="true" />;
  if ('error' in out) {
    return (
      <div className="space-y-1">
        <p className="text-[12px] text-[var(--status-danger)]">{t('Could not draw the diagram.')}</p>
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-[12px] leading-relaxed">{code}</pre>
      </div>
    );
  }
  // Mermaid's own sanitized SVG (securityLevel: 'strict').
  return <div className="mermaid-diagram flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: out.svg }} />;
}
