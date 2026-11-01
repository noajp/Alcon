import { describe, expect, it } from 'vitest';
import { chartContent, deckFromPptx, hexOf } from '@/ActivitySpace/sustainment/slides/kata/model/fromPptx';
import { fromKataJson, toKataJson } from '@/ActivitySpace/sustainment/slides/kata/model/kataFile';
import type { Deck as PptxDeck, DeckItem, TextBody } from '@/Function/office/deckLayout';
import type { ChartData, ChartSeries } from '@/Function/office/chartLayout';

const series = (name: string, values: (number | null)[]): ChartSeries => ({ name, color: null, values, type: 'bar', axis: 'left', labels: false });

const body = (text: string, o: Partial<TextBody> = {}, run: Record<string, unknown> = {}): TextBody => ({
  paras: text.split('\n').map((t) => ({ align: 'left', runs: [{ text: t, size: 18, bold: false, italic: false, underline: false, color: null, font: null, spacing: 0, ...run }], bullet: null, indent: 0, lineHeight: null })),
  anchor: 'top', inset: [0, 0, 0, 0], vertical: false, wrap: true, ...o,
});
const shape = (o: Partial<Extract<DeckItem, { kind: 'shape' }>>): DeckItem => ({ kind: 'shape', geom: 'rect', adj: {}, flipH: false, flipV: false, fill: null, stroke: null, text: null, x: 0, y: 0, w: 100, h: 50, rot: 0, ...o });
const deck = (items: DeckItem[], o: Partial<PptxDeck> = {}): PptxDeck => ({ width: 960, height: 540, slides: [{ background: null, items }], ...o });

describe('hexOf', () => {
  it('reads hex, rgba and gradients, and drops transparency', () => {
    expect(hexOf('#A1B2C3')).toBe('#a1b2c3');
    expect(hexOf('rgba(255, 0, 16, 0.5)')).toBe('#ff0010');
    expect(hexOf('rgba(0, 0, 0, 0)')).toBeNull();
    expect(hexOf('linear-gradient(90deg, #112233 0%, #445566 100%)')).toBe('#112233');
    expect(hexOf(null)).toBeNull();
  });
});

