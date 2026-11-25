import { err, ok, type Result } from "@mark1russell7/optional";
import {
  UnitError,
  convertible,
  divideUnits,
  isCanonicalUnit,
  kindOf,
  multiplyUnits,
  parseUnit,
  factorOf,
  isQuantity,
  whyNotConvertible,
} from "@mark1russell7/quantity";
import { instancePointOf, loadPointOf, totalRate, type Load } from "./demand.ts";
import { DEFAULT_LEVEL, type Law, type Measure, type Problem, type ProblemCode } from "./law.ts";
import { NAME, SLUG, finite, repeated } from "./names.ts";
import { recordOf, valuesAt } from "./program.ts";
import { edgePointOf, edgeValuesOf, heldValue, intervalOf, levelProblem, pointValuesOf, runOf, type LevelOptions, type LoadPoint, type Range } from "./value.ts";
import { demandProblems } from "./workload-check.ts";
import { RATE, type Amounts, type Demand, type WorkloadClass, type WorkloadProblemCode } from "./workload.ts";

/** This text is the format of a composition file. */
export const COMPOSITION_FORMAT = "capacity-composition/1";

/**
 * The scope of a law term tells where the law applies. The scope `instance` gives one part with no
 * class. The scope `each` gives one part for each class of the demand. A list of class ids gives
 * one part for each class in the list.
 */
export type Over = "instance" | "each" | readonly string[];

/**
 * A law term adds a law to a composition, times `factor` (1 when the term gives none). The field
 * `load` tells which rate the variable `rate` of the law reads. A term over the instance always
 * reads the total rate.
 *
 * A term with a `base` gives the change of its law from the base point. The change is the value at
 * the load point less the value at the base point. The base point is the load point, with the
 * amount of `base` for each variable that `base` names. Use it for a law of a ladder of one level.
 * That ladder holds the other levels at a base point. A demand with no amount for a variable of
 * `base` stays at the base point, thus the change is 0.
 */
export interface LawTerm {
  readonly law: string;
  readonly over: Over;
  readonly load?: Load | undefined;
  readonly factor?: number | undefined;
  readonly base?: Amounts | undefined;
}

/**
 * A nested term adds the value of a different composition over the same demand, times `factor`.
 * Thus layer 3 of an app names layer 2, and layer 2 names layer 1. No layer copies the terms of
 * an other layer.
 */
export interface NestedTerm {
  readonly composition: string;
  readonly factor?: number | undefined;
}

/** A composition term is a law term or a nested term. */
export type CompositionTerm = LawTerm | NestedTerm;

/**
 * A composition gives one measure of a subject as a sum of laws over a demand. Each term gives
 * parts, and the value is the sum of the parts in the unit of the measure.
 *
 * The units of a law term tell if a part is the value of the law times a rate. A law of the CPU
 * time of one request, in `{core}·ms/{request}`, gives `{core}` times the rate of its class. A law
 * of the memory of an instance, in `MiB`, gives `MiB` with no rate.
 */
export interface Composition {
  readonly format: typeof COMPOSITION_FORMAT;
  readonly id: string;
  readonly title: string;
  readonly subject: string;
  readonly measure: Measure;
  readonly terms: readonly CompositionTerm[];
}

/** A catalog holds the laws and the compositions that the terms of a composition can name. */
export interface Catalog {
  readonly laws: readonly Law[];
  readonly compositions?: readonly Composition[];
}

/** These options set the level of the intervals and the state of the instance: its heap and its age, for example. */
export interface CompositionOptions extends LevelOptions {
  readonly given?: Amounts;
}

/** A composition problem code names the part of a composition, or of a query, that is not correct. */
export type CompositionProblemCode = ProblemCode | WorkloadProblemCode | "term" | "law" | "composition";

/** A composition problem tells what is not correct, and where. */
export type CompositionProblem = Problem<CompositionProblemCode>;

/**
 * A part value is one part of a composition value, in the unit of the composition. The `weight`
 * is the number that multiplies the value of the law or of the nested composition. The ends of a
 * range change places when the weight is less than 0.
 */
interface PartBase {
  readonly term: number;
  readonly weight: number;
  readonly value: number;
  readonly interval: Range;
  readonly run: Range;
}

