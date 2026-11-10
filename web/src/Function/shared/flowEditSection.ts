import { sectionOf, type SectionKey } from '@/AIP/harness/harnessDefinition';

// Structured section editing on a definition body (Automation
// builder design §5.1, PR4): the builder's picks — an Input row, a
// connector, a check, a stop line — land as small, byte-preserving
// edits to ONE section of the body, never as a whole-body
// regeneration and never as an edit to a section the pick did not
// name. This module generalises the span discipline flowEdit.ts
// pins for Procedure steps to every bullet section: the body is
// segmented into heading span + bullet blocks; an operation
// moves/removes/rewrites exactly one block's span; text outside the
// span is returned byte for byte; blank lines travel with their
// block. Procedure step edits keep using flowEdit.ts untouched (its
// ops are pinned by P4's tests); this module is its sibling for the
// other sections, plus the two structural acts the builder needs:
// ensuring a section exists (inserted at its canonical place in the
// grammar's order) and replacing the output section's fenced block
// as one span.
//
// Fenced blocks are never bullet blocks here: a fence's lines belong
// to the block above them, and the output section's own bullets are
// its fence — bullet ops refuse the output section, whose edit is
// replaceOutputFence.

const HEADING = /^#{1,3}\s+(.+?)\s*$/;
const FENCE = /^\s*```/;
const FENCE_LANG = /^\s*```\s*([a-zA-Z]*)\s*$/;
const BULLET = /^\s*(?:[-*・]|\d+[.)])\s+(.+)$/;
const BULLET_PREFIX = /^(\s*(?:[-*・]|\d+[.)])\s+)/;
const INDENT = /^(\s*)/;

/** The grammar's section order (harnessDefinition's SECTION_NAMES):
 *  ensureSection places a missing heading among its peers by this
 *  order, so a body the builder grows reads in the same order the
 *  parser's own table lists. */
const SECTION_ORDER: SectionKey[] = [
  'goal', 'conditions', 'metric', 'procedure', 'stop', 'checks',
  'output', 'connectors', 'input', 'breakdown', 'assignment',
  'constraints', 'failure', 'exceptions',
];

/** The heading a section is written with when the builder creates
 *  it: the grammar's first Japanese alias for the key (sectionOf
 *  reads each of these back to its key — a test pins the round trip). */
export const SECTION_HEADINGS: Record<SectionKey, string> = {
  goal: '目的',
  conditions: '条件',
  metric: '指標',
  procedure: '進め方',
  stop: '止める条件',
  checks: '点検',
  output: '成果物の型',
  connectors: '使うコネクタ',
  input: '入力',
  breakdown: '分け方',
  assignment: '担当の決め方',
  constraints: '制約',
  failure: '失敗時の扱い',
  exceptions: '例外カタログ',
};

interface LineInfo {
  key: SectionKey | null;
  heading: boolean;
  fenced: boolean;
}

interface BodyLines {
  lines: string[];
  info: LineInfo[];
}

/** The body split into lines, each marked with the section the
 *  parser gives it: a fence line toggles code exactly as in
 *  parseDefinition, a heading the parser does not know is content of
 *  the current section, and lines inside a fence are content, never
 *  headings or bullets. */
function bodyLines(body: string): BodyLines {
  const lines = body.split('\n');
  const info: LineInfo[] = [];
  let current: SectionKey | null = null;
  let inFence = false;
  for (const line of lines) {
    const fenceLine = FENCE.test(line);
    if (fenceLine) inFence = !inFence;
    const h = !inFence && !fenceLine ? HEADING.exec(line) : null;
    if (h) {
      const key = sectionOf(h[1]);
      if (key) {
        current = key;
        info.push({ key, heading: true, fenced: false });
        continue;
      }
    }
    info.push({ key: current, heading: false, fenced: inFence || fenceLine });
  }
  return { lines, info };
}

