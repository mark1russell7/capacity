# @mark1russell7/capacity

This package has the performance and capacity models. A law gives one measure of a subject as a function of its load variables, with an interval.

**State: CAP-1 of the [roadmap](../../docs/ROADMAP.md).** The catalog of forms, the composition of laws, the knee and the scale rule come next. The package stays private until its first npm release (CAP-8).

## Entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/capacity` | The law record, its check and its value at a load point. A browser can import it. |
| `@mark1russell7/capacity/schema` | The schema of a law file and the function `readLaw`. This entry needs `zod`. |

The package holds the models and the rules. It measures nothing, and it reads no file.

## A law

A law is plain data, thus a law file is JSON. Its format is `capacity-law/1`.

| Field | What it is |
| --- | --- |
| `id` | The id of the law, for example `node-http/reply/cpu`. |
| `title` | One line that tells a person what the law gives. |
| `subject` | The id of the server that the runs measured. |
| `measure` | The quantity that the law gives: an id and a unit, for example `cpu` in `ms/{request}`. |
| `variables` | The load variables. Each has an id, a unit, a range and a scale (`linear` or `log`). |
| `conditions` | Each fact that stays constant in the measurement: the Node version, the CPU model, the limits of the container. |
| `form` | The math of the law: an id and a Vex program. |
| `constants` | The fitted numbers that the program reads, each with an id and a value. |
| `replicates` | More fits of the constants, from resamples of the points. Each row has one number for each constant. |
| `fit` | The method, the residuals of the law, and each form that lost with its error. |
| `evidence` | The CI runs that measured the points: an address, a commit and a time for each. |

A law holds for the ranges of its variables and for its conditions. A value outside a range is an extrapolation, and the answer says so.

The units are canonical units of `@mark1russell7/quantity`. A request rate is in `{request}/s`. A cost of one request has a unit with `{request}` below the line, for example `ms/{request}` or `B/{request}`.

### The form is a program

The form of a law is a Vex program, not code of this package. The program reads each variable and each constant by its id. This program is a hinge, where the cost goes up faster after a knee:

```ts
import { app, lit, ref } from "@mark1russell7/vex";

// c0 + c1 * rate + c2 * max(0, rate - knee)
const hinge = app(
  "add",
  app("add", ref("c0"), app("multiply", ref("c1"), ref("rate"))),
  app("multiply", ref("c2"), app("max", lit(0), app("subtract", ref("rate"), ref("knee")))),
);
```

A new form needs no change of this package. The tools of Vex examine and explain a program.

### The doubt is in the replicates

A law does not keep an interval for each constant. It keeps the replicates: each row is a fit of all the constants to one resample of the points. Thus the rows keep how the constants move together.

Each query evaluates the program with each row and reads its interval from the values. Thus an interval is correct for each query, also for a query that joins laws.

### The residuals are out of sample

Each residual of `fit.residuals` compares one measured point with a fit that did not use that point. An absolute residual is the difference. A relative residual is the ratio less 1.

## The value of a law

```ts
import { lawValue } from "@mark1russell7/capacity";
import { readLaw } from "@mark1russell7/capacity/schema";

const law = readLaw(JSON.parse(text));
if (law.tag === "ok") {
  const answer = lawValue(law.value, { rate: 3000 });
  // answer.value: { value: 0.135, unit: "ms/{request}", level: 0.95,
  //   interval: { low: 0.1339, high: 0.1359 }, run: { low: 0.1276, high: 0.1424 }, outside: [] }
}
```

| Field | What it is |
| --- | --- |
| `value` | The value of the program with the constants of the law. |
| `unit` | The unit of the measure. |
| `level` | The level of the two ranges. It is 0.95 when the query gives none. |
| `interval` | The doubt of the law: the share `level` of the values of the replicates. It always holds the value. |
| `run` | Where one measured run falls: the interval, made wider by the residuals. A gate compares a new run with this range. |
| `outside` | The variables whose value is outside its range. With a name in this list, the value is an extrapolation. |

`lawValue` gives a problem, not a value, in three cases:

- The point does not give each variable, or it gives a name that is not a variable.
- The law has too few replicates or residuals for the level. `leastCount(level)` gives the least count: 40 for the level 0.95.
- The program has no finite value at the point.

`constantIntervals(law)` gives each constant with the interval of its replicates.

## The check of a law

`checkLaw(law)` gives each problem of a law, with a code and the path of the field. `readLaw(data)` examines the shape of the data first, then it uses `checkLaw`.

- Each id is lower-case words. Each unit is a canonical unit.
- Each range goes from a finite number to a larger finite number. A range on the scale `log` starts above 0.
- The program reads each variable and each constant, and no other name.
- The law has a finite value at each corner and at the middle of its ranges.
- The law has 40 replicates and 40 residuals or more. Each replicate has one finite number for each constant.
- Each constant is in the range of its replicates.
- Each form that lost has an error, and the form of the law is not in that list.
- The evidence names one run or more, each with an `https` address, a full commit and a UTC time.

A law has 8 variables at most.

## The homes of the parts

| Part | Home |
| --- | --- |
| Units and amounts | `@mark1russell7/quantity` |
| Quantiles | `@mark1russell7/rigor-statistics` |
| Programs and their evaluation | `@mark1russell7/vex` and `@mark1russell7/vex-domains` |
| A value or an error | `@mark1russell7/optional` |
