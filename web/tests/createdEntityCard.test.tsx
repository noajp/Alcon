/** @vitest-environment jsdom */
//
// The created cards under a chat answer (generation-stop-cards PR2):
// one island card per entity the turn's creation tools made, derived
// from the tool events' created records. Each card reads its row live
// by id — live title/status win, the created snapshot is the loading
// fallback, and a row that no longer resolves renders muted and
// unlinked with a Deleted word. Clicks go through openInApp (the
// shell's item-open route). Volume caps at 12 with an expander.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';

const state = vi.hoisted(() => ({
  elements: new Map<string, Record<string, unknown>>(),
  elementSettled: true,
  objects: new Map<string, Record<string, unknown>>(),
  strategies: [] as { id: string; name: string }[],
  strategiesLoading: false,
}));

vi.mock('@/hooks/elementData', () => ({
  useElementById: (id: string | null | undefined) => ({
    element: id ? state.elements.get(id) ?? null : null,
    settled: state.elementSettled,
  }),
}));

vi.mock('@/hooks/useObjectArchive', () => ({
  useObjectById: (id: string | null) => ({
    object: id ? state.objects.get(id) ?? null : null,
    settled: true,
  }),
}));

vi.mock('@/hooks/strategyData', () => ({
  useStrategies: () => ({ data: state.strategies, loading: state.strategiesLoading, error: null, refetch: vi.fn() }),
}));

import { CreatedEntities, CreatedEntityCard } from '@/AIP/ai/CreatedEntityCard';
import type { ToolEvent } from '@/AIP/ai/useAlconCopilot';

const opened: { view: string; nav?: Record<string, unknown> }[] = [];
const onOpenInApp = (e: Event) => { opened.push((e as CustomEvent).detail); };

beforeEach(() => {
  opened.length = 0;
  window.addEventListener('alcon:open-in-app', onOpenInApp);
});

afterEach(() => {
  window.removeEventListener('alcon:open-in-app', onOpenInApp);
  cleanup();
  state.elements.clear();
  state.objects.clear();
  state.strategies = [];
  state.elementSettled = true;
  state.strategiesLoading = false;
});

const event = (created: ToolEvent['created']): ToolEvent => ({
  name: 'createElements', result: { ok: true, rows: created?.length ?? 0 }, created,
});

function renderBlock(events: ToolEvent[]) {
  return render(
    <I18nProvider>
      <CreatedEntities events={events} />
    </I18nProvider>,
  );
}

