import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The B13 migrations' contract: (a) the call log's failure_class
// column, and (b) the exception catalog — the kind check widened,
// the five seeds reading clean through the very parser the engine
// will read them with, the installs table member-read-only, the
// three owner RPCs refusing with 42501, and agent_runs.failure_detail.

const callLogSql = readFileSync(
  new URL("../../supabase/migrations/20261212090000_call_log_failure_class.sql", import.meta.url), "utf8");
const catalogSql = readFileSync(
  new URL("../../supabase/migrations/20261213090000_exception_catalog.sql", import.meta.url), "utf8");

const { parseExceptionEntry } = await import(
  new URL("../../supabase/functions/_shared/failurePolicy.ts", import.meta.url).pathname
);

describe("call log failure_class migration (B13a)", () => {
  it("adds the nullable column, guarded", () => {
    expect(callLogSql).toContain("to_regclass('public.integration_call_log')");
    expect(callLogSql).toContain("add column if not exists failure_class text");
  });
});

describe("exception catalog migration (B13b)", () => {
  it("widens the kind check by looking the current one up, guarded", () => {
    expect(catalogSql).toContain("to_regclass('public.catalog_items')");
    expect(catalogSql).toContain("pg_get_constraintdef(oid) like '%kind%'");
    expect(catalogSql).toContain("''definition'', ''pack'', ''exception''");
  });

  it("adds agent_runs.failure_detail, guarded by the same block", () => {
    expect(catalogSql).toContain("alter table public.agent_runs add column if not exists failure_detail jsonb");
  });

  it("creates the installs table: versioned, disable-able, one per Space and item", () => {
    expect(catalogSql).toContain("create table if not exists public.space_exception_installs");
    expect(catalogSql).toContain("unique (activity_space_id, catalog_item_id)");
    expect(catalogSql).toContain("version integer not null");
    expect(catalogSql).toContain("enabled boolean not null default true");
    expect(catalogSql).toContain("references public.catalog_items(id) on delete cascade");
  });

  it("installs are member-readable and writable through no policy", () => {
    expect(catalogSql).toContain("create policy space_exception_installs_select on public.space_exception_installs");
    expect(catalogSql).toContain("public.is_activity_space_member(activity_space_id)");
    expect(catalogSql).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("the three install RPCs are owner-checked inside, refusing with 42501", () => {
    for (const rpc of ["install_catalog_exception", "uninstall_catalog_exception", "set_catalog_exception_enabled"]) {
      expect(catalogSql).toContain(`create or replace function public.${rpc}(`);
      expect(catalogSql).toContain(`grant execute on function public.${rpc}(`);
    }
    expect(catalogSql.match(/errcode = '42501'/g)?.length).toBe(3);
    expect(catalogSql).toContain("public.is_activity_space_owner(p_space_id)");
    // install refuses a non-exception item rather than installing it
    expect(catalogSql).toContain("v_item.kind <> 'exception'");
    // a re-install records the catalog's current version
    expect(catalogSql).toContain("v_item.version");
  });

  it("seeds exactly the five designed entries, each parsing clean", () => {
    const expected: Record<string, { cls: string; retry: number; escalate: string; sort: number }> = {
      "exc.unknown-destination": { cls: "not_found", retry: 0, escalate: "inbox", sort: 210 },
      "exc.partial-outage": { cls: "unavailable", retry: 2, escalate: "inbox", sort: 220 },
      "exc.rate-limited": { cls: "rate_limited", retry: 3, escalate: "inbox", sort: 230 },
      "exc.credential-expired": { cls: "auth_failed", retry: 0, escalate: "owner", sort: 240 },
      "exc.stale-source": { cls: "stale_claims", retry: 0, escalate: "inbox", sort: 250 },
    };
    const seedLines = catalogSql.split("\n").filter((l) => l.includes("'exc."));
    expect(seedLines).toHaveLength(5);
    for (const [id, want] of Object.entries(expected)) {
      const line = seedLines.find((l) => l.includes(`'${id}'`));
      expect(line, id).toBeTruthy();
      expect(line).toContain("'exception'");
      expect(line).toContain(`, ${want.sort}, 1)`);
      const payloadJson = /\{.*\}/.exec(line!)?.[0];
      const parsed = parseExceptionEntry(JSON.parse(payloadJson!));
      expect(parsed, id).not.toBeNull();
      expect(parsed!.match.errorClass).toBe(want.cls);
      expect(parsed!.rows).toEqual([{
        class: want.cls, retry: want.retry, compensate: "ask",
        escalate: want.escalate, giveUpAfter: null,
      }]);
    }
    // The two designed non-entries stay out: duplicate submission is
    // the retry floor, a deadline conflict has no signal yet.
    expect(catalogSql).not.toContain("exc.duplicate");
    expect(catalogSql).not.toContain("exc.deadline");
  });
});
