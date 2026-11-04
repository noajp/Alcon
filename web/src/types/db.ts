// The typed `Database` the Supabase client is built with.
//
// `supabase.ts` is generated from the live schema and is the source of truth
// for which tables and columns exist and which may be null. Postgres cannot
// tell the generator two things the app relies on: the value set a CHECK
// constraint allows on a text column, and the shape of a jsonb column. Those
// narrowings live here, in one place, instead of as casts at every query.
//
// Rules for a column override:
//   - name the narrowed, non-null type; a nullable text/number column stays
//     nullable (`| null` is added from the generated type);
//   - a jsonb column is generated as `Json` (which already includes null), so
//     its override states nullability itself;
//   - only narrow what the DB actually guarantees (a CHECK constraint, or a
//     jsonb shape every writer produces). A column that does not exist in the
//     generated table is a type error below, so a stale override cannot hide.

import type { Database as Generated, Json } from './supabase'
import type * as H from './database'
import type {
  AgentActionStatus, AgentRunMode, AgentRunStatus, AgentRunStepType, ApprovalState,
  AssetKind, AssetStatus, CodeChangeState, CommentAuthorKind, CustomColumnOptions, CustomColumnType,
  DataTableColumnType, DataTableStatus, DomainAIConfig, DomainMemberRole, DomainPhaseDefaults,
  DomainPrivacy, DomainRiskThresholds, EdgeType, ElementDirection, ElementPriority, ElementStatus,
  IntentAlignmentKind, IntentAlignmentSeverity, IntentBindingTarget, IntentEscalationStatus,
  IntentEscalationTrigger, IntentKind, IntentLineageKind, IntentNextActionStatus, IntentPredictionRole,
  IntentRelationship, IntentStatus, InvitationRole, InvitationStatus, MeasureDirection,
  MeasureReadingSource, MemberRole, NotificationKind, ObjectTabType, PersonalAccessTokenAccess,
  PhaseStatus, StrategyDelegation, StrategyScope, StrategyStatus, WorkerAvailabilityKind, WorkerSkillLevel,
  Element, ElementComment, IssuedPersonalAccessToken,
} from './database'
import type { ElementImportResult, ElementImportRow } from '@/Function/shared/element/intakeModel'
import type { DeploymentGrant, GrantOperation } from '@/Function/audit/auditModel'
import type { DefaultPlacement } from '@/Function/widget/boardModel'
import type { WidgetParams, WidgetSize } from '@/Function/widget/types'

type WorkerType = 'human' | 'ai_agent' | 'robot'
type WorkerStatus = 'active' | 'inactive' | 'busy'
type AssigneeRole = 'assignee' | 'reviewer' | 'collaborator'

