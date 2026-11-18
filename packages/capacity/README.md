# @mark1russell7/capacity

This package has the performance and capacity models. A law gives one measure of a subject as a function of its load variables, with an interval. A workload gives the load.

**State: CAP-1 and CAP-7 of the [roadmap](../../docs/ROADMAP.md).** The catalog of forms, the composition of laws, the knee and the scale rule come next. The package stays private until its first npm release (CAP-8).

## Entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/capacity` | The law record and the workload record, their checks, the value of a law, and the algebra of demands. A browser can import it. |
| `@mark1russell7/capacity/schema` | The schemas of a law file and a workload file, with `readLaw` and `readWorkload`. This entry needs `zod`. |

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
| `loadPointOf(demand, id, law, given)` | The load point of one class for a law. |

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

## The homes of the parts

| Part | Home |
| --- | --- |
| Units and amounts | `@mark1russell7/quantity` |
| Quantiles | `@mark1russell7/rigor-statistics` |
| Programs and their evaluation | `@mark1russell7/vex` and `@mark1russell7/vex-domains` |
| A value or an error | `@mark1russell7/optional` |
| The property tests of the algebra | `@mark1russell7/rigor-testkit` on `fast-check` |