/**
 * A law part is the value of a law at the point of one class. When `class` is null, it is the
 * value at the point of the instance. A term with a base gives two parts. The first part is at the load point.
 * The second part is at the base point, with `base` true and the weight times -1.
 */
export interface LawPart extends PartBase {
  readonly kind: "law";
  readonly law: string;
  readonly class: string | null;
  readonly base: boolean;
  readonly outside: readonly string[];
}

/** A nested part is the value of a nested composition, with its own parts. */
export interface NestedPart extends PartBase {
  readonly kind: "composition";
  readonly composition: string;
  readonly parts: readonly PartValue[];
}

/** A part value is a law part or a nested part. */
export type PartValue = LawPart | NestedPart;

/**
 * A composition value is the answer of a composition over a demand, in the unit of its measure.
 *
 * Replicate `i` is the sum of row `i` of each law, each times its weight. The `interval` is the
 * share `level` of the replicates, made wider to hold the value. The range `run` is where one
 * measured run falls. The value is an extrapolation when `extrapolated` is true: a part reads a
 * variable outside its range.
 */
export interface CompositionValue {
  readonly value: number;
  readonly unit: string;
  readonly level: number;
  readonly interval: Range;
  readonly run: Range;
  readonly replicates: readonly number[];
  readonly parts: readonly PartValue[];
  readonly extrapolated: boolean;
}

const problem = (code: CompositionProblemCode, path: string, message: string): CompositionProblem => ({ code, path, message });

/** This function tells if a term names a law. */
export const isLawTerm = (term: CompositionTerm): term is LawTerm => Object.hasOwn(term, "law");

/** This function gives the reason that the values of a unit do not add, or undefined when they add. */
const sumUnitProblem = (unit: string): string | undefined => {
  if (!isCanonicalUnit(unit)) return `"${unit}" is not a canonical unit.`;
  const parsed = parseUnit(unit);
  if (parsed.log) return `"${unit}" is a level, and levels do not add.`;
  if (parsed.offset !== undefined) return `"${unit}" is an absolute temperature, and absolute temperatures do not add.`;
  return undefined;
};

const NOT_SLUG = 'is not lower-case words joined by ".", "-" or "/".';

/**
 * This function examines a composition and gives each problem that it finds. A composition with no
 * problem gives an empty list.
 *
 * It examines the format, the ids, the title and the unit of the measure. It examines that each
 * term names a law or a composition and has a correct scope. It examines that each factor is a
 * finite number other than 0. It does not look for the laws: `compositionValue` does that.
 */
export const checkComposition = (composition: Composition): readonly CompositionProblem[] => {
  const problems: CompositionProblem[] = [];
  const add = (code: CompositionProblemCode, path: string, message: string): void => {
    problems.push(problem(code, path, message));
  };
  if (composition.format !== COMPOSITION_FORMAT) add("format", "format", `The format is not "${COMPOSITION_FORMAT}".`);
  for (const [path, id] of [
    ["id", composition.id],
    ["subject", composition.subject],
    ["measure.id", composition.measure.id],
  ] as const) {
    if (!SLUG.test(id)) add("id", path, `"${id}" ${NOT_SLUG}`);
  }
  if (composition.title.trim() === "") add("id", "title", "The title is empty.");
  const unit = sumUnitProblem(composition.measure.unit);
  if (unit !== undefined) add("unit", "measure.unit", unit);
  if (composition.terms.length === 0) add("term", "terms", "The composition has no term.");

  for (const [index, term] of composition.terms.entries()) {
    const path = `terms[${index}]`;
    if (term.factor !== undefined && (!finite(term.factor) || term.factor === 0)) {
      add("factor", `${path}.factor`, `The factor ${term.factor} is not a finite number other than 0.`);
    }
    if (!isLawTerm(term)) {
      if (!SLUG.test(term.composition)) add("id", `${path}.composition`, `"${term.composition}" ${NOT_SLUG}`);
      else if (term.composition === composition.id) add("composition", `${path}.composition`, "The composition names itself.");
      continue;
    }
    if (!SLUG.test(term.law)) add("id", `${path}.law`, `"${term.law}" ${NOT_SLUG}`);
    if (typeof term.over !== "string") {
      if (term.over.length === 0) add("class", `${path}.over`, "The list of classes is empty.");
      for (const [at, id] of term.over.entries()) {
        if (!SLUG.test(id)) add("id", `${path}.over[${at}]`, `"${id}" ${NOT_SLUG}`);
      }
      const twice = repeated(term.over);
      if (twice !== undefined) add("class", `${path}.over`, `The list has the class "${twice}" two times.`);
    } else if (term.over !== "instance" && term.over !== "each") {
      add("term", `${path}.over`, `The scope "${String(term.over)}" is not "instance", "each" or a list of classes.`);
    }
    if (term.over === "instance" && term.load === "class") {
      add("term", `${path}.load`, "A term over the instance has no class. Its law reads the total rate.");
    }
    if (term.base !== undefined) {
      const names = Object.keys(term.base);
      if (names.length === 0) add("term", `${path}.base`, "The base names no variable.");
      for (const name of names) {
        const where = `${path}.base.${name}`;
        if (!NAME.test(name)) add("variable", where, `"${name}" is not a name: a lower-case letter, then letters and digits.`);
        else if (name === RATE) add("variable", where, "The rate comes from the demand. A base does not hold it.");
        else if (!isQuantity(term.base[name])) add("amount", where, `The amount of "${name}" is not a finite amount in a canonical unit.`);
      }
    }
  }
  return problems;
};

