'use client';

import dynamic from 'next/dynamic';
import type { NavigationState } from '@/types/navigation';
import { setActiveDomainId } from '@/ActivitySpace/execution/domain/domainsStore';
import { NotebookSurface } from '@/ActivitySpace/sustainment/notebook/NotebookSurface';
import { ElementDrilldown } from '@/ActivitySpace/execution/element/ElementDrilldown';

import { ElementsListView } from '@/ActivitySpace/execution/element/ElementsListView';
import { MyElementsView } from '@/ActivitySpace/home/MyElementsView';

// Lazy-loaded views — the landing view is 'objects' (DomainView), and the
// core list views (DomainView / ElementsListView / MyElementsView) stay
// eager. Everything else is split into its own chunk and fetched only when
// the user actually opens that activity, so the first paint ships less JS.
// These views also pull the heaviest leaf deps (note editor, DAG/charts,
// data widgets), which is exactly what we don't want in the entry bundle.
const viewLoading = () => (
  <div className="flex-1 flex items-center justify-center bg-card text-[13px] text-muted-foreground">
    Loading…
  </div>
);
const InboxView = dynamic(() => import('@/ActivitySpace/home/InboxView').then(m => m.InboxView), { ssr: false, loading: viewLoading });
const StrategyShell = dynamic(() => import('@/ActivitySpace/strategy/initiative/StrategyShell').then(m => m.StrategyShell), { ssr: false, loading: viewLoading });
const VisionView = dynamic(() => import('@/ActivitySpace/strategy/vision/VisionView').then(m => m.VisionView), { ssr: false, loading: viewLoading });
const PortfolioView = dynamic(() => import('@/ActivitySpace/strategy/portfolio/PortfolioView').then(m => m.PortfolioView), { ssr: false, loading: viewLoading });
const PhaseView = dynamic(() => import('@/ActivitySpace/strategy/phase/PhaseView').then(m => m.PhaseView), { ssr: false, loading: viewLoading });
const WorkloadView = dynamic(() => import('@/ActivitySpace/sustainment/workload/WorkloadView').then(m => m.WorkloadView), { ssr: false, loading: viewLoading });
const TimelineView = dynamic(() => import('@/ActivitySpace/strategy/timeline/TimelineView').then(m => m.TimelineView), { ssr: false, loading: viewLoading });
const HomeScreen = dynamic(() => import('@/shell/HomeScreen').then(m => m.HomeScreen), { ssr: false, loading: viewLoading });
import { DomainOverview } from '@/ActivitySpace/execution/domain/DomainOverview';
import { DomainView } from '@/ActivitySpace/execution/domain/DomainView'; // eager — default landing view
const DomainsView = dynamic(() => import('@/ActivitySpace/execution/domain/DomainsView').then(m => m.DomainsView), { ssr: false, loading: viewLoading });
const TableView = dynamic(() => import('@/ActivitySpace/sustainment/table').then(m => m.TableView), { ssr: false, loading: viewLoading });
const ScmView = dynamic(() => import('@/ActivitySpace/sustainment/scm/ScmView').then(m => m.ScmView), { ssr: false, loading: viewLoading });
const OperationsView = dynamic(() => import('@/ActivitySpace/sustainment/operations/OperationsView').then(m => m.OperationsView), { ssr: false, loading: viewLoading });
const TeamView = dynamic(() => import('@/ActivitySpace/sustainment/team/TeamView').then(m => m.TeamView), { ssr: false, loading: viewLoading });
const MyCalendarView = dynamic(() => import('@/ActivitySpace/home/MyCalendarView').then(m => m.MyCalendarView), { ssr: false, loading: viewLoading });
const ProfileView = dynamic(() => import('@/ActivitySpace/home/ProfileView').then(m => m.ProfileView), { ssr: false, loading: viewLoading });
const SettingsView = dynamic(() => import('@/Function/settings/SettingsView').then(m => m.SettingsView), { ssr: false, loading: viewLoading });
import { IslandCard } from '@/shell/IslandCard';

export { IslandCard };

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
}

export function MainContent({ activeActivity, navigation, onNavigate, onViewChange, onOpenSettings, onRefresh, pendingNewNote, onNewNoteHandled, activeDomainId, activeSpaceId }: MainContentProps) {

  return (
    <div className="flex-1 flex flex-col bg-card overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
          <NotebookSurface
            visible={activeActivity === 'note' || (activeActivity === 'home' && navigation.homeSelection?.type === 'note_folder')}
            navigation={navigation}
            onNavigate={onNavigate}
            onViewChange={onViewChange}
            onRefresh={onRefresh}
            pendingNewNote={pendingNewNote}
            onNewNoteHandled={onNewNoteHandled}
            activeDomainId={activeDomainId}
          />

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

          {activeActivity === 'vision' && (
            <div className="flex-1 overflow-hidden bg-card">
              <VisionView />
            </div>
          )}

          {activeActivity === 'portfolio' && (
            <div className="flex-1 overflow-hidden bg-card">
              <PortfolioView
                createRequested={!!navigation.portfolioCreate}
                onCreateHandled={() => onNavigate({ portfolioCreate: null })}
                onSelectStrategy={(id) => {
                  onNavigate({ strategyId: id });
                  onViewChange?.('strategy');
                }}
              />
            </div>
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
          {activeActivity === 'workload' && (
            <div className="flex-1 overflow-hidden bg-card">
              <WorkloadView workerId={navigation.workerId} onNavigate={onNavigate} onViewChange={onViewChange} />
            </div>
          )}

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

          {activeActivity === 'domain-overview' && (
            <DomainOverview key={activeDomainId} domainId={activeDomainId ?? null} onNavigate={onNavigate} onViewChange={onViewChange} />
          )}

          {activeActivity === 'domain-elements' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <ElementsListView
                onRefresh={onRefresh}
                activeDomainId={activeDomainId}
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
            />
          )}

          {activeActivity === 'tables' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <TableView
                activeTableId={navigation.tableId ?? null}
                onSelectTable={(id) => onNavigate({ tableId: id })}
              />
            </div>
          )}

          {activeActivity === 'scm' && <ScmView navigation={navigation} onNavigate={onNavigate} />}
          {activeActivity === 'crm' && (
            <OperationsView navigation={navigation} onNavigate={onNavigate} onViewChange={onViewChange} />
          )}

          {activeActivity === 'team' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <ElementDrilldown label="Team" onNavigate={onNavigate} onViewChange={onViewChange}>
                {openElement => <TeamView onOpenElement={openElement} onOpenWorkload={(workerId) => {
                  onNavigate({ workerId: workerId ?? null });
                  onViewChange?.('workload');
                }} />}
              </ElementDrilldown>
            </div>
          )}

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
