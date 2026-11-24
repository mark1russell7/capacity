# @capacity/lab

This package has the subjects of the measurement: the programs that a run measures, and the request classes that a run sends to them. It also has the cases: each case is one measurement as data. The cell of a case operates it in the lab of `@mark1russell7/harness`, and the record keeps its measures. A plan is a set of cases that one CI job measures, with the check of their records.

**State: CAP-18, CAP-10, CAP-16, CAP-19 and CAP-20 of the [roadmap](../../docs/ROADMAP.md).** The package has the bare subject of layer 1, the case record, the cell of a case and the record of its measures. It also has the plans, the timed runs, the noise floor of each measure and the sweep of the request rate. The package is private: it is a tool of this repository.

## The cases

A case is one measurement as data: a subject, the resources of its container, and the demand that the driver sends to it. A case file is this record as JSON, with the format `capacity-case/1`.

```json
{
  "format": "capacity-case/1",
  "id": "node-http/work-500us",
  "title": "500 us of work at 200 requests each second",
  "subject": "node-http",
  "instance": { "resources": { "cpu": { "value": 1, "unit": "{core}" }, "memory": { "value": 268435456, "unit": "B" } } },
  "demand": {
    "classes": [{ "id": "work", "rate": { "value": 200, "unit": "{request}/s" }, "request": { "work": { "value": 0.5, "unit": "ms" } } }],
    "levels": { "heap": { "value": 67108864, "unit": "B" } }
  },
  "duration": { "value": 30, "unit": "s" },
  "arrivals": { "arrivals": "poisson", "seed": "work-500us" },
  "runs": 5
}
```

The case uses the records of `@mark1russell7/capacity`. Thus a measurement and a law use one model of the load.

| Field | What it is |
| --- | --- |
| `subject` | The name of a subject of `SUBJECTS`, for example `node-http`. |
| `instance` | An instance of `@mark1russell7/capacity`. Its `cpu` and its `memory` are the limits of the container of the subject. |
| `demand` | A demand of `@mark1russell7/capacity`. Each class is one stream of the driver, at the rate of the class. |
| `duration` | The time of the schedule of each run, up to 600 s. |
| `arrivals` | The arrivals of each stream: `uniform`, or `poisson` with a seed. They are the options of a schedule of `@mark1russell7/rigor-chaos`. |
| `connections` | Optional. The connections of each stream: `pipeline`, `pool` with a `size`, or `fresh`. With no value, each stream is a pipeline. |
| `runs` | The count of the runs that the record counts, from 1 to 20. One warm-up run comes before them. |
| `idle` | Optional. The value `true` makes an idle case: each run holds its connections for the duration and sends no request. Refer to "The idle base". |

- **The variables of a request** are the fields of a request class. Each amount converts to the unit of its field, and it is a whole number in that unit. Thus `0.5 ms` of `work` is `500 us`. A field that the request does not name is 0. `requestClassOf` gives the request class.
- **The levels of a demand** are the amounts that the subject holds. The level `heap` is the live heap of the subject, in bytes: the flag `--ballast`. `caseLevel` gives a level in its unit.
- **The check.** `caseProblems` gives each problem of a case, with its path. It uses `instanceProblems` and `demandProblems` of `@mark1russell7/capacity`. Then it examines what the lab can do:
  - The lab limits the CPU and the memory of a container, and not the network. An instance with `network` is a problem.
  - The driver holds no open connection with no request. A level `connections` is a problem.
  - Each class of a case of load has a rate above 0. Each class of an idle case has the rate 0.
  - An idle case has no cost, and its hold is `IDLE_MIN_HOLD` (10 s) or more.
  - The connections are correct for `connectionsProblems` of `@mark1russell7/harness`: a pool has 1 to 1024 connections.
  - A case plans `MAX_ARRIVALS` (150000) arrivals or fewer in its runs and its warm-up run. `arrivalsOf` gives the arrivals of one run.
- **The connections of a class.** Each class is one stream of the driver, and the field `connections` of the case gives the connections of each stream. The driver sends each request at its planned time, and each latency counts from that time.
  - `pipeline` is the default: one connection, and the driver does not wait for a reply before the next request (HTTP pipelining). A request of a pipeline can come in one read with other requests. Thus its CPU cost can be less than the cost of a request of a real client.
  - `pool` keeps `size` connections, each with one request in flight. A due request with no idle connection waits for one. That wait is in its latency, and not in the lag of the driver. A real client sends one request at a time on each connection of a pool.
  - `fresh` opens a new connection for each request. CAP-28 measures that protocol.
- **The size of the raw result.** The raw result of a cell keeps approximately 2.3 KB for each arrival, most of it the records of the prober. One JSON text in Node has at most 512 MiB. Thus `MAX_ARRIVALS` keeps the raw result of a case near 340 MB or less. CAP-54 removes this limit for load cells.

### The grid of load variables

A load variable is one amount of a case that a design moves. `LOAD_GRID` gives the range and the scale of each one:

| Variable | Amount of the case | Unit | Range |
| --- | --- | --- | --- |
| `rate` | the rate of the class | `{request}/s` | 1 to 9000 |
| `body`, `reply` | a field of the request | `B` | 1 to 1 MiB |
| `alloc` | a field of the request | `B` | 1 to 16 MiB |
| `work` | a field of the request | `us` | 1 to 10000 |
| `wait` | a field of the request | `ms` | 1 to 1000 |
| `concurrency` | the size of the pool of connections | `{connection}` | 1 to 256 |
| `heap` | the level `heap` | `B` | 1 MiB to 256 MiB |
| `age` | the duration of each run | `ms` | 1000 to 4000 |

- **The scale.** Each scale is `log`, because a law of a load variable spans orders of magnitude. Each amount is a whole number in its unit.
- **The limit of the arrivals.** The rate and the age together fit `MAX_ARRIVALS` for 3 runs and the warm-up run: 9000 × 4 s × 4 is 144000. A test holds this product.
- **A load design** (`LoadDesign`) has a seed, the variables that it moves, and two counts. `designCases` gives its cases over a base case of one class.
  - `alone` is the count of points of each variable alone. The other variables keep their amounts in the base case.
  - These points come from `oneAtATimePoints` of `@mark1russell7/rigor-generators`, with one point in each stratum of the range. The ids are `<base>/<variable>/<k>`.
  - `together` is the count of points of a Latin hypercube of all the variables. The ids are `<base>/together/<k>`.
- **The check.** `designProblems` gives the problems of the grid, of the shape of the design, and of each case (`caseProblems`).
- **Other ranges.** A design that needs other ranges gives its own grid to `designCases`. `gridProblems` examines that grid.

## The cell and the record

`measureCase(case)` measures a case in three steps. Each step is also a function, and a test can give each part.

1. `cellOf(case, { cpus })` gives the cell of the harness. It has no Docker and no clock.
2. `runCell` of `@mark1russell7/harness` operates the cell in Docker: one warm-up run, then the runs of the case.
3. `recordOf(case, result, host)` gives the record of the result, with the format `capacity-record/1`.

### The cell

| Part | What it is |
| --- | --- |
| The subject | The program of the subject, with the CPU quota and the memory limit of the instance. The level `heap` is its flag `--ballast`. |
| The CPUs | The subject has the first CPUs of the host, one for each started core. The driver and the reader have the other CPUs. `cpuSetsOf` gives them. |
| The driver | The client `load` of the harness. Each class is one stream, at the rate of the class for the duration of the case. |
| The reader | It reads the control group of the subject before and after the schedule, and each 250 ms between them. |
| The window | Two durations and a drain of 30 s. A request with no reply at the end is unfinished. |

A host with fewer CPUs than the subject cores plus one is an error. Thus the driver does not take the CPU time of the subject.

### The record

A record has the case, the machine, the times and one record for each counted run. The warm-up run is not in it. The case gives the load of each run, thus a law gets its load points from the demand of the case.

Each run record has the measures of the container and the measures of the driver. A measure that the run did not read is `null`, not 0.

| Measure | Unit | What it is |
| --- | --- | --- |
| `cpu`, `cpu.user`, `cpu.system` | `{core}·s` | The CPU time of the subject in the run. The control group adds the time of each core. |
| `cpu.throttled` | `s` | The time that the CPU quota stopped the subject. |
| `cpu.request` | `{core}·ms/{request}` | The CPU time for each answered request. |
| `memory` | `B` | The memory of the subject at the end of the run. |
| `memory.peak` | `B` | The peak of the control group, only when it rose in the run. |
| `memory.high` | `B` | The highest reading of the series. It is a low bound of the peak. |
| `network.rx`, `network.tx` | `B` | The bytes in and out of the subject. `network.rx.request` and `network.tx.request` are the bytes for each answered request. |
| `planned`, `answered`, `failed`, `unsent`, `unfinished` | `{request}` | The counts of the driver. A failed request has a reply with a status outside 200 to 299. |
| `latency.p50`, `latency.p90`, `latency.p99`, `latency.max` | `ms` | The quantiles of the time from the planned time to the reply. |
| `lag.max` | `ms` | The largest delay of a send after its planned time. |
| `cpuset.busy`, `cpuset.user`, `cpuset.nice`, `cpuset.system`, `cpuset.irq`, `cpuset.softirq`, `cpuset.steal` | `{core}` | The use of the CPUs of the subject. The time of each process and interrupt on them counts. |
| `others.cpuset.busy` and the same parts | `{core}` | The use of the CPUs of the driver and of the reader. |

The measures of the driver are also in `classes`, for each class of the demand.

- **An unfinished request** counts at its age at the end. Thus a quantile of a run with an unfinished request is a low bound. The CPU time of an unfinished request counts, thus `cpu.request` of such a run is too high.
- **The idle cost** of the subject is in each measure of a run. A run of an idle subject needs a hold with no load in the harness. Thus the idle base is CAP-48.
- **The cpuset measures** come from `/proc/stat` between the readings of the resources, in the window of `elapsed`. `busy` is the CPUs less their idle time and their wait for the disk. The other measures are the parts of `busy`. A record of a lab before harness 0.16.23 has no cpuset measures.
- **The lag of the driver** has no limit in the record. The checks `control` and `floor` give a limit at their light load: `LAG_LIMIT`. The check `rate` gives its own limit: `RATE_LAG_LIMIT`.

## The plans

A plan is a set of cases that one CI job measures on one runner, and the check of their records. A plan file is this record as JSON, with the format `capacity-plan/1`, in the folder `plans`. The name of the file is the id of the plan.

| Field | What it is |
| --- | --- |
| `id` | Lower-case words joined by `-`. It is a part of the name of the artifact of each run. |
| `check` | The name of a check of `CHECKS`, or `null`. The check judges the records of the plan. |
| `triggers` | The events that start the plan with no selection by hand: `pull_request` and `schedule`. A person can start each plan by its id. |
| `cases` | The cases of the plan, each a case record or a start case. The ids of the cases are different. |
| `jobs` | The count of jobs of the plan when the workflow gets no list of runs. The default is 1. Each job is on its own runner. |
| `laws` | The law set of the plan: the laws that the records of the plan give. Refer to "The laws". |
| `gate` | The plan of the laws of a gate plan, for example `{ "laws": "rate" }`. Refer to "The gate of the laws". |

