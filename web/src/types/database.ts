import type { ListControlsState } from '@/alcon/shared/listControls/types'

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

// =====================================================
// Domain - top-level container (replaces localStorage "System")
// =====================================================

// Per-Domain AI agent configuration, stored in domains.ai_config (jsonb).
// The Anthropic API key itself is NOT here — it stays a server-side Edge
// Function secret (ANTHROPIC_API_KEY). This only holds behaviour config,
// edited from the Domain's "API Settings" screen.
export interface DomainAIConfig {
  enabled?: boolean        // master switch for agent execution in this Domain
  model?: string           // 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6'
  instructions?: string    // extra system instructions for this Domain's agent
  max_steps?: number       // cap on agent loop turns (1–12, default 6)
}

export interface Domain {
  id: string
  name: string
  identifier: string | null  // short code e.g. "ALCON"
  description: string | null
  color: string | null
  privacy: string | null      // 'workspace' | 'team' | 'members'
  order_index: number | null
  created_at: string | null
  updated_at: string | null
  user_id: string | null
  ai_config: DomainAIConfig | null
  element_types: string[]       // Element (Task層) の型カタログ (Task / Human ...)
  object_types: string[]        // Object (Project層) の型カタログ (Project / Initiative ...) — element_types とは別レイヤー
  label_colors: Record<string, string>  // Label 名 → パレットキー (e.g. {"Bug":"red"})。色は Domain 共通
}

export interface DomainInsert {
  id?: string
  name: string
  identifier?: string | null
  description?: string | null
  color?: string | null
  privacy?: string | null
  order_index?: number | null
  user_id?: string | null
  ai_config?: DomainAIConfig | null
  element_types?: string[]
  object_types?: string[]
  label_colors?: Record<string, string>
}

export interface DomainUpdate {
  name?: string
  identifier?: string | null
  description?: string | null
  color?: string | null
  privacy?: string | null
  order_index?: number | null
  ai_config?: DomainAIConfig | null
  element_types?: string[]
  object_types?: string[]
  label_colors?: Record<string, string>
}

// object_domains junction: Object multi-homes across Domains
export interface ObjectDomain {
  object_id: string
  domain_id: string
  is_primary: boolean
  order_index: number | null
}

export interface ObjectDomainInsert {
  object_id: string
  domain_id: string
  is_primary?: boolean
  order_index?: number
}

// =====================================================
// AlconObject - フラット 2 階層: Domain > Object > Elements
// =====================================================
export interface AlconObject {
  id: string
  name: string
  description: string | null
  color: string | null
  prefix: string | null            // ID prefix e.g. "PH1"
  display_id: string | null        // e.g. "obj_PH1"
  order_index: number | null
  created_at: string | null
  updated_at: string | null
  system_id: string | null         // legacy text ID (kept for data migration)
  domain_id: string | null         // UUID FK → domains.id (primary domain)
  type: string | null              // ユーザー定義の型。domains.element_types から選ぶ (Element と同じカタログを共有)
  due_date: string | null          // 'YYYY-MM-DD' — Object の期日 (List で編集可)
}

export interface AlconObjectInsert {
  id?: string
  name: string
  description?: string | null
  color?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
  system_id?: string | null
  domain_id?: string | null
  type?: string | null
  due_date?: string | null
}

export interface AlconObjectUpdate {
  id?: string
  name?: string
  description?: string | null
  color?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
  system_id?: string | null
  domain_id?: string | null
  type?: string | null
  due_date?: string | null
}

export type ApprovalState = 'pending' | 'approved' | 'changes_requested' | 'rejected'

// Element status / priority unions — imported by call sites that need to
// validate user input or drop the `as any` casts on cross-row reads.
export type ElementStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled'
export type ElementPriority = 'low' | 'medium' | 'high' | 'urgent'

