import { err, ok, type Result } from "@mark1russell7/optional";
import { parse, type Expr } from "@mark1russell7/vex";
import { z } from "zod";
import { checkApp } from "./app-check.ts";
import { APP_FORMAT, APP_LINE_KINDS, type AppContract, type AppProblem } from "./app.ts";
import { checkLaw } from "./check.ts";
import { COMPOSITION_FORMAT, checkComposition, type Composition, type CompositionProblem } from "./composition.ts";
import { checkInstance, checkLimits } from "./instance-check.ts";
import {
  INSTANCE_FORMAT,
  LIMITS_FORMAT,
  type InstanceProblem,
  type InstanceType,
  type Limit,
  type LimitProblem,
  type LimitSet,
} from "./instance.ts";
import { LAW_FORMAT, type Law, type LawProblem, type Problem } from "./law.ts";
import { LAW_DOMAINS } from "./program.ts";
import { checkWorkload } from "./workload-check.ts";
import { WORKLOAD_FORMAT, type Workload, type WorkloadProblem } from "./workload.ts";

/** This function tells if a value from JSON is a Vex expression. */
const isProgram = (value: unknown): boolean => {
  const text = JSON.stringify(value);
  return text !== undefined && parse(text, LAW_DOMAINS).ok;
};

/**
 * This function makes the reader of a record. The reader examines the shape of the data with the
 * schema, then it examines the meaning with `check`. It gives the record, or each problem.
 */
const reader =
  <T, Code extends string>(schema: z.ZodType<T>, check: (record: T) => readonly Problem<Code>[]) =>
  (data: unknown): Result<T, readonly Problem<Code | "shape">[]> => {
    const shape = schema.safeParse(data);
    if (!shape.success) {
      return err(shape.error.issues.map((issue) => ({ code: "shape", path: issue.path.join("."), message: issue.message })));
    }
    const problems = check(shape.data);
    return problems.length > 0 ? err(problems) : ok(shape.data);
  };

const fitErrorSchema = z.strictObject({ mae: z.number(), rmse: z.number() });

const runSchema = z.strictObject({ url: z.string(), commit: z.string(), date: z.string() });

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
  points: z.array(z.strictObject({ load: z.record(z.string(), z.number()), value: z.number(), run: z.number(), job: z.string() })).exactOptional(),
  evidence: z.strictObject({ runs: z.array(runSchema) }),
  noise: z.strictObject({ floor: z.number(), cpu: z.string(), runs: z.array(runSchema) }),
});

/**
 * This function reads a law from the data of a law file. It gives the law when the data has the
 * shape of a law and `checkLaw` finds no problem. If not, it gives each problem.
 */
export const readLaw: (data: unknown) => Result<Law, readonly LawProblem[]> = reader(lawSchema, checkLaw);

const factorSchema = z.number().optional();

/**
 * This schema accepts the shape of a composition file: each field with its type, and no other
 * field. It does not examine what the fields mean. The function `checkComposition` does that.
 */
export const compositionSchema: z.ZodType<Composition> = z.strictObject({
  format: z.literal(COMPOSITION_FORMAT),
  id: z.string(),
  title: z.string(),
  subject: z.string(),
  measure: z.strictObject({ id: z.string(), unit: z.string() }),
  terms: z.array(
    z.union([
      z.strictObject({
        law: z.string(),
        over: z.union([z.literal("instance"), z.literal("each"), z.array(z.string())]),
        load: z.enum(["class", "total"]).optional(),
        factor: factorSchema,
        base: z.lazy(() => amountsSchema).optional(),
      }),
      z.strictObject({ composition: z.string(), factor: factorSchema }),
    ]),
  ),
});

/**
 * This function reads a composition from the data of a composition file. It gives the composition
 * when the data has the shape of one and `checkComposition` finds no problem. If not, it gives each
 * problem.
 */
export const readComposition: (data: unknown) => Result<Composition, readonly CompositionProblem[]> = reader(
  compositionSchema,
  checkComposition,
);

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
  classes: z.array(z.strictObject({ id: z.string(), of: z.string().optional(), rate: amountSchema, request: amountsSchema })),
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
export const readWorkload: (data: unknown) => Result<Workload, readonly WorkloadProblem[]> = reader(workloadSchema, checkWorkload);

