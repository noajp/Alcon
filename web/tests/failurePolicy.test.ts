import { describe, expect, it } from "vitest";

// Failure policy (B13): classification is judged from executor
// signals only, resolution falls through definition → catalog →
// defaults FIELD BY FIELD, and the settle derives its one class from
// the path plus the run's own records. The pure half is pinned here;
// the driver's wiring (retry inside the call seam, give-up at the
// loop head, the settle's records) is pinned by the run-agent
// fixtures in later pieces' suites and by the migration contract.

const fp = await import(
  new URL("../../supabase/functions/_shared/failurePolicy.ts", import.meta.url).pathname
);
const def = await import(
  new URL("../../supabase/functions/_shared/definition.ts", import.meta.url).pathname
);

const {
  classifyCallFailure, httpStatusOf, parseExceptionEntry, resolveFailurePolicy,
  failurePolicySource, settleFailureClassOf, failureDetailOf, narrowEntriesByExceptions,
  FAILURE_DEFAULTS,
} = fp;
const { parseDefinition } = def;

const entry = (over: Record<string, unknown> = {}): never => ({
  id: "exc.test", name: "test", version: 1,
  match: { errorClass: null, destinationPattern: null, tool: null },
  rows: [{ class: "read_failed", retry: null, compensate: null, escalate: "inbox", giveUpAfter: null }],
  ...over,
} as never);

describe("httpStatusOf", () => {
  it("reads the HTTP prefix and the auth refusal's status", () => {
    expect(httpStatusOf("HTTP 503 Service Unavailable")).toBe(503);
    expect(httpStatusOf("HTTP 404")).toBe(404);
    expect(httpStatusOf("認証に失敗しました（401）: トークンが失効しています")).toBe(401);
    expect(httpStatusOf("ただの文章")).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
    expect(httpStatusOf(undefined)).toBeNull();
  });
});

describe("classifyCallFailure", () => {
  it("a call that did not fail has no class — an unverifiable read-back is not a failure", () => {
    expect(classifyCallFailure({ effect: "write", isError: false })).toBeNull();
    expect(classifyCallFailure({
      effect: "write", isError: false,
      verify: { ok: false, unverified: "読み戻し先が宣言されていません" },
    })).toBeNull();
  });

  it("a verify mismatch outranks every other signal — the write landed", () => {
    expect(classifyCallFailure({
      effect: "write", isError: true, text: "HTTP 404 Not Found",
      verify: { ok: false, diff: [{ field: "title", expected: "a", actual: "b" }] },
    })).toBe("verify_mismatch");
  });

  it("auth outranks rate limiting: the connection's state is the specific fact", () => {
    expect(classifyCallFailure({ effect: "read", isError: true, text: "認証に失敗しました（401）" })).toBe("auth_failed");
    expect(classifyCallFailure({ effect: "read", isError: true, text: "Bad credentials" })).toBe("auth_failed");
  });

  it("status facts: 429, 404, 5xx and throws", () => {
    expect(classifyCallFailure({ effect: "read", isError: true, text: "HTTP 429 Too Many Requests" })).toBe("rate_limited");
    expect(classifyCallFailure({ effect: "read", isError: true, text: "Rate limit exceeded" })).toBe("rate_limited");
    expect(classifyCallFailure({ effect: "read", isError: true, text: "HTTP 404 Not Found" })).toBe("not_found");
    expect(classifyCallFailure({ effect: "write", isError: true, text: "HTTP 503 Service Unavailable" })).toBe("unavailable");
    expect(classifyCallFailure({ effect: "read", isError: true, text: "fetch failed", thrown: true })).toBe("unavailable");
  });

  it("what remains falls to the call's effect", () => {
    expect(classifyCallFailure({ effect: "read", isError: true, text: "HTTP 400 Bad Request" })).toBe("read_failed");
    expect(classifyCallFailure({ effect: "write", isError: true, text: "validation failed" })).toBe("write_failed");
  });
});

