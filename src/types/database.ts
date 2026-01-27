export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// =====================================================
// 3-Layer Structure: Objects (nestable) → Elements → Subelements
// =====================================================

// AlconObject - 入れ子可能な構造単位
export interface AlconObject {
  id: string
  parent_object_id: string | null  // 入れ子のための親参照
  name: string
  description: string | null
  color: string | null
  order_index: number | null
  created_at: string | null
  updated_at: string | null
}

export interface AlconObjectInsert {
  id?: string
  parent_object_id?: string | null
  name: string
  description?: string | null
  color?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface AlconObjectUpdate {
  id?: string
  parent_object_id?: string | null
  name?: string
  description?: string | null
  color?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
}

// Element - 最小作業単位（セクションでグルーピング可能）
// object_id が null の場合はユーザー直下の個人タスク
export interface Element {
  id: string
  object_id: string | null
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
  object_id?: string | null
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
  object_id?: string | null
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

// Worker - 人間、AIエージェント、またはロボット
export interface Worker {
  id: string
  object_id: string | null
  type: 'human' | 'ai_agent' | 'robot'
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
  type: 'human' | 'ai_agent' | 'robot'
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
  type?: 'human' | 'ai_agent' | 'robot'
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

// Edge Types for Element Dependencies
export type EdgeType = 'spawns' | 'depends_on' | 'merges_into' | 'splits_to' | 'references' | 'cancels'

// Element Edge - 依存関係
export interface ElementEdge {
  id: string
  from_element: string
  to_element: string
  edge_type: EdgeType
  created_at: string | null
  created_by: string | null
}

export interface ElementEdgeInsert {
  id?: string
  from_element: string
  to_element: string
  edge_type: EdgeType
  created_at?: string | null
  created_by?: string | null
}

export interface ElementEdgeUpdate {
  id?: string
  from_element?: string
  to_element?: string
  edge_type?: EdgeType
  created_at?: string | null
  created_by?: string | null
}

// Element Edge with related element info
export interface ElementEdgeWithElement extends ElementEdge {
  related_element?: Element
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
// Object Tabs - Chrome-like tabs for each Object
// =====================================================

export type ObjectTabType = 'summary' | 'elements' | 'note' | 'gantt' | 'calendar' | 'workers'

export interface ObjectTab {
  id: string
  object_id: string
  tab_type: ObjectTabType
  title: string
  content: Json  // For Note: BlockNote JSON, For others: view settings
  order_index: number
  is_pinned: boolean
  created_at: string | null
  updated_at: string | null
}

export interface ObjectTabInsert {
  id?: string
  object_id: string
  tab_type: ObjectTabType
  title: string
  content?: Json
  order_index?: number
  is_pinned?: boolean
  created_at?: string | null
  updated_at?: string | null
}

export interface ObjectTabUpdate {
  id?: string
  object_id?: string
  tab_type?: ObjectTabType
  title?: string
  content?: Json
  order_index?: number
  is_pinned?: boolean
  created_at?: string | null
  updated_at?: string | null
}

// =====================================================
// Notes - OneNote-like folder/file structure
// =====================================================

export type NoteType = 'folder' | 'note'

export interface Note {
  id: string
  object_id: string
  parent_id: string | null
  type: NoteType
  title: string
  content: Json
  order_index: number
  created_at: string | null
  updated_at: string | null
}

export interface NoteInsert {
  id?: string
  object_id: string
  parent_id?: string | null
  type: NoteType
  title: string
  content?: Json
  order_index?: number
  created_at?: string | null
  updated_at?: string | null
}

export interface NoteUpdate {
  id?: string
  object_id?: string
  parent_id?: string | null
  type?: NoteType
  title?: string
  content?: Json
  order_index?: number
  created_at?: string | null
  updated_at?: string | null
}

// Note with children (for tree structure)
export interface NoteWithChildren extends Note {
  children?: NoteWithChildren[]
}

// =====================================================
// Documents - Notion-like global documents (not tied to Objects)
// =====================================================

export type DocumentType = 'folder' | 'page'

export interface Document {
  id: string
  parent_id: string | null
  type: DocumentType
  title: string
  content: Json
  icon: string | null
  cover_image: string | null
  is_favorite: boolean
  order_index: number
  created_at: string | null
  updated_at: string | null
}

export interface DocumentInsert {
  id?: string
  parent_id?: string | null
  type: DocumentType
  title?: string
  content?: Json
  icon?: string | null
  cover_image?: string | null
  is_favorite?: boolean
  order_index?: number
  created_at?: string | null
  updated_at?: string | null
}

export interface DocumentUpdate {
  id?: string
  parent_id?: string | null
  type?: DocumentType
  title?: string
  content?: Json
  icon?: string | null
  cover_image?: string | null
  is_favorite?: boolean
  order_index?: number
  created_at?: string | null
  updated_at?: string | null
}

// Document with children (for tree structure)
export interface DocumentWithChildren extends Document {
  children?: DocumentWithChildren[]
}

// =====================================================
// Canvases - tldraw whiteboard/canvas data
// =====================================================

export interface Canvas {
  id: string
  name: string
  snapshot: Json  // tldraw snapshot data
  created_at: string | null
  updated_at: string | null
}

export interface CanvasInsert {
  id?: string
  name?: string
  snapshot?: Json
  created_at?: string | null
  updated_at?: string | null
}

export interface CanvasUpdate {
  id?: string
  name?: string
  snapshot?: Json
  created_at?: string | null
  updated_at?: string | null
}

// =====================================================
// Extended Types with Relations
// =====================================================

// AlconObject with children and elements (hierarchical)
export interface AlconObjectWithChildren extends AlconObject {
  children?: AlconObjectWithChildren[]  // 入れ子のObject
  elements?: ElementWithDetails[]
}

// Element with all details
export interface ElementWithDetails extends Element {
  subelements?: Subelement[]
  assignees?: ElementAssigneeWithWorker[]
  edges?: {
    incoming: ElementEdgeWithElement[]  // Edges pointing TO this element
    outgoing: ElementEdgeWithElement[]  // Edges pointing FROM this element
  }
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
// Custom Columns (Notion-like dynamic columns)
// =====================================================

export type CustomColumnType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi_select'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'files'
  | 'relation'
  | 'formula'
  | 'rollup'
  | 'progress'
  | 'budget'

export interface SelectOption {
  value: string
  color?: string
}

export interface CustomColumnOptions {
  options?: SelectOption[]  // For select/multi_select
  format?: string           // For number/date formatting
  relationObjectId?: string // For relation type
  formula?: string          // For formula type
}

export interface CustomColumn {
  id: string
  object_id: string
  name: string
  column_type: CustomColumnType
  options: CustomColumnOptions
  order_index: number | null
  is_visible: boolean | null
  width: number | null
  created_at: string | null
  updated_at: string | null
}

export interface CustomColumnInsert {
  id?: string
  object_id: string
  name: string
  column_type: CustomColumnType
  options?: CustomColumnOptions
  order_index?: number | null
  is_visible?: boolean | null
  width?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface CustomColumnUpdate {
  id?: string
  object_id?: string
  name?: string
  column_type?: CustomColumnType
  options?: CustomColumnOptions
  order_index?: number | null
  is_visible?: boolean | null
  width?: number | null
  created_at?: string | null
  updated_at?: string | null
}

export interface CustomColumnValue {
  id: string
  column_id: string
  element_id: string
  value: Json
  created_at: string | null
  updated_at: string | null
}

export interface CustomColumnValueInsert {
  id?: string
  column_id: string
  element_id: string
  value: Json
  created_at?: string | null
  updated_at?: string | null
}

export interface CustomColumnValueUpdate {
  id?: string
  column_id?: string
  element_id?: string
  value?: Json
  created_at?: string | null
  updated_at?: string | null
}

// Custom column with values for display
export interface CustomColumnWithValues extends CustomColumn {
  values?: Record<string, CustomColumnValue>  // element_id -> value
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
      element_edges: {
        Row: ElementEdge
        Insert: ElementEdgeInsert
        Update: ElementEdgeUpdate
      }
      custom_columns: {
        Row: CustomColumn
        Insert: CustomColumnInsert
        Update: CustomColumnUpdate
      }
      custom_column_values: {
        Row: CustomColumnValue
        Insert: CustomColumnValueInsert
        Update: CustomColumnValueUpdate
      }
      object_tabs: {
        Row: ObjectTab
        Insert: ObjectTabInsert
        Update: ObjectTabUpdate
      }
    }
  }
}