/**
 * A weight multiplies the value of the law of a term. It is the number `by`. When the units of the
 * law need a rate, it is also times the rate of the part in the unit `rate`.
 */
interface Weight {
  readonly by: number;
  readonly rate: string | undefined;
}

/**
 * This function gives the weight that changes a value in `from` to a value in `to`. The quotient
 * `to / from` decides. A quotient with no dimension needs no rate. A quotient that is a rate needs
 * the rate of the part, in the unit of the quotient.
 */
const weightOf = (from: string, to: string, factor: number, path: string): Result<Weight, CompositionProblem> => {
  try {
    const per = divideUnits(to, from);
    if (convertible(per, "count")) return ok({ by: factor * factorOf(from, to), rate: undefined });
    if (kindOf(per) === "frequency") return ok({ by: factor * factorOf(multiplyUnits(from, per), to), rate: per });
    return err(problem("unit", path, `The law gives "${from}". That unit does not give "${to}", alone or times a rate.`));
  } catch (error) {
    if (error instanceof UnitError) return err(problem("unit", path, `The law gives "${from}", and "${to}" does not come from it: ${error.message}`));
    throw error;
  }
};

/** This function gives the number that the rate of a class is in the unit of a weight, or the problem that stops it. */
const classRate = (demand: Demand, id: string, unit: string, path: string): Result<number, CompositionProblem> => {
  const rate = (demand.classes.find((entry) => entry.id === id) as WorkloadClass).rate;
  if (!convertible(rate.unit, unit)) {
    const why = whyNotConvertible(rate.unit, unit) ?? "the units are different";
    return err(problem("unit", `${path}.rate`, `The rate of the class "${id}" is in "${rate.unit}". The law needs a rate in "${unit}": ${why}.`));
  }
  return ok(rate.value * factorOf(rate.unit, unit));
};

/** This function gives the number that the total rate of a demand is in the unit of a weight, or the problem that stops it. */
const instanceRate = (demand: Demand, unit: string, path: string): Result<number, CompositionProblem> => {
  const total = totalRate(demand, unit);
  return total.tag === "err" ? err(under(total.error, path)) : ok(total.value.value);
};

/**
 * This function gives the problem of the base of a term for its law, or undefined. Each name of the
 * base is a variable of the law, and its amount converts to the unit of that variable.
 */
const baseProblem = (law: Law, base: Amounts, path: string): CompositionProblem | undefined => {
  for (const [name, amount] of Object.entries(base)) {
    const variable = law.variables.find((each) => each.id === name);
    if (variable === undefined) return problem("variable", `${path}.${name}`, `The law "${law.id}" has no variable "${name}".`);
    if (!convertible(amount.unit, variable.unit)) {
      const why = whyNotConvertible(amount.unit, variable.unit) ?? "the units are different";
      return problem("unit", `${path}.${name}`, `The variable "${name}" of the law "${law.id}" is in "${variable.unit}", not in "${amount.unit}": ${why}.`);
    }
  }
  return undefined;
};

