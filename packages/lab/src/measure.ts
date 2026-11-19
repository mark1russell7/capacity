import { availableParallelism } from "node:os";
import { runCell, type Cell, type CellResult } from "@mark1russell7/harness";
import { benchEnv } from "@mark1russell7/rigor-bench/fresh";
import type { Case } from "./case.ts";
import { cellOf } from "./cell.ts";
import { recordOf, type CaseRecord, type Host } from "./record.ts";

/** The options of a measurement. Each one has a default for a real run, and a test gives its own. */
export interface MeasureOptions {
  /** This count is the CPUs of the host. The default is `availableParallelism()` of `node:os`. */
  readonly cpus?: number;
  /** This host gives the CPU model of the record. The default is `benchEnv()` of `@mark1russell7/rigor-bench/fresh`. */
  readonly host?: Host;
  /** This function operates a cell. The default is `runCell` of `@mark1russell7/harness`, which needs Docker. */
  readonly run?: (cell: Cell) => Promise<CellResult>;
}

/** A measurement is the record of a case and the raw result of its cell. A later analysis can judge the raw result again. */
export interface Measurement {
  readonly record: CaseRecord;
  readonly result: CellResult;
}

/**
 * This function measures a case: it operates the cell of the case (`cellOf`), and it gives the record
 * of the result (`recordOf`). It throws a `RangeError` for a case with a problem.
 */
export const measureCase = async (value: Case, options: MeasureOptions = {}): Promise<Measurement> => {
  const cell = cellOf(value, { cpus: options.cpus ?? availableParallelism() });
  const result = await (options.run ?? runCell)(cell);
  return { record: recordOf(value, result, options.host ?? benchEnv()), result };
};
