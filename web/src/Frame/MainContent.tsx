'use client';

import { AlconCopilotPanel } from '@/AIP/ai/AlconCopilotPanel';
import { useActiveSpaceScope } from '@/Function/space/data';
import dynamic from 'next/dynamic';
import type { NavigationState } from '@/types/navigation';
import { setActiveDomainId } from '@/Function/space/domainsStore';
import { useState } from 'react';

// Every view is split into its own chunk and fetched only when the user
// opens that activity, so the first paint ships less JS. The landing view
// is 'inbox'; the Object / Element views pull the heaviest leaf deps (Gantt,
// Calendar, Resource, Element detail, the note editor), which is exactly
// what we don't want in the entry bundle.
const viewLoading = () => (
  <div className="flex-1 flex items-center justify-center bg-card text-[13px] text-muted-foreground">
    Loading…
  </div>
);
const InboxView = dynamic(() => import('@/ActivitySpace/home/InboxView').then(m => m.InboxView), { ssr: false, loading: viewLoading });
const StrategyShell = dynamic(() => import('@/ActivitySpace/strategy/initiative/StrategyShell').then(m => m.StrategyShell), { ssr: false, loading: viewLoading });
const PhaseView = dynamic(() => import('@/ActivitySpace/strategy/phase/PhaseView').then(m => m.PhaseView), { ssr: false, loading: viewLoading });
const PeopleView = dynamic(() => import('@/ActivitySpace/people/PeopleView').then(m => m.PeopleView), { ssr: false, loading: viewLoading });
const TimelineView = dynamic(() => import('@/ActivitySpace/strategy/timeline/TimelineView').then(m => m.TimelineView), { ssr: false, loading: viewLoading });
const HomeScreen = dynamic(() => import('@/Frame/HomeScreen').then(m => m.HomeScreen), { ssr: false, loading: viewLoading });
const NotebookSurface = dynamic(() => import('@/ActivitySpace/artifacts/notebook/NotebookSurface').then(m => m.NotebookSurface), { ssr: false, loading: viewLoading });
const ElementsListView = dynamic(() => import('@/ActivitySpace/execution/element/ElementsListView').then(m => m.ElementsListView), { ssr: false, loading: viewLoading });
const MyElementsView = dynamic(() => import('@/ActivitySpace/home/MyElementsView').then(m => m.MyElementsView), { ssr: false, loading: viewLoading });
const AutomationView = dynamic(() => import('@/ActivitySpace/automation/AutomationView').then(m => m.AutomationView), { ssr: false, loading: viewLoading });
const DomainView = dynamic(() => import('@/ActivitySpace/execution/domain/DomainView').then(m => m.DomainView), { ssr: false, loading: viewLoading });
const DomainsView = dynamic(() => import('@/ActivitySpace/execution/domain/DomainsView').then(m => m.DomainsView), { ssr: false, loading: viewLoading });
const TableView = dynamic(() => import('@/ActivitySpace/table').then(m => m.TableView), { ssr: false, loading: viewLoading });
const FilesView = dynamic(() => import('@/ActivitySpace/artifacts').then(m => m.FilesView), { ssr: false, loading: viewLoading });
const SlidesView = dynamic(() => import('@/ActivitySpace/artifacts/slides').then(m => m.SlidesView), { ssr: false, loading: viewLoading });
const AuditView = dynamic(() => import('@/ActivitySpace/audit/AuditView').then(m => m.AuditView), { ssr: false, loading: viewLoading });
const TeamView = dynamic(() => import('@/ActivitySpace/people/TeamView').then(m => m.TeamView), { ssr: false, loading: viewLoading });
const MyCalendarView = dynamic(() => import('@/ActivitySpace/home/MyCalendarView').then(m => m.MyCalendarView), { ssr: false, loading: viewLoading });
const ProfileView = dynamic(() => import('@/ActivitySpace/home/ProfileView').then(m => m.ProfileView), { ssr: false, loading: viewLoading });
const ReviewsView = dynamic(() => import('@/ActivitySpace/reviews/ReviewsView').then(m => m.ReviewsView), { ssr: false, loading: viewLoading });
const SettingsView = dynamic(() => import('@/Function/settings/SettingsView').then(m => m.SettingsView), { ssr: false, loading: viewLoading });


