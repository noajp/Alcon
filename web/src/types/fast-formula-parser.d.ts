// The parts of fast-formula-parser (MIT) the sheet viewer uses; the package
// ships no types.
declare module 'fast-formula-parser' {
  export interface CellPosition { sheet: string; row: number; col: number }
  export interface RangeRef { sheet: string; from: { row: number; col: number }; to: { row: number; col: number } }
  type Value = string | number | boolean | null | Value[][] | { error: string };
  export default class FormulaParser {
    constructor(config: {
      onCell: (ref: CellPosition) => Value;
      onRange: (ref: RangeRef) => Value[][];
      functions?: Record<string, (...args: { value: unknown; isArray?: boolean; isRangeRef?: boolean }[]) => Value>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      functionsNeedContext?: Record<string, (context: any, ...args: unknown[]) => Value>;
    });
    parse(formula: string, position: CellPosition, allowReturnArray?: boolean): Value;
  }
}

declare module 'fast-formula-parser/formulas/operators' {
  export const Infix: Record<string, (...args: unknown[]) => unknown>;
}
