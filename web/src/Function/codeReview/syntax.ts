import type { Element, Root, RootContent } from 'hast';
import type { DiffHunk } from './diffModel';

// Syntax colours for the diff. A patch arrives as lines, but a language reads
// across lines (a block comment, a template string), so each hunk's old side
// and new side are highlighted as one text and the result is cut back into
// lines: deleted lines take their colours from the old side, added and
// unchanged lines from the new side.
//
// The highlighter is passed in (lowlight in the app, loaded only when a diff
// opens), so these rules stay pure and are unit-tested in
// tests/diffModel.test.ts.

export interface SyntaxToken {
  text: string;
  /** The highlight.js class of the innermost scope, or null for plain text. */
  cls: string | null;
}

export type TokenLine = SyntaxToken[];

/** Highlights a whole text in one language into a syntax tree. */
export type Highlight = (code: string, language: string) => Root;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
  md: 'markdown', mdx: 'markdown',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
  sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  graphql: 'graphql', gql: 'graphql', lua: 'lua', r: 'r',
};

const LANGUAGE_BY_NAME: Record<string, string> = { Dockerfile: 'bash', Makefile: 'makefile' };

/** The highlight.js language for a path, or null when it has none. */
export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (LANGUAGE_BY_NAME[name]) return LANGUAGE_BY_NAME[name];
  const dot = name.lastIndexOf('.');
  return dot > 0 ? LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null : null;
}

/** Cuts a syntax tree into lines of tokens, each carrying the class of the
 *  innermost scope around it. */
function treeToLines(tree: Root): TokenLine[] {
  const lines: TokenLine[] = [[]];
  const walk = (nodes: RootContent[], cls: string | null) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        node.value.split('\n').forEach((part, i) => {
          if (i > 0) lines.push([]);
          if (part) lines[lines.length - 1].push({ text: part, cls });
        });
      } else if (node.type === 'element') {
        const classes = (node as Element).properties?.className;
        const own = Array.isArray(classes) ? classes.find((c): c is string => typeof c === 'string' && c.startsWith('hljs-')) : undefined;
        walk(node.children, own ?? cls);
      }
    }
  };
  walk(tree.children, null);
  return lines;
}

/** Each hunk's lines as tokens, in the hunk's own order. A line the
 *  highlighter could not place comes back as one plain token. */
export function highlightHunks(hunks: readonly DiffHunk[], language: string, highlight: Highlight): TokenLine[][] {
  return hunks.map((h) => {
    const oldText = h.lines.filter((l) => l.kind === 'context' || l.kind === 'del').map((l) => l.text);
    const newText = h.lines.filter((l) => l.kind === 'context' || l.kind === 'add').map((l) => l.text);
    let oldLines: TokenLine[] = [];
    let newLines: TokenLine[] = [];
    try {
      oldLines = treeToLines(highlight(oldText.join('\n'), language));
      newLines = treeToLines(highlight(newText.join('\n'), language));
    } catch {
      // An unknown language or a highlighter failure leaves the hunk plain.
    }
    let oi = 0;
    let ni = 0;
    return h.lines.map((l) => {
      const plain: TokenLine = l.text ? [{ text: l.text, cls: null }] : [];
      if (l.kind === 'del') return oldLines[oi++] ?? plain;
      if (l.kind === 'add') return newLines[ni++] ?? plain;
      if (l.kind === 'context') { oi++; return newLines[ni++] ?? plain; }
      return plain;
    });
  });
}
