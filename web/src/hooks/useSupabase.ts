'use client';

// Compatibility facade: existing imports retain the same API while data lives with each concept.

export type { ExplorerData } from '@/alcon/sync/explorerPatch';

export type {
  AgentRun,
  AgentRunStatus,
  AgentRunStep,
  AlconObject,
  AlconObjectWithChildren,
  ApprovalState,
  CustomColumn,
  CustomColumnType,
  CustomColumnValue,
  CustomColumnWithValues,
  DataTable,
  DataTableCell,
  DataTableColumn,
  DataTableColumnType,
  DataTableRow,
  Domain,
  DomainAIConfig,
  DomainMember,
  DomainMemberInsert,
  DomainPrivacy,
  EdgeType,
  Element,
  ElementApproval,
  ElementAssignee,
  ElementAssigneeWithWorker,
  ElementComment,
  ElementEdge,
  ElementEdgeWithElement,
  ElementObject,
  ElementReaction,
  ElementWithDetails,
  Notification,
  NotificationKind,
  ObjectDomain,
  ObjectMember,
  ObjectMemberInsert,
  ObjectMilestone,
  ObjectTab,
  ObjectTabType,
  Phase,
  Strategy,
  StrategyComment,
  StrategyCommentInsert,
  StrategyObject,
  StrategyStatus,
  StrategyWithObjects,
  Subelement,
  Worker,
  WorkerAvailability,
  WorkerAvailabilityKind,
} from '@/types/database';

export { invalidateElementDetail } from '@/alcon/sync/explorerCache';

export { useObjects } from '@/alcon/sync/explorerData';

export {
  createObject,
  createObjectTab,
  deleteObject,
  deleteObjectTab,
  fetchObjectDomainIds,
  fetchObjectLabels,
  fetchObjectTabs,
  moveObject,
  renameObjectPrefix,
  reorderObjects,
  reorderObjectTabs,
  setObjectDomains,
  updateObject,
  updateObjectTab,
  useObjectTabs,
} from '@/alcon/object/data';

export {
  addElementAssignee,
  addElementToObject,
  canElementStart,
  createElement,
  createElementEdge,
  createSubelement,
  decideApproval,
  deleteElement,
  deleteElementEdge,
  deleteSubelement,
  fetchElementApprovals,
  fetchElementWithDetails,
  getElementAssignees,
  getElementEdges,
  getElementObjects,
  removeElementAssignee,
  removeElementFromObject,
  reorderElements,
  setElementIsApproval,
  toggleSubelementComplete,
  updateElement,
  updateSubelement,
  useElementBlockers,
} from '@/alcon/element/data';

export {
  createCustomColumn,
  deleteCustomColumn,
  deleteCustomColumnObjectValue,
  deleteCustomColumnValue,
  deleteIntersection,
  fetchCustomColumns,
  fetchCustomColumnsWithValues,
  fetchDomainCustomColumnsWithValues,
  fetchElementCustomColumnsWithValues,
  getIntersections,
  reorderCustomColumns,
  setCustomColumnObjectValue,
  setCustomColumnValue,
  updateCustomColumn,
  upsertIntersection,
} from '@/alcon/property/data';

export {
  createWorker,
  deleteWorker,
  fetchAllWorkers,
  fetchWorkerAvailability,
  invalidateWorkersCache,
  updateWorker,
  useWorkerAvailability,
  useWorkerCommitments,
  useWorkers,
} from '@/alcon/team/data';

export {
  addDomainElementType,
  addDomainObjectType,
  createDomain,
  deleteDomain,
  fetchLabelUsageByDomain,
  mergeDomainLabelColors,
  removeDomainElementType,
  reorderDomains,
  setDomainLabelColor,
  updateDomain,
  useDomains,
} from '@/alcon/domain/data';

export {
  createActivitySpace,
  deleteActivitySpace,
  fetchSpaceGuests,
  updateActivitySpace,
  useActivitySpaces,
  type SpaceGuestRow,
} from '@/alcon/space/data';

export {
  addDataTableColumn,
  addDataTableColumns,
  addDataTableRow,
  bulkInsertDataTableRows,
  createDataTable,
  deleteDataTable,
  fetchDataTableSchema,
  setDataTableCell,
  updateDataTable,
  useDataTables,
  type DataTableSchema,
  type DataTableWithRowCount,
} from '@/alcon/table/data';

export {
  archiveNotification,
  createNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyMany,
  useNotifications,
} from '@/alcon/element/notificationData';

export {
  createElementTemplate,
  deleteElementTemplate,
  updateElementTemplate,
  useElementTemplates,
} from '@/alcon/element/templateData';

export {
  addReaction,
  CARRY_OVER_REASON_PREFIX,
  createElementComment,
  deleteElementComment,
  fetchCommentReactions,
  fetchElementComments,
  invalidateCarryOverReasons,
  removeReaction,
  toggleReaction,
  updateElementComment,
  useCarryOverReasons,
  useElementActivity,
  useElementComments,
  type CarryOverReason,
  type ElementActivity,
} from '@/alcon/element/commentData';

export { globalSearch, type SearchResult } from '@/alcon/shared/searchData';

export {
  cancelAgentRun,
  fetchAgentRunSteps,
  fetchLatestAgentRun,
  isAgentRunActive,
  pingAgentRuntime,
  startAgentRun,
  useAgentRun,
} from '@/alcon/copilot/agentData';

export {
  addIntentBinding,
  addIntentLineage,
  addStrategyChild,
  castIntentPrediction,
  createIntent,
  createStrategy,
  createStrategyComment,
  decideIntentEscalation,
  deleteIntent,
  deleteStrategy,
  deleteStrategyComment,
  fetchStrategyComments,
  fetchStrategyElements,
  removeIntentBinding,
  removeStrategyChild,
  setStrategyObjects,
  updateIntent,
  updateIntentNextActionStatus,
  updateStrategy,
  useIntentBindingsForTargets,
  useStrategies,
  useStrategyComments,
  useStrategyIntentBundle,
  type IntentBundle,
} from '@/alcon/element/actions/strategyData';

export {
  closePhase,
  createPhase,
  deletePhase,
  fetchPhaseCandidates,
  reopenPhase,
  updatePhase,
  usePhaseReschedules,
  usePhases,
  type PhaseCandidateElement,
  type PhaseReschedule,
} from '@/alcon/phase/data';

export {
  createObjectMilestone,
  deleteObjectMilestone,
  fetchObjectMilestones,
  updateObjectMilestone,
  useObjectMilestones,
} from '@/alcon/object/milestoneData';
