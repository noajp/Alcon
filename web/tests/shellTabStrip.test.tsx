/** @vitest-environment jsdom */
//
// The shell tab strip's faces are a projection of each tab's current
// screen — derived, never stored. What these pin:
//   - an item tab is named by its entity when the name resolves from
//     data the app already holds (the active Domain's explorer list, or
//     the by-id read for another Domain's Object — an Element of that
//     Object rides in on the same read),
//   - an unresolved name falls back to the view's label, never blank,
//   - a plain-view tab shows the view label,
//   - the strip's controls call the shell's tab operations.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { ShellTabStrip } from '@/Frame/ShellTabStrip';
import type { AppTab } from '@/Frame/appTab';
import type { NavigationState } from '@/types/navigation';

// jsdom has no layout, so it has no scrollIntoView; the active tab asks
// for it on mount.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('@/Function/shared/ExplorerDataContext', () => ({
  useExplorerData: () => ({
    objects: [
      { id: 'o1', name: 'Apollo', elements: [{ id: 'e1', title: 'Wire the thing' }] },
    ],
    rootElements: [{ id: 'e-root', title: 'Loose element' }],
  }),
}));

vi.mock('@/hooks/useObjectArchive', () => ({
  useObjectById: (id: string | null) => ({
    object: id === 'o-remote'
      ? { id: 'o-remote', name: 'Remote Object', elements: [{ id: 'e-remote', title: 'Remote Element' }] }
      : null,
    settled: true,
  }),
}));

vi.mock('@/hooks/strategyData', () => ({
  useStrategies: () => ({
    data: [{ id: 's1', name: 'Win the region' }],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

vi.mock('@/hooks/useNotesDb', () => ({
  useNoteHeader: (id: string | null) => ({
    data: id === 'n1' ? { id: 'n1', name: 'Field notes' } : null,
  }),
}));

vi.mock('@/hooks/tableData', () => ({
  useDataTables: () => ({
    data: [{ id: 't1', name: 'Pipeline' }],
    loading: false,
    error: null,
    refetch: () => {},
  }),
}));

const tab = (id: string, view: string, navigation: Partial<NavigationState> = {}): AppTab => ({
  id,
  activeView: view,
  navigation: { objectId: null, ...navigation },
  back: [],
  forward: [],
});

function renderStrip(tabs: AppTab[], activeTabId: string, extra: Partial<Parameters<typeof ShellTabStrip>[0]> = {}) {
  const handlers = {
    canGoBack: false,
    canGoForward: false,
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    sidebarVisible: true,
    onToggleSidebar: vi.fn(),
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onNewTab: vi.fn(),
    onReorderTabs: vi.fn(),
    ...extra,
  };
  const view = render(
    <I18nProvider>
      <ShellTabStrip tabs={tabs} activeTabId={activeTabId} {...handlers} />
    </I18nProvider>,
  );
  return { ...view, handlers };
}

afterEach(cleanup);

describe('ShellTabStrip tab faces', () => {
  it('names item tabs by their entity, plain tabs by their view', () => {
    renderStrip([
      tab('a', 'home'),
      tab('b', 'objects', { objectId: 'o1', objectDomainId: 'd1' }),
      tab('c', 'domain-elements', { elementId: 'e1', objectId: 'o1' }),
      tab('d', 'strategy', { strategyId: 's1' }),
      tab('e', 'note', { noteId: 'n1' }),
      tab('f', 'tables', { tableId: 't1' }),
    ], 'a');
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByText('Apollo')).toBeTruthy();
    expect(screen.getByText('Wire the thing')).toBeTruthy();
    expect(screen.getByText('Win the region')).toBeTruthy();
    expect(screen.getByText('Field notes')).toBeTruthy();
    expect(screen.getByText('Pipeline')).toBeTruthy();
  });

  it('resolves another Domain’s Object — and its Element — through the by-id read', () => {
    renderStrip([
      tab('a', 'objects', { objectId: 'o-remote', objectDomainId: 'd2' }),
      tab('b', 'domain-elements', { elementId: 'e-remote', objectId: 'o-remote', objectDomainId: 'd2' }),
    ], 'a');
    expect(screen.getByText('Remote Object')).toBeTruthy();
    expect(screen.getByText('Remote Element')).toBeTruthy();
  });

  it('falls back to the view label while a name cannot resolve', () => {
    renderStrip([tab('a', 'objects', { objectId: 'o-gone' })], 'a');
    expect(screen.getByText('Objects')).toBeTruthy();
  });

  it('marks the active tab and no other', () => {
    const { container } = renderStrip([tab('a', 'home'), tab('b', 'inbox')], 'b');
    const current = container.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('Inbox');
  });
});

describe('ShellTabStrip tab operations', () => {
  it('clicking a tab selects it, its × closes it, "+" opens a new one', () => {
    const { handlers } = renderStrip([tab('a', 'home'), tab('b', 'objects', { objectId: 'o1' })], 'a');
    fireEvent.click(screen.getByText('Apollo'));
    expect(handlers.onSelectTab).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getAllByLabelText('Close tab')[1]);
    expect(handlers.onCloseTab).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByLabelText('New tab'));
    expect(handlers.onNewTab).toHaveBeenCalledTimes(1);
  });

  it('a middle-click on a tab closes it', () => {
    const { handlers } = renderStrip([tab('a', 'home'), tab('b', 'inbox')], 'a');
    fireEvent(screen.getByText('Inbox'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(handlers.onCloseTab).toHaveBeenCalledWith('b');
    expect(handlers.onSelectTab).not.toHaveBeenCalled();
  });

  it('history buttons are present but disabled with nowhere to go', () => {
    renderStrip([tab('a', 'home')], 'a');
    expect((screen.getByLabelText('Back') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Forward') as HTMLButtonElement).disabled).toBe(true);
  });
});