export interface SectionRegion {
  key: SectionKey;
  headingLine: number;
  /** Exclusive: the next known heading's line, or the line count. */
  endLine: number;
  /** The region's last non-blank content line, or its heading when
   *  the region carries no content yet. */
  lastContent: number;
}

export interface SectionBlock {
  /** The block's order among the section's bullets. */
  index: number;
  /** The bullet's text, as the parser reads it. */
  title: string;
  spanStart: number;
  spanEnd: number;
  lastContent: number;
}

interface Segmentation {
  lines: string[];
  regions: SectionRegion[];
  blocks: SectionBlock[];
}

function segmentSection(body: string, key: SectionKey): Segmentation {
  const { lines, info } = bodyLines(body);
  const headingLines = info
    .map((line, i) => (line.heading ? i : -1))
    .filter((i) => i >= 0);
  const regions: SectionRegion[] = [];
  for (const h of headingLines) {
    if (info[h].key !== key) continue;
    const endLine = headingLines.find((x) => x > h) ?? lines.length;
    let lastContent = h;
    for (let i = h + 1; i < endLine; i++) if (lines[i].trim()) lastContent = i;
    regions.push({ key, headingLine: h, endLine, lastContent });
  }

  interface Draft { titleLine: number; lastContent: number; title: string; region: SectionRegion }
  const drafts: Draft[] = [];
  for (const region of regions) {
    for (let i = region.headingLine + 1; i < region.endLine; i++) {
      if (!lines[i].trim()) continue;
      const b = !info[i].fenced ? BULLET.exec(lines[i]) : null;
      if (b) {
        drafts.push({ titleLine: i, lastContent: i, title: b[1].trim(), region });
        continue;
      }
      // A non-bullet line (detail, prose, a fence's lines) belongs to
      // the block above it in the same region.
      const above = drafts[drafts.length - 1];
      if (above && above.region === region) above.lastContent = i;
    }
  }

  const blocks = drafts.map((d, index): SectionBlock => {
    const next = drafts[index + 1];
    let spanEnd: number;
    if (next && next.region === d.region) spanEnd = next.titleLine;
    else if (d.region.endLine < lines.length) spanEnd = d.region.endLine;
    else spanEnd = d.lastContent + 1;
    return { index, title: d.title, spanStart: d.titleLine, spanEnd, lastContent: d.lastContent };
  });
  return { lines, regions, blocks };
}

/** The section's bullet texts, in written order. */
export function sectionBullets(body: string, key: SectionKey): string[] {
  return segmentSection(body, key).blocks.map((b) => b.title);
}

const oneLine = (text: string): string | null => {
  const t = typeof text === 'string' ? text.trim() : '';
  return t && !/[\r\n]/.test(t) ? t : null;
};

/**
 * Pure. The body with the section present: unchanged when a heading
 * for it already stands; otherwise the heading is inserted at the
 * canonical position — before the first section that follows it in
 * the grammar's order, or at the body's end — with blank lines
 * around it in the body's own style. Existing lines are never
 * modified, only lines are added.
 */
export function ensureSection(body: string, key: SectionKey): string {
  if (body.trim() === '') return `# ${SECTION_HEADINGS[key]}\n`;
  const { lines, info } = bodyLines(body);
  if (info.some((l) => l.heading && l.key === key)) return body;
  const order = SECTION_ORDER.indexOf(key);
  let at = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const key = info[i].key;
    if (info[i].heading && key && SECTION_ORDER.indexOf(key) > order) { at = i; break; }
  }
  const insert = [`# ${SECTION_HEADINGS[key]}`, ''];
  if (at > 0 && lines[at - 1].trim() !== '') insert.unshift('');
  return [...lines.slice(0, at), ...insert, ...lines.slice(at)].join('\n');
}

