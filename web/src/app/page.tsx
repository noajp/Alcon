'use client';

import { ExplorerDataProvider } from '@/Function/shared/ExplorerDataContext';

import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { WorkspaceActionsProvider, type CreateObjectContext } from '@/Frame/WorkspaceActionsContext';
import { AppSidebar } from '@/Frame/AppSidebar';
import { ModePanel } from '@/Frame/ModePanel';
import { useUserPreferences } from '@/Function/settings/useUserPreferences';
import { DiscoverModal } from '@/Frame/DiscoverModal';
import { MainContent } from '@/Frame/MainContent';
import { CreateView, type CreateType, type CreateResult } from '@/Frame/CreateView';
import { CommandPalette } from '@/Frame/CommandPalette';
import { QuickAddElementLauncher } from '@/Frame/QuickAddElementLauncher';
import { AlconCopilotPanel } from '@/AIP/ai/AlconCopilotPanel';
import { copilotSubjectFor } from '@/AIP/ai/useAlconCopilot';
import { CopilotProvider, useCopilotConversation } from '@/AIP/ai/CopilotProvider';
import type { AppTab } from '@/Frame/appTab';
import { forwardAfterNavigation, recordNavigation, routeKeyOf, stepBack, stepForward, type HistoryStep } from '@/Frame/historyState';
import { isItemScreen, newTab, openScreen } from '@/Frame/tabState';
import { mergeNavigation, navigationAfterDomainChange, navigationForView } from '@/Frame/navigationState';
import type { NavigationState } from '@/types/navigation';
import { useDomains, useObjects, createObject, createActivitySpace, useActivitySpaces, fetchAllWorkers, type Worker } from '@/hooks/useSupabase';
import { QuickAddObjectPopup } from '@/ActivitySpace/execution/object/QuickAddObjectPopup';
import { linkObjectToStrategy } from '@/hooks/strategyData';
import { QuickAddNotebookPopup } from '@/ActivitySpace/artifacts/notebook/QuickAddNotebookPopup';
import { placeNewNotebook, seedNotebook, setNextNotebookFolder } from '@/ActivitySpace/artifacts/notebook/notebookActions';
import { useNotes } from '@/hooks/useNotesDb';
import { useAuthContext } from '@/providers/AuthProvider';
import { AuthPage } from '@/auth/AuthPage';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT, CREATE_DOMAIN_EVENT } from '@/Function/space/domainsStore';
import { useActiveSpaceId, setActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { OnboardingCreate } from '@/Function/space/OnboardingCreate';
import { MyInvitations } from '@/Function/membership/MyInvitations';
import { getCachedHomeViewId } from '@/Function/settings/preferencesStore';
import { setActiveSettingsSection, useActiveSettingsSection, useActiveSettingsTab } from '@/Function/settings/settingsNav';
import { readOpenScreen, writeOpenScreen, type OpenScreen } from '@/Frame/openScreen';
import { VIEW_REGISTRY } from '@/Frame/viewRegistry';
import { completeOAuthReturn, readOAuthReturn, stripOAuthReturn, takeOAuthReturnSettingsTab } from '@/AIP/connectors/oauthReturn';
import { finishIntegrationOAuth } from '@/AIP/connectors/data';
import { useWorkspaceDeltaStream } from '@/Function/sync/deltaStream';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import type { Domain } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRevealContext } from '@/Function/shared/SidebarReveal';
import { seedStarterSpace } from '@/Function/space/seedStarterSpace';
import { OPEN_IN_APP_EVENT, type OpenInAppDetail } from '@/Function/shared/appNavigation';

export default function Home() {
  const { isAuthenticated, loading: authLoading } = useAuthContext();

  if (!authLoading && !isAuthenticated) return <AuthPage />;
  // Assume the happy path during the (usually instant) session check and
  // paint the app shell — if it turns out logged-out, the line above flips
  // to AuthPage on the next render.
  if (authLoading) return <AppShellSkeleton />;

  return <AppContent />;
}

// First-paint app shell — a sidebar + island silhouette shown while auth /
// domains / objects resolve, instead of a bare centered spinner. Reads as
// "the app is here, filling in" rather than "still loading" (Linear's
// inlined-app-shell idea). Pure CSS, no data, so it paints immediately.
function AppShellSkeleton() {
  return (
    <div className="h-dvh flex overflow-hidden bg-[var(--content-bg)]" aria-hidden>
      {/* Sidebar silhouette */}
      <div className="w-[260px] shrink-0 flex flex-col gap-4 p-3 animate-pulse">
        <div className="h-7 w-32 rounded-md bg-muted/70" />
        <div className="flex flex-col gap-1.5 mt-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-7 rounded-md bg-muted/50" style={{ width: `${70 - i * 8}%` }} />
          ))}
        </div>
        <div className="h-3 w-20 rounded bg-muted/40 mt-3" />
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 rounded-md bg-muted/40" style={{ width: `${85 - i * 6}%` }} />
          ))}
        </div>
      </div>
      {/* Main island silhouette */}
      <div className="flex-1 flex flex-col overflow-hidden pr-1.5 pb-1.5 pl-0">
        <div className="h-10 flex items-center gap-2 px-1.5">
          <div className="h-7 w-44 rounded-md bg-muted/60 animate-pulse" />
        </div>
        <div className="flex-1 rounded-lg gloss-island bg-white dark:bg-card p-4">
          <div className="flex flex-col gap-2.5 animate-pulse">
            <div className="h-5 w-40 rounded bg-muted/50 mb-2" />
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full bg-muted/50 shrink-0" />
                <div className="h-4 rounded bg-muted/40" style={{ width: `${55 + ((i * 7) % 35)}%` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function makeNewTab(activeView = 'inbox', navigation: NavigationState = { objectId: null }): AppTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    activeView,
    navigation,
    back: [],
    forward: [],
  };
}

