import type { ListControlsState } from '@/Function/shared/listControls/types'

// The schema itself is generated (./supabase.ts) and narrowed in ./db.ts;
// the types here are the domain views of those rows the app works with.
import type { Json } from './supabase'
export type { Json }

// =====================================================
// 3-Layer Structure: Objects → Elements (an Element may sit under another as its Sub-element)
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
  model?: string           // an AGENT_MODELS key (Function/domain/domainAgentConfig.ts)
  instructions?: string    // instructions for every agent in this Domain, before the Worker's own
  max_turns?: number       // turns a run may take in all (5–200, default 60); an AI Worker's own limit wins
}

// Per-Domain thresholds for the Strategy risk cross-section, stored in
// domains.risk_thresholds (jsonb). Every key optional; absent = the default
// in Function/strategy/initiativeRiskModel.ts. Edited from Settings >
// Elements > SLAs.
/** Settings > Strategy > Phase: how a new Phase's dates are seeded. Every
 *  key optional; absent = the create dialog starts with empty dates. */
export interface DomainPhaseDefaults {
  length_days?: number            // a new Phase spans this many days (end_date inclusive)
  start?: 'today' | 'after_last'  // where it starts: today, or the day after the Domain's last Phase
}

export interface DomainRiskThresholds {
  due_soon_days?: number   // days ahead that count as "due soon" (default 3)
  stall_minutes?: number   // minutes of silence before in_progress work is stalled (default 25)
  idle_hours?: number      // hours of silence before an Object with unstarted work is idle (default 24)
}

// Domain visibility within its owning ActivitySpace.
//   'workspace' — every Space member can see it (org-public)
//   'private'   — only explicit domain_members can see it
export type DomainPrivacy = 'workspace' | 'private'

export interface Domain {
  id: string
  name: string
  identifier: string | null  // short code e.g. "ALCON"
  description: string | null
  color: string | null
  icon: string | null  // emoji or uploaded image URL; null = the built-in DomainIcon silhouette
  privacy: DomainPrivacy | null  // 'workspace' = visible to all Space members; 'private' = domain_members only
  order_index: number | null
  created_at: string | null
  updated_at: string | null
  user_id: string | null
  activity_space_id: string | null  // owning ActivitySpace (company / enterprise)
  ai_config: DomainAIConfig | null
  element_types: string[]       // Element (Task層) の型カタログ (Task / Human ...)
  object_types: string[]        // Object (Project層) の型カタログ (Project / Strategy ...) — element_types とは別レイヤー
  label_colors: Record<string, string>  // Label 名 → パレットキー (e.g. {"Bug":"red"})。色は Domain 共通
  risk_thresholds: DomainRiskThresholds // Settings > Elements > SLAs。未設定は {}（DB 既定）
  phase_defaults: DomainPhaseDefaults   // Settings > Strategy > Phase。未設定は {}（DB 既定）
}

export interface DomainInsert {
  id?: string
  name: string
  identifier?: string | null
  description?: string | null
  color?: string | null
  icon?: string | null
  privacy?: DomainPrivacy | null
  order_index?: number | null
  user_id?: string | null
  activity_space_id?: string | null
  ai_config?: DomainAIConfig | null
  element_types?: string[]
  object_types?: string[]
  label_colors?: Record<string, string>
  risk_thresholds?: DomainRiskThresholds
  phase_defaults?: DomainPhaseDefaults
}

export interface DomainUpdate {
  name?: string
  identifier?: string | null
  description?: string | null
  color?: string | null
  icon?: string | null
  privacy?: DomainPrivacy | null
  order_index?: number | null
  activity_space_id?: string | null
  ai_config?: DomainAIConfig | null
  element_types?: string[]
  object_types?: string[]
  label_colors?: Record<string, string>
  risk_thresholds?: DomainRiskThresholds
  phase_defaults?: DomainPhaseDefaults
}

// A saved Element shape (Settings > Elements > Templates, el_QLT-029),
// Domain-scoped like element_types/label_colors/risk_thresholds — but its
// own table, not a domains column, since a Domain can hold several.
// QuickAddElementPopup applies one by seeding its existing pill state
// (type/status/priority/labels/assignees/description); estimated_hours has
// no pill and is applied directly to the created Element(s) instead.
export interface ElementTemplate {
  id: string
  domain_id: string
  name: string
  type: string | null
  status: ElementStatus | null
  priority: ElementPriority | null
  labels: string[]
  assignee_worker_ids: string[]
  description: string | null
  estimated_hours: number | null
  order_index: number
  created_at: string
  updated_at: string
}

export interface ElementTemplateInsert {
  domain_id: string
  name: string
  type?: string | null
  status?: ElementStatus | null
  priority?: ElementPriority | null
  labels?: string[]
  assignee_worker_ids?: string[]
  description?: string | null
  estimated_hours?: number | null
  order_index?: number
}

export interface ElementTemplateUpdate {
  name?: string
  type?: string | null
  status?: ElementStatus | null
  priority?: ElementPriority | null
  labels?: string[]
  assignee_worker_ids?: string[]
  description?: string | null
  estimated_hours?: number | null
  order_index?: number
}

// =====================================================
// ActivitySpace — top-level org container (company / enterprise) above Domain.
// Hierarchy: ActivitySpace > Domain > Object > Element.
// =====================================================
export interface ActivitySpace {
  id: string
  name: string
  identifier: string | null  // optional short slug
  color: string | null
  logo: string | null
  order_index: number | null
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  /** How Athena's writes are held in this Space: 'ask' every write, 'auto' critical only, 'free' none (policy approvals). */
  approval_mode?: 'ask' | 'auto' | 'free'
  /** The Space's heartbeat: whether Athena wakes on a cadence to raise
   *  what has been left waiting, and as whom. Changed only through the
   *  set_space_heartbeat RPC (owner only). */
  heartbeat_enabled?: boolean
  heartbeat_owner_id?: string | null
  heartbeat_cadence_minutes?: number
  heartbeat_next_at?: string | null
  heartbeat_timezone?: string
  heartbeat_quiet_start?: string | null
  heartbeat_quiet_end?: string | null
  heartbeat_notify_after_hours?: number
  heartbeat_monthly_budget_usd?: number
  heartbeat_last_wake_at?: string | null
  heartbeat_last_tick_at?: string | null
  /** Whether Athena distils this Space's finished work into memories.
   *  A settings toggle (memory is internal bookkeeping, not an
   *  approval matter); the owner or any member's screen may flip it
   *  only where the column grant and the screen allow. */
  memory_auto_capture?: boolean
}

export interface ActivitySpaceInsert {
  id?: string
  name: string
  identifier?: string | null
  color?: string | null
  logo?: string | null
  order_index?: number
}

export interface ActivitySpaceUpdate {
  name?: string
  identifier?: string | null
  color?: string | null
  logo?: string | null
  order_index?: number
}

export interface ActivitySpaceMember {
  activity_space_id: string
  user_id: string
  role: string  // 'owner' | 'member'
  created_at: string | null
}

// =====================================================
// Memory — what one piece of work taught, kept for the next.
// Two layers: 'episode' (auto-written after work, unreviewed, 90-day
// life) and 'durable' (promoted, curated). The audit stays the sealed
// whole record; a memory is the editable layer above it, always
// linked back to its source run or session. Domain view of the
// memories row (migration 20261129090000); the engine's twin of these
// judgements is supabase/functions/_shared/memoryStore.ts.
// =====================================================
export type MemoryKind = 'event' | 'procedure' | 'fact'
export type MemoryLayer = 'episode' | 'durable'
export type MemoryStatus = 'active' | 'superseded' | 'archived' | 'expired'
export type MemoryScope = 'space' | 'personal'
export type MemoryOrigin = 'athena' | 'person'