/**
 * Pure. Appends one bullet to the section (creating the section at
 * its canonical place first when it is missing): the new bullet
 * lands directly under the section's last block — or under its last
 * content line, or its heading, when it has no bullets yet — and
 * everything else keeps its bytes. Null for an empty or multi-line
 * bullet, and for the output section (its block is the fence).
 */
export function addSectionBullet(body: string, key: SectionKey, text: string): string | null {
  const t = oneLine(text);
  if (!t || key === 'output') return null;
  const withSection = ensureSection(body, key);
  const { lines, regions, blocks } = segmentSection(withSection, key);
  const region = regions[regions.length - 1];
  if (!region) return null;
  const at = blocks.length > 0 ? blocks[blocks.length - 1].lastContent + 1 : region.lastContent + 1;
  return [...lines.slice(0, at), `- ${t}`, ...lines.slice(at)].join('\n');
}

/**
 * Pure. Removes bullet `index` of the section: its whole block —
 * the opening line and the lines that belong to it, padding blank
 * lines travelling with it, exactly as a flowEdit step delete.
 * Null when there is no such bullet.
 */
export function removeSectionBullet(body: string, key: SectionKey, index: number): string | null {
  if (key === 'output') return null;
  const { lines, blocks } = segmentSection(body, key);
  const block = blocks[index];
  if (!block) return null;
  return [...lines.slice(0, block.spanStart), ...lines.slice(block.spanEnd)].join('\n');
}

/**
 * Pure. Rewrites bullet `index`'s own line: the bullet marker and
 * indentation the author wrote stay exactly as they are, only the
 * text after them is replaced, and the block's detail lines are
 * untouched. Null for an empty or multi-line replacement, or a
 * bullet that does not exist.
 */
export function replaceSectionBullet(body: string, key: SectionKey, index: number, text: string): string | null {
  const t = oneLine(text);
  if (!t || key === 'output') return null;
  const { lines, blocks } = segmentSection(body, key);
  const block = blocks[index];
  if (!block) return null;
  const raw = lines[block.spanStart];
  const prefix = BULLET_PREFIX.exec(raw)?.[1] ?? INDENT.exec(raw)?.[1] ?? '';
  const next = [...lines];
  next[block.spanStart] = prefix + t;
  return next.join('\n');
}

/**
 * Pure. Replaces the output section's fenced block as one span: the
 * old fence — delimiters and contents — leaves, the new fence stands
 * where it stood, carrying the old fence's language when it had one
 * (else `format`, else markdown). A section with no fence yet gains
 * one after its last content line (the parser prefers a fence in
 * the section, so the shape takes effect without touching the
 * section's prose); a body with no output section gains the section
 * at its canonical place, fence inside. Null when the content
 * itself carries a fence line, which would break the block it is
 * meant to be.
 */
export function replaceOutputFence(body: string, content: string, format?: string): string | null {
  if (/^\s*```/m.test(content)) return null;
  const withSection = ensureSection(body, 'output');
  const { lines, info } = bodyLines(withSection);
  const { regions } = segmentSection(withSection, 'output');
  const region = regions[0];
  if (!region) return null;
  const contentLines = content.replace(/\n+$/, '').split('\n');
  let open = -1;
  let lang = '';
  for (let i = region.headingLine + 1; i < region.endLine; i++) {
    const m = FENCE_LANG.exec(lines[i]);
    if (m && info[i].fenced) { open = i; lang = m[1]; break; }
  }
  const fenceLines = [`\`\`\`${lang || format || 'markdown'}`, ...contentLines, '```'];
  if (open >= 0) {
    let close = -1;
    for (let i = open + 1; i < region.endLine; i++) {
      if (FENCE.test(lines[i])) { close = i; break; }
    }
    if (close < 0) return null;
    return [...lines.slice(0, open), ...fenceLines, ...lines.slice(close + 1)].join('\n');
  }
  const at = region.lastContent + 1;
  return [...lines.slice(0, at), ...fenceLines, ...lines.slice(at)].join('\n');
}