// Element - 最小作業単位
// object_id は nullable — Object 配下の Element と Domain 直下の Element の
// 両方を許す (前者: per-Object UI で生成 / 後者: サイドバー Elements で生成)。
export interface Element {
  id: string
  object_id: string | null
  title: string
  description: string | null
  type: string | null             // ユーザー定義の型 (Task / Human ...)。domains.element_types から選ぶ
  labels: string[]                // 自由文字列ラベル（任意・複数可、型なし）
  owner_id: string | null         // auth.users.id。NOT NULL なら "My Elements" の個人所有 Element。Domain クエリは除外する。
  display_id: string | null       // e.g. "el_PH1-001"
  seq_number: number | null
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled' | null
  priority: 'low' | 'medium' | 'high' | 'urgent' | null
  start_date: string | null  // ガントチャート用の開始日
  start_time: string | null  // 'HH:MM:SS' format (TIME column)
  due_date: string | null
  due_time: string | null    // 'HH:MM:SS' format (TIME column)
  color: string | null  // カレンダー表示用のカラーコード
  estimated_hours: number | null
  actual_hours: number | null
  progress: number | null  // 0-100, set explicitly via the status picker
  order_index: number | null
  is_approval: boolean | null
  approval_state: ApprovalState | null
  note_id: string | null          // Optional pinned Note (Apple-Note style HTML in note_contents.html)
  created_at: string | null
  updated_at: string | null
}

