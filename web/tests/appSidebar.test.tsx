/** @vitest-environment jsdom */
//
// The sidebar's fixed top block (shell/navigation PR3): AI stays first
// (PR #779), Inbox is a real row second carrying its unread count as a
// plain number in the row's meta slot, then Calendar and Strategy.
// The count is the StatusBar badge's own source — useNotifications over
// the signed-in user — and at zero unread the row carries no meta at
// all. Rows stay icon + name (+ count): no subtitle, no annotation.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';

const state = vi.hoisted(() => ({ unreadCount: 0 }));

vi.mock('@/hooks/useSupabase', () => ({
  useDomains: () => ({ guestDomains: [], refetch: vi.fn() }),
  reorderDomains: vi.fn(),
  updateDomain: vi.fn(),
  deleteDomain: vi.fn(),
  leaveDomain: vi.fn(),
  useNotifications: () => ({
    notifications: [],
    unreadCount: state.unreadCount,
    loading: false,
    reload: vi.fn(),
    setNotifications: vi.fn(),
  }),
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuthContext: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/hooks/useSustainmentDomains', () => ({
  useSustainmentDomains: () => ({ data: [], refetch: vi.fn() }),
}));

vi.mock('@/Frame/WorkspaceActionsContext', () => ({
  useWorkspaceActions: () => ({ openCreate: vi.fn() }),
}));

vi.mock('@/ActivitySpace/calendar/calendarStore', () => ({
  useCalendarDay: () => '2026-11-09',
}));

vi.mock('@/ActivitySpace/artifacts/slides/sync', () => ({
  useSlidesReady: () => true,
}));

vi.mock('@/hooks/domainData', () => ({
  useDomainRole: () => 'owner',
  domainHasObjectsMessage: () => '',
}));

vi.mock('@/hooks/useObjectArchive', () => ({
  countDomainObjects: () => 0,
}));

// The surfaces below the fixed block are not what is being tested.
vi.mock('@/Frame/sidebar/FollowSection', () => ({ FollowSection: () => null }));
vi.mock('@/Frame/sidebar/MeFooter', () => ({ MeFooter: () => null }));
vi.mock('@/Frame/sidebar/DomainNavigationRow', () => ({ DomainNavigationRow: () => null }));
vi.mock('@/Function/space/SpaceSwitcher', () => ({ SpaceSwitcher: () => null }));
vi.mock('@/Function/settings/SettingsSidebarPanel', () => ({ SettingsSidebarPanel: () => null }));
vi.mock('@/Function/settings/TeamSettings', () => ({ TeamSettings: () => null }));
vi.mock('@/Function/settings/SettingsModal', () => ({ SettingsModal: () => null }));
vi.mock('@/ActivitySpace/execution/domain/DomainAgentSettings', () => ({ DomainAgentSettings: () => null }));
vi.mock('@/Function/shared/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('@/Function/shared/itemIcon/ItemIcon', () => ({ ItemIcon: () => null }));
vi.mock('@/Function/shared/SidebarFold', () => ({ SidebarFold: () => null }));
vi.mock('@/Function/shared/element/elementDetailRequest', () => ({
  requestElementDetail: vi.fn(),
  requestObjectPage: vi.fn(),
}));
vi.mock('@/ActivitySpace/artifacts/slides/SlidesSidebar', () => ({
  createDeckHere: vi.fn(),
  createFolderHere: vi.fn(),
  pickDeckFile: vi.fn(),
}));
vi.mock('@/Frame/QuickAddElementLauncher', () => ({ CREATE_ELEMENT_EVENT: 'alcon:create-element' }));

import { AppSidebar } from '@/Frame/AppSidebar';

function renderSidebar(activeView = 'ai') {
  const onViewChange = vi.fn();
  const utils = render(
    <I18nProvider>
      <AppSidebar
        navigation={{ objectId: null }}
        onNavigate={vi.fn()}
        activeView={activeView}
        onViewChange={onViewChange}
        onOpenSettings={vi.fn()}
        onCloseSettings={vi.fn()}
        width={260}
        collapsed={false}
        overlay={false}
      />
    </I18nProvider>,
  );
  return { ...utils, onViewChange };
}

/** The SidebarRow root element carrying this label. */
const rowOf = (label: string) => screen.getByText(label).closest('div') as HTMLElement;

afterEach(() => {
  cleanup();
  state.unreadCount = 0;
});

describe('AppSidebar fixed top block', () => {
  it('renders Inbox → Agent → Strategy by default', () => {
    renderSidebar();
    const order = ['Inbox', 'Agent', 'Strategy'].map(rowOf);
    for (let i = 0; i < order.length - 1; i++) {
      expect(
        order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('shows the unread count in the Inbox row meta only when it is above zero', () => {
    state.unreadCount = 3;
    const first = renderSidebar();
    expect(within(rowOf('Inbox')).getByText('3')).toBeTruthy();
    first.unmount();

    state.unreadCount = 0;
    renderSidebar();
    // No meta number at all — the row is icon + name only.
    expect(within(rowOf('Inbox')).queryByText(/^\d+$/)).toBeNull();
  });

  it('the Inbox row navigates to the inbox view', () => {
    const { onViewChange } = renderSidebar();
    // The row's label sits inside its button; the click bubbles to it.
    fireEvent.click(screen.getByText('Inbox'));
    expect(onViewChange).toHaveBeenCalledWith('inbox');
  });
});
