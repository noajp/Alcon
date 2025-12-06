'use client';

import { useState } from 'react';
import { sampleData, getMemberById } from '../../data/alconSampleData';
import type { Team, Project, Section } from '../../types/workspace';

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
}

export function Sidebar({ activeActivity, navigation, onNavigate }: SidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['dept-1', 'team-dev-1', 'team-mkt-1'])
  );

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

  const company = sampleData.company;

  return (
    <div className="h-full w-[var(--sidebar-width)] bg-[var(--bg-secondary)] border-r border-[var(--border-color)] flex flex-col">
      {/* Sidebar Header - Company Name */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-br from-[#FF6B4A] to-[#E8698D] flex items-center justify-center text-white text-xs font-bold">
            A
          </div>
          <span className="font-medium text-[var(--text-primary)] text-sm">{company.name}</span>
        </div>
        <button className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded">
          ⚙
        </button>
      </div>

      {/* Sidebar Content */}
      <div className="flex-1 overflow-y-auto">
        {/* HOME Activity */}
        {activeActivity === 'home' && <HomeSidebar navigation={navigation} onNavigate={onNavigate} />}

        {/* PROJECTS Activity - Hierarchy View */}
        {activeActivity === 'projects' && (
          <HierarchySidebar
            navigation={navigation}
            onNavigate={onNavigate}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
          />
        )}

        {/* TASKS Activity */}
        {activeActivity === 'tasks' && <TasksSidebar navigation={navigation} onNavigate={onNavigate} />}

        {/* INBOX Activity */}
        {activeActivity === 'inbox' && <InboxSidebar />}

        {/* AGENTS Activity */}
        {activeActivity === 'agents' && <AgentsSidebar />}

        {/* VERSION Activity */}
        {activeActivity === 'version' && <VersionSidebar />}

        {/* TEAM Activity */}
        {activeActivity === 'team' && <TeamSidebar />}

        {/* SETTINGS Activity */}
        {activeActivity === 'settings' && <SettingsSidebar />}
      </div>
    </div>
  );
}

// ============================================
// HOME Sidebar
// ============================================
interface HomeSidebarProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
}