describe("parseExceptionEntry", () => {
  const good = {
    match: { error_class: "unavailable", destination_pattern: "statuspage", tool: null },
    response: [{ retry: 2, compensate: "ask", escalate: "inbox", give_up_after: null }],
  };

  it("reads a valid payload, the match's class filling the row's", () => {
    const parsed = parseExceptionEntry(good);
    expect(parsed?.match).toEqual({ errorClass: "unavailable", destinationPattern: "statuspage", tool: null });
    expect(parsed?.rows).toEqual([{ class: "unavailable", retry: 2, compensate: "ask", escalate: "inbox", giveUpAfter: null }]);
  });

  it("fails closed on anything outside the row rules", () => {
    expect(parseExceptionEntry(null)).toBeNull();
    expect(parseExceptionEntry({})).toBeNull();
    // escalate is required — a row with nowhere for the failure to go
    expect(parseExceptionEntry({ match: {}, response: [{ class: "read_failed", retry: 1 }] })).toBeNull();
    // out of range
    expect(parseExceptionEntry({ match: {}, response: [{ class: "read_failed", retry: 6, escalate: "inbox" }] })).toBeNull();
    expect(parseExceptionEntry({ match: {}, response: [{ class: "read_failed", give_up_after: 0, escalate: "inbox" }] })).toBeNull();
    // an unknown class, in the match or in a row
    expect(parseExceptionEntry({ match: { error_class: "exploded" }, response: [{ escalate: "inbox" }] })).toBeNull();
    expect(parseExceptionEntry({ match: {}, response: [{ class: "exploded", escalate: "inbox" }] })).toBeNull();
    // a class twice
    expect(parseExceptionEntry({ match: {}, response: [
      { class: "read_failed", escalate: "inbox" }, { class: "read_failed", escalate: "owner" },
    ] })).toBeNull();
    // a pattern that does not compile
    expect(parseExceptionEntry({ match: { destination_pattern: "(" }, response: [{ class: "read_failed", escalate: "inbox" }] })).toBeNull();
    // an empty response speaks for nothing
    expect(parseExceptionEntry({ match: {}, response: [] })).toBeNull();
  });
});

describe("resolveFailurePolicy", () => {
  it("no rows and no entries resolve to the engine defaults, whole", () => {
    const p = resolveFailurePolicy({ class: "read_failed", definition: null, entries: [] });
    expect(p.retry).toBe(FAILURE_DEFAULTS.retry);
    expect(p.compensate).toBe(FAILURE_DEFAULTS.compensate);
    expect(p.escalate).toBeNull();
    expect(p.giveUpAfter).toBeNull();
    expect(p.source).toEqual({ retry: "default", compensate: "default", escalate: "default", giveUpAfter: "default" });
  });

  it("falls through FIELD BY FIELD: definition retry, catalog compensate, definition escalate", () => {
    const definition = parseDefinition([
      "# 失敗時の扱い",
      "- read_failed: retry 2, escalate owner",
    ].join("\n"));
    const p = resolveFailurePolicy({
      class: "read_failed", definition,
      entries: [entry({ rows: [{ class: "read_failed", retry: 5, compensate: "never", escalate: "inbox", giveUpAfter: 7 }] })],
    });
    expect(p.retry).toBe(2);
    expect(p.source.retry).toBe("definition");
    expect(p.compensate).toBe("never");
    expect(p.source.compensate).toBe("catalog");
    expect(p.escalate).toBe("owner");
    expect(p.source.escalate).toBe("definition");
    expect(p.giveUpAfter).toBe(7);
    expect(p.source.giveUpAfter).toBe("catalog");
  });

  it("the first matching entry in order speaks for a field", () => {
    const p = resolveFailurePolicy({
      class: "read_failed", definition: null,
      entries: [
        entry({ id: "exc.a", rows: [{ class: "read_failed", retry: 1, compensate: null, escalate: "inbox", giveUpAfter: null }] }),
        entry({ id: "exc.b", rows: [{ class: "read_failed", retry: 4, compensate: null, escalate: "owner", giveUpAfter: null }] }),
      ],
    });
    expect(p.retry).toBe(1);
    expect(p.escalate).toBe("inbox");
  });

  it("an entry speaks only for a class its match admits", () => {
    const p = resolveFailurePolicy({
      class: "write_failed", definition: null,
      entries: [entry({ match: { errorClass: "read_failed", destinationPattern: null, tool: null } })],
    });
    expect(p.source.retry).toBe("default");
  });

  it("call-time matching is AND over the present conditions, against any destination string", () => {
    const e = entry({
      match: { errorClass: null, destinationPattern: "github", tool: "list_issues" },
      rows: [{ class: "unavailable", retry: 3, compensate: null, escalate: "inbox", giveUpAfter: null }],
    });
    const hit = resolveFailurePolicy({
      class: "unavailable", definition: null, entries: [e],
      match: { destination: ["GitHub", "api.github.com"], tool: "list_issues" },
    });
    expect(hit.retry).toBe(3);
    const wrongTool = resolveFailurePolicy({
      class: "unavailable", definition: null, entries: [e],
      match: { destination: ["GitHub", "api.github.com"], tool: "create_issue" },
    });
    expect(wrongTool.source.retry).toBe("default");
    const wrongDestination = resolveFailurePolicy({
      class: "unavailable", definition: null, entries: [e],
      match: { destination: ["Slack", "slack.com"], tool: "list_issues" },
    });
    expect(wrongDestination.source.retry).toBe("default");
  });

  it("settle-time matching is class-only: destination and tool are not asked", () => {
    const e = entry({
      match: { errorClass: null, destinationPattern: "github", tool: "list_issues" },
      rows: [{ class: "unavailable", retry: null, compensate: "auto", escalate: "owner", giveUpAfter: null }],
    });
    const p = resolveFailurePolicy({ class: "unavailable", definition: null, entries: [e] });
    expect(p.compensate).toBe("auto");
    expect(p.source.compensate).toBe("catalog");
  });
});

