'use client';

import { useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Check, ChevronLeft, Download, Palette } from '@/ui/icons';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { LABEL_PALETTE } from '@/Function/shared/labelColor';
import { MENU_ROW } from '@/Function/shared/menu';
import { downloadBytes } from '@/Function/office/downloadFile';
import type { ChartSpec } from './chartSpec';
import { CHART_CARD_CLASS, chartFileName, chartSlots, effectiveColor, withSlotColor, type ChartColorSlot } from './chartColors';

// A chart the AI drew inside its answer, on a floating card (the
// Execution Chain cards' surface). The spec is data only (chartSpec.ts
// validates it); colors are the theme accent's family (chartColors.ts)
// unless the person recolored a slot — their picks are an annotation
// on the message, never part of the spec. A settled chart can be
// recolored from its card and downloaded as it looks.

const AXIS = { stroke: 'var(--text-tertiary)', fontSize: 11, tickLine: false } as const;
const TOOLTIP = {
  contentStyle: { background: 'var(--surface-overlay)', borderColor: 'var(--border-subtle)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--text-secondary)' },
} as const;

const TOOLBAR_BUTTON =
  'flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground';

export default function ChatChart({ spec, colors, onColorsChange, interactive }: {
  spec: ChartSpec;
  /** The person's stored colors for this chart (slot key → hex). */
  colors?: Record<string, string>;
  /** Present when the person may recolor: called with the chart's
   *  whole next override record (a pick, a reset, reset-all). */
  onColorsChange?: (next: Record<string, string>) => void;
  /** A settled message's chart: the card's toolbar shows. A chart
   *  still being streamed is read-only. */
  interactive?: boolean;
}) {
  const { t } = useI18n();
  const figureRef = useRef<HTMLElement | null>(null);
  const { type, data, series } = spec;
  const many = series.length > 1;
  const colorAt = (key: string, index: number) => effectiveColor(colors, key, index);
  return (
    <figure ref={figureRef} className={`${CHART_CARD_CLASS} group/chart p-3 animate-fade-in`}>
      {(spec.title || interactive) && (
        <div className="flex items-center justify-between gap-2 pb-1">
          {spec.title
            ? <span className="min-w-0 truncate text-[12px] font-medium text-foreground">{spec.title}</span>
            : <span />}
          {interactive && (
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/chart:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 [@media(hover:none)]:opacity-100">
              {onColorsChange && <ChartColorMenu spec={spec} colors={colors} onColorsChange={onColorsChange} />}
              <button type="button" title={t('Download chart')} aria-label={t('Download chart')}
                className={TOOLBAR_BUTTON}
                onClick={() => { if (figureRef.current) void exportChartPng(figureRef.current, spec, colors); }}>
                <Download size={13} />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {type === 'pie' ? (
            <PieChart>
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Pie data={data} dataKey={series[0]} nameKey="name" innerRadius="45%" outerRadius="80%" paddingAngle={1} stroke="var(--card)" strokeWidth={2}>
                {data.map((row, i) => <Cell key={i} fill={colorAt(row.name, i)} />)}
              </Pie>
            </PieChart>
          ) : type === 'line' ? (
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => <Line key={key} dataKey={key} stroke={colorAt(key, i)} strokeWidth={2} dot={false} />)}
            </LineChart>
          ) : type === 'area' ? (
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => <Area key={key} dataKey={key} stroke={colorAt(key, i)} fill={colorAt(key, i)} fillOpacity={0.15} />)}
            </AreaChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--surface-strong)' }} />
              {many && <Legend wrapperStyle={{ fontSize: 11 }} />}
              {series.map((key, i) => <Bar key={key} dataKey={key} fill={colorAt(key, i)} radius={[4, 4, 0, 0]} stackId={spec.stacked ? 's' : undefined} />)}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/**
 * The Palette button's popover: one row per color slot (series keys;
 * pie: row names). Picking a row opens that slot's palette — the
 * label palette's nine hexes, a custom color input, and a way back
 * to the theme color — and the foot resets the whole chart. Charts
 * store hex directly (labels store palette keys), so this is a small
 * sibling of LabelPaletteRows reading the same LABEL_PALETTE data.
 */
function ChartColorMenu({ spec, colors, onColorsChange }: {
  spec: ChartSpec;
  colors?: Record<string, string>;
  onColorsChange: (next: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const slots = chartSlots(spec);
  const slot = slots.find((s) => s.key === slotKey) ?? null;
  const anyOverride = !!colors && Object.keys(colors).length > 0;
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSlotKey(null); }}>
      <PopoverTrigger asChild>
        <button type="button" title={t('Chart colors')} aria-label={t('Chart colors')} className={TOOLBAR_BUTTON}>
          <Palette size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        {slot ? (
          <SlotPalette slot={slot} override={colors?.[slot.key]}
            onBack={() => setSlotKey(null)}
            onPick={(hex) => onColorsChange(withSlotColor(colors, slot.key, hex))} />
        ) : (
          <div>
            {slots.map((s) => (
              <button key={s.key} type="button" onClick={() => setSlotKey(s.key)}
                aria-label={t('Color for {name}', { name: s.label })}
                className={`${MENU_ROW} justify-between`}>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: effectiveColor(colors, s.key, s.index) }} />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="text-[11px] text-muted-foreground">{colors?.[s.key] ? t('Custom') : ''}</span>
              </button>
            ))}
            {anyOverride && (
              <>
                <div className="my-1 border-t border-border/60" />
                <button type="button" onClick={() => onColorsChange({})} className={MENU_ROW}>
                  {t('Reset all colors')}
                </button>
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** One slot's palette: the nine label-palette hexes (check on the
 *  current pick), a custom color, and — when the slot is recolored —
 *  the way back to its theme color. */
function SlotPalette({ slot, override, onBack, onPick }: {
  slot: ChartColorSlot;
  override?: string;
  onBack: () => void;
  onPick: (hex: string | null) => void;
}) {
  const { t } = useI18n();
  const custom = override && !LABEL_PALETTE.some((p) => p.hex === override) ? override : null;
  return (
    <div>
      <button type="button" onClick={onBack} className={`${MENU_ROW} text-muted-foreground`}>
        <ChevronLeft size={13} className="shrink-0" />
        <span className="truncate">{slot.label}</span>
      </button>
      <div className="my-1 border-t border-border/60" />
      {LABEL_PALETTE.map((p) => (
        <button key={p.key} type="button" role="menuitemradio" aria-checked={override === p.hex}
          onClick={() => onPick(p.hex)} className={`${MENU_ROW} justify-between`}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.hex }} />
            <span className="truncate">{t(p.label)}</span>
          </span>
          {override === p.hex && <Check size={13} className="shrink-0 text-muted-foreground" />}
        </button>
      ))}
      <label className={`${MENU_ROW} cursor-pointer justify-between`}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{t('Custom color')}</span>
          {custom && <Check size={13} className="shrink-0 text-muted-foreground" />}
        </span>
        <input type="color" aria-label={t('Custom color')}
          // design-lint-ignore — <input type="color"> takes only #rrggbb; black is its empty value
          value={custom ?? '#000000'}
          onChange={(e) => onPick(e.target.value)}
          className="h-6 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0" />
      </label>
      {override && (
        <>
          <div className="my-1 border-t border-border/60" />
          <button type="button" onClick={() => onPick(null)} className={MENU_ROW}>
            {t('Theme colors')}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Downloads the chart as it looks — PNG at 2×. Recharts' legend and
 * the card's title are HTML, not part of the SVG, so the PNG is
 * composed on a canvas: the card's background, the title, the plot,
 * and a legend drawn from the spec in the slots' effective colors.
 *
 * The SVG's fills and strokes are CSS expressions (var(), color-mix)
 * that an <img> loaded from a blob cannot resolve, so the live
 * document lends its answers: the clone is walked alongside the live
 * tree and each element's computed paint is baked onto it as inline
 * style (which outranks any presentation attribute it also carries).
 */
async function exportChartPng(figure: HTMLElement, spec: ChartSpec, colors?: Record<string, string>): Promise<void> {
  const svg = figure.querySelector<SVGSVGElement>('svg.recharts-surface');
  if (!svg) return;
  const SCALE = 2;
  const PAD = 16;
  const figStyle = getComputedStyle(figure);
  const fontFamily = figStyle.fontFamily;
  const svgRect = svg.getBoundingClientRect();
  const frameW = figure.getBoundingClientRect().width;
  const slots = chartSlots(spec);

  // A hidden probe resolves a CSS color expression to the concrete
  // color the document computes for it.
  const probe = document.createElement('span');
  probe.style.display = 'none';
  figure.appendChild(probe);
  const resolveColor = (expr: string): string => {
    if (/^#[0-9a-fA-F]{6}$/.test(expr)) return expr;
    probe.style.color = expr;
    return getComputedStyle(probe).color;
  };
  const legendText = resolveColor('var(--text-secondary)');

  // Bake the live tree's computed paint into the clone.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const liveEls = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const cloneEls = [clone, ...Array.from(clone.querySelectorAll('*'))];
  liveEls.forEach((live, i) => {
    const cs = getComputedStyle(live);
    const target = cloneEls[i] as SVGElement;
    for (const prop of ['fill', 'stroke', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family']) {
      const value = cs.getPropertyValue(prop);
      if (value) target.style.setProperty(prop, value);
    }
  });
  clone.setAttribute('width', String(Math.round(svgRect.width)));
  clone.setAttribute('height', String(Math.round(svgRect.height)));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  // Legend layout: swatch + label items, wrapping at the frame width.
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.font = `11px ${fontFamily}`;
  const legendRows: { label: string; color: string; x: number }[][] = [];
  {
    let row: { label: string; color: string; x: number }[] = [];
    let x = PAD;
    for (const s of slots) {
      const w = 10 + 4 + ctx.measureText(s.label).width;
      if (row.length > 0 && x + w > frameW - PAD) { legendRows.push(row); row = []; x = PAD; }
      row.push({ label: s.label, color: resolveColor(effectiveColor(colors, s.key, s.index)), x });
      x += w + 12;
    }
    if (row.length > 0) legendRows.push(row);
  }
  probe.remove();
  const titleH = spec.title ? 20 : 0;
  const legendH = legendRows.length > 0 ? 8 + legendRows.length * 15 : 0;
  const frameH = PAD + titleH + svgRect.height + legendH + PAD;

  canvas.width = Math.round(frameW * SCALE);
  canvas.height = Math.round(frameH * SCALE);
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = figStyle.backgroundColor;
  ctx.fillRect(0, 0, frameW, frameH);
  if (spec.title) {
    ctx.font = `600 13px ${fontFamily}`;
    ctx.fillStyle = figStyle.color;
    ctx.fillText(spec.title, PAD, PAD + 13);
  }
  const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('chart svg failed to load'));
      img.src = svgUrl;
    });
    ctx.drawImage(img, (frameW - svgRect.width) / 2, PAD + titleH, svgRect.width, svgRect.height);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
  ctx.font = `11px ${fontFamily}`;
  legendRows.forEach((row, r) => {
    const y = PAD + titleH + svgRect.height + 8 + r * 15;
    for (const item of row) {
      ctx.fillStyle = item.color;
      ctx.fillRect(item.x, y, 10, 10);
      ctx.fillStyle = legendText;
      ctx.fillText(item.label, item.x + 14, y + 9);
    }
  });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  downloadBytes(new Uint8Array(await blob.arrayBuffer()), chartFileName(spec), 'image/png');
}
