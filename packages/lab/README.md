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

- **The variables of a request** are the fields of a request class. Each amount converts to the unit of its field, and it is a whole number in that unit. Thus `0.5 ms` of `work` is `500 us`. A field that the request does not name is 0. `requestClassOf` gives the request class.
- **The levels of a demand** are the amounts that the subject holds. The level `heap` is the live heap of the subject, in bytes: the flag `--ballast`. `caseLevel` gives a level in its unit.
- **The check.** `caseProblems` gives each problem of a case, with its path. It uses `instanceProblems` and `demandProblems` of `@mark1russell7/capacity`. Then it examines what the lab can do:
  - The lab limits the CPU and the memory of a container, and not the network. An instance with `network` is a problem.
  - The driver holds no open connection with no request. A level `connections` is a problem.
  - Each class has a rate above 0.
  - The connections are correct for `connectionsProblems` of `@mark1russell7/harness`: a pool has 1 to 1024 connections.
  - A case plans `MAX_ARRIVALS` (150000) arrivals or fewer in its runs and its warm-up run. `arrivalsOf` gives the arrivals of one run.
- **The connections of a class.** Each class is one stream of the driver, and the field `connections` of the case gives the connections of each stream. The driver sends each request at its planned time, and each latency counts from that time.
  - `pipeline` is the default: one connection, and the driver does not wait for a reply before the next request (HTTP pipelining). A request of a pipeline can come in one read with other requests. Thus its CPU cost can be less than the cost of a request of a real client.
  - `pool` keeps `size` connections, each with one request in flight. A due request with no idle connection waits for one. That wait is in its latency, and not in the lag of the driver. A real client sends one request at a time on each connection of a pool.
  - `fresh` opens a new connection for each request. CAP-28 measures that protocol.
- **The size of the raw result.** The raw result of a cell keeps approximately 2.3 KB for each arrival, most of it the records of the prober. One JSON text in Node has at most 512 MiB. Thus `MAX_ARRIVALS` keeps the raw result of a case near 340 MB or less. CAP-54 removes this limit for load cells.

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

## The timed runs

A timed run is one job of the workflow `lab.yml`: it measures one plan on one runner of GitHub. Only CI starts a timed run, because the lab needs Docker and a machine with no other load.

| Event | The plans |
| --- | --- |
| The schedule, each night at 06:22 UTC | Each plan with the trigger `schedule` |
| A pull request that changes the lab, the model, the lockfile or the workflow | Each plan with the trigger `pull_request` |
| A push of such a change to `main` | Each plan with the trigger `pull_request` |
| A dispatch by hand, with the input `plans` | The plans of the input. With no input, each plan with the trigger `pull_request`. |

The input `runs` of a dispatch is a JSON list of numbers. Each run of each plan is a job on its own runner, thus a limit can take the worst of many runners. For example, 5 runs of the plan `control`:

```sh
gh workflow run lab.yml -R mark1russell7/capacity --ref <branch> -f plans=control -f runs='[1,2,3,4,5]'
```

The workflow has three steps:

1. The job `plan` reads and examines each plan file. Then `selectPlans` gives the plans of the event, and `matrixOf` gives one job for each run of each plan. A plan with a problem, an unknown id and a selection with no plan stop the workflow.
2. Each job measures its plan with `timePlan`: each case with `measureCase`, and each start case with `measureStart`. Then the check of the plan gives the verdict (`verdictOf`), with the problems of each start record. A verdict with a problem fails the job. The summary of the job has the CPU model, each value of the check and each problem.
3. Each job uploads its folder as the artifact `lab-<plan>-<run>-<attempt>`.

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
- **The bootstrap draws jobs.** The plan fixes its rates, thus a rate is not a random unit. The independent unit is the job: one runner machine that measures each rate. Each run of the bootstrap draws whole jobs (`bootstrapGroups`). Thus each replicate has each rate, and its interval has the variation between the machines. The held-out fit holds out whole rates, because it ranks the shape of each form.
- **The served share.** A measure with the field `served` keeps only the points where the subject keeps up with the offered rate. The range of the law is the range of these points, and the law has the condition `served`.
- **The tail count.** A quantile measure with the field `tail` keeps only the points with enough arrivals for its quantile. The law has the condition `tail`.
- **The knee.** A measure with the field `knee` gives the knee of each law in its range, with `lawKnee` of `@mark1russell7/capacity`. A search that cannot apply gives a problem, and the law stays.

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
- **No law of the median.** The forms `power` and `fall-power` fit the median best. In each replicate, their exponent is 4: the end of the search of a grid that ends at 3. Thus the interval of the exponent has a width of 0, and `checkLaw` refuses the law. CAP-57 gives a problem for a shape at the edge of its search. Then the next form wins.

