# @mark1russell7/capacity

This package has the performance and capacity models. A law gives one measure of a subject as a function of its load variables, with an interval. A workload gives the load. An instance type gives the resources of one instance, and a limit set gives the ceilings.

**State: the [roadmap](../../docs/ROADMAP.md) tells the state of each item.** The package stays private until its first npm release (CAP-8).

## Entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/capacity` | The records of a law, a workload, a composition, an instance type, a limit set and the contract of an app, with their checks. It also has the value of a law and of a composition, the catalog of forms, the fit of a law, the algebra of demands and the use of a limit. A browser can import it. |
| `@mark1russell7/capacity/schema` | The schema of each file, with `readLaw`, `readWorkload`, `readComposition`, `readInstance`, `readLimits` and `readApp`. This entry needs `zod`. |

The package holds the models and the rules. It measures nothing, and it reads no file.

## A law

A law is plain data, thus a law file is JSON. Its format is `capacity-law/1`.

| Field | What it is |
| --- | --- |
| `id` | The id of the law, for example `node-http/reply/cpu`. |
| `title` | One line that tells a person what the law gives. |
| `subject` | The id of the server that the runs measured. |
| `measure` | The quantity that the law gives: an id and a unit, for example `cpu` in `{core}·ms/{request}`. |
| `variables` | The load variables. Each has an id, a unit, a range and a scale (`linear` or `log`). |
| `conditions` | Each fact that stays constant in the measurement: the Node version, the CPU model, the limits of the container. |
| `form` | The math of the law: an id and a Vex program. |
| `constants` | The fitted numbers that the program reads, each with an id and a value. |
| `replicates` | More fits of the constants, from resamples of the points. Each row has one number for each constant. |
| `fit` | The method, the residuals of the law, and each form that lost with its error. |
| `points` | Optional. Each point that the fit used, in the order of the residuals: its load, its value, the index of its run in `evidence.runs` and the start time of its job. |
| `evidence` | The CI runs that measured the points: an address, a commit and a time for each. |
| `noise` | The noise floor of the measure on one CPU model, the CPU model, and the CI runs that measured the floor. |

A law holds for the ranges of its variables and for its conditions. A value outside a range is an extrapolation, and the answer says so.

Each measure of a law is a cost. Past the range of a variable, no run measured the cost. Thus a value past a range holds: it is not lower than the value at the nearest edge of the ranges. A cost that falls with the load stays flat past the edge, and a cost that rises keeps its law. The rule applies to each replicate. Thus a law that falls past its measures cannot give a cost below 0, or an instance that does not fill at any load.

The units are canonical units of `@mark1russell7/quantity`. A request rate is in `{request}/s`. A cost of one request has a unit with `{request}` below the line, for example `{core}·ms/{request}` or `B/{request}`.

### CPU time is in core-seconds

A CPU cost of one request is in `{core}·ms/{request}`. A request rate times that cost is in `{core}·ms/s`, and that unit converts to `{core}`.

Thus the CPU use of a load compares with the CPU of an instance, and no special rule is necessary. The unit `ms/s` counts nothing in particular, thus it does not convert to `{core}`.

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
  // answer.value: { value: 0.135, unit: "{core}·ms/{request}", level: 0.95,
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

## The knee of a law

The knee is the first load where the cost of a request starts to grow fast. The edge is the first load where the law has no finite value, for example the capacity of a queue.

```ts
import { lawKnee } from "@mark1russell7/capacity";

const knee = lawKnee(law, "rate", { kind: "slope", factor: 2 });
// knee.value.knee: { value: 2500, interval: { low: 2453, high: 2548 }, outside: false }
// knee.value.edge: { value: null, interval: { low: null, high: null }, outside: false }
```

A rule tells when the cost grows fast. The law obeys the rule at the knee, and not before it.

| Rule | The knee |
| --- | --- |
| `{ kind: "rise", share }` | The first load where the value is `1 + share` times the value at the start of the search. |
| `{ kind: "slope", factor }` | The first load where the slope is `factor` times the slope at the start of the search. |
| `{ kind: "floor", share }` | The first load after the floor where the value is `1 + share` times the floor. The floor of a row is its least value on the grid, before its edge. |

The rule `floor` is for a law that falls before it grows, for example a latency with a cold start at a low rate. The knee has the field `floor`: the `load` and the `value` of the floor of the constants.

- **Each row has its own floor.** Thus the knee of a replicate is always after its floor, and the interval holds the uncertainty of the floor.
- **A replicate with no floor above 0** has no knee. The field `noFloor` counts these replicates, and the interval leaves them out.
- **Too many replicates with no floor** give a problem. The interval can leave out the replicates of one tail of the level, for example 25 of 1000 at the level 0.95.

The search goes along the range of the variable. The options `from` and `to` change it, and the point `at` gives each other variable. The search tests a grid of `KNEE_STEPS` steps on the scale of the variable, then a bisection finds each crossing. The option `steps` changes the count.

| Field | What it is |
| --- | --- |
| `knee`, `edge` | A crossing: its `value`, its `interval` from the replicates, and `outside`, true when the value is outside the range of the variable. |
| `value` | The load of the crossing. It is `null` when the search finds no crossing. |
| `interval` | The share `level` of the crossings of the replicates. An end past the end of the search is `null`. |
| `search` | The loads where the search starts and stops. |
| `outside` | The other variables whose value at the point is outside its range. |

`lawKnee` gives a problem, not a knee, in these cases:

- The variable is not a variable of the law, or the point does not give each other variable.
- The search range, the rule or the count of steps is not correct. A share is more than 0, and a factor is more than 1.
- The law has too few replicates for the level.
- The constants or a replicate give no value at the start of the search. The path names the row.
- The rule cannot apply at the start: a rise needs a value more than 0, and a slope needs a slope more than 0. A floor must be more than 0.

`kneeRuleProblem(rule, path)` examines a rule from data, for example from a plan file. It gives the problem of the rule, or `undefined`.

The search finds a pole where the value grows as a power or as a logarithm, also between two floats. At a pole, each step nearer adds as much size as the step before. Near a finite peak, each step nearer adds much less.

Two edges in one step of the grid can hide the first edge. Increase `steps` for a law with poles near each other. A finite peak narrower than 1e-9 of a step can look like a pole.

## The reach of a law

The reach is the inverse query of one law. It gives the largest load that one amount holds, for example the largest age of a log that fits in a limit of memory.

