import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Iteration's wiring (coding capability PR4): what the pure tests
// cannot judge — that the tick actually routes dev_events, that a
// follow-up run is born with its brief on the transcript and keeps
// it across slices, that its tree is delivered at the PR's recorded
// head (fixed SHA, never re-resolved), that its finish publishes
// through the PR3 path as an added commit on the same branch (never
// a second publisher), and that a rested amend settles under its
// own words. Pinned on source, the repo's convention for Edge I/O.
const runAgent = readFileSync(new URL('../../supabase/functions/run-agent/index.ts', import.meta.url), 'utf8');
const decision = readFileSync(new URL('../../supabase/functions/run-agent/decision.ts', import.meta.url), 'utf8');
const automations = readFileSync(new URL('../../supabase/functions/automations/index.ts', import.meta.url), 'utf8');
const iteration = readFileSync(new URL('../../supabase/functions/_shared/codingIteration.ts', import.meta.url), 'utf8');
const delivery = readFileSync(new URL('../../supabase/functions/_shared/codingDelivery.ts', import.meta.url), 'utf8');
const section = readFileSync(new URL('../src/ActivitySpace/execution/codeChanges/CodeChangesSection.tsx', import.meta.url), 'utf8');
const data = readFileSync(new URL('../src/hooks/codeChangeData.ts', import.meta.url), 'utf8');

describe('the tick routes the events', () => {
  it('the automations tick hosts the routing phase, acting as the publisher via the injected session factory', () => {
    expect(automations).toContain('routeCodingEvents');
    expect(automations).toContain('sessionFor }, now)');
    expect(automations).toContain('amendRunsStarted');
  });

  it('the router claims an event only once it is identified as the coding loop’s own', () => {
    const claimAt = iteration.indexOf('update({ consumed_at: now.toISOString() })');
    expect(claimAt).toBeGreaterThan(-1);
    // Identification and the coding gate both stand before the claim.
    expect(iteration.indexOf('identifyPullRequest(event)')).toBeLessThan(claimAt);
    expect(iteration.indexOf('if (!parsed.coding) return;')).toBeLessThan(claimAt);
    // And what is not claimed is left for its own consumer.
    expect(iteration).toContain('left unconsumed for its own consumer');
  });

  it('the follow-up run is born scoped, briefed, and driven as the person whose run opened the PR', () => {
    expect(iteration).toContain('triggered_from: "dev_event"');
    expect(iteration).toContain('codingAmend: brief');
    expect(iteration).toContain('prompt: amendPrompt(brief, event)');
    expect(iteration).toContain('rootChainScope({');
    // The round is claimed against the settled count before the run exists.
    const roundClaim = iteration.indexOf('update({ amend_rounds: rounds + 1 })');
    expect(roundClaim).toBeGreaterThan(-1);
    expect(roundClaim).toBeLessThan(iteration.indexOf('triggered_from: "dev_event"'));
  });

  it('CI state and PR state land on the code_changes record', () => {
    expect(iteration).toContain('ci_state: ci.state, ci_url: ci.url, ci_at: now.toISOString()');
    expect(iteration).toContain('upsertCodeChange(admin, change.element_id, ref, pull');
  });
});