/** This function gives the amounts of a base that no list of amounts gives. The point holds them at the base. */
const heldOf = (base: Amounts, lists: readonly Amounts[]): Amounts =>
  Object.fromEntries(Object.entries(base).filter(([name]) => !lists.some((amounts) => Object.hasOwn(amounts, name))));

/** This function gives the base point of a term: the load point, with the amount of the base for each variable that it names. */
const basePointOf = (law: Law, point: LoadPoint, base: Amounts): LoadPoint => {
  const next: Record<string, number> = { ...point };
  for (const [name, amount] of Object.entries(base)) {
    const variable = law.variables.find((each) => each.id === name) as Law["variables"][number];
    next[name] = amount.value * factorOf(amount.unit, variable.unit);
  }
  return next;
};

/** The sum of the parts of one composition, with the change from its interval to its run. */
interface Sum {
  readonly unit: string;
  readonly value: number;
  readonly replicates: readonly number[];
  readonly widen: Range;
  readonly parts: readonly PartValue[];
  readonly extrapolated: boolean;
}

/** This function gives a range times a weight. The ends change places for a weight less than 0. */
const times = (range: Range, weight: number): Range =>
  weight >= 0 ? { low: weight * range.low, high: weight * range.high } : { low: weight * range.high, high: weight * range.low };

/** This function gives a problem of a query with the path of its term in front. */
const under = (found: Problem<string>, path: string): CompositionProblem => ({
  code: found.code as CompositionProblemCode,
  path: `${path}.${found.path}`,
  message: found.message,
});

/** This function gives a map of records by id, or the problem of an id that the list has two times. */
const byId = <T extends { readonly id: string }>(records: readonly T[], what: string): Result<Map<string, T>, CompositionProblem> => {
  const map = new Map<string, T>();
  for (const [index, record] of records.entries()) {
    if (map.has(record.id)) return err(problem(what === "laws" ? "law" : "composition", `${what}[${index}].id`, `The catalog has two ${what} with the id "${record.id}".`));
    map.set(record.id, record);
  }
  return ok(map);
};

/** A prepared composition holds each law and each nested composition that a composition reads, and the count of its rows. */
export interface Prepared {
  readonly composition: Composition;
  readonly reads: ReadonlyMap<string, Law>;
  readonly nested: ReadonlyMap<string, Composition>;
  /** This count is the count of replicates of the composition: the least count of the laws that it reads. */
  readonly rows: number;
  readonly level: number;
}

/**
 * This function examines a composition and its catalog one time, for the queries over many demands.
 * It gives each problem of `compositionValue` that does not come from a demand.
 */
export const preparedOf = (composition: Composition, catalog: Catalog, level: number): Result<Prepared, CompositionProblem> => {
  const own = checkComposition(composition)[0];
  if (own !== undefined) return err(own);
  const laws = byId(catalog.laws, "laws");
  if (laws.tag === "err") return laws;
  const nested = byId(catalog.compositions ?? [], "compositions");
  if (nested.tag === "err") return nested;

  // The walk finds each law that the composition reads, and each problem of a name or a cycle.
  const reads = new Map<string, Law>();
  const walked = new Set<string>();
  const walk = (at: Composition, prefix: string, stack: readonly string[]): CompositionProblem | undefined => {
    for (const [index, term] of at.terms.entries()) {
      const path = `${prefix}terms[${index}]`;
      if (isLawTerm(term)) {
        const law = laws.value.get(term.law);
        if (law === undefined) return problem("law", `${path}.law`, `The catalog has no law "${term.law}".`);
        const badBase = baseProblem(law, term.base ?? {}, `${path}.base`);
        if (badBase !== undefined) return badBase;
        reads.set(law.id, law);
        continue;
      }
      if (stack.includes(term.composition)) {
        return problem("composition", `${path}.composition`, `The compositions make a cycle: ${[...stack, term.composition].join(" → ")}.`);
      }
      const next = nested.value.get(term.composition);
      if (next === undefined) return problem("composition", `${path}.composition`, `The catalog has no composition "${term.composition}".`);
      if (walked.has(next.id)) continue;
      const inner = `compositions.${next.id}.`;
      const bad = checkComposition(next)[0];
      if (bad !== undefined) return { ...bad, path: `${inner}${bad.path}` };
      const deeper = walk(next, inner, [...stack, next.id]);
      if (deeper !== undefined) return deeper;
      walked.add(next.id);
    }
    return undefined;
  };
  const broken = walk(composition, "", [composition.id]);
  if (broken !== undefined) return err(broken);

  for (const law of reads.values()) {
    const noLevel = levelProblem(law, level, true);
    if (noLevel !== undefined) return err(under(noLevel, `laws.${law.id}`));
  }
  const rows = Math.min(...[...reads.values()].map((law) => law.replicates.length));
  return ok({ composition, reads, nested: nested.value, rows, level });
};

