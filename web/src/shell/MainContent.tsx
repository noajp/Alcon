'use client';

import dynamic from 'next/dynamic';
import type { NavigationState } from '@/types/navigation';
import { setActiveDomainId } from '@/alcon/domain/domainsStore';
import { NotebookSurface } from '@/alcon/brief/NotebookSurface';

import { ElementsListView } from '@/alcon/element/actions/ElementsListView';
import { MyElementsView } from '@/alcon/element/actions/MyElementsView';

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
const InboxView = dynamic(() => import('@/alcon/element/actions/InboxView').then(m => m.InboxView), { ssr: false, loading: viewLoading });
const StrategyShell = dynamic(() => import('@/alcon/element/actions/StrategyShell').then(m => m.StrategyShell), { ssr: false, loading: viewLoading });
const PhaseView = dynamic(() => import('@/alcon/phase/PhaseView').then(m => m.PhaseView), { ssr: false, loading: viewLoading });
const ResourceView = dynamic(() => import('@/alcon/element/actions/ResourceView').then(m => m.ResourceView), { ssr: false, loading: viewLoading });
const TimelineView = dynamic(() => import('@/alcon/element/actions/TimelineView').then(m => m.TimelineView), { ssr: false, loading: viewLoading });
const HomeScreen = dynamic(() => import('@/shell/HomeScreen').then(m => m.HomeScreen), { ssr: false, loading: viewLoading });
import { DomainView } from '@/alcon/domain/DomainView'; // eager — default landing view
const DomainsView = dynamic(() => import('@/alcon/domain/DomainsView').then(m => m.DomainsView), { ssr: false, loading: viewLoading });
const TableView = dynamic(() => import('@/alcon/table').then(m => m.TableView), { ssr: false, loading: viewLoading });
const TeamView = dynamic(() => import('@/alcon/team/TeamView').then(m => m.TeamView), { ssr: false, loading: viewLoading });
const MyCalendarView = dynamic(() => import('@/alcon/element/actions/MyCalendarView').then(m => m.MyCalendarView), { ssr: false, loading: viewLoading });
const ProfileView = dynamic(() => import('@/alcon/settings/ProfileView').then(m => m.ProfileView), { ssr: false, loading: viewLoading });
const SettingsView = dynamic(() => import('@/alcon/settings/SettingsView').then(m => m.SettingsView), { ssr: false, loading: viewLoading });
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
}

export function MainContent({ activeActivity, navigation, onNavigate, onViewChange, onOpenSettings, onRefresh, pendingNewNote, onNewNoteHandled, activeDomainId }: MainContentProps) {

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

          {activeActivity === 'home' && navigation.homeSelection?.type !== 'note_folder' && <HomeScreen />}

          {activeActivity === 'inbox' && (
            <div className="flex-1 overflow-hidden bg-card">
              <InboxView onNavigate={onNavigate} onViewChange={onViewChange} />
            </div>
          )}

          {activeActivity === 'calendar' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <MyCalendarView onNavigate={onNavigate} onViewChange={onViewChange} activeDomainId={activeDomainId} activeObjectId={navigation.objectId} />
            </div>
          )}

          {activeActivity === 'strategy' && (
            <div className="flex-1 overflow-hidden bg-card">
              <StrategyShell
                activeStrategyId={navigation.strategyId ?? null}
                onSelectStrategy={(id) => onNavigate({ strategyId: id })}
                onOpenObject={(objectId, domainId) => {
                  if (domainId) setActiveDomainId(domainId);
                  onNavigate({ objectId });
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
                onOpenCampaign={(id) => {
                  onNavigate({ strategyId: id });
                  onViewChange?.('strategy');
                }}
              />
            </div>
          )}

          {/* Workload — the per-Worker load surface (ResourceView) promoted
              to a standalone Strategy-layer view. Domain scope comes from
              its own filter button. */}
          {activeActivity === 'workload' && (
            <div className="flex-1 overflow-hidden bg-card">
              <ResourceView title="Workload" />
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
              <DomainsView onOpen={() => onViewChange?.('objects')} />
            </div>
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

          {activeActivity === 'team' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-card">
              <TeamView />
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