const isShellView = (view: string) => Object.prototype.hasOwnProperty.call(VIEW_REGISTRY, view);

// Below this viewport width the left sidebar auto-collapses so list/board
// content keeps a usable width (matches Linear's narrow-window behavior).
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1024;

// The person's own sidebar choice, once they make one, outranks the width
// band: stored device-locally ('1' = collapsed, '0' = shown), like the
// sidebar's width (alcon:sidebarWidth in AppSidebar). Which window on
// which monitor has its sidebar closed is a device habit, not an account
// preference, so it does not go through user_preferences.
const SIDEBAR_COLLAPSED_KEY = 'alcon:sidebarCollapsed';

function readSidebarCollapsedChoice(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch { /* storage unavailable — the width band decides */ }
  return null;
}

function storeSidebarCollapsedChoice(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch { /* best-effort: the choice simply does not persist */ }
}

function AppContent() {
  // Settings > Preferences are cached per browser so the first tab can open
  // on the saved home view before any fetch; reading them here, at launch,
  // is what keeps that cache in step with the account across devices.
  useUserPreferences();
  const { t, locale } = useI18n();
  const { user } = useAuthContext();
  // Every server-confirmed change reaches the caches through this one channel.
  useWorkspaceDeltaStream(user?.id ?? null);

  // ── ActivitySpace: the top-level org context (company / enterprise) ──
  const activeSpaceId = useActiveSpaceId();
  const { data: spaces, loading: spacesLoading, refetch: refetchSpaces } = useActivitySpaces();
  const activeSpaceExists = useMemo(
    () => !!activeSpaceId && spaces.some((s) => s.id === activeSpaceId),
    [activeSpaceId, spaces],
  );
  const effectiveActiveSpaceId = activeSpaceExists && activeSpaceId ? activeSpaceId : (spaces[0]?.id ?? '');

  useEffect(() => {
    if (spacesLoading || !spaces.length) return;
    if (!activeSpaceExists) {
      const first = spaces[0].id;
      setActiveSpaceId(first);
    }
  }, [activeSpaceExists, spaces, spacesLoading]);

  // ── Domain: resolved WITHIN the active ActivitySpace ──
  const [activeDomainId, setActiveDomainIdState] = useState<string>(() => getActiveDomainId() ?? '');
  const activeDomainIdRef = useRef(getActiveDomainId() ?? '');
  const { guestDomains, loading: memberDomainsLoading, error: memberDomainsError, refetch: refetchMemberDomains } = useDomains();
  const { data: allDomains, loading: visibleDomainsLoading, error: visibleDomainsError, refetch: refetchVisibleDomains } = useSustainmentDomains();
  const domainsLoading = memberDomainsLoading || visibleDomainsLoading;
  const domainsError = memberDomainsError ?? visibleDomainsError;
  const refetchDomains = useCallback(async () => {
    await Promise.all([refetchMemberDomains(), refetchVisibleDomains()]);
  }, [refetchMemberDomains, refetchVisibleDomains]);
  const domains = useMemo(
    () => (effectiveActiveSpaceId
      ? allDomains.filter((d) => d.activity_space_id === effectiveActiveSpaceId)
      : allDomains).slice().sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)),
    [allDomains, effectiveActiveSpaceId],
  );
  // Viewable = active Space's Domains + guest Domains (invited individually).
  // A guest Domain can be the active Domain without joining its Space.
  const viewableDomains = useMemo(() => [...new Map([...domains, ...guestDomains].map(domain => [domain.id, domain])).values()], [domains, guestDomains]);
  const activeDomainExists = useMemo(
    () => !!activeDomainId && viewableDomains.some((domain) => domain.id === activeDomainId),
    [activeDomainId, viewableDomains],
  );
  const effectiveActiveDomainId = activeDomainExists
    ? activeDomainId
    : (domains[0]?.id ?? guestDomains[0]?.id ?? '');

  const setResolvedDomainId = (id: string) => {
    activeDomainIdRef.current = id;
    setActiveDomainIdState(id);
  };

  useEffect(() => {
    if (domainsLoading || !viewableDomains.length) return;
    if (!activeDomainId || !activeDomainExists) {
      const first = viewableDomains[0].id;
      setResolvedDomainId(first);
      setActiveDomainId(first);
    }
  }, [activeDomainExists, activeDomainId, viewableDomains, domainsLoading]);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id || id === activeDomainIdRef.current) return;
      setResolvedDomainId(id);
    };
    window.addEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
    return () => window.removeEventListener(ACTIVE_DOMAIN_CHANGE_EVENT, handler as EventListener);
  }, []);

  // ── Onboarding handlers ──
  const handleCreateSpace = async (name: string) => {
    if (!user) return;
    const space = await createActivitySpace({ name, user_id: user.id });
    setActiveSpaceId(space.id);
    // The Space exists either way; a failed seed just leaves it empty.
    try { await seedStarterSpace(space.id, user.id, locale); }
    catch (err) { console.error('Failed to seed the starter Space:', err); }
    await refetchSpaces();
  };

  // ── Gate ──
  if (spacesLoading) return <AppShellSkeleton />;

  // New user with no ActivitySpace → create one (this is where the app used to
  // dead-end on the loading skeleton).
  if (spaces.length === 0) {
    return (
      <OnboardingCreate
        title={t('Create your ActivitySpace')}
        subtitle={t('A shared place for your team. Bring in one existing project to get started.')}
        label={t('Name')}
        placeholder="Acme Inc."
        cta={t('Create ActivitySpace')}
        onCreate={handleCreateSpace}
      >
        {/* Invited to someone else's Space? Accepting is how you join it. */}
        <MyInvitations className="mt-8 divide-y divide-border/40 rounded-lg border border-border bg-card" onAccepted={() => void refetchSpaces()} />
      </OnboardingCreate>
    );
  }

  if (domainsError) {
    return (
      <div className="h-dvh flex items-center justify-center bg-background">
        <div className="text-center p-6 rounded-lg bg-card border border-border max-w-sm">
          <div className="text-destructive text-sm font-medium mb-2">{t('Connection Error')}</div>
          <div className="text-muted-foreground text-xs mb-4">{domainsError.message}</div>
          <button onClick={() => refetchDomains()} className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded text-xs transition-colors">
            {t('Try Again')}
          </button>
        </div>
      </div>
    );
  }

  if (domainsLoading) return <AppShellSkeleton />;

  return (
    <WorkspaceContent
      activeSpaceId={effectiveActiveSpaceId}
      activeDomainId={effectiveActiveDomainId}
      domains={viewableDomains}
      refetchDomains={refetchDomains}
      onActiveDomainChange={setResolvedDomainId}
    />
  );
}