/** A leaf is the law of one part at its load point, times its weight. The path names the part in a problem. */
interface Leaf {
  readonly kind: "law";
  readonly term: number;
  readonly law: Law;
  readonly class: string | null;
  readonly base: boolean;
  readonly weight: number;
  readonly point: LoadPoint;
  readonly path: string;
}

/** A branch is the tree of a nested composition, times its weight. */
interface Branch {
  readonly kind: "composition";
  readonly term: number;
  readonly composition: string;
  readonly weight: number;
  readonly tree: Tree;
}

/** A tree is the parts of one composition over one demand, before the laws give their values. */
interface Tree {
  readonly unit: string;
  readonly nodes: readonly (Leaf | Branch)[];
}

/** This function gives the tree of a prepared composition over a demand, or the problem that stops it. It does not examine the demand. */
const treeOf = (prepared: Prepared, demand: Demand, given: Amounts): Result<Tree, CompositionProblem> => {
  const trees = new Map<string, Tree>();
  const build = (at: Composition, prefix: string): Result<Tree, CompositionProblem> => {
    const unit = at.measure.unit;
    const nodes: (Leaf | Branch)[] = [];
    for (const [index, term] of at.terms.entries()) {
      const path = `${prefix}terms[${index}]`;
      const factor = term.factor ?? 1;
      if (!isLawTerm(term)) {
        const inner = prepared.nested.get(term.composition) as Composition;
        let tree = trees.get(inner.id);
        if (tree === undefined) {
          const found = build(inner, `compositions.${inner.id}.`);
          if (found.tag === "err") return found;
          tree = found.value;
          trees.set(inner.id, tree);
        }
        if (!convertible(tree.unit, unit)) {
          const why = whyNotConvertible(tree.unit, unit) ?? "the units are different";
          return err(problem("unit", `${path}.composition`, `The composition "${inner.id}" gives "${tree.unit}", not "${unit}": ${why}.`));
        }
        nodes.push({ kind: "composition", term: index, composition: inner.id, weight: factor * factorOf(tree.unit, unit), tree });
        continue;
      }

      const law = prepared.reads.get(term.law) as Law;
      const weight = weightOf(law.measure.unit, unit, factor, `${path}.law`);
      if (weight.tag === "err") return weight;
      const targets: readonly (string | null)[] =
        term.over === "instance" ? [null] : term.over === "each" ? demand.classes.map((entry) => entry.id) : term.over;
      for (const id of targets) {
        const where = `${path}.${id ?? "instance"}`;
        const request = id === null ? {} : (demand.classes.find((entry) => entry.id === id)?.request ?? {});
        const state = term.base === undefined ? given : { ...heldOf(term.base, [request, demand.levels, given]), ...given };
        const point = id === null ? instancePointOf(demand, law, state) : loadPointOf(demand, id, law, state, { load: term.load ?? "class" });
        if (point.tag === "err") return err(under(point.error, where));
        let by = weight.value.by;
        const rateUnit = weight.value.rate;
        if (rateUnit !== undefined) {
          const rate = id === null ? instanceRate(demand, rateUnit, where) : classRate(demand, id, rateUnit, where);
          if (rate.tag === "err") return rate;
          by *= rate.value;
        }
        nodes.push({ kind: "law", term: index, law, class: id, base: false, weight: by, point: point.value, path: where });
        if (term.base !== undefined) {
          nodes.push({ kind: "law", term: index, law, class: id, base: true, weight: -by, point: basePointOf(law, point.value, term.base), path: `${where}.base` });
        }
      }
    }
    return ok({ unit, nodes });
  };
  return build(prepared.composition, "");
};

