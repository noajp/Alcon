import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The coding loop's wiring (coding capability PR2): what the pure
// tests cannot judge — that run-agent actually delivers the tree
// before the loop, judges the finish against the run's own records,
// and ends the loop in a patch artifact; that the loop's mechanical
// check may answer asynchronously now; and that tree delivery
// travels the one credential path (github.ts' token plumbing) with
// no credential ever entering the box. Pinned on source, the repo's
// convention for Edge I/O (workspaceWiring.test.ts is the model).
const runAgent = readFileSync(new URL('../../supabase/functions/run-agent/index.ts', import.meta.url), 'utf8');
const agentLoop = readFileSync(new URL('../../supabase/functions/_shared/agentLoop.ts', import.meta.url), 'utf8');
const delivery = readFileSync(new URL('../../supabase/functions/_shared/codingDelivery.ts', import.meta.url), 'utf8');

describe('run-agent wires the coding loop', () => {
  it('delivers the tree through codingDelivery before the loop, once per run', () => {
    expect(runAgent).toContain('deliverTreeToWorkspace');
    expect(runAgent).toContain('resolveCodingTarget(codingDecl, texts)');
    // The delivery step is the record a later slice reads back.
    expect(runAgent).toContain('parseDeliveryDetail');
    expect(runAgent).toContain('deliveryStepTitle(resolved.target, out.baseSha)');
    const at = runAgent.indexOf('deliverTreeToWorkspace');
    expect(runAgent.indexOf('const outcome = await runLoop(state, {', at)).toBeGreaterThan(at);
  });

  it('the finish gate reads the run’s own asset_calls as test evidence', () => {
    expect(runAgent).toContain('testEvidenceOf(records, codingDecl?.testCommand ?? null)');
    expect(runAgent).toContain('codingFinishGaps({');
    expect(runAgent).toContain('.eq("tool", "shell")');
  });

  it('the loop ends in a patch: capture, summary step, artifact through the existing machinery', () => {
    expect(runAgent).toContain('produceCodingPatch');
    expect(runAgent).toContain('captureCommand()');
    expect(runAgent).toContain('changeSetSummaryText({');
    expect(runAgent).toContain('patchArtifactTitle(codingSession.target)');
    expect(runAgent).toContain('agent_artifacts');
  });

  it('a rehearsal and a plan run never receive a tree nor produce a patch', () => {
    expect(runAgent).toContain('if (codingDecl && machine && !run.rehearsal && !planRun)');
    expect(runAgent).toContain('if (codingSession?.delivered && codingDecl && !planRun && !run.rehearsal)');
  });
});

describe('the mechanical check may read records before answering', () => {
  it('agentLoop awaits it; its type admits a promise', () => {
    expect(agentLoop).toContain('await deps.mechanicalCheck?.(r.finish)');
    expect(agentLoop).toContain('Promise<{ gaps: string[] } | null>');
  });
});

describe('tree delivery keeps the credential on the server side', () => {
  it('reads tokens only through github.ts’ plumbing and fetches a tarball at the base SHA', () => {
    expect(delivery).toContain('githubTokens(input.admin, input.spaceId)');
    expect(delivery).toContain('withGithubToken');
    expect(delivery).toContain('/tarball/${sha}');
    expect(delivery).toContain('/commits/${encodeURIComponent(target.baseBranch)}');
  });

  it('the snapshot rests run-scoped, travels as a short-lived signed URL, and is removed after', () => {
    expect(delivery).toContain('run-tree/${input.runId}.tar.gz');
    expect(delivery).toContain('createSignedUrl(path, SNAPSHOT_URL_TTL_S)');
    expect(delivery).toContain('.remove([path])');
  });
});