### The command and the workflow

The fit of the laws of a plan takes minutes, thus only CI starts it. The workflow `laws.yml` downloads the artifacts of each Lab run of its input `runs`, and fits the laws of each plan with a law set.

The fit reads only the manifests and the records. A job of the plan `rate` has approximately 3 GB of raw results. Thus the workflow downloads one artifact at a time, and deletes its raw results before the next download.

```sh
gh workflow run laws.yml -R mark1russell7/capacity -f runs='<run of the plan rate> <run of the plan floor>'
```

- `node src/laws.main.ts fit --records <folder> --out <folder>` reads each manifest `timed.json` in the folder and in its subfolders.
- It writes each law into `<out>/<id>.law.json`, then it reads the file again with `readLaw`.
- A problem, or no law, gives the exit code 1. The summary of the job tells each law, each problem and each skipped job.
- The summary gives the interval of each constant, the range of each law, its values at the ends of the range and its knee. Each interval holds 0.95 of the replicates. It also tells each point that a law leaves out, with its `latency.max` and its share.
- The workflow uploads the files as the artifact `laws-<run>`. A pull request puts them into the repository.

## The start cases

A start case measures the start of an application, not its load. It gives the time to ready and the memory of a start, at each size of the store, on a model of the target machine. A start case is a record with the format `capacity-start/1`, in a plan.

| Field | What it is |
| --- | --- |
| `subject` | The name of a subject of `START_SUBJECTS`. A subject is data: its repository, its install command, its type check, its variables and its two programs. |
| `seeder` | The commit of the tree that writes the stores. Each arm opens the same stores. |
| `arms` | 2 trees or more of the subject, each at a commit. The first arm is the base. A `graft` puts a file of another commit into a tree. An arm can also have `ballast` and `snapshot`. |
| `points` | The stores of the case. A point gives an amount of each variable of the subject, for example the byte size of the log. A point with `after` is a second start. |
| `seed` | The seed of each store. One seed gives the same files. |
| `rounds` | The rounds of one job, from 1 to 10. |
| `watch` | The time of the live loop after the ready time, 600 s or less. |
| `limit` | The longest start to the end of the first pass, 1800 s or less. |
| `windows` | The ready windows of the supervisor of the subject, up to the limit, in ascending order. |
| `probe` | The interval of the ready probe of the supervisor, 60 s or less. |
| `samples` | The interval of the samples of each child, from 1 s to 60 s. The default is no samples. |
| `target` | The machine that the case models: the image with its Node, the memory, the swap, the CPUs and the heap limit of V8. It can also give the disk, the page cache and the other processes. |
| `observed` | The facts of the target machine: the start of an arm on a point was ready in a window, or it was not. |

`measureStart` does the job of a start case in four steps:

1. It pulls the image of the target. A check child in a container of the target reads the Node version, the limits of the cgroup and the swap of the host. It also reads the heap limit and the CPUs. A fact that is not the fact of the target stops the case.
2. It makes a tree for each arm: a shallow fetch of the commit, each graft and the install. A tree with a graft gets the type check of the subject, because the start program strips the types. The seed uses an arm at the commit of the seeder with no graft, or one more tree.
3. The seed program writes the store of each point one time.
4. `freshRun` of `@mark1russell7/rigor-bench/fresh` starts the children in the order `arms`, with the scope `child`. Each round starts one child of each arm and one A/A child of the base, on each point.

