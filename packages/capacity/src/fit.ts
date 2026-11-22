import { err, ok, type Result } from "@mark1russell7/optional";
import {
  bootstrapSeparable,
  heldOutSeparable,
  rankSeparable,
  SEPARABLE_BOOTSTRAP_RUNS,
  type SeparableGroup,
  type SeparableModel,
} from "@mark1russell7/rigor-statistics";
import { FORM_VARIABLE, FORMS, constantIdsOf, formOf, modelProblem, pointsProblem, separableOf } from "./forms.ts";
import type { Binding, CatalogForm, Points } from "./forms.ts";
import { DEFAULT_LEVEL, bootstrapDraws, leastCount, leastGroups, type FitError, type Law, type Loser, type ResidualKind } from "./law.ts";

/** The options of `fitLaw`. */
export interface LawFitOptions {
  /** These forms compete for the law. The default is each form of the catalog. */
  readonly forms?: readonly CatalogForm[];
  /** This binding puts the form that wins into the law. The default is the variable `x` and the ids of the catalog. */
  readonly binding?: Binding;
  /**
   * This kind tells how the fit compares a value with a form. The default is `"absolute"`. A `"relative"` fit uses the
   * weights `1 / y^2`. Thus each value of a relative fit is not 0.
   */
  readonly residual?: ResidualKind;
  /**
   * This list gives the group of each point. The points of one group are replicates of one load. The held-out fit holds
   * out each group. The default group of a point is its value of the variable.
   */
  readonly groups?: readonly SeparableGroup[];
  /**
   * This list gives the group of each point for the bootstrap. Each run of the bootstrap draws whole groups of this
   * list. The default is the list `groups`. A group of the bootstrap is an independent unit of the data, for example
   * the job that measured its points. A plan that fixes its loads has no random load, thus a draw of whole loads is
   * the wrong model for it.
   */
  readonly bootstrapGroups?: readonly SeparableGroup[];
  /** This number is the number of runs of the bootstrap. The default is `SEPARABLE_BOOTSTRAP_RUNS` of rigor-statistics. */
  readonly runs?: number;
  /** This seed starts the draws of the bootstrap. The default is 1. */
  readonly seed?: number;
}

/** A form rank is one form that competed in a law fit, with the error of its held-out residuals. */
export interface FormRank {
  readonly form: string;
  /** This error comes from the held-out residuals that have a value. With no such residual, each error is NaN. */
  readonly error: FitError;
  /** This number is the number of points with no held-out prediction. */
  readonly missing: number;
  /** This text tells why the form has no fit. A form with a fit has no reason. */
  readonly reason?: string;
}

/**
 * A law fit is the part of a law that comes from a fit of its points. It has the form, the constants, the replicates and
 * the record of the fit. The list `ranks` keeps each form that competed, best first.
 */
export interface LawFit extends Pick<Law, "form" | "constants" | "replicates" | "fit"> {
  readonly ranks: readonly FormRank[];
}

/**
 * This function fits a law of one variable to its points. Each form competes, and the form with the smallest root mean
 * square of its held-out residuals wins. A form with a point that has no held-out prediction ranks after each form with
 * a prediction at each point.
 *
 * The fit of each form is `fitSeparable` of `@mark1russell7/rigor-statistics`. Each held-out residual comes from a fit of
 * the other groups. The replicates of the winner come from a bootstrap of the whole groups of `bootstrapGroups`. The losers of the record are
 * the other forms with a held-out prediction at each point.
 *
 * The function gives an error for points that a fit cannot use, and when no form has a held-out prediction at each point.
 * It gives an error for fewer groups of the bootstrap than `leastGroups` of the level 0.95, because their draws are too few for an interval.
 */