describe("narrowEntriesByExceptions (§3.4)", () => {
  const entries = [entry({ id: "exc.a" }), entry({ id: "exc.b" })];

  it("no section consults everything installed", () => {
    expect(narrowEntriesByExceptions(null, entries)).toHaveLength(2);
    expect(narrowEntriesByExceptions(parseDefinition("# 目的\n- x"), entries)).toHaveLength(2);
  });

  it("a section consults only what it names", () => {
    const d = parseDefinition("# 例外\n- exc.a");
    expect(narrowEntriesByExceptions(d, entries).map((e: { id: string }) => e.id)).toEqual(["exc.a"]);
  });

  it("a written section that names nothing consults nothing", () => {
    const d = parseDefinition("# 例外\nなし");
    expect(d.exceptionsDeclared).toBe(true);
    expect(narrowEntriesByExceptions(d, entries)).toHaveLength(0);
  });
});

describe("the B9 seam supply (failurePolicySource)", () => {
  it("a definition row's compensate reaches the pass; the default is B9's ask", () => {
    const definition = parseDefinition("# 失敗時の扱い\n- run_failure: compensate auto, escalate inbox");
    const source = failurePolicySource({ definition, entries: [] });
    expect(source.policyFor({ failureClass: "run_failure" })).toBe("auto");
    expect(source.policyFor({ failureClass: "read_failed" })).toBe("ask");
    // an unnameable class is judged as the catch-all, row and all
    expect(source.policyFor({ failureClass: "not-a-class" })).toBe("auto");
  });

  it("an entry's compensate reaches the pass when no row speaks", () => {
    const source = failurePolicySource({
      definition: null,
      entries: [entry({ rows: [{ class: "run_failure", retry: null, compensate: "never", escalate: "inbox", giveUpAfter: null }] })],
    });
    expect(source.policyFor({ failureClass: "run_failure" })).toBe("never");
  });
});

describe("settleFailureClassOf", () => {
  it("the path decides first", () => {
    expect(settleFailureClassOf({ path: "refusal" })).toBe("model_refusal");
    expect(settleFailureClassOf({ path: "giveup", giveUpClass: "rate_limited" })).toBe("rate_limited");
    expect(settleFailureClassOf({ path: "giveup", giveUpClass: null })).toBe("run_failure");
    expect(settleFailureClassOf({ path: "decision", standingClass: "auth_failed" })).toBe("auth_failed");
    expect(settleFailureClassOf({ path: "decision", standingClass: null })).toBe("run_failure");
  });

  it("a failed verdict is judged by its claims: stale told apart mechanically", () => {
    expect(settleFailureClassOf({ path: "finish", verdictResult: "fail", claimsStale: 2 })).toBe("stale_claims");
    expect(settleFailureClassOf({ path: "finish", verdictResult: "fail", claimsStale: 0 })).toBe("revisions_exhausted");
  });

  it("a finish that fell short reads the run's calls: auth, then mismatch, then the latest", () => {
    expect(settleFailureClassOf({ path: "finish", verdictResult: "unchecked", callClasses: ["read_failed", "auth_failed"] })).toBe("auth_failed");
    expect(settleFailureClassOf({ path: "finish", verdictResult: "unchecked", callClasses: ["read_failed", "verify_mismatch"] })).toBe("verify_mismatch");
    expect(settleFailureClassOf({ path: "finish", verdictResult: null, callClasses: ["unavailable", "read_failed"] })).toBe("unavailable");
    expect(settleFailureClassOf({ path: "finish", verdictResult: null, callClasses: [null], hasBreakerTrip: true })).toBe("breaker_tripped");
    expect(settleFailureClassOf({ path: "finish", verdictResult: null, callClasses: [] })).toBe("run_failure");
  });
});

