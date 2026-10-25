'use client';

// Compatibility facade: existing imports retain the same API while data lives with each concept.

export type { ExplorerData } from '@/Function/sync/explorerPatch';

export type {
  AgentRun,
  AlconObject,
  AlconObjectWithChildren,
  ApprovalState,
  CustomColumnWithValues,
  DataTable,
  DataTableColumn,
  DataTableColumnType,
  Domain,
  DomainAIConfig,
  DomainPrivacy,
  ElementApproval,
  ElementComment,
  ElementEdgeWithElement,
  ElementReaction,
  ElementWithDetails,
  Notification,
  NotificationKind,
  Phase,
  StrategyWithObjects,
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
  fileObjectUnderDomains,
  moveObject,
  renameObjectPrefix,
  reorderObjects,
  reorderObjectTabs,
  setObjectDomains,
  updateObject,
  useObjectTabs,
} from '@/ActivitySpace/execution/object/data';

export {
  addElementAssignee,
  addElementToObject,
  createElement,
  createSubelement,
  decideApproval,
  deleteElement,
  deleteSubelement,
  fetchElementApprovals,
  fetchElementWithDetails,
  getElementEdges,
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
  fetchCustomColumnsWithValues,
  fetchDomainCustomColumnsWithValues,
  fetchElementCustomColumnsWithValues,
  isPropertyWriteRefused,
  noticePropertyValueFailed,
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
  updateWorker,
  useAssignableWorkers,
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
  bulkInsertDataTableRows,
  createDataTable,
  useDataTables,
} from '@/ActivitySpace/sustainment/table/data';

export {
  archiveNotification,
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
  CARRY_OVER_REASON_PREFIX,
  createElementComment,
  deleteElementComment,
  fetchCommentReactions,
  fetchElementComments,
  invalidateCarryOverReasons,
  toggleReaction,
  updateElementComment,
  useCarryOverReasons,
  useElementCommentActivity,
  withCommentActivity,
  useElementComments,
} from '@/ActivitySpace/execution/element/commentData';

export { globalSearch, type SearchResult } from '@/Function/shared/searchData';

export {
  pingAgentRuntime,
  useAgentRun,
  type AgentStartOutcome,
} from '@/Function/copilot/agentData';

export {
  addIntentBinding,
  addIntentLineage,
  addStrategyChild,
  createIntent,
  createStrategy,
  createStrategyComment,
  deleteIntent,
  deleteStrategy,
  deleteStrategyComment,
  fetchStrategyElements,
  removeIntentBinding,
  removeStrategyChild,
  setStrategyObjects,
  updateIntent,
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
  type PhaseReschedule,
} from '@/ActivitySpace/strategy/phase/data';

export {
  useObjectMilestones,
} from '@/ActivitySpace/execution/object/milestoneData';