```ts
import { quantity } from "@mark1russell7/quantity";
import { lawReach, limitAmount } from "@mark1russell7/capacity";

// The start memory: 200 MB, 40 MB for each day of the log, and 50 kB for each live report.
const reach = lawReach(law, "days", quantity(0.9, "GiB"), { at: { reports: 2000 } });
// reach.value.crossing: { value: 16.66, interval: { low: 15.2, high: 18.35 }, outside: false }

// The amount of a limit on an instance is the ceiling less the headroom.
const amount = limitAmount(limits.memory, instance);
if (amount.tag === "ok") lawReach(law, "days", amount.value, { at: { reports: 2000 } });
```

`lawReach(law, variable, amount, options)` gives the first load where the law is more than the amount. Before that load, the law holds the amount. Thus for a law that grows along the variable, the crossing is the largest load that holds the amount.

- The amount is a quantity. The function converts it to the unit of the measure of the law. The field `amount` of the result is that value.
- When the law is more than the amount at the start of the search, the crossing is the start.
- When the law holds the amount on all of the search, the crossing is `null`.
- A pole is more than each amount, thus the crossing is before the pole.

The options, the search and the fields `edge`, `search` and `outside` are as in a knee. The field `crossing` replaces the field `knee`.

`lawReach` gives each problem of `lawKnee` that is not about a rule. It also gives a problem for an amount that is not finite, or that does not convert to the unit of the measure.

## The check of a law

`checkLaw(law)` gives each problem of a law, with a code and the path of the field. `readLaw(data)` examines the shape of the data first, then it uses `checkLaw`.

- Each id is lower-case words. Each unit is a canonical unit.
- Each range goes from a finite number to a larger finite number. A range on the scale `log` starts above 0.
- The program reads each variable and each constant, and no other name.
- The law has a finite value at each corner and at the middle of its ranges.
- The law has 40 replicates and 40 residuals or more. Each replicate has one finite number for each constant.
- Each constant is in the range of its replicates.
- The replicates of each constant have a width. A column of one value gives the code `flat`. A shape at the edge of its search in each fit gives this.
- Each form that lost has an error, and the form of the law is not in that list.
- The evidence names one run or more, each with an `https` address, a full commit and a UTC time.
- A law with points has one point for each residual. Each point gives a finite value of each variable in its range, a finite value and the index of a run of the evidence.
- The noise has a floor of 0 or more and a CPU model. It names its runs as the evidence does.

The noise floor is two standard deviations of the differences of A/A pairs: two equal cases, each in its own container. A difference of two measurements below the floor is not a result. The plan `floor` of the lab measures it each night, on the CPU model of the runner.

A law has 8 variables at most.

## The catalog of forms

`FORMS` has the forms of a law of one variable, as data. Each form is a sum of terms. A term is a constant times a basis, and the basis is a Vex program. A shape constant changes the shape of a form, not its size.

| Form | Value | Shape constants |
| --- | --- | --- |
| `constant` | `base` | |
| `linear` | `base + slope·x` | |
| `power` | `base + scale·x^exponent` | `exponent` |
| `fall-power` | `base + excess / x + scale·x^exponent` | `exponent` |
| `logarithm` | `base + scale·ln(x)` | |
| `hinge` | `base + slope·x + bend·max(0, x − knee)` | `knee` |
| `queue` | `base + scale·capacity / (capacity − x)` | `capacity` |
| `scalability` | `unit·x / (1 + contention·(x − 1) + coherency·x·(x − 1))` | `contention`, `coherency` |
| `drift` | `base + drift·x + warm·(1 − e^(−x / settle))` | `settle` |

The `fall-power` form has a cost at a low load that falls as the load grows, and then a power of the load. The `queue` form is the delay of a queue, and it has no finite value at its capacity. The `scalability` form is the universal scalability law of the throughput at a concurrency. The `drift` form is a measure over the age of a process: a warm-up that settles, and a steady drift.

Each shape constant has a grid of start values and bounds. A fit refines the constant inside its bounds:

- The `knee` is inside the range of the variable.
- The `capacity` is past the largest load.
- The `contention`, the `coherency` and the `settle` time are 0 or more.
- The `exponent` has no bounds.

```ts
import { catalogForm, formOf, slopeOf, startOf } from "@mark1russell7/capacity";

const hinge = catalogForm("hinge");
if (hinge !== undefined) {
  // the program of a law: it reads the variable rate and the constants c0, c1, c2 and knee
  const form = formOf(hinge, { variable: "rate", constants: { base: "c0", slope: "c1", bend: "c2" } });
  const slope = slopeOf(hinge, { variable: "rate" });
  const start = startOf(hinge, { x: rates, y: costs });
  // start.value: { constants: [{ id: "base", value: … }, …, { id: "knee", value: … }], rss: … }
}
```

- `formOf` and `programOf` give the program of the value. `slopeOf` gives the program of the slope: the change of the value for each unit of the variable. A test compares each slope with a central difference of the value.
- `formValues` and `formSlopes` evaluate the two programs at some values of the variable.
- `startOf` gives the least-squares fit of one form. It is `fitSeparable` of `@mark1russell7/rigor-statistics`. At each value on the grid of each shape constant, least squares fits the constants of the terms. Then a golden-section search refines each shape constant inside its bounds.
- `separableOf` gives a form as a separable model of `@mark1russell7/rigor-statistics`. Its design has one column for each term.

A form that holds another form as a special case fits at least as well. For example, a hinge with `bend` 0 is a line. Thus the sum of the squared residuals of a hinge start is not larger than that of the line. The refine does not increase the sum. A property test holds this order for six pairs of forms.

## The fit of a law

`fitLaw` fits a law of one variable to its points. It gives the form, the constants, the replicates and the record of the fit of a law.

```ts
import { fitLaw } from "@mark1russell7/capacity";

const result = fitLaw({ x: rates, y: costs }, { binding: { variable: "rate" }, residual: "relative" });
if (result.tag === "ok") {
  const { form, constants, replicates, fit, ranks } = result.value;
  // ranks: each form that competed, best first, with the error of its held-out residuals
}
```

- **The rank:** each form of the catalog competes. The form with the smallest root mean square of its held-out residuals wins.
- **The groups:** by default, the points of one load are one group. The held-out fit holds out each group, and the bootstrap draws whole groups. The option `groups` gives other groups.
- **The groups of the bootstrap:** the option `bootstrapGroups` gives the groups that the bootstrap draws. The default is the list `groups`. A plan that fixes its loads has no random load. Thus its bootstrap draws the independent units of its data, for example whole jobs.
- **The least count of groups:** a run draws as many groups as the data has, and a fit does not see their order. Thus `g` groups give `bootstrapDraws(g)` different draws: 35 for 4 groups. The interval of the level 0.95 needs 40 values, thus `leastGroups(0.95)` is 5. With fewer groups of the bootstrap, the fit gives an error.
- **The replicates:** each run of the bootstrap fits the winner to a resample of the groups of the bootstrap. The default is 1000 runs. A law needs 40 replicates for the level 0.95.
- **The losers:** the record keeps each other form with a held-out prediction at each point. The list `ranks` also keeps each form with no fit, with its reason.
- **A relative fit:** with `residual: "relative"`, the fit uses the weights `1 / y^2`. Thus it fits the ratios, not the differences.
- **The interval of a knee:** `constantIntervals` gives the interval of each constant from the replicates. For a hinge, this is the interval of its knee.

