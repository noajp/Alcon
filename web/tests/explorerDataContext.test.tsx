// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { memo } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ExplorerDataProvider, useExplorerData } from '@/alcon/shared/ExplorerDataContext';
import { EMPTY_EXPLORER_DATA, type ExplorerData } from '@/alcon/sync/explorerPatch';
import { WindowTabBar, type AppTab } from '@/shell/WindowTabBar';

afterEach(cleanup);

function snapshot(name: string): ExplorerData {
  return {
    objects: [{ id: 'object-1', name, children: [], elements: [] } as unknown as ExplorerData['objects'][number]],
    rootElements: [],
  };
}

it('updates mounted tab labels when the workspace query snapshot changes', () => {
  const tabs: AppTab[] = [{ id: 'tab-1', activeView: 'projects', navigation: { objectId: 'object-1' } }];
  const tabBar = <WindowTabBar tabs={tabs} activeTabId="tab-1" onSelect={() => {}} onClose={() => {}} onCreate={() => {}} />;
  const view = render(<ExplorerDataProvider value={snapshot('First Domain Object')}>{tabBar}</ExplorerDataProvider>);
  expect(screen.getByText('First Domain Object')).toBeTruthy();

  view.rerender(<ExplorerDataProvider value={snapshot('Updated Domain Object')}>{tabBar}</ExplorerDataProvider>);
  expect(screen.getByText('Updated Domain Object')).toBeTruthy();
  expect(screen.queryByText('First Domain Object')).toBeNull();

  view.rerender(<ExplorerDataProvider value={EMPTY_EXPLORER_DATA}>{tabBar}</ExplorerDataProvider>);
  expect(screen.queryByText('Updated Domain Object')).toBeNull();
});

it('preserves exact snapshot identity and keeps empty or local scopes isolated from workspace updates', () => {
  const first = snapshot('First');
  const next = snapshot('Next');
  const local = snapshot('Local Object');
  const reads: Record<string, ExplorerData[]> = { visible: [], hidden: [], local: [], empty: [] };
  const Reader = memo(function Reader({ name }: { name: string }) {
    reads[name].push(useExplorerData());
    return null;
  });
  const children = <>
    <Reader name="visible" />
    <div hidden><Reader name="hidden" /></div>
    <ExplorerDataProvider value={local}><Reader name="local" /></ExplorerDataProvider>
    <ExplorerDataProvider value={EMPTY_EXPLORER_DATA}><Reader name="empty" /></ExplorerDataProvider>
  </>;
  const view = render(<ExplorerDataProvider value={first}>{children}</ExplorerDataProvider>);
  expect(reads.visible).toEqual([first]);
  expect(reads.visible[0]).toBe(first);
  expect(reads.local[0]).toBe(local);
  expect(reads.empty[0]).toBe(EMPTY_EXPLORER_DATA);

  view.rerender(<ExplorerDataProvider value={first}>{children}</ExplorerDataProvider>);
  expect(reads.visible).toHaveLength(1);
  expect(reads.hidden).toHaveLength(1);

  view.rerender(<ExplorerDataProvider value={next}>{children}</ExplorerDataProvider>);
  expect(reads.visible.at(-1)).toBe(next);
  expect(reads.hidden.at(-1)).toBe(next);
  expect(reads.local.every((value) => value === local)).toBe(true);
  expect(reads.empty.every((value) => value === EMPTY_EXPLORER_DATA)).toBe(true);
});