export interface Memory {
  id: string
  layer: MemoryLayer
  kind: MemoryKind
  status: MemoryStatus
  scope: MemoryScope
  activity_space_id: string | null
  user_id: string | null
  title: string
  gist: string
  body: string
  topic_key: string | null
  fingerprint: string | null
  element_id: string | null
  domain_id: string | null
  strategy_id: string | null
  integration_name: string | null
  origin: MemoryOrigin
  created_by: string | null
  edited_by: string | null
  source_run_id: string | null
  source_session_id: string | null
  supersedes_id: string | null
  pinned: boolean
  use_count: number
  last_used_at: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

// =====================================================
// Membership junctions — the boundary model.
// A user belongs at three altitudes: Space (org), Domain, Object.
// Visibility cascades: a Space member sees 'workspace' Domains; a
// domain_member who is NOT a Space member is a Guest (sees only that
// Domain). object_members are typically a subset of domain_members,
// but also allow Object-only guests. A row is an active membership: an
// invitation becomes one only when the invitee accepts it.
// =====================================================
export type MemberRole = 'owner' | 'admin' | 'member'
// A Domain also has viewers: they read everything in it and change nothing.
// Object membership has no viewer role.
export type DomainMemberRole = MemberRole | 'viewer'

export interface DomainMember {
  id: string
  domain_id: string
  user_id: string
  role: DomainMemberRole
  created_at: string | null
}

export interface DomainMemberInsert {
  id?: string
  domain_id: string
  user_id: string
  role?: DomainMemberRole
}

export interface ObjectMember {
  id: string
  object_id: string
  user_id: string
  role: MemberRole
  created_at: string | null
}

export interface ObjectMemberInsert {
  id?: string
  object_id: string
  user_id: string
  role?: MemberRole
}

// An invitation to a Space, Domain or Object (exactly one is set). It grants
// nothing until the invitee accepts it through respond_to_invite; written
// only by the invite_member / respond_to_invite / cancel_invite RPCs.
export type InvitationScope = 'space' | 'domain' | 'object'
export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'canceled'
export type InvitationRole = 'member' | 'viewer'

export interface MembershipInvitation {
  id: string
  activity_space_id: string | null
  domain_id: string | null
  object_id: string | null
  invitee_id: string
  invited_by: string | null
  /** 'viewer' only for a Domain invitation. */
  role: InvitationRole
  /** The Space / Domain / Object name when the invitation was sent. */
  scope_name: string
  inviter_name: string | null
  status: InvitationStatus
  created_at: string
  responded_at: string | null
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
  /** Its own icon: 'glyph:<Name>', 'lucide:<name>' or an emoji; null shows the Object icon. */
  icon?: string | null
  prefix: string | null            // ID prefix e.g. "PH1"
  display_id: string | null        // e.g. "OBJ_PH1"
  order_index: number | null
  created_at: string | null
  updated_at: string | null
  system_id: string | null         // legacy text ID (kept for data migration)
  domain_id: string | null         // UUID FK → domains.id (primary domain)
  type: string | null              // ユーザー定義の型。domains.element_types から選ぶ (Element と同じカタログを共有)
  start_date: string | null        // 'YYYY-MM-DD' — Gantt 開始日 (due_date とペア、ドラッグで予定化)
  due_date: string | null          // 'YYYY-MM-DD' — Object の期日 (List で編集可)
  lead_id: string | null           // UUID FK → workers.id。Object の "Lead" (担当者)。List で編集可
  phase_id: string | null          // UUID FK → phases.id。所属 Phase (Linear の Cycle 相当、高々1つ)
  note_id: string | null           // Optional pinned Note (elements.note_id と同じ仕組み)
  archived_at?: string | null      // 使わなくなった Object。一覧・ピッカーから外れ、id では開ける。サーバーが刻む
  archived_by?: string | null      // アーカイブした人 (auth.users.id)
}

export interface AlconObjectInsert {
  id?: string
  name: string
  description?: string | null
  color?: string | null
  icon?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
  system_id?: string | null
  domain_id?: string | null
  type?: string | null
  start_date?: string | null
  due_date?: string | null
  lead_id?: string | null
  phase_id?: string | null
  note_id?: string | null
}

export interface AlconObjectUpdate {
  id?: string
  name?: string
  description?: string | null
  color?: string | null
  icon?: string | null
  order_index?: number | null
  created_at?: string | null
  updated_at?: string | null
  system_id?: string | null
  domain_id?: string | null
  type?: string | null
  start_date?: string | null
  due_date?: string | null
  lead_id?: string | null
  phase_id?: string | null
  note_id?: string | null
}

export type ApprovalState = 'pending' | 'approved' | 'changes_requested' | 'rejected'

// Element status / priority unions — imported by call sites that need to
// validate user input or drop the `as any` casts on cross-row reads.
export type ElementStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled'
export type ElementPriority = 'low' | 'medium' | 'high' | 'urgent'

// Element Direction — 「この Element をどうしていくか」を一級フィールド化した
// jsonb (elements.direction)。acceptance は宣言文で、チェック状態は持たない —
// チェックリストは Sub-element（親を持つ Element）の領分。
//
// 各行は id を持つ。direction は列まるごと書き戻すので、行に同一性が無いと
// 2人が別々の行を編集したときにリスト全体が last-writer-wins になる。id が
// あれば「自分が変えた行」を相手の最新リストへ適用できる。
export interface AcceptanceLine {
  id: string
  text: string
}

export interface ElementDirection {
  approach: string | null      // 進め方・方針
  acceptance: AcceptanceLine[] // 受け入れ条件 (宣言文)
  next: string | null          // 次の一手
}

// DB から来た jsonb を防御的に正規化する。undefined / null / 非オブジェクトは
// null、欠けたキーはデフォルト値で埋める。
//
// acceptance は2つの形が混在する: id を持つオブジェクトと、id を持たない素の
// 文字列（この列が書かれ始めた頃の行）。後者には本文と出現位置から決まる id を
// 与える —— 同じデータを読んだ2つのクライアントが同じ id に辿り着くので、次の
// 書き込みで本物の id が付くまでの間もマージが成立する。
function legacyLineId(text: string, index: number): string {
  return `legacy:${index}:${text}`
}

export function normalizeDirection(raw: unknown): ElementDirection | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const seen = new Set<string>()
  const acceptance = (Array.isArray(obj.acceptance) ? obj.acceptance : [])
    .map((item, index): AcceptanceLine | null => {
      if (typeof item === 'string') return { id: legacyLineId(item, index), text: item }
      if (item !== null && typeof item === 'object') {
        const raw = item as { id?: unknown; text?: unknown }
        const text = typeof raw.text === 'string' ? raw.text
          : raw.text !== null && raw.text !== undefined ? String(raw.text)
          : null
        if (text === null) return null
        const id = typeof raw.id === 'string' && raw.id ? raw.id : legacyLineId(text, index)
        return { id, text }
      }
      return null
    })
    .filter((line): line is AcceptanceLine => line !== null)
    // Two lines under one id would shadow each other in every lookup keyed by
    // it — the merge's, and React's. The later one is renamed, not dropped.
    .map((line, index) => {
      if (!seen.has(line.id)) { seen.add(line.id); return line }
      return { ...line, id: legacyLineId(line.text, index) }
    })
  return {
    approach: typeof obj.approach === 'string' ? obj.approach : null,
    acceptance,
    next: typeof obj.next === 'string' ? obj.next : null,
  }
}

// Element - 最小作業単位
// object_id は nullable — Object 配下の Element と Domain 直下の Element の
// 両方を許す (前者: per-Object UI で生成 / 後者: サイドバー Elements で生成)。
/** How heavy an Element's work is for an AI (supabase/functions/run-agent/agentConfig.ts). */
export type AiWeight = 'light' | 'standard' | 'heavy'

export function isAiWeight(v: unknown): v is AiWeight {
  return v === 'light' || v === 'standard' || v === 'heavy'
}

