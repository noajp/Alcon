// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { WorkspaceActionsProvider, useWorkspaceActions } from '@/shell/WorkspaceActionsContext';

afterEach(cleanup);

it('keeps creation requests inside their workspace and unregisters closed table surfaces', () => {
  const firstObject = vi.fn(), otherObject = vi.fn(), table = vi.fn();
  let request: ReturnType<typeof useWorkspaceActions>['openCreate'];
  function Requester() { request = useWorkspaceActions().openCreate; return null; }
  function Table() {
    const { subscribeTableCreate } = useWorkspaceActions();
    useEffect(() => subscribeTableCreate(table), [subscribeTableCreate]);
    return null;
  }
  function Workspaces({ showTable }: { showTable: boolean }) {
    return <><WorkspaceActionsProvider onOpenCreateObject={firstObject}><Requester />{showTable && <Table />}</WorkspaceActionsProvider><WorkspaceActionsProvider onOpenCreateObject={otherObject}><Table /></WorkspaceActionsProvider></>;
  }
  const view = render(<Workspaces showTable />);
  act(() => request('object'));
  expect(firstObject).toHaveBeenCalledTimes(1);
  expect(otherObject).not.toHaveBeenCalled();
  act(() => request('table'));
  expect(table).toHaveBeenCalledTimes(1);
  view.rerender(<Workspaces showTable={false} />);
  act(() => request('table'));
  expect(table).toHaveBeenCalledTimes(1);
});