/** This function gives the sum of the parts of a tree, with the values of its laws. The map `sums` keeps the sum of each nested tree. */
const sumOf = (tree: Tree, rows: number, level: number, sums: Map<Tree, Sum>): Result<Sum, CompositionProblem> => {
  const known = sums.get(tree);
  if (known !== undefined) return ok(known);
  const replicates = new Array<number>(rows).fill(0);
  const widen = { low: 0, high: 0 };
  const parts: PartValue[] = [];
  let value = 0;
  let extrapolated = false;
  const keep = (part: PartValue, spread: readonly number[], change: Range): void => {
    parts.push(part);
    value += part.value;
    for (const [row, draw] of spread.entries()) replicates[row] = (replicates[row] as number) + part.weight * draw;
    const scaled = times(change, part.weight);
    widen.low += scaled.low;
    widen.high += scaled.high;
  };

  for (const node of tree.nodes) {
    if (node.kind === "composition") {
      const found = sumOf(node.tree, rows, level, sums);
      if (found.tag === "err") return found;
      const sum = found.value;
      const { weight } = node;
      const interval = intervalOf(sum.value, sum.replicates, level);
      const scaled = times(interval, weight);
      const change = times(sum.widen, weight);
      keep(
        {
          kind: "composition",
          term: node.term,
          composition: node.composition,
          weight,
          value: weight * sum.value,
          interval: scaled,
          run: { low: scaled.low + change.low, high: scaled.high + change.high },
          parts: sum.parts,
        },
        sum.replicates,
        sum.widen,
      );
      extrapolated ||= sum.extrapolated;
      continue;
    }

    const evaluated = pointValuesOf(node.law, node.point);
    if (evaluated.tag === "err") return err(under(evaluated.error, node.path));
    const by = node.weight;
    const [estimate, ...all] = evaluated.value.values;
    const spread = all.slice(0, rows);
    const interval = intervalOf(estimate, spread, level);
    const run = runOf(node.law, interval, level);
    const change = { low: run.low - interval.low, high: run.high - interval.high };
    const scaled = times(interval, by);
    const scaledChange = times(change, by);
    keep(
      {
        kind: "law",
        term: node.term,
        law: node.law.id,
        class: node.class,
        base: node.base,
        weight: by,
        value: by * estimate,
        interval: scaled,
        run: { low: scaled.low + scaledChange.low, high: scaled.high + scaledChange.high },
        outside: evaluated.value.outside,
      },
      spread,
      change,
    );
    extrapolated ||= evaluated.value.outside.length > 0;
  }
  const sum: Sum = { unit: tree.unit, value, replicates, widen, parts, extrapolated };
  sums.set(tree, sum);
  return ok(sum);
};

/**
 * This function gives the value of a composition over a demand, with its interval. The catalog
 * gives each law and each nested composition that a term names. It can hold more.
 *
 * Each part pairs its replicates by row. Row `i` of each law is one draw of the doubt of that law.
 * Laws from separate fits have independent rows. Two laws that share points share their doubt
 * only when their fits use the same resample for row `i`. The count of rows is the least count of
 * the laws that the composition reads.
 *
 * The range `run` adds the change from the interval to the run of each part. That sum is exact
 * when the noise of each part moves with the noise of each other part. For independent noise, the
 * sum is wider than the true range. Thus the range is on the safe side for a limit.
 *
 * The function gives a problem for a composition that is not correct, for a missing law or
 * composition, and for a cycle of compositions. It gives the problems of `loadPointOf` and of
 * `lawValue` for each part, with the path of the term in front.
 */