describe('the follow-up run: brief, delivery, amend', () => {
  it('the brief is read from the transcript and re-spread by every save, like an approved plan', () => {
    expect(runAgent).toContain('const codingAmendBrief: CodingAmendBrief | null = parseCodingAmend(run.transcript?.codingAmend);');
    expect(runAgent).toContain('...(codingAmendBrief ? { codingAmend: codingAmendBrief } : {})');
    expect(runAgent).toContain('codingAmend?: CodingAmendBrief;');
  });

  it('delivery for a briefed run is at the recorded head SHA, through the same snapshot seam', () => {
    expect(delivery).toContain('export async function deliverTreeAtShaToWorkspace');
    expect(runAgent).toContain('deliverTreeAtShaToWorkspace({');
    expect(runAgent).toContain('sha: brief.headSha');
    // The declared set still governs a follow-up’s target.
    expect(runAgent).toContain('targetRefusalText("repo_outside_set", codingDecl)');
    // And the delivery step records the amend it belongs to.
    expect(runAgent).toContain('`amend=${brief.codeChangeId}`');
  });

  it('the finish dispatches to the amend on the brief, the publish otherwise — one seam, two shapes', () => {
    expect(runAgent).toContain('codingSession.amend');
    expect(runAgent).toContain('publishCodingAmend({ finish: outcome.finish, verdict, changeSet: codingChangeSet })');
    expect(runAgent).toContain('publishCodingChange({ finish: outcome.finish, verdict, changeSet: codingChangeSet })');
  });

  const amendStart = runAgent.indexOf('const publishCodingAmend');
  const amendEnd = runAgent.indexOf('if (codingDecl && machine && !run.rehearsal && !planRun)', amendStart);
  const amend = runAgent.slice(amendStart, amendEnd);

  it('finds the amend region', () => {
    expect(amendStart).toBeGreaterThan(-1);
    expect(amendEnd).toBeGreaterThan(amendStart);
  });

  it('the amend composes through the shared composition — never a second publisher', () => {
    expect(amend).toContain('composeAmend({ changeSet: input.changeSet, patchFiles, baseFiles })');
    expect(amend).toContain('publishToolFor("push_files")');
    expect(amend).toContain('publishToolFor("delete_file")');
    expect(amend).not.toContain('create_pull_request');
    expect(amend).not.toContain('create_branch');
    expect(amend).toContain('branch: brief.branch');
    expect(amend).toContain('const r = await executeCall(call);');
  });

  it('the head must not have moved since delivery, and the PR must still be open', () => {
    expect(amend).toContain('if (pull.head_sha !== headSha)');
    expect(amend).toContain('if (pull.state !== "open")');
    expect(amend.indexOf('if (pull.head_sha !== headSha)')).toBeLessThan(amend.indexOf('composeAmend({'));
    expect(amend).toContain('fetchRepoFileAtSha(tokens, target, pf.oldPath, headSha)');
  });

  it('the amend is judged like the publish: breaker before verdict, the critical law, one rest', () => {
    expect(amend).toContain('const critical = publishIsCritical(codingDecl, target.repo);');
    expect(amend.indexOf('breakerHold(call)')).toBeLessThan(amend.indexOf('verdictForCall(call);'));
    expect(amend).toContain('amend: { codeChangeId: brief.codeChangeId, repo: brief.repo, number: brief.number, branch: brief.branch }');
    expect(amend).toContain('title.like.PR を更新しました:%');
  });

  it('a landed amend refreshes the record from GitHub and steps the update', () => {
    expect(runAgent).toContain('const noteAmendLanded');
    expect(runAgent).toContain('`PR を更新しました: ${brief.repo}#${brief.number}`');
    expect(runAgent).toContain('upsertCodeChange(admin, run.element_id, ref, pull');
  });
});

describe('a rested amend settles under its own words', () => {
  it('SavedPending’s publish rest carries the amend marker', () => {
    expect(decision).toContain('amend?: { codeChangeId: string; repo: string; number: number; branch: string };');
  });

  it('the finalize reports the amend — updated, declined, or failed — then seals the finish', () => {
    expect(runAgent).toContain('const amendRest = standingPublish.amend;');
    expect(runAgent).toContain('await noteAmendLanded(amendRest);');
    expect(runAgent).toContain('"approval", "修正は却下されました"');
    expect(runAgent).toContain('"error", "修正が完了しませんでした"');
  });

  it('the rest itself is named for the amend, not the publish', () => {
    expect(runAgent).toContain('`${amend ? "修正" : "公開"}の承認待ち: ${approvalSummary(display)}`');
    expect(runAgent).toContain('**修正の承認待ち**');
  });
});

describe('the CI state shows on the code-changes row', () => {
  it('the read carries the new columns and the row renders the state as a pill', () => {
    expect(data).toContain('ci_state, ci_url, ci_at, amend_rounds, amend_exhausted_at');
    expect(section).toContain("change.ci_state === 'passed' ? 'CI passed' : 'CI failed'");
    expect(section).toContain("t('Open the CI run')");
  });
});
