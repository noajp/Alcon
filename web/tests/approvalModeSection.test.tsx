/** @vitest-environment jsdom */
//
// The approval mode's flagship conversion (settings redesign PR3, §4.4/§9):
// the native select becomes a segmented control over the same data layer —
// three segments from APPROVAL_MODE_ORDER, the selected mode's description
// in the row's caption slot, owner gating on the control itself, and the
// change history as a disclosure row inside the island. The RPC and the
// model are untouched; this suite pins the section's presentation contract
// against a stubbed approvalModeData.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { ApprovalModeSection } from '@/AIP/connectors/ApprovalModeSection';
import type { ApprovalMode, ApprovalModeChange } from '@/AIP/connectors/approvalModeModel';

const h = vi.hoisted(() => ({
  setSpaceApprovalMode: vi.fn(async (_spaceId: string, _mode: ApprovalMode) => _mode),
  state: {
    mode: 'auto' as ApprovalMode | null,
    changes: [] as ApprovalModeChange[],
    loading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('@/AIP/connectors/approvalModeData', () => ({
  useSpaceApprovalMode: () => h.state,
  setSpaceApprovalMode: h.setSpaceApprovalMode,
}));

beforeEach(() => {
  h.setSpaceApprovalMode.mockClear();
  h.state = {
    mode: 'auto', changes: [], loading: false, error: null, refetch: vi.fn(),
  };
});
afterEach(() => { cleanup(); });

const renderSection = (isOwner = true) => render(
  <I18nProvider>
    <ApprovalModeSection spaceId="space-1" isOwner={isOwner} />
  </I18nProvider>,
);

describe('ApprovalModeSection', () => {
  it('renders the three modes as segments with the current one checked', () => {
    renderSection();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Ask every time', 'Auto', 'Free action']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  });

  it("shows the selected mode's description in the caption slot", () => {
    renderSection();
    expect(screen.getByText(/Only a critical call asks/)).toBeTruthy();
  });

  it("choosing a segment calls the data layer's setter with that mode", async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: 'Free action' }));
    await act(async () => {});
    expect(h.setSpaceApprovalMode).toHaveBeenCalledWith('space-1', 'free');
  });

  it('re-selecting the current mode calls nothing', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    await act(async () => {});
    expect(h.setSpaceApprovalMode).not.toHaveBeenCalled();
  });

  it('non-owner renders the segments disabled with the gating caption', () => {
    renderSection(false);
    for (const r of screen.getAllByRole('radio')) {
      expect((r as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText(/Only Space owners can change the approval mode\./)).toBeTruthy();
  });

  it('keeps the change history behind a disclosure row', () => {
    h.state.changes = [{
      id: 'c1', from_mode: 'auto', to_mode: 'free', changed_by: null,
      created_at: '2026-11-01T00:00:00.000Z',
    }];
    renderSection();
    expect(screen.queryByText(/→/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Approval mode history/ }));
    expect(screen.getByText(/Auto → Free action/)).toBeTruthy();
  });
});