export interface Element {
  id: string
  object_id: string | null
  /** This Element's own definition (its output shape, its loop), over its Strategy's. */
  definition_id?: string | null
  /** How heavy its work is for an AI: picks the model by cost when no setting names one. */
  ai_weight?: string | null  // an AiWeight; read through isAiWeight
  /** What it asks someone to do (Function/shared/elementActionKinds); read through isElementAction. */
  action?: string | null
  /** The Element this one is a Sub-element of; it lives in that Element's Object. */
  parent_id?: string | null
  title: string
  description: string | null
  type: string | null             // ユーザー定義の型 (Task / Human ...)。domains.element_types から選ぶ
  labels: string[] | null              // 自由文字列ラベル（任意・複数可、型なし）
  owner_id: string | null         // auth.users.id。NOT NULL なら "My Elements" の個人所有 Element。Domain クエリは除外する。
  display_id: string | null       // e.g. "ELE_PH1-001"
  seq_number: number | null
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'blocked' | 'cancelled' | null
  priority: 'low' | 'medium' | 'high' | 'urgent' | null
  start_date: string | null  // ガントチャート用の開始日
  start_time: string | null  // 'HH:MM:SS' format (TIME column)
  due_date: string | null
  due_time: string | null    // 'HH:MM:SS' format (TIME column)
  color: string | null  // カレンダー表示用のカラーコード
  /** Its own icon: 'glyph:<Name>', 'lucide:<name>' or an emoji; null shows none. */
  icon?: string | null
  estimated_hours: number | null
  actual_hours: number | null
  progress: number | null  // 0-100, set explicitly via the status picker
  direction: ElementDirection | null  // 方針・受け入れ条件・次の一手。読む側は normalizeDirection を通す
  order_index: number | null
  is_approval: boolean
  approval_state: ApprovalState | null
  note_id: string | null          // Optional pinned Note (Note style HTML in note_contents.html)
  phase_id: string | null         // UUID FK → phases.id。所属 Phase (Linear の Cycle 相当、高々1つ)
  /** 何度 Phase を越して持ち越されたか。3周目の Element は1周目とは別のことを言っている */
  carried_over_count: number
  /** Lease — who is working on this and until when. Text, not an FK: a holder
   *  is a session, not a durable entity. Read-only from the app: written only
   *  through claim_element() / release_element() (a BEFORE trigger rejects any
   *  other writer), so ElementInsert / ElementUpdate deliberately omit these.
   *  Any holder-stamped comment renews claim_expires_at (report = heartbeat). */
  claimed_by: string | null
  claim_expires_at: string | null
  branch: string | null           // the resource that actually conflicts between sessions
  created_at: string | null
  updated_at: string | null
}

