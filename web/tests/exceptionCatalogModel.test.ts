import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exceptionInstallState, parseExceptionPayload } from "@/AIP/harness/exceptionCatalogModel";

// The web twin of the engine's payload contract (exceptionCatalogModel
// mirrors failurePolicy.ts' parseExceptionEntry): the panel's summary
// must not promise what resolution would not deliver, so the same
// fail-closed rules are pinned here — and the five seeded payloads are
// read through BOTH readers and must agree.

const { parseExceptionEntry } = await import(
  new URL("../../supabase/functions/_shared/failurePolicy.ts", import.meta.url).pathname
);

describe("parseExceptionPayload", () => {
  it("reads a valid payload, the match's class filling the row's", () => {
    const parsed = parseExceptionPayload({
      match: { error_class: "unavailable", destination_pattern: null, tool: null },
      response: [{ retry: 2, compensate: "ask", escalate: "inbox", give_up_after: null }],
    });
    expect(parsed?.match.errorClass).toBe("unavailable");
    expect(parsed?.rows).toEqual([{
      failureClass: "unavailable", retry: 2, compensate: "ask", escalate: "inbox", giveUpAfter: null,
    }]);
  });

  it("fails closed exactly where the engine's reader does", () => {
    const bad: unknown[] = [
      null, {}, [], "x",
      { match: {}, response: [{ class: "read_failed", retry: 1 }] }, // no escalate
      { match: {}, response: [{ class: "read_failed", retry: 6, escalate: "inbox" }] },
      { match: {}, response: [{ class: "read_failed", give_up_after: 51, escalate: "inbox" }] },
      { match: { error_class: "exploded" }, response: [{ escalate: "inbox" }] },
      { match: {}, response: [{ class: "read_failed", escalate: "inbox" }, { class: "read_failed", escalate: "owner" }] },
      { match: { destination_pattern: "(" }, response: [{ class: "read_failed", escalate: "inbox" }] },
      { match: {}, response: [] },
    ];
    for (const payload of bad) {
      expect(parseExceptionPayload(payload)).toBeNull();
      expect(parseExceptionEntry(payload)).toBeNull();
    }
  });

  it("reads the five seeded payloads, agreeing with the engine's reader", () => {
    const sql = readFileSync(
      new URL("../../supabase/migrations/20261213090000_exception_catalog.sql", import.meta.url), "utf8");
    const seedLines = sql.split("\n").filter((l) => l.includes("'exc."));
    expect(seedLines).toHaveLength(5);
    for (const line of seedLines) {
      const payload = JSON.parse(/\{.*\}/.exec(line)?.[0] ?? "null");
      const web = parseExceptionPayload(payload);
      const engine = parseExceptionEntry(payload);
      expect(web, line.slice(0, 40)).not.toBeNull();
      expect(engine).not.toBeNull();
      expect(web!.rows.map((r) => [r.failureClass, r.retry, r.compensate, r.escalate, r.giveUpAfter]))
        .toEqual(engine!.rows.map((r: { class: string; retry: number | null; compensate: string | null; escalate: string; giveUpAfter: number | null }) => [r.class, r.retry, r.compensate, r.escalate, r.giveUpAfter]));
      expect(web!.match.errorClass).toBe(engine!.match.errorClass);
    }
  });
});

describe("exceptionInstallState", () => {
  const item = { version: 3 };
  it("not installed", () => {
    expect(exceptionInstallState(item, null)).toEqual({ kind: "not-installed" });
  });
  it("installed at the current version", () => {
    expect(exceptionInstallState(item, { version: 3, enabled: true })).toEqual({ kind: "current", version: 3 });
  });
  it("an update waits when the catalog moved — never taken silently", () => {
    expect(exceptionInstallState(item, { version: 2, enabled: true }))
      .toEqual({ kind: "update-available", installedVersion: 2, catalogVersion: 3 });
  });
  it("switched off reads as disabled, whatever the versions", () => {
    expect(exceptionInstallState(item, { version: 2, enabled: false })).toEqual({ kind: "disabled", version: 2 });
    expect(exceptionInstallState(item, { version: 3, enabled: false })).toEqual({ kind: "disabled", version: 3 });
  });
});