Each child is the start program in a new container of the target, with the Node of the image and `--expose-gc`. The container has the memory, the swap and the CPUs of the target. Node sizes the heap of V8 from the memory limit of the container, as on the target. The child copies the store and opens the copy with no network and no key. It is ready at the end of its first pass. Then it reads its memory and does the passes of a live loop for the time of the watch.

### The machine model

A start case can also model the disk, the page cache and the other processes of the target machine. With none of them, a child has the fast disk of the host of the lab.

- **The disk.** `target.disk` gives the limits of each child each second: `readBytes`, `readOps`, `writeBytes` and `writeOps`. Its `source` tells where the numbers come from.
  - The lab finds the disk of the work folder, of the data of Docker and of each swap file of the host.
  - The container of each child gets the limits on each of these disks, through `io.max` of cgroup v2.
- **The page cache.** With `cache: "cold"`, the lab copies the store to a home on the host before each child. Then it drops the page cache of the host.
  - The child opens the home in place with `--home`. Thus the open reads the store from the disk.
  - With `warm`, the default, the child copies the store in its container.
- **The other processes.** `target.others` gives the other processes of the target. The `ballast` of an arm gives the steps of its live start that the start program does not run, for example a bundler.
  - Each ballast is a process in the container of the child, with `bytes` of resident memory, from the moment `start` or `ready`.
  - Its field `models` tells what it models.
- **The snapshot.** An arm with `snapshot: true` writes the start snapshot of the subject at its first pass, and its next start reads the snapshot.
- **A second start.** A point with `after` names an earlier point with the same amounts.
  - Before the children of the point, each arm does one first start on its copy of the home of the earlier point. A first start has no limits of the disk and no ballasts, and it runs to the end of its watch.
  - Each child of the point then opens a copy of the home of its arm.
  - The record keeps each first start: its time, its passes and the size of each file of the home.
  - A first start of an arm with a snapshot and no pass stops the case, because it wrote no snapshot.
- **The samples.** With `samples`, a child reads its own reads from the disk, its major faults and its resident set at each interval. It also reads the memory, the swap and the reads of its container.
  - A worker thread takes the samples. Thus the samples continue while the open blocks the main thread.

| Measure | What it is |
| --- | --- |
| `ready` | The time to ready: the import of the runtime, the open of the store and the first pass. |
| `readiness` | The time from the start of the process to the end of the open, less the copy and the ballasts. The ready probe passes after this point. |
| `firstPass` | The time from the end of the open to ready. |
| `copy`, `close`, `end` | The time of the copy of the store, the time of the close, and the time from the start of the process to the line. |
| `ballast` | The time to start the ballasts of the moment `start`. |
| `read`, `faults` | The bytes that the child read from the disk and its count of major page faults, from the start of the process to ready. |
| `peak` | VmHWM at ready: the peak of the resident set of the start. |
| `rss`, `anon`, `file`, `heap`, `external` | The memory at ready. `anon` and `file` are `null` on a machine with no `/proc`. |
| `live` | The used heap after a full GC at ready. |
| `heapPeak`, `livePeak`, `gc`, `fullGc` | The peaks of the used heap and of the live heap over the start, its GC time and its count of full GC events, from the GC profiler. |
| `watchPeak`, `watchRss`, `watchAnon`, `watchHeap` | The peaks of the memory over the watch. |
| `watchHeapPeak`, `watchLive`, `watchGc` | The heap peaks and the GC time of the watch, from the GC profiler. |
| `passes` | The count of passes in the watch. |
| `limit` | The heap size limit of V8 in the child. |

