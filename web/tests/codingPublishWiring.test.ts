import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The publish's wiring (coding capability PR3): what the pure tests
// cannot judge — that run-agent actually composes the patch into
// governed calls on the GitHub connection and judges them with the
// run's own machinery, that the publish rests as one batch carrying
// its finish, that a decision on the batch seals that finish, and
// that the PR lands as a created entity on both surfaces. Pinned on
// source, the repo's convention for Edge I/O (codingWiring.test.ts
// is the model).
const runAgent = readFileSync(new URL('../../supabase/functions/run-agent/index.ts', import.meta.url), 'utf8');
const decision = readFileSync(new URL('../../supabase/functions/run-agent/decision.ts', import.meta.url), 'utf8');
const createdEntities = readFileSync(new URL('../../supabase/functions/_shared/createdEntities.ts', import.meta.url), 'utf8');
const delivery = readFileSync(new URL('../../supabase/functions/_shared/codingDelivery.ts', import.meta.url), 'utf8');
const card = readFileSync(new URL('../src/AIP/ai/CreatedEntityCard.tsx', import.meta.url), 'utf8');
const steps = readFileSync(new URL('../src/AIP/ai/copilotSteps.ts', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/ActivitySpace/execution/element/agent/AgentRunPanel.tsx', import.meta.url), 'utf8');

// The publish function's own region of run-agent, so the pins judge
// the publish's composition, not some other call site of the same
// helpers.
const pubStart = runAgent.indexOf('const publishCodingChange');
const pubEnd = runAgent.indexOf('if (codingDecl && machine && !run.rehearsal && !planRun)', pubStart);
const pub = runAgent.slice(pubStart, pubEnd);

describe('run-agent composes the publish as governed calls', () => {
  it('finds the publish region', () => {
    expect(pubStart).toBeGreaterThan(-1);
    expect(pubEnd).toBeGreaterThan(pubStart);
    expect(pub).toContain('composePublish');
  });

  it('composes from the pure core and resolves the connection’s declared commands by their wrapped tool', () => {
    expect(pub).toContain('parsePatchFiles(input.changeSet.patch)');
    // The resolver itself was hoisted above the publish in PR4 so
    // the amend composes through the same one (#7); the pin on its
    // matching rule now reads the whole file, and the publish's own
    // region pins which commands it resolves.
    expect(runAgent).toContain('publishCommandKind(it.command) === kind');
    expect(pub).toContain('publishToolFor("create_branch")');
    expect(pub).toContain('publishToolFor("push_files")');
    expect(pub).toContain('publishToolFor("delete_file")');
    expect(pub).toContain('publishToolFor("create_pull_request")');
    // One branch at the base, one files call carrying the whole
    // tree, deletions by their base blob SHA, then the PR.
    expect(pub).toContain('from_branch: target.baseBranch');
    expect(pub).toContain('files: plan.writes');
    expect(pub).toContain('sha: d.sha');
    expect(pub).toContain('head: plan.pr.head, base: plan.pr.base');
  });

  it('refuses on a moved base before composing anything', () => {
    expect(pub).toContain('fetchBaseSha(tokens, target)');
    expect(pub).toContain('if (currentBase !== baseSha)');
    expect(pub.indexOf('if (currentBase !== baseSha)')).toBeLessThan(pub.indexOf('composePublish({'));
  });

  it('reads base files through the connection’s token plumbing — reads server-side, writes governed', () => {
    expect(pub).toContain('githubTokens(admin, run.activity_space_id)');
    expect(pub).toContain('fetchRepoFileAtSha(tokens, target, pf.oldPath, baseSha)');
    expect(delivery).toContain('export async function fetchRepoFileAtSha');
    expect(delivery).toContain('/contents/${encoded}?ref=');
  });

  it('judges every call with the run’s own machinery: breaker before verdict, deny refuses', () => {
    expect(pub).toContain('const hold = await breakerHold(call);');
    expect(pub).toContain('const v = verdictForCall(call);');
    expect(pub.indexOf('breakerHold(call)')).toBeLessThan(pub.indexOf('verdictForCall(call);'));
    expect(pub).toContain('if (v.base === "deny")');
    expect(pub).toContain('if (v.final === "ask") mustRest = true;');
    expect(pub).toContain('if (trip) mustRest = true;');
  });

  it('the critical class rests the batch whatever the verdicts say (§7)', () => {
    expect(pub).toContain('const critical = publishIsCritical(codingDecl, target.repo);');
    expect(pub).toContain('let mustRest = critical;');
    // The rest itself carries the critical reason onto the approval
    // (restPublishBatch stands just above the publish in the file).
    expect(runAgent).toContain('publishCriticalReason(codingDecl, codingSession?.target.repo ?? "")');
  });

  it('an unrested batch executes through executeCall — the one call seam, with its log, verify and PR link', () => {
    expect(pub).toContain('const r = await executeCall(call);');
    expect(pub).toContain('recordPolicyApproval(admin, {');
    expect(pub).toContain('settlePolicyApproval(admin, publishPolicyActionId, !r.is_error, r.verify)');
    expect(pub).toContain('notePublishLanded(r.content)');
  });

  it('runs once per run: a prior publish step is the record', () => {
    expect(pub).toContain('priorPublish');
    expect(pub).toContain('title.like.PR を開きました:%');
  });
});

describe('the publish rest carries its finish to the decision', () => {
  it('SavedPending has the publish rest: finish, verdict, the PR call’s id', () => {
    expect(decision).toContain('publish?: {');
    expect(decision).toContain('finish: FinishPayload;');
    expect(decision).toContain('prCallId: string;');
  });

  it('the rest is parked as one batch approval, its marker on the action’s input', () => {
    expect(runAgent).toContain('const restPublishBatch');
    expect(runAgent).toContain('const pubPending: SavedPending = { calls, partial: [], publish: settle };');
    expect(runAgent).toContain('publish: {');
    expect(runAgent).toContain('critical: opts.critical');
  });

  it('a decision on the batch seals the carried finish and never resumes the loop', () => {
    expect(runAgent).toContain('if (standingPublish && decisionOutcome.decided && !decisionOutcome.continued)');
    expect(runAgent).toContain('await settleFinish(standingPublish.finish, standingPublish.verdict);');
    expect(runAgent).toContain('standingPublish.prCallId');
  });

  it('rejecting the batch is not an incident against the publish commands', () => {
    expect(runAgent).toContain('if (standingPublish) return;');
  });
});

describe('the finish path publishes before it seals', () => {
  it('only a completed finish with a non-empty change set publishes, and a rest defers the seal', () => {
    expect(runAgent).toContain('codingChangeSet = await produceCodingPatch()');
    expect(runAgent).toContain('if (codingSession?.delivered && codingDecl && codingChangeSet && !codingChangeSet.empty)');
    expect(runAgent).toContain('publishCodingChange({ finish: outcome.finish, verdict, changeSet: codingChangeSet })');
    const at = runAgent.indexOf('publishCodingChange({ finish: outcome.finish');
    expect(runAgent.indexOf('if (pub?.kind === "rested") return;', at)).toBeGreaterThan(at);
    expect(runAgent.indexOf('await settleFinish(outcome.finish, verdict);', at)).toBeGreaterThan(at);
  });

  it('the patch capture returns its change set to the publish (and still saves the artifact)', () => {
    expect(runAgent).toContain('const produceCodingPatch = async (): Promise<ChangeSet | null> =>');
    expect(runAgent).toContain('if (prior?.length) return cs;');
  });
});

describe('the PR as a created entity', () => {
  it('the extractor gains the pull_request kind, keyed on the code_changes row', () => {
    expect(createdEntities).toContain('"pull_request"');
    expect(createdEntities).toContain('export function pullRequestCreatedOf');
  });

  it('the landing step reads the link row back by element, repo and number', () => {
    expect(runAgent).toContain('const notePublishLanded');
    expect(runAgent).toContain('.from("code_changes")');
    expect(runAgent).toContain('"pull_request", `PR を開きました: ${ref.repo}#${ref.number}`');
    expect(runAgent).toContain('JSON.stringify({ created: [entity] })');
  });

  it('both surfaces render the one card family: chat steps and the run panel', () => {
    expect(steps).toContain("step.type === 'pull_request'");
    expect(steps).toContain("kind !== 'pull_request'");
    expect(panel).toContain("s.type !== 'pull_request'");
    expect(panel).toContain('CreatedEntityCard');
    expect(card).toContain('PullRequestCreatedCard');
    expect(card).toContain('useCodeChangeById(entity.id)');
    expect(card).toContain("case 'pull_request':");
  });
});
