'use client';

// Compatibility facade: existing imports retain the same API while data lives with each concept.

export type { ExplorerData } from '@/Function/sync/explorerPatch';

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

export { invalidateElementDetail } from '@/Function/sync/explorerCache';

export { useObjects } from '@/Function/sync/explorerData';

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
} from '@/ActivitySpace/execution/object/data';

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
} from '@/ActivitySpace/execution/element/data';

export {
  createCustomColumn,
  deleteCustomColumn,
  deleteCustomColumnObjectValue,
  deleteCustomColumnValue,
  fetchCustomColumns,
  fetchCustomColumnsWithValues,
  fetchDomainCustomColumnsWithValues,
  fetchElementCustomColumnsWithValues,
  reorderCustomColumns,
  setCustomColumnObjectValue,
  setCustomColumnValue,
  updateCustomColumn,
} from '@/Function/property/data';

export {
  assignWorkersToElement,
  noticeSkippedAssignees,
  noticeAssignmentFailed,
  createWorker,
  deleteWorker,
  fetchAllWorkers,
  fetchAssignableWorkers,
  fetchWorkerAvailability,
  invalidateWorkersCache,
  updateWorker,
  useAssignableWorkers,
  useSelfWorker,
  useWorkerAvailability,
  useWorkerById,
  useWorkerCommitments,
  useWorkers,
  useWorkersByIds,
} from '@/ActivitySpace/sustainment/team/data';

export {
  addDomainElementType,
  addDomainObjectType,
  createDomain,
  deleteDomain,
  leaveDomain,
  fetchLabelUsageByDomain,
  mergeDomainLabelColors,
  removeDomainElementType,
  reorderDomains,
  setDomainLabelColor,
  updateDomain,
  useDomains,
} from '@/ActivitySpace/execution/domain/data';

export {
  createActivitySpace,
  deleteActivitySpace,
  fetchSpaceGuests,
  updateActivitySpace,
  useActivitySpaces,
  type SpaceGuestRow,
} from '@/Function/space/data';

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
} from '@/ActivitySpace/sustainment/table/data';

export {
  archiveNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyAboutElement,
  useNotifications,
} from '@/ActivitySpace/execution/element/notificationData';

export {
  createElementTemplate,
  deleteElementTemplate,
  updateElementTemplate,
  useElementTemplates,
} from '@/ActivitySpace/execution/element/templateData';

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
  useElementCommentActivity,
  withCommentActivity,
  useElementComments,
  type CarryOverReason,
  type ElementCommentActivity,
} from '@/ActivitySpace/execution/element/commentData';

export { globalSearch, type SearchResult } from '@/Function/shared/searchData';

export {
  cancelAgentRun,
  fetchAgentRunSteps,
  fetchLatestAgentRun,
  isAgentRunActive,
  pingAgentRuntime,
  startAgentRun,
  useAgentRun,
  type AgentStartOutcome,
} from '@/Function/copilot/agentData';

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
} from '@/ActivitySpace/strategy/initiative/strategyData';

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
} from '@/ActivitySpace/strategy/phase/data';

export {
  createObjectMilestone,
  deleteObjectMilestone,
  fetchObjectMilestones,
  updateObjectMilestone,
  useObjectMilestones,
} from '@/ActivitySpace/execution/object/milestoneData';
