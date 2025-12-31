export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// =====================================================
// 3-Layer Structure: Objects → Elements → Subelements
// =====================================================

// AlconObject - 最大単位（自己生成可能）
export interface AlconObject {
  id: string
  parent_id: string | null
  name: string
  description: string | null
  color: string | null
  order_index: number | null
  created_at: string | null
  updated_at: string | null
}

export interface AlconObjectInsert {
  id?: string
  parent_id?: string | null
  name: string
  description?: string | null
  color?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface AlconObjectUpdate {
  id?: string
  parent_id?: string | null
  name?: string
  description?: string | null
  color?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

// Element - 最小作業単位（セクションでグルーピング可能）
export interface Element {
  id: string
  object_id: string
  title: string
  description: string | null
  section: string | null  // セクション名（グルーピング用）
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | null
  priority: 'low' | 'medium' | 'high' | 'urgent' | null
  due_date: string | null
  estimated_hours: number | null
  actual_hours: number | null
  order_index: number | null
  created_at: string | null
  updated_at: string | null
}

export interface ElementInsert {
  id?: string
  object_id: string
  title: string
  description?: string | null
  section?: string | null
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | null
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  due_date?: string | null
  estimated_hours?: number | null
  actual_hours?: number | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ElementUpdate {
  id?: string
  object_id?: string
  title?: string
  description?: string | null
  section?: string | null
  status?: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | null
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  due_date?: string | null
  estimated_hours?: number | null
  actual_hours?: number | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

// Subelement - Elementの構成要素
export interface Subelement {
  id: string
  element_id: string
  title: string
  is_completed: boolean | null
  order_index: number | null
  created_at: string | null
  updated_at: string | null
}

export interface SubelementInsert {
  id?: string
  element_id: string
  title: string
  is_completed?: boolean | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface SubelementUpdate {
  id?: string
  element_id?: string
  title?: string
  is_completed?: boolean | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

// Worker - 人間またはAIエージェント
export interface Worker {
  id: string
  object_id: string | null
  type: 'human' | 'ai_agent'
  name: string
  role: string | null
  email: string | null
  avatar_url: string | null
  ai_model: string | null
  ai_config: Json | null
  status: 'active' | 'inactive' | 'busy' | null
  created_at: string | null
  updated_at: string | null
}

export interface WorkerInsert {
  id?: string
  object_id?: string | null
  type: 'human' | 'ai_agent'
  name: string
  role?: string | null
  email?: string | null
  avatar_url?: string | null
  ai_model?: string | null
  ai_config?: Json | null
  status?: 'active' | 'inactive' | 'busy' | null
  created_at?: string | null
  updated_at?: string | null
}

export interface WorkerUpdate {
  id?: string
  object_id?: string | null
  type?: 'human' | 'ai_agent'
  name?: string
  role?: string | null
  email?: string | null
  avatar_url?: string | null
  ai_model?: string | null
  ai_config?: Json | null
  status?: 'active' | 'inactive' | 'busy' | null
  created_at?: string | null
  updated_at?: string | null
}

// Element Assignee - 担当者
export interface ElementAssignee {
  id: string
  element_id: string
  worker_id: string
  role: 'assignee' | 'reviewer' | 'collaborator' | null
  assigned_at: string | null
}

export interface ElementAssigneeInsert {
  id?: string
  element_id: string
  worker_id: string
  role?: 'assignee' | 'reviewer' | 'collaborator' | null
  assigned_at?: string | null
}

export interface ElementAssigneeUpdate {
  id?: string
  element_id?: string
  worker_id?: string
  role?: 'assignee' | 'reviewer' | 'collaborator' | null
  assigned_at?: string | null
}

// =====================================================
// Extended Types with Relations
// =====================================================

// AlconObject with children (recursive) and elements
export interface AlconObjectWithChildren extends AlconObject {
  children?: AlconObjectWithChildren[]
  elements?: ElementWithDetails[]
}

// Element with all details
export interface ElementWithDetails extends Element {
  subelements?: Subelement[]
  assignees?: ElementAssigneeWithWorker[]
}

// Element assignee with worker info
export interface ElementAssigneeWithWorker extends ElementAssignee {
  worker?: Worker
}

// Elements grouped by section
export interface ElementsBySection {
  section: string | null  // null = no section
  elements: ElementWithDetails[]
}

// =====================================================
// Supabase Database Type
// =====================================================

export interface Database {
  public: {
    Tables: {
      objects: {
        Row: AlconObject
        Insert: AlconObjectInsert
        Update: AlconObjectUpdate
      }
      elements: {
        Row: Element
        Insert: ElementInsert
        Update: ElementUpdate
      }
      subelements: {
        Row: Subelement
        Insert: SubelementInsert
        Update: SubelementUpdate
      }
      workers: {
        Row: Worker
        Insert: WorkerInsert
        Update: WorkerUpdate
      }
      element_assignees: {
        Row: ElementAssignee
        Insert: ElementAssigneeInsert
        Update: ElementAssigneeUpdate
      }
    }
  }
}