describe('CreatedEntities', () => {
  it('renders nothing for a turn that created nothing', () => {
    const { container } = renderBlock([{ name: 'listElements', result: { ok: true, rows: 3 } }]);
    expect(container.firstChild).toBeNull();
  });

  it('an Element card shows its live row — title and status as they are now, not as created', () => {
    state.elements.set('e1', {
      id: 'e1', title: '改名後のタイトル', status: 'in_progress', display_id: 'ELE_OBJ-001', object_id: 'o1', progress: 40,
    });
    state.objects.set('o1', { id: 'o1', name: '請求対応', prefix: 'CLM' });
    renderBlock([event([
      { kind: 'element', id: 'e1', title: '作られた時のタイトル', displayId: 'ELE_OBJ-001', status: 'todo', objectId: 'o1' },
    ])]);
    expect(screen.getByText('改名後のタイトル')).toBeTruthy();
    expect(screen.queryByText('作られた時のタイトル')).toBeNull();
    expect(screen.getByText('ELE_OBJ-001')).toBeTruthy();
    expect(screen.getByText('In Progress')).toBeTruthy();
    expect(screen.getByText(/請求対応/)).toBeTruthy();
  });

  it('an Object card shows its name and prefix; a Strategy card its name', () => {
    state.objects.set('o1', { id: 'o1', name: '請求対応', prefix: 'CLM' });
    state.strategies = [{ id: 's1', name: '競合調査' }];
    renderBlock([event([
      { kind: 'object', id: 'o1', title: '請求対応' },
      { kind: 'strategy', id: 's1', title: '競合調査' },
    ])]);
    expect(screen.getByText('請求対応')).toBeTruthy();
    expect(screen.getByText('CLM')).toBeTruthy();
    expect(screen.getByText('競合調査')).toBeTruthy();
  });

  it('clicking a card opens the entity through the shell’s item route, per kind', () => {
    state.elements.set('e1', { id: 'e1', title: '要素', status: 'todo', display_id: 'ELE_OBJ-001', object_id: 'o9', progress: null });
    state.objects.set('o9', { id: 'o9', name: '保管庫', prefix: 'ARC' });
    state.objects.set('o1', { id: 'o1', name: '請求対応', prefix: 'CLM' });
    state.strategies = [{ id: 's1', name: '競合調査' }];
    renderBlock([event([
      { kind: 'element', id: 'e1', title: '要素', status: 'todo', objectId: 'o9' },
      { kind: 'object', id: 'o1', title: '請求対応' },
      { kind: 'strategy', id: 's1', title: '競合調査' },
    ])]);
    fireEvent.click(screen.getByRole('button', { name: /要素/ }));
    fireEvent.click(screen.getByRole('button', { name: /請求対応/ }));
    fireEvent.click(screen.getByRole('button', { name: /競合調査/ }));
    expect(opened).toEqual([
      { view: 'domain-elements', nav: { elementId: 'e1', objectId: 'o9' } },
      { view: 'objects', nav: { objectId: 'o1' } },
      { view: 'strategy', nav: { strategyId: 's1' } },
    ]);
  });

  it('a row that no longer resolves renders its snapshot muted, unlinked, and says Deleted', () => {
    // Nothing in the live maps: the reads have settled (the mocks are
    // settled by construction) and found no row.
    renderBlock([event([
      { kind: 'element', id: 'gone', title: '消えた要素', displayId: 'ELE_OBJ-009', status: 'todo', objectId: 'o1' },
    ])]);
    const card = screen.getByText('消えた要素');
    expect(screen.getByText('Deleted')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /消えた要素/ })).toBeNull();
    fireEvent.click(card);
    expect(opened).toEqual([]);
  });

  it('while the live read is still out, the snapshot stands and the card still opens', () => {
    state.elementSettled = false;
    renderBlock([event([
      { kind: 'element', id: 'e1', title: '作られた要素', displayId: 'ELE_OBJ-001', status: 'todo', objectId: 'o1' },
    ])]);
    expect(screen.getByText('作られた要素')).toBeTruthy();
    expect(screen.getByText('To Do')).toBeTruthy();
    expect(screen.queryByText('Deleted')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /作られた要素/ }));
    expect(opened).toEqual([{ view: 'domain-elements', nav: { elementId: 'e1', objectId: 'o1' } }]);
  });

  it('the singular card renders one entity on its own (the family’s dispatch)', () => {
    state.objects.set('o1', { id: 'o1', name: '請求対応', prefix: 'CLM' });
    render(
      <I18nProvider>
        <CreatedEntityCard entity={{ kind: 'object', id: 'o1', title: '請求対応' }} />
      </I18nProvider>,
    );
    expect(screen.getByText('請求対応')).toBeTruthy();
    expect(screen.getByText('CLM')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /請求対応/ }));
    expect(opened).toEqual([{ view: 'objects', nav: { objectId: 'o1' } }]);
  });

  it('caps the block at 12 cards with a Show all expander', () => {
    const created: ToolEvent['created'] = [];
    for (let i = 1; i <= 13; i++) {
      state.elements.set(`e${i}`, { id: `e${i}`, title: `要素 ${i}`, status: 'todo', display_id: null, object_id: 'o1', progress: null });
      created.push({ kind: 'element', id: `e${i}`, title: `要素 ${i}`, status: 'todo', objectId: 'o1' });
    }
    renderBlock([event(created)]);
    expect(screen.getAllByText(/^要素 \d+$/)).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 13' }));
    expect(screen.getAllByText(/^要素 \d+$/)).toHaveLength(13);
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByText(/^要素 \d+$/)).toHaveLength(12);
  });
});