- **One runner for each plan.** The cases of a plan share one runner, thus one CPU model. Thus a check can compare two cases, and the points of a law come from one machine.
- **The check.** `planProblems` gives each problem of a plan. It examines each case with `caseProblems`, and each start case with `startCaseProblems`. `readPlans` reads each plan file of a folder, and the id of each plan must be the name of its file.
- **The time of a job.** `planMinutes` gives the time limit of the job of a plan. It is `SETUP_MINUTES` and the window of each run of each case, with the warm-up runs. A start case adds `startWindowOf`. A plan that needs more than 360 minutes is a problem. Put some of its cases in a second plan.

### The positive control

The plan `control` has two cases. The case `control/more` adds 1 ms of CPU work, a reply of 16 KiB and a live heap of 64 MiB to each request of `control/base`. The check `control` (`controlCheck`) gives the problems of the records:

- Each run must answer each planned request, with no failure and no unfinished request.
- The driver of each run must have a lag of `LAG_LIMIT` or less.
- The medians of the records must show each cost in its own measure, inside the limits of `CONTROL_LIMITS`:

| Measure | The limits of the check | The 22 runs |
| --- | --- | --- |
| The change of `cpu.request` | 0.835 to 1.299 ms | 0.990 to 1.145 ms |
| The change of `network.tx.request` | 16388 to 16389 B | 16388.198 B in each run |
| The change of `memory` | 60911616 to 75190272 B | 65671168 to 70430720 B |
| `latency.p50` of the second case | 0.99 to 1.64 ms | 1.209 to 1.424 ms |

Each limit is the worst of the runs, less or plus the spread of the runs, rounded outward. The runs are each run of the plan from 44448319523 to 44892024907, on four CPU models. A run outside a limit is a question about the measure first.

The first limits came from 6 runs on two CPU models. The run 44555583909 on an AMD EPYC 9V45 was outside them, with a change of 1.145 ms. The same commit passed in the next two runs. Thus the cause was the noise of the runner, not the code. Its driver had a lag of 10.0 ms, and the other runs had 2.8 ms or less.

The check is a function of the records, with no Docker. Thus a test examines it with the two records of the Lab run 44453927945, in `test/fixtures`.

### The noise floor

The plan `floor` has 5 A/A pairs. The two cases of a pair are equal: each one is a copy of `control/base`, in its own container. Thus each difference between the cases of a pair is noise. The check `floor` (`floorCheck`) gives these values for each measure of `FLOOR_MEASURES`:

| Value | What it is |
| --- | --- |
| `<measure>.floor` | The noise floor: 2 standard deviations of the 5 differences. A difference is the median of the case b less the median of the case a. |
| `<measure>.level` | The median of the medians of the 10 cases: the level of the measure at this load. |
| `<measure>.bias` | The mean of the 5 differences. The case a always runs first, thus a bias far from 0 is an effect of the order. |
| `lag.max.worst` | The largest lag of the driver in a run. |

- Each run must answer each planned request, with no failure and no unfinished request. The driver of each run must have a lag of `LAG_LIMIT` or less.
- Each floor must be `FLOOR_LIMITS` or less. A larger floor tells that the runners became noisier.
- The bias is information, not a limit.
- A law keeps the floor of its measure in its field `noise`, with the CPU model and the runs. A difference below the floor is not a result.

| Measure | The limit of the floor | The floors of the 5 runs | The levels of the 5 runs |
| --- | --- | --- | --- |
| `cpu.request` | 0.148 ms | 0.012 to 0.079 ms | 0.152 to 0.309 ms |
| `memory` | 1690514 B | 1137509 to 1414011 B | 29845504 to 30003200 B |
| `memory.high` | 1654583 B | 1011498 to 1333040 B | 30384128 to 30554112 B |
| `network.rx.request` | 0.193 B | 0 to 0.096 B | 106.198 B |
| `network.tx.request` | 0 B | 0 B in each run | 165.132 B |
| `latency.p50` | 0.210 ms | 0.021 to 0.116 ms | 0.226 to 0.418 ms |
| `latency.p90` | 0.705 ms | 0.023 to 0.364 ms | 0.279 to 0.689 ms |
| `latency.p99` | 3.302 ms | 0.116 to 1.709 ms | 0.511 to 3.509 ms |

Each limit is the worst floor plus the spread of the floors, rounded outward. The runs are the 5 runs of the Lab run 44467543161, on four CPU models. The run on an AMD EPYC 9V45 has the worst floor of `latency.p90` and `latency.p99`, and the worst lag of the driver, 8.7 ms.

`LAG_LIMIT` is 19.4 ms. It comes from the worst lag of 27 jobs: the 22 runs of the plan `control` and the 5 runs of the plan `floor`. The worst lags are 0.626 to 10.004 ms.

The floor holds for the load of `control/base` and for the cases of one job on one runner. Two runners can have more noise than the cases of one job. The gate of the laws (CAP-26) compares runs on two runners, thus it measures that noise too. CAP-27 gives a factor for each CPU model.

The plan runs each night, not on each pull request. Its time limit is 54 minutes, and the floor is a property of the runners, not of the code. A test examines the check with records, with no Docker.

### The request rate