- **A start that does not fit.** A child that passes a limit of the target is a failure of its arm on its point, with a kind. The kind `time` is the time limit of the child. The kind `memory` is the memory limit of the container. The kind `heap` is the heap limit of V8. A failure has no reading, and the other arms still start.
- **The ready windows.** `windowReads` gives the read of each child in each window. A child with a reading is `ready` when its readiness and one probe interval are in the window. Else it is `late`.
- **A failure in a window.** A child over the time limit is `late` in a window when the window and its late margin are in the limit of the child. The late margin is the start of the container, the longest copy of the point and the longest time of a child after its open. Each other failure has `no read`.
- **The observations.** `observationReads` compares each fact of the target machine with the reads of the children of its arm and its A/A copy. A disagreement is a problem: the lab does not model the time of the machine. A fact with a child of `no read` is a problem too.
- **A stalled loop.** A pass can give a wake time that is not after the pass. Then the watch has no more passes. The reading records `stalled`, and the summary tells it.
- **The problems of a record.** `startRecordProblems` examines each start record. Each reading has each needed measure. Each arm and the A/A pair have a child of each point in each round: a reading, a failure or a skip. Each observation agrees with the record.
- **The time of a job.** `startWindowOf` gives the longest time of one job. It is `IMAGE_MARGIN` for each of the 3 steps of the image, `TREE_MARGIN` for each tree and each type check, and the seeds at `SEED_RATE`. A point with `after` has no seed. Each child and each first start adds its limit, the watch and `CHILD_MARGIN`.

The container does not model all of the target machine:

- With no machine model, it does not have the other load of the target. That load is its other processes, the traffic of its swap and its waits on the disk.
- A limit of the disk models the rate and the count of the reads. It does not model the delay of each read.
- The CPUs of the host of the lab are not the CPUs of the target. Thus a time of the lab is a time on the CPU of the record.
- The page cache of the store counts in the memory of the container. The kernel takes back clean cache first.

Five plans measure the start of alerts. Each one has no check and no trigger. The arm `cloud` is the build of the cloud machine with the graft of the measured start. In the first three plans, the arm `new` is the current build.

- `alerts-start` measures logs from 16 MiB to 512 MiB, and the log of the cloud machine, with the shapes and the transit copy of the cloud machine. It reads the windows of 90 s, of 308.012 s and of 600 s.
- `alerts-start-files` measures a log of 64 MiB with 3 sizes of the shapes file and 3 sizes of the transit copy. Its second case is the knee of the cloud log:
  - The point `cut-1030` is the log at the last start that was ready in 90 s. A count of the events of the cloud log gives its size.
  - The point `file-1844` is the log when the starts stopped at 90 s. The two points are 3% apart.
  - When the lab reads the two points the same, the size of the log does not explain the change.
- `alerts-start-horizon` measures the two points of the knee in 3 rounds, with a third arm. The arm `horizon` is the build of the horizon change of the state of alerts.
- `alerts-start-disk-mean` and `alerts-start-disk-peak` measure the knee on the model of the cloud machine: a cold cache, the other processes of the machine, and its disk.
  - The disk has the mean rate or the peak rate of a study of the cloud start.
  - The arms are the cloud build, the build of the start snapshot, and the current build without and with the snapshot.
  - The point `file-1844-again` is a second start after `file-1844`.
  - The observations of the knee are in the two plans. When the lab agrees with them, the other arms tell the time on the machine.

A person starts a plan by hand, for example with 5 runs:

```sh
gh workflow run lab.yml -R mark1russell7/capacity --ref <branch> -f plans=alerts-start -f runs='[1,2,3,4,5]'
```

The programs of alerts are in `src/subject`. `alerts-seed.main.ts` writes a store with `seedStore` of the testkit of the tree. The seed writes the events at the rate of a live log, thus a larger log has more days of events. `alerts-start.main.ts` opens the store with `openMeasuredRuntime` of the runtime of the tree. `alerts-config.json` is the configuration of each store: one place, one person and one channel, with made-up codes.

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