export const fitLaw = (points: Points, options: LawFitOptions = {}): Result<LawFit, string> => {
  const fault = pointsProblem(points);
  if (fault !== undefined) return err(fault);
  const n = points.x.length;
  const forms = options.forms ?? FORMS;
  if (forms.length === 0) return err("The fit has no form.");
  const twice = forms.find((form, index) => forms.findIndex((other) => other.id === form.id) !== index);
  if (twice !== undefined) return err(`The form "${twice.id}" is in the list of forms two times.`);
  const residual = options.residual ?? "absolute";
  if (residual === "relative" && points.y.some((y) => y === 0)) return err("A relative fit needs values that are not 0.");
  const groups = options.groups ?? points.x;
  if (groups.length !== n) return err(`The fit has ${groups.length} groups for ${n} points.`);
  const groupCount = new Set(groups).size;
  if (groupCount < 2) return err("The fit needs two groups or more, because the held-out fit holds out one group.");
  const bootstrapGroups = options.bootstrapGroups ?? groups;
  if (bootstrapGroups.length !== n) return err(`The fit has ${bootstrapGroups.length} groups of the bootstrap for ${n} points.`);
  const bootstrapCount = new Set(bootstrapGroups).size;
  const leastBootstrap = leastGroups(DEFAULT_LEVEL);
  if (bootstrapCount < leastBootstrap) {
    return err(
      `The bootstrap draws whole groups, and the fit has ${bootstrapCount} of them. Thus the count of different draws is ` +
        `${bootstrapDraws(bootstrapCount)}. The level ${DEFAULT_LEVEL} needs ${leastCount(DEFAULT_LEVEL)}, thus ${leastBootstrap} groups or more.`,
    );
  }
  const weighted = residual === "relative" ? { weights: points.y.map((y) => 1 / (y * y)) } : {};

  const models: Record<string, SeparableModel<number>> = {};
  const skipped: FormRank[] = [];
  for (const form of forms) {
    const model = separableOf(form, points.x);
    const reason = modelProblem(form, model);
    if (reason === undefined) models[form.id] = model;
    else skipped.push({ form: form.id, error: { mae: Number.NaN, rmse: Number.NaN }, missing: n, reason });
  }
  const ranked = rankSeparable(models, points.x, points.y, { groups, residual, ...weighted });
  const ranks: FormRank[] = [
    ...ranked.map((rank): FormRank => ({
      form: rank.id,
      error: { mae: rank.error.mae, rmse: rank.error.rmse },
      missing: rank.error.missing,
      ...(rank.fit === null ? { reason: `The form "${rank.id}" has no least-squares fit to ${n} points.` } : {}),
    })),
    ...skipped,
  ];
  const best = ranked[0];
  if (best === undefined || best.fit === null || best.error.missing > 0) {
    return err(`No form of ${forms.length} has a held-out prediction at each of the ${n} points.`);
  }
  const winner = forms.find((form) => form.id === best.id) as CatalogForm;
  const model = models[best.id] as SeparableModel<number>;
  const held = heldOutSeparable(model, points.x, points.y, { groups, residual, ...weighted });
  const boot = bootstrapSeparable(model, points.x, points.y, {
    groups: bootstrapGroups,
    ...weighted,
    runs: options.runs ?? SEPARABLE_BOOTSTRAP_RUNS,
    seed: options.seed ?? 1,
  });
  if (boot === null) return err(`The form "${winner.id}" has no fit for the bootstrap.`);
  const least = leastCount(DEFAULT_LEVEL);
  if (boot.replicates.length < least) {
    return err(`The bootstrap gave ${boot.replicates.length} fits in ${boot.runs} runs. The level ${DEFAULT_LEVEL} needs ${least}.`);
  }
  const binding = options.binding ?? { variable: FORM_VARIABLE };
  const values = [...best.fit.coefficients, ...best.fit.shapes];
  const constants = constantIdsOf(winner).map((id, index) => ({ id: binding.constants?.[id] ?? id, value: values[index] as number }));
  const losers: Loser[] = ranks
    .slice(1)
    .filter((rank) => rank.missing === 0 && rank.reason === undefined)
    .map((rank) => ({ form: rank.form, error: rank.error }));
  const method =
    `separable least squares: ${Object.keys(models).length} forms ranked by the rmse of the held-out residuals of ${groupCount} groups, ` +
    `${boot.replicates.length} fits in ${boot.runs} bootstrap runs of ${bootstrapCount} whole groups (seed ${boot.seed})`;
  return ok({
    form: formOf(winner, binding),
    constants,
    replicates: boot.replicates,
    fit: { method, residual, residuals: held.residuals, losers },
    ranks,
  });
};