/** Column overrides per table, applied to Row, Insert and Update alike. */
interface ColumnOverrides {
  activity_spaces: { scope: 'audit' | 'full' }
  // The chat transcript; readers check Array.isArray before use.
  ai_sessions: { messages: unknown[] }
  domains: {
    privacy: DomainPrivacy
    ai_config: DomainAIConfig | null
    element_types: string[]
    label_colors: Record<string, string>
    risk_thresholds: DomainRiskThresholds
    phase_defaults: DomainPhaseDefaults
  }
  domain_members: { role: DomainMemberRole }
  object_members: { role: MemberRole }
  membership_invitations: { role: InvitationRole; status: InvitationStatus }
  elements: {
    // CHECK (labels is null or jsonb_typeof(labels) = 'array')
    labels: string[] | null
    status: ElementStatus
    priority: ElementPriority
    direction: ElementDirection | null
    approval_state: ApprovalState
  }
  element_templates: {
    status: ElementStatus
    priority: ElementPriority
    labels: string[]
    assignee_worker_ids: string[]
  }
  workers: { type: WorkerType; status: WorkerStatus }
  worker_availability: { kind: WorkerAvailabilityKind }
  worker_skills: { level: WorkerSkillLevel }
  element_assignees: { role: AssigneeRole }
  element_edges: { edge_type: EdgeType }
  element_comments: { author_kind: CommentAuthorKind }
  element_approvals: { state: ApprovalState }
  notifications: { kind: NotificationKind }
  custom_columns: { column_type: CustomColumnType; options: CustomColumnOptions }
  object_tabs: { tab_type: ObjectTabType }
  strategies: { status: StrategyStatus; scope: StrategyScope; delegation: StrategyDelegation }
  strategy_comments: { author_kind: CommentAuthorKind }
  phases: { status: PhaseStatus }
  tables: { status: DataTableStatus }
  table_columns: { type: DataTableColumnType }
  intents: { kind: IntentKind; direction: MeasureDirection; status: IntentStatus }
  intent_bindings: { target_type: IntentBindingTarget; relationship_type: IntentRelationship }
  intent_predictions: { role_group: IntentPredictionRole }
  intent_lineage: { action_kind: IntentLineageKind }
  intent_measure_readings: { direction: MeasureDirection; source: MeasureReadingSource }
  intent_resources: { breakdown: Record<string, number> | null }
  intent_alignments: {
    kind: IntentAlignmentKind
    severity: IntentAlignmentSeverity
    metadata: Record<string, unknown> | null
  }
  intent_escalations: { trigger_kind: IntentEscalationTrigger; status: IntentEscalationStatus }
  intent_next_actions: { status: IntentNextActionStatus }
  agent_runs: { status: AgentRunStatus; mode: AgentRunMode }
  agent_run_steps: { type: AgentRunStepType }
  agent_actions: {
    input: { calls?: { id: string; name: string; input: Record<string, unknown> }[] }
    status: AgentActionStatus
    result: Record<string, unknown> | null
  }
  integrations: {
    kind: 'mcp' | 'http' | 'model'
    auth_type: 'none' | 'bearer' | 'header' | 'oauth'
    delegation: 'approve_each' | 'full_delegation'
  }
  code_changes: { provider: 'github'; state: CodeChangeState; linked_via: 'manual' | 'agent' }
  code_change_reviews: { verdict: 'comment' | 'matches' | 'needs_changes' }
  code_change_comments: { side: 'old' | 'new' }
  assets: {
    kind: AssetKind
    status: AssetStatus
    manifest: Record<string, Json>
    observed: Record<string, Json>
  }
  personal_access_tokens: { access: PersonalAccessTokenAccess }
  // A widget's own contents: a JSON object per part, merged key by key.
  widget_documents: { value: Record<string, unknown> }
  widget_viewer_state: { value: Record<string, unknown> }
  widgets: { params: WidgetParams }
  deployment_grants: { operation: GrantOperation }
  // CHECK (jsonb_typeof(grants) = 'array'); written by the grant trigger.
  deployment_grant_versions: { grants: DeploymentGrant[] }
}

/**
 * NOT NULL columns a BEFORE INSERT trigger fills, so an insert may leave them
 * out even though the generator marks them required.
 */
interface TriggerFilledColumns {
  // deployment_grants_fill_space: copied from the deployment.
  deployment_grants: 'activity_space_id'
}

/**
 * RPC overrides. The generator renders every argument as non-null and every
 * jsonb result as `Json`; these name the arguments a function accepts as null
 * (it handles null in SQL) and the shape of a jsonb result. A result the
 * caller validates at runtime stays `Partial<...> | null`, so the check is
 * still needed.
 */
interface FunctionOverrides {
  check_in_element: {
    Args: {
      p_expected_updated_at: string | null
      p_patch?: { status?: ElementStatus; next?: string | null }
    }
    Returns: Partial<{ element: Element; comment: ElementComment; replayed: boolean }> | null
  }
  create_personal_access_token: {
    Args: { p_expires_days?: number | null; p_access?: PersonalAccessTokenAccess }
    Returns: IssuedPersonalAccessToken
  }
  import_existing_work: {
    Args: { p_object_id: string | null; p_domain_id: string | null; p_project_name: string | null; p_rows: ElementImportRow[] }
    Returns: Partial<ElementImportResult & { objectId: string; replayed: boolean }> | null
  }
  list_assignable_workers: {
    Args: { p_space_id?: string | null; p_domain_id?: string | null; p_element_id?: string | null }
  }
  ensure_board: {
    Args: { p_instances?: DefaultPlacement[]; p_space_id?: string | null; p_subject_id?: string | null }
  }
  add_widget: { Args: { p_size?: WidgetSize | null; p_params?: WidgetParams } }
  merge_widget_params: { Args: { p_patch: WidgetParams } }
  merge_widget_document: {
    Args: { p_set?: Record<string, unknown> }
    Returns: MergeColumns<GenFunctions['merge_widget_document']['Returns'], { value: Record<string, unknown> }>
  }
  get_explorer_data: { Args: { p_domain_id?: string | null; p_object_id?: string | null } }
  notify_about_element: { Args: { p_worker_id?: string | null } }
  decide_workflow_approval: { Args: { _note?: string | null } }
  resolve_work_import: {
    Returns: Partial<{ committed: boolean; available: boolean }> | null
  }
}