export interface ElementInsert {
  id?: string
  object_id?: string | null
  title: string
  description?: string | null
  type?: string | null
  labels?: string[]
  owner_id?: string | null
  status?: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled' | null
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  start_date?: string | null
  start_time?: string | null
  due_date?: string | null
  due_time?: string | null
  color?: string | null
  estimated_hours?: number | null
  actual_hours?: number | null
  progress?: number | null
  order_index?: number | null
  is_approval?: boolean | null
  approval_state?: ApprovalState | null
  note_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ElementUpdate {
  id?: string
  object_id?: string | null
  title?: string
  description?: string | null
  type?: string | null
  labels?: string[]
  owner_id?: string | null
  status?: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled' | null
  priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  start_date?: string | null
  start_time?: string | null
  due_date?: string | null
  due_time?: string | null
  color?: string | null
  estimated_hours?: number | null
  actual_hours?: number | null
  progress?: number | null
  order_index?: number | null
  is_approval?: boolean | null
  approval_state?: ApprovalState | null
  note_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

// Subelement - Elementの構成要素
export interface Subelement {
  id: string
  element_id: string
  title: string
  display_id: string | null       // e.g. "sub_PH1-001-01"
  seq_number: number | null
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
  user_id: string | null
  type: 'human' | 'ai_agent' | 'robot'
  name: string
  display_id: string | null       // e.g. "wrk_001"
  seq_number: number | null
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
export type EdgeType = 'spawns' | 'depends_on' | 'merges_into' | 'splits_to' | 'references' | 'cancels' | 'intersection'

// Element Edge - 依存関係 & 交差（Matrix View用）
export interface ElementEdge {
  id: string
  from_element: string
  to_element: string
  edge_type: EdgeType
  attributes: Json  // For intersection: stores cell data like {assignee: uuid, hours: 40}
  created_at: string | null
  created_by: string | null
}

export interface ElementEdgeInsert {
  id?: string
  from_element: string
  to_element: string
  edge_type: EdgeType
  attributes?: Json
  created_at?: string | null
  created_by?: string | null
}

export interface ElementEdgeUpdate {
  id?: string
  from_element?: string
  to_element?: string
  edge_type?: EdgeType
  attributes?: Json
  created_at?: string | null
  created_by?: string | null
}

// Element Edge with related element info
export interface ElementEdgeWithElement extends ElementEdge {
  related_element?: Element
}

// =====================================================
// Multi-homing Junction Tables
// =====================================================

export interface ElementObject {
  id: string;
  element_id: string;
  object_id: string;
  order_index: number;
  is_primary: boolean;
  created_at: string | null;
}

export interface ElementObjectInsert {
  element_id: string;
  object_id: string;
  order_index?: number;
  is_primary?: boolean;
}

// Intersection data for Matrix View (row element × column element)
export interface ElementIntersection {
  rowElementId: string
  colElementId: string
  edge?: ElementEdge
  attributes: Json
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

export type ObjectTabType =
  | 'summary'
  | 'elements'
  | 'overview'
  | 'gantt'
  | 'calendar'
  | 'workers'
  | 'resource'
  | 'custom_view'
  | 'board'
  | 'note'

export interface ObjectTab {
  id: string
  object_id: string
  tab_type: ObjectTabType
  title: string
  content: Json  // For Note: HTML string (legacy: structured-block JSON), For others: view settings
  note_id: string | null    // when tab_type='note', the linked notes.id (NOT NULL by DB CHECK)
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
  note_id?: string | null
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
  note_id?: string | null
  order_index?: number
  is_pinned?: boolean
  created_at?: string | null
  updated_at?: string | null
}

// =====================================================
// Documents - Notion-like global documents
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
// Extended Types with Relations
// =====================================================

// AlconObject with children and elements (hierarchical)
export interface AlconObjectWithChildren extends AlconObject {
  children?: AlconObjectWithChildren[]  // 入れ子のObject
  elements?: ElementWithDetails[]
  parentIds?: string[];
  isMultiHomed?: boolean;
}

// Element with all details
export interface ElementWithDetails extends Element {
  subelements?: Subelement[]
  assignees?: ElementAssigneeWithWorker[]
  edges?: {
    incoming: ElementEdgeWithElement[]  // Edges pointing TO this element
    outgoing: ElementEdgeWithElement[]  // Edges pointing FROM this element
  }
  objectIds?: string[];
  isMultiHomed?: boolean;
  /** Resolved home Objects (id + name) for views that show membership as a
   *  column — e.g. My Elements' "Objects" column (Asana My Tasks "Projects").
   *  Optional: only populated where the view needs the names. */
  objects?: { id: string; name: string }[];
}

// Element assignee with worker info
export interface ElementAssigneeWithWorker extends ElementAssignee {
  worker?: Worker
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
  | 'dimension'  // Matrix: uses another Object's Elements as sub-columns

export interface SelectOption {
  value: string
  color?: string
}

export interface CustomColumnOptions {
  options?: SelectOption[]  // For select/multi_select
  format?: string           // For number/date formatting
  relationObjectId?: string // For relation type
  formula?: string          // For formula type
  dimensionObjectId?: string // For dimension type: which Object's Elements to use as sub-columns
}

// Columns are scoped to either an Object (the column tags that Object's
// Elements) or a Domain (the column tags Objects in the Domain Object list).
// Exactly one of object_id / domain_id is set — enforced by a CHECK
// constraint in the DB.
export interface CustomColumn {
  id: string
  object_id: string | null
  domain_id: string | null
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
  object_id?: string | null
  domain_id?: string | null
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
  object_id?: string | null
  domain_id?: string | null
  name?: string
  column_type?: CustomColumnType
  options?: CustomColumnOptions
  order_index?: number | null
  is_visible?: boolean | null
  width?: number | null
  created_at?: string | null
  updated_at?: string | null
}

// Values target either an Element (column scoped by object_id on
// custom_columns) or an Object (column scoped by domain_id). Exactly one
// of element_id / object_id is set.
export interface CustomColumnValue {
  id: string
  column_id: string
  element_id: string | null
  object_id: string | null
  value: Json
  created_at: string | null
  updated_at: string | null
}

export interface CustomColumnValueInsert {
  id?: string
  column_id: string
  element_id?: string | null
  object_id?: string | null
  value: Json
  created_at?: string | null
  updated_at?: string | null
}

export interface CustomColumnValueUpdate {
  id?: string
  column_id?: string
  element_id?: string | null
  object_id?: string | null
  value?: Json
  created_at?: string | null
  updated_at?: string | null
}

// Custom column with values for display.
// `values` is keyed by either element_id (Element-scoped column) or
// object_id (Object-scoped column) — the meaning is determined by which
// of the column's own scope fields is set.
export interface CustomColumnWithValues extends CustomColumn {
  values?: Record<string, CustomColumnValue>
}

// =====================================================
// Room — rooms + channels (Phase 1a)
// =====================================================

export type ChannelKind = 'text' | 'voice'

export interface Room {
  id: string
  system_id: string
  domain_id: string | null
  default_channel_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface RoomInsert {
  system_id?: string
  domain_id?: string | null
  default_channel_id?: string | null
}

export interface RoomUpdate {
  default_channel_id?: string | null
}

export interface Channel {
  id: string
  room_id: string
  kind: ChannelKind
  name: string
  topic: string | null
  position: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface ChannelInsert {
  room_id: string
  kind: ChannelKind
  name: string
  topic?: string | null
  position?: number
}

export interface ChannelUpdate {
  kind?: ChannelKind
  name?: string
  topic?: string | null
  position?: number
}

// =====================================================
// Room — messages (Phase 2)
// =====================================================

export type MessageAuthorKind = 'human' | 'ai_agent'

export interface Message {
  id: string
  channel_id: string
  body: string
  author_id: string | null
  author_kind: MessageAuthorKind
  author_name: string | null
  created_at: string
  edited_at: string | null
}

export interface MessageInsert {
  channel_id: string
  body: string
  author_id?: string | null
  author_kind?: MessageAuthorKind
  author_name?: string | null
}

export interface MessageUpdate {
  body?: string
  edited_at?: string | null
}

export interface MessageReaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface MessageAttachment {
  id: string
  message_id: string
  storage_path: string
  name: string
  mime: string | null
  size_bytes: number | null
  created_at: string
}

export interface MessageAttachmentInsert {
  message_id: string
  storage_path: string
  name: string
  mime?: string | null
  size_bytes?: number | null
}

// =====================================================
// Room — voice channel live transcripts & rolling minutes
// Each row in voice_meeting_minutes is one continuous "call"
// for a voice channel. Transcript lines are streamed in by the
// client (Web Speech API) and the summarizer Edge Function
// rewrites `markdown` every few minutes from new lines.
// =====================================================

export interface VoiceMeetingMinutes {
  id: string
  channel_id: string
  markdown: string
  /** Comprehensive final minutes, generated once when the session ends.
   *  Null while the call is live (only the rolling `markdown` exists). */
  final_markdown: string | null
  last_summarized_at: string | null
  started_at: string
  ended_at: string | null
  created_at: string
  updated_at: string
}

export interface VoiceMeetingMinutesInsert {
  channel_id: string
  markdown?: string
}

export interface VoiceMeetingMinutesUpdate {
  markdown?: string
  final_markdown?: string | null
  last_summarized_at?: string | null
  ended_at?: string | null
}

export interface VoiceTranscriptLine {
  id: string
  session_id: string
  channel_id: string
  speaker_id: string | null
  speaker_name: string
  text: string
  spoken_at: string
  created_at: string
}

export interface VoiceTranscriptLineInsert {
  session_id: string
  channel_id: string
  speaker_id?: string | null
  speaker_name: string
  text: string
  spoken_at?: string
}

// =====================================================
// Chat — conversations + direct messages (direct & group)
// Separate from Room/channels: person-to-person messaging,
// membership-scoped RLS, not tied to a Domain.
// =====================================================

export type ConversationKind = 'direct' | 'group'

export interface Conversation {
  id: string
  kind: ConversationKind
  title: string | null
  created_by: string | null
  created_at: string
  last_message_at: string
}

export interface ConversationMember {
  conversation_id: string
  user_id: string
  joined_at: string
  last_read_at: string
}

export interface DirectMessage {
  id: string
  conversation_id: string
  body: string
  author_id: string | null
  author_name: string | null
  created_at: string
  edited_at: string | null
}

export interface DmReaction {
  id: string
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export interface DmAttachment {
  id: string
  message_id: string
  storage_path: string
  name: string
  mime: string | null
  size_bytes: number | null
  created_at: string
}

// Member info embedded in the get_my_conversations() RPC result.
export interface ConversationMemberProfile {
  user_id: string
  display_name: string | null
  avatar_url: string | null
}

// Row shape returned by the get_my_conversations() RPC — a Conversation
// enriched with last-message preview, unread count, and member profiles.
export interface ConversationListItem {
  id: string
  kind: ConversationKind
  title: string | null
  created_by: string | null
  created_at: string
  last_message_at: string
  last_message_body: string | null
  last_message_author: string | null
  unread_count: number
  members: ConversationMemberProfile[]
}

// =====================================================
// Element Comments (collaboration)
// =====================================================

export type CommentAuthorKind = 'human' | 'ai_agent'

export interface ElementComment {
  id: string
  element_id: string
  parent_id: string | null
  author_id: string | null
  author_kind: CommentAuthorKind
  author_name: string | null
  content: string
  mentions: string[]   // user_id[]
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export interface ElementCommentInsert {
  id?: string
  element_id: string
  parent_id?: string | null
  author_id?: string | null
  author_kind?: CommentAuthorKind
  author_name?: string | null
  content: string
  mentions?: string[]
  is_pinned?: boolean
}

export interface ElementCommentUpdate {
  content?: string
  is_pinned?: boolean
  mentions?: string[]
}

// =====================================================
// Reactions (emoji on element OR comment)
// =====================================================

export interface ElementReaction {
  id: string
  element_id: string | null
  comment_id: string | null
  user_id: string
  emoji: string
  created_at: string
}

export interface ElementReactionInsert {
  element_id?: string | null
  comment_id?: string | null
  user_id: string
  emoji: string
}

// =====================================================
// Notifications (Inbox)
// =====================================================

export type NotificationKind =
  | 'mention'
  | 'assigned'
  | 'comment'
  | 'status_change'
  | 'approval_requested'
  | 'approval_decided'
  | 'due_soon'

export interface Notification {
  id: string
  recipient_id: string
  actor_id: string | null
  actor_name: string | null
  kind: NotificationKind
  element_id: string | null
  comment_id: string | null
  object_id: string | null
  brief_id: string | null
  title: string
  body: string | null
  is_read: boolean
  is_archived: boolean
  created_at: string
}

export interface NotificationInsert {
  recipient_id: string
  actor_id?: string | null
  actor_name?: string | null
  kind: NotificationKind
  element_id?: string | null
  comment_id?: string | null
  object_id?: string | null
  brief_id?: string | null
  title: string
  body?: string | null
}

// =====================================================
// Approvals
// =====================================================

export interface ElementApproval {
  id: string
  element_id: string
  approver_id: string | null
  approver_name: string | null
  state: ApprovalState
  note: string | null
  decided_at: string
}

export interface ElementApprovalInsert {
  element_id: string
  approver_id?: string | null
  approver_name?: string | null
  state: ApprovalState
  note?: string | null
}

// =====================================================
// Time Entries
// =====================================================

export interface TimeEntry {
  id: string
  element_id: string
  user_id: string | null
  user_name: string | null
  started_at: string
  ended_at: string | null
  duration_sec: number | null
  note: string | null
  created_at: string
}

export interface TimeEntryInsert {
  element_id: string
  user_id?: string | null
  user_name?: string | null
  started_at?: string
  ended_at?: string | null
  duration_sec?: number | null
  note?: string | null
}

export interface TimeEntryUpdate {
  ended_at?: string | null
  duration_sec?: number | null
  note?: string | null
}

// =====================================================
// Agent Runs — AI-driven Element execution (Symphony-style)
// =====================================================

// An agent run executes a single Element autonomously and stops at "review"
// for a human to approve. agent_run_steps is the live "Workpad".
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AgentRunStepType =
  | 'plan'
  | 'thought'
  | 'action'
  | 'subelement'
  | 'comment'
  | 'status'
  | 'result'
  | 'error'

export interface AgentRun {
  id: string
  element_id: string
  domain_id: string | null
  worker_id: string | null
  status: AgentRunStatus
  model: string | null
  triggered_from: string | null   // 'board' | 'detail'
  triggered_by: string | null     // auth.users.id
  summary: string | null          // one-line deliverable summary
  result: string | null           // full deliverable (markdown)
  error: string | null
  step_count: number
  started_at: string | null
  finished_at: string | null
  created_at: string
}

export interface AgentRunInsert {
  id?: string
  element_id: string
  domain_id?: string | null
  worker_id?: string | null
  status?: AgentRunStatus
  model?: string | null
  triggered_from?: string | null
  triggered_by?: string | null
}

export interface AgentRunUpdate {
  status?: AgentRunStatus
  summary?: string | null
  result?: string | null
  error?: string | null
  finished_at?: string | null
}

export interface AgentRunStep {
  id: string
  run_id: string
  idx: number
  type: AgentRunStepType
  title: string
  detail: string | null
  created_at: string
}

// =====================================================
// Strategy — cross-Domain Object groupings (Linear Initiative-style)
//
// A Strategy directly contains Objects via the strategy_objects junction
// (the primary scope mechanism). Strategies can also nest other
// Strategies as children via the strategy_children junction
// (multi-parent allowed), forming a DAG for layered view composition.
// scope (jsonb) carries an optional saved view (filter + display) so a
// Strategy can ship with its own list-controls preset.
// =====================================================

export type StrategyStatus = 'active' | 'paused' | 'completed' | 'archived'

export interface StrategyScope {
  domain_ids?: string[]
  object_ids?: string[]
  filter?: ListControlsState['filter']
  display?: ListControlsState['display']
}

export interface Strategy {
  id: string
  name: string
  description: string | null
  status: StrategyStatus
  scope: StrategyScope
  color: string | null
  icon: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface StrategyInsert {
  id?: string
  name: string
  description?: string | null
  status?: StrategyStatus
  scope?: StrategyScope
  color?: string | null
  icon?: string | null
  created_by?: string | null
}

export interface StrategyUpdate {
  name?: string
  description?: string | null
  status?: StrategyStatus
  scope?: StrategyScope
  color?: string | null
  icon?: string | null
  updated_at?: string
}

// Strategy → Objects junction (primary scope: direct Object inclusion).
export interface StrategyObject {
  id: string
  strategy_id: string
  object_id: string
  created_at: string
}

// Strategy → Strategy junction (DAG nesting: multi-parent allowed).
export interface StrategyChild {
  parent_strategy_id: string
  child_strategy_id: string
  order_index: number
  created_at: string
}

export interface StrategyChildInsert {
  parent_strategy_id: string
  child_strategy_id: string
  order_index?: number
}

export interface StrategyWithObjects extends Strategy {
  objectIds: string[]
}

// =====================================================
// Object milestone — single-date ◇ marker on the Timeline
// =====================================================

export interface ObjectMilestone {
  id: string
  object_id: string
  date: string                   // 'YYYY-MM-DD'
  label: string | null
  created_at: string
  updated_at: string
}

export interface ObjectMilestoneInsert {
  id?: string
  object_id: string
  date: string
  label?: string | null
}

export interface ObjectMilestoneUpdate {
  date?: string
  label?: string | null
}

// =====================================================
// Supabase Database Type
// =====================================================

export interface Database {
  public: {
    Tables: {
      domains: {
        Row: Domain
        Insert: DomainInsert
        Update: DomainUpdate
      }
      object_domains: {
        Row: ObjectDomain
        Insert: ObjectDomainInsert
        Update: Partial<ObjectDomainInsert>
      }
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
      rooms: {
        Row: Room
        Insert: RoomInsert
        Update: RoomUpdate
      }
      channels: {
        Row: Channel
        Insert: ChannelInsert
        Update: ChannelUpdate
      }
      messages: {
        Row: Message
        Insert: MessageInsert
        Update: MessageUpdate
      }
      message_reactions: {
        Row: MessageReaction
      }
      message_attachments: {
        Row: MessageAttachment
        Insert: MessageAttachmentInsert
      }
      voice_meeting_minutes: {
        Row: VoiceMeetingMinutes
        Insert: VoiceMeetingMinutesInsert
        Update: VoiceMeetingMinutesUpdate
      }
      voice_transcript_lines: {
        Row: VoiceTranscriptLine
        Insert: VoiceTranscriptLineInsert
      }
      strategies: {
        Row: Strategy
        Insert: StrategyInsert
        Update: StrategyUpdate
      }
      strategy_objects: {
        Row: StrategyObject
        Insert: Omit<StrategyObject, 'id' | 'created_at'>
      }
      strategy_children: {
        Row: StrategyChild
        Insert: StrategyChildInsert
      }
      object_milestones: {
        Row: ObjectMilestone
        Insert: ObjectMilestoneInsert
        Update: ObjectMilestoneUpdate
      }
      agent_runs: {
        Row: AgentRun
        Insert: AgentRunInsert
        Update: AgentRunUpdate
      }
      agent_run_steps: {
        Row: AgentRunStep
        Insert: Omit<AgentRunStep, 'id' | 'created_at'>
      }
    }
  }
}