A test fits a hinge with its knee between two loads. The interval of the knee holds the true knee, and `checkLaw` finds no problem in the law.

## The law files

The folder `laws` holds the law files that the lab gives, one file for each law: `laws/<subject>/<plan>/<cpu>/<measure>.law.json`. The workflow `laws.yml` gives the files from the records of named Lab runs. The README of the lab tells the command and the workflow.

```sh
gh workflow run laws.yml -R metrograph-labs/capacity -f runs='<run of the plan rate> <run of the plan floor>'
gh run download <laws run> -R metrograph-labs/capacity -n laws-<laws run> -D packages/capacity/laws
```

A pull request puts the files into the folder. A test reads each file with `readLaw`. The id of each law is its path, and each run of its evidence and its noise is a run of CI. A folder with no law file fails the test.

Each file that the workflow gives keeps the points of its fit in the field `points`. The site draws them on the curve of the law. The files of this folder come from fits before the field, thus they have no points yet. The next fit of `laws.yml` gives them.

### The laws of the request rate

The Laws run 44987398580 gives the laws of the plan `rate` on the Intel Xeon 6975P-C. Their points are the 200 cases of the 8 jobs of the Lab runs 44964347304 and 44977025221 on that CPU model. The floor jobs of the Lab run 44467543161 give the noise. Each law has 1000 replicates, and the bootstrap draws whole jobs. Each interval holds 0.95 of the replicates.

| Measure | Form | Knee, or a constant of the form | Range, requests each second | Held-out error |
| --- | --- | --- | --- | --- |
| `cpu.request` | power | exponent −0.481 [−0.490, −0.471] | 100 to 36000 | 0.104 |
| `memory` | hinge | constant `knee` 13840 [11200, 16880] | 100 to 36000 | 0.012 |
| `memory.high` | hinge | constant `knee` 14940 [11000, 17890] | 100 to 36000 | 0.012 |
| `latency.p50` | no law | | | |
| `latency.p90` | fall-power | knee 3289 [3076, 3507] | 100 to 33000 | 0.497 |
| `latency.p99` | hinge | knee 6840 [5750, 8524] | 1000 to 33000 | 0.445 |

- **The held-out error** is the root mean square of the relative held-out residuals.
- **The CPU time of each request** falls as the rate increases.
- **The memory** increases by approximately 80 B for each request each second, up to the constant `knee` of the hinge. After it, the memory stays approximately flat.
- **The range of the latency laws.** A latency law keeps the points where the subject served 0.97 of the offered rate or more. Thus its range ends at 33000. The tail count cuts the rates 100 and 300 from the law of the 99th percentile.
- **The knee of a latency** is the first rate after its floor where the latency is more than two times that floor (the rule `floor` of the plan, with the share 1). The 90th percentile has its knee at 3289, and the 99th percentile at 6840.
- **The median has no law.** In each replicate, the exponent of its best form is at the end of its search, and `checkLaw` refuses the flat column. The plan marks this problem as known until CAP-57. The file of CAP-17 is removed. Its fit kept the points past the limit of the core, and it has no served share.
- **The Intel Xeon Platinum 8573C and the AMD EPYC 9V45 have no law.** Each had one job of 25 points. The bootstrap draws whole jobs, thus a law needs 5 jobs (CAP-58).

A test of the lab reads these files with the plan `rate`. Each measure of the plan has a law on each CPU model of the folder, except a measure with a known mark. Each law has the served share and the tail count of its measure. Each law also has a finite value at each end of its range and a held-out error below 1. Each knee and its interval are in the range.

### The laws of the overhead

The Laws run 45069050798 gives the laws of the plan `overhead` on the Intel Xeon 6975P-C. A point is the value of the service subject less the value of the bare subject, in one pair of one job. The points come from the 9 jobs on that CPU model of the Lab runs 45061643369, 45063129123 and 45066776472. These runs have one commit of the subjects. The floor jobs of the Lab run 44467543161 give the noise.

| Measure | Form | At 100 requests each second | At 8000 requests each second | Held-out error |
| --- | --- | --- | --- | --- |
| `cpu.request.overhead` | logarithm | 0.232 [0.215, 0.248] {core}·ms | 0.064 [0.060, 0.069] {core}·ms | 0.019 {core}·ms |
| `memory.overhead` | power | 1.25 [1.14, 1.36] MB | 9.94 [9.68, 10.3] MB | 1.39 MB |
| `memory.high.overhead` | fall-power | 1.12 [0.79, 1.49] MB | 9.97 [9.64, 10.4] MB | 2.13 MB |
| `latency.p50.overhead` | no law | | | |
| `latency.p90.overhead` | queue | −0.039 [−0.202, 0.134] ms | 10.4 [9.39, 11.5] ms | 1.81 ms |
| `latency.p99.overhead` | logarithm | 1.04 [0.56, 1.47] ms at 1000 | 13.7 [12.8, 14.4] ms | 3.52 ms |

- **The held-out error** is the root mean square of the absolute held-out residuals. A difference can be 0 or less, thus a relative residual has no meaning.
- **The CPU time of the runner** is 0.232 {core}·ms for each request at 100 requests each second, and 0.064 at 8000. At 8000, the bare subject uses 0.035.
- **The memory of the runner** is approximately 1.2 MB at 100 requests each second, and approximately 10 MB from 1000 requests each second.
- **The latency of the runner** has no interval that holds 0, except the 90th percentile at 100 requests each second.
- **The median has no law.** In each replicate, the exponent of its best form is at the end of its search, as in the plan `rate`. The plan marks this problem as known until CAP-57.
- **The 99th percentile starts at 1000 requests each second.** The tail count cuts the pairs at 100 and 500 requests each second. Thus its law has 53 points.
- **The AMD EPYC 7763, 9V45 and 9V74 and the Intel Xeon Platinum 8370C have no law.** Their jobs gave 24, 16, 16 and 8 points.

A test of the lab reads these files with the plan `overhead`. Each law names the subject of its base side, and its residual is absolute. Its held-out error is less than its largest value at an end of its range.

### The laws of the events of alerts