type GenTables = Generated['public']['Tables']
type GenFunctions = Generated['public']['Functions']

type MergeArgs<A, O> = { [K in keyof A]: K extends keyof O ? O[K] : A[K] }

type Functions = {
  [F in keyof GenFunctions]: F extends keyof FunctionOverrides
    ? {
        [P in keyof GenFunctions[F]]: P extends 'Args'
          ? FunctionOverrides[F] extends { Args: infer O } ? MergeArgs<GenFunctions[F]['Args'], O> : GenFunctions[F]['Args']
          : P extends 'Returns'
            ? FunctionOverrides[F] extends { Returns: infer R } ? R : GenFunctions[F]['Returns']
            : GenFunctions[F][P]
      }
    : GenFunctions[F]
}

// Every override must name a real table/function and real columns/arguments:
// after a regeneration drops one, these fail to compile instead of silently
// narrowing nothing.
type ExpectNever<T extends never> = T
type UnknownColumns = {
  [K in keyof ColumnOverrides]: K extends keyof GenTables
    ? `${K}.${Exclude<keyof ColumnOverrides[K], keyof GenTables[K]['Row']> & string}`
    : K
}[keyof ColumnOverrides]
type UnknownArgs = {
  [F in keyof FunctionOverrides]: F extends keyof GenFunctions
    ? FunctionOverrides[F] extends { Args: infer O }
      ? `${F}.${Exclude<keyof O, keyof GenFunctions[F]['Args']> & string}`
      : never
    : F
}[keyof FunctionOverrides]
export type OverridesNameRealColumns = ExpectNever<UnknownColumns>
export type OverridesNameRealArgs = ExpectNever<UnknownArgs>

type Narrow<Db, To> = [Json] extends [Db] ? To : null extends Db ? To | null : To

type MergeColumns<R, O> = {
  [K in keyof R]: K extends keyof O ? Narrow<R[K], O[K]> : R[K]
}

type ColumnsOf<T> = T extends keyof ColumnOverrides ? ColumnOverrides[T] : object
type FilledOf<T> = T extends keyof TriggerFilledColumns ? TriggerFilledColumns[T] : never

/** `I` with the keys `K` optional (flattened, so it stays a plain object type). */
type OptionalKeys<I, K extends PropertyKey> = {
  [P in keyof I as P extends K ? never : P]: I[P]
} & {
  [P in keyof I as P extends K ? P : never]?: I[P]
}
type Flatten<T> = { [K in keyof T]: T[K] }

type Tables = {
  [T in keyof GenTables]: T extends keyof ColumnOverrides | keyof TriggerFilledColumns
    ? {
        Row: MergeColumns<GenTables[T]['Row'], ColumnsOf<T>>
        Insert: Flatten<OptionalKeys<MergeColumns<GenTables[T]['Insert'], ColumnsOf<T>>, FilledOf<T>>>
        Update: MergeColumns<GenTables[T]['Update'], ColumnsOf<T>>
        Relationships: GenTables[T]['Relationships']
      }
    : GenTables[T]
}

type PublicSchema = {
  [P in keyof Generated['public']]: P extends 'Tables' ? Tables : P extends 'Functions' ? Functions : Generated['public'][P]
}

export type Database = {
  [S in keyof Generated]: S extends 'public' ? PublicSchema : Generated[S]
}

export type { Json }
export type TableRow<T extends keyof Tables> = Tables[T]['Row']
export type TableInsert<T extends keyof Tables> = Tables[T]['Insert']
export type TableUpdate<T extends keyof Tables> = Tables[T]['Update']

// The hand-written row types in ./database stay usable as views of these
// rows: every column they name exists, and every value the table can hold
// fits them. A regeneration that drops or widens a column fails here.
type Compatible<Row, Hand> = [Row] extends [Hand]
  ? [Exclude<keyof Hand, keyof Row>] extends [never] ? true : { notInTable: Exclude<keyof Hand, keyof Row> }
  : { rowDoesNotFit: Hand }
