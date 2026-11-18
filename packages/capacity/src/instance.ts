import type { Quantity } from "@mark1russell7/quantity";
import type { Problem } from "./law.ts";
import type { Amounts } from "./workload.ts";

/** This text is the format of an instance file. */
export const INSTANCE_FORMAT = "capacity-instance/1";

/** This text is the format of a limits file. */
export const LIMITS_FORMAT = "capacity-limits/1";

/**
 * These units are the unit of each resource that has one meaning in each instance. A resource with
 * one of these names is in a unit that converts to the unit here.
 *
 * - `cpu` is the CPU time that the instance gives in a unit of time, in cores.
 * - `memory` is the memory of the instance.
 * - `network` is the rate of the network of the instance.
 */
export const RESOURCE_UNITS: Readonly<Record<string, string>> = { cpu: "{core}", memory: "B", network: "bit/s" };

/**
 * An instance is the resources of one copy of a service: the amount of each resource, by its
 * name. Each amount is above 0. An instance that does not have a resource does not name it.
 */
export interface Instance {
  readonly resources: Amounts;
}

/**
 * An instance type is one size of a machine or a container, with a name. An instance file is this
 * record as JSON. Each copy of a service on one instance type has equal resources.
 */
export interface InstanceType extends Instance {
  readonly format: typeof INSTANCE_FORMAT;
  readonly id: string;
  readonly title: string;
}

/** An amount ceiling is a fixed amount, for example a latency of 200 ms. It is equal on each instance. */
export interface AmountCeiling {
  readonly kind: "amount";
  readonly amount: Quantity;
}

/** A resource ceiling is the whole of one resource of the instance, for example its memory. It grows with the instance. */
export interface ResourceCeiling {
  readonly kind: "resource";
  readonly resource: string;
}

/** A ceiling is the largest amount of a measure: a fixed amount, or a resource of the instance. */
export type Ceiling = AmountCeiling | ResourceCeiling;

/**
 * A limit is a ceiling on one measure of an instance, with headroom. The `headroom` is the share of
 * the ceiling that stays free, from 0 to below 1. The measure stays at or below the remainder.
 */
export interface Limit {
  readonly id: string;
  /** This id is the measure that the limit holds, for example `cpu` or `latency.p99`. */
  readonly measure: string;
  readonly ceiling: Ceiling;
  readonly headroom: number;
}

/** A limit set is the limits of a service, with a name. A limits file is this record as JSON. */
export interface LimitSet {
  readonly format: typeof LIMITS_FORMAT;
  readonly id: string;
  readonly title: string;
  readonly limits: readonly Limit[];
}

/** An instance problem code names the part of an instance that is not correct. */
export type InstanceProblemCode = "shape" | "format" | "id" | "amount" | "unit" | "resource";

/** An instance problem tells what is not correct, and where: `path` is the path of the field in the instance. */
export type InstanceProblem = Problem<InstanceProblemCode>;

/** A limit problem code names the part of a limit, or of a query of a limit, that is not correct. */
export type LimitProblemCode = "shape" | "format" | "id" | "measure" | "amount" | "unit" | "resource" | "headroom";

/** A limit problem tells what is not correct, and where: `path` is the path of the field in the limit or in the query. */
export type LimitProblem = Problem<LimitProblemCode>;
