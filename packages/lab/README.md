# @capacity/lab

This package has the subjects of the measurement: the programs that a run measures, and the request classes that a run sends to them. It also has the cases: each case is one measurement as data. The cell of a case operates it in the lab of `@mark1russell7/harness`, and the record keeps its measures. A plan is a set of cases that one CI job measures, with the check of their records.

**State: CAP-18, CAP-10, CAP-16 and CAP-19 of the [roadmap](../../docs/ROADMAP.md).** The package has the bare subject of layer 1, the case record, the cell of a case and the record of its measures. It also has the plans, the timed runs and the noise floor of each measure. The package is private: it is a tool of this repository.

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
| `runs` | The count of the runs that the record counts, from 1 to 20. One warm-up run comes before them. |

- **The variables of a request** are the fields of a request class. Each amount converts to the unit of its field, and it is a whole number in that unit. Thus `0.5 ms` of `work` is `500 us`. A field that the request does not name is 0. `requestClassOf` gives the request class.
- **The levels of a demand** are the amounts that the subject holds. The level `heap` is the live heap of the subject, in bytes: the flag `--ballast`. `caseLevel` gives a level in its unit.
- **The check.** `caseProblems` gives each problem of a case, with its path. It uses `instanceProblems` and `demandProblems` of `@mark1russell7/capacity`. Then it examines what the lab can do:
  - The lab limits the CPU and the memory of a container, and not the network. An instance with `network` is a problem.
  - The driver holds no open connection with no request. A level `connections` is a problem.
  - Each class has a rate above 0.
- **The connections of a class.** The driver of the harness keeps one connection for each stream, and it sends each request at its time. It does not wait for the reply before the next request (HTTP pipelining).
  - Node reads the requests of one connection one at a time. Thus the requests of a class with a `wait` stay in a queue on the connection, and its latency includes that queue.
  - A request of a pipeline can come in one read with other requests. Thus its CPU cost can be less than the cost of a request of a real client. A real client sends one request at a time on each connection.
  - A pool of connections for each stream, and a new connection for each request, are a gap of the driver. A case cannot select them yet.

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

The measures of the driver are also in `classes`, for each class of the demand.

- **An unfinished request** counts at its age at the end. Thus a quantile of a run with an unfinished request is a low bound. The CPU time of an unfinished request counts, thus `cpu.request` of such a run is too high.
- **The idle cost** of the subject is in each measure of a run. A run of an idle subject needs a hold with no load in the harness. Thus the idle base is CAP-48.
- **The lag of the driver** has no limit in the record. The checks `control` and `floor` give a limit at their light load: `LAG_LIMIT`.

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

The manifest has the plan, the CI run and its `attempt`. It also has the machine of the first record, the times, the files of each case and the verdict. The CI run (`runOf`) has the form of a run of the evidence of a law: its address, its commit and its UTC time. Thus a law file gets its evidence from the manifest (CAP-17).

- **The CPU model** of a run is `machine.cpu` of the manifest and of each record. The summary of the job also tells it.
- **The commit** of a pull request is the merge commit, because the job measures the code of that commit.
- **A case that throws** stops the plan with no manifest. The files of the cases before it stay in the artifact.
- **The command.** `node src/timed.main.ts plan --event <event>` gives the matrix as JSON, with no Docker. `node src/timed.main.ts measure --plan <id> --out <folder> --run <number>` measures a plan. Only CI starts `measure`. The run turns the order of the arms of a start case.

## The start cases

A start case measures the start of an application, not its load. It gives the time to ready and the memory of a start, at each size of the store, on a model of the target machine. A start case is a record with the format `capacity-start/1`, in a plan.

| Field | What it is |
| --- | --- |
| `subject` | The name of a subject of `START_SUBJECTS`. A subject is data: its repository, its install command, its type check, its variables and its two programs. |
| `seeder` | The commit of the tree that writes the stores. Each arm opens the same stores. |
| `arms` | 2 trees or more of the subject, each at a commit. The first arm is the base. A `graft` puts a file of another commit into a tree. |
| `points` | The stores of the case. A point gives an amount of each variable of the subject, for example the byte size of the log. |
| `seed` | The seed of each store. One seed gives the same files. |
| `rounds` | The rounds of one job, from 1 to 10. |
| `watch` | The time of the live loop after the ready time, 600 s or less. |
| `limit` | The longest start to the end of the first pass, 1800 s or less. |
| `windows` | The ready windows of the supervisor of the subject, up to the limit, in ascending order. |
| `probe` | The interval of the ready probe of the supervisor, 60 s or less. |
| `target` | The machine that the case models: the image with its Node, the memory, the swap, the CPUs and the heap limit of V8. |
| `observed` | The facts of the target machine: the start of an arm on a point was ready in a window, or it was not. |

`measureStart` does the job of a start case in four steps:

1. It pulls the image of the target. A check child in a container of the target reads the Node version, the limits of the cgroup and the swap of the host. It also reads the heap limit and the CPUs. A fact that is not the fact of the target stops the case.
2. It makes a tree for each arm: a shallow fetch of the commit, each graft and the install. A tree with a graft gets the type check of the subject, because the start program strips the types. The seed uses an arm at the commit of the seeder with no graft, or one more tree.
3. The seed program writes the store of each point one time.
4. `freshRun` of `@mark1russell7/rigor-bench/fresh` starts the children in the order `arms`, with the scope `child`. Each round starts one child of each arm and one A/A child of the base, on each point.

Each child is the start program in a new container of the target, with the Node of the image and `--expose-gc`. The container has the memory, the swap and the CPUs of the target. Node sizes the heap of V8 from the memory limit of the container, as on the target. The child copies the store and opens the copy with no network and no key. It is ready at the end of its first pass. Then it reads its memory and does the passes of a live loop for the time of the watch.

| Measure | What it is |
| --- | --- |
| `ready` | The time to ready: the import of the runtime, the open of the store and the first pass. |
| `readiness` | The time from the start of the process to the end of the open, less the copy. The ready probe passes after this point. |
| `firstPass` | The time from the end of the open to ready. |
| `copy`, `close`, `end` | The time of the copy of the store, the time of the close, and the time from the start of the process to the line. |
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
- **The time of a job.** `startWindowOf` gives the longest time of one job. It is `IMAGE_MARGIN` for each of the 3 steps of the image, `TREE_MARGIN` for each tree and each type check, and the seeds at `SEED_RATE`. Each child adds its limit, the watch and `CHILD_MARGIN`.

The container does not model all of the target machine:

- It does not have the other load of the target: its other processes, the traffic of its swap and its waits on the disk.
- The CPUs of the host of the lab are not the CPUs of the target. Thus a time of the lab is a time on the CPU of the record.
- The copy of the store is in the container. The page cache of the copy counts in the memory of the container. The kernel takes back clean cache first.

Two plans measure the start of alerts. Each one has no check and no trigger. The arm `cloud` is the build of the cloud machine with the graft of the measured start, and the arm `new` is the current build.

- `alerts-start` measures logs from 16 MiB to 512 MiB, and the log of the cloud machine, with the shapes and the transit copy of the cloud machine. It reads the windows of 90 s, of 308.012 s and of 600 s.
- `alerts-start-files` measures a log of 64 MiB with 3 sizes of the shapes file and 3 sizes of the transit copy. Its second case is the knee of the cloud log:
  - The point `cut-1030` is the log at the last start that was ready in 90 s. A count of the events of the cloud log gives its size.
  - The point `file-1844` is the log when the starts stopped at 90 s. The two points are 3% apart.
  - When the lab reads the two points the same, the size of the log does not explain the change.

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
