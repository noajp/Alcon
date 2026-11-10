import { describe, expect, it } from 'vitest';
import {
  graphFromWorkflow, parseWorkflowGraph, workflowFromGraph, WORKFLOW_START, type WorkflowGraph,
} from '@/Function/shared/workflowGraph';
import { flowStepTitles } from '@/Function/shared/flowEdit';

// The drawn workflow and the text the run reads are one thing: the text is
// written from the drawing on every edit.

describe('workflow graph', () => {
  it('draws a written list as a line from the start', () => {
    const g = graphFromWorkflow('# 進め方\n1. 集める\n2. まとめる\n');
    expect(g.nodes.map((n) => n.label)).toEqual(['集める', 'まとめる']);
    expect(g.edges.map((e) => [e.source, e.target])).toEqual([[WORKFLOW_START, 'n1'], ['n1', 'n2']]);
  });

  it('writes a line back as a plain numbered list', () => {
    const text = workflowFromGraph(graphFromWorkflow('# 進め方\n- 集める\n- まとめる\n- 送る\n'));
    expect(text).toBe('# 進め方\n1. 集める\n2. まとめる\n3. 送る\n');
    expect(flowStepTitles(text)).toEqual(['集める', 'まとめる', '送る']);
  });

  it('writes a decision with where each arrow goes', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'a', kind: 'step', label: '問い合わせを読む', x: 0, y: 100 },
        { id: 'b', kind: 'condition', label: '在庫はあるか', x: 0, y: 200 },
        { id: 'c', kind: 'step', label: '見積もりを送る', x: -150, y: 300 },
        { id: 'd', kind: 'step', label: '入荷日を伝える', x: 150, y: 300 },
      ],
      edges: [
        { id: '1', source: WORKFLOW_START, target: 'a' },
        { id: '2', source: 'a', target: 'b' },
        { id: '3', source: 'b', target: 'c', label: 'ある' },
        { id: '4', source: 'b', target: 'd', label: 'ない' },
      ],
    };
    expect(workflowFromGraph(g)).toBe([
      '# 進め方', '1. 問い合わせを読む', '2. 判断: 在庫はあるか', '   → 「ある」なら 3 へ', '   → 「ない」なら 4 へ',
      '3. 見積もりを送る', '   → ここで終わる', '4. 入荷日を伝える', '',
    ].join('\n'));
    // The run's reader still sees exactly the four steps.
    expect(flowStepTitles(workflowFromGraph(g))).toEqual(['問い合わせを読む', '判断: 在庫はあるか', '見積もりを送る', '入荷日を伝える']);
  });

  it('numbers unreached steps after the reached ones, and skips blank ones', () => {
    const g: WorkflowGraph = {
      nodes: [
        { id: 'x', kind: 'step', label: '離れた手順', x: 50, y: 0 },
        { id: 'a', kind: 'step', label: '最初', x: 100, y: 0 },
        { id: 'z', kind: 'step', label: '  ', x: 400, y: 0 },
      ],
      edges: [{ id: '1', source: WORKFLOW_START, target: 'a' }],
    };
    expect(workflowFromGraph(g)).toBe('# 進め方\n1. 最初\n   → ここで終わる\n2. 離れた手順\n');
    expect(workflowFromGraph({ nodes: [], edges: [] })).toBe('');
  });

  it('reads back only a well-formed drawing', () => {
    expect(parseWorkflowGraph(null)).toBeNull();
    expect(parseWorkflowGraph({ nodes: 'x', edges: [] })).toBeNull();
    const g = parseWorkflowGraph({
      nodes: [{ id: 'a', kind: 'weird', label: 'A', x: 1, y: 2 }, { id: WORKFLOW_START }],
      edges: [{ id: '1', source: WORKFLOW_START, target: 'a', label: ' ' }, { id: '2', source: 'a', target: 'gone' }],
    });
    expect(g).toEqual({ nodes: [{ id: 'a', kind: 'step', label: 'A', x: 1, y: 2 }], edges: [{ id: '1', source: WORKFLOW_START, target: 'a' }] });
  });
});
