// ============================================
// Alcon Workspace Data Models
// ============================================

// Base entity with common fields
export interface BaseEntity {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Organization Hierarchy
// ============================================

// Level 1: Company
export interface Company extends BaseEntity {
  type: 'company';
  logo?: string;
  industry?: string;
  departments: Department[];
  members: Member[];
}

// Level 2: Department (Division/Unit)
export interface Department extends BaseEntity {
  type: 'department';
  companyId: string;
  teams: Team[];
  color?: string;
}

// Level 3: Team
export interface Team extends BaseEntity {
  type: 'team';
  departmentId: string;
  companyId: string;
  projects: Project[];
  members: TeamMember[];
  icon?: string;
  color?: string;
}

// Level 4: Project
export interface Project extends BaseEntity {
  type: 'project';
  teamIds: string[]; // Multi-homing support
  companyId: string;
  sections: Section[];
  status: ProjectStatus;
  color?: string;
  icon?: string;
  startDate?: Date;
  endDate?: Date;
  progress?: number; // 0-100
}

export type ProjectStatus = 'planning' | 'active' | 'on-hold' | 'completed' | 'archived';

// Level 5: Section (Phase)
export interface Section extends BaseEntity {
  type: 'section';
  projectId: string;
  tasks: Task[];
  order: number;
  collapsed?: boolean;
}

// Level 6: Task
export interface Task extends BaseEntity {
  type: 'task';
  sectionId: string;
  projectId: string;
  subtasks: Subtask[];
  assignee?: Member;
  dueDate?: Date;
  startDate?: Date;
  status: TaskStatus;
  priority: TaskPriority;
  tags?: Tag[];
  dependencies?: string[]; // Task IDs
  comments?: Comment[];
  attachments?: Attachment[];
  estimatedHours?: number;
  actualHours?: number;
  order: number;
}

// Level 7: Subtask
export interface Subtask extends BaseEntity {
  type: 'subtask';
  taskId: string;
  assignee?: Member;
  dueDate?: Date;
  status: TaskStatus;
  order: number;
}

export type TaskStatus = 'not-started' | 'in-progress' | 'in-review' | 'blocked' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

// ============================================
// Supporting Types
// ============================================

export interface Member {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  avatarColor?: string;
  role: MemberRole;
  title?: string; // Job title
}

export interface TeamMember {
  memberId: string;
  role: TeamRole;
  joinedAt: Date;
}

export type MemberRole = 'owner' | 'admin' | 'member' | 'guest';
export type TeamRole = 'lead' | 'member';

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface Comment {
  id: string;
  authorId: string;
  content: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedBy: string;
  uploadedAt: Date;
}

// ============================================
// Navigation State
// ============================================

export interface NavigationState {
  activeCompanyId: string | null;
  activeDepartmentId: string | null;
  activeTeamId: string | null;
  activeProjectId: string | null;
  activeSectionId: string | null;
  activeTaskId: string | null;
}

// ============================================
// View Types
// ============================================

export type ViewType = 'list' | 'board' | 'timeline' | 'calendar' | 'gantt';

export interface ViewConfig {
  type: ViewType;
  groupBy?: 'section' | 'assignee' | 'status' | 'priority' | 'dueDate';
  sortBy?: 'name' | 'dueDate' | 'priority' | 'status' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  filters?: ViewFilter[];
}

export interface ViewFilter {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'in';
  value: unknown;
}
