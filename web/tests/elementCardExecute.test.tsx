// @vitest-environment jsdom
//
// The Element card's execute rail (card hover-execute, PR1), as a
// component contract: no rail without onExecute and none on a closed
// Element; the pointer reaching the right 28px edge zone arms the
// slide (−112px, the rail's own width); the rail button carries the
// 'Execute Element' name and its click reaches onExecute without
// opening the card; the touch tab reveals on the first tap and
// activates on the second.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { ElementCard, isExecuteEdgeZone } from '@/ActivitySpace/execution/element/board/ElementCard';
import type { ElementWithDetails } from '@/hooks/useSupabase';

vi.mock('@/hooks/useSupabase', () => ({
  updateElement: async () => {},
  useAssignableWorkers: () => ({ data: [] }),
  addElementAssignee: async () => {},
  removeElementAssignee: async () => {},
  noticeAssignmentFailed: () => {},
  useWorkerAvailability: () => ({ byWorker: {} }),
  useWorkerCommitments: () => ({}),
  useAgentRun: () => ({
    run: null, isActive: false, starting: false,
    start: async () => 'started', cancel: async () => {},
  }),
}));

afterEach(cleanup);

const element = {
  id: 'el-1', object_id: null, title: 'Write the report', description: null,
  status: 'todo', priority: null, due_date: null, labels: [], assignees: [],
} as unknown as ElementWithDetails;

function renderCard(props: Partial<Parameters<typeof ElementCard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <ElementCard element={element} {...props} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  const root = view.container.querySelector('[draggable="true"]') as HTMLElement;
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 320, bottom: 120, width: 320, height: 120, x: 0, y: 0,
    toJSON: () => {},
  } as DOMRect);
  return { ...view, root };
}

/** The rail button: the one whose label text it carries. */
function railButton() {
  return screen.getByText('Execute Element').closest('button') as HTMLButtonElement;
}

/** The track: the rail's parent row, whose translation is the slide. */
function trackOf(button: HTMLElement) {
  return button.parentElement as HTMLElement;
}

describe('isExecuteEdgeZone — the arming math', () => {
  it('arms inside the right 28px, and only there', () => {
    expect(isExecuteEdgeZone(320, 320)).toBe(true);
    expect(isExecuteEdgeZone(292, 320)).toBe(true);
    expect(isExecuteEdgeZone(291, 320)).toBe(false);
    expect(isExecuteEdgeZone(100, 320)).toBe(false);
  });
});

describe('ElementCard — the execute rail', () => {
  it('renders no rail and no tab without onExecute', () => {
    renderCard();
    expect(screen.queryAllByRole('button', { name: 'Execute Element' })).toEqual([]);
  });

  it('renders no rail on a closed Element, even with onExecute', () => {
    renderCard({ element: { ...element, status: 'done' } as ElementWithDetails, onExecute: vi.fn() });
    expect(screen.queryAllByRole('button', { name: 'Execute Element' })).toEqual([]);
    cleanup();
    renderCard({ element: { ...element, status: 'cancelled' } as ElementWithDetails, onExecute: vi.fn() });
    expect(screen.queryAllByRole('button', { name: 'Execute Element' })).toEqual([]);
  });

  it('slides the track by the rail’s width when the pointer reaches the right edge, and only then', () => {
    const { root } = renderCard({ onExecute: vi.fn() });
    const track = trackOf(railButton());
    expect(track.classList.contains('-translate-x-28')).toBe(false);

    fireEvent.pointerMove(root, { clientX: 120, pointerType: 'mouse' });
    expect(track.classList.contains('-translate-x-28')).toBe(false);

    fireEvent.pointerMove(root, { clientX: 300, pointerType: 'mouse' });
    expect(track.classList.contains('-translate-x-28')).toBe(true);

    // Once armed, the reveal holds while the pointer stays on the card.
    fireEvent.pointerMove(root, { clientX: 150, pointerType: 'mouse' });
    expect(track.classList.contains('-translate-x-28')).toBe(true);

    fireEvent.pointerLeave(root);
    expect(track.classList.contains('-translate-x-28')).toBe(false);
  });

  it('the rail is one primary block: thick arrow over the label, flush at w-28', () => {
    renderCard({ onExecute: vi.fn() });
    const rail = railButton();
    expect(rail.className).toContain('w-28');
    expect(rail.className).toContain('bg-primary');
    const svg = rail.querySelector('svg');
    expect(svg?.getAttribute('stroke-width')).toBe('3.2');
  });

  it('clicking the rail executes without opening the card', () => {
    const onExecute = vi.fn();
    const onOpen = vi.fn();
    renderCard({ onExecute, onOpen });
    fireEvent.click(railButton());
    expect(onExecute).toHaveBeenCalledTimes(1);
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ id: 'el-1' }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('the touch tab reveals on the first tap and activates on the second', () => {
    const onExecute = vi.fn();
    renderCard({ onExecute });
    const tab = screen.getAllByRole('button', { name: 'Execute Element' })
      .find((b) => b.textContent === '') as HTMLButtonElement;
    expect(tab).toBeTruthy();
    const track = trackOf(railButton());

    fireEvent.click(tab);
    expect(track.classList.contains('-translate-x-28')).toBe(true);
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.click(tab);
    expect(onExecute).toHaveBeenCalledTimes(1);
  });
});
