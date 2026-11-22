import type { Quantity } from "@mark1russell7/quantity";
import type { Problem } from "./law.ts";

/** This text is the format of a workload file. */
export const WORKLOAD_FORMAT = "capacity-workload/1";

/** This name is the variable that gives the rate of a class. A class and a level cannot use it for a different amount. */
export const RATE = "rate";

/** Amounts are amounts with names. Each amount is in a canonical unit of `@mark1russell7/quantity`. */
export type Amounts = Readonly<Record<string, Quantity>>;

/**
 * A workload class is one kind of request. Its `rate` tells how many requests arrive in a unit of
 * time, for example in `{request}/s`. Its `request` gives each variable of one request, for example
 * the size of its body and its duration.
 *
 * A class is one point. Requests of two sizes are two classes, each with its own rate.
 *
 * The field `of` names the class of the contract of the app that the class is a point of. A class
 * with no `of` is a point of the class of the app with its own id.
 */
export interface WorkloadClass {
  readonly id: string;
  readonly of?: string | undefined;
  readonly rate: Quantity;
  readonly request: Amounts;
}

/**
 * A demand is the load that clients put on a service: its classes and its levels. A level is an
 * amount that stays in the service and does not come with each request, for example the open
 * connections.
 *
 * A demand is extensive. The rates and the levels of two demands add, and they divide between the
 * instances of a service. The variables of one request do not.
 */
export interface Demand {
  readonly classes: readonly WorkloadClass[];
  readonly levels: Amounts;
}

/** A plan is a workload that a person wrote. Its `note` tells where its numbers come from. */
export interface PlanSource {
  readonly kind: "plan";
  readonly note: string;
}

/**
 * A metrics source is a workload from the live metrics of an app. Its `origin` names the place of
 * the metrics. The window goes from `from` to `to`, and each is a UTC time.
 */
export interface MetricsSource {
  readonly kind: "metrics";
  readonly origin: string;
  readonly from: string;
  readonly to: string;
}

/** A workload source tells where the numbers of a workload come from: a plan or the live metrics. */
export type WorkloadSource = PlanSource | MetricsSource;

/** A workload is a demand with a name and a source. A workload file is this record as JSON. */
export interface Workload extends Demand {
  readonly format: typeof WORKLOAD_FORMAT;
  readonly id: string;
  readonly title: string;
  readonly source: WorkloadSource;
}

/** A workload problem code names the part of a workload, or of a query, that is not correct. */
export type WorkloadProblemCode =
  | "shape"
  | "format"
  | "id"
  | "rate"
  | "amount"
  | "unit"
  | "class"
  | "source"
  | "factor"
  | "variable";

/** A workload problem tells what is not correct, and where: `path` is the path of the field in the workload. */
export type WorkloadProblem = Problem<WorkloadProblemCode>;

/** This demand has no class and no level. It is the zero of the sum of demands. */
export const NO_DEMAND: Demand = { classes: [], levels: {} };
