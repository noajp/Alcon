'use client';

import { Fragment, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { parseMarkdown, type Block, type Inline, type ListBlock } from './markdownParse';
import { MermaidDiagram } from './MermaidDiagram';

// Renders agent-written Markdown (reports, deliverables) as React elements.
// The parser never produces HTML, so nothing in the text can inject markup.

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case 'text': return <Fragment key={i}>{n.v}</Fragment>;
          case 'strong': return <strong key={i} className="font-semibold text-foreground"><InlineNodes nodes={n.c} /></strong>;
          case 'em': return <em key={i}><InlineNodes nodes={n.c} /></em>;
          case 'del': return <s key={i}><InlineNodes nodes={n.c} /></s>;
          case 'code': return <code key={i} className="rounded bg-muted/60 px-1 py-px text-[12px] font-mono">{n.v}</code>;
          case 'link': return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-default)] underline underline-offset-2"><InlineNodes nodes={n.c} /></a>;
        }
      })}
    </>
  );
}

function ListNode({ b }: { b: ListBlock }) {
  const items = b.items.map((it, i) => (
    <li key={i}>
      {b.task && <span aria-hidden className="mr-1.5 font-mono text-muted-foreground">{it.checked ? '☑' : '☐'}</span>}
      <InlineNodes nodes={it.c} />
      {it.sub && <ListNode b={it.sub} />}
    </li>
  ));
  if (b.task) return <ul className="list-none pl-1 space-y-0.5">{items}</ul>;
  return b.t === 'ol' ? <ol className="list-decimal pl-5 space-y-0.5">{items}</ol> : <ul className="list-disc pl-5 space-y-0.5">{items}</ul>;
}

function BlockNode({ b }: { b: Block }) {
  switch (b.t) {
    case 'h': {
      const cls = b.level === 1 ? 'text-[15px] font-semibold' : b.level === 2 ? 'text-[14px] font-semibold' : 'text-[13px] font-semibold';
      return <div className={`${cls} text-foreground mt-3 first:mt-0`}><InlineNodes nodes={b.c} /></div>;
    }
    case 'p': return <p className="whitespace-pre-wrap"><InlineNodes nodes={b.c} /></p>;
    case 'ul': case 'ol': return <ListNode b={b} />;
    case 'code': return b.lang === 'mermaid' ? <MermaidDiagram code={b.v} />
      : <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-[12px] font-mono leading-relaxed">{b.v}</pre>;
    case 'quote': return <blockquote className="border-l-2 border-border pl-3 text-muted-foreground whitespace-pre-wrap"><InlineNodes nodes={b.c} /></blockquote>;
    // A break in the text, not a frame: a faint rule with room around it.
    case 'hr': return <hr className="my-5 border-0 border-t border-border/50" />;
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>{b.head.map((c, i) => <th key={i} className="border-b border-border px-2 py-1 text-left font-medium text-muted-foreground"><InlineNodes nodes={c} /></th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-b border-border/60 px-2 py-1 align-top"><InlineNodes nodes={c} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn('space-y-2 text-[13px] leading-relaxed text-foreground', className)}>
      {blocks.map((b, i) => <BlockNode key={i} b={b} />)}
    </div>
  );
}
