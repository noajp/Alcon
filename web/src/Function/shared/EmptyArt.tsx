'use client';

import type { ReactNode } from 'react';

// Line drawings for an empty list, one per concept, all built from the same
// rounded isometric blocks: a Domain is a stack of layers, Objects a cluster
// of blocks, Elements tiles on a grid; a Vision is a stepped summit, an
// Initiative a path to an outcome, Phases segments laid end to end. Drawn in the text color; each block is filled
// with the pane's own background so blocks in front hide the lines behind
// them.

export type EmptyArtKind = 'domain' | 'objects' | 'elements' | 'vision' | 'initiative' | 'phase';

const COS = Math.cos(Math.PI / 6);
const R = 1.6;

type Pt = [number, number];

/** A closed path through the points with each corner rounded by r. */
function rounded(points: Pt[], r: number): string {
  const n = points.length;
  const toward = (p: Pt, q: Pt): Pt => {
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const k = Math.min(r, len / 2) / len;
    return [p[0] + dx * k, p[1] + dy * k];
  };
  let d = '';
  points.forEach((p, i) => {
    const a = toward(p, points[(i - 1 + n) % n]);
    const b = toward(p, points[(i + 1) % n]);
    d += `${i === 0 ? 'M' : 'L'}${a[0].toFixed(2)},${a[1].toFixed(2)} Q${p[0].toFixed(2)},${p[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)} `;
  });
  return `${d}Z`;
}

/** `p` moved toward `q` by `by`. */
function nudge(p: Pt, q: Pt, by: number): Pt {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  return [p[0] + (q[0] - p[0]) * by / len, p[1] + (q[1] - p[1]) * by / len];
}

/** An isometric box w × d on the ground and h tall, placed by the front
 *  corner of its top face (x, y): the top runs back up-left (w) and up-right
 *  (d), and the sides hang h below. Its outline is one rounded hexagon; the
 *  three inner edges meet at the front corner. */
function Box({ x, y, w, d, h }: { x: number; y: number; w: number; d: number; h: number }) {
  const F: Pt = [x, y];
  const L: Pt = [x - COS * w, y - w / 2];
  const Rt: Pt = [x + COS * d, y - d / 2];
  const B: Pt = [L[0] + COS * d, L[1] - d / 2];
  const outline = rounded([B, Rt, [Rt[0], Rt[1] + h], [x, y + h], [L[0], L[1] + h], L], R);
  // Inner edges stop just short of the rounded outline corners.
  const l = nudge(L, F, R / 2), rt = nudge(Rt, F, R / 2);
  return (
    <>
      <path d={outline} fill="var(--empty-art-fill)" />
      <path d={`M${l[0]},${l[1]} L${x},${y} L${rt[0]},${rt[1]} M${x},${y} V${y + h - R / 2}`} />
    </>
  );
}

/** Screen position of iso grid cell (a, b) at level c, cell size s. */
function cell(a: number, b: number, c: number, s: number, ox: number, oy: number) {
  return { x: ox + (a - b) * COS * s, y: oy + (a + b) * s / 2 - c * s };
}

function DomainArt() {
  // Three layers stacked flush, bottom first.
  return (
    <>
      {[0, 1, 2].map((n) => (
        <g key={n}>
          <Box x={48} y={73 - n * 10} w={34} d={34} h={10} />
        </g>
      ))}
    </>
  );
}

function ObjectsArt() {
  // A 2×2×2 cluster of flush blocks, drawn a layer at a time, bottom first,
  // and back to front within a layer.
  const s = 17;
  const blocks: [number, number, number][] = [];
  for (let p = 0; p < 2; p++) for (let q = 0; q < 2; q++) for (let r = 0; r < 2; r++) blocks.push([p, q, r]);
  blocks.sort((u, v) => u[2] - v[2] || u[0] + u[1] - (v[0] + v[1]));
  return (
    <>
      {blocks.map(([p, q, r], n) => {
        const { x, y } = cell(p, q, r, s, 48, 48);
        return (
          <g key={n}>
            <Box x={x} y={y} w={s} d={s} h={s} />
          </g>
        );
      })}
    </>
  );
}

function ElementsArt() {
  // A 3×3 grid of flush tiles; the middle one is lifted — the one to act on.
  const s = 17;
  const tiles: [number, number][] = [];
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) tiles.push([p, q]);
  tiles.sort((u, v) => u[0] + u[1] - (v[0] + v[1]));
  return (
    <>
      {tiles.map(([p, q]) => {
        const lifted = p === 1 && q === 1;
        const { x, y } = cell(p, q, lifted ? 0.3 : 0, s, 48, 31);
        return (
          <g key={`${p}-${q}`}>
            <Box x={x} y={y} w={s} d={s} h={5} />
          </g>
        );
      })}
    </>
  );
}

function VisionArt() {
  // A stepped summit: three tiers, each smaller, stacked on one centre.
  const tiers = [42, 28, 14];
  return (
    <>
      {tiers.map((w, n) => (
        <g key={n}>
          <Box x={48} y={45 - n * 9 + w / 2} w={w} d={w} h={9} />
        </g>
      ))}
    </>
  );
}

function InitiativeArt() {
  // A path of two tiles leading to a block: the way to an outcome.
  const s = 20, a = 20;
  return (
    <>
      {[0, 1, 2].map((p) => {
        const { x, y } = cell(p, 0, 0, s, 30.7, 30);
        const h = p === 2 ? 20 : 5;
        return (
          <g key={p}>
            <Box x={x} y={y + a - h} w={a} d={a} h={h} />
          </g>
        );
      })}
    </>
  );
}

function PhaseArt() {
  // Stages laid end to end, flush.
  const len = 26;
  return (
    <>
      {[0, 1, 2].map((k) => (
        <g key={k}>
          <Box x={29 + k * COS * len} y={42 + k * len / 2} w={len} d={18} h={8} />
        </g>
      ))}
    </>
  );
}

const ART: Record<EmptyArtKind, () => ReactNode> = {
  domain: DomainArt,
  objects: ObjectsArt,
  elements: ElementsArt,
  vision: VisionArt,
  initiative: InitiativeArt,
  phase: PhaseArt,
};

export function EmptyArt({ kind, size = 80 }: { kind: EmptyArtKind; size?: number }) {
  const Art = ART[kind];
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} aria-hidden="true"
      className="empty-art overflow-visible text-[var(--text-secondary)]"
      fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round">
      <Art />
    </svg>
  );
}
