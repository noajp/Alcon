'use client';

import { ExplorerDataProvider } from '@/Function/shared/ExplorerDataContext';

import { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { WorkspaceActionsProvider } from '@/shell/WorkspaceActionsContext';
import { AppSidebar } from '@/shell/AppSidebar';
import { ModeRail, railModeOf } from '@/shell/ModeRail';
import { StatusBar } from '@/shell/StatusBar';
import { useUserPreferences } from '@/Function/settings/useUserPreferences';
import { DiscoverModal } from '@/shell/DiscoverModal';
import { MainContent } from '@/shell/MainContent';
import { CreateView, type CreateType, type CreateResult } from '@/shell/CreateView';
import { CommandPalette } from '@/shell/CommandPalette';
import { QuickAddElementLauncher } from '@/shell/QuickAddElementLauncher';
import { AlconCopilotPanel } from '@/Function/copilot/AlconCopilotPanel';
import { CopilotProvider } from '@/Function/copilot/CopilotProvider';
import type { AppTab } from '@/shell/appTab';
import { mergeNavigation, navigationAfterDomainChange, navigationForView } from '@/shell/navigationState';
import type { NavigationState } from '@/types/navigation';
import { useDomains, useObjects, createObject, createActivitySpace, useActivitySpaces, fetchAllWorkers, type Worker } from '@/hooks/useSupabase';
import { QuickAddObjectPopup } from '@/ActivitySpace/execution/object/QuickAddObjectPopup';
import { QuickAddNotebookPopup } from '@/ActivitySpace/sustainment/notebook/QuickAddNotebookPopup';
import { seedNotebook } from '@/ActivitySpace/sustainment/notebook/notebookActions';
import { useNotes } from '@/hooks/useNotesDb';
import { useAuthContext } from '@/providers/AuthProvider';
import { AuthPage } from '@/auth/AuthPage';
import { getActiveDomainId, setActiveDomainId, ACTIVE_DOMAIN_CHANGE_EVENT, CREATE_DOMAIN_EVENT } from '@/Function/space/domainsStore';
import { useActiveSpaceId, setActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useActiveSpaceScope } from '@/Function/space/data';
import { scopedView, viewInScope } from '@/Function/space/spaceScope';
import { OnboardingCreate } from '@/Function/space/OnboardingCreate';
import { MyInvitations } from '@/Function/membership/MyInvitations';
import { getCachedHomeViewId } from '@/Function/settings/preferencesStore';
import { setActiveSettingsSection } from '@/Function/settings/settingsNav';
import { completeOAuthReturn, readOAuthReturn, stripOAuthReturn, takeOAuthReturnView } from '@/Function/integrations/oauthReturn';
import { finishIntegrationOAuth } from '@/Function/integrations/data';
import { useWorkspaceDeltaStream } from '@/Function/sync/deltaStream';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import type { Domain } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';
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
        <div className="flex-1 rounded-lg border border-border/30 bg-white dark:bg-card shadow-[var(--shadow-island)] p-4">
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

function makeNewTab(activeView = 'inbox'): AppTab {
  return {
    id: `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    activeView,
    navigation: { objectId: null },
  };
}

// Below this viewport width the left sidebar auto-collapses so list/board
// content keeps a usable width (matches Linear's narrow-window behavior).
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 1024;

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
  // An audit Space shows only the Space, People and Audit (ADR 0048): every
  // way to a view passes through updateTab, which turns a view outside the
  // scope into the Audit home.
  const scope = useActiveSpaceScope();
  // The shell's view + navigation. Kept as a list of tabs so a surface's
  // internal state (Domain tab selection, expand state, scroll position …)
  // survives while another view is shown; the page shows one at a time and
  // has no tab strip — this is a browser tab already.
  const initialTabRef = useRef<AppTab | null>(null);
  // Settings > Preferences > "Default home view" — honoured at launch.
  if (initialTabRef.current === null) initialTabRef.current = makeNewTab(getCachedHomeViewId());
  const [tabs, setTabs] = useState<AppTab[]>(() => [initialTabRef.current!]);
  const [activeTabId] = useState<string>(() => initialTabRef.current!.id);

  const storedTab = tabs.find(t => t.id === activeTabId) ?? tabs[0];
  // A tab opened on a view the Space does not show (it was switched to
  // audit, or the default home view is outside it) reads as Audit; the view
  // it held comes back if the Space returns to full.
  const activeTab = viewInScope(storedTab.activeView, scope) ? storedTab : { ...storedTab, activeView: scopedView(storedTab.activeView, scope) };

  // Per-tab updaters — operate on the tab id that's passed in, not whichever
  // tab happens to be active. Each tab's MainContent gets a stable handler
  // bound to its own id so background tabs can keep their state correctly.
  const updateTab = (id: string, partial: Partial<Omit<AppTab, 'id'>>) => {
    const next = partial.activeView === undefined ? partial : { ...partial, activeView: scopedView(partial.activeView, scope) };
    setTabs(prev => prev.map(t => {
      if (t.id !== id) return t;
      const merged = { ...t, ...next };
      return next.activeView === undefined ? merged : { ...merged, navigation: navigationForView(merged.navigation, merged.activeView) };
    }));
  };
  const updateTabNavigation = (id: string, partial: Partial<NavigationState>) => {
    if (partial.objectId && partial.objectDomainId && partial.objectDomainId !== activeDomainId) {
      onActiveDomainChange(partial.objectDomainId);
      setActiveDomainId(partial.objectDomainId);
    }
    setTabs(prev => prev.map(t => (
      t.id === id ? { ...t, navigation: mergeNavigation(t.navigation, partial, activeDomainId) } : t
    )));
  };

  // Active-tab convenience writers (for sidebar + command palette which target
  // the visible tab).
  const setActiveView = (view: string) => updateTab(activeTab.id, { activeView: view });
  const setActiveNavigation = (nav: Partial<NavigationState>) => updateTabNavigation(activeTab.id, nav);

  // A page asked for another screen (an Element's "Open in" → its Note, a new
  // deck): switch this tab's view, and its route when one is given.
  // Re-subscribed each render, so it always writes to the tab active now.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const { view, nav } = (e as CustomEvent<OpenInAppDetail>).detail;
      if (nav) setActiveNavigation(nav);
      setActiveView(view);
    };
    window.addEventListener(OPEN_IN_APP_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_IN_APP_EVENT, onOpen);
  });

  // Settings opens in place and remembers where it came from, so the
  // sidebar's Back returns to that view — the one navigation target a
  // viewer needs a way back FROM, not just a way to switch away from.
  const [settingsReturnView, setSettingsReturnView] = useState<string | null>(null);
  const handleOpenSettings = () => {
    if (activeTab.activeView === 'settings') return;
    setSettingsReturnView(activeTab.activeView);
    setActiveView('settings');
  };
  // Back from an integration sign-in (integration-oauth): drop the parameters
  // from the URL, confirm the sign-in as this person (POST /finish — nothing
  // is stored before that) and open the screen it started from — Reviews, or
  // Settings › Integrations — to show the outcome.
  useEffect(() => {
    const result = readOAuthReturn(window.location.search);
    if (!result) return;
    window.history.replaceState(window.history.state, '', stripOAuthReturn(window.location.href));
    void completeOAuthReturn(result, finishIntegrationOAuth);
    const returnView = takeOAuthReturnView();
    if (!returnView) {
      setActiveSettingsSection('integrations', 'external');
      const launchView = initialTabRef.current?.activeView ?? 'inbox';
      if (launchView !== 'settings') setSettingsReturnView(launchView);
    }
    setTabs(prev => prev.map(t => (t.id === activeTabId ? { ...t, activeView: returnView ?? 'settings' } : t)));
  }, [activeTabId]);
  const handleCloseSettings = () => {
    setActiveView(settingsReturnView && settingsReturnView !== 'settings' ? settingsReturnView : 'inbox');
    setSettingsReturnView(null);
  };

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH,
  );
  // When collapsed, the sidebar can still be peeked as a floating overlay
  // (via the strip's reveal button) instead of pinning it back into flow.
  const [sidebarOverlay, setSidebarOverlay] = useState(false);
  // Profile (reached from the avatar; Now / My Elements / My Notes / AI are
  // its tabs) has nothing to list, so it takes the whole width.
  // Slides brings its own deck list, so it takes the whole width too.
  const personalMode = railModeOf(activeTab.activeView) === 'personal';
  const aiScreen = activeTab.activeView === 'ai';
  const noSidebar = personalMode;
  const [discoverOpen, setDiscoverOpen] = useState(false);
  // The AI pop-up — open state shared by the status bar's button, ⌘L and the
  // pop-up's own close. It starts closed, so the work has the whole page
  // until someone asks for it. On Slides it is the open deck's assistant.
  const [copilotOpen, handleCopilotOpenChange] = useState(false);
  const onSlides = activeTab.activeView === 'slides';
  // The pop-up's expand button opens the AI screen; the screen's shrink
  // button goes back to where the person was, with the pop-up open.
  const lastViewRef = useRef('home');
  useEffect(() => {
    if (activeTab.activeView !== 'ai') lastViewRef.current = activeTab.activeView;
  }, [activeTab.activeView]);
  const handleExpandAi = () => {
    handleCopilotOpenChange(false);
    setActiveView('ai');
  };
  const handleMinimizeAi = () => {
    setActiveView(lastViewRef.current);
    handleCopilotOpenChange(true);
  };
  // Nothing is created up front: a Space may start from Strategy (a Vision or
  // Portfolio) as well as from a Domain, so the person picks where to begin.
  const [createType, setCreateType] = useState<CreateType | null>(null);
  const [pendingNewNote, setPendingNewNote] = useState(0);
  // The workspace owns the Object creation popup.
  const [objectPopupOpen, setObjectPopupOpen] = useState(false);
  const [objectPopupWorkers, setObjectPopupWorkers] = useState<Worker[]>([]);
  // The Object popup uses the same visible Domain list as shell navigation.
  const previousDomainIdRef = useRef(activeDomainId);

  useEffect(() => {
    if (scope === 'audit') return;
    const handler = () => setCreateType('domain');
    window.addEventListener(CREATE_DOMAIN_EVENT, handler);
    return () => window.removeEventListener(CREATE_DOMAIN_EVENT, handler);
  }, [scope]);

  // An Object lives in a Domain: with none yet, creating one starts with the Domain.
  const hasDomains = domains.length > 0;
  const openObjectPopup = useCallback(() => {
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
  // size band. `wasNarrow` lives in a ref (not a closure local) so it can't
  // go stale across re-renders / HMR, and we sync once on mount so the
  // sidebar always matches the current width band on load.
  const wasNarrowRef = useRef<boolean | null>(null);
  useEffect(() => {
    const apply = () => {
      const narrow = window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
      if (wasNarrowRef.current === narrow) return;
      wasNarrowRef.current = narrow;
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

  // PanelLeft button in the strip under the islands. The right behaviour
  // depends on whether the window is wide enough to show the sidebar AND the
  // island side-by-side:
  // - Visible → hide it (island goes full-width).
  // - Hidden + WIDE window → pin it back in flow, so sidebar + island are
  //   both fully shown (no drawer, no dimmed island).
  // - Hidden + NARROW window → there isn't room for both, so reveal it as a
  //   floating drawer over a scrim (island dimmed behind, only sidebar
  //   interactive) instead of squishing the island.
  const handleSidebarToggle = () => {
    const narrow = typeof window !== 'undefined' && window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH;
    if (!sidebarCollapsed) {
      // Currently visible (pinned or overlay) → hide.
      setSidebarCollapsed(true);
      setSidebarOverlay(false);
    } else if (narrow) {
      setSidebarOverlay((v) => !v); // drawer reveal / dismiss
    } else {
      setSidebarCollapsed(false);   // wide → re-pin, both visible
      setSidebarOverlay(false);
    }
  };
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
  const standsAlone = ['home', 'inbox', 'profile', 'my-elements'].includes(activeTab.activeView);
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
    <CopilotProvider>
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
        {/* The rail and the pinned sidebar share one frame, divided by a
            line, as in VS Code. Not positioned, so the sidebar's drawer
            (absolute, measured from the row) escapes its clipping. */}
        <div className="mt-1.5 ml-1 mr-1.5 flex shrink-0 overflow-hidden rounded-lg border border-border/60 shadow-[var(--shadow-island)]">
        <ModeRail
          scope={scope}
          activeView={activeTab.activeView}
          onViewChange={handleSidebarViewChange}
        />
        {!noSidebar && <AppSidebar
          navigation={activeTab.navigation}
          onNavigate={handleSidebarNavigate}
          activeView={activeTab.activeView}
          onViewChange={handleSidebarViewChange}
          onOpenSettings={handleOpenSettings}
          onCloseSettings={handleCloseSettings}
          onRefresh={refetch}
          width={260}
          collapsed={sidebarCollapsed}
          overlay={sidebarCollapsed && sidebarOverlay}
          onCreateNew={handleSidebarCreateNew}
          onSearch={scope === 'full' ? () => setDiscoverOpen(true) : undefined}
        />}
        </div>

        {!noSidebar && sidebarCollapsed && sidebarOverlay && (
          <div
            className="absolute inset-0 z-40 bg-black/45"
            onClick={() => setSidebarOverlay(false)}
            aria-hidden="true"
          />
        )}

        <div className={`relative flex-1 flex flex-col overflow-hidden pt-1.5 pr-1.5`}>
        {/* MainContent + Copilot live side-by-side as two islands. When the
            Copilot is open it claims its own width on the right; otherwise
            MainContent fills the row. */}
        <div className="flex-1 flex overflow-hidden gap-1.5">
          <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-card rounded-lg border border-border/60 shadow-[var(--shadow-island)]">
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
                      activeSpaceId={activeSpaceId}
                      onOpenSettings={handleOpenSettings}
                      activeActivity={scopedView(tab.activeView, scope)}
                      navigation={tab.navigation}
                      onNavigate={(nav) => updateTabNavigation(tab.id, nav)}
                      onViewChange={(view) => updateTab(tab.id, { activeView: view })}
                      onRefresh={refetch}
                      pendingNewNote={isActive ? pendingNewNote : 0}
                      onNewNoteHandled={() => setPendingNewNote(0)}
                      activeDomainId={activeDomainId}
                      onMinimizeAi={handleMinimizeAi}
                    />
                  </div>
                );
              })
            )}
          </div>
          {!aiScreen && (
            <AlconCopilotPanel open={copilotOpen} onOpenChange={handleCopilotOpenChange} subject={onSlides ? 'slides' : null}
              variant="floating" onExpand={onSlides ? undefined : handleExpandAi} />
          )}
        </div>
        </div>
      </div>
      <StatusBar
        scope={scope}
        activeView={activeTab.activeView}
        onViewChange={handleSidebarViewChange}
        sidebar={noSidebar ? undefined : { visible: !sidebarCollapsed || sidebarOverlay, onToggle: handleSidebarToggle }}
        ai={{ open: copilotOpen || aiScreen, onToggle: aiScreen ? handleMinimizeAi : () => handleCopilotOpenChange(!copilotOpen) }}
      />

      {/* Global ⌘K command palette */}
      <CommandPalette scope={scope} returnTo={{ view: activeTab.activeView, objectId: activeTab.navigation.objectId ?? null, objectDomainId: activeTab.navigation.objectDomainId ?? null, domainId: activeDomainId || null }} onNavigate={setActiveNavigation} onViewChange={setActiveView} onOpenSettings={handleOpenSettings} />
      {scope === 'full' && <DiscoverModal open={discoverOpen} onOpenChange={setDiscoverOpen} />}

      {/* Global C → quick-add Element popup. Context Object = the one open in
          the active tab (objects view only — other views keep a stale
          navigation.objectId around). */}
      {scope === 'full' && <QuickAddElementLauncher
        activeDomainId={activeDomainId}
        contextObjectId={activeTab.activeView === 'objects' ? activeTab.navigation.objectId ?? null : null}
        onRefresh={refetch}
      />}

      {/* Quick-create cards — one shape for every "+": the Notebook card and
          the Object card here (Linear-style, no full-page form); Initiative
          and Table cards live in their surfaces. */}
      <QuickAddNotebookPopup
        open={notebookPopupOpen}
        onClose={() => setNotebookPopupOpen(false)}
        onSubmit={async (name) => {
          const { folder, page } = await seedNotebook(createNoteNode, deleteNoteNode, name);
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
        defaultDomainId={activeDomainId || null}
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
          await handleCreated({ type: 'object', id: created.id });
        }}
      />
    </div>
    </CopilotProvider>
    </WorkspaceActionsProvider>
    </ExplorerDataProvider>
  );
}