export const compositionValue = (
  composition: Composition,
  catalog: Catalog,
  demand: Demand,
  options: CompositionOptions = {},
): Result<CompositionValue, CompositionProblem> => {
  const level = options.level ?? DEFAULT_LEVEL;
  const own = checkComposition(composition)[0];
  if (own !== undefined) return err(own);
  const badDemand = demandProblems(demand)[0];
  if (badDemand !== undefined) return err(under(badDemand, "demand"));
  const prepared = preparedOf(composition, catalog, level);
  if (prepared.tag === "err") return prepared;
  const tree = treeOf(prepared.value, demand, options.given ?? {});
  if (tree.tag === "err") return tree;
  const sum = sumOf(tree.value, prepared.value.rows, level, new Map());
  if (sum.tag === "err") return sum;
  const { value, replicates, widen, parts, extrapolated } = sum.value;
  const interval = intervalOf(value, replicates, level);
  return ok({
    value,
    unit: composition.measure.unit,
    level,
    interval,
    run: { low: interval.low + widen.low, high: interval.high + widen.high },
    replicates,
    parts,
    extrapolated,
  });
};

/** A flat part is the law of one part at its load point, times the product of the weights down to it. */
export interface FlatPart {
  readonly law: Law;
  readonly point: LoadPoint;
  readonly weight: number;
}

/** This function adds the leaves of a tree to `into`, each times `weight`. */
const flatten = (tree: Tree, weight: number, into: FlatPart[]): void => {
  for (const node of tree.nodes) {
    if (node.kind === "composition") flatten(node.tree, weight * node.weight, into);
    else into.push({ law: node.law, point: node.point, weight: weight * node.weight });
  }
};

/**
 * This function gives the flat parts of a prepared composition over a demand, or the problem that
 * stops them. The value of a row is the sum of the law of each part at its point, times its weight.
 * The function does not examine the demand.
 */
export const flatPartsOf = (prepared: Prepared, demand: Demand, given: Amounts = {}): Result<readonly FlatPart[], CompositionProblem> => {
  const tree = treeOf(prepared, demand, given);
  if (tree.tag === "err") return tree;
  const parts: FlatPart[] = [];
  flatten(tree.value, 1, parts);
  return ok(parts);
};

/**
 * This function gives the value of one row of some flat parts. Row 0 is the estimate, and row `i`
 * is replicate `i - 1` of each law. A part with no finite value gives undefined.
 */
export const rowValueOf = (parts: readonly FlatPart[], row: number): number | undefined => rowValuesOf(parts, row, row)[0];

/** This function gives the record that the law of a part reads in one row, or undefined when the law has no such row. */
const rowRecordOf = (law: Law, point: LoadPoint, row: number): Readonly<Record<string, number>> | undefined => {
  const values = row === 0 ? law.constants.map((constant) => constant.value) : law.replicates[row - 1];
  return values === undefined ? undefined : recordOf(law.constants.map((constant) => constant.id), values, point);
};

/**
 * This function gives the value of each row from `first` to `last` of some flat parts, as `rowValueOf` gives it.
 * It evaluates the law of each part over all the rows in one call. Thus a search that reads each row at one load
 * evaluates each law one time for that load. Past the range of a variable, each value holds, as heldValue tells.
 */
export const rowValuesOf = (parts: readonly FlatPart[], first: number, last: number): readonly (number | undefined)[] => {
  const sums: (number | undefined)[] = [];
  for (let row = first; row <= last; row += 1) sums.push(0);
  for (const { law, point, weight } of parts) {
    const edge = edgePointOf(law, point);
    const atEdge = edge === undefined ? undefined : edgeValuesOf(law, edge);
    const records: Readonly<Record<string, number>>[] = [];
    const slots: number[] = [];
    for (let row = first; row <= last; row += 1) {
      const record = sums[row - first] === undefined ? undefined : rowRecordOf(law, point, row);
      if (record === undefined) sums[row - first] = undefined;
      else {
        records.push(record);
        slots.push(row - first);
      }
    }
    valuesAt(law.form.program, records).forEach((value, index) => {
      const slot = slots[index] as number;
      const found = atEdge === undefined ? value : heldValue(value, atEdge[slot + first]);
      sums[slot] = found === undefined ? undefined : (sums[slot] as number) + weight * found;
    });
  }
  return sums.map((value) => (value !== undefined && Number.isFinite(value) ? value : undefined));
};

/** This function tells if a flat part reads a variable of its law outside the range of that variable. */
export const partsOutside = (parts: readonly FlatPart[]): boolean =>
  parts.some(({ law, point }) =>
    law.variables.some((variable) => (point[variable.id] as number) < variable.min || (point[variable.id] as number) > variable.max),
  );