interface MainContentProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  onOpenSettings: () => void;
  onRefresh?: () => void;
  pendingNewNote?: number;
  onNewNoteHandled?: () => void;
  activeDomainId?: string | null;
  activeSpaceId?: string | null;
  /** The AI screen's shrink button: back to the pop-up. */
  onMinimizeAi?: () => void;
}

export function MainContent({ activeActivity, navigation, onNavigate, onViewChange, onOpenSettings, onRefresh, pendingNewNote, onNewNoteHandled, activeDomainId, activeSpaceId, onMinimizeAi }: MainContentProps) {
  const scope = useActiveSpaceScope();
  const notebookVisible = activeActivity === 'note' || (activeActivity === 'home' && navigation.homeSelection?.type === 'note_folder');
  // The notebook stays mounted once opened (it keeps its editor state while
  // hidden), but it is not loaded until the user first opens it.
  const [notebookOpened, setNotebookOpened] = useState(notebookVisible);
  if (notebookVisible && !notebookOpened) setNotebookOpened(true);

  return (
    <div className="flex-1 flex flex-col bg-card overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
          {notebookOpened && <NotebookSurface
            visible={notebookVisible}
            navigation={navigation}
            onNavigate={onNavigate}
            onViewChange={onViewChange}
            onRefresh={onRefresh}
            pendingNewNote={pendingNewNote}
            onNewNoteHandled={onNewNoteHandled}
            activeDomainId={activeDomainId}
          />}

          {activeActivity === 'home' && navigation.homeSelection?.type !== 'note_folder' && <HomeScreen spaceId={activeSpaceId ?? null} onNavigate={onNavigate} onViewChange={onViewChange} />}

          {activeActivity === 'inbox' && (
            <div className="flex-1 overflow-hidden bg-card">
              <InboxView onNavigate={onNavigate} onViewChange={onViewChange} />
            </div>
          )}

          {(activeActivity === 'calendar' || activeActivity === 'schedule') && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <MyCalendarView initialScope={activeActivity === 'schedule' ? 'space' : 'mine'} onNavigate={onNavigate} onViewChange={onViewChange} activeDomainId={activeDomainId} activeObjectId={navigation.objectId} />
            </div>
          )}

          {activeActivity === 'automation' && (
            <AutomationView onOpenStrategy={(id) => { onNavigate({ strategyId: id }); onViewChange?.('strategy'); }}
              onOpenElement={(id) => { onNavigate({ elementId: id }); onViewChange?.('domain-elements'); }} />
          )}

          {activeActivity === 'strategy' && (
            <div className="flex-1 overflow-hidden bg-card">
              <StrategyShell
                activeStrategyId={navigation.strategyId ?? null}
                createRequested={!!navigation.strategyCreate}
                onCreateHandled={() => onNavigate({ strategyCreate: null })}
                onSelectStrategy={(id) => onNavigate({ strategyId: id })}
                onOpenDomain={(domainId) => {
                  setActiveDomainId(domainId);
                  onNavigate({ objectId: null });
                  onViewChange?.('domain-overview');
                }}
                onOpenObject={(objectId, domainId) => {
                  if (domainId) setActiveDomainId(domainId);
                  onNavigate({ objectId, objectDomainId: domainId ?? undefined });
                  onViewChange?.('objects');
                }}
                onOpenTable={(tableId) => {
                  onNavigate({ tableId });
                  onViewChange?.('tables');
                }}
              />
            </div>
          )}

          {activeActivity === 'phase' && (
            <div className="flex-1 overflow-hidden bg-card">
              <PhaseView
                activeDomainId={activeDomainId ?? null}
                onOpenObject={(objectId, domainId) => {
                  if (domainId) setActiveDomainId(domainId);
                  onNavigate({ objectId });
                  onViewChange?.('objects');
                }}
                onOpenInitiative={(id) => {
                  onNavigate({ strategyId: id });
                  onViewChange?.('strategy');
                }}
              />
            </div>
          )}

          {/* Workload — the per-Worker load surface (ResourceView) promoted
              to a standalone Sustainment view. Domain scope comes from
              its own filter button. */}

          {activeActivity === 'timeline' && (
            <div className="flex-1 overflow-hidden bg-card">
              <TimelineView
                onSelectStrategy={(id) => {
                  onNavigate({ strategyId: id });
                  onViewChange?.('strategy');
                }}
                onOpenObject={(objectId, domainId) => {
                  if (domainId) setActiveDomainId(domainId);
                  onNavigate({ objectId });
                  onViewChange?.('objects');
                }}
              />
            </div>
          )}

          {activeActivity === 'domains' && (
            <div className="flex-1 overflow-auto bg-card">
              <DomainsView onOpen={(id) => { setActiveDomainId(id); onNavigate({ objectId: null }); onViewChange?.('domain-overview'); }} />
            </div>
          )}

          {/* The Domain itself: its page with the Overview and All Objects tabs,
              opening on Overview. */}
          {activeActivity === 'domain-overview' && (
            <DomainView
              navigation={{ ...navigation, objectId: null }}
              onNavigate={(nav) => { onNavigate(nav); if (nav.objectId) onViewChange?.('objects'); }}
              onRefresh={onRefresh}
              activeDomainId={activeDomainId}
              onViewChange={onViewChange}
              landOn="overview"
            />
          )}

          {activeActivity === 'domain-elements' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <ElementsListView
                onRefresh={onRefresh}
                activeDomainId={activeDomainId}
                openElementId={navigation.elementId ?? null}
                onCloseOpenElement={() => {
                  // Back puts the Domain, Object and view open before ⌘K back.
                  const back = navigation.elementReturn;
                  onNavigate({ elementId: null, elementReturn: null });
                  if (!back) return;
                  if (back.objectId && back.objectDomainId) {
                    onNavigate({ objectId: back.objectId, objectDomainId: back.objectDomainId });
                  } else {
                    if (back.domainId && back.domainId !== activeDomainId) setActiveDomainId(back.domainId);
                    onNavigate({ objectId: back.objectId });
                  }
                  if (back.view !== 'domain-elements') onViewChange?.(back.view);
                }}
                onNavigate={onNavigate}
                onViewChange={onViewChange}
              />
            </div>
          )}

          {activeActivity === 'my-elements' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <MyElementsView
                onRefresh={onRefresh}
                onNavigate={onNavigate}
                onViewChange={onViewChange}
              />
            </div>
          )}

          {activeActivity === 'objects' && (
            <DomainView
              navigation={navigation}
              onNavigate={onNavigate}
              onRefresh={onRefresh}
              activeDomainId={activeDomainId}
              onViewChange={onViewChange}
              landOn="elements"
            />
          )}

          {activeActivity === 'tables' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <TableView
                activeTableId={navigation.tableId ?? null}
                onSelectTable={(id) => onNavigate({ tableId: id })}
                browse={navigation.tableBrowse ?? {}}
                onBrowse={(next) => onNavigate({ tableId: null, tableBrowse: next })}
              />
            </div>
          )}

          {activeActivity === 'files' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <FilesView navigation={navigation} onNavigate={onNavigate} onViewChange={onViewChange} />
            </div>
          )}

          {activeActivity === 'slides' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <SlidesView />
            </div>
          )}


          {activeActivity === 'reviews' && <ReviewsView navigation={navigation} onNavigate={onNavigate} onOpenSettings={onOpenSettings} />}

          {activeActivity === 'audit' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <AuditView navigation={navigation} onNavigate={onNavigate} />
            </div>
          )}

          {(activeActivity === 'team' || activeActivity === 'workload') && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              {/* An audit Space (ADR 0048) shows its people without opening
                  their Elements or their load. */}
              {scope === 'audit' ? <TeamView /> : <PeopleView workerId={navigation.workerId} unitId={navigation.unitId} onNavigate={onNavigate} onViewChange={onViewChange} />}
            </div>
          )}

          {/* The AI on a screen of its own — the same conversation as the pop-up. */}
          {activeActivity === 'ai' && <AlconCopilotPanel variant="page" open onOpenChange={() => {}} onMinimize={onMinimizeAi} />}

          {activeActivity === 'profile' && <ProfileView onOpenSettings={onOpenSettings} onNavigate={onNavigate} onViewChange={onViewChange} activeDomainId={activeDomainId} />}

          {activeActivity === 'settings' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <SettingsView />
            </div>
          )}
      </div>
    </div>
  );
}