describe('deckFromPptx', () => {
  it('scales a 16:9 deck to 1280×720 and keeps shapes, text and the title', () => {
    const d = deckFromPptx(deck([
      shape({ geom: 'roundRect', fill: '#ff0000', x: 96, y: 54, w: 192, h: 108, text: body('Box', { anchor: 'top' }, { bold: true, color: '#ffffff' }) }),
      shape({ x: 0, y: 0, w: 960, h: 60, text: body('Big title', {}, { size: 40 }) }),
      shape({ geom: 'ellipse', stroke: { color: '#00ff00', width: 3, dash: true, head: false, tail: false } }),
    ]), 'Deck');
    expect(d.title).toBe('Deck');
    const [s] = d.slides;
    expect(s).toMatchObject({ layout: 'free', title: 'Big title', content: { free: {} } });
    const [bg, rect, boxText, title, ellipse] = s.objects!;
    expect(bg).toMatchObject({ kind: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: '#ffffff', behind: true });
    expect(rect).toMatchObject({ kind: 'rect', x: 128, y: 72, w: 256, h: 144, fill: '#ff0000', stroke: 'none', radius: 24 });
    expect(boxText).toMatchObject({ kind: 'text', text: 'Box', textStyle: { size: 32, bold: true, color: '#ffffff' } });
    expect(title).toMatchObject({ kind: 'text', text: 'Big title', textStyle: { size: 71 } });
    expect(ellipse).toMatchObject({ kind: 'ellipse', fill: 'none', stroke: '#00ff00', strokeWidth: 4, dash: true });
  });

  it('centres a 4:3 deck and draws lines and arrows the way they point', () => {
    const d = deckFromPptx(deck([
      shape({ geom: 'straightConnector1', x: 0, y: 0, w: 100, h: 50, flipV: true, stroke: { color: '#000000', width: 1, dash: false, head: false, tail: true } }),
      shape({ geom: 'line', x: 0, y: 0, w: 100, h: 0, stroke: { color: '#000000', width: 1, dash: false, head: true, tail: false } }),
      shape({ geom: 'line', stroke: null }),
    ], { width: 960, height: 720 }), 'x');
    const [, arrow, back] = d.slides[0].objects!;
    // 4:3 → 960 wide, 160 px of margin on each side.
    expect(arrow).toMatchObject({ kind: 'arrow', x: 160, y: 50, w: 100, h: -50 });
    expect(back).toMatchObject({ kind: 'arrow', x: 260, y: 0, w: -100, h: 0 });
    expect(d.slides[0].objects).toHaveLength(3);
  });

  it('moves middle-anchored text down, and keeps tables, pictures, charts and an image background', () => {
    const d = deckFromPptx({ width: 1280, height: 720, slides: [{ background: 'center / cover no-repeat url("data:image/png;base64,AAA")', items: [
      shape({ x: 0, y: 0, w: 400, h: 400, text: body('mid', { anchor: 'middle' }) }),
      { kind: 'image', src: 'data:image/png;base64,BBB', crop: { l: 0, t: 0, r: 0, b: 0 }, x: 10, y: 10, w: 200, h: 100, rot: 0 },
      { kind: 'chart', chart: { title: 'Sales', kind: 'pie', stacked: false, categories: ['a'], series: [] }, x: 0, y: 0, w: 300, h: 200, rot: 0 },
      { kind: 'table', cols: [100, 50], rows: [{ h: 40, cells: [{ text: body('A'), fill: '#eeeeee', span: 2, skip: false }, { text: body(''), fill: null, span: 1, skip: true }] }], x: 20, y: 30, w: 150, h: 40, rot: 0 },
    ] }] }, 'x');
    const objs = d.slides[0].objects!;
    expect(objs[0]).toMatchObject({ kind: 'image', src: 'data:image/png;base64,AAA', behind: true });
    expect(objs[1].y).toBeGreaterThan(150);
    expect(objs[2]).toMatchObject({ kind: 'image', x: 10, y: 10, w: 200, h: 100, ratio: 2 });
    expect(objs[3]).toMatchObject({ kind: 'rect', dash: true, text: 'Sales' });
    expect(objs[4]).toMatchObject({ kind: 'rect', x: 20, y: 30, w: 150, h: 40, fill: '#eeeeee', stroke: 'line' });
    expect(objs[5]).toMatchObject({ kind: 'text', text: 'A' });
    expect(objs).toHaveLength(6);
    // A slide with pictures and tables keeps its freeform page; the chart follows as its own page.
    expect(d.slides.map((s) => s.layout)).toEqual(['free', 'chart']);
  });

  it('turns a chart into a chart page, in place of a slide that is only text and the chart', () => {
    const chart: ChartData = { title: 'Sales', kind: 'column', stacked: false, categories: ['Q1', 'Q2'], series: [series('A', [1, null]), series('B', [3, 4])] };
    const d = deckFromPptx(deck([
      shape({ text: body('Sales doubled', {}, { size: 32 }) }),
      shape({ text: body('Driven by Q2') }),
      { kind: 'chart', chart, x: 0, y: 0, w: 300, h: 200, rot: 0 },
    ]), 'x');
    expect(d.slides).toHaveLength(1);
    expect(d.slides[0]).toMatchObject({ layout: 'chart', title: 'Sales doubled', content: { chart: {
      kind: 'column', categories: ['Q1', 'Q2'], series: [{ name: 'A', values: [1, 0] }, { name: 'B', values: [3, 4] }], highlight: -1, takeaway: 'Driven by Q2',
    } } });
  });

  it('maps chart kinds, keeps one series for a pie, and builds scatter axes', () => {
    const base = { title: null, stacked: false, categories: ['1', '2'], series: [series('S', [5, 6]), series('T', [7, 8])] };
    expect(chartContent({ ...base, kind: 'doughnut' })).toMatchObject({ kind: 'share', series: [{ name: 'S' }] });
    expect(chartContent({ ...base, kind: 'area' }).kind).toBe('line');
    expect(chartContent({ ...base, kind: 'scatter' }).series).toEqual([{ name: 'x', values: [1, 2] }, { name: 'S', values: [5, 6] }]);
  });

  it('survives being saved and opened again', () => {
    const d = deckFromPptx(deck([shape({ fill: '#123456', text: body('Hi') })]), 'Round trip');
    const back = fromKataJson(toKataJson('Round trip', d));
    expect(back?.deck.slides[0]).toMatchObject({ layout: 'free', objects: d.slides[0].objects });
  });
});
