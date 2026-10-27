// =============================================================
// The Audit app's sample: two made-up workflows (order entry for a sales
// desk, invoice intake for accounting) with a fortnight of runs, so a Space
// with no AI workflows yet still shows what Audit reads and how.
//
// It lives only on screen. Nothing here is written to the database — the
// ledger is append-only and a sample in it could never be taken back — and
// it disappears the moment a real deployment reports. Its records are
// sealed into a chain the same way the database seals real ones, so the
// integrity check reads them like any other.
// =============================================================

import type {
  ChainStep, LedgerRun, StepActor, StepKind, StepOperation, StepResult,
  WorkflowDeploymentRecord, WorkflowRunRecord, WorkflowTemplateRecord,
} from './auditModel';

type Translate = (message: string) => string;

export interface AuditSample {
  templates: WorkflowTemplateRecord[];
  deployments: WorkflowDeploymentRecord[];
  runs: LedgerRun[];
  /** Every step in full, in chain order per deployment (seq counts from 1
   *  in each), not yet sealed. */
  steps: ChainStep[];
  domains: { id: string; name: string }[];
  workers: { id: string; name: string }[];
}

const SPACE = 'sample-space';
const ORDERS = 'sample-orders';
const INVOICES = 'sample-invoices';

// One step of a run: [step key, kind, connector, operation, result, actor, reason]
type Step = [string, StepKind, string | null, StepOperation, StepResult, StepActor, string | null];

const receiveOrder = (via: string): Step => ['receive', 'start', via, 'read', 'ok', 'system', null];
const ORDER_DONE: Step[] = [
  ['read', 'step', 'OCR', 'none', 'ok', 'ai_agent', null],
  ['match', 'step', 'Master data', 'read', 'ok', 'ai_agent', null],
  ['enter', 'step', 'Sales system', 'draft', 'ok', 'ai_agent', null],
  ['stock', 'step', 'Google Drive', 'read', 'ok', 'ai_agent', null],
  ['draft', 'step', null, 'none', 'ok', 'ai_agent', null],
];
const sendReply: Step = ['approve', 'step', 'Gmail', 'send', 'ok', 'ai_agent', null];
const end = (result: StepResult = 'ok'): Step => ['end', 'end', null, 'none', result, 'system', null];

/** The order desk's fortnight, newest last: what each run went through. */
function orderRuns(): Step[][] {
  const runs: Step[][] = [];
  for (let i = 0; i < 26; i++) {
    const via = i % 3 === 0 ? 'Fax' : 'Gmail';
    if (i === 6) { runs.push([receiveOrder(via), ...ORDER_DONE.slice(0, 1), ['match', 'exception', 'Master data', 'read', 'ok', 'ai_agent', 'unknown_item']]); continue; }
    if (i === 11) { runs.push([receiveOrder(via), ...ORDER_DONE, ['approve', 'approval', 'Slack', 'none', 'returned', 'human', null], end()]); continue; }
    if (i === 15) { runs.push([receiveOrder(via), ...ORDER_DONE.slice(0, 2), ['enter', 'step', 'Sales system', 'draft', 'failed', 'ai_agent', null]]); continue; }
    if (i === 19) { runs.push([receiveOrder(via), ...ORDER_DONE.slice(0, 1), ['read', 'exception', 'OCR', 'none', 'ok', 'ai_agent', 'low_confidence']]); continue; }
    if (i === 22) { runs.push([receiveOrder(via), ...ORDER_DONE, ['bulk-send', 'step', 'Gmail', 'send', 'blocked', 'ai_agent', null]]); continue; }
    if (i === 25) { runs.push([receiveOrder(via), ...ORDER_DONE, ['approve', 'approval', 'Slack', 'none', 'waiting', 'ai_agent', null]]); continue; }
    // Every fourth reply goes to a person before it is sent.
    runs.push(i % 4 === 1
      ? [receiveOrder(via), ...ORDER_DONE, ['approve', 'approval', 'Slack', 'none', 'approved', 'human', null], sendReply, end()]
      : [receiveOrder(via), ...ORDER_DONE, sendReply, end()]);
  }
  return runs;
}

function invoiceRuns(): Step[][] {
  const intake: Step[] = [
    ['receive', 'start', 'Gmail', 'read', 'ok', 'system', null],
    ['read', 'step', 'OCR', 'none', 'ok', 'ai_agent', null],
  ];
  const runs: Step[][] = [];
  for (let i = 0; i < 11; i++) {
    if (i === 7) { runs.push([...intake, ['match', 'exception', 'Purchase orders', 'read', 'ok', 'ai_agent', 'amount_mismatch']]); continue; }
    runs.push([...intake, ['match', 'step', 'Purchase orders', 'read', 'ok', 'ai_agent', null], ['post', 'step', 'freee', 'draft', 'ok', 'ai_agent', null], end()]);
  }
  return runs;
}

