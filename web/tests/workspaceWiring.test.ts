import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Wiring pins for governed workspaces (coding capability PR1).
// run-agent and the automations function cannot be imported by
// Vitest (Deno entry points), so — as with the Chain scope pins —
// the load-bearing seams are pinned on source: the machine tools
// exist only behind a definition, their calls are priced from the
// binding's invariants, run end destroys the workspace, the tick
// reaps, and the runner can boot machine-only without a browser.
const runAgent = readFileSync(
  new URL('../../supabase/functions/run-agent/index.ts', import.meta.url).pathname, 'utf8',
);
const automations = readFileSync(
  new URL('../../supabase/functions/automations/index.ts', import.meta.url).pathname, 'utf8',
);
const runner = readFileSync(
  new URL('../../sdk/node/runner/clayware-runner.mjs', import.meta.url).pathname, 'utf8',
);

describe('run-agent: the machine is definition-gated (design §4.3)', () => {
  it('resolution reads the requirement from the run\'s definition, either scope', () => {
    expect(runAgent).toContain('parsedAll?.machine ?? null');
  });

  it('the old unconditional offer — any online shell runner for any run — is gone', () => {
    expect(runAgent).not.toContain('pickRunner((runnerRows ?? []) as RunnerRow[], Date.now(), "shell")');
    expect(runAgent).not.toContain('...(machine ? MACHINE_TOOLS : [])');
  });

  it('the tools are offered on the governed offer, so provisioning can land mid-first-slice', () => {
    expect(runAgent).toContain('...(machineOffered ? MACHINE_TOOLS : [])');
  });

  it('standing candidates never include a provisioned asset (a workspace is its run\'s alone)', () => {
    expect(runAgent).toContain('!provisionedRunIdOf(r.manifest)');
  });

  it('provisioning is server-side, and a rehearsal never provisions', () => {
    expect(runAgent).toContain('ensureManagedWorkspace(admin, getEnv');
    expect(runAgent).toMatch(/else if \(!run\.rehearsal\) \{\s*\n\s*machineHandled = true;/);
  });

  it('an unconfigured provider fails closed with its honest note, never a fallback', () => {
    expect(runAgent).toContain('ensured.state === "not_configured"');
    expect(runAgent).toContain('downIntegration("ワークスペース"');
  });
});

describe('run-agent: classification and caps', () => {
  it('machine calls are priced from the binding\'s invariants', () => {
    expect(runAgent).toContain('machineCallKind(machineFacts, machineReq)');
  });

  it('machine calls run behind the wall clock seam', () => {
    expect(runAgent).toContain('if (isMachineTool(call.name)) return await callMachine(call);');
    expect(runAgent).toContain('"wall_clock"');
  });

  it('run end destroys the workspace: terminal finish, failure — the reaper is only the backstop', () => {
    // finishRun (terminal only), failRun, and the wall-clock seam.
    expect(runAgent.match(/closeRunWorkspace\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(runAgent).toContain('"run_finished"');
    expect(runAgent).toContain('"run_failed"');
  });
});

describe('the tick reaps workspaces', () => {
  it('automations calls the reaper and reports its counts', () => {
    expect(automations).toContain('reapWorkspaces(env.admin');
    expect(automations).toContain('workspacesExpired');
    expect(automations).toContain('workspacesRunEnded');
  });
});

describe('the runner boots machine-only for a provisioned workspace', () => {
  it('takes its identity token from the environment as well as its state file', () => {
    expect(runner).toContain('CLAYWARE_TOKEN');
  });

  it('--no-browser loads no browser handlers and offers shell/files only', () => {
    expect(runner).toContain('--no-browser');
    expect(runner).toContain("NO_BROWSER ? ['shell', 'files']");
    expect(runner).toContain('...(NO_BROWSER ? {} : BROWSER_TOOLS)');
  });
});