function HomeSidebar({ navigation, onNavigate }: HomeSidebarProps) {
  return (
    <div className="py-2">
      <NavItem icon="📊" label="Overview" isActive />
      <NavItem icon="📅" label="Calendar" />
      <NavItem icon="📈" label="My Progress" />
      <NavItem icon="⏰" label="Upcoming" />
      <NavItem icon="🎯" label="Goals" />

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <div className="px-4 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Recent Projects</div>
        {sampleData.projects.slice(0, 3).map((project) => (
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
// HIERARCHY Sidebar - Company → Department → Team → Project
// ============================================
interface HierarchySidebarProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
}

function HierarchySidebar({ navigation, onNavigate, expandedSections, toggleSection }: HierarchySidebarProps) {
  const { company } = sampleData;

  return (
    <div className="py-2">
      {/* Departments */}
      {company.departments.map((department) => (
        <div key={department.id}>
          {/* Department Header */}
          <SectionHeader
            title={department.name}
            icon="🏢"
            isExpanded={expandedSections.has(department.id)}
            onToggle={() => toggleSection(department.id)}
            depth={0}
          />

          {expandedSections.has(department.id) && (
            <div>
              {/* Teams in Department */}
              {department.teams.map((team) => (
                <div key={team.id}>
                  {/* Team Header */}
                  <TeamItem
                    team={team}
                    isExpanded={expandedSections.has(team.id)}
                    isSelected={navigation.teamId === team.id && !navigation.projectId}
                    onToggle={() => toggleSection(team.id)}
                    onClick={() => onNavigate({ teamId: team.id, projectId: null, sectionId: null })}
                    depth={1}
                  />

                  {expandedSections.has(team.id) && (
                    <div>
                      {/* Projects in Team */}
                      {team.projects.map((project) => (
                        <ProjectTreeItem
                          key={project.id}
                          project={project}
                          navigation={navigation}
                          onNavigate={onNavigate}
                          expandedSections={expandedSections}
                          toggleSection={toggleSection}
                          depth={2}
                        />
                      ))}
                      {/* Add Project Button */}
                      <div
                        className="flex items-center h-7 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        style={{ paddingLeft: `${2 * 12 + 16}px` }}
                      >
                        <span className="text-xs">+ Add project</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {/* Add Team Button */}
              <div
                className="flex items-center h-7 cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                style={{ paddingLeft: `${1 * 12 + 16}px` }}
              >
                <span className="text-xs">+ Add team</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================
// Project Tree Item with Sections
// ============================================
interface ProjectTreeItemProps {
  project: Project;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  depth: number;
}

function ProjectTreeItem({ project, navigation, onNavigate, expandedSections, toggleSection, depth }: ProjectTreeItemProps) {
  const isExpanded = expandedSections.has(project.id);
  const isSelected = navigation.projectId === project.id && !navigation.sectionId;

  return (
    <div>
      {/* Project Row */}
      <div
        className={`flex items-center h-7 cursor-pointer group ${
          isSelected
            ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        }`}
        style={{ paddingLeft: `${depth * 12 + 16}px` }}
      >
        <button
          className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={(e) => {
            e.stopPropagation();
            toggleSection(project.id);
          }}
        >
          <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        </button>
        <div
          className="flex items-center flex-1 gap-2 ml-1"
          onClick={() => onNavigate({ projectId: project.id, sectionId: null })}
        >
          <div
            className="w-4 h-4 rounded flex items-center justify-center text-[10px] flex-shrink-0"
            style={{ backgroundColor: `${project.color}30`, color: project.color }}
          >
            {project.icon}
          </div>
          <span className="text-sm truncate">{project.name}</span>
        </div>
        {/* Progress indicator */}
        {project.progress !== undefined && (
          <div className="w-8 mr-2">
            <div className="h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${project.progress}%`, backgroundColor: project.color }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Sections */}
      {isExpanded && project.sections && (
        <div>
          {project.sections.map((section) => (
            <SectionItem
              key={section.id}
              section={section}
              isSelected={navigation.sectionId === section.id}
              onClick={() => onNavigate({ projectId: project.id, sectionId: section.id })}
              depth={depth + 1}
              taskCount={section.tasks?.length || 0}
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
interface SectionItemProps {
  section: Section;
  isSelected: boolean;
  onClick: () => void;
  depth: number;
  taskCount: number;
}

function SectionItem({ section, isSelected, onClick, depth, taskCount }: SectionItemProps) {
  return (
    <div
      className={`flex items-center h-7 cursor-pointer ${
        isSelected
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]'
      }`}
      style={{ paddingLeft: `${depth * 12 + 16 + 20}px` }}
      onClick={onClick}
    >
      <span className="text-xs truncate">{section.name}</span>
      {taskCount > 0 && (
        <span className="ml-auto mr-3 text-[10px] text-[var(--text-muted)]">{taskCount}</span>
      )}
    </div>
  );
}

// ============================================
// TASKS Sidebar
// ============================================
interface TasksSidebarProps {
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
}

function TasksSidebar({ navigation, onNavigate }: TasksSidebarProps) {
  const myTasks = sampleData.tasks.filter(t => t.assignee?.id === 'member-1');
  const todayTasks = myTasks.filter(t => {
    if (!t.dueDate) return false;
    const today = new Date();
    return t.dueDate.toDateString() === today.toDateString();
  });
  const upcomingTasks = myTasks.filter(t => {
    if (!t.dueDate) return false;
    const today = new Date();
    return t.dueDate > today && t.status !== 'completed';
  });

  return (
    <div className="py-2">
      <NavItem icon="📋" label="All Tasks" isActive badge={myTasks.length} />
      <NavItem icon="📅" label="Today" badge={todayTasks.length} />
      <NavItem icon="📆" label="Upcoming" badge={upcomingTasks.length} />
      <NavItem icon="✅" label="Completed" />

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <div className="px-4 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">By Project</div>
        {sampleData.projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isSelected={navigation.projectId === project.id}
            onClick={() => onNavigate({ projectId: project.id })}
            compact
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// INBOX Sidebar
// ============================================
function InboxSidebar() {
  return (
    <div className="py-2">
      <NavItem icon="📥" label="All" isActive badge={5} />
      <NavItem icon="📣" label="Mentions" badge={2} />
      <NavItem icon="✅" label="Assigned to me" badge={3} />
      <NavItem icon="👀" label="Following" />

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <NavItem icon="📁" label="Archive" />
    </div>
  );
}

// ============================================
// AGENTS Sidebar
// ============================================
function AgentsSidebar() {
  return (
    <div className="py-2">
      <div className="px-4 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Active Agents</div>
        <AgentItem name="Task Analyzer" status="active" />
        <AgentItem name="Schedule Optimizer" status="active" />
        <AgentItem name="Document Editor" status="idle" />
      </div>

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <div className="px-4 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Pending Actions</div>
        <div className="space-y-2">
          <div className="p-2 rounded bg-[var(--bg-tertiary)] text-sm">
            <div className="text-[var(--text-primary)]">Break down &quot;API設計&quot;</div>
            <div className="text-xs text-[var(--text-muted)]">3 subtasks suggested</div>
          </div>
          <div className="p-2 rounded bg-[var(--bg-tertiary)] text-sm">
            <div className="text-[var(--text-primary)]">スケジュール競合</div>
            <div className="text-xs text-[var(--text-muted)]">Meeting overlap detected</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================
// VERSION Sidebar
// ============================================
function VersionSidebar() {
  return (
    <div className="py-2">
      <NavItem icon="🌿" label="main" isActive />
      <NavItem icon="🔀" label="feature/api-design" />
      <NavItem icon="🔀" label="feature/ui-update" />

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <div className="px-4 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">Recent Changes</div>
        <div className="space-y-1">
          {[
            { version: 'v24', message: 'Task breakdown (AI)', type: 'ai' },
            { version: 'v23', message: 'Updated due dates', type: 'manual' },
            { version: 'v22', message: 'Added dependencies', type: 'manual' },
          ].map((change, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--bg-hover)] cursor-pointer text-sm">
              <span className={`w-2 h-2 rounded-full ${change.type === 'ai' ? 'bg-[var(--accent-primary)]' : 'bg-[var(--status-success)]'}`} />
              <span className="text-[var(--text-muted)]">{change.version}</span>
              <span className="text-[var(--text-primary)] truncate">{change.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================
// TEAM Sidebar
// ============================================
function TeamSidebar() {
  const { company } = sampleData;

  return (
    <div className="py-2">
      {/* All Members */}
      <div className="px-4 py-2">
        <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-2">
          Members ({company.members.length})
        </div>
        {company.members.map((member) => (
          <div key={member.id} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--bg-hover)] cursor-pointer">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
              style={{ backgroundColor: member.avatarColor }}
            >
              {member.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--text-primary)] truncate">{member.name}</div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">{member.title}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <div className="px-4">
        <button className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <span>+</span>
          <span>Invite member</span>
        </button>
      </div>
    </div>
  );
}

// ============================================
// SETTINGS Sidebar
// ============================================
function SettingsSidebar() {
  return (
    <div className="py-2">
      <NavItem icon="👤" label="Profile" isActive />
      <NavItem icon="🔔" label="Notifications" />
      <NavItem icon="🎨" label="Appearance" />
      <NavItem icon="🔗" label="Integrations" />
      <NavItem icon="🔒" label="Privacy" />

      <div className="h-px bg-[var(--border-color)] mx-3 my-2" />

      <NavItem icon="🏢" label="Organization" />
      <NavItem icon="💳" label="Billing" />
    </div>
  );
}

// ============================================
// Shared Components
// ============================================
interface NavItemProps {
  icon: string;
  label: string;
  badge?: number;
  isActive?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, badge, isActive, onClick }: NavItemProps) {
  return (
    <div
      className={`flex items-center h-8 px-4 cursor-pointer ${
        isActive
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
      onClick={onClick}
    >
      <span className="w-6 text-center">{icon}</span>
      <span className="flex-1 text-sm truncate ml-2">{label}</span>
      {badge !== undefined && (
        <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--accent-primary)] text-white">
          {badge}
        </span>
      )}
    </div>
  );
}

interface SectionHeaderProps {
  title: string;
  icon?: string;
  isExpanded: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  depth?: number;
}

function SectionHeader({ title, icon, isExpanded, onToggle, onAdd, depth = 0 }: SectionHeaderProps) {
  return (
    <div
      className="flex items-center justify-between h-8 group hover:bg-[var(--bg-hover)]"
      style={{ paddingLeft: `${depth * 12 + 16}px`, paddingRight: '8px' }}
    >
      <button
        className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        onClick={onToggle}
      >
        <span className={`text-[10px] transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
        {icon && <span>{icon}</span>}
        <span>{title}</span>
      </button>
      {onAdd && (
        <button
          className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded opacity-0 group-hover:opacity-100"
          onClick={onAdd}
        >
          +
        </button>
      )}
    </div>
  );
}

interface TeamItemProps {
  team: Team;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  depth: number;
}

function TeamItem({ team, isExpanded, isSelected, onToggle, onClick, depth }: TeamItemProps) {
  return (
    <div
      className={`flex items-center h-7 cursor-pointer group ${
        isSelected
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      <button
        className="w-4 h-4 flex items-center justify-center text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
      </button>
      <div className="flex items-center flex-1 gap-2 ml-1" onClick={onClick}>
        <span>{team.icon}</span>
        <span className="text-sm truncate">{team.name}</span>
      </div>
      <span className="text-[10px] text-[var(--text-muted)] mr-2">{team.members.length}</span>
    </div>
  );
}

interface ProjectItemProps {
  project: Project;
  isSelected: boolean;
  onClick: () => void;
  compact?: boolean;
}

function ProjectItem({ project, isSelected, onClick, compact }: ProjectItemProps) {
  return (
    <div
      className={`flex items-center ${compact ? 'h-7' : 'h-8'} px-4 cursor-pointer group ${
        isSelected
          ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
      onClick={onClick}
    >
      <div
        className={`${compact ? 'w-4 h-4 text-[10px]' : 'w-5 h-5 text-xs'} rounded flex items-center justify-center flex-shrink-0`}
        style={{ backgroundColor: `${project.color}30`, color: project.color }}
      >
        {project.icon}
      </div>
      <span className="flex-1 text-sm truncate ml-2">{project.name}</span>
      {project.progress !== undefined && !compact && (
        <span className="text-[10px] text-[var(--text-muted)]">{project.progress}%</span>
      )}
    </div>
  );
}

interface AgentItemProps {
  name: string;
  status: 'active' | 'idle' | 'error';
}

function AgentItem({ name, status }: AgentItemProps) {
  return (
    <div className="flex items-center gap-2 p-2 rounded bg-[var(--bg-tertiary)] mb-1">
      <span className={`w-2 h-2 rounded-full ${
        status === 'active' ? 'bg-[var(--status-success)]' :
        status === 'error' ? 'bg-[var(--status-error)]' :
        'bg-[var(--text-muted)]'
      }`} />
      <span className="text-sm text-[var(--text-primary)]">{name}</span>
      <span className="text-xs text-[var(--text-muted)] ml-auto">{status}</span>
    </div>
  );
}
