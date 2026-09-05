import type { DataTableColumn, DataTableRow, Json } from "@/types/database";
import type { WidgetParams } from "../types";

export interface DataViewParams extends WidgetParams {
  tableId: string | null;
  view: "table" | "cards" | "bar";
  labelColumnId: string | null;
  valueColumnId: string | null;
  groupColumnId: string | null;
  columnIds?: string[];
  title?: string;
}
const id = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;
export function normalizeDataViewParams(raw?: WidgetParams): DataViewParams {
  return {
    tableId: id(raw?.tableId),
    view: raw?.view === "cards" || raw?.view === "bar" ? raw.view : "table",
    labelColumnId: id(raw?.labelColumnId),
    valueColumnId: id(raw?.valueColumnId),
    groupColumnId: id(raw?.groupColumnId),
    ...(Array.isArray(raw?.columnIds)
      ? {
          columnIds: [
            ...new Set(raw.columnIds.filter((v): v is string => !!id(v))),
          ],
        }
      : {}),
    ...(typeof raw?.title === "string" ? { title: raw.title.trim() } : {}),
  };
}
export function displayCell(value: Json | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function numericCell(value: Json | undefined): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function parseCell(
  text: string,
  type: DataTableColumn["type"],
): Json | null {
  if (!text.trim()) return null;
  if (type === "number") {
    const number = numericCell(text);
    if (number === null) throw new Error("Enter a finite number.");
    return number;
  }
  return text;
}
export type CellsByRow = Record<string, Record<string, Json | null>>;
export function groupDataRows(
  rows: DataTableRow[],
  cells: CellsByRow,
  columnId: string | null,
) {
  const groups = new Map<
    string,
    { key: string; label: string; rows: DataTableRow[] }
  >();
  for (const row of rows) {
    const value = columnId ? cells[row.id]?.[columnId] : null;
    const key = value == null || value === "" ? "empty" : JSON.stringify(value);
    const label = columnId ? displayCell(value) || "Unassigned" : "";
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}
export function dataBars(
  rows: DataTableRow[],
  cells: CellsByRow,
  labelId: string | null,
  valueId: string | null,
) {
  if (!valueId) return [];
  return rows.flatMap((row, index) => {
    const value = numericCell(cells[row.id]?.[valueId]);
    return value === null
      ? []
      : [
          {
            id: row.id,
            label:
              (labelId && displayCell(cells[row.id]?.[labelId])) ||
              `Row ${index + 1}`,
            value,
          },
        ];
  });
}