/** The sample as of `now`: runs spread over the last two weeks. */
export function buildAuditSample(now: Date, t: Translate): AuditSample {
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();
  const salesDesk = { id: 'sample-domain-sales', name: t('Sales desk') };
  const accounting = { id: 'sample-domain-accounting', name: t('Accounting') };
  const orderAgent = { id: 'sample-worker-orders', name: t('Order agent') };
  const invoiceAgent = { id: 'sample-worker-invoices', name: t('Invoice agent') };

  const templates: WorkflowTemplateRecord[] = [
    {
      id: 'sample-template-orders', key: 'order-entry', version: 4, name: t('Order entry and delivery replies'),
      purpose: t('Read orders that arrive by fax or email, enter them in the sales system and draft the delivery reply, so the sales desk spends its time on customers.'),
      steps: [
        { key: 'receive', label: t('Receive the order') }, { key: 'read', label: t('Read the order form') },
        { key: 'match', label: t('Match customer and item') }, { key: 'enter', label: t('Enter it in the sales system') },
        { key: 'stock', label: t('Check stock and delivery date') }, { key: 'draft', label: t('Draft the reply') },
        { key: 'approve', label: t('Approve and send') },
      ],
    },
    {
      id: 'sample-template-invoices', key: 'invoice-intake', version: 2, name: t('Invoice intake and journal drafts'),
      purpose: t('Read supplier invoices, match them against purchase orders and draft the journal entry in the accounting software.'),
      steps: [
        { key: 'receive', label: t('Receive the invoice') }, { key: 'read', label: t('Read the invoice') },
        { key: 'match', label: t('Match the purchase order') }, { key: 'post', label: t('Draft the journal entry') },
      ],
    },
  ];
  const deployments: WorkflowDeploymentRecord[] = [
    { id: ORDERS, activity_space_id: SPACE, template_id: 'sample-template-orders', name: t('Order entry (sales desk)'), domain_id: salesDesk.id, object_id: null, worker_id: orderAgent.id, state: 'live', minutes_per_item: 5, created_at: minutesAgo(60 * 24 * 40) },
    { id: INVOICES, activity_space_id: SPACE, template_id: 'sample-template-invoices', name: t('Invoice intake (accounting)'), domain_id: accounting.id, object_id: null, worker_id: invoiceAgent.id, state: 'trial', minutes_per_item: 6, created_at: minutesAgo(60 * 24 * 12) },
  ];

  const runs: LedgerRun[] = [];
  const steps: ChainStep[] = [];
  const add = (deploymentId: string, prefix: string, version: number, plan: Step[][], spacing: number) => {
    let seq = 0;
    plan.forEach((list, index) => {
      const startedMinutesAgo = (plan.length - index) * spacing + 7;
      const run: WorkflowRunRecord = {
        id: `${deploymentId}-run-${index}`, deployment_id: deploymentId, external_id: `${deploymentId}-${index}`,
        template_version: version, subject_ref: `${prefix}-${1200 + index}`,
        subject_digest: (index * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8), started_at: minutesAgo(startedMinutesAgo),
      };
      const runSteps: ChainStep[] = list.map(([step_key, kind, connector, operation, result, actor_kind, reason], i) => ({
        id: `${run.id}-${i}`, run_id: run.id, deployment_id: deploymentId, step_key, kind,
        connector: connector && t(connector), operation, result, actor_kind,
        actor_name: actor_kind === 'human' ? t('Sales desk') : actor_kind === 'ai_agent' ? (deploymentId === ORDERS ? orderAgent.name : invoiceAgent.name) : null,
        reason, occurred_at: minutesAgo(startedMinutesAgo - i * 0.4), duration_ms: 300 + ((index * 7 + i * 13) % 9) * 110,
        seq: ++seq, prev_hash: '', hash: '',
        run: { external_id: run.external_id, subject_ref: run.subject_ref, subject_digest: run.subject_digest, started_at: run.started_at },
      }));
      runs.push({ ...run, steps: runSteps.map(({ seq, step_key, kind, connector, operation, result, reason }) => ({ seq, step_key, kind, connector, operation, result, reason })) });
      steps.push(...runSteps);
    });
  };
  add(ORDERS, 'PO', 4, orderRuns(), 13 * 60);
  add(INVOICES, 'INV', 2, invoiceRuns(), 26 * 60);
  runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return { templates, deployments, runs, steps, domains: [salesDesk, accounting], workers: [orderAgent, invoiceAgent] };
}
