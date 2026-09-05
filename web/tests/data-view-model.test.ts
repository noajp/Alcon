import { describe, expect, it } from "vitest";
import {
  dataBars,
  groupDataRows,
  normalizeDataViewParams,
  numericCell,
  parseCell,
} from "../src/alcon/widget/widgets/dataViewModel";
import type { DataTableRow } from "../src/types/database";
const rows = ["a", "b", "c"].map((id) => ({ id }) as DataTableRow);
describe("data view configuration and readings", () => {
  it("discards unsupported views and malformed axes while preserving explicit column visibility", () => {
    expect(
      normalizeDataViewParams({
        view: "pie",
        tableId: 2,
        columnIds: ["x", "x", 3, ""],
      }),
    ).toEqual({
      tableId: null,
      view: "table",
      labelColumnId: null,
      valueColumnId: null,
      groupColumnId: null,
      columnIds: ["x"],
    });
  });
  it("does not turn empty, boolean or invalid readings into zeros", () => {
    for (const value of ["", " ", null, false, "NaN", "Infinity", {}])
      expect(numericCell(value)).toBeNull();
    expect(numericCell("0")).toBe(0);
    expect(parseCell("-2.5", "number")).toBe(-2.5);
    expect(() => parseCell("oops", "number")).toThrow();
  });
  it("keeps negative and zero readings and excludes invalid values", () => {
    expect(
      dataBars(
        rows,
        { a: { n: -4, name: "A" }, b: { n: 0 }, c: { n: "" } },
        "name",
        "n",
      ),
    ).toEqual([
      { id: "a", label: "A", value: -4 },
      { id: "b", label: "Row 2", value: 0 },
    ]);
  });
  it("does not merge real category names with the missing-value group", () => {
    const groups = groupDataRows(
      rows,
      { a: { g: "Unassigned" }, b: {}, c: { g: "Unassigned" } },
      "g",
    );
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([
      ["a", "c"],
      ["b"],
    ]);
  });
});
