'use client';

import { useState, useEffect, useRef } from 'react';
import type { CompanyWithHierarchy, CompanyWithUnits, OrganizationUnitWithChildren, TeamWithProjects, ProjectWithSections, SectionWithTasks, DepartmentWithTeams } from '@/hooks/useSupabase';
import { createOrganizationUnit, moveDepartmentToParent, updateDepartment, updateTeam, updateProject } from '@/hooks/useSupabase';

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
  companyWithUnits?: CompanyWithUnits | null;
  onRefresh?: () => void;
}

export function Sidebar({ activeActivity, navigation, onNavigate, company, companyWithUnits, onRefresh }: SidebarProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Quick create state
  const [isCreatingUnit, setIsCreatingUnit] = useState<'folder' | 'execute' | null>(null);
  const [newUnitName, setNewUnitName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Handle quick create organization unit
  const handleQuickCreate = async (type: 'folder' | 'execute') => {
    if (!newUnitName.trim() || !company) return;
    setIsLoading(true);
    try {
      await createOrganizationUnit({
        name: newUnitName.trim(),
        type,
        company_id: company.id,
        parent_id: null,
      });
      setNewUnitName('');
      setIsCreatingUnit(null);
      onRefresh?.();
    } catch (e) {
      console.error('Failed to create unit:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (company?.departments && company.departments.length > 0) {
      // Expand all departments by default (including nested ones)
      const collectAllDeptIds = (depts: DepartmentWithTeams[]): string[] => {
        let ids: string[] = [];
        for (const dept of depts) {
          ids.push(dept.id);
          if (dept.children && dept.children.length > 0) {
            ids = ids.concat(collectAllDeptIds(dept.children));
          }
        }
        return ids;
      };
      const allDeptIds = collectAllDeptIds(company.departments);
      setExpandedSections(new Set(allDeptIds));
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
    <div className="h-full w-[var(--sidebar-width)] bg-[var(--bg-surface)] border-r border-[var(--border-default)] flex flex-col">
      {/* Sidebar Header */}
      <div className="h-11 flex items-center justify-between px-3 border-b border-[var(--border-default)] group/header">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-5 h-5 rounded bg-[var(--bg-subtle)] border border-[var(--border-default)] flex items-center justify-center text-[10px] font-medium text-[var(--text-secondary)] flex-shrink-0">
            {company.name.charAt(0)}
          </div>
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">{company.name}</span>
        </div>
        {/* VSCode-style action buttons */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover/header:opacity-100 transition-opacity">
          {/* New Folder */}
          <button
            onClick={() => setIsCreatingUnit('folder')}
            className="w-6 h-6 flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] rounded transition-colors"
            title="New Folder"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
          {/* New Execute Unit */}
          <button
            onClick={() => setIsCreatingUnit('execute')}
            className="w-6 h-6 flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] rounded transition-colors"
            title="New Execute Unit (Team)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" />
              <path d="M2 17L12 22L22 17" />
              <path d="M2 12L12 17L22 12" />
            </svg>
          </button>
          {/* Menu */}
          <button className="w-6 h-6 flex items-center justify-center text-[var(--text-faint)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] rounded transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Quick Create Input */}
      {isCreatingUnit && (
        <div className="px-2 py-2 border-b border-[var(--border-default)] bg-[var(--bg-muted)]">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded flex items-center justify-center bg-[var(--bg-subtle)]">
              {isCreatingUnit === 'folder' ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--text-muted)]">
                  <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-blue-400">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" />
                  <path d="M2 17L12 22L22 17" />
                  <path d="M2 12L12 17L22 12" />
                </svg>
              )}
            </div>
            <input
              type="text"
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleQuickCreate(isCreatingUnit);
                if (e.key === 'Escape') {
                  setIsCreatingUnit(null);
                  setNewUnitName('');
                }
              }}
              placeholder={isCreatingUnit === 'folder' ? 'Folder name...' : 'Team name...'}
              className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded px-2 py-1 text-xs text-[var(--text-primary)] placeholder-[var(--text-faint)] focus:outline-none focus:border-[var(--text-muted)]"
              autoFocus
              disabled={isLoading}
            />
            <button
              onClick={() => handleQuickCreate(isCreatingUnit)}
              disabled={!newUnitName.trim() || isLoading}
              className="w-6 h-6 flex items-center justify-center text-green-400 hover:text-green-300 hover:bg-[var(--bg-subtle)] rounded transition-colors disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
            <button
              onClick={() => {
                setIsCreatingUnit(null);
                setNewUnitName('');
              }}
              className="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] rounded transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Sidebar Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {activeActivity === 'home' && <HomeSidebar company={company} navigation={navigation} onNavigate={onNavigate} />}
        {activeActivity === 'projects' && (
          <HierarchySidebar
            company={company}
            navigation={navigation}
            onNavigate={onNavigate}
            expandedSections={expandedSections}
            toggleSection={toggleSection}
            onRefresh={onRefresh}
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
  // Recursively collect all projects from nested departments
  const collectProjects = (depts: DepartmentWithTeams[]): ProjectWithSections[] => {
    let projects: ProjectWithSections[] = [];
    for (const dept of depts) {
      for (const team of dept.teams || []) {
        projects = projects.concat(team.projects || []);
      }
      if (dept.children && dept.children.length > 0) {
        projects = projects.concat(collectProjects(dept.children));
      }
    }
    return projects;
  };
  const allProjects = collectProjects(company.departments || []);

  return (
    <div className="space-y-0.5">
      <NavItem icon="home" label="Overview" isActive />
      <NavItem icon="calendar" label="Calendar" />
      <NavItem icon="chart" label="My Progress" />
      <NavItem icon="clock" label="Upcoming" />

      <div className="h-px bg-[var(--border-default)] mx-2 my-2" />

      <div className="px-2 py-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-medium mb-1">Recent</div>
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
  onRefresh?: () => void;
}

function HierarchySidebar({ company, navigation, onNavigate, expandedSections, toggleSection, onRefresh }: HierarchySidebarProps) {
  const [draggedDeptId, setDraggedDeptId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, deptId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', deptId);
    setDraggedDeptId(deptId);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedDeptId !== targetId) {
      setDropTargetId(targetId);
    }
  };

  const handleDragLeave = () => {
    setDropTargetId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetParentId: string | null) => {
    e.preventDefault();
    const deptId = e.dataTransfer.getData('text/plain');
    setDraggedDeptId(null);
    setDropTargetId(null);

    if (deptId && deptId !== targetParentId) {
      try {
        await moveDepartmentToParent(deptId, targetParentId);
        onRefresh?.();
      } catch (err) {
        console.error('Failed to move department:', err);
        alert((err as Error).message);
      }
    }
  };

  const handleDragEnd = () => {
    setDraggedDeptId(null);
    setDropTargetId(null);
  };

  return (
    <div
      onDragOver={(e) => handleDragOver(e, null)}
      onDrop={(e) => handleDrop(e, null)}
    >
      {/* Drop zone for root level */}
      {dropTargetId === null && draggedDeptId && (
        <div className="h-1 bg-blue-500 rounded mx-2 mb-1" />
      )}

      {company.departments?.map((department) => (
        <DepartmentTreeItem
          key={department.id}
          department={department}
          navigation={navigation}
          onNavigate={onNavigate}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          depth={0}
          draggedDeptId={draggedDeptId}
          dropTargetId={dropTargetId}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

// ============================================
// Department Tree Item (Recursive)
// ============================================
interface DepartmentTreeItemProps {
  department: DepartmentWithTeams;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  depth: number;
  draggedDeptId: string | null;
  dropTargetId: string | null;
  onDragStart: (e: React.DragEvent, deptId: string) => void;
  onDragOver: (e: React.DragEvent, targetId: string | null) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, targetParentId: string | null) => void;
  onDragEnd: () => void;
  onRefresh?: () => void;
}

function DepartmentTreeItem({
  department,
  navigation,
  onNavigate,
  expandedSections,
  toggleSection,
  depth,
  draggedDeptId,
  dropTargetId,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onRefresh,
}: DepartmentTreeItemProps) {
  const isExpanded = expandedSections.has(department.id);
  const isDragging = draggedDeptId === department.id;
  const isDropTarget = dropTargetId === department.id;
  const hasChildren = (department.children && department.children.length > 0) || (department.teams && department.teams.length > 0);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(department.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== department.name) {
      try {
        await updateDepartment(department.id, { name: newName.trim() });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to rename department:', err);
      }
    }
    setIsRenaming(false);
    setContextMenu(null);
  };

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  return (
    <div
      className={`${isDragging ? 'opacity-50' : ''}`}
      style={{ paddingLeft: depth > 0 ? '0' : undefined }}
    >
      {/* Drop indicator */}
      {isDropTarget && (
        <div className="h-1 bg-blue-500 rounded mx-2 mb-0.5" />
      )}

      <div
        draggable
        onDragStart={(e) => onDragStart(e, department.id)}
        onDragOver={(e) => {
          e.stopPropagation();
          onDragOver(e, department.id);
        }}
        onDragLeave={onDragLeave}
        onDrop={(e) => {
          e.stopPropagation();
          onDrop(e, department.id);
        }}
        onDragEnd={onDragEnd}
        className={`flex items-center gap-0.5 px-2 py-1 rounded cursor-pointer transition-colors group hover:bg-[var(--bg-muted)] ${
          isDropTarget ? 'bg-blue-500/20' : ''
        }`}
      >
        {/* Expand/Collapse Arrow */}
        <button
          className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-[var(--text-muted)]"
          onClick={(e) => {
            e.stopPropagation();
            toggleSection(department.id);
          }}
        >
          {hasChildren ? (
            <span className={`text-sm font-medium transition-transform inline-block ${isExpanded ? 'rotate-90' : ''}`}>&gt;</span>
          ) : (
            <span className="w-3" />
          )}
        </button>

        {/* Folder Icon */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={isExpanded ? 'none' : 'currentColor'}
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--text-secondary)]"
        >
          {isExpanded ? (
            <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5z" />
          ) : (
            <path d="M3 7V17C3 18.1046 3.89543 19 5 19H19C20.1046 19 21 18.1046 21 17V9C21 7.89543 20.1046 7 19 7H13L11 5H5C3.89543 5 3 5.89543 3 7Z" />
          )}
        </svg>

        {/* Department Name */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setNewName(department.name);
                setIsRenaming(false);
              }
            }}
            className="text-xs font-medium text-[var(--text-primary)] flex-1 bg-[var(--bg-overlay)] border border-[var(--border-strong)] rounded px-1 py-0.5 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-xs font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] flex-1 truncate cursor-pointer"
            onClick={() => {
              toggleSection(department.id);
              // Navigate to this department
              onNavigate({ departmentId: department.id, teamId: null, projectId: null, sectionId: null });
            }}
            onContextMenu={handleContextMenu}
          >
            {department.name}
          </span>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
            onClick={() => {
              setIsRenaming(true);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className="ml-4 border-l border-[var(--border-default)]">
          {/* Child Departments */}
          {department.children?.map((child) => (
            <DepartmentTreeItem
              key={child.id}
              department={child}
              navigation={navigation}
              onNavigate={onNavigate}
              expandedSections={expandedSections}
              toggleSection={toggleSection}
              depth={depth + 1}
              draggedDeptId={draggedDeptId}
              dropTargetId={dropTargetId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
              onRefresh={onRefresh}
            />
          ))}

          {/* Teams */}
          {department.teams?.map((team) => (
            <div key={team.id} className="pl-2">
              <TeamItem
                team={team}
                isExpanded={expandedSections.has(team.id)}
                isSelected={navigation.teamId === team.id && !navigation.projectId}
                onToggle={() => toggleSection(team.id)}
                onClick={() => onNavigate({ departmentId: department.id, teamId: team.id, projectId: null, sectionId: null })}
                onRefresh={onRefresh}
              />

              {expandedSections.has(team.id) && (
                <div className="ml-4">
                  {team.projects?.map((project) => (
                    <ProjectTreeItem
                      key={project.id}
                      project={project}
                      navigation={navigation}
                      onNavigate={onNavigate}
                      expandedSections={expandedSections}
                      toggleSection={toggleSection}
                      onRefresh={onRefresh}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Project Tree Item
// ============================================
function ProjectTreeItem({ project, navigation, onNavigate, expandedSections, toggleSection, onRefresh }: {
  project: ProjectWithSections;
  navigation: NavigationState;
  onNavigate: (nav: Partial<NavigationState>) => void;
  expandedSections: Set<string>;
  toggleSection: (section: string) => void;
  onRefresh?: () => void;
}) {
  const isExpanded = expandedSections.has(project.id);
  const isSelected = navigation.projectId === project.id && !navigation.sectionId;

  const allTasks = project.sections?.flatMap(s => s.tasks) || [];
  const doneTasks = allTasks.filter(t => t.status === 'done').length;
  const progress = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(project.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== project.name) {
      try {
        await updateProject(project.id, { name: newName.trim() });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to rename project:', err);
      }
    }
    setIsRenaming(false);
    setContextMenu(null);
  };

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  return (
    <>
      <div>
        <div
          className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors group ${
            isSelected
              ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
          }`}
          onContextMenu={handleContextMenu}
        >
          <button
            className="w-3 h-3 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); toggleSection(project.id); }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="currentColor"
              className={`text-[var(--text-faint)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
          <div
            className="flex-1 flex items-center gap-2"
            onClick={() => onNavigate({ projectId: project.id, sectionId: null })}
          >
            {isRenaming ? (
              <input
                ref={inputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={handleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setNewName(project.name);
                    setIsRenaming(false);
                  }
                }}
                className="text-xs w-full bg-[var(--bg-overlay)] border border-[var(--border-strong)] rounded px-1 py-0.5 focus:outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="text-xs truncate">{project.name}</span>
            )}
          </div>
          <div className="w-6 h-1 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--text-muted)] rounded-full" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {isExpanded && project.sections && (
          <div className="ml-5 mt-0.5 border-l border-[var(--border-default)] pl-2">
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

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
            onClick={() => {
              setIsRenaming(true);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
        </div>
      )}
    </>
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
      className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-secondary)]'
      }`}
      onClick={onClick}
    >
      <span className="text-[11px] truncate flex-1">{section.name}</span>
      {blockedCount > 0 && (
        <span className="text-[9px] px-1 rounded bg-[var(--status-error)]/15 text-[var(--status-error)]">
          {blockedCount}
        </span>
      )}
      <span className="text-[10px] text-[var(--text-faint)]">{taskCount}</span>
    </div>
  );
}

// ============================================
// Team Item
// ============================================
function TeamItem({ team, isExpanded, isSelected, onToggle, onClick, onRefresh }: {
  team: TeamWithProjects;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onClick: () => void;
  onRefresh?: () => void;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(team.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleRename = async () => {
    if (newName.trim() && newName !== team.name) {
      try {
        await updateTeam(team.id, { name: newName.trim() });
        onRefresh?.();
      } catch (err) {
        console.error('Failed to rename team:', err);
      }
    }
    setIsRenaming(false);
    setContextMenu(null);
  };

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  return (
    <>
      <div
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors group ${
          isSelected
            ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
        }`}
        onContextMenu={handleContextMenu}
      >
        <button
          className="w-3 h-3 flex items-center justify-center"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={`text-[var(--text-faint)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <div className="flex-1" onClick={onClick}>
          {isRenaming ? (
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') {
                  setNewName(team.name);
                  setIsRenaming(false);
                }
              }}
              className="text-xs w-full bg-[var(--bg-overlay)] border border-[var(--border-strong)] rounded px-1 py-0.5 focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs truncate">{team.name}</span>
          )}
        </div>
        <span className="text-[10px] text-[var(--text-faint)]">{team.members?.length || 0}</span>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-md shadow-lg py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full px-3 py-1.5 text-xs text-left text-[var(--text-primary)] hover:bg-[var(--bg-muted)]"
            onClick={() => {
              setIsRenaming(true);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
        </div>
      )}
    </>
  );
}

// ============================================
// Project Item
// ============================================
function ProjectItem({ project, isSelected, onClick }: { project: ProjectWithSections; isSelected: boolean; onClick: () => void }) {
  const allTasks = project.sections?.flatMap(s => s.tasks) || [];
  const blockedTasks = allTasks.filter(t => t.status === 'blocked').length;

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isSelected
          ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
      }`}
      onClick={onClick}
    >
      <span className="flex-1 text-xs truncate">{project.name}</span>
      {blockedTasks > 0 && (
        <span className="text-[9px] px-1 rounded bg-[var(--status-error)]/15 text-[var(--status-error)]">
          {blockedTasks}
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
    <div className="space-y-0.5">
      <NavItem icon="list" label="All Tasks" badge={allTasks.length} isActive />
      <NavItem icon="alert" label="Blocked" badge={blockedTasks} />
      <NavItem icon="play" label="In Progress" badge={inProgressTasks} />
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
    <div className="space-y-0.5">
      <NavItem icon="inbox" label="All" isActive badge={5} />
      <NavItem icon="at" label="Mentions" badge={2} />
      <NavItem icon="user" label="Assigned to me" badge={3} />
      <NavItem icon="eye" label="Following" />
      <div className="h-px bg-[var(--border-default)] mx-2 my-2" />
      <NavItem icon="archive" label="Archive" />
    </div>
  );
}

// ============================================
// AGENTS Sidebar
// ============================================
function AgentsSidebar() {
  return (
    <div>
      <div className="px-2 py-1">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-medium mb-1">Active</div>
        <AgentItem name="Dependency Analyzer" status="active" />
        <AgentItem name="Risk Detector" status="active" />
        <AgentItem name="Schedule Optimizer" status="idle" />
      </div>
    </div>
  );
}

// ============================================
// INSIGHTS Sidebar
// ============================================
function InsightsSidebar() {
  return (
    <div className="space-y-0.5">
      <NavItem icon="chart" label="Dashboard" isActive />
      <NavItem icon="link" label="Dependencies" badge={12} />
      <NavItem icon="alert" label="Risks" badge={3} />
      <NavItem icon="clock" label="Timeline" />
    </div>
  );
}

// ============================================
// TEAM Sidebar
// ============================================
function TeamSidebar({ company }: { company: CompanyWithHierarchy }) {
  const allMembers = company.departments?.flatMap(d => d.teams.flatMap(t => t.members)) || [];

  return (
    <div className="px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-medium mb-1">
        Members ({allMembers.length})
      </div>
      {allMembers.slice(0, 8).map((member) => (
        <div key={member.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-muted)] cursor-pointer transition-colors">
          <div className="w-5 h-5 rounded bg-[var(--bg-subtle)] border border-[var(--border-default)] flex items-center justify-center text-[9px] font-medium text-[var(--text-muted)]">
            {member.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[var(--text-primary)] truncate">{member.name}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================
// SETTINGS Sidebar
// ============================================
function SettingsSidebar() {
  return (
    <div className="space-y-0.5">
      <NavItem icon="user" label="Profile" isActive />
      <NavItem icon="bell" label="Notifications" />
      <NavItem icon="palette" label="Appearance" />
      <NavItem icon="lock" label="Privacy" />
      <div className="h-px bg-[var(--border-default)] mx-2 my-2" />
      <NavItem icon="building" label="Organization" />
    </div>
  );
}

// ============================================
// Agent Item
// ============================================
function AgentItem({ name, status }: { name: string; status: 'active' | 'idle' | 'error' }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-muted)] cursor-pointer transition-colors">
      <div
        className="w-1.5 h-1.5 rounded-full"
        style={{
          backgroundColor: status === 'active' ? 'var(--status-success)' : status === 'error' ? 'var(--status-error)' : 'var(--text-faint)'
        }}
      />
      <span className="text-xs text-[var(--text-primary)]">{name}</span>
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
  isActive?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, badge, isActive, onClick }: NavItemProps) {
  const iconMap: Record<string, React.ReactNode> = {
    home: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    calendar: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    chart: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    list: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
    alert: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
    play: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>,
    circle: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/></svg>,
    check: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="20 6 9 17 4 12"/></svg>,
    inbox: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
    at: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/></svg>,
    user: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
    eye: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    archive: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/></svg>,
    link: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
    bell: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
    palette: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.555C21.965 6.012 17.461 2 12 2z"/></svg>,
    lock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
    building: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/></svg>,
  };

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        isActive
          ? 'bg-[var(--bg-muted)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]'
      }`}
      onClick={onClick}
    >
      <span className="w-4 h-4 flex items-center justify-center text-[var(--text-muted)]">{iconMap[icon]}</span>
      <span className="flex-1 text-xs">{label}</span>
      {badge !== undefined && (
        <span className="text-[10px] text-[var(--text-faint)]">{badge}</span>
      )}
    </div>
  );
}