/**
 * This schema accepts the shape of an instance file: each field with its type, and no other field.
 * It does not examine what the fields mean. The function `checkInstance` does that.
 */
export const instanceSchema: z.ZodType<InstanceType> = z.strictObject({
  format: z.literal(INSTANCE_FORMAT),
  id: z.string(),
  title: z.string(),
  resources: amountsSchema,
});

/**
 * This function reads an instance type from the data of an instance file. It gives the instance
 * type when the data has the shape of one and `checkInstance` finds no problem. If not, it gives
 * each problem.
 */
export const readInstance: (data: unknown) => Result<InstanceType, readonly InstanceProblem[]> = reader(instanceSchema, checkInstance);

/** This schema accepts the shape of one limit: each field with its type, and no other field. */
export const limitSchema: z.ZodType<Limit> = z.strictObject({
  id: z.string(),
  measure: z.string(),
  ceiling: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("amount"), amount: amountSchema }),
    z.strictObject({ kind: z.literal("resource"), resource: z.string() }),
  ]),
  headroom: z.number(),
});

/**
 * This schema accepts the shape of a limits file: each field with its type, and no other field.
 * It does not examine what the fields mean. The function `checkLimits` does that.
 */
export const limitsSchema: z.ZodType<LimitSet> = z.strictObject({
  format: z.literal(LIMITS_FORMAT),
  id: z.string(),
  title: z.string(),
  limits: z.array(limitSchema),
});

/**
 * This function reads a limit set from the data of a limits file. It gives the limit set when the
 * data has the shape of one and `checkLimits` finds no problem. If not, it gives each problem.
 */
export const readLimits: (data: unknown) => Result<LimitSet, readonly LimitProblem[]> = reader(limitsSchema, checkLimits);

const scaleSchema = z.enum(["linear", "log"]);
const rangeFields = { unit: z.string(), min: z.number(), max: z.number(), scale: scaleSchema };
const commandFields = { argv: z.array(z.string()), cwd: z.string(), env: z.record(z.string(), z.string()) };
const commandSchema = z.strictObject(commandFields);
const processSchema = z.strictObject({
  ...commandFields,
  ready: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("line"), text: z.string() }),
    z.strictObject({ kind: z.literal("http"), path: z.string() }),
  ]),
});

/**
 * This schema accepts the shape of the contract file of an app: each field with its type, and no other
 * field. It does not examine what the fields mean. The function `checkApp` does that.
 */
export const appSchema: z.ZodType<AppContract> = z.strictObject({
  format: z.literal(APP_FORMAT),
  id: z.string(),
  title: z.string(),
  repository: z.string(),
  variables: z.array(z.strictObject({ id: z.string(), title: z.string(), kind: z.enum(["request", "level", "store", "run"]), ...rangeFields })),
  classes: z.array(
    z.strictObject({
      id: z.string(),
      title: z.string(),
      rate: z.strictObject(rangeFields),
      request: z.array(z.string()),
      entry: z.discriminatedUnion("kind", [
        z.strictObject({
          kind: z.literal("http"),
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
          path: z.string(),
          body: z.string().optional(),
        }),
        z.strictObject({ kind: z.literal("service"), service: z.string() }),
      ]),
    }),
  ),
  start: z.strictObject({
    install: commandSchema.optional(),
    check: commandSchema.optional(),
    seed: commandSchema.optional(),
    run: processSchema.extend({
      lines: z.array(z.strictObject({ kind: z.enum(APP_LINE_KINDS), ev: z.string(), title: z.string() })).optional(),
    }),
  }),
  services: z.array(z.strictObject({ id: z.string(), title: z.string(), fake: processSchema })),
  metrics: z.array(
    z.strictObject({
      id: z.string(),
      kind: z.enum(["counter", "gauge"]),
      unit: z.string(),
      of: z.union([
        z.strictObject({ rate: z.string() }),
        z.strictObject({ level: z.string() }),
        z.strictObject({ total: z.string(), class: z.string() }),
        z.strictObject({ measure: z.string() }),
      ]),
    }),
  ),
});

/**
 * This function reads the contract of an app from the data of a contract file. It gives the contract when
 * the data has the shape of one and `checkApp` finds no problem. If not, it gives each problem.
 */
export const readApp: (data: unknown) => Result<AppContract, readonly AppProblem[]> = reader(appSchema, checkApp);
