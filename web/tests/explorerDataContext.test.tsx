// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { memo } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ExplorerDataProvider, useExplorerData } from '@/Function/shared/ExplorerDataContext';
import { EMPTY_EXPLORER_DATA, type ExplorerData } from '@/Function/sync/explorerPatch';

afterEach(cleanup);

function snapshot(name: string): ExplorerData {
  return {
    objects: [{ id: 'object-1', name, elements: [] } as unknown as ExplorerData['objects'][number]],
    rootElements: [],
  };
}

function ObjectLabel() {
  const data = useExplorerData();
  return <span>{data?.objects.find((o) => o.id === 'object-1')?.name ?? ''}</span>;
}

it('updates mounted labels when the workspace query snapshot changes', () => {
  const label = <ObjectLabel />;
  const view = render(<ExplorerDataProvider value={snapshot('First Domain Object')}>{label}</ExplorerDataProvider>);
  expect(screen.getByText('First Domain Object')).toBeTruthy();

  view.rerender(<ExplorerDataProvider value={snapshot('Updated Domain Object')}>{label}</ExplorerDataProvider>);
  expect(screen.getByText('Updated Domain Object')).toBeTruthy();
  expect(screen.queryByText('First Domain Object')).toBeNull();

  view.rerender(<ExplorerDataProvider value={EMPTY_EXPLORER_DATA}>{label}</ExplorerDataProvider>);
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