The Laws run 45382785749 gives the laws of the plan `alerts-start-event` on the Intel Xeon 6975P-C (CAP-36). Their folder is `laws/alerts-runtime/alerts-start-event/xeon-6975p-c/main/first`: the arm `main` at the first start. The variable of each law is `event`, the events each second from 0 to 30. The README of the lab has the table of the laws, in [The load ladder of events](../lab/README.md#the-load-ladder-of-events).

## The gate of the laws

The gate tells if new measured values stay in the run ranges of their laws. A pull request that makes a subject slower or larger moves its values out of the ranges. `lawGate` gives the gate, and `lawRead` gives one read.

```ts
import { lawGate } from "@mark1russell7/capacity";

const reads = [{ point: { rate: 1000 }, value: 0.061 }];
const gate = lawGate([{ law, jobs: [{ job: "job 1", reads }, { job: "job 2", reads }] }]);
if (gate.outcome === "block") console.log(gate.reason);
```

- **A read.** A measured value at a load point falls `within`, `high` or `low` against the range `run` of `lawValue`. A point outside the range of a variable gives no read.
- **A job.** A read of a job that agrees with its law falls on one side with a chance of `(1 - level) / 2` or less. The binomial test of the count of each side gives the p of the job.
- **A side.** `partialConjunction` joins the p of the jobs for the claim "two jobs or more show this side" (`GATE_JOBS`). One job on an odd runner cannot block alone.
- **The family.** `holm` corrects the tests of the two sides of each law at the level 0.01 (`GATE_ALPHA`). A rejected side is a block.
- **A low side is a block too.** The subject is faster or smaller than its law, thus the law is out of date. A new fit must replace it.
- **No read.** The function `gateOf` of `@mark1russell7/rigor-bench` joins the laws. A law with fewer than two jobs gives no read. So does a law with too few reads to reject a side. A gate with no law gives no read. It does not pass.

The caller gives the jobs of each law. Each job measured the subject in the conditions of the law. A job with `noRead` gives no read, for example a job with a noise floor over its limit. The lab gives the jobs, the noise rule and the workflow (CAP-26).

A study used the 8 jobs of the laws of the request rate on the Intel Xeon 6975P-C, at eight rates from 1000 to 30000:

- With no change, no job had more than one read out of a range on one side.
- With 0.01 ms more CPU time for each request, each job had 6 of 8 reads of `cpu.request` above the range.
- With 0.005 ms more, each job had 1 or 2 such reads. That is below a block.

These jobs are the evidence of the laws, thus the study is in sample. The Lab runs of CAP-26 test the gate on new jobs.

## A workload

A workload is the load on an app: the classes of its requests, each with a rate. It is plain data, thus a workload file is JSON. Its format is `capacity-workload/1`.

| Field | What it is |
| --- | --- |
| `id` | The id of the workload, for example `shop/peak`. |
| `title` | One line that tells a person what the workload is. |
| `classes` | The request classes. Each has an id, a rate and the variables of one request. |
| `levels` | The amounts that the whole app holds at one time, for example the open connections. |
| `source` | The origin of the workload: a plan with a note, or the metrics of an app with a window. |

```json
{
  "format": "capacity-workload/1",
  "id": "shop/peak",
  "title": "The peak hour of a shop",
  "classes": [
    {
      "id": "read",
      "rate": { "value": 900, "unit": "{request}/s" },
      "request": { "reply": { "value": 2, "unit": "KiB" }, "wait": { "value": 5, "unit": "ms" } }
    },
    {
      "id": "write",
      "rate": { "value": 6000, "unit": "{request}/min" },
      "request": { "body": { "value": 4, "unit": "KiB" }, "wait": { "value": 20, "unit": "ms" } }
    }
  ],
  "levels": { "connections": { "value": 400, "unit": "{connection}" } },
  "source": { "kind": "plan", "note": "The forecast of the last week of November." }
}
```

Each amount is an amount of `@mark1russell7/quantity`: a value and a canonical unit. The name of a variable or a level is the id of a law variable, thus a law reads it.

### A class is one point

A class has one value for each variable of its request. Requests of two sizes are two classes.

A law can bend, thus a law at the mean size does not give the mean cost. Give a spread of sizes as more classes, not as one class with a mean.

### What a workload does not have

- A workload does not have the state of an instance, for example the size of its heap or its age. A query gives that state.
- A workload does not have the count of the requests in flight. That count is a rate times a duration, and a law gives the duration.
- A workload does not tell how a level divides between instances. That is a property of the app.
- A workload is not a load schedule. A load schedule of `@mark1russell7/rigor-chaos` is the plan of the arrivals of one measured run.

## The algebra of demands

A demand is the classes and the levels of a workload, with no name and no source. Each operation takes a demand and gives a demand, or a problem. A workload is a demand, thus each operation takes a workload.

| Function | What it gives |
| --- | --- |
| `scaleDemand(demand, by)` | A demand that is `by` times as large: each rate and each level, times `by`. |
| `mergeDemands(first, second)` | The sum of two demands. The rates of one class add, and the levels add. |
| `shareOf(demand, instances, options)` | The demand on one of `instances` equal instances. A level in `options.whole` does not divide. |
| `totalRate(demand, unit)` | The sum of the rates of the classes, in `unit`. |
| `loadPointOf(demand, id, law, given, options)` | The load point of one class for a law. With `options.load` set to `"total"`, the variable `rate` is the total rate. |
| `instancePointOf(demand, law, given)` | The load point of the instance for a law: the total rate and the levels, with no request. |

No operation changes the variables of a request: more clients do not make a request larger.

The sum has the laws of addition:

- The order and the groups of the demands do not change the sum. They can change the unit of an amount, and not the amount.
- The demand `NO_DEMAND`, with no class and no level, is the zero of the sum.
- A scale of a sum is the sum of the scales of its parts.

Property tests hold each of these laws on generated demands, with rates and levels in different units.

Two demands add only when they agree. A class of the two demands has an equal request in each. Rates that count different things do not add, for example `{request}/s` and `{event}/s`.

### From a demand to the value of a law

This example uses a law with the variables `rate`, `body` and `heap`.

```ts
import { lawValue, loadPointOf, shareOf } from "@mark1russell7/capacity";

// The demand on one of four instances, then the cost of one request of the class `write` there.
const share = shareOf(workload, 4);
if (share.tag === "ok") {
  const point = loadPointOf(share.value, "write", law, { heap: { value: 512, unit: "MiB" } });
  // point.value: { rate: 25, body: 4096, heap: 512 }
  if (point.tag === "ok") lawValue(law, point.value);
}
```

`loadPointOf` finds one amount for each variable of the law, and converts it to the unit of the variable:

- The variable `rate` is the rate of the class.
- Each other variable is a variable of the request of the class, a level of the demand, or an amount of `given`.
- The amounts of `given` are the state of an instance, for example the size of its heap.

It gives a problem for a variable with no amount, and for a variable with two amounts.

### A workload from live metrics

`observedWorkload(observation, name)` gives the workload of a window of metrics. An observation has the count of the requests of each class in the window.

```ts
import { observedWorkload } from "@mark1russell7/capacity";

const workload = observedWorkload(
  {
    origin: "https://metrics.example/shop",
    from: "2026-11-18T14:00:00Z",
    to: "2026-11-18T14:05:00Z",
    classes: [{ id: "read", count: { value: 270000, unit: "{request}" }, request: {} }],
    levels: {},
  },
  { id: "shop/observed", title: "The shop from 14:00 to 14:05" },
);
// workload.value.classes[0].rate: { value: 900, unit: "{request}/s" }
```

The rate of a class is its count, divided by the seconds of the window. Thus it is the mean rate of the window. For the load at a peak, give the window of the peak.

## The check of a workload

`checkWorkload(workload)` gives each problem of a workload, with a code and the path of the field. `readWorkload(data)` examines the shape of the data first, then it uses `checkWorkload`.

- Each id is lower-case words. Two classes do not have one id.
- A rate is a count in a unit of time, and it is 0 or more.
- Each amount is a finite value in a canonical unit.
- A variable has units of one kind in each class.
- A name is not a level and a variable. The name `rate` is only the rate of a class.
- A plan has a note. The window of a metrics source goes from a UTC time to a later UTC time.

A workload with no class is correct: an app can have no request.

## The contract of an app

The contract of an app is one record that each app gives to the lab and to the models. The bare subjects of the lab give the same record. The file `capacity-app.json` (`APP_FILE`) at the root of the repository of an app holds its contract, in the format `capacity-app/1`. A repository with more than one subject keeps each contract next to its subject.

| Part | What it tells |
| --- | --- |
| `variables` | Each load variable: its kind, its unit and its range. A `request` variable comes with each request, a `level` stays in the app, and a `store` is in the store at the start. The run gives a `run` variable in its line `amounts`, and no workload sets it. |
| `classes` | Each kind of request: the range of its rate, its request variables and its entry. The entry is a request of HTTP with a path template, or an outside service. |
| `start` | The commands `install`, `check` and `seed`, and the process `run` with its ready signal and its lines. A command is a program and its arguments, with no shell. |
| `services` | Each outside service that the app calls, and the fake that the lab starts in its place. |
| `metrics` | Each live series of the app: a counter or a gauge, its unit and what it measures. |

The lab puts a value into each placeholder of a command before the start: `{port}`, `{store}`, `{workload}`, `{service.<id>}` and `{variable.<id>}`. `fillPlaceholders(text, values)` does this, and `requestPath(entry, amounts)` gives the path of a request of HTTP.

### The lines of a run

The field `lines` of `start.run` names the JSON lines of the output of the run that the lab records. Each line has a `kind`, an `ev` and a `title`. The lab keeps each line of the output that is a JSON object with that `ev`.

| Kind | What the lab reads |
| --- | --- |
| `pass` | The end of one pass of the loop of the app. The lab counts the passes in the watch after ready. |
| `write` | One write of the snapshot. The fields `longestMs`, `writeMs`, `rowsMs`, `wallMs` and `cpuMs` give its times in milliseconds. |
| `readings` | One collection of the live metrics. The field `readings` is a list of `SeriesReading`: `{ series, at, value }`. `collectReadings` of `@mark1russell7/otel-ts/pull` gives this list. |
| `amounts` | The amounts of the run variables. The field `amounts` gives each run variable by its id, in its unit. The lab keeps the last line of the watch. |

`APP_LINE_KINDS` is the closed set of the kinds. A run with no line of a kind gives no reading of that kind.

A contract with a `run` variable has a line `amounts`. Only a store or a level variable goes into the seed as `{variable.<id>}`.

```json
"lines": [{ "kind": "pass", "ev": "lab-pass", "title": "The end of a pass of the loop" }]
```

### The check of a contract

`checkApp(app)` gives each problem of a contract, with a code and the path of the field. `readApp(data)` examines the shape of the data first, then it uses `checkApp`.

- Each id is unique in its list. The name `rate` is only the rate of a class.
- Each unit is a canonical unit. Each range goes from a finite amount to the same or a larger amount. A range on the scale `log` starts above 0.
- The rate of a class is a count in a unit of time.
- A request of HTTP sets each request variable of its class, in its path or in its body. The body is in bytes.
- Each command has a program and a folder in the repository. It holds only the placeholders of its place.
- The run gets its port, the store and the URL of each service. The seed gets the store and sets each store variable. Each fake gets its port.
- The seed can get the amount of a store or a level variable. It writes the state of the app at the point, and the run opens it.
- Each series has the kind and the unit of what it measures. Two series do not measure the same thing.
- Each line of the run has an `ev` that is not empty. Two lines do not have the same kind or the same `ev`.

### The live metrics of an app

`metricsGaps(app)` gives each part of the demand that the live metrics of the app cannot give. A gap is the rate of a class, the total of a request variable, or a level. A contract with no gap gives its whole demand from its metrics.

`observationOf(app, window, readings)` gives the observation of a window from the readings of the series. Then `observedWorkload` gives the workload of the window.

```ts
import { observationOf, observedWorkload } from "@mark1russell7/capacity";
import { readApp } from "@mark1russell7/capacity/schema";

const app = readApp(contractData); // the data of capacity-app.json
if (app.tag === "ok") {
  const window = { origin: "https://metrics.example/shop", from: "2026-11-22T14:00:00Z", to: "2026-11-22T14:01:00Z" };
  const observation = observationOf(app.value, window, [
    { series: "shop_read_total", at: "2026-11-22T14:00:00Z", value: 0 },
    { series: "shop_read_total", at: "2026-11-22T14:01:00Z", value: 54000 },
    // and the readings of the other series of the contract
  ]);
  // observation.value.classes[0].count: { value: 54000, unit: "{request}" }
  // observedWorkload(observation.value, name).value.classes[0].rate: { value: 900, unit: "{request}/s" }
}
```

- The count of a class is the increase of its counter (`counterIncrease`). A value below the value before it is a new start of the process, thus the increase adds the whole value.
- The mean of a request variable is the increase of its total, divided by the count of its class.
- A level is the mean of the readings of its gauge, with the same weight for each reading. Item CAP-63 adds a weight for the time of each reading.

### A workload against its app

`appWorkloadProblems(app, workload)` examines a workload against the contract of its app. Each class of the workload is a class of the app: the class that its field `of` names, or else its id. Thus a workload can have two classes of one class of the app, for example small reads and large reads.

The rates, the amounts and the levels of the workload are in the ranges of the app. Each class of the workload gives each request variable of its class of the app.

## The composition of laws

A composition gives one measure of a subject as a sum of laws over a demand. Layer 1 is the CPU of a bare Node server. Layer 2 is layer 1 plus the cost of the service runner.

```json
{
  "format": "capacity-composition/1",
  "id": "runner/cpu",
  "title": "The CPU of a server on the service runner",
  "subject": "runner",
  "measure": { "id": "cpu", "unit": "{core}" },
  "terms": [
    { "composition": "node-http/cpu" },
    { "law": "runner/reply/cpu", "over": "each" }
  ]
}
```

Each term gives parts, and the value is the sum of the parts.

| Term | Its parts |
| --- | --- |
| `{ "law": id, "over": "each" }` | One part for each class of the demand, at the load point of the class |
| `{ "law": id, "over": ["read", "write"] }` | One part for each class in the list |
| `{ "law": id, "over": "instance" }` | One part at the load point of the instance, for example the memory of the process |
| `{ "composition": id }` | The value of the composition `id` over the same demand |

Each term can have a `factor`, a finite number other than 0. A law term over classes can have `"load": "total"`. Then the variable `rate` of the law is the total rate, not the rate of the class. Use it when the cost of one request changes with the load of the whole process. The garbage collection is an example.

### The units tell the weight of a part

The weight of a part is the number that multiplies the value of its law. The quotient of the unit of the composition and the unit of the law decides it.

- A quotient with no dimension needs no rate. A law in `MiB` gives `GiB` times `1/1024`.
- A quotient that is a rate needs the rate of the part. A law in `{core}·ms/{request}` gives `{core}` times the rate of its class in `{request}/ms`.
- A different quotient is a problem. CPU time does not give memory, and a rate of `{event}/s` does not give a count of requests.

The unit of a composition is canonical. It is not a level, for example `dB`, and not an absolute temperature, because the values of these units do not add.

### Each interval goes through the sum

```ts
import { compositionValue } from "@mark1russell7/capacity";

const cpu = compositionValue(layer2, { laws, compositions: [layer1] }, workload, { level: 0.95 });
// cpu.value.value: the CPU of the instance, in {core}
// cpu.value.parts: the part of each term and each class, with its weight
```

- Replicate `i` of the composition is the sum of row `i` of each law, each times its weight. Thus the interval is the share `level` of these sums. The count of rows is the least count of the laws that the composition reads.
- The range `run` is the interval plus the change from the interval to the run of each part. This sum is exact when the noise of the parts moves together. For independent noise it is wider than the true range, thus it is on the safe side for a limit.
- A factor less than 0 changes the ends of each range of its part.
- The value is an extrapolation, with `extrapolated` true, when a part reads a variable outside the range of its law.

Row `i` of each law is one draw of the doubt of that law. Laws from separate fits have independent rows.

The sum has the laws of a linear map, and property tests hold each of them:

- A factor on each term scales the value, the interval, the run and the replicates. A factor less than 0 turns each range.
- The order of the terms does not change the value.
- A nested composition gives the value of its terms in line, times its factor.
- A composition of constant costs scales with the demand, and the sum of two demands gives the sum of the values.

### The check of a composition

`checkComposition(composition)` gives each problem of a composition, with a code and the path of the field. `readComposition(data)` examines the shape of the data first.

- Each id is lower-case words, and the title is not empty.
- A composition has one term or more. A list of classes is not empty, and it has each class one time.
- A term over the instance does not read the rate of a class.
- A composition does not name itself.

`compositionValue` also finds these problems:

- A missing law or composition, and a cycle of compositions.
- Two records with one id.
- A law with too few replicates for the level. Each problem of a part has the path of its term in front, for example `terms[0].write.rate`.

### The compositions of the service runner

The folder `compositions` holds the composition files: `compositions/<subject>/<cpu>/<measure>.composition.json`. Each term names a law file of the folder `laws`.

| Composition | Its terms |
| --- | --- |
| `node-http/xeon-6975p-c/cpu` | The law `cpu.request` of the plan `rate`, over each class, at the total rate |
| `node-http/xeon-6975p-c/memory` | The law `memory.high` of the plan `rate`, over the instance |
| `node-http-service/xeon-6975p-c/cpu` | The composition `node-http/xeon-6975p-c/cpu`, and the law `cpu.request.overhead`, over each class, at the total rate |
| `node-http-service/xeon-6975p-c/memory` | The composition `node-http/xeon-6975p-c/memory`, and the law `memory.high.overhead`, over the instance |

The CPU is in `{core}`, and the memory is in MiB. A demand has one class at the rate. Each interval holds 0.95 of the replicates.

| Measure | Requests each second | Layer 1 | Layer 2 | The part of the runner | Its share of layer 2 |
| --- | --- | --- | --- | --- | --- |
| CPU | 100 | 0.027 [0.026, 0.028] | 0.050 [0.048, 0.052] | 0.023 [0.022, 0.025] | 46 % |
| CPU | 1000 | 0.090 [0.089, 0.092] | 0.234 [0.228, 0.241] | 0.144 [0.138, 0.149] | 61 % |
| CPU | 2000 | 0.131 [0.129, 0.133] | 0.365 [0.360, 0.372] | 0.235 [0.229, 0.241] | 64 % |
| CPU | 4000 | 0.189 [0.187, 0.192] | 0.553 [0.545, 0.561] | 0.364 [0.356, 0.371] | 66 % |
| CPU | 8000 | 0.276 [0.274, 0.279] | 0.791 [0.757, 0.827] | 0.515 [0.481, 0.551] | 65 % |
| Memory | 100 | 30.1 [30.0, 30.1] | 31.1 [30.8, 31.5] | 1.1 [0.8, 1.4] | 3 % |
| Memory | 1000 | 30.1 [30.1, 30.2] | 40.0 [39.8, 40.3] | 9.8 [9.7, 10.2] | 25 % |
| Memory | 2000 | 30.2 [30.2, 30.2] | 40.5 [40.3, 40.8] | 10.3 [10.1, 10.7] | 25 % |
| Memory | 4000 | 30.3 [30.3, 30.4] | 40.8 [40.4, 41.2] | 10.5 [10.1, 10.8] | 26 % |
| Memory | 8000 | 30.6 [30.6, 30.7] | 40.1 [39.8, 40.6] | 9.5 [9.2, 9.9] | 24 % |

- **The runner uses more CPU than the server.** From 1000 requests each second, the part of the runner is approximately 1.5 to 2 times the CPU of the bare server.
- **The CPU laws read the total rate.** The CPU time of one request falls as the load of the process increases, thus each class reads the total rate.
- **The sum holds only over one base.** An overhead law is a difference in one job. Thus its composition adds it to the laws of its base subject, with the same conditions.
- **The range of layer 2 is 100 to 8000 requests each second**, the range of the overhead laws. The laws of layer 1 go to 36000.

A test reads each composition file with `readComposition`. The id of each composition is its path. It has a value at each end of the range of its laws, with no extrapolation. A test also holds the part of the runner above 0 at each end of the range.

### The compositions of alerts

| Composition | Its terms |
| --- | --- |
| `alerts-runtime/xeon-6975p-c/cpu` | The law `watch-cores` of the plan `alerts-start-event`, over the instance |
| `alerts-runtime/xeon-6975p-c/memory` | The law `watch-peak`, over the instance |
| `alerts-runtime/xeon-6975p-c/heap` | The law `watch-heap-peak`, over the instance |

The variable `event` of these laws is a level of the demand, in `{event}/s`. Thus a demand of alerts is `{ classes: [], levels: { event } }`, and a scale of the demand scales the events.

## An instance type

An instance type is one size of a machine or a container: the amount of each resource of one instance. It is plain data, thus an instance file is JSON. Its format is `capacity-instance/1`.

| Field | What it is |
| --- | --- |
| `id` | The id of the instance type, for example `container/small`. |
| `title` | One line that tells a person what the instance type is. |
| `resources` | The amount of each resource, by its name. Each amount is above 0. |

```json
{
  "format": "capacity-instance/1",
  "id": "container/small",
  "title": "A container with 2 cores and 4 GiB of memory",
  "resources": {
    "cpu": { "value": 2, "unit": "{core}" },
    "memory": { "value": 4, "unit": "GiB" },
    "network": { "value": 1, "unit": "Gbit/s" }
  }
}
```

Three names have one meaning in each instance. A resource with one of these names is in a unit that converts to the unit of this table:

| Resource | Unit | What it is |
| --- | --- | --- |
| `cpu` | `{core}` | The CPU time that the instance gives in a unit of time. |
| `memory` | `B` | The memory of the instance. |
| `network` | `bit/s` | The rate of the network of the instance. |

An instance can have more resources, for example `disk`. No resource is necessary by name: a limit names the resource that it reads.

An instance is the resources with no name, as a demand is the load of a workload with no name. `loadPointOf` takes the resources as `given`, for a law that has a resource as a variable.

## Limits

A limit is a ceiling on one measure, with headroom. A limit set is a list of limits with a name. It is plain data, thus a limits file is JSON. Its format is `capacity-limits/1`.

| Field | What it is |
| --- | --- |
| `id` | The id of the limit, for example `cpu`. |
| `measure` | The id of the measure that the limit holds, for example `cpu` or `latency.p99`. |
| `ceiling` | The amount that the measure does not pass: a fixed amount, or a resource of the instance. |
| `headroom` | The share of the ceiling that stays free: 0 or more, and below 1. |

```json
{
  "format": "capacity-limits/1",
  "id": "web/default",
  "title": "The limits of a web service",
  "limits": [
    { "id": "cpu", "measure": "cpu", "ceiling": { "kind": "resource", "resource": "cpu" }, "headroom": 0.3 },
    { "id": "memory", "measure": "memory", "ceiling": { "kind": "resource", "resource": "memory" }, "headroom": 0.2 },
    { "id": "sent", "measure": "network.tx", "ceiling": { "kind": "resource", "resource": "network" }, "headroom": 0.5 },
    {
      "id": "latency",
      "measure": "latency.p99",
      "ceiling": { "kind": "amount", "amount": { "value": 200, "unit": "ms" } },
      "headroom": 0.1
    }
  ]
}
```

The amount of a limit is its ceiling, times 1 less the headroom. On the instance above, the limit `cpu` has the amount 1.4 cores, and the limit `latency` has the amount 180 ms.

A ceiling that is a resource follows the instance: a larger instance gives a larger amount. A ceiling that is a fixed amount is equal on each instance.

A limit set names no instance. Thus one limit set serves each instance type.

### The limits files of the gates

The folder `limits` holds the limits files that the lab gives from CI runs. The CI gate of an app reads its file at a commit of this repository.

| File | The gate | How the lab gives it |
| --- | --- | --- |
| `limits/alerts-start-gate.limits.json` | The start of alerts: the used heap, the peak of the resident set and the time to ready, at two sizes of the log | The plan `alerts-start-gate` and the command `start-limits.main.ts`. The README of the lab tells them. |

Each point of a start limits file holds one limit set of the format `capacity-limits/1`. A test of the lab reads the file.

### The instance files

The folder `instances` holds the instance files, one instance type in each file. The id of each type is its path. A test reads each file with `readInstance`.

| Instance type | CPU | Memory | Heap | Where the amounts come from |
| --- | --- | --- | --- | --- |
| `small-cloud-1gb` | 0.25 core | 676 MB | 556 MB | A small cloud machine with 1 GB that runs alerts. Its CPU is the baseline share of a shared core. Its memory is the free memory before the start of alerts. |
| `lab-target-1gb` | 2 cores | 1011 MB | 556 MB | The target of the lab: the limits of its container and the heap limit of V8 |

The limits file `limits/alerts-scale.limits.json` holds the limits of one copy of alerts:

| Limit | Ceiling | Headroom | Why |
| --- | --- | --- | --- |
| `cpu` | The CPU of the instance | 0.3 | The baseline of a shared core is a mean. A burst of events needs more for a short time. |
| `memory` | The memory of the instance | 0.2 | The law gives the peak of a watch of 180 s. A longer run and a larger log give higher peaks. |
| `heap` | The heap limit of V8 | 0.2 | The same reason as the memory |

### What an instance type and a limit do not have

- An instance type does not have a price. No query reads a price at this time.
- A limit does not name a request class. The query that reads the limit gives the value of each measure.
- A limit is not a floor: no limit keeps a measure above an amount.

## The use of a limit

| Function | What it gives |
| --- | --- |
| `limitAmount(limit, instance)` | The amount of a limit on an instance: the ceiling less the headroom. |
| `limitUse(limit, instance, value)` | The share of that amount that a value takes, and if the limit holds. |
| `limitUses(limits, instance, values)` | The use of each limit, from the largest use to the smallest. |

```ts
import { limitUses } from "@mark1russell7/capacity";

// 900 requests in each second, with 0.5 core-milliseconds for each request.
const uses = limitUses(limits.limits, instance, {
  cpu: { value: 450, unit: "{core}·ms/s" },
  memory: { value: 2.88, unit: "GiB" },
  "network.tx": { value: 50, unit: "Mbit/s" },
  "latency.p99": { value: 45, unit: "ms" },
});
// uses.value[0]: { limit: "memory", measure: "memory", value: { value: 2.88, unit: "GiB" },
//   amount: { value: 3.2, unit: "GiB" }, use: 0.9, holds: true }
```

- A use is the value, divided by the amount of the limit. A limit holds when its use is 1 or less.
- The first use of `limitUses` is the limit that binds: the limit nearest to its amount, or the furthest above it.
- The value converts to the unit of the ceiling. A value in a unit of a different kind is a problem.
- A limit with no value is a problem, not a limit that holds.
- Two limits with equal uses keep the order of the list.

Property tests hold the laws of the use on generated limits, instances and values, with amounts in different units:

- The use follows a scale of the value, and the inverse of a scale of the ceiling.
- The use does not change with the unit of the value, or with the unit of the ceiling.
- The use, times 1 less the headroom, is the value divided by the ceiling.
- A larger instance divides the use of each resource ceiling, and it does not change the use of a fixed ceiling.
- The order of the limits does not change the use of a limit.

Two controls show that these tests find a wrong use: one use that does not read the units, and one that keeps no headroom.

## The check of an instance type and a limit set

`checkInstance(type)` and `checkLimits(set)` give each problem, with a code and the path of the field. `readInstance(data)` and `readLimits(data)` examine the shape of the data first.

- Each id is lower-case words. The name of a resource starts with a lower-case letter, and it has only letters and digits.
- An instance has one resource or more. Each resource is a finite amount above 0, in a canonical unit.
- The resources `cpu`, `memory` and `network` convert to their units.
- A headroom is 0 or more, and below 1.
- A fixed ceiling is a finite amount above 0, in a canonical unit.
- Two limits do not have one id. Two limits can hold one measure.

A limit set with no limit is correct. `instanceProblems(instance)` and `limitProblems(limit)` examine an instance and a limit that are not in a file.

## The scale rule

A scale model holds an instance, its limits, a composition for each measure of a limit, and the catalog of the compositions.

| Function | What it gives |
| --- | --- |
| `scaleRule(model, demand, options)` | The lowest count of instances that holds each limit at the demand, the limit that binds, and the load of the next step. |
| `countReach(model, count, demand, options)` | The highest load that a count of instances holds, as a factor of the demand, and the limit that breaks first. |

```ts
import { scaleRule } from "@mark1russell7/capacity";

const model = { instance, limits: limits.limits, compositions: [cpu, memory], catalog };
const rule = scaleRule(model, workload, { whole: ["heap"] });
// rule.value.count: { value: 5, interval: { low: 5, high: 6 } }
// rule.value.binding: "cpu"
// rule.value.next.factor.value: 1.11, thus 5 instances hold 1.11 times the demand.
```

- The demand divides between the instances, as in `shareOf`. A level in `options.whole` does not divide.
- Each larger count also holds each limit. A null count is more than `options.most` instances, 2 to the power 20 when the options give none.
- The binding limit needs the most instances. It is null when one instance holds each limit.
- `next` is the reach of the count. The factor of `next` is the load where the service needs one more instance.
- A count and a factor have an interval from the replicates of the laws. Row `i` of each limit reads row `i` of each law, thus the rows pair.
- The field `binds` of each limit is the share of the replicates where that limit binds.
- The flag `extrapolated` tells that a law reads a variable outside its range at the count.
- The flag `edge` tells that a composition has no value past the count, and that the edge sets the count.

The interval tells the doubt of the laws. It does not tell the noise of one run. The headroom of a limit holds that noise.

The search reads a grid along the share of one instance, `1 / n`, on a log scale. A bisection then finds each crossing. Two crossings in one step of the grid can hide the first.

Tests hold the scale rule and the reach against each other on generated demands: the count holds the load, and one instance less does not.

### The scale rule of alerts

The test `src/scale-files.test.ts` reads the laws, the compositions, the instance files and the limits of alerts (CAP-37). The query `countReach` gives the highest rate of events that one copy holds.

| Instance type | Limits | The rate of one copy, events each second | The limit that binds first | The next limits |
| --- | --- | --- | --- | --- |
| `small-cloud-1gb` | The limits file | 10.4 [10.0, 10.8] | `memory` | `heap` at 29.3, `cpu` at 29.6 |
| `small-cloud-1gb` | No headroom | 21.3 [20.6, 21.9] | `memory` | `cpu` at 43.4, `heap` at 52.2 |
| `lab-target-1gb` | The limits file | 29.3 [27.2, 30.6] | `heap` | `memory` at 32.0, `cpu` at 254 |
| `lab-target-1gb` | No headroom | 48.3 [42.5, 49.5] | `memory` | `heap` at 52.2, `cpu` at 364 |

- On the small cloud machine, the memory binds first, at less than half of the rate where the CPU binds.
- The row with no headroom on the lab target gives the reach of the lab README: 48 events each second.
- Each law is of the Intel Xeon 6975P-C. The CPU of the cloud machine is a different model, thus its CPU reach is a forecast.
- Each law is at the base point of the ladder: 16 MiB of log, 10 feeds, 10 persons and 10 incidents.
- A reach past 30 events each second is outside the range of the laws. CAP-86 adds the rungs from 40 to 70.

The rule does not tell these parts yet. CAP-37 adds them:

- The laws of the polls, the routes, the incidents and the bursts, and the lag of the event loop (CAP-36 and CAP-68).
- The new shared config of alerts: more sources, a score rule and a chain report. The contract of alerts names them.
- The live load of the cloud copy, and the smallest instance type that holds it.
- What stops a second copy of alerts. Until then, the count of copies is 1.

## The homes of the parts

| Part | Home |
| --- | --- |
| Units and amounts | `@mark1russell7/quantity` |
| Means, quantiles, least squares, the fit of a separable model with its bootstrap and held-out ranks, and the tests of the gate (`binomialTest`, `holm`, `partialConjunction`) | `@mark1russell7/rigor-statistics` |
| The outcomes of a gate: pass, block and no read (`gateOf`) | `@mark1russell7/rigor-bench` |
| Programs and their evaluation | `@mark1russell7/vex` and `@mark1russell7/vex-domains` |
| A value or an error | `@mark1russell7/optional` |
| The property tests of the algebra | `@mark1russell7/rigor-testkit` on `fast-check` |
