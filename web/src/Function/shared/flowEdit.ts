import { sectionOf } from '@/AIP/harness/harnessDefinition';

// Editing a definition's flow, on the body text itself (Sim-
// incorporation prototype, P4; design §5.3, decision D3). The canvas
// edits a promotion draft's Procedure steps — delete a step, move a
// step, rewrite a step's own line — and every edit is a pure function
// from body text to body text, because the body is the single source
// of truth and the canvas is only its projection (flowProjection).
// One reading, shared with the projection: the body is segmented
// into step blocks exactly the way parseDefinition sections the text
// and readBlocks (in flowProjection) reads a section — a bullet line
// opens a block, the lines after it belong to it, a section with no
// bullets reads one block per line — so the i-th edit target here is
// the projection's `step-${i}` node, and re-projecting the edited
// body shows the edit and nothing else.
//
// Round-trip discipline (§5.3): an edit touches only the targeted
// block's lines. A block's span runs from its opening line to the
// next block's opening line, so the blank lines that follow a block
// travel with it when it moves — and nothing outside the Procedure
// section is ever in a span. Everything else — other sections,
// annotations, formatting, the file's trailing newline — is
// preserved byte for byte.

const HEADING = /^#{1,3}\s+(.+?)\s*$/;
const FENCE = /^\s*```/;
const BULLET = /^\s*(?:[-*・]|\d+[.)])\s+(.+)$/;
const BULLET_PREFIX = /^(\s*(?:[-*・]|\d+[.)])\s+)/;
const INDENT = /^(\s*)/;

type LineRole = 'heading' | 'procedure' | 'other' | 'pre';

interface BodyLines {
  lines: string[];
  roles: LineRole[];
}

/** The body split into lines, each marked with the role the parser
 *  gives it: a line under a heading the parser does not know is
 *  content of the current section (the parser's own rule), a fence
 *  line toggles code exactly as in parseDefinition, and only lines
 *  the parser reads as Procedure are 'procedure'. */
function bodyLines(body: string): BodyLines {
  const lines = body.split('\n');
  const roles: LineRole[] = [];
  let current: string | null = null;
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const h = !inFence ? HEADING.exec(line) : null;
    if (h) {
      const key = sectionOf(h[1]);
      if (key) {
        current = key;
        roles.push('heading');
        continue;
      }
    }
    roles.push(current === 'procedure' ? 'procedure' : current ? 'other' : 'pre');
  }
  return { lines, roles };
}

export interface FlowStepBlock {
  /** The block's order among the Procedure's steps — the index of
   *  the projection's `step-${index}` node. */
  index: number;
  /** The block's opening line: its title, as the projection reads it. */
  title: string;
  spanStart: number;
  spanEnd: number;
}

interface Segmentation {
  lines: string[];
  blocks: FlowStepBlock[];
}

/**
 * The Procedure's step blocks, with their line spans in the body.
 * Blank lines belong to no block: they pad the span of the block
 * above them. The last block of the last section keeps its span on
 * its own content lines, so an edit never eats the body's trailing
 * blank lines.
 */
function segmentProcedure(body: string): Segmentation {
  const { lines, roles } = bodyLines(body);
  const headings = roles
    .map((role, i) => (role === 'heading' ? i : -1))
    .filter((i) => i >= 0);
  const regionEnd = (from: number): number => {
    const next = headings.find((h) => h > from);
    return next ?? lines.length;
  };

  const content = lines
    .map((raw, i) => ({ raw, i }))
    .filter(({ i }) => roles[i] === 'procedure');
  const hasBullet = content.some(({ raw }) => BULLET.test(raw));

  interface Draft { titleLine: number; lastContent: number; title: string }
  const drafts: Draft[] = [];
  for (const { raw, i } of content) {
    if (!raw.trim()) continue;
    const b = BULLET.exec(raw);
    if (hasBullet && b) {
      drafts.push({ titleLine: i, lastContent: i, title: b[1].trim() });
      continue;
    }
    if (hasBullet && drafts.length > 0) {
      drafts[drafts.length - 1].lastContent = i;
      continue;
    }
    drafts.push({ titleLine: i, lastContent: i, title: raw.trim() });
  }

  const blocks = drafts.map((d, index): FlowStepBlock => {
    const next = drafts[index + 1];
    const end = regionEnd(d.titleLine);
    let spanEnd: number;
    if (next && next.titleLine < end) spanEnd = next.titleLine;
    else if (end < lines.length) spanEnd = end;
    else spanEnd = d.lastContent + 1;
    return { index, title: d.title, spanStart: d.titleLine, spanEnd };
  });
  return { lines, blocks };
}

/** The Procedure's step titles, in the projection's order. */
export function flowStepTitles(body: string): string[] {
  return segmentProcedure(body).blocks.map((b) => b.title);
}

/** Whether a move would land: both steps exist and their spans are
 *  adjacent — a step never crosses a section boundary, because the
 *  lines between two sections are not the canvas's to rearrange. */
export function flowStepCanMove(body: string, index: number, dir: -1 | 1): boolean {
  const { blocks } = segmentProcedure(body);
  const a = blocks[index];
  const b = blocks[index + dir];
  if (!a || !b) return false;
  const [first, second] = dir === 1 ? [a, b] : [b, a];
  return first.spanEnd === second.spanStart;
}

/** Pure. Deletes step `index`: its whole block — the opening line
 *  and the lines that belong to it — leaves the Procedure. Null when
 *  there is no such step. */
export function deleteFlowStep(body: string, index: number): string | null {
  const { lines, blocks } = segmentProcedure(body);
  const block = blocks[index];
  if (!block) return null;
  return [...lines.slice(0, block.spanStart), ...lines.slice(block.spanEnd)].join('\n');
}

/** Pure. Swaps step `index` with its neighbour (`dir` -1 up, +1
 *  down): the two blocks trade places with their lines intact —
 *  a numbered step keeps its number, because the number is part of
 *  the line the author wrote. Null when the steps are not adjacent
 *  blocks of the same Procedure region. */
export function moveFlowStep(body: string, index: number, dir: -1 | 1): string | null {
  const { lines, blocks } = segmentProcedure(body);
  const a = blocks[index];
  const b = blocks[index + dir];
  if (!a || !b) return null;
  const [first, second] = dir === 1 ? [a, b] : [b, a];
  if (first.spanEnd !== second.spanStart) return null;
  return [
    ...lines.slice(0, first.spanStart),
    ...lines.slice(second.spanStart, second.spanEnd),
    ...lines.slice(first.spanStart, first.spanEnd),
    ...lines.slice(second.spanEnd),
  ].join('\n');
}

/** Pure. Rewrites step `index`'s own line (D3: the value editing IS
 *  the line-text editing): the bullet marker and indentation the
 *  author wrote stay exactly as they are, and only the text after
 *  them is replaced. The rest of the block — its detail lines — is
 *  untouched. Null for an empty or multi-line replacement, or a
 *  step that does not exist. */
export function editFlowStepLine(body: string, index: number, newText: string): string | null {
  const text = typeof newText === 'string' ? newText.trim() : '';
  if (!text || /[\r\n]/.test(text)) return null;
  const { lines, blocks } = segmentProcedure(body);
  const block = blocks[index];
  if (!block) return null;
  const raw = lines[block.spanStart];
  const prefix = BULLET_PREFIX.exec(raw)?.[1] ?? INDENT.exec(raw)?.[1] ?? '';
  const next = [...lines];
  next[block.spanStart] = prefix + text;
  return next.join('\n');
}