export interface ElementInsert {
  action?: string | null
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
  direction?: ElementDirection | null
  order_index?: number | null
  is_approval?: boolean
  approval_state?: ApprovalState | null
  note_id?: string | null
  phase_id?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface ElementUpdate {
  action?: string | null
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
  direction?: ElementDirection | null
  order_index?: number | null
  is_approval?: boolean
  approval_state?: ApprovalState | null
  note_id?: string | null
  phase_id?: string | null
  carried_over_count?: number
  created_at?: string | null
  updated_at?: string | null
}

// Worker - 人間、AIエージェント、またはロボット
export interface Worker {
  id: string
  object_id: string | null
  user_id: string | null
  /** The Space an unlinked Worker (no user_id, no object_id) belongs to.
   *  A person's Space follows their memberships, an Object's Worker its Object. */
  activity_space_id: string | null
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
  /** Standing hours in a working day. Null falls back to the client default. */
  capacity_hours_per_day: number | null
  created_at: string | null
  updated_at: string | null
}

// =====================================================
// Worker availability — the periods a Worker's capacity is not the standing
// one. An absence is a span whose capacity is 0; half-time is a span whose
// capacity is half. Leave is a case of capacity rather than a flag of its
// own, so the load chart needs one rule instead of two.
//
// start_date / end_date are inclusive, which is how an absence is spoken
// ("away the 5th through the 7th").
// =====================================================

export type WorkerAvailabilityKind = 'leave' | 'rotation' | 'assignment' | 'other'

export interface WorkerAvailability {
  id: string
  worker_id: string
  start_date: string   // 'YYYY-MM-DD', inclusive
  end_date: string     // 'YYYY-MM-DD', inclusive
  kind: WorkerAvailabilityKind
  capacity_hours_per_day: number   // 0 = away for the whole span
  note: string | null
  created_at: string
  updated_at: string
}

export interface WorkerAvailabilityInsert {
  id?: string
  worker_id: string
  start_date: string
  end_date: string
  kind?: WorkerAvailabilityKind
  capacity_hours_per_day?: number
  note?: string | null
}

export interface WorkerAvailabilityUpdate {
  start_date?: string
  end_date?: string
  kind?: WorkerAvailabilityKind
  capacity_hours_per_day?: number
  note?: string | null
  updated_at?: string
}

// =====================================================
// Worker skills — what a Worker (human or AI agent) knows, at a declared
// level, backed by their own done Elements as evidence. A skill is as visible
// as its Worker; an evidence row only to those who can see its Element.
// =====================================================

/** 1 Learning · 2 Capable · 3 Proficient · 4 Expert */
export type WorkerSkillLevel = 1 | 2 | 3 | 4

export interface WorkerSkill {
  id: string
  worker_id: string
  name: string
  level: WorkerSkillLevel
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface WorkerSkillEvidence {
  skill_id: string
  element_id: string
  created_at: string
}

export interface WorkerInsert {
  id?: string
  object_id?: string | null
  activity_space_id?: string | null
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
  activity_space_id?: string | null
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
  order_index: number | null;
  is_primary: boolean | null;
  created_at: string | null;
}

export interface ElementObjectInsert {
  element_id: string;
  object_id: string;
  order_index?: number;
  is_primary?: boolean;
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
  | 'note'
  | 'flow'

export interface ObjectTab {
  id: string
  object_id: string
  tab_type: ObjectTabType
  title: string
  content: Json  // For Note: HTML string (legacy: structured-block JSON), For others: view settings
  note_id: string | null    // when tab_type='note', the linked notes.id (NOT NULL by DB CHECK)
  order_index: number
  is_pinned: boolean | null
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
// Extended Types with Relations
// =====================================================

// An Object with its Elements. Objects live directly under a Domain.
export interface AlconObjectWithChildren extends AlconObject {
  elements?: ElementWithDetails[]
  parentIds?: string[];
  isMultiHomed?: boolean;
}

// Element with all details
/** Comment rollup for one Element — how many comments, and when the thread
 *  last moved. Computed by get_element_activity, not a stored row (the stored
 *  audit trail is `ElementActivity`). */
export interface ElementCommentActivity {
  commentCount: number
  /** created_at of the newest comment (ISO). */
  lastCommentAt: string
}

export interface ElementWithDetails extends Element {
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
  /** Comment rollup, attached by the surface that fetched it
   *  (`withCommentActivity`). Absent means "not fetched here", not "no
   *  comments" — a surface that never asks leaves it undefined. */
  activity?: ElementCommentActivity;
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
  label?: string
  archived?: boolean
  color?: string
}

export interface CustomColumnOptions {
  description?: string
  decimals?: number
  currency?: string
  unit?: string
  options?: SelectOption[]  // For select/multi_select
  format?: string           // For number/date formatting
  relationObjectId?: string // For relation type
  formula?: string          // For formula type
  dimensionObjectId?: string // For dimension type: which Object's Elements to use as sub-columns
}

// A column definition is owned by exactly one scope (DB CHECK constraint):
//   object_id         → local column: tags that Object's Elements only
//   domain_id         → tags Objects in the Domain Object list (separate axis)
//   activity_space_id → Space library column ("global field"): can be placed
//                       on many Element lists via custom_column_placements
//   owner_user_id     → personal column: private to its owner (RLS-enforced),
//                       shown on their My Elements
// Where a column APPEARS is a separate concern — see CustomColumnPlacement.
// Values always key by the Element (or Object for domain columns), so a
// multi-homed Element shows the same value from every list, Asana-style.
export interface CustomColumn {
  id: string
  object_id: string | null
  domain_id: string | null
  activity_space_id: string | null
  owner_user_id: string | null
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
  activity_space_id?: string | null
  owner_user_id?: string | null
  name: string
  column_type: CustomColumnType
  options?: CustomColumnOptions
  order_index?: number | null
  is_visible?: boolean | null
  width?: number | null
  created_at?: string | null
  updated_at?: string | null
}

// Where a column shows up: an Object's Elements list (object_id) or a user's
// My Elements (owner_user_id) — exactly one is set. Local columns carry a
// single self-placement; library columns get one row per list they're added
// to. Removing a placement hides the column from that list but keeps the
// definition and every Element's value (Asana "remove field from project").
export interface CustomColumnPlacement {
  id: string
  column_id: string
  object_id: string | null
  owner_user_id: string | null
  order_index: number | null
  created_at: string | null
}

export interface CustomColumnPlacementInsert {
  id?: string
  column_id: string
  object_id?: string | null
  owner_user_id?: string | null
  order_index?: number | null
  created_at?: string | null
}

export interface CustomColumnUpdate {
  id?: string
  object_id?: string | null
  domain_id?: string | null
  activity_space_id?: string | null
  owner_user_id?: string | null
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
  /** Lease-holder token of the session that wrote this, or null. Not the
   *  display name — every AI session is 'Claude' — but the same string it
   *  passed to claim_element(). A comment stamped with the current holder
   *  renews the Element's lease (report = heartbeat). Humans leave it null. */
  holder: string | null
  created_at: string
  updated_at: string
}

// What happened to an Element — the Activity rail's rows. Status rows are
// written by a database trigger; the UI appends the rest. Append-only.
export interface ElementActivity {
  id: string
  element_id: string
  kind: string
  detail: string
  author: string
  actor_id: string | null
  created_at: string
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
  strategy_id: string | null
  user_id: string
  emoji: string
  created_at: string
}

export interface ElementReactionInsert {
  element_id?: string | null
  comment_id?: string | null
  strategy_id?: string | null
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
  | 'review_due'
  | 'invite'
  | 'asset_announced'
  | 'measure_missed'
  | 'heartbeat'
  | 'promotion'
  | 'question'
  | 'definition_test'

export interface Notification {
  id: string
  recipient_id: string
  actor_id: string | null
  actor_name: string | null
  kind: NotificationKind
  element_id: string | null
  comment_id: string | null
  /** Strategy thread: comment_id's FK points at element_comments, so a
   *  Strategy comment hangs off these two instead. */
  strategy_id: string | null
  /** The decision a review-due notification is about, or the success
   *  condition a measure-missed one is about. */
  intent_id: string | null
  strategy_comment_id: string | null
  object_id: string | null
  /** The membership invitation an 'invite' notification is about. */
  invitation_id?: string | null
  /** The gateway's approval request an 'approval_requested' notification is about. */
  workflow_approval_id?: string | null
  /** The agent approval an 'approval_requested' notification is about, when it has no Element (a Copilot session's). */
  agent_action_id?: string | null
  /** The heartbeat wake a 'heartbeat' digest came from; its run record is the digest's detail. */
  agent_run_id?: string | null
  /** The AI-drafted connection an 'approval_requested' notification is about (G4). */
  integration_draft_id?: string | null
  /** The promotion draft a 'promotion' notification is about. */
  promotion_draft_id?: string | null
  /** The question ticket a 'question' notification is about (B12). */
  question_ticket_id?: string | null
  /** The definition test a 'definition_test' notification is about (B14). */
  definition_test_id?: string | null
  title: string
  body: string | null
  is_read: boolean
  is_archived: boolean
  created_at: string
}

export type QuestionTicketStatus = 'open' | 'answered' | 'expired'

/** A question ticket (B12): a run's question for a person, filed by
 *  its ask_question tool. The run rests until the person answers —
 *  the answer is stored here verbatim — or the ticket expires and
 *  the run ends blocked. `options` / `context` are the jsonb shapes
 *  the engine wrote; readers parse them defensively
 *  (Function/shared/questionTicketModel.ts). */
export interface QuestionTicket {
  id: string
  activity_space_id: string | null
  run_id: string
  element_id: string | null
  strategy_id: string | null
  question: string
  options: unknown
  context: unknown
  tried: string
  status: QuestionTicketStatus
  answer: string | null
  answered_by: string | null
  answered_at: string | null
  expires_at: string
  created_at: string
}

/** A definition test (B14): a fixture a person cut from a real run's
 *  record — its integration exchanges as the model saw them, each
 *  resolved to a canonical action and hashed by its full arguments —
 *  plus the expectation a replay must reproduce, derived once at
 *  capture. `fixture` / `expected` / `last_result` are the jsonb
 *  shapes the engine wrote; readers parse them defensively
 *  (AIP/harness/definitionTestModel.ts). The last_* columns are the
 *  latest replay's verdict, written by the engine's settle alone —
 *  the table grants members no update at all. */
export interface DefinitionTest {
  id: string
  definition_id: string
  activity_space_id: string
  name: string
  fixture: unknown
  expected: unknown
  source_run_id: string | null
  source_run_label: string | null
  source_run_status: string | null
  tainted: boolean
  captured_by: string | null
  captured_at: string
  last_result: unknown
  last_run_id: string | null
  last_run_at: string | null
  last_body_hash: string | null
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
// Agent Runs — AI-driven Element execution (Symphony-style)
// =====================================================

// An agent run carries out a single Element's task on behalf of the person
// who started it (ADR 0027): it stops for that person's approval before
// external writes, and ends with a report on the Element. agent_run_steps is
// the live "Workpad"; agent_actions are the approvals; agent_artifacts are
// deliverables everyone on the Element can read.
export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'paused'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AgentRunMode = 'execute' | 'reply' | 'converse' | 'copilot' | 'draft' | 'promote' | 'heartbeat'

export type AgentRunStepType =
  | 'plan'
  | 'thought'
  | 'action'
  | 'subelement'
  | 'comment'
  | 'status'
  | 'result'
  | 'error'
  | 'approval'
  | 'artifact'
  // A conversation on a Strategy: the person's message, the agent's reply,
  // a write to the Strategy, and a hand-over to the Planner.
  | 'message'
  | 'reply'
  | 'write'
  | 'plan_request'
  // The conversation's proposals: runs it asks the person to start, and an
  // answer it asks them to send to a waiting run. The person presses; the
  // conversation itself starts and answers nothing.
  | 'start_request'
  | 'answer_request'
  // A connection a conversation proposed, and a credential capture a
  // conversation or a run raised (secure login): both carry only the
  // proposal's or the request's address in their detail.
  | 'connection_request'
  | 'credential_request'
  // Memory: a run kept what it learned (capture), or read what earlier
  // work kept (retrieval, including an auto-promotion it completed).
  | 'memory'
  // A coding run's publish landing (coding capability PR3): the step
  // carries the opened PR's created record in its detail.
  | 'pull_request'

export interface AgentRun {
  id: string
  /** The Element whose task this run carries out; null for a conversation on a Strategy. */
  element_id: string | null
  /** The Strategy a conversation run is about; null for an Element's run. */
  strategy_id: string | null
  /** The Copilot session an anchor run belongs to; null for every other run. */
  ai_session_id: string | null
  /** The connection draft a drafting run (G4) belongs to; null for every other run. */
  integration_draft_id?: string | null
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
  mode: AgentRunMode
  prompt: string | null
  reply_to: string | null
  input_tokens: number
  output_tokens: number
  cost_usd: number | string
  activity_space_id: string | null
  continuation_count: number
  /** A plan run (B8): writes recorded as a plan instead of executed. */
  plan_mode?: boolean
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
  mode?: AgentRunMode
  prompt?: string | null
  reply_to?: string | null
  /** Start as a plan run (B8): the dry run whose plan is one approval. */
  plan_mode?: boolean
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

// A pull request that carries out an Element (code_changes), with the AI's
// check against the intent and the team's verdicts and line comments. Rows in
// code_changes are written by the code-changes / run-agent Edge Functions;
// a person may unlink one. The diff itself is read from GitHub on demand.
export type CodeChangeState = 'open' | 'draft' | 'merged' | 'closed'

export interface CodeChange {
  id: string
  element_id: string
  activity_space_id: string | null
  provider: 'github'
  repo: string
  number: number
  url: string
  title: string
  body: string | null
  state: CodeChangeState
  base_ref: string | null
  head_ref: string | null
  head_sha: string | null
  author_login: string | null
  additions: number | null
  deletions: number | null
  changed_files: number | null
  intent_check: Json | null
  /** The AI's walk-through of the change, in sections (read with readGuide). */
  guide: Json | null
  linked_via: 'manual' | 'agent'
  run_id: string | null
  linked_by: string | null
  synced_at: string | null
  created_at: string
  updated_at: string
}

export interface CodeChangeReview {
  id: string
  code_change_id: string
  reviewer_id: string
  reviewer_name: string | null
  verdict: 'matches' | 'needs_changes' | 'comment'
  body: string
  head_sha: string | null
  created_at: string
  /** The review posted to the pull request, or why it could not be. */
  github_review_id: number | null
  github_error: string | null
}

export interface CodeChangeComment {
  id: string
  code_change_id: string
  author_id: string
  author_name: string | null
  path: string
  line: number
  side: 'old' | 'new'
  body: string
  head_sha: string | null
  resolved: boolean
  created_at: string
  /** The comment posted to the pull request, or why it could not be. */
  github_comment_id: number | null
  github_error: string | null
}

// An external service a Space connects for its agents (ADR 0027). Members
// read; owners write. The credential lives in Vault: secret_id only says one
// is set, and the browser writes it through set_integration_secret and never
// reads it back. last_test is written by the integration-test Edge Function.
export interface Integration {
  id: string
  activity_space_id: string
  preset: string | null
  kind: 'mcp' | 'http' | 'model'
  name: string
  description: string | null
  icon: string | null
  endpoint: string
  auth_type: 'none' | 'bearer' | 'header' | 'oauth'
  auth_header: string | null
  secret_id: string | null
  delegation: 'approve_each' | 'full_delegation'
  enabled: boolean
  last_test: Json | null
  /** The account an OAuth connection signed in as (the Google email). Written only by integration-oauth. */
  external_account: string | null
  /** The commands agents may use, enforced by run-agent (supabase/functions/_shared/connectorManifest.ts). */
  manifest: Json | null
  /** How to use the connection, for agents. Not enforced. */
  guide: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type IntegrationUpdate = Partial<Pick<Integration,
  'name' | 'description' | 'endpoint' | 'auth_type' | 'auth_header' | 'delegation' | 'enabled' | 'manifest'>>

/** A website username/password login (secure-login PR1): the metadata a
 *  browser may know. The password itself lives only in Vault under
 *  `site-credential:<id>` and is never selected back — `secret_id` only
 *  says whether one is stored. Written only through
 *  set_site_credential_by_origin / set_site_credential (owner-only). */
export interface SiteCredential {
  id: string
  activity_space_id: string
  /** Canonical scheme://host[:port] — the credential's identity. */
  origin: string
  username: string
  label: string | null
  secret_id: string | null
  /** Same shape as an integration's last_test; written by the runner sign-in path (PR3). */
  last_test: Json | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** One row of the append-only credential audit (credential_uses):
 *  which credential was touched, how, by whom or by which run — never
 *  a value. Owners of the Space read it; PR1 writes the lifecycle
 *  events (stored / replaced / deleted). */
export interface CredentialUse {
  id: string
  activity_space_id: string
  credential_kind: 'integration' | 'site' | 'once'
  integration_id: string | null
  site_credential_id: string | null
  event: 'stored' | 'replaced' | 'deleted' | 'declined' | 'used' | 'test_failed' | 'release_refused'
  run_id: string | null
  actor_id: string | null
  origin: string | null
  detail: string | null
  created_at: string
}

export type CredentialRequestStatus = 'pending' | 'saved' | 'used_once' | 'declined' | 'expired' | 'superseded'

/** What raised a credential request (the need jsonb's source): a
 *  connection slot found empty, a refused credential, a run that hit
 *  the wall, the runner standing on a login page. Server-written from
 *  server-side facts only — a model cannot author one. */
export interface CredentialRequestNeed {
  source?: 'connection' | 'reauth' | 'run' | 'runner'
  run_id?: string
  waiting_for?: string
}

/** A credential capture ask (secure-login PR2): a server-written row
 *  the client renders as the capture card/dialog. It carries display
 *  data only — the destination, the work waiting, a username hint.
 *  The value a person types goes from the dialog straight to the
 *  storage RPC and exists in no row, step or message. */
export interface CredentialRequest {
  id: string
  activity_space_id: string
  kind: 'integration_secret' | 'site_login'
  integration_id: string | null
  site_credential_id: string | null
  /** For a site login: the canonical origin, server-derived, locked in the dialog. */
  origin: string | null
  username_hint: string | null
  need: CredentialRequestNeed
  status: CredentialRequestStatus
  requested_by: string | null
  decided_by: string | null
  decided_at: string | null
  expires_at: string | null
  created_at: string
}

/** One definition's verifier calibration (B5): how the verifier's
 *  checked verdicts paired with the humans' eventual signals over the
 *  trailing window — agree_pass / agree_fail where they matched,
 *  false_pass (passed, a person sent it back) and false_fail (failed,
 *  a person accepted anyway) where they did not. Written only by the
 *  automations tick's evaluator, by recomputation from run_outcomes. */
export interface VerifierCalibration {
  id: string
  activity_space_id: string
  definition_id: string
  window_start: string
  window_days: number
  agree_pass: number
  agree_fail: number
  false_pass: number
  false_fail: number
  /** Pairs counted: both a checked verdict and a human signal spoke. */
  pairs: number
  updated_at: string
}

export type RevisionCandidateReason = 'false_pass_heavy' | 'false_fail_heavy' | 'gap_cluster'
export type RevisionCandidateStatus = 'open' | 'dismissed' | 'addressed'

/** A definition queued for a person's revision (B5): the tick
 *  evaluator's claim that this definition's verifier systematically
 *  disagrees with its humans, in the named direction, at the named
 *  rate over the named pairs — with the disagreeing outcomes as
 *  evidence. Opened and refreshed only by the evaluator; resolved
 *  only by a Space owner through resolve_revision_candidate. */
export interface DefinitionRevisionCandidate {
  id: string
  definition_id: string
  activity_space_id: string
  reason: RevisionCandidateReason
  /** The suspect direction's error rate over the pairs (0–1). */
  rate: number
  pairs: number
  sample_outcome_ids: string[]
  status: RevisionCandidateStatus
  created_at: string
  updated_at: string
}

export type ConstraintScope = 'definition' | 'strategy'
export type ConstraintDerivedFrom = 'verifier_gap' | 'rejection_cluster' | 'correction_pattern'
export type ConstraintDraftStatus = 'draft' | 'awaiting_review' | 'activated' | 'rejected' | 'expired'

/** The cluster a constraint draft was derived from, as the derivation
 *  stamped it: the signature's count over the target's window
 *  outcomes, and the baseline rate the constraint claims it will
 *  move. The review surface's decision minimum. */
export interface ConstraintClusterRecord {
  outcomes?: number
  withSignature?: number
  windowOutcomes?: number
  baselineRate?: number
  signalled?: number
  samples?: string[]
}

/** One entry in a constraint draft's own event log (drafted /
 *  activated / rejected), appended by the deciding RPC. */
export interface ConstraintDraftEvent {
  at: string
  kind: string
  by: string | null
}

/** A constraint the system drafted from outcome evidence (B6): one
 *  sentence of learned rule, its cluster and its evidence, hash-bound
 *  at drafting. It steers nothing until a Space owner activates it
 *  through activate_constraint_draft — the RPC re-checks ownership
 *  and the target's snapshot itself. Written only by the automations
 *  tick's derivation (service role). */
export interface ConstraintDraft {
  id: string
  activity_space_id: string
  scope: ConstraintScope
  target_definition_id: string | null
  target_strategy_id: string | null
  constraint_text: string | null
  derived_from: ConstraintDerivedFrom
  signature: string
  evidence_outcome_ids: string[]
  cluster: ConstraintClusterRecord
  calibration_candidate_id: string | null
  structure_hash: string | null
  binding_hash: string | null
  target_version: string | null
  status: ConstraintDraftStatus
  offered_at: string | null
  decided_by: string | null
  decided_at: string | null
  activated_constraint_id: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export type PlanningConstraintStatus = 'active' | 'retired'
export type ConstraintEffectStatus = 'measuring' | 'improving' | 'established' | 'ineffective'

/** The effect measurement's latest reading, written by the tick
 *  evaluator: how many outcomes ran under the constraint, how many
 *  still carried its signature, and the rate that makes. */
export interface ConstraintEffectRecord {
  under?: number
  withSignature?: number
  rate?: number
  baselineRate?: number
  firstImprovingAt?: string | null
  evaluatedAt?: string
}

/** An activated constraint (B6) — the learning edge's truth. It
 *  lands in the planner's brief and the Strategy conversation
 *  (strategy scope) and in the definition's effective body at
 *  resolution (definition scope), as a projection computed at read
 *  time; the stored definition body is never rewritten by it.
 *  Effect is measured against baseline_rate; an ineffective status
 *  flags it for a person — nothing retires it automatically. */
export interface PlanningConstraint {
  id: string
  activity_space_id: string
  scope: ConstraintScope
  target_definition_id: string | null
  target_strategy_id: string | null
  constraint_text: string
  draft_id: string
  signature: string
  derived_from: ConstraintDerivedFrom
  baseline_rate: number
  baseline_outcomes: number
  baseline_with: number
  effect_status: ConstraintEffectStatus
  effect: ConstraintEffectRecord
  status: PlanningConstraintStatus
  activated_by: string
  activated_at: string
  retired_by: string | null
  retired_at: string | null
  retire_reason: 'owner' | 'folded' | null
  created_at: string
  updated_at: string
}

export type AutonomyLevel = 'ask' | 'auto'
export type AutonomyIncidentKind =
  | 'rejection' | 'verify_mismatch' | 'reopen' | 'rollback' | 'verdict_fail' | 'record_lapsed' | 'lane_closed'

/** The counts a grant was standing on when the evaluator last judged
 *  it: the record the person reads to see why the command runs
 *  unasked ("auto because 15 clean runs"). */
export interface AutonomyBasis {
  cleanStreak?: number
  checkedInStreak?: number
  verifyGreenStreak?: number
  incidents?: number
  requiredClean?: number
  windowDays?: number
}

/** One command's graduated-autonomy standing in a Space (B7): the
 *  level the approval gate honors, the lane its reversibility puts
 *  it in, and the basis it stands on. Written only by the tick
 *  evaluator (granted_by 'system') and by an owner's pin through
 *  set_autonomy_pin (granted_by 'owner', pinned). */
export interface AutonomyGrant {
  id: string
  activity_space_id: string
  integration_id: string
  action: string
  lane: 1 | 2 | 3
  level: AutonomyLevel
  basis: AutonomyBasis
  granted_by: 'system' | 'owner'
  pinned: boolean
  required_clean: number
  last_incident_at: string | null
  last_incident_kind: AutonomyIncidentKind | null
  created_at: string
  updated_at: string
}

/** One command's measured track record in a Space (B7): the counts
 *  the evaluator recomputes from sealed records each tick. */
export interface CommandTrackRecord {
  id: string
  activity_space_id: string
  integration_id: string
  action: string
  window_start: string
  window_days: number
  clean_completions: number
  checked_passes: number
  clean_streak: number
  checked_in_streak: number
  verify_checked: number
  verify_ok: number
  verify_green_streak: number
  incidents: number
  last_incident_at: string | null
  updated_at: string
}

export type IntegrationDraftStatus =
  | 'drafting' | 'awaiting_input' | 'testing' | 'awaiting_review'
  | 'active' | 'rejected' | 'failed' | 'expired' | 'superseded' | 'rerouted'
/** Why a draft was started: who asked, from where, and what work waits on it. */
export interface DraftRequestContext {
  /** connect_card | conversation | settings | copilot */
  entry?: string
  /** The work waiting on this connection, in the words it was asked with. */
  waitingFor?: string | null
  /** Entry C (Settings): what the connection is for, in the person's words. */
  purpose?: string | null
  /** A documentation URL the person supplied, if any. */
  docsUrl?: string | null
  /** The run / session / automation the ask came from, when there is one. */
  sourceRunId?: string | null
  sourceSessionId?: string | null
  elementIds?: string[]
}

/** A required command the drafter dropped, with the reason the review shows. */
export interface DraftDrop { name: string; reason: string }

/** A post-activation edit to a drafted connection, kept on its draft (§4.11). */
export interface DraftChangeEvent { at: string; by: string | null; fields: string[] }

// A connection the AI is drafting for this Space (G4). It holds no secret,
// ever: the candidate (endpoint, auth, manifest, guide), where it came
// from, every test round's evidence, what exactly was tested, and the
// owner's decision. Testing happens against a staged integration row — a
// disabled new row, or a disabled clone when the draft updates a live
// connection (target_integration_id) — and activation is the only way the
// tested content goes live.
export interface IntegrationDraft {
  id: string
  activity_space_id: string
  name: string
  name_key: string
  kind: 'http'
  status: IntegrationDraftStatus
  request_context: DraftRequestContext
  endpoint: string | null
  auth_type: 'none' | 'bearer' | 'header' | 'oauth' | null
  auth_header: string | null
  manifest: Json | null
  guide: string | null
  test_inputs: Record<string, Record<string, unknown>>
  sources: string[]
  /** DraftTestRound[] (AIP/connectors/draftModel.ts reads them). */
  test_results: Json | null
  required_commands: string[]
  dropped_commands: DraftDrop[]
  tested_hash: string | null
  tested_structure_hash: string | null
  tested_permission_hash: string | null
  /** The normalised tested payload activation compares against (Json of DraftContent). */
  tested_content: Json | null
  materialized_integration_id: string | null
  target_integration_id: string | null
  activated_integration_id: string | null
  draft_run_id: string | null
  decided_by: string | null
  decided_at: string | null
  activated_hash: string | null
  activated_structure_hash: string | null
  activated_permission_hash: string | null
  failure_class: string | null
  awaiting_question: string | null
  change_events: DraftChangeEvent[]
  expires_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type PromotionDraftStatus =
  | 'drafting' | 'awaiting_input' | 'rehearsing' | 'awaiting_review'
  | 'active' | 'rejected' | 'expired' | 'failed'

export type PromotionSourceKind = 'memory' | 'run' | 'builder'

export type PromotionFailureClass =
  | 'definition_invalid' | 'connector_missing' | 'read_failed'
  | 'write_plan_invalid' | 'unverifiable'

/** The schedule a promoted harness runs on (v1 drafts schedules only). */
export interface PromotionTrigger {
  kind: 'schedule'
  cron: string
  timezone: string
}

/** Where a promoted harness's Elements land and what they are called —
 *  everything outside the definition body that binds it to the board. */
export interface PromotionBinding {
  objectId: string | null
  titleTemplate: string
  descriptionTemplate: string
  trigger: PromotionTrigger | null
}

/** One entry in a promotion draft's material record: what the drafter
 *  was given and what cleaning did to it (provenance the reviewer sees). */
export interface PromotionMaterialSource {
  kind: 'memory' | 'run' | 'element' | 'person'
  ref: string
  tainted?: boolean
  instructionShaped?: boolean
  note?: string
}

/** One lifecycle entry on a promotion draft (activation, rollback, the
 *  unverifiable acknowledgment). */
export interface PromotionDraftEvent {
  at: string
  kind: string
  by?: string | null
  note?: string
}

// A promotion the AI is drafting for this Space: one-off work (a durable
// procedure memory, or a finished run a person named) on its way to
// becoming a standing harness. It holds the proposed package (a
// definition and its binding), the rehearsal's evidence, what exactly
// was tested (the structure and binding hashes), and the owner's
// decision. The drafter can create neither a definition nor an
// Automation — only the owner's activation RPC does, bound to the
// tested hashes.
export interface PromotionDraft {
  id: string
  activity_space_id: string
  status: PromotionDraftStatus
  source_kind: PromotionSourceKind
  source_memory_id: string | null
  source_run_id: string | null
  target_definition_id: string | null
  requester_id: string | null
  name: string | null
  body: string | null
  binding: PromotionBinding
  base_definition_hash: string | null
  tested_structure_hash: string | null
  tested_binding_hash: string | null
  draft_run_id: string | null
  rehearsal_run_id: string | null
  /** RehearsalReport (AIP/harness/promotionModel.ts reads it). */
  rehearsal_report: Json | null
  failure_class: PromotionFailureClass | null
  awaiting_question: string | null
  material_sources: PromotionMaterialSource[]
  activated_definition_id: string | null
  activated_automation_id: string | null
  activated_body: string | null
  activated_structure_hash: string | null
  activated_binding_hash: string | null
  decided_by: string | null
  decided_at: string | null
  events: PromotionDraftEvent[]
  expires_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type AssetKind = 'app' | 'ai_agent' | 'script' | 'service' | 'other'
export type AssetStatus = 'unclaimed' | 'active' | 'revoked'

// An app or AI that announced itself through the asset relay (ADR 0036).
// `manifest` is what it says about itself; `observed` is what the relay saw
// of the connection. Members of the Space read; only owners accept or revoke.
export interface Asset {
  id: string
  activity_space_id: string
  name: string
  kind: AssetKind
  status: AssetStatus
  manifest: Record<string, Json>
  observed: Record<string, Json>
  token_prefix: string
  claimed_by: string | null
  claimed_at: string | null
  revoked_at: string | null
  last_seen_at: string | null
  event_count: number
  created_at: string
  updated_at: string
}

/** What an asset reported it did, in its own words. */
export interface AssetEvent {
  id: string
  asset_id: string
  kind: string
  summary: string
  payload: Json | null
  occurred_at: string
  created_at: string
}

export type PersonalAccessTokenAccess = 'read' | 'read_write'

// A personal access token (ADR 0032): lets an external client act as its
// owner through alcon-mcp, under the owner's RLS. Only the owner reads their
// rows, and never the hash; the plaintext exists once, in the result of
// create_personal_access_token. Issue and revoke go through RPCs.
export interface PersonalAccessToken {
  id: string
  user_id: string
  name: string
  /** The first 12 characters of the token ("alc_pat_" + 4), to tell tokens apart. */
  token_prefix: string
  access: PersonalAccessTokenAccess
  expires_at: string | null
  last_used_at: string | null
  last_used_client: string | null
  revoked_at: string | null
  created_at: string
}

/** What create_personal_access_token returns — the only time the token is readable. */
export interface IssuedPersonalAccessToken {
  id: string
  token: string
}

export type AgentActionStatus = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired'

/** One proposal waiting for (or decided by) a person — an external write, or a batch of them. */
export interface AgentAction {
  id: string
  run_id: string
  /** The Element whose run waits; null when the run's subject is not an Element (a Copilot session). */
  element_id: string | null
  tool: string
  input: { calls?: { id: string; name: string; input: Record<string, unknown> }[] }
  input_hash: string
  summary: string
  integration_id: string | null
  status: AgentActionStatus
  decided_by: string | null
  decided_at: string | null
  decision_note: string | null
  /** Who decided: null is a person; 'policy' is the Space's free mode
   *  deciding by standing policy; 'track-record' is the action's earned
   *  autonomy (B7) letting it run unasked; 'plan' is an approved plan
   *  (B8) covering the call it listed. */
  decision_source?: 'policy' | 'track-record' | 'plan' | null
  /** The approval mode in force when the policy decided. */
  policy_mode?: 'ask' | 'auto' | 'free' | null
  result: Record<string, unknown> | null
  /** When an undecided proposal lapses; only a Copilot session's approvals carry one. */
  expires_at: string | null
  created_at: string
}

export interface AgentOutput {
  id: string
  element_id: string
  run_id: string | null
  title: string
  content: string
  format: 'markdown' | 'text' | 'csv' | 'json' | 'html'
  created_by: string | null
  author_name: string | null
  created_at: string
  updated_at: string
}

// =====================================================
// Strategy — cross-Domain Object groupings (Linear Strategy-style)
//
// The set of Objects a Strategy bundles lives in the strategy_objects
// junction and nowhere else (ADR 0017). Strategies can also nest other
// Strategies as children via the strategy_children junction
// (multi-parent allowed), forming a DAG for layered view composition.
// scope (jsonb) carries the Domain hint and an optional saved view
// (filter + display) so a Strategy can ship with its own list-controls
// preset. It does not carry Object ids — a row whose jsonb still has a
// key listing Objects is historical and is never read.
// =====================================================

export type StrategyStatus = 'active' | 'paused' | 'completed' | 'archived'

export interface StrategyScope {
  domain_ids?: string[]
  filter?: ListControlsState['filter']
  display?: ListControlsState['display']
}

/** How far a Strategy's AI work goes on its own: 'manual' waits for a
 *  person's review of every AI result; 'auto' marks verified AI work done and
 *  starts the AI Elements it unblocks, stopping at a person's Element. */
export type StrategyDelegation = 'manual' | 'auto'

export interface Strategy {
  id: string
  name: string
  description: string | null
  status: StrategyStatus | null
  scope: StrategyScope
  delegation: StrategyDelegation
  /** The definition its Elements follow (Function: definitions), or null. */
  definition_id: string | null
  color: string | null
  icon: string | null
  activity_space_id: string | null  // the Space it belongs to
  /** Order among its siblings in the Strategy list; null sorts after, oldest first. */
  order_index?: number | null
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
  activity_space_id?: string | null
  created_by?: string
}

export interface StrategyUpdate {
  name?: string
  description?: string | null
  status?: StrategyStatus
  scope?: StrategyScope
  delegation?: StrategyDelegation
  color?: string | null
  icon?: string | null
  updated_at?: string
}

// Strategy → Objects junction — the single source of a Strategy's Object set.
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

// Strategy thread — same shape as ElementComment so one renderer serves both.
// author_id is null for an ai_agent (the FK points at auth.users and an agent
// has no auth user); author_kind + author_name say who wrote it instead.
export interface StrategyComment {
  id: string
  strategy_id: string
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

export interface StrategyCommentInsert {
  id?: string
  strategy_id: string
  parent_id?: string | null
  author_id?: string | null
  author_kind?: CommentAuthorKind
  author_name?: string | null
  content: string
  mentions?: string[]
  is_pinned?: boolean
}

export interface StrategyCommentUpdate {
  content?: string
  is_pinned?: boolean
  mentions?: string[]
}

export interface StrategyWithObjects extends Strategy {
  objectIds: string[]
  /** Parent Strategy ids from strategy_children (DAG — multi-parent allowed).
   *  Empty = a top-level Strategy, shown at the root of the list. */
  parentIds: string[]
}

// =====================================================
// Phase — Linear-Cycle-style time-boxed period, scoped to
// one Domain. Objects / Elements point at their Phase via
// a nullable phase_id FK (at most one Phase per row).
// =====================================================

// A Phase closes because somebody closes it, not because its end_date went
// by. `complete` is an act; a Phase past its end_date that is still `planned`
// or `active` ran out of time, which is derived from these two rather than
// stored, so the two can never disagree.
export type PhaseStatus = 'planned' | 'active' | 'complete'

export interface Phase {
  id: string
  domain_id: string
  name: string
  start_date: string | null  // 'YYYY-MM-DD'
  end_date: string | null    // 'YYYY-MM-DD'
  order_index: number | null
  status: PhaseStatus
  closed_at: string | null   // ISO timestamp — when it was closed
  /** What closing meant: got what we came for, or ran out of time. */
  closing_note: string | null
  created_at: string
  updated_at: string
}

export interface PhaseInsert {
  id?: string
  domain_id: string
  name: string
  start_date?: string | null
  end_date?: string | null
  order_index?: number | null
}

export interface PhaseUpdate {
  name?: string
  start_date?: string | null
  end_date?: string | null
  order_index?: number | null
  status?: PhaseStatus
  closed_at?: string | null
  closing_note?: string | null
  updated_at?: string
}

// =====================================================
// Strategy "Intent" layer — the 認識2x2 + 実践2x2 backing
// the new Strategy Document detail page. 9 tables, all
// gated through the parent Strategy's RLS.
// =====================================================

export type IntentStatus = 'on_track' | 'at_risk' | 'off_track' | 'done'

// One Master Intent per Strategy (parent_intent_id is null),
// Sub-Intents nest under it. Captured + uncaptured dimensions
// are first-class arrays so the UI can render the "what you
// failed to measure" pills without parsing prose.
// What a row under a Strategy is. `master` is the root spine one Strategy
// gets (never listed as a decision); the other two are the surfaces' rows.
export type IntentKind = 'decision' | 'assumption' | 'measure' | 'master'

/**
 * Which way a measure's number is supposed to move. Not derivable: zero
 * unclosed corrections and a hundred percent trained are both full marks, and
 * only the condition says which side of its target counts as met.
 */
export type MeasureDirection = 'at_least' | 'at_most'

export interface Intent {
  id: string
  strategy_id: string
  parent_intent_id: string | null
  kind: IntentKind
  /** measure only — the number the condition names. */
  target_value: number | null
  /** measure only — the number somebody last read. Null until measured. */
  actual_value: number | null
  /** measure only — the operator's unit: %, 件, 世帯/日. */
  unit: string | null
  /** measure only — ISO timestamp of the reading, so a stale one can say so. */
  measured_at: string | null
  direction: MeasureDirection | null
  slug: string | null                  // "i1" / "i2" — used in cross-card references
  title: string
  subtitle: string | null
  captured_dimensions: string[]        // e.g., ['Business Model', 'Profit Structure']
  uncaptured_dimensions: string[]      // e.g., ['Organizational Capability', 'Technology Foundation']
  abandoned: string | null             // What was explicitly given up to make this choice
  horizon: string | null               // 'YYYY-MM-DD'
  status: IntentStatus
  decided_by_name: string | null
  decided_by_role: string | null
  decided_at: string | null
  /** decision only — the decision that replaced this one when a review
   *  reversed it. Null while this decision still stands. */
  superseded_by_intent_id: string | null
  order_index: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface IntentInsert {
  id?: string
  strategy_id: string
  parent_intent_id?: string | null
  kind?: IntentKind
  target_value?: number | null
  actual_value?: number | null
  unit?: string | null
  measured_at?: string | null
  direction?: MeasureDirection | null
  slug?: string | null
  title: string
  subtitle?: string | null
  captured_dimensions?: string[]
  uncaptured_dimensions?: string[]
  abandoned?: string | null
  horizon?: string | null
  status?: IntentStatus
  decided_by_name?: string | null
  decided_by_role?: string | null
  decided_at?: string | null
  superseded_by_intent_id?: string | null
  order_index?: number
  created_by?: string
}

export interface IntentUpdate {
  parent_intent_id?: string | null
  kind?: IntentKind
  target_value?: number | null
  actual_value?: number | null
  unit?: string | null
  measured_at?: string | null
  direction?: MeasureDirection | null
  slug?: string | null
  title?: string
  subtitle?: string | null
  captured_dimensions?: string[]
  uncaptured_dimensions?: string[]
  abandoned?: string | null
  horizon?: string | null
  status?: IntentStatus
  decided_by_name?: string | null
  decided_by_role?: string | null
  decided_at?: string | null
  superseded_by_intent_id?: string | null
  order_index?: number
}

// Semantic edge from an Intent to a Domain/Object/Element.
// relationship_type captures *why* the binding exists (Popper's
// falsifiability requires this — a bare tag isn't enough).
export type IntentBindingTarget = 'domain' | 'object' | 'element' | 'phase' | 'worker'
export type IntentRelationship =
  | 'evidences'       // target supports the intent's hypothesis
  | 'measures'        // target operationalizes a dimension
  | 'tests'           // target falsifies (or confirms) an assumption
  | 'delivers'        // target is a vehicle for realizing the intent
  | 'competes_with'   // target competes with the intent for resources
  | 'reschedules'     // the intent moved this target's dates

export interface IntentBinding {
  id: string
  intent_id: string
  target_type: IntentBindingTarget
  target_id: string
  relationship_type: IntentRelationship
  note: string | null
  created_at: string
}

export interface IntentBindingInsert {
  intent_id: string
  target_type: IntentBindingTarget
  target_id: string
  relationship_type: IntentRelationship
  note?: string | null
}

// One row per LLM audit run. Score + breakdown coexist so the
// score can never drift from its evidence (anti-meta-Goodhart).
export interface IntentAudit {
  id: string
  intent_id: string
  ran_at: string
  score: number                  // 0..100
  authentic_count: number
  suspected_count: number
  indeterminate_count: number
  total_elements: number
  llm_note: string | null
  delta_30d: number | null       // pt change vs 30 days ago, e.g., -37
}

// One active vote per (intent, voter). Voter is a hash so
// even admins can't deanonymize. official_report is snapshotted
// at vote time so historical divergence is reproducible.
export type IntentPredictionRole =
  | 'engineering' | 'delivery' | 'sales' | 'finance' | 'management' | 'other'

export interface IntentPrediction {
  id: string
  intent_id: string
  voter_hash: string
  probability: number            // 0..100
  role_group: IntentPredictionRole | null
  official_report: number | null // snapshot at vote time, 0..100
  voted_at: string
  archived_at: string | null
}

// Judgment-history entries. Carries the actor's *name* (not just
// their auth uid) so the lineage survives rotation/leaving.
export type IntentLineageKind =
  | 'strategy' | 'allocation' | 'gaming' | 'audit' | 'financial'
  | 'foundation' | 'escalation' | 'revision' | 'local_optimization'

export interface IntentLineage {
  id: string
  intent_id: string
  occurred_at: string
  actor_name: string
  actor_role: string | null
  action_kind: IntentLineageKind
  body: string
  created_by: string | null
  created_at: string
}

/** Where a measure reading came from (intent_measure_readings.source). */
export type MeasureReadingSource =
  | 'manual' | 'copilot' | 'api' | 'mcp' | 'agent' | 'system' | 'backfill' | 'other'

/** One reading of a success condition, appended by the database whenever
 *  intents.actual_value / measured_at change. value null = the reading was cleared. */
export interface IntentMeasureReading {
  id: string
  intent_id: string
  value: number | null
  previous_value: number | null
  measured_at: string | null
  target_value: number | null
  direction: MeasureDirection | null
  unit: string | null
  source: MeasureReadingSource
  recorded_by: string | null
  recorded_by_name: string | null
  recorded_at: string
}

// Declared-vs-actual allocation snapshot. breakdown is the
// jsonb {"bucket name": headcount} that drives the Resource card.
export interface IntentResource {
  id: string
  intent_id: string
  captured_at: string
  declared_share: number | null    // 0..100 — what the strategy claims
  actual_share: number | null      // 0..100 — what bindings + assignees compute to
  total_headcount: number | null
  allocated_headcount: number | null
  breakdown: Record<string, number> | null
  note: string | null
}

// Conflict / Fallacy-of-Composition / Dimension-gap detector output.
export type IntentAlignmentKind = 'conflict' | 'composition_fallacy' | 'dimension_gap'
export type IntentAlignmentSeverity = 'info' | 'warn' | 'alert'

export interface IntentAlignment {
  id: string
  intent_id: string                  // parent under which alignment is evaluated
  detected_at: string
  kind: IntentAlignmentKind
  severity: IntentAlignmentSeverity
  title: string                      // "i2 ↔ i3 · shared 3 ML engineers"
  body: string | null
  involves_intent_ids: string[]      // the sub-intents that collide
  metadata: Record<string, unknown> | null
  resolved_at: string | null
}

// Push-back loop. When divergence/audit-drop/alignment triggers
// crosses threshold, an escalation row is opened and assigned
// to the decision_owner. Status closes when CEO decides.
export type IntentEscalationTrigger = 'divergence' | 'audit_drop' | 'alignment' | 'manual'
export type IntentEscalationStatus = 'awaiting' | 'maintained' | 'revised' | 'retired'

export interface IntentEscalation {
  id: string
  intent_id: string
  triggered_at: string
  trigger_kind: IntentEscalationTrigger
  trigger_summary: string            // "64pt divergence on i3"
  collected_context: string | null   // LLM-summarized field context
  flagged_assumptions: string[]      // e.g., ["Customer AI budget overestimated", …]
  decision_owner_name: string | null
  decision_owner_role: string | null
  status: IntentEscalationStatus
  decision_note: string | null
  decided_at: string | null
  decided_by: string | null
}

// AI Co-Pilot's "next move" suggestions. When accepted+converted,
// converted_element_id points at the Element born from the suggestion.
export type IntentNextActionStatus = 'proposed' | 'accepted' | 'rejected' | 'converted'

export interface IntentNextAction {
  id: string
  intent_id: string
  generated_at: string
  label: string                      // "A" / "B" / "C"
  title: string
  hypothesis: string | null
  status: IntentNextActionStatus
  converted_element_id: string | null
  order_index: number
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
// User-managed Data Tables (Notion-DB / Airtable / Supabase-Studio style).
// Independent of D/O/E — these are end-user-owned databases.
// =====================================================

export type DataTableStatus = 'active' | 'archived'
export type DataTableColumnType = 'text' | 'number' | 'date' | 'select' | 'checkbox'

export interface DataTable {
  id: string
  domain_id: string | null
  name: string
  description: string | null
  icon: string | null
  color: string | null
  status: DataTableStatus
  order_index: number | null
  /** The Table folder it sits in (none: at the top of the list). */
  folder_id: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface DataTableInsert {
  id?: string
  domain_id?: string | null
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  status?: DataTableStatus
  order_index?: number | null
  created_by?: string
}

export interface DataTableUpdate {
  domain_id?: string | null
  folder_id?: string | null
  name?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  status?: DataTableStatus
  order_index?: number | null
}

export interface DataTableColumn {
  id: string
  table_id: string
  name: string
  type: DataTableColumnType
  options: Json | null
  order_index: number
  created_at: string
}

export interface DataTableColumnInsert {
  id?: string
  table_id: string
  name: string
  type: DataTableColumnType
  options?: Json | null
  order_index?: number
}

export interface DataTableColumnUpdate {
  name?: string
  type?: DataTableColumnType
  options?: Json | null
  order_index?: number
}

export interface DataTableRow {
  id: string
  table_id: string
  order_index: number
  created_at: string
  updated_at: string
}

export interface DataTableRowInsert {
  id?: string
  table_id: string
  order_index?: number
}

export interface DataTableCell {
  row_id: string
  column_id: string
  value: Json | null
  updated_at: string
}

export interface DataTableCellInsert {
  row_id: string
  column_id: string
  value?: Json | null
}
