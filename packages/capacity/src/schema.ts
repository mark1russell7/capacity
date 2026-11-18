import { err, ok, type Result } from "@mark1russell7/optional";
import { parse, type Expr } from "@mark1russell7/vex";
import { z } from "zod";
import { checkLaw } from "./check.ts";
import { LAW_FORMAT, type Law, type LawProblem } from "./law.ts";
import { LAW_DOMAINS } from "./program.ts";
import { checkWorkload } from "./workload-check.ts";
import { WORKLOAD_FORMAT, type Workload, type WorkloadProblem } from "./workload.ts";

/** This function tells if a value from JSON is a Vex expression. */
const isProgram = (value: unknown): boolean => {
  const text = JSON.stringify(value);
  return text !== undefined && parse(text, LAW_DOMAINS).ok;
};

const fitErrorSchema = z.strictObject({ mae: z.number(), rmse: z.number() });

/**
 * This schema accepts the shape of a law file: each field with its type, and no other field. It
 * does not examine what the fields mean. The function `checkLaw` does that.
 */
export const lawSchema: z.ZodType<Law> = z.strictObject({
  format: z.literal(LAW_FORMAT),
  id: z.string(),
  title: z.string(),
  subject: z.string(),
  measure: z.strictObject({ id: z.string(), unit: z.string() }),
  variables: z.array(
    z.strictObject({ id: z.string(), unit: z.string(), min: z.number(), max: z.number(), scale: z.enum(["linear", "log"]) }),
  ),
  conditions: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.strictObject({ value: z.number(), unit: z.string() })]),
  ),
  form: z.strictObject({ id: z.string(), program: z.custom<Expr>(isProgram, "The program is not a Vex expression.") }),
  constants: z.array(z.strictObject({ id: z.string(), value: z.number() })),
  replicates: z.array(z.array(z.number())),
  fit: z.strictObject({
    method: z.string(),
    residual: z.enum(["absolute", "relative"]),
    residuals: z.array(z.number()),
    losers: z.array(z.strictObject({ form: z.string(), error: fitErrorSchema })),
  }),
  evidence: z.strictObject({
    runs: z.array(z.strictObject({ url: z.string(), commit: z.string(), date: z.string() })),
  }),
});

/**
 * This function reads a law from the data of a law file. It gives the law when the data has the
 * shape of a law and `checkLaw` finds no problem. If not, it gives each problem.
 */
export const readLaw = (data: unknown): Result<Law, readonly LawProblem[]> => {
  const shape = lawSchema.safeParse(data);
  if (!shape.success) {
    return err(shape.error.issues.map((issue) => ({ code: "shape", path: issue.path.join("."), message: issue.message })));
  }
  const problems = checkLaw(shape.data);
  return problems.length > 0 ? err(problems) : ok(shape.data);
};

const amountSchema = z.strictObject({ value: z.number(), unit: z.string() });
const amountsSchema = z.record(z.string(), amountSchema);

/**
 * This schema accepts the shape of a workload file: each field with its type, and no other field.
 * It does not examine what the fields mean. The function `checkWorkload` does that.
 */
export const workloadSchema: z.ZodType<Workload> = z.strictObject({
  format: z.literal(WORKLOAD_FORMAT),
  id: z.string(),
  title: z.string(),
  classes: z.array(z.strictObject({ id: z.string(), rate: amountSchema, request: amountsSchema })),
  levels: amountsSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("plan"), note: z.string() }),
    z.strictObject({ kind: z.literal("metrics"), origin: z.string(), from: z.string(), to: z.string() }),
  ]),
});

/**
 * This function reads a workload from the data of a workload file. It gives the workload when the
 * data has the shape of a workload and `checkWorkload` finds no problem. If not, it gives each
 * problem.
 */
export const readWorkload = (data: unknown): Result<Workload, readonly WorkloadProblem[]> => {
  const shape = workloadSchema.safeParse(data);
  if (!shape.success) {
    return err(shape.error.issues.map((issue) => ({ code: "shape", path: issue.path.join("."), message: issue.message })));
  }
  const problems = checkWorkload(shape.data);
  return problems.length > 0 ? err(problems) : ok(shape.data);
};
