// PowerPoint's preset shapes as outlines: for a shape name (prstGeom
// "prst") at a size, the SVG path that fills it, with the shape's adjust
// values (avLst — a corner's radius, an arrow's shaft and head) applied
// over the defaults the file format defines. Lines and connectors come back
// as open paths to stroke. Covered are the shapes decks use day to day —
// boxes, polygons, arrows, stars, callouts, flowchart symbols, connectors;
// an unknown name returns null and the view draws a rectangle.

export interface PresetPath {
  /** The filled outline. */
  fill: string;
  /** Extra strokes inside the outline (a cylinder's rim, a cube's edges). */
  detail?: string;
  /** An open path, stroked only (lines and connectors). */
  line?: boolean;
  /** Even-odd filling (a ring). */
  evenOdd?: boolean;
}

type Adj = Record<string, number>;
const n = (v: number) => Math.round(v * 100) / 100;
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')} Z`;
const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${n(cx - rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(cy)} A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(cy)} Z`;
/** A rectangle whose corners are rounded by the four radii (tl, tr, br, bl). */
const rounded = (w: number, h: number, [tl, tr, br, bl]: number[]) =>
  `M${n(tl)} 0 H${n(w - tr)} A${n(tr)} ${n(tr)} 0 0 1 ${n(w)} ${n(tr)} V${n(h - br)} A${n(br)} ${n(br)} 0 0 1 ${n(w - br)} ${n(h)} H${n(bl)} A${n(bl)} ${n(bl)} 0 0 1 0 ${n(h - bl)} V${n(tl)} A${n(tl)} ${n(tl)} 0 0 1 ${n(tl)} 0 Z`;
/** A regular polygon or star inscribed in the box. */
const radial = (w: number, h: number, points: number, inner: number | null) => {
  const pts: [number, number][] = [];
  const steps = inner == null ? points : points * 2;
  for (let i = 0; i < steps; i++) {
    const r = inner != null && i % 2 ? inner : 1;
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    pts.push([w / 2 + (w / 2) * r * Math.cos(a), h / 2 + (h / 2) * r * Math.sin(a)]);
  }
  return poly(pts);
};

/** Pure. The outline of a preset shape at w × h, or null when unknown. */
export function presetPath(prst: string, w: number, h: number, adjust: Adj = {}): PresetPath | null {
  const ss = Math.min(w, h);
  const a = (name: string, dflt: number) => (adjust[name] ?? dflt) / 100000;
  switch (prst) {
    case 'rect': case 'flowChartProcess': case 'textBox':
      return { fill: poly([[0, 0], [w, 0], [w, h], [0, h]]) };
    case 'roundRect': case 'flowChartAlternateProcess': {
      const r = ss * a('adj', 16667);
      return { fill: rounded(w, h, [r, r, r, r]) };
    }
    case 'flowChartTerminator':
      return { fill: rounded(w, h, Array(4).fill(Math.min(h / 2, w / 2))) };
    case 'round1Rect': { const r = ss * a('adj', 16667); return { fill: rounded(w, h, [0, r, 0, 0]) }; }
    case 'round2SameRect': { const r = ss * a('adj1', 16667); return { fill: rounded(w, h, [r, r, 0, 0]) }; }
    case 'round2DiagRect': { const r = ss * a('adj1', 16667); return { fill: rounded(w, h, [r, 0, r, 0]) }; }
    case 'snip1Rect': { const s = ss * a('adj', 16667); return { fill: poly([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]) }; }
    case 'snip2SameRect': { const s = ss * a('adj1', 16667); return { fill: poly([[s, 0], [w - s, 0], [w, s], [w, h], [0, h], [0, s]]) }; }
    case 'ellipse': case 'flowChartConnector': case 'cloud': case 'flowChartOnlineStorage':
      return { fill: ellipse(w / 2, h / 2, w / 2, h / 2) };
    case 'donut': {
      const t = ss * a('adj', 25000);
      return { fill: `${ellipse(w / 2, h / 2, w / 2, h / 2)} ${ellipse(w / 2, h / 2, w / 2 - t, h / 2 - t)}`, evenOdd: true };
    }
    case 'triangle': { const x = w * a('adj', 50000); return { fill: poly([[x, 0], [w, h], [0, h]]) }; }
    case 'rtTriangle': return { fill: poly([[0, 0], [w, h], [0, h]]) };
    case 'diamond': case 'flowChartDecision': return { fill: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) };
    case 'parallelogram': case 'flowChartInputOutput': case 'flowChartData': {
      const x = prst === 'parallelogram' ? ss * a('adj', 25000) : w * 0.2;
      return { fill: poly([[x, 0], [w, 0], [w - x, h], [0, h]]) };
    }
    case 'trapezoid': { const x = ss * a('adj', 25000); return { fill: poly([[x, 0], [w - x, 0], [w, h], [0, h]]) }; }
    case 'flowChartExtract': case 'flowChartMerge': {
      const up: [number, number][] = [[w / 2, 0], [w, h], [0, h]];
      return { fill: poly(prst === 'flowChartMerge' ? up.map(([x, y]) => [x, h - y]) : up) };
    }
    case 'flowChartDelay':
      return { fill: `M0 0 H${n(w / 2)} A${n(w / 2)} ${n(h / 2)} 0 0 1 ${n(w / 2)} ${n(h)} H0 Z` };
    case 'flowChartOffpageConnector': return { fill: poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]) };
    case 'flowChartPunchedCard': return { fill: poly([[w * 0.2, 0], [w, 0], [w, h], [0, h], [0, h * 0.2]]) };
    case 'flowChartCollate': return { fill: poly([[0, 0], [w, 0], [0, h], [w, h]]) };
    case 'flowChartSort': return { fill: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), detail: `M0 ${n(h / 2)} H${n(w)}` };
    case 'flowChartSummingJunction': case 'flowChartOr': {
      const r = Math.SQRT1_2;
      return {
        fill: ellipse(w / 2, h / 2, w / 2, h / 2),
        detail: prst === 'flowChartOr' ? `M${n(w / 2)} 0 V${n(h)} M0 ${n(h / 2)} H${n(w)}`
          : `M${n(w / 2 - (w / 2) * r)} ${n(h / 2 - (h / 2) * r)} L${n(w / 2 + (w / 2) * r)} ${n(h / 2 + (h / 2) * r)} M${n(w / 2 + (w / 2) * r)} ${n(h / 2 - (h / 2) * r)} L${n(w / 2 - (w / 2) * r)} ${n(h / 2 + (h / 2) * r)}`,
      };
    }
    case 'flowChartInternalStorage':
      return { fill: poly([[0, 0], [w, 0], [w, h], [0, h]]), detail: `M${n(w * 0.1)} 0 V${n(h)} M0 ${n(h * 0.1)} H${n(w)}` };
    case 'flowChartMultidocument':
      return { fill: `M0 ${n(h * 0.1)} H${n(w * 0.9)} V${n(h * 0.85)} C${n(w * 0.65)} ${n(h * 0.72)} ${n(w * 0.45)} ${n(h * 1.05)} 0 ${n(h * 0.92)} Z`, detail: `M${n(w * 0.05)} ${n(h * 0.1)} V${n(h * 0.05)} H${n(w * 0.95)} V${n(h * 0.8)} M${n(w * 0.1)} ${n(h * 0.05)} V0 H${n(w)} V${n(h * 0.75)}` };
    case 'flowChartManualInput': return { fill: poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]) };
    case 'flowChartManualOperation': return { fill: poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]) };
    case 'pentagon': return { fill: radial(w, h, 5, null) };
    case 'hexagon': case 'flowChartPreparation': {
      const x = prst === 'hexagon' ? ss * a('adj', 25000) : w * 0.2;
      return { fill: poly([[x, 0], [w - x, 0], [w, h / 2], [w - x, h], [x, h], [0, h / 2]]) };
    }
    case 'heptagon': return { fill: radial(w, h, 7, null) };
    case 'octagon': {
      const x = ss * a('adj', 29289);
      return { fill: poly([[x, 0], [w - x, 0], [w, x], [w, h - x], [w - x, h], [x, h], [0, h - x], [0, x]]) };
    }
    case 'decagon': return { fill: radial(w, h, 10, null) };
    case 'dodecagon': return { fill: radial(w, h, 12, null) };
    case 'star4': return { fill: radial(w, h, 4, a('adj', 12500) * 2) };
    case 'star5': return { fill: radial(w, h, 5, 0.382) };
    case 'star6': return { fill: radial(w, h, 6, 0.577) };
    case 'star8': return { fill: radial(w, h, 8, 0.75) };
    case 'star10': case 'star12': case 'star16': case 'star24': case 'star32':
      return { fill: radial(w, h, Number(prst.slice(4)), 0.8) };
    case 'homePlate': { const x = w - ss * a('adj', 50000); return { fill: poly([[0, 0], [x, 0], [w, h / 2], [x, h], [0, h]]) }; }
    case 'chevron': { const x = ss * a('adj', 50000); return { fill: poly([[0, 0], [w - x, 0], [w, h / 2], [w - x, h], [0, h], [x, h / 2]]) }; }
    case 'rightArrow': case 'leftArrow': case 'notchedRightArrow': {
      const th = h * a('adj1', 50000), hl = ss * a('adj2', 50000);
      const y1 = (h - th) / 2, y2 = (h + th) / 2;
      const right: [number, number][] = [[0, y1], [w - hl, y1], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, y2], [0, y2]];
      if (prst === 'notchedRightArrow') right.push([hl * 0.5 * (th / h), h / 2]);
      return { fill: poly(prst === 'leftArrow' ? right.map(([x, y]) => [w - x, y]) : right) };
    }
    case 'upArrow': case 'downArrow': {
      const th = w * a('adj1', 50000), hl = ss * a('adj2', 50000);
      const x1 = (w - th) / 2, x2 = (w + th) / 2;
      const up: [number, number][] = [[w / 2, 0], [w, hl], [x2, hl], [x2, h], [x1, h], [x1, hl], [0, hl]];
      return { fill: poly(prst === 'downArrow' ? up.map(([x, y]) => [x, h - y]) : up) };
    }
    case 'leftRightArrow': {
      const th = h * a('adj1', 50000), hl = ss * a('adj2', 50000);
      const y1 = (h - th) / 2, y2 = (h + th) / 2;
      return { fill: poly([[0, h / 2], [hl, 0], [hl, y1], [w - hl, y1], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, y2], [hl, y2], [hl, h]]) };
    }
    case 'upDownArrow': {
      const th = w * a('adj1', 50000), hl = ss * a('adj2', 50000);
      const x1 = (w - th) / 2, x2 = (w + th) / 2;
      return { fill: poly([[w / 2, 0], [w, hl], [x2, hl], [x2, h - hl], [w, h - hl], [w / 2, h], [0, h - hl], [x1, h - hl], [x1, hl], [0, hl]]) };
    }
    case 'plus': case 'mathPlus': {
      const t = ss * a(prst === 'plus' ? 'adj' : 'adj1', prst === 'plus' ? 25000 : 23520);
      const cx = w / 2, cy = h / 2, half = prst === 'plus' ? null : t / 2;
      if (half != null) return { fill: poly([[cx - half, 0], [cx + half, 0], [cx + half, cy - half], [w, cy - half], [w, cy + half], [cx + half, cy + half], [cx + half, h], [cx - half, h], [cx - half, cy + half], [0, cy + half], [0, cy - half], [cx - half, cy - half]]) };
      return { fill: poly([[t, 0], [w - t, 0], [w - t, t], [w, t], [w, h - t], [w - t, h - t], [w - t, h], [t, h], [t, h - t], [0, h - t], [0, t], [t, t]]) };
    }
    case 'mathMinus': { const t = h * a('adj1', 23520); return { fill: poly([[0, (h - t) / 2], [w, (h - t) / 2], [w, (h + t) / 2], [0, (h + t) / 2]]) }; }
    case 'wedgeRectCallout': case 'wedgeRoundRectCallout': case 'wedgeEllipseCallout': {
      const tx = w / 2 + w * a('adj1', -20833), ty = h / 2 + h * a('adj2', 62500);
      const below = ty > h, above = ty < 0;
      const base = below || above ? [Math.max(0, Math.min(w, w / 2 + (tx - w / 2) * 0.3 - w * 0.08)), Math.max(0, Math.min(w, w / 2 + (tx - w / 2) * 0.3 + w * 0.08))]
        : [Math.max(0, Math.min(h, h / 2 - h * 0.08)), Math.max(0, Math.min(h, h / 2 + h * 0.08))];
      const tail = below ? poly([[base[0], h - 1], [tx, ty], [base[1], h - 1]])
        : above ? poly([[base[0], 1], [tx, ty], [base[1], 1]])
        : tx > w ? poly([[w - 1, base[0]], [tx, ty], [w - 1, base[1]]]) : poly([[1, base[0]], [tx, ty], [1, base[1]]]);
      const body = prst === 'wedgeEllipseCallout' ? ellipse(w / 2, h / 2, w / 2, h / 2)
        : prst === 'wedgeRoundRectCallout' ? rounded(w, h, Array(4).fill(ss * 0.16667)) : poly([[0, 0], [w, 0], [w, h], [0, h]]);
      return { fill: `${body} ${tail}` };
    }
    case 'can': case 'flowChartMagneticDisk': {
      const ry = Math.min(h / 2, ss * a('adj', 25000) / 2);
      return {
        fill: `M0 ${n(ry)} A${n(w / 2)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)} V${n(h - ry)} A${n(w / 2)} ${n(ry)} 0 0 1 0 ${n(h - ry)} Z`,
        detail: `M0 ${n(ry)} A${n(w / 2)} ${n(ry)} 0 0 0 ${n(w)} ${n(ry)}`,
      };
    }
    case 'cube': {
      const d = ss * a('adj', 25000);
      return {
        fill: poly([[d, 0], [w, 0], [w, h - d], [w - d, h], [0, h], [0, d]]),
        detail: `M0 ${n(d)} H${n(w - d)} L${n(w)} 0 M${n(w - d)} ${n(d)} V${n(h)}`,
      };
    }
    case 'flowChartPredefinedProcess':
      return { fill: poly([[0, 0], [w, 0], [w, h], [0, h]]), detail: `M${n(w * 0.125)} 0 V${n(h)} M${n(w * 0.875)} 0 V${n(h)}` };
    case 'flowChartDocument':
      return { fill: `M0 0 H${n(w)} V${n(h * 0.83)} C${n(w * 0.75)} ${n(h * 0.7)} ${n(w * 0.5)} ${n(h * 1.05)} 0 ${n(h * 0.9)} Z` };
    case 'heart':
      return { fill: `M${n(w / 2)} ${n(h * 0.25)} C${n(w * 0.5)} 0 0 0 0 ${n(h * 0.3)} C0 ${n(h * 0.6)} ${n(w * 0.5)} ${n(h * 0.8)} ${n(w / 2)} ${n(h)} C${n(w * 0.5)} ${n(h * 0.8)} ${n(w)} ${n(h * 0.6)} ${n(w)} ${n(h * 0.3)} C${n(w)} 0 ${n(w * 0.5)} 0 ${n(w / 2)} ${n(h * 0.25)} Z` };
    case 'lightningBolt':
      return { fill: poly([[w * 0.39, 0], [w * 0.62, h * 0.32], [w * 0.52, h * 0.37], [w * 0.8, h * 0.66], [w * 0.68, h * 0.71], [w, h], [w * 0.3, h * 0.6], [w * 0.43, h * 0.54], [0, h * 0.25], [w * 0.15, h * 0.18]]) };
    case 'frame': {
      const t = ss * a('adj1', 12500);
      return { fill: `${poly([[0, 0], [w, 0], [w, h], [0, h]])} ${poly([[t, t], [w - t, t], [w - t, h - t], [t, h - t]])}`, evenOdd: true };
    }
    case 'line': case 'straightConnector1':
      return { fill: `M0 0 L${n(w)} ${n(h)}`, line: true };
    case 'bentConnector2':
      return { fill: `M0 0 H${n(w)} V${n(h)}`, line: true };
    case 'bentConnector3': case 'bentConnector4': case 'bentConnector5': {
      const x = w * a('adj1', 50000);
      return { fill: `M0 0 H${n(x)} V${n(h)} H${n(w)}`, line: true };
    }
    case 'curvedConnector2': case 'curvedConnector3': case 'curvedConnector4': case 'curvedConnector5':
      return { fill: `M0 0 C${n(w / 2)} 0 ${n(w / 2)} ${n(h)} ${n(w)} ${n(h)}`, line: true };
    default:
      return null;
  }
}