The plan `rate` sends the bare request to the bare subject at 25 rates, from 100 to 36000 requests each second. The subject has one core and 512 MiB. The points of the laws of the request rate come from its records (CAP-20). Its law set tells the laws of its records (refer to [The laws](#the-laws)). Its six law files are in `packages/capacity/laws` (CAP-17). The summary of the fit gives the interval of each constant, each value at the ends of a range and each knee (CAP-53).

| Part | The value | Why |
| --- | --- | --- |
| The rates | 100, 300, 1000, 2000 and 3000, then 4000 to 14000 in steps of 1000, then 16000 to 24000 in steps of 2000, then 27000 to 36000 in steps of 3000 | The knee and the limit of one core are not known before the first runs. From 4000, each step is 25 % of its rate or less. |
| The connections | A pool of 64 | A real client has one request in flight on each connection. 64 connections are more than the requests in flight under the limit. Past the limit, the queue is in the driver, and the latency counts it. |
| The arrivals | Poisson, with the seed `rate` | Random arrivals give the queue of a real load below the limit. Each case has the same seed, thus the cases differ only by their rate. |
| The duration | 1 s | A case plans at most `MAX_ARRIVALS`. 4 runs of 1 s at 36000 requests each second are 144000 arrivals. Each case has the same duration, thus past the limit the queue of each case grows for the same time. |
| The runs | 3, after one warm-up run | The median of 3 runs, as in the plans `control` and `floor`. Each job is one runner, thus 5 jobs give 5 values of each point. |

The check `rate` (`rateCheck`) gives these values for each case:

| Value | What it is |
| --- | --- |
| `<case>.cores` | The CPU use in cores: the median of the CPU time over the elapsed time of each run (`coresOf`). At the limit of one core, it is near 1. |
| `<case>.<measure>` | The median of the runs, for each measure of `RATE_MEASURES`: `cpu.request`, `memory`, `memory.high`, `latency.p50`, `latency.p90`, `latency.p99`, `lag.max`, `cpuset.busy`, `cpuset.user`, `cpuset.system`, `cpuset.irq`, `cpuset.softirq` and `others.cpuset.busy`. |

- Each run must answer each planned request, with no failure and no unfinished request. Past the limit, a run drains its queue in the 30 s of its drain.
- `lag.max.worst` is the largest lag of the driver in a run of the plan.
- `<case>.cpuset.busy` less `<case>.cores` is the use of the CPU of the subject outside its control group. Thus the values tell if the CPU of the subject is full, and which work fills it.
- The driver of each run must have a lag of `RATE_LAG_LIMIT` (30.9 ms) or less. The plan drives the subject past its limit. Thus its driver has more lag than in the light plans.
  - The limit comes from the worst lag of the 5 jobs of the Lab run 44948617847: 9.909 to 20.383 ms, spread 10.474.
  - The worst lag is at `rate/33000` in job 5. There, the latency is 329 ms at p50. Thus the lag is a small part of the latency.
  - Below the limit of the subject, a latency near the lag of its run can be a latency of the driver. The values give `lag.max` and the latencies of each case.
- The plan has no trigger: a person starts it. Its time limit is 74 minutes.

The Lab run 44964347304 gives the use of the CPUs at each rate. Four of its five jobs were on an Intel Xeon 6975P-C. The values are the medians of these four jobs:

- **The knee.** The median latency stays near 0.13 ms up to 12000 requests each second. It is 0.26 ms at 14000, and 36.7 ms at 36000.
- **The window.** At 1000 requests each second, the window of a run is 1.29 s for a schedule of 1 s. At 36000, it is 1.43 s. This calculation assumes that the 0.29 s outside the schedule is the same at each rate. Then the subject serves approximately 31600 requests each second at 36000.
- **The core of the subject is the limit.** At 36000, CPU 0 is 0.78 busy in the window, thus approximately 0.97 busy in the 1.14 s of load. The subject has approximately 0.64 cores of it.
- **The work outside the subject.** Approximately a third of CPU 0 is work outside the control group of the subject (`cpuset.busy` less `cores`). Its softirq is approximately 0.1 cores.
- **The driver is not the limit.** Its CPUs are 2.37 busy of 3 at 36000. Its user time stays at approximately 1.6 cores from 20000 requests each second. Thus its CPU time for each request falls under load.

### The overhead of the runner

The plan `overhead` measures the cost of the service runner (CAP-29). Each pair of the plan sends one load to the bare subject and to the service subject, on one runner. Thus the difference of a pair is the cost of the runner at that load. Refer to [The service subject](#the-service-subject).

| Part | The value | Why |
| --- | --- | --- |
| The pairs | 8 rates: 100, 500, 1000, 2000, 3000, 4000, 6000 and 8000 requests each second | The rates stay below the knee of the bare subject, at approximately 12000 requests each second. A law needs 40 points from 5 jobs, thus 8 points in each job. |
| The order | The two cases of a pair are next to each other. The bare case is first in the pairs 100, 1000, 3000 and 6000. The service case is first in the other pairs. | A drift of the runner in a job adds to the case that comes later. The alternate order puts the drift on the two sides equally. |
| The load | The load of the plan `rate`: the bare request, Poisson arrivals with the seed `rate`, a pool of 64 connections, 1 s, 3 runs after one warm-up run, one core and 512 MiB | The bare side has the cases of the plan `rate`. Thus the two plans give comparable points. |

The check `overhead` (`overheadCheck`) gives each value and each problem of the check `rate`. It also gives these values:

| Value | What it is |
| --- | --- |
| `<pair>.<measure>` | The overhead at the load of the pair: the value of the case `<pair>/service` less the value of the case `<pair>/bare`. |
| `<measure>.overhead` | The median of the overheads of the pairs. |

- The measures are the measures of `OVERHEAD_MEASURES`: `cpu.request`, `memory`, `memory.high`, `network.rx.request`, `network.tx.request`, `latency.p50`, `latency.p90` and `latency.p99`.
- A pair has the cases `<pair>/bare` and `<pair>/service`, with the subjects of `OVERHEAD_SIDES` and one load. A case with no partner, another subject or another load is a problem.
- The reply of the service subject has one more header, `content-type`. Thus `network.tx.request` has an overhead of approximately the size of that header.
- The subjects have no measure of their event-loop lag. The latency overhead includes the lag that the runner adds. The lag of a subject is CAP-68.
- The plan has no trigger: a person starts it. Its time limit is 55 minutes.

#### The laws of the overhead

The values of one job are not a law. The law set of the plan has the field `base` with the value `bare`. Thus `lawsOf` gives laws of the overhead, with an interval over the jobs.

| Part | The rule |
| --- | --- |
| The point | The value of the case `<pair>/service` less the value of the case `<pair>/bare` in the same job, at the rate of the pair |
| The id | `node-http-service/overhead/<cpu>/<measure>.overhead`. The id of the measure has the suffix `.overhead` (`OVERHEAD_SUFFIX`). |
| The conditions | The conditions of the service side, and the condition `base`: the subject of the bare side, `node-http` |
| The residual | Absolute. An overhead can be 0, and a relative residual divides by the value. |
| The cuts | A cut of the record of either side removes the point. The served share and the tail count apply to the two sides. |

- In a set with a base, the id of each case is `<pair>/<side>`. Each pair has a case of the base side and a case of another side. `lawSetProblems` gives a problem for each other case.
- A record with no record of the base side in its job is a problem. The two sides of a pair with different loads are a problem too.
- The set has the measures `cpu.request`, `memory`, `memory.high`, `latency.p50`, `latency.p90` and `latency.p99`. The network overhead is exact: 8 B more received and 40 B more sent for each request. Thus it has no law.
- The summary tells for each overhead law, at the two ends of its range, if its interval shows an overhead, a saving or 0.
- The gate of the laws does not read an overhead law. The gate of the runner laws is CAP-33.
- A law needs 5 jobs on one CPU model. A runner gets a random CPU model. Thus the laws pool the jobs of more than one run of the plan.
- The conditions of a law do not identify the files of the subjects (CAP-69). Pool only the runs of one commit of the subjects.

### The idle base

The plan `idle` measures the idle base of each subject (CAP-48): the CPU time and the memory of the process with no request. A case of load mixes the idle part and the part of the requests. Thus the idle base comes from its own kind of case.

- **The idle case.** A case with `"idle": true` is an idle case. Each class keeps its request and has the rate 0. The duration of the case is the hold of each run.
- **The cell.** `cellOf` gives each class a stream at the rate 0, with its request, and it sets `idleBefore` of the harness to the hold. The harness takes the start reading, holds the open connections with no request, then takes the end reading. The series of the resources continues for all of the run.
- **The window.** The window of an idle run is the hold and the drain (`windowOf`). The driver has no arrival, thus it stops at the end of the hold.
- **The laws.** A plan with a law set has no idle case. An idle run answers no request, thus each measure for each request is null.

| Part | The value | Why |
| --- | --- | --- |
| The cases | `idle/bare` with `node-http`, and `idle/service` with `node-http-service` | The two subjects of the plan `overhead`. The difference of the two is the idle cost of the service runner. |
| The load | One core, 512 MiB, a pool of 64 open connections, the class `rate` with the bare request, at the rate 0 | The conditions of the plan `overhead`. Thus a base applies to the points of that plan. |
| The hold | 60 s, in each of 5 runs after one warm-up run | The longest period of the service subject is its liveness window of 45 s. The hold also gives 240 readings at the reading period of 250 ms. |

The check `idle` (`idleCheck`) gives these values. The measures are the measures of `IDLE_MEASURES`.

| Value | What it is |
| --- | --- |
| `<case>.cpu.rate` | The CPU time of the container over the elapsed time of a run, in cores. It is the median over the runs. |
| `<case>.memory` | The memory at the end of a run, in bytes. It is the median over the runs. |
| `<case>.memory.high` | The highest reading of the series of a run, in bytes. It is the median over the runs. |
| `<pair>.<measure>.overhead` | The base of the case `<pair>/service` less the base of the case `<pair>/bare`. |

- Each run of an idle case sends no request, and it lasts the hold or more. A run that is shorter shows a harness with no hold. Each run has a read of each idle measure.
- `idleBaseOf` gives the base of one record. `idleBasesOf` gives the base of each idle record of some jobs (`readJobs`), with the name of the job and the CPU model. It uses only a job with no problem in its verdict.
- `netRequestCpu` gives the CPU time of one request less the idle CPU time of its run. At a low rate, the idle part of `cpu.request` is large.
- No law reads the base yet. A later fit subtracts the base of the same job or of the same CPU model from the totals of each point.
- The plan has no trigger: a person starts it. Its time limit is 38 minutes.

## The timed runs

A timed run is one job of the workflow `lab.yml`: it measures one plan on one runner of GitHub. Only CI starts a timed run, because the lab needs Docker and a machine with no other load.

| Event | The plans |
| --- | --- |
| The schedule, each night at 06:37 UTC | Each plan with the trigger `schedule` |
| A pull request that changes the lab, the model, the laws, the lockfile or the workflow | Each plan with the trigger `pull_request`. A gate plan starts only for a change of a file of the gate. |
| A push of such a change to `main` | Each plan with the trigger `pull_request` |
| A dispatch by hand, with the input `plans` | The plans of the input. With no input, each plan with the trigger `pull_request`. |

The input `runs` of a dispatch is a JSON list of numbers. Each run of each plan is a job on its own runner, thus a limit can take the worst of many runners. For example, 5 runs of the plan `control`:

```sh
gh workflow run lab.yml -R metrograph-labs/capacity --ref <branch> -f plans=control -f runs='[1,2,3,4,5]'
```

The workflow has three steps:

1. The job `plan` reads and examines each plan file. Then `selectPlans` gives the plans of the event, and `matrixOf` gives one job for each run of each plan. A plan with a problem, an unknown id and a selection with no plan stop the workflow.
   Each job gets the time limit of its plan (`planMinutes`) and the swap of its targets (`planSwap`). Some runners have no swap, thus the job adds a swap file when the runner has less.
2. Each job measures its plan with `timePlan`: each case with `measureCase`, and each start case with `measureStart`. Then the check of the plan gives the verdict (`verdictOf`), with the problems of each start record. A verdict with a problem fails the job. The summary of the job has the CPU model, each value of the check and each problem.
3. Each job uploads its folder as the artifact `lab-<plan>-<run>-<attempt>`.

A rerun of the failed jobs of a run uploads only the artifacts of those jobs, with the next try. The other artifacts keep their first try. Thus the gates download the artifacts of all tries. With `--latest`, `gate.main.ts` and the bench gate read only the latest try of each artifact (`latestAttempts`).

### The folder of a run

| File | What it is |
| --- | --- |
| `<case>.record.json` | The record of each case, with the format `capacity-record/1` or `capacity-start-record/1`. The id of the case has `-` for each `/`. |
| `<case>.result.json` | The raw result of the cell of each case, or of the run of the children of a start case. A later analysis can judge it again. |
| `timed.json` | The manifest of the run, with the format `capacity-timed/1`. |

The manifest has the plan, the CI run and its `attempt`. It also has the machine of the first record, the times, the files of each case and the verdict. The CI run (`runOf`) has the form of a run of the evidence of a law: its address, its commit and its UTC time. Thus a law file gets its evidence from the manifest (refer to [The laws](#the-laws)).

- **The CPU model** of a run is `machine.cpu` of the manifest and of each record. The summary of the job also tells it.
- **The commit** of a pull request is the merge commit, because the job measures the code of that commit.
- **A case that throws** stops the plan with no manifest. The files of the cases before it stay in the artifact.
- **The command.** `node src/timed.main.ts plan --event <event>` gives the matrix as JSON, with no Docker. `node src/timed.main.ts measure --plan <id> --out <folder> --run <number>` measures a plan. Only CI starts `measure`. The run turns the order of the arms of a start case.

## The laws

A plan with the field `laws` gives laws from its records. The law set tells the class of its cases, the load variable and each measure of a law. The plan `rate` has a law set.

```json
"laws": {
  "class": "rate",
  "variable": { "id": "rate", "unit": "{request}/s", "scale": "log" },
  "measures": [
    { "id": "cpu.request", "title": "The CPU time of one request", "residual": "relative", "forms": ["linear", "hinge"] },
    { "id": "latency.p50", "title": "The median latency of a request", "residual": "relative", "served": 0.97, "knee": { "kind": "floor", "share": 1 } }
  ]
}
```

- **The check of the set.** `lawSetProblems` examines the set with the plan. Each case must be a case of load of the class of the set. The demand of each case must give a point of the variable. Each measure must have a noise floor (`FLOOR_MEASURES`).
- **One law for each CPU model.** The id of a law is `<subject>/<plan>/<cpu>/<measure>`, for example `node-http/rate/epyc-7763/cpu.request`. `CPU_IDS` gives the id of each CPU model of the runners. A CPU model with no id gives a problem, not a law.
- **The points.** Each case of each job gives one point: the median of its runs. A law needs 40 points or more (`leastCount` of the level 0.95). It also needs 5 jobs or more on the CPU model (`leastGroups` of the level 0.95), because the bootstrap draws whole jobs. A CPU model with fewer points or jobs gives no law, and the summary tells it. Dispatch the plan with `-f runs='[1,2,3,4,5]'` or more runs.
- **The jobs.** A job with no CI run, with a problem in its verdict, or with records of two CPU models gives no point. The summary tells each skipped job.
- **The conditions.** The facts that do not change between the points are the conditions of the law (`conditionsOf`). They are the class, the CPU model, the limits, the duration and the arrivals. The connections and the version of the harness are conditions too. A case with other facts gives a problem.
- **The noise.** Each law gets the floor of its measure from the jobs of the check `floor` on the same CPU model. With no floor on that CPU model, the law gets the largest floor of the jobs.
- **The fit.** `fitLaw` of `@mark1russell7/capacity` fits each form of the measure. The law keeps each form that lost, with its error, in `fit.losers`. `checkLaw` examines each law before the command writes it.
- **The run points.** The law keeps each point of its fit in `points`, in the order of the residuals (`runPointsOf`). A point has its load, its value, the index of its run in the evidence and the start time of its job. The site draws them on the curve.
- **The bootstrap draws jobs.** The plan fixes its rates, thus a rate is not a random unit. The independent unit is the job: one runner machine that measures each rate. Each run of the bootstrap draws whole jobs (`bootstrapGroups`). Thus each replicate has each rate, and its interval has the variation between the machines. The held-out fit holds out whole rates, because it ranks the shape of each form.
- **The served share.** A measure with the field `served` keeps only the points where the subject keeps up with the offered rate. The range of the law is the range of these points, and the law has the condition `served`.
- **The tail count.** A quantile measure with the field `tail` keeps only the points with enough arrivals for its quantile. The law has the condition `tail`.
- **The knee.** A measure with the field `knee` gives the knee of each law in its range, with `lawKnee` of `@mark1russell7/capacity`. A search that cannot apply gives a problem, and the law stays.
- **The overhead.** A set with the field `base` gives the laws of the difference of two sides in each pair. Refer to [The laws of the overhead](#the-laws-of-the-overhead).

### The served share

A case keeps up when the subject serves the share `served` of the offered rate or more. `servedShare` gives the least share that the records show:

- Each planned time of a request is in the duration `T` of a run.
- Each reply comes at most `latency.max` after its planned time.
- Thus the subject serves the requests of `T` in `T + latency.max` or less. The share is `T / (T + latency.max)` or more.

The latency is the median of the runs of the case. The plan `rate` gives the share 0.97 to its three latency laws. With runs of 1 s, a case keeps up when its `latency.max` is 30.9 ms or less.

- **Why a cut.** Past the limit of the core, a queue grows in the driver for the duration of the run. Then the latency tells the duration of the case, not a property of the subject. One law of a smooth form cannot fit both regions.
- **The other laws.** The laws of the CPU time and of the memory have good fits on all of the range. Thus their measures have no field `served`.
- **Too few points.** With fewer than 40 points that keep up, the law of the measure goes into the list of skipped laws.

### The tail count

The quantile of a run is a rank of its arrivals. With few arrivals, a high quantile is the latency of a few slow requests, not a property of the subject. The field `tail` of a quantile measure gives the least count `k` of requests in the tail of the quantile.

- **The rule.** A quantile `q` needs `k / (1 - q)` arrivals or more in each run (`tailNeed`). The run of a case with the fewest arrivals decides.
- **The count of the plan `rate`.** The plan gives the count 10 to its three latency laws. Thus the median needs 20 arrivals, the 90th percentile needs 100, and the 99th percentile needs 1000.
- **The cut.** A point with fewer arrivals stays out of the law, and the summary tells it. With fewer than 40 points in the range, the law goes into the list of skipped laws.
- **The cut on the Intel Xeon 6975P-C.** Each run has 111 arrivals at 100 requests each second and 295 at 300. At 1000, each run has 1000 or more. Thus the count cuts the rates 100 and 300 from the law of the 99th percentile. It cuts no point from the laws of the median and of the 90th percentile.

### The knee of a latency

The knee of a latency is the rate where the latency leaves its floor. The plan `rate` gives the rule `{ "kind": "floor", "share": 1 }` to its three latency laws: the first rate where the latency is two times its floor.

- **Why the floor, not the start.** At 100 requests each second, the median latency is 0.35 ms. From 1000 to 12000, it is approximately 0.13 ms. Thus the start value is not the floor.
- **Why a floor for each replicate.** The knee of a replicate is after its own floor. With the floor of the constants as one amount, a replicate with a high start had its knee at 100, the start of the range. That is not a knee.
- **The fall at a low rate.** The median goes from 0.354 ms at 100 to 0.140 ms at 2000. The 90th percentile goes from 0.511 ms to 0.231 ms. The tail count cuts no point of these laws, thus the fall is not an effect of the estimate. It is a cost of the subject at a low rate.
- **The cause of the fall.** The form `fall-power` gives the fall. The records do not tell its cause. Idle cores and cold caches are candidates.
- **The 99th percentile does not fall.** It goes up from 1.11 ms at 100. The tail count cuts the rates 100 and 300, thus its law starts at 1000.
- **Why the tail leaves first.** On the Intel Xeon 6975P-C, the 90th and the 99th percentiles are two times their floor between 3000 and 4000. The median is two times its floor near 16000. A delay that stops a share of the requests can cause this, for example a stop of the event loop. A quantile `p` leaves its floor when that share is more than `1 - p`. The records have no measure of garbage collection, thus this cause is not certain.
- **Each replicate has each rate.** The fall of the 90th percentile rests on the two lowest rates, 100 and 300. A bootstrap of whole rates left out the rate 100 in approximately one third of its replicates. These replicates extrapolated the fall, and 11 of 200 had a value of 0 or less at a low rate. The bootstrap draws whole jobs, thus each replicate has each rate. On the Intel Xeon 6975P-C, no replicate of the three laws has a floor of 0 or less.
- **No law of the median.** The forms `power` and `fall-power` fit the median best. In each replicate, their exponent is 4: the end of the search of a grid that ends at 3. Thus the interval of the exponent has a width of 0, and `checkLaw` refuses the law with the code `flat`. CAP-57 gives a problem for a shape at the edge of its search. Then the next form wins.

### A known problem

The field `known` of a measure marks a problem that the fit of the measure gives until an item of the roadmap removes it. The plans `rate` and `overhead` give the median the mark `{ "item": "CAP-57", "code": "flat" }`.

- **The codes.** The code is one of `KNOWN_CODES`, the codes of `checkLaw` that come from the data of a fit. Today the list has only `flat`. Each code of the list refuses the law, thus a measure with a mark has no law file.
- **A known problem.** The fit puts a problem of the measure with that code into the list `known`, with its item. The summary tells it, and it does not fail the fit.
- **Each other problem** fails the fit, also a problem of the same measure with another code.
- **A mark that the fit does not meet.** A law of the measure is a problem with the code `known`, and it fails the fit. Thus the item must remove the mark. A measure that gives no fit on a CPU model gives no read of its mark.
- **The check of the plan.** The item is the id of an item of the roadmap, for example `CAP-57`. The code is one of `KNOWN_CODES`.
- **Why a mark, not a red run.** A workflow that fails in each run teaches its readers to ignore a failure. The mark keeps the run green and the reason in the plan.

### The command and the workflow

The fit of the laws of a plan takes minutes, thus only CI starts it. The workflow `laws.yml` downloads the artifacts of each Lab run of its input `runs`, and fits the laws of each plan with a law set.

The fit reads only the manifests and the records. A job of the plan `rate` has approximately 3 GB of raw results. Thus the workflow downloads one artifact at a time, and deletes its raw results before the next download.

```sh
gh workflow run laws.yml -R metrograph-labs/capacity -f runs='<run of the plan rate> <run of the plan floor>'
```

- `node src/laws.main.ts fit --records <folder> --out <folder>` reads each manifest `timed.json` in the folder and in its subfolders.
- It writes each law into `<out>/<id>.law.json`, then it reads the file again with `readLaw`.
- A problem, or no law, gives the exit code 1. A known problem does not. Refer to "A known problem". The summary of the job tells each law, each problem, each known problem and each skipped job.
- The summary gives the interval of each constant, the range of each law, its values at the ends of the range and its knee. Each interval holds 0.95 of the replicates. It also tells each point that a law leaves out, with its `latency.max` and its share.
- The workflow uploads the files as the artifact `laws-<run>`. A pull request puts them into the repository.

### The gate of the laws

A gate plan measures the subject again at some points of the laws of another plan. The gate compares each value with the run range of its law (`planGate`). Thus a change of Node, of the runner or of the subject cannot move a law with no signal.

- **The plan.** A gate plan has the check `gate`, the field `gate` and 13 jobs or more (`GATE_PLAN_JOBS`). Its id starts with `gate-`.
- **The cases.** A gate plan has each A/A pair of the plan `floor`, for the noise floor of its job. Its other cases are cases of the plan of the laws, with the same ids. `gatePlanProblems` examines them.
- **The noise.** A job with a noise floor over its limit (`FLOOR_LIMITS`) gives no read of the laws of that measure.
- **The laws.** A job reads each law of its CPU model. A job on a CPU model with no law gives no read. The laws of the plan `rate` are on the Intel Xeon 6975P-C only.
- **The harness.** Each law has the version of `@mark1russell7/harness` as a condition. A record of a different version gives no read. Thus a new version of the harness needs new laws.
- **The outcome.** `lawGate` of `@mark1russell7/capacity` counts the reads above and below the run range in each job. A side needs 2 jobs or more, and Holm corrects the family. A gate with too few reads gives "no read". No read is not a pass.
- **The proof.** A case can add a CPU time to each request (`cost`, in us). A plan with a cost expects a block (`expectedOf`). Each other gate plan expects a pass.

The plans `gate-rate` and `gate-rate-cost` measure 4 rates of the plan `rate` from 300 to 3000 requests each second, in 13 jobs each night. The second plan adds 100 us to each request, thus its gate must block. Thus each night shows that the gate can block, and that the subject agrees with its laws.

The plan `gate-rate` also starts on a pull request that changes a file of the gate (CAP-60). The step `gate` of the job `changes` finds these files:

| Part | The files |
| --- | --- |
| The subject and the cell | `packages/lab/src/**`, other than the tests |
| The harness | `pnpm-lock.yaml` and `packages/lab/package.json`: they have the version of `@mark1russell7/harness` |
| The laws | `packages/capacity/laws/**`, and the plans `floor`, `rate` and `gate-*` |
| The gate | `packages/capacity/src/**`, other than the tests, and the workflow `lab.yml` |

A pull request that changes no such file starts no gate plan. The plan `gate-rate-cost` starts only each night.

### The count of jobs of a gate plan

A runner gets its CPU model at random, and a side of a law needs 2 jobs on the CPU model with laws. Thus the count of jobs comes from the share of that CPU model.

- **The share.** In the Lab run 45016177414 of CAP-26, 5 of 12 jobs had the Intel Xeon 6975P-C (`LAW_CPU_SHARE`). The others had the AMD EPYC 7763 (4), the Intel Xeon Platinum 8573C (2), the Intel Xeon Platinum 8370C (1) and the AMD EPYC 9V74 (1).
- **The target.** A plan gets fewer than 2 such jobs less than 1 time in 100 (`GATE_MISS`).
- **The count.** `gateJobsFor` gives the least count n with P(X ≤ 1) below the target, for X ~ Binomial(n, 5/12). The chance comes from `binomialTest` of `@mark1russell7/rigor-statistics`.

| Jobs | The chance of fewer than 2 jobs on the CPU model with laws |
| ---: | ---: |
| 6 | 0.21 |
| 12 | 0.015 |
| 13 | 0.009 |

Thus a gate plan has 13 jobs. `planProblems` refuses a gate plan with fewer. A noise floor over its limit also gives no read of a job, and the target does not include it.

The job `gate` of the workflow `lab.yml` starts after the jobs of the plans. It downloads the artifacts `lab-gate-*`, then it starts the command:

```sh
node src/gate.main.ts --records <folder> [--records <folder>] [--laws <folder>]
```

- The default folder of the laws is the folder `laws` of the package capacity.
- The summary of the job has a row for each law, each job with no read and the first reads that the laws left out.
- The exit code is 1 when a gate does not give the outcome that its plan expects. A gate with no job also gives 1.

## The start cases

A start case measures the start of an application, not its load. It gives the time to ready and the memory of a start, at each size of the store, on a model of the target machine. A start case is a record with the format `capacity-start/1`, in a plan.

| Field | What it is |
| --- | --- |
| `subject` | The id of the contract of the app. |
| `app` | The HTTPS URL of the repository of an app with a contract file. Each start case has an app. Refer to the app cases. |
| `seeder` | The commit of the tree that writes the stores. Each arm opens the same stores. |
| `arms` | 1 tree or more of the app, each at a commit. The first arm is the base, and each other arm is compared with it. A ladder of one variable needs only one arm. An arm can also have `ballast`. |
| `points` | The stores of the case. A point gives an amount of each variable of the app, for example the byte size of the log. A point with `after` is a second start. |
| `seed` | The seed of each store. One seed gives the same files. |
| `rounds` | The rounds of one job, from 1 to 10. |
| `watch` | The time of the watch after the ready time, 600 s or less. |
| `limit` | The longest start to the ready signal of the app, 1800 s or less. |
| `windows` | The ready windows of the supervisor of the app, up to the limit, in ascending order. |
| `probe` | The interval of the ready probe of the supervisor, 60 s or less. |
| `samples` | The interval of the samples of each child, from 1 s to 60 s. The default is no samples. |
| `target` | The machine that the case models: the image with its Node, the memory, the swap, the CPUs and the heap limit of V8. It can also give the disk, the page cache and the other processes. |
| `observed` | The facts of the target machine: the start of an arm on a point was ready in a window, or it was not. |

`measureStart` does the job of a start case in four steps:

1. It pulls the image of the target. A check child in a container of the target reads the Node version, the limits of the cgroup and the swap of the host. It also reads the heap limit and the CPUs. A fact that is not the fact of the target stops the case.
2. It makes a tree for each arm: a shallow fetch of the commit and the command `install` of the contract. The seed uses an arm at the commit of the seeder, or one more tree.
3. The command `seed` of the contract writes the store of each point one time.
4. `freshRun` of `@mark1russell7/rigor-bench/fresh` starts the children in the order `arms`, with the scope `child`. Each round starts one child of each arm and one A/A child of the base, on each point.

Each child is the program `app-start` in a new container of the target, with the Node of the image and `--expose-gc`. The container has the memory, the swap and the CPUs of the target. Node sizes the heap of V8 from the memory limit of the container, as on the target. The child copies the store and starts the app on the copy. It is ready at the ready signal of the app. Then it reads its memory and continues for the time of the watch.

### The app cases

Each start case is an app case. Its field `app` is the HTTPS URL of the repository of an app with a contract file, `capacity-app.json`. Its `subject` is the id of the contract. The contract of each tree gives the steps of the start. Thus the lab has no subject record for the app. A case with no app has a problem.

- The command `install` of the contract starts on the host, in the tree. The lab changes no file of the tree, thus it does not start the command `check`.
- The command `seed` writes the store of each point. The lab gives it `{store}` and the amount of each store variable, in the unit of the variable.
- The seed can also get the amount of a level variable, for example the routes of a configuration. The point sets this amount, and the record of the point has it.
- The last line of the output of the seed is a JSON record. Its field `amounts` gives the amount of each store variable that the seed wrote.
- The command `run` starts `node`. The lab writes a run file for each arm. The child is the program `app-start`, with the options of Node of the command `run`.
- `app-start` sets the arguments, the folder and the environment of the command `run`. Then it imports the script in its own process. Thus the container holds only the process of the app, as on the target.
- The app is ready at its ready signal: a line of its output, or the status 200 of a path on a free port.
- After the watch, `app-start` sends SIGTERM to its process and measures the close. An app with no listener of SIGTERM has no close time.

The lab does not time the first pass of an app. Thus `limit` is the longest start to the ready signal, and a reading of an app has no first pass.

The lines of the run in the contract give the passes and the writes of the snapshot. `app-start` reads each write of the app to stdout and to stderr.

- `passes` is the count of the lines `pass` from ready to the end of the watch.
- `writes` is each line `write` to the end of the watch, with its times. The measures `writes` to `writeCpu` read them.
- `readings` is each line `readings` to the end of the watch, with its time and its readings. Each reading of the record keeps them in `metrics`.
- A run with no line of a kind gives null for its field. The recorder keeps at most 100,000 lines of each kind.

The lab examines the contract of each tree before the seed, with `appCaseProblems`:

- Each point names each store variable of the contract and each level variable of its seed, in the range of the contract.
- A point can also name a load variable: the rate of a class, by the id of the class, or a request variable. Each amount is in the range of the contract.
- A class with a rate above 0 comes from an outside service, and the point names each request variable of the class. The lab sends no request of HTTP yet (CAP-71).
- The Node of the target is in the range `engines.node` of the `package.json` of the tree.
- The options of Node of the command `run` hold no placeholder. An option with a value has the form `--name=value`.
- The command `run` does not set `NODE_OPTIONS`, because the process of the app has started when it sets the environment.

#### The fakes of the outside services

A contract can have outside services, for example a feed or a channel of messages. The lab starts the fake of each service in place of the service:

- Each child of the arm gets a sidecar from `@mark1russell7/rigor-bench/fresh`: a second container that starts before the child. Its memory limit is the field `fakes` of the case, or `FAKES_MEMORY` (1 GiB).
- The sidecar is on the CPUs that the child does not use. Thus the memory and the CPU time of the fakes are not in the measures of the child.
- The program `fakes` of the sidecar starts each fake of the contract, in the tree of the arm. The fake of the service at the index `n` gets the port `4100 + n`.
- The child joins the network of the sidecar. The lab gives `{service.<id>}` the URL of the fake on `127.0.0.1`, and the child has no other network.
- The child starts when each fake gives its ready signal. A fake that ends before the end of the child makes the run fail.
- The fakes get the workload of the point of the child (`workloadOf`). Each class with a rate above 0 at the point is a class of the workload, with the amounts of its requests.
- A point with no rate gives the fakes no load. Thus a start case with no load variable measures the start of the app with no load.
- Each pair of an arm and a point has its own sidecar. The record of the point has the load amounts in its sizes. Thus the rate of a class can be the variable of a start law.

#### The load ladder of events

The plan `alerts-start-event` starts alerts at 11 rungs of the rate of new events from the fake of its feeds (CAP-66). The watch after ready holds the load, and the law of `watchCores` gives the CPU time of one event.

| Part | The value | Why |
| --- | --- | --- |
| The rungs | `event`: 0, 1, 3, 10, 30, 40, 45, 50, 55, 60 and 70 events each second. Each event has 2000 B. `update` is 0. | The rungs cover the class `event` of the contract to the first limit. The rung 0 gives the cores of an idle app. |
| The base point | 16 MiB of log, 10 feeds, 10 persons and 10 incidents | These are the base levels of the ladders of the levels. |
| The watch | 180 s | Alerts polls its feeds. A long watch holds many polls, thus the CPU time over the watch is near its mean. |
| The measures | `watchCores`, `watchPeak`, `watchHeapPeak` and `ready` | The slope of `watchCores` over the rate is the CPU seconds of one event. Its intercept is the cores of the idle app. |

- The fake of the feeds gives the events of each class at a constant rate, from the first request of the app.
- The fakes run in a sidecar on the other CPUs. Thus the CPU time of the fakes is not in `watchCores`.
- The plan `alerts-start-update` gives the ladder of the class `update` (CAP-35). The laws of the alerts come with CAP-36.

The first run of the plan is [Lab run 45247869988](https://github.com/metrograph-labs/capacity/actions/runs/45247869988), with 5 jobs. Each value is the median of 10 readings, from the 2 arms of each job.

| Events each second | `watchCores` | The live heap | `watchHeapPeak` | `watchPeak` | The GC time in the watch |
| --- | --- | --- | --- | --- | --- |
| 0 | 0.018 | 172 MiB | 199 MiB | 385 MiB | 141 ms |
| 1 | 0.026 | 185 MiB | 241 MiB | 396 MiB | 169 ms |
| 3 | 0.034 | 189 MiB | 251 MiB | 424 MiB | 274 ms |
| 10 | 0.074 | 229 MiB | 362 MiB | 578 MiB | 864 ms |
| 30 | 0.225 | 318 MiB | 428 MiB | 754 MiB | 4481 ms |
| 100 | No reading | No reading | No reading | No reading | No reading |

- The cores increase linearly with the rate. One event costs approximately 7 ms of CPU time.
- The live heap and the GC time increase with the rate. At 100 events each second, each of the 10 starts reached the heap limit of V8 (556 MB).
- Thus the heap limit is the first resource that binds, at a rate from 30 to 100 events each second.
- The jobs are on 3 CPU models. A law needs 5 jobs and 40 points on one CPU model, thus this run gives no law.

The second run is the Lab run [45351701555](https://github.com/metrograph-labs/capacity/actions/runs/45351701555), with 15 jobs. The run [45382785749](https://github.com/metrograph-labs/capacity/actions/runs/45382785749) of `laws.yml` fits the laws over the two runs (CAP-36).

- The 15 jobs on the Intel Xeon 6975P-C give 4 laws, with 75 points from 0 to 30 events each second. The other CPU models have too few jobs.
- Each law is of the arm `main` at the first start. The intervals are 95 % intervals over whole jobs.

| The measure | The law | The limit that it reaches |
| --- | --- | --- |
| `watchCores` | A line: 0.0130 [0.0090, 0.0162] cores, and 5.46 ms [4.62, 6.61] of CPU time for each event | 1 core at 181 [150, 213] events each second |
| `watchHeapPeak` | A hinge: 207.1 MB, and 20.4 MB for each event each second to the bend at 6.2 [0.5, 7.4] events each second. After the bend, 4.9 MB. | The heap limit of V8 at 52 [42, 59] events each second |
| `watchPeak` | A line: 412.0 MB [407.6, 416.5], and 12.41 MB [12.06, 12.81] for each event each second | The memory limit of the target at 48 [47, 50] events each second |
| `ready` | A constant: 5.15 s [4.98, 5.34] | None. The rate of events does not change the time to ready. |

- The memory binds first, not the CPU. At 48 events each second, the law of the cores gives 0.28 cores of the 2 CPUs of the target.
- The two limits of the memory are at 48 and 52 events each second, and their intervals overlap. Thus the lab cannot tell which limit comes first.
- The two reaches are outside the range of the fit. The failures at 100 events each second agree with them: each child reached the heap limit of V8.
- CAP-86 replaces the rung 100 with the rungs 40, 45, 50, 55, 60 and 70. The rungs near 48 and 52 tell which limit comes first.
- The plan then has 5 jobs of 263 minutes. The fit pools the new runs with the two runs above, because each record holds its own case.
- At 30 events each second, two jobs give 0.31 and 0.33 cores, two times the median of 0.155. The line still has the smallest error on the held-out jobs.
- The rule `floor` with the share 1 gives the knees in events each second:
  - `watchCores` at 2.4 [1.4, 3.5]
  - `watchHeapPeak` at 23.0 [19.2, 25.4]
  - `watchPeak` at 33.2 [32.0, 34.3].
- The CPU time of one event is less than the 7 ms of the first run. That value was a median over 3 CPU models.

#### The load ladder of updates

The plan `alerts-start-update` starts alerts at 6 rungs of the rate of updates from the fake of its feeds (CAP-35). An update is a new version of a live alert. The law of `watchCores` gives the CPU time of one update.

| Part | The value | Why |
| --- | --- | --- |
| The rungs | `update`: 0, 1, 3, 10, 30 and 100 updates each second. Each update has 2000 B. | The rungs cover the range of the class `update` of the contract, from 0 to 100 each second. The rung 0 gives the cores with no update. |
| The new events | `event` is 1 at each rung. Each event has 2000 B. | The fake of the feeds skips an update when no alert is live. Each live alert comes from an event, thus the ladder needs events. |
| The base point | 16 MiB of log, 10 feeds, 10 persons and 10 incidents | These are the base levels of the ladders of the levels. |
| The watch | 180 s | This is the watch of the ladder of events. A long watch holds many polls, thus the CPU time over the watch is near its mean. |
| The measures | `watchCores`, `watchPeak`, `watchHeapPeak` and `ready` | The slope of `watchCores` over the rate is the CPU seconds of one update. Its intercept is the cores at 1 event each second. |

- The rung `update-0` is the rung `event-1` of the ladder of events. The two ladders meet at this point, thus their readings there must agree.
- The rate of events is constant, thus the law over the rate of updates holds no effect of the events.
- Each alert lives one hour. Thus the live alerts increase by 1 each second, and the seeded random of the fake picks the alert of each update.
- The first event comes 1 s after the first request of the app. The fake skips the updates before it, thus less than 1 s of updates.
- The plan has 5 jobs of 162 minutes.

The first run of the plan is [Lab run 45362275890](https://github.com/metrograph-labs/capacity/actions/runs/45362275890), with 5 jobs. Each value is the median of 10 readings, from the 2 arms of each job. No start failed.

| Updates each second | `watchCores` | The live heap | `watchHeapPeak` | `watchPeak` | The GC time in the watch |
| --- | --- | --- | --- | --- | --- |
| 0 | 0.023 | 185 MiB | 233 MiB | 401 MiB | 197 ms |
| 1 | 0.020 | 179 MiB | 221 MiB | 396 MiB | 129 ms |
| 3 | 0.021 | 183 MiB | 224 MiB | 394 MiB | 164 ms |
| 10 | 0.022 | 179 MiB | 224 MiB | 395 MiB | 169 ms |
| 30 | 0.021 | 183 MiB | 225 MiB | 398 MiB | 162 ms |
| 100 | 0.022 | 183 MiB | 239 MiB | 399 MiB | 169 ms |

- The cores do not increase with the rate of updates. The slope of the least squares line is 0.002 ms of CPU time for each update.
- The cause is in the fake and in the app. Each answer of the fake has only the last version of each live alert. Alerts polls its feeds.
- Thus all the updates of an alert between two polls give one change of that alert. The rate of updates does not set the work of a poll.
- The rung `update-0` agrees with the rung `event-1` of the ladder of events. The cores are 0.023 and 0.026, and `watchPeak` is 401 and 396 MiB.
- The jobs are on 3 CPU models: 3 Xeon 6975P-C, 1 Xeon 6973P-C and 1 EPYC 7763. CAP-36 adds runs and fits the laws.

#### The ladders of the levels and of the log

The plans `alerts-start-feeds`, `alerts-start-persons` and `alerts-start-incidents` start alerts from its contract at 9 rungs of one level (CAP-35). The plan `alerts-start-log` starts it at 9 rungs of its log (CAP-62). Each plan has one app case with one arm, and a start law set of its variable.

| Part | The value | Why |
| --- | --- | --- |
| The rungs | `feeds` and `persons`: 1, 3, 10, 30, 100, 300, 1000, 3000 and 10000. `incidents`: 0, 10, 100, 200, 300, 400, 600, 800 and 1000. `log`: 2, 4, 8, 16, 32, 64, 128 and 256 MiB, and the point `log-max` at 400,000,000 B. | The rungs cover the range of the contract, on the scale of the variable. 9 rungs in each of 5 jobs give 45 points, and a law needs 40. |
| The base point | 16 MiB of log, 10 feeds, 10 persons and 10 incidents | Each ladder holds the other levels at the base point. The three ladders meet at it, thus their readings there must agree. |
| The arm | One arm: alerts at the commit of its levels, with its A/A copy | A ladder gives a law, not a comparison. The A/A copy gives the noise floor of each measure. |
| The limit | 240 s for each start | A start at the base is ready in approximately 6 s. A start that passes the limit has no reading, and the result tells it. |
| The measures | `ready`, `peak`, `heap`, `heapPeak` and `watchPeak` | The time to ready and the memory of a start are inputs of the scale rule. `heapPeak` gives the reach of each level to the heap limit of V8. |

- The target is the target of the plan `alerts-start-app`.
- A start law set refuses a case with points that move a second variable. Otherwise a law of one variable also holds the effect of another variable.
- The routes of alerts are the persons times the incidents and the system incidents. The ladders move one level at a time. Thus their laws do not give the interaction of the two levels (CAP-67).
- The plans have no trigger: a person starts them. The time limit of each plan is 151 minutes.
- The contract accepts a log from 2,000,000 B to 400,000,000 B. Thus the log ladder stops at 400,000,000 B, and not at 512 MiB as the old plan `alerts-start`.
- The jobs of one run can land on more than one CPU model. A law needs 5 jobs on one CPU model. Thus a ladder can need a second run of the same plan.

#### The start gate of alerts

The plan `alerts-start-gate` gives the limits of the start of alerts (CAP-49). The CI gate of alerts reads the limits file.

| Part | The value | Why |
| --- | --- | --- |
| The arm | One arm `main`: alerts main at one commit, with its A/A copy | The gate holds the start of the current build. The A/A copy adds readings of the same build. |
| The points | `live-1844` at 197,156,864 B of log, and `knee-192` at 192 MiB of log. Each point has 10 feeds, 10 persons and 10 incidents. | `live-1844` is the log of the live store when its starts stopped. `knee-192` is the knee of `ready` over the log. |
| The target | The 1 GB target of the plan `alerts-start-app` | This is the machine of the observations. |
| The rounds | 3 rounds, in 5 jobs | Each job starts 12 children. The time limit of each job is 119 minutes. |

`startLimitsOf(plan, jobs)` gives the limits from the jobs of 5 or more CI runs. Each job is one run. The command writes them:

```sh
gh run download <run> -R metrograph-labs/capacity -D runs
node src/start-limits.main.ts limits --runs runs --out ../capacity/limits/alerts-start-gate.limits.json
```

- **The value of a run.** At a point, it is the largest reading of `main` and `main~aa`, over the rounds of the run.
- **The limit.** It is `runLimit` of `@mark1russell7/rigor-bench`: the worst value of the runs plus their spread, rounded up to a whole unit.
- **The refusals.** The command refuses fewer than 5 runs, a record of another version of the case, and a record with a problem.
- **No start that does not fit.** The command refuses a run with a child that passed a limit of the target. A gate holds a start that fits.
- **The time.** The limit of the time uses `readiness`, and not `ready`. The ready probe of a live start measures from the start of the process.

The limits file has the format `capacity-start-limits/1`. `readStartLimits` reads it.

| Field | What it is |
| --- | --- |
| `format` | `capacity-start-limits/1` |
| `plan`, `case` | The plan and its start case |
| `subject`, `app` | The id of the contract of the app, and the URL of its repository |
| `arm`, `commit`, `seeder` | The arm of the values, the commit of the arm, and the commit of the seed |
| `target` | The target of the case: the image, the memory, the swap, the CPUs and the heap limit |
| `runs` | The runs, in the order of the values. Each run has its `id` (`<CI run>/<job>/<attempt>`), `url`, `job`, `attempt` and `cpu`. |
| `measures` | The measures of the limits: `start.live` and `start.peak` in B, and `start.readiness` in ms. Each one has its reading and its title. |
| `points` | One entry for each point: its `id`, its amounts `at`, its `limits` and its `derivations` |
| `points[].limits` | A limit set of the format `capacity-limits/1`, with the id `<case>/<point>`. Each limit has an amount ceiling and the headroom 0. |
| `points[].derivations` | The result of `runLimit` for each measure: `limit`, `worst`, `spread`, the `values` of the runs, and the `unit` |

A gate reads `points[].limits` with `readLimits` of `@mark1russell7/capacity`. A start passes when each measure is at its ceiling or below it.

### The machine model

A start case can also model the disk, the page cache and the other processes of the target machine. With none of them, a child has the fast disk of the host of the lab.

- **The disk.** `target.disk` gives the limits of each child each second: `readBytes`, `readOps`, `writeBytes` and `writeOps`. Its `source` tells where the numbers come from.
  - The lab finds the disk of the work folder, of the data of Docker and of each swap file of the host.
  - The container of each child gets the limits on each of these disks, through `io.max` of cgroup v2.
- **The page cache.** With `cache: "cold"`, the lab copies the store to a home on the host before each child. Then it drops the page cache of the host.
  - The child opens the home in place with `--home`. Thus the open reads the store from the disk.
  - With `warm`, the default, the child copies the store in its container.
- **The other processes.** `target.others` gives the other processes of the target. The `ballast` of an arm gives the steps of its live start that the app does not run, for example a bundler.
  - Each ballast is a process in the container of the child, with `bytes` of resident memory, from the moment `start` or `ready`.
  - Its field `models` tells what it models.
- **A second start.** A point with `after` names an earlier point with the same amounts.
  - Before the children of the point, each arm does one first start on its copy of the home of the earlier point. A first start has no limits of the disk and no ballasts, and it runs to the end of its watch.
  - Each child of the point then opens a copy of the home of its arm.
  - The record keeps each first start: its time, its passes and the size of each file of the home.
- **The samples.** With `samples`, a child reads its own reads from the disk, its major faults and its resident set at each interval. It also reads the memory, the swap and the reads of its container.
  - A worker thread takes the samples. Thus the samples continue while the open blocks the main thread.

| Measure | What it is |
| --- | --- |
| `ready` | The time to the ready signal of the app. |
| `readiness` | The time from the start of the process to the end of the open, less the copy and the ballasts. The ready probe passes after this point. |
| `firstPass` | The time from the end of the open to ready. The program `app-start` gives null, because it does not time the first pass. |
| `copy`, `close`, `end` | The time of the copy of the store, the time of the close, and the time from the start of the process to the line. |
| `ballast` | The time to start the ballasts of the moment `start`. |
| `read`, `faults` | The bytes that the child read from the disk and its count of major page faults, from the start of the process to ready. |
| `peak` | VmHWM at ready: the peak of the resident set of the start. |
| `rss`, `anon`, `file`, `heap`, `external` | The memory at ready. `anon` and `file` are `null` on a machine with no `/proc`. |
| `live` | The used heap after a full GC at ready. |
| `heapPeak`, `livePeak`, `gc`, `fullGc` | The peaks of the used heap and of the live heap over the start, its GC time and its count of full GC events, from the GC profiler. |
| `watchPeak`, `watchRss`, `watchAnon`, `watchHeap` | The peaks of the memory over the watch. |
| `watchHeapPeak`, `watchLive`, `watchGc` | The heap peaks and the GC time of the watch, from the GC profiler. |
| `watchCpu`, `watchCores` | The CPU time of the process over the watch, and that time over the time of the watch. Only the program `app-start` gives them. |
| `passes` | The count of passes in the watch. |
| `limit` | The heap size limit of V8 in the child. |
| `writes`, `writeLongest` | The count of the writes of the snapshot, and the longest block of the event loop in one write. |
| `writeStore`, `writeRows`, `writeWall`, `writeCpu` | The longest time of one write: the store, the build of the rows, the wall time and the CPU time. |

- **A start that does not fit.** A child that passes a limit of the target is a failure of its arm on its point, with a kind. The kind `time` is the time limit of the child. The kind `memory` is the memory limit of the container. The kind `heap` is the heap limit of V8. A failure has no reading, and the other arms still start.
- **The ready windows.** `windowReads` gives the read of each child in each window. A child with a reading is `ready` when its readiness and one probe interval are in the window. Else it is `late`.
- **A failure in a window.** A child over the time limit is `late` in a window when the window and its late margin are in the limit of the child. The late margin is the start of the container, the longest copy of the point and the longest time of a child after its open. Each other failure has `no read`.
- **The observations.** `observationReads` compares each fact of the target machine with the reads of the children of its arm and its A/A copy. A disagreement is a problem: the lab does not model the time of the machine. A fact with a child of `no read` is a problem too.
- **A stalled loop.** A pass can give a wake time that is not after the pass. Then the watch has no more passes. The reading records `stalled`, and the summary tells it.
- **The problems of a record.** `startRecordProblems` examines each start record. Each reading has each needed measure. Each arm and the A/A pair have a child of each point in each round: a reading, a failure or a skip. Each observation agrees with the record.
- **The time of a job.** `startWindowOf` gives the longest time of one job. It is `IMAGE_MARGIN` for each of the 3 steps of the image, `TREE_MARGIN` for each tree, and the seeds at `SEED_RATE`. A point with `after` has no seed. Each child and each first start adds its limit, the watch and `CHILD_MARGIN`.

The container does not model all of the target machine:

- With no machine model, it does not have the other load of the target. That load is its other processes, the traffic of its swap and its waits on the disk.
- A limit of the disk models the rate and the count of the reads. It does not model the delay of each read.
- A read of SQLite with `pread` gives no major fault. Thus the count of major faults is not the count of the reads on the disk.
- The CPUs of the host of the lab are not the CPUs of the target. Thus a time of the lab is a time on the CPU of the record.
- The page cache of the store counts in the memory of the container. The kernel takes back clean cache first.

Two plans measure the start of alerts at the knee of the cloud log, from the contract of alerts. Each one has no check and no trigger.

- `alerts-start-bytes-mean` and `alerts-start-bytes-peak` measure the knee of the cloud log on the model of the cloud machine. The model has a cold cache, the other processes and the disk of the machine.
  - The point `cut-1030` is the log at the last start that was ready in 90 s. A count of the events of the cloud log gives its size.
  - The point `file-1844` is the log when the starts stopped at 90 s. The two points are 3% apart. The point `file-1844-again` is a second start after `file-1844`.
  - The disk has the mean rate or the peak rate of a study of the cloud start. The cap of the operations is the byte rate divided by 4 KiB. Thus the byte rate binds, and not the count of the operations.
  - A live start of the cloud machine read at 3.2 MiB/s or more. Its disk gives a mean of 11.2 KiB and 15.9 ms for each read. The lab does not model that delay.
  - The one arm is alerts at `caf260b`. Its contract names the lines `pass` and `write`, thus each child gives its passes and the times of each write of the snapshot.
  - Before CAP-65, the plans had the start subject `alerts` and the arm `cloud`, the build of the cloud machine. That build has no contract. Its results and its two facts of the machine are in the section below.

The plan `alerts-start-app` starts alerts from its contract, on the commit of the seeder.

- The case `alerts-start-app/contract` starts alerts from `capacity-app.json`. It seeds with the seed `al124` and the cache sizes of one live copy.
- The two arms are the same build. The arm `deploy` adds the ballast of the deploy process at ready.
- The contract of alerts names the passes and the writes of the snapshot from `caf260b` (CAP-65). The bytes plans use that commit. Then CAP-65 removed the start subject `alerts` and its programs.

#### The results of the plans of the start of alerts

The Actions artifacts of these runs expire in February 2027. Thus this section keeps their results. The machine of the observations is a small cloud machine with 2 CPUs, 964.6 MiB of memory and 2 GiB of swap.

An observation is a fact of the machine, for example "the cloud build was not ready in 90 s at `file-1844`". A job exits 1 when the lab reads a window of an observation differently from the machine. CAP-62 retired the plans `alerts-start-files`, `alerts-start-horizon`, `alerts-start-disk-mean` and `alerts-start-disk-peak`. The plan `alerts-start-log` replaced the plan `alerts-start`.

- **`alerts-start`** (retired, the runs [44941391218](https://github.com/metrograph-labs/capacity/actions/runs/44941391218) and [44945165388](https://github.com/metrograph-labs/capacity/actions/runs/44945165388)):
  - Each of the 90 children is ready in each window, but each job exits 1 on one observation.
  - The median `ready` of `cloud` is 4.89 s at 16 MiB, 9.59 s at 256 MiB and 24.12 s at 512 MiB.
  - At 512 MiB, `cloud` has a `peak` of 607.2 to 622.5 MiB and a `heapPeak` of 470.3 to 473.8 MiB.
  - At the point `cloud`, `cloud` and `cloud~aa` have a `readiness` of 2.53 to 4.96 s, and the machine is not ready in 90 s.
- **`alerts-start-files`** (retired, the same runs):
  - Each of the 135 children is ready in 90 s, but each job exits 1 on one observation.
  - With the arm `cloud`, shapes files of 0, 44.2 and 88.4 MiB give a median `peak` of 274.6, 449.7 and 588.9 MiB.
  - At the knee, the median `ready` of `cloud` is 7.66 s at `cut-1030` and 7.81 s at `file-1844`.
  - At `file-1844`, `cloud` and `cloud~aa` have a `readiness` of 2.87 to 6.05 s, and the machine is not ready in 90 s.
- **`alerts-start-horizon`** (retired, the run [44943060999](https://github.com/metrograph-labs/capacity/actions/runs/44943060999)):
  - Each of the 120 children is ready in 90 s, but each job exits 1 on one observation.
  - At `cut-1030`, the median `ready` is 12.78 s for `horizon`, 7.40 s for `new` and 7.07 s for `cloud`.
  - At `cut-1030`, the median `live` heap is 200.8 MiB for `horizon`, 280.7 MiB for `new` and 329.2 MiB for `cloud`.
  - At `file-1844`, `cloud` and `cloud~aa` have a `readiness` of 2.70 to 4.88 s, and the machine is not ready in 90 s.
- **`alerts-start-disk-mean`** (retired, the run [44955644597](https://github.com/metrograph-labs/capacity/actions/runs/44955644597)):
  - The disk had 5.5 MiB/s and 100 operations each second. Each of the 60 children of the jobs 1 to 4 passed its time limit of 660 s.
  - Thus the plan has no reading, and the two observations of the knee have no read. Each job exits 1.
  - Job 5 has no record, because the drop of the page cache took more than 60 s.
  - A first start of each arm, with no limits of the disk and no ballasts, takes 127.4 to 139.9 s.
- **`alerts-start-disk-peak`** (retired, the same run):
  - The disk had 14 MiB/s and 200 operations each second. 73 of 75 children give a reading, and each is late in the windows of 90 s and 308.012 s.
  - At `cut-1030`, the `readiness` of `cloud` is 416.3 to 461.6 s, and that of the other three arms is 473.0 to 501.6 s.
  - At `file-1844-again`, the snapshot arms `checkpoint` and `snapshot` have a `readiness` of 421.6 to 422.7 s, and `full` has 496.1 to 510.6 s.
  - Each job exits 1: at `cut-1030`, `cloud` and `cloud~aa` are late, and the machine is ready in 90 s. Thus the cap of the operations made the disk of the lab too slow. The bytes plans replace it.
- **`alerts-start-bytes-mean`** (with the start subject `alerts`, the run [45001158462](https://github.com/metrograph-labs/capacity/actions/runs/45001158462)):
  - Each child is ready in 90 s, but the machine is not ready at `file-1844`. Thus each job exits 1.
  - At `cut-1030` and `file-1844`, the `readiness` of `cloud` and `cloud~aa` is 62.2 to 67.1 s, and that of `main` is 72.6 to 77.9 s.
  - There, each child of `main` writes one snapshot, and the longest block of one write is 406.6 to 515.1 ms.
  - At `file-1844-again`, the `readiness` of `main` is 60.3 to 60.7 s, and its `firstPass` is at most 0.13 s.
- **`alerts-start-bytes-peak`** (the same run):
  - Each child is ready in 90 s, but the machine is not ready at `file-1844`. Thus each job exits 1.
  - At `cut-1030` and `file-1844`, the `readiness` of `cloud` and `cloud~aa` is 25.5 to 36.6 s, and that of `main` is 28.9 to 39.7 s.
  - There, each child of `main` writes one snapshot, and the longest block of one write is 170.6 to 823.4 ms.
  - At `file-1844-again`, the `readiness` of `main` is 23.9 to 25.5 s, and its `firstPass` is at most 0.14 s.
- **`alerts-start-app`** (the run [45044576905](https://github.com/metrograph-labs/capacity/actions/runs/45044576905)), with the case `alerts-start-app/subject` that CAP-62 deleted:
  - The plan passes, and each of the 90 children of the two cases is ready in 90 s.
  - The case `alerts-start-app/subject` started the same commit and the same store with the start subject of the lab.
  - The medians of `peak` and `live` of the two cases differ by at most 7.8 MiB and 0.4 MiB.

| Point | The median `ready` from the contract | The median `ready` from the subject | The two ranges |
| --- | --- | --- | --- |
| `log-16` | 5.68 s | 5.29 s | 4.46 to 7.33 s and 4.05 to 7.13 s |
| `cut-1030` | 11.72 s | 13.18 s | 9.11 to 15.05 s and 8.76 to 15.83 s |
| `log-256` | 17.06 s | 17.26 s | 11.46 to 19.04 s and 12.44 to 19.37 s |

At each point, the ranges of the two cases overlap. At `cut-1030`, the ratio of the medians is 0.89. That is a little below the lowest A/A ratios of the two cases, 0.93 and 0.91. The lab made no statistical test. The ranges and the memory agree, thus the contract case replaces the subject case.

- **The ladders of the levels and of the log** (the runs [45060628731](https://github.com/metrograph-labs/capacity/actions/runs/45060628731) and [45072989987](https://github.com/metrograph-labs/capacity/actions/runs/45072989987) of the levels, [45073979241](https://github.com/metrograph-labs/capacity/actions/runs/45073979241) and [45080303535](https://github.com/metrograph-labs/capacity/actions/runs/45080303535) of the log, and the run [45087929821](https://github.com/metrograph-labs/capacity/actions/runs/45087929821) of `laws.yml`):
  - Each child of the 35 jobs is ready at each rung, except at 10000 persons. There, each child reached the heap limit of V8.
  - The jobs on the Xeon 6975P-C give 20 laws, 5 measures for each ladder. The jobs on the EPYC 7763 are too few for a law.
  - The knee is the load where the law is two times its floor, by the rule `floor` with the share 1. The intervals are 95 % intervals over whole jobs.

| Ladder | The law of `ready` | The knee of `ready` | The law of `heapPeak` | The first limit of the target |
| --- | --- | --- | --- | --- |
| `persons` | A power law with the exponent 1.15 [0.98, 1.34]. 21.7 s at 3000 persons. | 1045 [813, 1245] persons | 212.6 MB and 71,180 B for each person | The heap limit at 4828 [4646, 5063] persons |
| `feeds` | A power law with the exponent 2.25 [2.17, 2.33]. 72.8 s at 10000 feeds. | 3186 [3023, 3347] feeds | 215.9 MB and 21,320 B for each feed | None up to 10000 feeds |
| `incidents` | A line with 1.23 ms [0.57, 1.89] for each incident. 6.7 s at 1000 incidents. | None up to 1000 incidents | A hinge, 243 MiB at 1000 incidents | None up to 1000 incidents |
| `log` | A hinge with its bend at 183 MiB [85, 189]. 21.0 s at the largest log. | 192 [158, 201] MiB | A hinge, 302 MiB at the largest log | None up to 400,000,000 B |

- The reach of `persons` is outside the range of its fit, 1 to 3000 persons. The failures at 10000 persons agree with it: the law gives 882 MiB there.
- After the heap limit, the memory limit of the target comes next. The law of `watchPeak` reaches it at 6304 [5828, 6876] persons.
- Thus at the base point of the other levels, one instance of alerts on the target starts with at most approximately 4800 persons.
- The rung of 10000 feeds sets the exponent of `feeds`. A fit without that rung does not predict the cliff: its held-out residuals are near 1.4.
- The ladders move one level at a time. The laws of two levels together come with CAP-67.

A person starts a plan by hand, for example with 5 runs:

```sh
gh workflow run lab.yml -R metrograph-labs/capacity --ref <branch> -f plans=alerts-start-log -f runs='[1,2,3,4,5]'
```

### The laws of the start cases

The field `startLaws` of a plan tells the laws that its start records give. `startLawsOf(plan, jobs, options)` fits them.

| Field | What it is |
| --- | --- |
| `variable` | A variable of the subject, for example `log` in MiB. The size of its file in the seeded store of a point is the value of the variable. |
| `measures` | The measures of the readings that get a law, each with its law slug, its title, its residual, its forms and its knee rule. |
| `conditions` | The facts that the records do not hold. A name of `START_CONDITIONS` comes from the records. |

- Each CPU model gets one law for each arm, each kind of start and each measure. The id of a law is `<subject>/<plan>/<cpu>/<arm>/<start>/<law>`.
- A point with the field `after` is a second start. Its laws have the start `second`, and the other laws have the start `first`.
- The conditions hold the image, the seeder, the commit and a hash of the arm and of the target. Thus a law of one build does not mix with a law of another build.
- The A/A pairs of the base on the CPU model and the kind of start give the noise floor of each measure.
- A start that passed a limit of the target has no reading. The result tells it in `skipped`.
- A plan has a law set or a start law set, not the two. A plan with a start law set has only start cases.

The command `fit` of `laws.main.ts` fits the start laws of each plan with a start law set.

## The request classes

A request class is the work that one request asks of a synthetic subject. Each field is one load variable, thus a law can move one variable alone.

| Field | Unit | What the subject does |
| --- | --- | --- |
| `body` | `B` | It reads a request body of this size. |
| `alloc` | `B` | It allocates this memory in small arrays, and it drops them. |
| `work` | `us` | It uses the CPU on the main thread for this CPU time of the process. The event loop does not turn. |
| `wait` | `ms` | It waits this time on a timer, with no CPU time. The request stays in flight. |
| `reply` | `B` | It sends a reply body of this size. |

Each field is a whole number, 0 or more. `UNITS` gives the unit of each field, and `LIMITS` gives its largest value. Each unit is the resolution of its mechanism: the CPU clock of a thread, and a timer of Node.

The other load variables are not in a class:

- The request rate and the concurrency come from the schedule of the driver.
- The live heap comes from the flag `--ballast` of a subject.
- The process age is the length of the run.

### The path of a class

A request names its class in its path. The path names each field that is not 0, thus `/` is the class that asks no work.

```ts
import { EMPTY, classOf, pathOf, requestOf } from "@capacity/lab";

pathOf({ ...EMPTY, work: 500, reply: 1024 }); // "/?work=500&reply=1024"
classOf("/?work=500&reply=1024"); // { body: 0, alloc: 0, work: 500, wait: 0, reply: 1024 }
requestOf({ ...EMPTY, reply: 1024 }, "subject:8080"); // "GET /?reply=1024 HTTP/1.1\r\nhost: subject:8080\r\n\r\n"
```

`requestOf` gives the whole HTTP/1.1 request, with its head and its body. The open-loop driver of `@mark1russell7/harness` sends such texts. A class with a body is a `POST`.

### The work of a request

The file `src/subject/perform.ts` does the work of a class, with no transport. Each synthetic subject uses this file. Thus a difference between two subjects is the cost of the transport and of the layer.

- `work` is CPU time, not time on a clock. A CPU limit that stops the container makes the work longer, and it does not make the work smaller.
- `work` is pieces of a small calculation, with one read of the CPU clock between two pieces. The speed of a piece gives the size of the next piece. Thus the work is user time, and it ends no more than one small piece after its time.
- A test holds the CPU clock on Linux: it moves in steps of 50 microseconds or less. A second test holds the work: no more than 5 % above its time.
- `alloc` allocates pieces of 8 KiB. A piece of this size stays in the young generation of the heap.
- `reply` is a part of one buffer that grows to the largest reply. Thus a reply allocates no memory for its bytes.

## The bare subject

`NODE_HTTP` is the bare subject of layer 1, as data: a server of `node:http` on the stock image of Node. The server has no framework and no runner, because it is the base that each other layer compares with.

| Field | What it is |
| --- | --- |
| `name` | The id of the subject in a law and in a record: `node-http`. |
| `image` | The stock image, pinned by its digest. It is the Node image of the lab clients of the harness. |
| `files` | The files of the subject, in `src/subject`. |
| `program` | The file that Node starts: `node-http.main.ts`. |
| `ready` | The text of the line that tells that the subject serves. |

`subjectFiles(NODE_HTTP)` gives the path of each file in the container, and its content. The files go into the container before it starts, thus the image stays stock. The files import only Node and each other, and Node starts the TypeScript source with no build.

### The program

```text
node node-http.main.ts --port N [--ballast BYTES] [--keep-alive-timeout MS]
```

The server is at the defaults of Node, and each flag sets one value over them.

| Flag | What it sets |
| --- | --- |
| `--port` | The port of the listener. With 0, the system gives a free port. |
| `--ballast` | The live heap of the process, in bytes: small objects that stay for its life. |
| `--keep-alive-timeout` | The time that Node keeps an idle connection, in ms. 0 keeps each connection. |

The default keep-alive time of Node is 5000 ms. It closes the connection of a stream that sends less than one request in 5 seconds.

`--ballast` is a setting, not a reading. The used heap of V8 also has garbage, thus the live heap of a run is a reading of the heap (CAP-13).

The server answers 200 with the reply of the class. It answers 400 for a path that is not a class, and for a body of a different size. Thus a request that did not do its work is a failure that the driver counts.

The program writes JSON lines on its standard output. Each line has `ev` and `t`, the time in nanoseconds on `CLOCK_MONOTONIC`.

| Line | When | More fields |
| --- | --- | --- |
| `listening` | The server serves. | `port`, `node`, `pid`, `keepAliveTimeout`, `ballast` (the bytes of the flag), `objects` (the count of the objects of the ballast), `heap` (the used heap in bytes) |
| `stopping` | At SIGTERM or SIGINT. The program closes its listener and each connection, and it ends. | `signal` |
| `fail` | The command line has a problem. The exit code is 1. | `why` |

### What the subject does not have

The subject has no instrument. The CPU time, the memory and the network bytes of a run come from the container (CAP-11). The event-loop lag and the readings of the heap come later from their homes, as a preload of Node (CAP-12 and CAP-13). Thus each subject of each layer has the same instruments, and the subject stays bare.

## The service subject

The subject `node-http-service` (`NODE_HTTP_SERVICE`) is layer 2: the work of the bare subject through the service runner of `@mark1russell7/service` (CAP-29). The two subjects do the same work for each class. Thus the difference of their measures is the cost of the runner.

- **The same work.** The server of `node:http` is a transport of the service (`httpTransport`). Each request of a class goes through `handle`, thus the service admits it, counts it and can cut it. The work is `perform`, as in the bare subject.
- **The same reply.** The reply has the bytes of the reply of the bare subject. The service adds one header: `content-type: application/octet-stream`. That header is a cost of the runner, thus the network bytes show it.
- **A pod.** The declaration is a pod at the defaults of Kubernetes, with no dependency and no check. Its probes answer on the same port, after `/health`. A check and its loop are a cost of their own (CAP-30).
- **The same program.** The program `node-http-service.main.ts` has the flags and the lines of the bare subject. The line `listening` comes at the end of the startup of the service, and it also gives `state`.
- **The signals.** The service owns SIGTERM and SIGINT. The program writes `stopping`, and the service drains and closes in the phases of its declaration.
- **Other answers.** A path that is not a class gets 404, and a body of a different size gets 500. The driver counts each as a failure, as it does for the 400 of the bare subject.

### The packages

The service subject starts as an app of this repository starts. Node starts its own files from TypeScript, and its packages are JavaScript in `node_modules`.

- The stock image of Node has no packages. Thus `esbuild` bundles each export of `packages` with the packages that it imports (`packageFiles`). The modules go into `node_modules`, with a `package.json` for each package.
- The two subjects start their own files through the TypeScript loader of Node. Thus the cost of the loader is the same on the two sides of a pair, and the difference is the cost of the runner.
- The modules keep each module of the imports (`treeShaking: false`), as Node loads an installed package. Thus the code in memory is the code of the program and its packages.
- The version of each package comes from the lockfile of this repository. Thus a change of the runner is a change of the lockfile, and the lab runs again.
- The lab makes the modules one time in a process, in approximately 0.1 to 0.3 s.

The first run of the plan `overhead` started the service subject as one bundle. That bundle started with no TypeScript loader. Thus the bare side had approximately 7 MiB more memory at 100 requests each second. The loader of Node holds approximately 3.5 MiB of heap and 3.6 MiB of external memory.

The second run (45061643369) started the two sides through the loader. Its 5 jobs are values of one run, not laws:

- The memory overhead was 1.0 to 1.4 MiB at 100 requests each second, and 7.8 to 15.5 MiB at the other rates.
- The median CPU overhead was 109 to 174 µs for each request. The bare side used 37 to 418 µs for each request.
- On 3 of the 5 machines, the median latency overhead stayed below 2.2 ms up to 8000 requests each second. On the 2 slower machines, it was more than 10 ms from 3000 or 4000 requests each second.

The fourth run (45066776472) gave 7 more jobs at the same commit of the subjects. The Laws run 45069050798 fits the laws of the overhead from the runs 2, 3 and 4. Nine of their jobs were on the Intel Xeon 6975P-C. The README of the package `capacity` gives the laws and the compositions of layer 2. On that CPU model, the runner uses approximately 1.5 to 2 times the CPU of the bare server from 1000 requests each second.