type ExpectTrue<T extends true> = T
interface RowChecks {
  activity_spaces: Compatible<TableRow<'activity_spaces'>, H.ActivitySpace>
  activity_space_members: Compatible<TableRow<'activity_space_members'>, H.ActivitySpaceMember>
  domains: Compatible<TableRow<'domains'>, H.Domain>
  membership_invitations: Compatible<TableRow<'membership_invitations'>, H.MembershipInvitation>
  object_domains: Compatible<TableRow<'object_domains'>, H.ObjectDomain>
  objects: Compatible<TableRow<'objects'>, H.AlconObject>
  elements: Compatible<TableRow<'elements'>, H.Element>
  workers: Compatible<TableRow<'workers'>, H.Worker>
  element_assignees: Compatible<TableRow<'element_assignees'>, H.ElementAssignee>
  element_edges: Compatible<TableRow<'element_edges'>, H.ElementEdge>
  custom_columns: Compatible<TableRow<'custom_columns'>, H.CustomColumn>
  custom_column_values: Compatible<TableRow<'custom_column_values'>, H.CustomColumnValue>
  custom_column_placements: Compatible<TableRow<'custom_column_placements'>, H.CustomColumnPlacement>
  object_tabs: Compatible<TableRow<'object_tabs'>, H.ObjectTab>
  strategies: Compatible<TableRow<'strategies'>, H.Strategy>
  strategy_objects: Compatible<TableRow<'strategy_objects'>, H.StrategyObject>
  strategy_comments: Compatible<TableRow<'strategy_comments'>, H.StrategyComment>
  phases: Compatible<TableRow<'phases'>, H.Phase>
  tables: Compatible<TableRow<'tables'>, H.DataTable>
  table_columns: Compatible<TableRow<'table_columns'>, H.DataTableColumn>
  table_rows: Compatible<TableRow<'table_rows'>, H.DataTableRow>
  table_cells: Compatible<TableRow<'table_cells'>, H.DataTableCell>
  strategy_children: Compatible<TableRow<'strategy_children'>, H.StrategyChild>
  intents: Compatible<TableRow<'intents'>, H.Intent>
  intent_bindings: Compatible<TableRow<'intent_bindings'>, H.IntentBinding>
  intent_audits: Compatible<TableRow<'intent_audits'>, H.IntentAudit>
  intent_predictions: Compatible<TableRow<'intent_predictions'>, H.IntentPrediction>
  intent_lineage: Compatible<TableRow<'intent_lineage'>, H.IntentLineage>
  intent_measure_readings: Compatible<TableRow<'intent_measure_readings'>, H.IntentMeasureReading>
  intent_resources: Compatible<TableRow<'intent_resources'>, H.IntentResource>
  intent_alignments: Compatible<TableRow<'intent_alignments'>, H.IntentAlignment>
  intent_escalations: Compatible<TableRow<'intent_escalations'>, H.IntentEscalation>
  intent_next_actions: Compatible<TableRow<'intent_next_actions'>, H.IntentNextAction>
  object_milestones: Compatible<TableRow<'object_milestones'>, H.ObjectMilestone>
  agent_runs: Compatible<TableRow<'agent_runs'>, H.AgentRun>
  agent_run_steps: Compatible<TableRow<'agent_run_steps'>, H.AgentRunStep>
  integrations: Compatible<TableRow<'integrations'>, H.Integration>
  code_changes: Compatible<TableRow<'code_changes'>, H.CodeChange>
  code_change_reviews: Compatible<TableRow<'code_change_reviews'>, H.CodeChangeReview>
  code_change_comments: Compatible<TableRow<'code_change_comments'>, H.CodeChangeComment>
  domain_members: Compatible<TableRow<'domain_members'>, H.DomainMember>
  object_members: Compatible<TableRow<'object_members'>, H.ObjectMember>
  element_objects: Compatible<TableRow<'element_objects'>, H.ElementObject>
  worker_availability: Compatible<TableRow<'worker_availability'>, H.WorkerAvailability>
  worker_skills: Compatible<TableRow<'worker_skills'>, H.WorkerSkill>
  element_comments: Compatible<TableRow<'element_comments'>, H.ElementComment>
  element_reactions: Compatible<TableRow<'element_reactions'>, H.ElementReaction>
  notifications: Compatible<TableRow<'notifications'>, H.Notification>
  element_approvals: Compatible<TableRow<'element_approvals'>, H.ElementApproval>
  assets: Compatible<TableRow<'assets'>, H.Asset>
  asset_events: Compatible<TableRow<'asset_events'>, H.AssetEvent>
  personal_access_tokens: Compatible<TableRow<'personal_access_tokens'>, H.PersonalAccessToken>
  agent_actions: Compatible<TableRow<'agent_actions'>, H.AgentAction>
  element_templates: Compatible<TableRow<'element_templates'>, H.ElementTemplate>
}
export type HandWrittenRowsMatchSchema = ExpectTrue<RowChecks[keyof RowChecks]>