// Arrival at an AI surface starts a fresh conversation (the provider's
// arriveAtAi decides; copilotArrival.ts holds the rule). This watcher
// lives inside CopilotProvider and reports each change of "any AI
// surface visible" (the AI screen, or the pop-up while the screen is
// not up), consuming the one-transition carry flag the expand/minimize
// handlers set: the two windows are one surface, so moving between
// them is "keep talking", not an arrival.
function CopilotArrivalWatcher({ visible, carryRef }: { visible: boolean; carryRef: { current: boolean } }) {
  const { arriveAtAi } = useCopilotConversation();
  const arriveRef = useRef(arriveAtAi);
  useEffect(() => { arriveRef.current = arriveAtAi; }, [arriveAtAi]);
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    const wasVisible = wasVisibleRef.current;
    wasVisibleRef.current = visible;
    const carry = carryRef.current;
    carryRef.current = false;
    arriveRef.current({ wasVisible, visible, carry });
  }, [visible, carryRef]);
  return null;
}

function WorkspaceContent({
  activeSpaceId,
  activeDomainId,
  domains,
  refetchDomains,
  onActiveDomainChange,
}: {
  activeSpaceId: string;
  activeDomainId: string;
  domains: Domain[];
  refetchDomains: () => void | Promise<void>;
  onActiveDomainChange: (id: string) => void;
}) {
  const { t } = useI18n();
  // The shell's view + navigation, as a list of tabs shown in the top
  // strip. Every tab's surface stays mounted, so its internal state
  // (Domain tab selection, expand state, scroll position …) survives
  // while another tab is shown. The tab list itself is a session
  // working set: a reload restores only the active tab's screen
  // (openScreen.ts), with empty history stacks.
  // A reload opens the screen this browser tab had open in this Space;
  // otherwise Settings > Preferences > "Default home view" — honoured at launch.
  const [restored] = useState<OpenScreen | null>(() => {
    const screen = typeof window === 'undefined' ? null : readOpenScreen(activeSpaceId, isShellView);
    if (screen?.settings) setActiveSettingsSection(screen.settings.section, screen.settings.tab ?? undefined);
    return screen;
  });
  const [initialTab] = useState<AppTab>(() => (restored ? makeNewTab(restored.view, restored.navigation) : makeNewTab(getCachedHomeViewId())));
  const [tabs, setTabs] = useState<AppTab[]>(() => [initialTab]);
  const [activeTabId, setActiveTabId] = useState(initialTab.id);

  const storedTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];
  const activeTab = storedTab;

  // Per-tab updaters — operate on the tab id that's passed in, not whichever
  // tab happens to be active. Each tab's MainContent gets a stable handler
  // bound to its own id so background tabs can keep their state correctly.
  // Both updaters record the screen left on the tab's Back stack and clear
  // its Forward stack on a fresh navigation (historyState.ts). Route keys
  // are computed from the tab's stored view/navigation, never the displayed
  // activeTab. Restore paths (the OAuth return, a Domain switch's
  // selection cleanup) write setTabs directly and never record.
  const updateTab = (id: string, partial: Partial<Omit<AppTab, 'id'>>) => {
    const next = partial;
    setTabs(prev => prev.map(t => {
      if (t.id !== id) return t;
      const merged = { ...t, ...next };
      const landed = next.activeView === undefined ? merged : { ...merged, navigation: navigationForView(merged.navigation, merged.activeView) };
      const before = { view: t.activeView, navigation: t.navigation };
      const after = { view: landed.activeView, navigation: landed.navigation };
      const back = recordNavigation(t.back, before, after);
      const forward = forwardAfterNavigation(t.forward, before, after);
      return { ...landed, back, forward };
    }));
  };
  const updateTabNavigation = (id: string, partial: Partial<NavigationState>) => {
    if (partial.objectId && partial.objectDomainId && partial.objectDomainId !== activeDomainId) {
      onActiveDomainChange(partial.objectDomainId);
      setActiveDomainId(partial.objectDomainId);
    }
    setTabs(prev => prev.map(t => {
      if (t.id !== id) return t;
      const navigation = mergeNavigation(t.navigation, partial, activeDomainId);
      const before = { view: t.activeView, navigation: t.navigation };
      const after = { view: t.activeView, navigation };
      const back = recordNavigation(t.back, before, after);
      const forward = forwardAfterNavigation(t.forward, before, after);
      return { ...t, navigation, back, forward };
    }));
  };

  // Back / Forward: restore a screen this tab visited. Raw writes —
  // stepping through history is not itself a navigation to record — and
  // symmetric: both go through applyScreen, with the same Domain sync
  // updateTabNavigation performs for an Object in another Domain. They
  // restore shell-level screens only: a tab drilldown's transiently open
  // Element never entered the navigation, so a step lands on that tab
  // with its remembered content instead.
  const applyScreen = (step: HistoryStep) => {
    const { screen } = step;
    if (screen.navigation.objectId && screen.navigation.objectDomainId && screen.navigation.objectDomainId !== activeDomainId) {
      onActiveDomainChange(screen.navigation.objectDomainId);
      setActiveDomainId(screen.navigation.objectDomainId);
    }
    setTabs(prev => prev.map(t => (
      t.id === storedTab.id
        ? { ...t, activeView: screen.view, navigation: screen.navigation, back: step.back, forward: step.forward }
        : t
    )));
  };
  const goBack = () => {
    const step = stepBack(
      { view: storedTab.activeView, navigation: storedTab.navigation },
      storedTab.back,
      storedTab.forward,
    );
    if (step) applyScreen(step);
  };
  const goForward = () => {
    const step = stepForward(
      { view: storedTab.activeView, navigation: storedTab.navigation },
      storedTab.back,
      storedTab.forward,
    );
    if (step) applyScreen(step);
  };

  // History availability on the active tab, for the strip and the
  // palette. Settings owns its return, so neither direction is offered
  // while it is open (historyState keeps it off both stacks entirely).
  const canGoBack = storedTab.activeView !== 'settings' && storedTab.back.length > 0;
  const canGoForward = storedTab.activeView !== 'settings' && storedTab.forward.length > 0;

  // The browser's back and forward walk this history too. Each screen change
  // is pushed as a browser history entry carrying how deep the app's own
  // back stack is; the browser's arrows (and ⌘[ / ⌘]) move through those
  // entries, and the depth they land on says whether that was a step back or
  // forward here. A change made by such a step is not pushed again.
  const screenKey = `${storedTab.id}|${routeKeyOf({ view: storedTab.activeView, navigation: storedTab.navigation })}`;
  const fromBrowser = useRef(false);
  const lastScreen = useRef<string | null>(null);
  useEffect(() => {
    const depth = storedTab.back.length;
    if (lastScreen.current === null) window.history.replaceState({ ...window.history.state, alconBack: depth }, '');
    else if (lastScreen.current !== screenKey && !fromBrowser.current) window.history.pushState({ alconBack: depth }, '');
    fromBrowser.current = false;
    lastScreen.current = screenKey;
  }, [screenKey, storedTab.back.length]);
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const target = (e.state as { alconBack?: number } | null)?.alconBack;
      if (typeof target !== 'number') return;
      const depth = storedTab.back.length;
      if (target < depth) { fromBrowser.current = true; goBack(); }
      else if (target > depth) { fromBrowser.current = true; goForward(); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // ⌘[ / Alt+← go back and ⌘] / Alt+→ go forward, like a browser. Ignored
  // while typing — the guard the app's other global keys use.
  // Re-subscribed each render so the steps always read the tab active now.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const back = (e.metaKey && e.key === '[') || (e.altKey && e.key === 'ArrowLeft');
      const forward = (e.metaKey && e.key === ']') || (e.altKey && e.key === 'ArrowRight');
      if (!back && !forward) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      e.preventDefault();
      // Through the browser's own history, so Chrome's arrows and these keys
      // walk the same steps.
      if (back) { if (canGoBack) window.history.back(); } else if (canGoForward) window.history.forward();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readSidebarCollapsedChoice()
      ?? (typeof window !== 'undefined' && window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH),
  );
  // When collapsed, the sidebar can still be peeked as a floating overlay
  // (via the strip's reveal button) instead of pinning it back into flow.
  const [sidebarOverlay, setSidebarOverlay] = useState(false);

  // Active-tab convenience writers (for sidebar + command palette which target
  // the visible tab).
  const setActiveView = (view: string) => updateTab(activeTab.id, { activeView: view });
  const setActiveNavigation = (nav: Partial<NavigationState>) => updateTabNavigation(activeTab.id, nav);

  // Item opens get a tab of their own (tabState.ts): a followed Object,
  // a searched Element, an Automation's Strategy — the tab already
  // showing the item is focused, a new one is opened otherwise, and the
  // tab the item was opened from keeps its place and its history. The
  // new tab's navigation starts clean (the item, not the source tab's
  // leftovers), merged the way updateTabNavigation merges — an Object
  // in another Domain switches the Domain, as it does there.
  const openItem = (view: string, nav?: Partial<NavigationState>) => {
    if (nav?.objectDomainId && nav.objectDomainId !== activeDomainId) {
      onActiveDomainChange(nav.objectDomainId);
      setActiveDomainId(nav.objectDomainId);
    }
    const navigation = navigationForView(mergeNavigation({ objectId: null }, nav ?? {}, activeDomainId), view);
    const next = openScreen({ tabs, activeTabId }, { view, navigation }, (s) => makeNewTab(s.view, s.navigation));
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    setSidebarOverlay(false);
  };
  // The strip's and palette's tab operations — the pure transitions in
  // tabState.ts, applied. A fresh tab opens at the home view.
  const applyTabState = (next: { tabs: AppTab[]; activeTabId: string }) => {
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
  };
  const handleNewTab = () => applyTabState(newTab({ tabs, activeTabId }, () => makeNewTab(getCachedHomeViewId())));

  // A page asked for another screen (an Element's "Open in" → its Note, a new
  // deck): an item (a deep selection naming a thing) opens in a tab of
  // its own; a plain view switch (a new deck) reuses this tab, and its
  // route when one is given. Re-subscribed each render, so it always
  // writes to the tab active now.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { view, nav } = (e as CustomEvent<OpenInAppDetail>).detail;
      const navigation = navigationForView(mergeNavigation({ objectId: null }, nav ?? {}, activeDomainId), view);
      if (isItemScreen({ view, navigation })) {
        openItem(view, nav);
        return;
      }
      if (nav) setActiveNavigation(nav);
      setActiveView(view);
    };
    window.addEventListener(OPEN_IN_APP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IN_APP_EVENT, onOpen);
  });

  // Settings opens in place and remembers where it came from, so the
  // sidebar's Back returns to that view — the one navigation target a
  // viewer needs a way back FROM, not just a way to switch away from.
  const [settingsReturnView, setSettingsReturnView] = useState<string | null>(() => restored?.settingsReturn ?? null);
  // Remember the open screen for a reload of this browser tab.
  const settingsSection = useActiveSettingsSection();
  const settingsTab = useActiveSettingsTab();
  useEffect(() => {
    writeOpenScreen(activeSpaceId, {
      view: storedTab.activeView,
      navigation: storedTab.navigation,
      settingsReturn: storedTab.activeView === 'settings' ? settingsReturnView : null,
      settings: { section: settingsSection, tab: settingsTab },
    });
  }, [activeSpaceId, storedTab.activeView, storedTab.navigation, settingsReturnView, settingsSection, settingsTab]);
  const handleOpenSettings = () => {
    if (activeTab.activeView === 'settings') return;
    setSettingsReturnView(activeTab.activeView);
    setActiveView('settings');
  };
  // Back from an integration sign-in (integration-oauth): drop the parameters
  // from the URL, confirm the sign-in as this person (POST /finish — nothing
  // is stored before that) and open Settings › AI to show the outcome.
  useEffect(() => {
    const result = readOAuthReturn(window.location.search);
    if (!result) return;
    window.history.replaceState(window.history.state, '', stripOAuthReturn(window.location.href));
    // Settings' Back then returns to the view the app launched on. A sign-in
    // started from another Settings › AI tab (a harness install) returns there.
    setActiveSettingsSection('integrations', takeOAuthReturnSettingsTab() ?? 'external');
    // The reload usually restored that screen already; a fresh tab opens it
    // once the sign-in is confirmed.
    void completeOAuthReturn(result, finishIntegrationOAuth).finally(() => {
      setTabs(prev => prev.map(t => (t.id === activeTabId ? { ...t, activeView: 'settings' } : t)));
    });
  }, [activeTabId]);
  const handleCloseSettings = () => {
    const back = settingsReturnView ?? initialTab.activeView;
    setActiveView(back && back !== 'settings' ? back : 'inbox');
    setSettingsReturnView(null);
  };

  // Every screen keeps the sidebar: it is the only way between surfaces.
  const aiScreen = activeTab.activeView === 'ai';
  const [discoverOpen, setDiscoverOpen] = useState(false);
  // The AI pop-up — open state shared by the status bar's button, ⌘L and the
  // pop-up's own close. It starts closed, so the work has the whole page
  // until someone asks for it. On Slides it is the open deck's assistant.
  const [copilotOpen, handleCopilotOpenChange] = useState(false);
  const onSlides = activeTab.activeView === 'slides';
  // The pop-up's expand button opens the AI screen; the screen's shrink
  // button goes back to where the person was, with the pop-up open.
  const lastViewRef = useRef('inbox');
  useEffect(() => {
    if (activeTab.activeView !== 'ai') lastViewRef.current = activeTab.activeView;
  }, [activeTab.activeView]);
  // The last Strategy the person had open. The AI screen keeps it as
  // the conversation's subject, so a send there speaks about the
  // Strategy they came from — the subject the pop-up would have
  // carried. State, adjusted during render (MainContent's notebook
  // pattern): the subject below reads it while rendering, which a ref
  // cannot do.
  const [lastStrategyId, setLastStrategyId] = useState<string | null>(null);
  if (activeTab.activeView === 'strategy' && activeTab.navigation.strategyId
      && activeTab.navigation.strategyId !== lastStrategyId) {
    setLastStrategyId(activeTab.navigation.strategyId);
  }
  // The copilot's subject — context for its next send, never powers.
  // Both windows onto the conversation (pop-up and AI screen) get the
  // same one.
  const subject = copilotSubjectFor({
    activeView: activeTab.activeView,
    strategyId: activeTab.navigation.strategyId ?? null,
    lastStrategyId,
  });
  // Expand/minimize move between the pop-up and the AI screen — the
  // two windows onto the one conversation. They mark the visibility
  // change as a carry so arriving through them keeps the talk going
  // (CopilotArrivalWatcher consumes the flag).
  const aiCarryRef = useRef(false);
  const handleExpandAi = () => {
    aiCarryRef.current = true;
    handleCopilotOpenChange(false);
    setActiveView('ai');
  };
  const handleMinimizeAi = () => {
    aiCarryRef.current = true;
    setActiveView(lastViewRef.current);
    handleCopilotOpenChange(true);
  };
  // Nothing is created up front: a Space may start from a Strategy as well
  // as from a Domain, so the person picks where to begin.
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [pendingNewNote, setPendingNewNote] = useState(0);
  // The workspace owns the Object creation popup.
  const [objectPopupOpen, setObjectPopupOpen] = useState(false);
  // Where the open Object popup was raised from (a Board's "+"), if anywhere.
  const [objectPopupContext, setObjectPopupContext] = useState<CreateObjectContext | null>(null);
  const [objectPopupWorkers, setObjectPopupWorkers] = useState<Worker[]>([]);
  // The Object popup uses the same visible Domain list as shell navigation.
  const previousDomainIdRef = useRef(activeDomainId);

  useEffect(() => {
    const handler = () => setCreateType('domain');
    window.addEventListener(CREATE_DOMAIN_EVENT, handler);
    return () => window.removeEventListener(CREATE_DOMAIN_EVENT, handler);
  }, []);

  // An Object lives in a Domain: with none yet, creating one starts with the Domain.
  const hasDomains = domains.length > 0;
  const openObjectPopup = useCallback((context?: CreateObjectContext) => {
    setObjectPopupContext(context ?? null);
    if (hasDomains) setObjectPopupOpen(true);
    else setCreateType('domain');
  }, [hasDomains]);
  // The sidebar's "+" in Notebook mode — the same quick-create card,
  // asking for the notebook's name.
  const [notebookPopupOpen, setNotebookPopupOpen] = useState(false);
  const openNotebookPopup = useCallback(() => setNotebookPopupOpen(true), []);
  const { createNode: createNoteNode, deleteNode: deleteNoteNode } = useNotes();

  // Fetch the active Domain's workers when the popup opens (lazy — keeps the
  // first paint cheap and re-runs when the Domain changes).
  useEffect(() => {
    if (!objectPopupOpen) return;
    fetchAllWorkers(activeDomainId || null)
      .then(setObjectPopupWorkers)
      .catch((e) => console.error('Failed to load workers for object popup', e));
  }, [objectPopupOpen, activeDomainId]);

  const activeDomainObjectTypes = useMemo<string[]>(
    () => (activeDomainId ? domains.find((d) => d.id === activeDomainId)?.object_types ?? [] : []),
    [activeDomainId, domains],
  );

  // Narrow windows: auto-collapse the sidebar so list/board content keeps a
  // usable width; wide windows: pin it back. Only acts when the window
  // CROSSES the breakpoint, so a manual toggle still sticks within a given
  // size band — and once a choice is stored, crossing no longer overrides
  // it at all: the band only ever decides for someone who has not chosen.
  // `wasNarrow` lives in a ref (not a closure local) so it can't
  // go stale across re-renders / HMR, and we sync once on mount so the
  // sidebar always matches the current width band on load.
  const wasNarrowRef = useRef<boolean | null>(null);
  useEffect(() => {
    const apply = () => {
      const narrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      if (wasNarrowRef.current === narrow) return;
      wasNarrowRef.current = narrow;
      if (readSidebarCollapsedChoice() !== null) return;
      setSidebarCollapsed(narrow);
      setSidebarOverlay(false);
    };
    apply(); // sync to the current width band immediately
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  const { data: explorerData, loading, error, refetch } = useObjects(activeDomainId);

  useEffect(() => {
    if (previousDomainIdRef.current === activeDomainId) return;
    previousDomainIdRef.current = activeDomainId;
    setTabs((prev) => prev.map((tab) => ({
      ...tab,
      navigation: navigationAfterDomainChange(tab.navigation, activeDomainId),
    })));
  }, [activeDomainId]);

  const handleCreateNew = (type: 'domain' | 'object' | 'note') => {
    if (type === 'note') {
      setActiveView('note');
      setPendingNewNote((n) => n + 1);
      return;
    }
    if (type === 'object') openObjectPopup();
    else setCreateType(type);
  };

  const handleCreated = async (result: CreateResult | { type: 'object'; id: string }) => {
    if (result.type === 'object') {
      setCreateType(null);
      setActiveView('objects');
      setActiveNavigation({ objectId: result.id });
      refetch();
      return;
    }
    await refetchDomains();
    onActiveDomainChange(result.id);
    setCreateType(null);
  };

  // PanelLeft button in the top strip. The right behaviour
  // depends on whether the window is wide enough to show the sidebar AND the
  // island side-by-side:
  // - Visible → hide it (island goes full-width).
  // - Hidden + WIDE window → pin it back in flow, so sidebar + island are
  //   both fully shown (no drawer, no dimmed island).
  // - Hidden + NARROW window → there isn't room for both, so reveal it as a
  //   floating drawer over a scrim (island dimmed behind, only sidebar
  //   interactive) instead of squishing the island.
  // A change to the pinned state is the person's choice and is stored;
  // the narrow drawer is a peek, not a choice, and stores nothing.
  const handleSidebarToggle = () => {
    const narrow = typeof window !== 'undefined' && window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
    if (!sidebarCollapsed) {
      // Currently visible (pinned or overlay) → hide.
      setSidebarCollapsed(true);
      setSidebarOverlay(false);
      storeSidebarCollapsedChoice(true);
    } else if (narrow) {
      setSidebarOverlay((v) => !v); // drawer reveal / dismiss
    } else {
      setSidebarCollapsed(false);   // wide → re-pin, both visible
      setSidebarOverlay(false);
      storeSidebarCollapsedChoice(false);
    }
  };

  // ⌘\ shows and hides the sidebar (its header button hides it too).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== '\\') return;
      e.preventDefault();
      handleSidebarToggle();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  // Choosing anything from the sidebar dismisses the overlay, so the tap
  // lands straight on the chosen screen (a no-op while the sidebar is pinned).
  const handleSidebarViewChange = (view: string) => {
    updateTab(activeTab.id, { activeView: view });
    setSidebarOverlay(false);
  };
  const handleSidebarNavigate = (nav: Partial<NavigationState>) => {
    setActiveNavigation(nav);
    setSidebarOverlay(false);
  };
  const handleSidebarCreateNew = (type: 'domain' | 'object' | 'note') => {
    handleCreateNew(type);
    setSidebarOverlay(false);
  };

  // Views that read nothing from the Domain list paint without waiting for
  // it — and without being blocked when it fails.
  const standsAlone = ['inbox', 'profile', 'my-elements'].includes(activeTab.activeView);
  if (loading && !standsAlone) {
    return <AppShellSkeleton />;
  }

  if (error && !standsAlone) {
    return (
      <div className="h-dvh flex items-center justify-center bg-background">
        <div className="text-center p-6 rounded-lg bg-card border border-border max-w-sm">
          <div className="text-destructive text-sm font-medium mb-2">{t('Connection Error')}</div>
          <div className="text-muted-foreground text-xs mb-4">{error.message}</div>
          <button onClick={() => refetch()} className="px-3 py-1.5 bg-muted hover:bg-accent text-foreground rounded text-xs transition-colors">
            {t('Try Again')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <ExplorerDataProvider value={explorerData}>
    <WorkspaceActionsProvider onOpenCreateObject={openObjectPopup} onOpenCreateNotebook={openNotebookPopup}>
    <SidebarRevealContext.Provider value={{ hidden: sidebarCollapsed && !sidebarOverlay, show: handleSidebarToggle }}>
    <CopilotProvider>
    <CopilotArrivalWatcher visible={aiScreen || copilotOpen} carryRef={aiCarryRef} />
    <div
      className="h-dvh flex flex-col overflow-hidden bg-[var(--content-bg)] text-foreground"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="relative flex-1 flex overflow-hidden">
        {/* The sidebar's frame. Not positioned, so the sidebar's drawer
            (absolute, measured from the row) escapes its clipping. */}
        <div className="my-1.5 ml-1 mr-1.5 flex shrink-0 overflow-hidden rounded-lg gloss-island">
        <AppSidebar
          onToggleSidebar={handleSidebarToggle}
          navigation={activeTab.navigation}
          onNavigate={handleSidebarNavigate}
          activeView={activeTab.activeView}
          onViewChange={handleSidebarViewChange}
          onOpenItem={openItem}
          onOpenSettings={handleOpenSettings}
          onCloseSettings={handleCloseSettings}
          onRefresh={refetch}
          width={260}
          collapsed={sidebarCollapsed}
          overlay={sidebarCollapsed && sidebarOverlay}
          onCreateNew={handleSidebarCreateNew}
          onSearch={() => setDiscoverOpen(true)}
        />
        </div>

        {sidebarCollapsed && sidebarOverlay && (
          <div
            className="absolute inset-0 z-40 bg-black/45"
            onClick={() => setSidebarOverlay(false)}
            aria-hidden="true"
          />
        )}

        <div className={`relative flex-1 flex flex-col overflow-hidden py-1.5 pr-1.5`}>
        {/* No strip above the content: back / forward are the browser's
            arrows (and ⌘[ / ⌘]). The sidebar closes by dragging the island
            over it; each page's title row then offers it back (⌘\\). */}
        {/* MainContent + Copilot live side-by-side as two islands. When the
            Copilot is open it claims its own width on the right; otherwise
            MainContent fills the row. */}
        <div className="flex-1 flex overflow-hidden gap-1.5">
          <div className="flex-1 flex overflow-hidden bg-white dark:bg-card rounded-lg gloss-island">
            {/* The open tool's own list (Tables, Artifacts, People …), left
                of what it opens; the Workspace has none. */}
            {!createType && (
              <ModePanel activeView={activeTab.activeView} navigation={activeTab.navigation}
                onNavigate={handleSidebarNavigate} onViewChange={handleSidebarViewChange} />
            )}
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {createType ? (
              <CreateView
                type={createType}
                onCancel={() => setCreateType(null)}
                onCreated={handleCreated}
              />
            ) : (
              // Render every kept view's tree; only the active one is visible.
              // The others stay mounted so their internal state (Domain tab,
              // expand state, scroll, edit drafts, etc.) survives a swap.
              tabs.map((tab) => {
                const isActive = tab.id === activeTab.id;
                return (
                  <div
                    key={tab.id}
                    className={isActive ? 'flex-1 flex flex-col overflow-hidden' : 'hidden'}
                    aria-hidden={!isActive}
                  >
                    <MainContent
                      onOpenSettings={handleOpenSettings}
                      activeActivity={tab.activeView}
                      navigation={tab.navigation}
                      onNavigate={(nav) => updateTabNavigation(tab.id, nav)}
                      onViewChange={(view) => updateTab(tab.id, { activeView: view })}
                      onRefresh={refetch}
                      pendingNewNote={isActive ? pendingNewNote : 0}
                      onNewNoteHandled={() => setPendingNewNote(0)}
                      activeDomainId={activeDomainId}
                      onMinimizeAi={handleMinimizeAi}
                      aiSubject={subject}
                    />
                  </div>
                );
              })
            )}
            </div>
          </div>
          {!aiScreen && (
            <AlconCopilotPanel open={copilotOpen} onOpenChange={handleCopilotOpenChange}
              subject={subject}
              variant="floating" onExpand={onSlides ? undefined : handleExpandAi} />
          )}
        </div>
        </div>
      </div>

      {/* Global ⌘K command palette */}
      <CommandPalette returnTo={{ view: activeTab.activeView, objectId: activeTab.navigation.objectId ?? null, objectDomainId: activeTab.navigation.objectDomainId ?? null, domainId: activeDomainId || null }} onNavigate={setActiveNavigation} onViewChange={setActiveView} onOpenItem={openItem} onNewTab={handleNewTab} onOpenSettings={handleOpenSettings} canGoBack={canGoBack} onGoBack={goBack} canGoForward={canGoForward} onGoForward={goForward} />
      <DiscoverModal open={discoverOpen} onOpenChange={setDiscoverOpen} />

      {/* Global C → quick-add Element popup. Context Object = the one open in
          the active tab (objects view only — other views keep a stale
          navigation.objectId around). */}
      <QuickAddElementLauncher
        activeDomainId={activeDomainId}
        contextObjectId={activeTab.activeView === 'objects' ? activeTab.navigation.objectId ?? null : null}
        onRefresh={refetch}
      />

      {/* Quick-create cards — one shape for every "+": the Notebook card and
          the Object card here (Linear-style, no full-page form); Strategy
          and Table cards live in their surfaces. */}
      <QuickAddNotebookPopup
        open={notebookPopupOpen}
        onClose={() => { setNotebookPopupOpen(false); setNextNotebookFolder(null); }}
        onSubmit={async (name) => {
          const { folder, page } = await seedNotebook(createNoteNode, deleteNoteNode, name);
          // Made from an Artifacts folder: it goes in that folder.
          await placeNewNotebook(folder.id);
          setActiveView('note');
          setActiveNavigation({ noteFolderId: folder.id, noteSectionId: null, noteId: page.id });
        }}
      />
      <QuickAddObjectPopup
        open={objectPopupOpen}
        onClose={() => setObjectPopupOpen(false)}
        workers={objectPopupWorkers.map((w) => ({ id: w.id, name: w.name }))}
        domains={domains.map((d) => ({ id: d.id, name: d.name }))}
        types={activeDomainObjectTypes}
        defaultDomainId={objectPopupContext?.domainId ?? (activeDomainId || null)}
        contextLabel={objectPopupContext?.strategy?.name}
        onSubmit={async (input) => {
          const created = await createObject({
            name: input.name,
            description: input.description ?? null,
            domain_id: input.domainId ?? activeDomainId,
            domain_ids: input.domainIds,
            type: input.type ?? null,
            lead_id: input.leadWorkerId ?? null,
            due_date: input.dueDate ?? null,
          });
          if (objectPopupContext?.strategy) await linkObjectToStrategy(objectPopupContext.strategy.id, created.id);
          await handleCreated({ type: 'object', id: created.id });
        }}
      />
    </div>
    </CopilotProvider>
    </SidebarRevealContext.Provider>
    </WorkspaceActionsProvider>
    </ExplorerDataProvider>
  );
}
