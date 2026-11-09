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
} from '@/hooks/objectData';

export {
  addElementAssignee,
  addElementToObject,
  createElement,
  createSubElement,
  decideApproval,
  deleteElement,
  fetchElementApprovals,
  fetchElementWithDetails,
  getElementEdges,
  removeElementAssignee,
  removeElementFromObject,
  reorderElements,
  restoreElementsField,
  setElementIsApproval,
  updateElement,
  updateElements,
  noticeElementSaveFailed,
  isElementSaveRefused,
  useElementBlockers,
  useElementById,
  useParentElement,
  useSubElements,
  type SubElement,
} from '@/hooks/elementData';

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
} from '@/hooks/teamData';

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
} from '@/hooks/domainData';

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
} from '@/hooks/tableData';

export {
  archiveNotification,
  markAllNotificationsRead,
  markNotificationRead,
  notifyAboutElement,
  useNotifications,
} from '@/hooks/notificationData';

export {
  createElementTemplate,
  deleteElementTemplate,
  updateElementTemplate,
  useElementTemplates,
} from '@/hooks/templateData';

export {
  CARRY_OVER_REASON_PREFIX,
  createElementComment,
  deleteElementComment,
  fetchCommentReactions,
  fetchElementComments,
  invalidateCarryOverReasons,
  toggleReaction,
  useStrategyReactions,
  updateElementComment,
  useCarryOverReasons,
  useElementCommentActivity,
  withCommentActivity,
  useElementComments,
} from '@/hooks/commentData';

export { globalSearch, type SearchResult } from '@/Function/shared/searchData';

export {
  pingAgentRuntime,
  useAgentRun,
  type AgentStartOutcome,
} from '@/AIP/ai/agentData';

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
  linkObjectToStrategy,
  updateIntent,
  updateStrategy,
  placeStrategy,
  useIntentBindingsForTargets,
  useStrategies,
  useStrategiesInSpace,
  useStrategyComments,
  useStrategyIntentBundle,
  type IntentBundle,
} from '@/hooks/strategyData';

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
} from '@/hooks/phaseData';

export {
  createObjectMilestone,
  deleteObjectMilestone,
  updateObjectMilestone,
  useObjectMilestones,
} from '@/hooks/milestoneData';