describe("failureDetailOf", () => {
  it("carries the class, the policy and the layer that spoke, the run's counts", () => {
    const policy = resolveFailurePolicy({
      class: "auth_failed", definition: null,
      entries: [entry({ rows: [{ class: "auth_failed", retry: null, compensate: "ask", escalate: "owner", giveUpAfter: null }] })],
    });
    const detail = failureDetailOf({
      failureClass: "auth_failed", policy, retries: 3, giveUp: null, at: new Date("2026-12-12T00:00:00Z"),
    });
    expect(detail).toEqual({
      class: "auth_failed",
      compensate: { policy: "ask", source: "catalog" },
      escalate: { target: "owner", source: "catalog" },
      retries: 3, giveUp: null, at: "2026-12-12T00:00:00.000Z",
    });
    const quiet = failureDetailOf({
      failureClass: "run_failure",
      policy: resolveFailurePolicy({ class: "run_failure", definition: null, entries: [] }),
      retries: 0, giveUp: { count: 5 }, at: new Date("2026-12-12T00:00:00Z"),
    });
    expect(quiet.escalate).toBeNull();
    expect(quiet.giveUp).toEqual({ count: 5 });
  });
});

describe("the loop's give-up outcome (§6.2)", () => {
  const loopImport = import(
    new URL("../../supabase/functions/_shared/agentLoop.ts", import.meta.url).pathname
  );

  type Block = Record<string, unknown>;
  const toolUse = (id: string, name: string): Block => ({ type: "tool_use", id, name, input: {} });
  const makeDeps = (over: Record<string, unknown> = {}) => {
    const executed: string[] = [];
    let modelCalls = 0;
    const deps = {
      callModel: async () => {
        modelCalls++;
        return {
          content: [toolUse(`c${modelCalls}`, "read_inbox")], stop_reason: "tool_use",
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      },
      kindOf: () => "read" as const,
      needsApproval: () => false,
      execute: async (c: { name: string }) => { executed.push(c.name); return { content: "ok" }; },
      onUsage: async () => {},
      budgetExceeded: () => false,
      cancelled: async () => false,
      ...over,
    };
    return { deps, executed, modelCalls: () => modelCalls };
  };
  const fresh = () => ({
    messages: [{ role: "user", content: "task" }] as { role: string; content: unknown }[],
    turns: 0, nudges: 0, revisions: 0 as number | undefined,
  });
  const limits = { maxTurnsThisCall: 10, maxTotalTurns: 50, deadline: Date.now() + 60_000 };

  it("stops at the loop head under the fired class, before any turn runs", async () => {
    const { runLoop } = await loopImport;
    const { deps, modelCalls } = makeDeps({
      giveUp: () => ({ failureClass: "read_failed", detail: "上限に達しました" }),
    });
    const out = await runLoop(fresh(), deps as never, limits);
    expect(out).toEqual({ kind: "giveup", failureClass: "read_failed", detail: "上限に達しました" });
    expect(modelCalls()).toBe(0);
  });

  it("fires mid-run, once the dep's count crosses — the turn before it executed", async () => {
    const { runLoop } = await loopImport;
    let asks = 0;
    const { deps, executed } = makeDeps({
      giveUp: () => (++asks >= 2 ? { failureClass: "unavailable", detail: "応答なしが続きました" } : null),
    });
    const out = await runLoop(fresh(), deps as never, limits);
    expect(out.kind).toBe("giveup");
    expect(executed).toEqual(["read_inbox"]);
  });

  it("orders as designed: a cancel outranks it, it outranks the budget", async () => {
    const { runLoop } = await loopImport;
    const giveUp = () => ({ failureClass: "read_failed", detail: "x" });
    const cancelled = makeDeps({ giveUp, cancelled: async () => true });
    expect((await runLoop(fresh(), cancelled.deps as never, limits)).kind).toBe("cancelled");
    const broke = makeDeps({ giveUp, budgetExceeded: () => true });
    expect((await runLoop(fresh(), broke.deps as never, limits)).kind).toBe("giveup");
  });
});
