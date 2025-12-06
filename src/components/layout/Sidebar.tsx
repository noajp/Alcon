'use client';

import { useState, useEffect } from 'react';
import type { CompanyWithHierarchy, DepartmentWithTeams, TeamWithProjects, ProjectWithSections, SectionWithTasks } from '@/hooks/useSupabase';

// ============================================
// Navigation State Type
// ============================================
export interface NavigationState {
  departmentId: string | null;
  teamId: string | null;
  projectId: string | null;
  sectionId: string | null;
}

interface SidebarProps {
  activeActivity: string;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  company: CompanyWithHierarchy | null;
}

export function Sidebar({ activeActivity, navigation, onNavigate, company }: SidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // 最初の事業部を自動展開
  useEffect(() => {
    if (company?.departments && company.departments.length > 0) {
      const firstDept = company.departments[0];
      setExpandedSections(new Set([firstDept.id]));
    }
  }, [company]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  if (!company) return null;

  return (
    <div className="h-full w-[var(--sidebar-width)] bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col">
      {/* Sidebar Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-sm font-bold shadow-md">
            {company.name.charAt(0)}
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-[var(--text-primary)] text-sm leading-tight">{company.name}</span>
            <span className="text-[10px] text-[var(--text-muted)]">{company.departments?.length || 0} departments</span>
          </div>
        </div>
        <button className="w-7 h-7 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="Search..."
            className="w-full pl-9 pr-3 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] rounded border border-[var(--border-color)]">
            /
          </kbd>
        </div>
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 overflow-y-auto px-2">
        {activeActivity === 'home' && <HomeSidebar company={company} navigation={navigation} onNavigate={onNavigate} />}
        {activeActivity === 'projects' && (
          <HierarchySidebar
            company={company}
            navigation={navigation}
            onNavigate={onNavigate}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
          />
        )}
        {activeActivity === 'tasks' && <TasksSidebar company={company} />}
        {activeActivity === 'inbox' && <InboxSidebar />}
        {activeActivity === 'agents' && <AgentsSidebar />}
        {activeActivity === 'insights' && <InsightsSidebar />}
        {activeActivity === 'team' && <TeamSidebar company={company} />}
        {activeActivity === 'settings' && <SettingsSidebar />}
      </div>
    </div>
  );
}

// ============================================
// HOME Sidebar
// ============================================
function HomeSidebar({ company, navigation, onNavigate }: { company: CompanyWithHierarchy; navigation: NavigationState; onNavigate: (nav: Partial<NavigationState>) => void }) {
  const allProjects = company.departments?.flatMap(d => d.teams.flatMap(t => t.projects)) || [];

  return (
    <div className="py-2 space-y-1">
      <NavItem icon="home" label="Overview" isActive />
      <NavItem icon="calendar" label="Calendar" />
      <NavItem icon="chart" label="My Progress" />
      <NavItem icon="clock" label="Upcoming" />

      <div className="h-px bg-[var(--border-subtle)] mx-2 my-3" />

      <div className="px-2 py-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2">Recent Projects</div>
        {allProjects.slice(0, 4).map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isSelected={navigation.projectId === project.id}
            onClick={() => onNavigate({ projectId: project.id })}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// HIERARCHY Sidebar
// ============================================
interface HierarchySidebarProps {
  company: CompanyWithHierarchy;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

function HierarchySidebar({ company, navigation, onNavigate, expandedSections, toggleSection }: HierarchySidebarProps) {
  return (
    <div className="py-2">
      {company.departments?.map((department) => (
        <div key={department.id} className="mb-1">
          {/* Department Header */}
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-[var(--bg-hover)] transition-colors group"
            onClick={() => toggleSection(department.id)}
          >
            <span className={`text-[10px] text-[var(--text-muted)] transition-transform duration-200 ${expandedSections.has(department.id) ? 'rotate-90' : ''}`}>
              ▶
            </span>
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: department.color || '#3b82f6' }}
            />
            <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] flex-1 truncate">
              {department.name}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {department.teams?.length || 0}
            </span>
          </button>

          {expandedSections.has(department.id) && (
            <div className="ml-4 mt-1 space-y-0.5">
              {department.teams?.map((team) => (
                <div key={team.id}>
                  <TeamItem
                    team={team}
                    isExpanded={expandedSections.has(team.id)}
                    isSelected={navigation.teamId === team.id && !navigation.projectId}
                    onToggle={() => toggleSection(team.id)}
                    onClick={() => onNavigate({ teamId: team.id, projectId: null, sectionId: null })}
                    departmentColor={department.color || '#3b82f6'}
                  />

                  {expandedSections.has(team.id) && (
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {team.projects?.map((project) => (
                        <ProjectTreeItem
                          key={project.id}
                          project={project}
                          navigation={navigation}
                          onNavigate={onNavigate}
                          expandedSections={expandedSections}
                          toggleSection={toggleSection}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================
// Project Tree Item
// ============================================
interface ProjectTreeItemProps {
  project: ProjectWithSections;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

function ProjectTreeItem({ project, navigation, onNavigate, expandedSections, toggleSection }: ProjectTreeItemProps) {
  const isExpanded = expandedSections.has(project.id);
  const isSelected = navigation.projectId === project.id && !navigation.sectionId;

  // Calculate progress
  const allTasks = project.sections?.flatMap(s => s.tasks) || [];
  const doneTasks = allTasks.filter(t => t.status === 'done').length;
  const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150 group ${
          isSelected
            ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
      >
        <button
          className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={(e) => {
            e.stopPropagation();
            toggleSection(project.id);
          }}
        >
          <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        </button>
        <div
          className="flex-1 flex items-center gap-2"
          onClick={() => onNavigate({ projectId: project.id, sectionId: null })}
        >
          <span className="text-sm truncate">{project.name}</span>
        </div>
        {/* Progress indicator */}
        <div className="w-8 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--status-success)] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Sections */}
      {isExpanded && project.sections && (
        <div className="ml-6 mt-0.5 space-y-0.5">
          {project.sections.map((section) => (
            <SectionItem
              key={section.id}
              section={section}
              isSelected={navigation.sectionId === section.id}
              onClick={() => onNavigate({ projectId: project.id, sectionId: section.id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Section Item
// ============================================
function SectionItem({ section, isSelected, onClick }: { section: SectionWithTasks; isSelected: boolean; onClick: () => void }) {
  const taskCount = section.tasks?.length || 0;
  const blockedCount = section.tasks?.filter(t => t.status === 'blocked').length || 0;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
      }`}
      onClick={onClick}
    >
      <span className="text-xs truncate flex-1">{section.name}</span>
      {blockedCount > 0 && (
        <span className="px-1.5 py-0.5 text-[9px] rounded bg-red-500/20 text-red-400">
          {blockedCount}
        </span>
      )}
      {taskCount > 0 && (
        <span className="text-[10px] text-[var(--text-muted)]">{taskCount}</span>
      )}
    </div>
  );
}

// ============================================
// Team Item
// ============================================
function TeamItem({ team, isExpanded, isSelected, onToggle, onClick, departmentColor }: {
  team: TeamWithProjects;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  departmentColor: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors group ${
        isSelected
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
    >
      <button
        className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--text-muted)]"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
      </button>
      <div className="flex-1 flex items-center gap-2" onClick={onClick}>
        <div
          className="w-5 h-5 rounded flex items-center justify-center text-[10px] text-white"
          style={{ backgroundColor: departmentColor }}
        >
          {team.name.charAt(0)}
        </div>
        <span className="text-sm truncate">{team.name}</span>
      </div>
      <span className="text-[10px] text-[var(--text-muted)]">{team.members?.length || 0}</span>
    </div>
  );
}

// ============================================
// Project Item (for lists)
// ============================================
function ProjectItem({ project, isSelected, onClick }: { project: ProjectWithSections; isSelected: boolean; onClick: () => void }) {
  const allTasks = project.sections?.flatMap(s => s.tasks) || [];
  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
      onClick={onClick}
    >
      <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center text-xs">
        {project.name.charAt(0)}
      </div>
      <span className="flex-1 text-sm truncate">{project.name}</span>
      {blockedTasks > 0 && (
        <span className="px-1.5 py-0.5 text-[9px] rounded bg-red-500/20 text-red-400">
          {blockedTasks} blocked
        </span>
      )}
    </div>
  );
}

// ============================================
// TASKS Sidebar
// ============================================
function TasksSidebar({ company }: { company: CompanyWithHierarchy }) {
  const allTasks = company.departments?.flatMap(d =>
    d.teams.flatMap(t => t.projects.flatMap(p => p.sections.flatMap(s => s.tasks)))
  ) || [];

  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;
  const inProgressTasks = allTasks.filter(t => t.status === 'in_progress').length;
  const todoTasks = allTasks.filter(t => t.status === 'todo').length;

  return (
    <div className="py-2 space-y-1">
      <NavItem icon="list" label="All Tasks" badge={allTasks.length} isActive />
      <NavItem icon="alert" label="Blocked" badge={blockedTasks} badgeColor="red" />
      <NavItem icon="play" label="In Progress" badge={inProgressTasks} badgeColor="yellow" />
      <NavItem icon="circle" label="To Do" badge={todoTasks} />
      <NavItem icon="check" label="Completed" />
    </div>
  );
}

// ============================================
// INBOX Sidebar
// ============================================
function InboxSidebar() {
  return (
    <div className="py-2 space-y-1">
      <NavItem icon="inbox" label="All" isActive badge={5} />
      <NavItem icon="at" label="Mentions" badge={2} />
      <NavItem icon="user" label="Assigned to me" badge={3} />
      <NavItem icon="eye" label="Following" />
      <div className="h-px bg-[var(--border-subtle)] mx-2 my-3" />
      <NavItem icon="archive" label="Archive" />
    </div>
  );
}

// ============================================
// AGENTS Sidebar
// ============================================
function AgentsSidebar() {
  return (
    <div className="py-2">
      <div className="px-2 py-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2">Active Agents</div>
        <AgentItem name="Dependency Analyzer" status="active" description="Analyzing cross-team dependencies" />
        <AgentItem name="Risk Detector" status="active" description="Monitoring blocked tasks" />
        <AgentItem name="Schedule Optimizer" status="idle" description="Ready to optimize" />
      </div>

      <div className="h-px bg-[var(--border-subtle)] mx-2 my-3" />

      <div className="px-2 py-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2">Recent Insights</div>
        <div className="space-y-2">
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="text-xs font-medium text-red-400">Critical Path Alert</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-1">
              6 tasks blocked by Q4 settlement delay
            </div>
          </div>
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="text-xs font-medium text-yellow-400">Hidden Dependency</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-1">
              QA testing depends on infra completion
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// INSIGHTS Sidebar
// ============================================
function InsightsSidebar() {
  return (
    <div className="py-2 space-y-1">
      <NavItem icon="chart" label="Dashboard" isActive />
      <NavItem icon="link" label="Dependencies" badge={12} />
      <NavItem icon="alert" label="Risks" badge={3} badgeColor="red" />
      <NavItem icon="clock" label="Timeline" />
      <NavItem icon="users" label="Workload" />
    </div>
  );
}

// ============================================
// TEAM Sidebar
// ============================================
function TeamSidebar({ company }: { company: CompanyWithHierarchy }) {
  const allMembers = company.departments?.flatMap(d => d.teams.flatMap(t => t.members)) || [];

  return (
    <div className="py-2">
      <div className="px-2 py-2">
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-2">
          Members ({allMembers.length})
        </div>
        {allMembers.slice(0, 8).map((member) => (
          <div key={member.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium">
              {member.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--text-primary)] truncate">{member.name}</div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">{member.role}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// SETTINGS Sidebar
// ============================================
function SettingsSidebar() {
  return (
    <div className="py-2 space-y-1">
      <NavItem icon="user" label="Profile" isActive />
      <NavItem icon="bell" label="Notifications" />
      <NavItem icon="palette" label="Appearance" />
      <NavItem icon="link" label="Integrations" />
      <NavItem icon="lock" label="Privacy" />
      <div className="h-px bg-[var(--border-subtle)] mx-2 my-3" />
      <NavItem icon="building" label="Organization" />
      <NavItem icon="credit-card" label="Billing" />
    </div>
  );
}

// ============================================
// Agent Item
// ============================================
function AgentItem({ name, status, description }: { name: string; status: 'active' | 'idle' | 'error'; description: string }) {
  return (
    <div className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-[var(--bg-hover)] cursor-pointer">
      <div className={`w-2 h-2 rounded-full mt-1.5 ${
        status === 'active' ? 'bg-[var(--status-success)] pulse-dot' :
        status === 'error' ? 'bg-[var(--status-error)]' :
        'bg-[var(--text-muted)]'
      }`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--text-primary)]">{name}</div>
        <div className="text-[10px] text-[var(--text-muted)] truncate">{description}</div>
      </div>
    </div>
  );
}

// ============================================
// Nav Item
// ============================================
interface NavItemProps {
  icon: string;
  label: string;
  badge?: number;
  badgeColor?: 'blue' | 'red' | 'yellow' | 'green';
  isActive?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, badge, badgeColor = 'blue', isActive, onClick }: NavItemProps) {
  const iconMap: Record<string, React.ReactNode> = {
    home: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    chart: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    clock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    list: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
    alert: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    play: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    circle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>,
    check: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
    inbox: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
    at: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>,
    user: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    eye: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    archive: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>,
    link: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    users: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    bell: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    palette: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>,
    lock: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    building: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>,
    'credit-card': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  };

  const badgeColors = {
    blue: 'bg-blue-500/20 text-blue-400',
    red: 'bg-red-500/20 text-red-400',
    yellow: 'bg-yellow-500/20 text-yellow-400',
    green: 'bg-green-500/20 text-green-400',
  };

  return (
    <div
      className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
        isActive
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
      onClick={onClick}
    >
      <span className="w-4 h-4 flex items-center justify-center">{iconMap[icon]}</span>
      <span className="flex-1 text-sm">{label}</span>
      {badge !== undefined && (
        <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded-full ${badgeColors[badgeColor]}`}>
          {badge}
        </span>
      )}
    </div>
  );
}
