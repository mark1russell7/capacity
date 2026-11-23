# Roadmap

This file is the plan of capacity. The Status page of the site reads it, and the tracker of the project mirrors it.

## The goal

capacity gives the cost of one request as a set of laws, and the scale rule of a service from those laws.

- A law gives one measure as a function of the load variables, with an interval.
- The measures are CPU time, memory, garbage collection time, event-loop lag and network bytes.
- The load variables are the request rate, size and duration, the concurrency, the heap size and the process age.
- The knee of a law is the load where the law leaves its cheap region.
- The scale rule gives the load at which a service needs one more instance, and the memory and CPU of each instance.

The work has three layers. Each layer adds its own laws to the layer below it.

| Layer | Subject | Result |
| --- | --- | --- |
| 1 | Bare Node | The laws of a request in `node:http`, with the knee of each law |
| 2 | The service runner and the procedures host | The overhead of each one, as its own law |
| 3 | Each app, alerts first | The laws of the app, and its scale rule |

## The path of a law

1. A design gives the load points: one variable alone, then all variables together.
2. A cell runs one load point in CI. The subject is in a container with a CPU limit and a memory limit.
3. An open-loop driver sends each request at its planned time. A slow reply does not delay the next request.
4. The cell gives one record with each measure, the CPU model and the commit.
5. A fit compares the forms of a law on the records. It keeps each form that lost, with its error.
6. The law file holds the form, the constants with their replicates, the range where the law is valid, and the run.
7. A gate measures sample points again on each change and each night. It fails when a measure leaves its interval.
8. The scale rule is a query on the laws, an instance type, the limits and a load.

Timed runs start only in CI. A run on a shared computer gives no number that a law can use.

## The home of each part

capacity holds the models and the rules. Each other part has a home package. A function that a home does not have goes to that home in a pull request.

| Part | Home | The gap today |
| --- | --- | --- |
| Rounds, fresh processes, A/A pairs and the CPU model | `@mark1russell7/rigor-bench` | Records with more than one measure (CAP-13) |
| Fits, intervals and noise floors | `@mark1russell7/rigor-statistics` | Fits of a form with parameters, and of a hinge (CAP-14) |
| Load schedules and the measure of a load run | `@mark1russell7/rigor-chaos` | None |
| Designs of load points with a seed | `@mark1russell7/rigor-generators` | None |
| Labs in containers and the open-loop driver | `@mark1russell7/harness` | Resource readings of a container (CAP-11), the connections of the driver (CAP-47), and a hold with no load (CAP-48) |
| Event-loop lag | `@mark1russell7/lag` | An entry for Node (CAP-12) |
| Amounts with units | `@mark1russell7/quantity` | None |
| The program of a form and its evaluation | `@mark1russell7/vex` | None |
| The service runner | `@mark1russell7/service` | None |

## The order

The first path gives one law with a gate: CAP-1, CAP-18 and CAP-11, then CAP-10, CAP-16, CAP-19, CAP-47, CAP-20, CAP-53 and CAP-26. CAP-53 needs the fits of CAP-14 and the law files of CAP-17.

CAP-49 comes first in layer 3. The start memory of alerts stops its start on a machine with 1 GB.

The second path gives the scale rule of alerts: the rest of the algebra (CAP-2 to CAP-7), then CAP-34 to CAP-37. It needs the cell and the gate of the first path, and not the whole of layers 1 and 2.

The other laws of layer 1 and the laws of layer 2 follow. They tell where the cost of an app comes from.

## The algebra

| ID | Item | Status | Priority | Size | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-1 | The law record | done | P0 | M |  | A law is data: a subject, a measure, its variables with units and ranges, a form as a Vex program, constants with their replicates, and its evidence. The package checks a law file and gives the value of a law at a load point, with an interval. |
| CAP-2 | The catalog of law forms | done | P1 | M | CAP-1 | Each form is data: constant, linear, power, logarithm, hinge, the delay of a queue, the scalability law, and drift with age. Each form gives its value, its slope and the start values of its fit. `FORMS` of `@mark1russell7/capacity` has them. |
| CAP-3 | The composition of laws | done | P1 | M | CAP-1 | A composition is data: a sum of law terms and nested compositions over a demand. The units tell when a part is a law times a rate. Layer 2 names layer 1 and adds the law of the overhead. The replicates add row by row, thus each interval goes through the sum. |
| CAP-4 | The knee of a law | done | P1 | S | CAP-2 | The knee is the first load where the cost grows fast, by a rule of rise or slope. The edge is the first load with no finite value, also at a pole. Each has an interval from the replicates. |
| CAP-5 | Instances and limits as data | done | P1 | S | CAP-1 | An instance type has cores, memory and a network rate. A limit is a ceiling on one measure, with headroom. The package gives the share of each limit that a value takes, and the limit that binds. CPU time is in core-seconds, thus a CPU use compares with the cores of an instance. The units come from `@mark1russell7/quantity`. |
| CAP-6 | The scale rule as a query | done | P1 | M | CAP-3, CAP-4, CAP-5, CAP-7 | The query gives the lowest count of instances that holds each limit at a load, the resource that binds first, and the load of the next step, each with an interval. The inverse query gives the highest load of a count. |
| CAP-7 | The workload as data | done | P1 | S | CAP-1 | A workload is a mix of request classes, each with a rate and the variables of one request, with the levels of the app. A workload comes from a plan or from the live metrics of an app. A demand scales, adds and divides between instances, and it gives the load point of a class for a law. |
| CAP-8 | The first npm release of the package | later | P2 | S | CAP-6 | The package `@mark1russell7/capacity` goes to npm through the release workflow. The owner of npm does the first publish of a new package. Until then the package is private, because the release workflow fails for a new package that is not on npm. |
| CAP-9 | The cost in money | later | P3 | S | CAP-6, CAP-39 | The prices of machine types are input data. The cost of one request in money follows from the laws and the prices. |

## Measurement

| ID | Item | Status | Priority | Size | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-10 | The measurement cell | done | P0 | L | CAP-11, CAP-18 | One case is a subject in a container with a CPU limit and a memory limit, and the open-loop driver of `@mark1russell7/harness` on other cores. The cell gives one record with each measure. A positive control in CI shows each added cost in its own measure, inside limits from 22 runs on four CPU models. |
| CAP-11 | Resource readings of a lab container | done | P0 | M |  | The lab reads the CPU time, the memory and the network bytes of a container from its control group, on the clock of the lab. The change is a pull request to `@mark1russell7/harness`, the home of the labs. |
| CAP-12 | Event-loop lag of a Node process | done | P1 | S |  | `@mark1russell7/lag` has an entry for Node, `/node`: the delay of the event loop as a histogram, the blocks, and the busy part of the loop (`eventLoopUtilization`). Version 0.5.2 has the histogram and the blocks ([lag#184](https://github.com/mark1russell7/lag/pull/184)). Version 0.5.3 adds the busy part ([lag#186](https://github.com/mark1russell7/lag/pull/186)). |
| CAP-13 | Records with many measures in the bench harness | later | P1 | M |  | `@mark1russell7/rigor-bench` records many measures for each case, not only a time. A/A pairs give the noise floor of each measure. Readings of a Node process give its CPU time, its heap and its garbage collection time. |
| CAP-14 | Fits of law forms and knees | done | P1 | M |  | `@mark1russell7/rigor-statistics` fits a form with parameters to values, with intervals from the bootstrap. It fits a hinge and gives the interval of its break. It ranks the forms by their error on held-out points. |
| CAP-15 | The grid of load variables | later | P1 | S | CAP-1 | Each load variable has a range and a scale: the request rate, size and duration, the concurrency, the heap size and the process age. A design with a seed moves one variable alone, then all variables together. |
| CAP-16 | The workflow of timed runs | done | P0 | M | CAP-10 | Timed runs start only in CI: on a schedule, by hand, and for a pull request that changes the lab. A plan file names the cases of one job and their check. Each run names its CPU model, and keeps its raw records and a manifest with the run as evidence. |
| CAP-17 | From records to law files | done | P1 | S | CAP-2, CAP-14, CAP-16 | A command reads the records of a named run and writes each law file, with the run as its evidence. It keeps each form that lost, with its error. A pull request changes a law, and the gate (CAP-26) measures it again. The first files are the six laws of the plan `rate` on the Intel Xeon 6975P-C. |
| CAP-47 | The connections of the open-loop driver | done | P0 | M |  | The driver of `@mark1russell7/harness` keeps one connection for each stream and pipelines its requests. A real client sends one request at a time on each connection of a pool, or opens a new connection. A stream gets a pool of n connections, or a new connection for each request. The change is a pull request to the harness. |
| CAP-50 | The gate Lab OK as a necessary check | later | P2 | XS | CAP-16 | The ruleset of the repository names the job `Lab OK` as a necessary check. The owner of the repository gives the word after the first version of alerts. |
| CAP-55 | Compiled bases of the catalog forms | later | P2 | S | CAP-14 | The bases of the catalog forms use the Vex interpreter, approximately 0.1 ms for each design call. A fit of the `scalability` form takes approximately 1700 calls. Thus 1000 bootstrap runs take approximately 3 minutes. The package moves to `@mark1russell7/vex` 0.20, and `tiered` of `@mark1russell7/vex-compiler` compiles each basis. A bench run of `@mark1russell7/rigor-bench` in CI gives the gain. |

## Layer 1: Node

| ID | Item | Status | Priority | Size | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-18 | The subjects of bare Node | done | P0 | S |  | A subject is a small server of `node:http` with its request classes as data: a body of n bytes, an allocation of n bytes, work of d microseconds of CPU time, a wait of d milliseconds, and a reply of n bytes. A flag sets the live heap. Thus each load variable can move alone. |
| CAP-19 | The floor of each measure | done | P0 | S | CAP-16 | Each night, 5 A/A pairs give the noise floor of each measure on the CPU model of the runner. Each law states its noise. The idle base moved to CAP-48. |
| CAP-48 | The idle base of each measure | later | P1 | S | CAP-19 | An idle process gives the base of each measure: the CPU time and the memory with no request. The harness gets a hold with no load. The change is a pull request to the harness. |
| CAP-20 | Laws of the request rate | done | P0 | M | CAP-1, CAP-19, CAP-47 | CPU time, memory and latency against the request rate, up to and past the limit of one core. The knee is the rate where the latency leaves its floor. The plan `rate` gives the points. At its limit, the core of the subject is full, not the driver. |
| CAP-53 | The intervals and the knees of the request rate | done | P0 | S | CAP-4, CAP-14, CAP-17, CAP-20 | The laws of the plan `rate` are law files (CAP-17). Each law gets the interval of its value and of its knee. A latency law keeps only the points where the subject serves its load and each run has enough arrivals. The bootstrap draws whole jobs, thus a law needs 5 jobs on its CPU model. The median gets its law in CAP-57, and the other CPU models get their laws in CAP-58. |
| CAP-54 | Load cells with no prober records | later | P2 | S | CAP-20 | The plan `rate` runs for 1 s, because the prober keeps approximately 2.3 KB for each arrival. One JSON text in Node has at most 512 MiB. An option of `@mark1russell7/harness` keeps no prober records for a load cell. Then `MAX_ARRIVALS` goes up, and the runs of the plan get longer. |
| CAP-56 | Rates below 1000 in the plan rate | later | P2 | S | CAP-53 | The plan `rate` has two rates below 1000: 100 and 300. The fall of the median and of the 90th percentile at a low rate rests on them. The floor of the 90th percentile is at 734 requests each second, between the measured rates 300 and 1000. The plan gets more rates from 100 to 1000. Then the floor and the fall rest on measured points. |
| CAP-57 | A shape at the edge of its search | later | P1 | M | CAP-53 | The refine of a shape searches a bracket. At the last candidate of a grid, the bracket ends one step past it. On the Intel Xeon 6975P-C, the exponent of the median latency is 4 in each replicate: the end of the bracket of a grid that ends at 3. `fitSeparable` of `@mark1russell7/rigor-statistics` gets a field that tells each shape at an end of its search. Then `fitLaw` gives a reason, not a fit, for a form with a shape at an edge in its estimate. It gives a problem when the interval of the level 0.95 cannot leave out each replicate at an edge. Then the next form wins. On the Intel Xeon 6975P-C, the form `queue` gives the median the knee 12750, with the interval 12170 to 13120 in 200 runs. The check of a flat column in `checkLaw` (CAP-53) stays. Then the medians of the plans `rate` and `overhead` get their laws, and the item removes their marks `known`. |
| CAP-58 | The laws of the request rate on more CPU models | later | P2 | S | CAP-53 | The bootstrap of a law draws whole jobs, thus a law needs 5 jobs or more on its CPU model. The runners give a random CPU model to each job. The Lab runs 44964347304 and 44977025221 gave 8 jobs on the Intel Xeon 6975P-C. They gave 1 job on the Intel Xeon Platinum 8573C and 1 on the AMD EPYC 9V45. More runs of the plan `rate` give 5 jobs on each model. Then `laws.yml` gives the laws of each model. |
| CAP-21 | Laws of the request size | later | P1 | M | CAP-20 | CPU time and memory for each byte of a request and of a reply, and the network bytes on the wire for each byte of payload. The knees are at the sizes of the buffers. |
| CAP-22 | Laws of duration and concurrency | later | P1 | M | CAP-12, CAP-20, CAP-47 | Memory for each request in flight and for each open connection. The lag from work that blocks the loop, as a queue law of its duration and its rate. |
| CAP-23 | Laws of the heap and garbage collection | later | P1 | M | CAP-13, CAP-20 | The share of time in garbage collection against the live heap and the allocation rate. The knee is near the heap limit, where collection takes most of the time. |
| CAP-24 | Laws of the process age | later | P1 | M | CAP-20 | The drift of memory and of lag in a long run. A slope with an interval that holds zero is no drift. A slope above zero is a leak, with its rate. |
| CAP-25 | The variables together | later | P1 | M | CAP-15, CAP-21, CAP-22, CAP-23 | A design with a seed moves all variables together. The composed law must predict the held-out points. Where it fails, the law gets a term for the two variables. A ranking tells which variables matter. |
| CAP-26 | The gate of the Node laws | done | P0 | M | CAP-20, CAP-53 | The gate measures sample points again and fails when a measure leaves the run range of its law. `lawGate` of capacity is the rule: a binomial count of each side, two jobs or more, and Holm. A job with a noise floor over its limit (CAP-19) gives no read. The residuals of each law come from jobs on many runners, thus the range holds the noise between runners. As proof, the gate fails once on a subject with an added cost. The plans `gate-rate` and `gate-rate-cost` run each night in 12 jobs. The proof run 45016177414 gave pass and block. |
| CAP-60 | The gate on each pull request and each night | later | P1 | S | CAP-26 | The gate plan runs on each pull request that changes the subject or the harness, and each night. A plan gets enough jobs for two of them on a CPU model with laws. A new version of the harness needs new laws, because the harness is a condition of each law. |
| CAP-61 | A run range for each rate | later | P2 | M | CAP-26 | The gate uses the residuals of all rates of a law. In a study of `cpu.request`, the 8 jobs at one rate agree within 22%, and within 8% from 11000 requests each second. The range of all rates at the level 0.98 goes from −17% to +31%. A range for each rate is narrower. The law file needs its points for this range. |
| CAP-27 | Node versions and CPU models | later | P2 | M | CAP-26 | The same laws on each supported version of Node and on each CPU model of the runners, x64 and arm64. A factor for each CPU model moves a law to a different machine. |
| CAP-28 | More protocols | later | P2 | L | CAP-26 | The same laws for a new connection for each request, for TLS, for HTTP/2 and for WebSocket. Each one is a subject with the same request classes. |

## Layer 2: the service runner

| ID | Item | Status | Priority | Size | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-29 | The overhead of the service runner | done | P1 | M | CAP-3, CAP-26 | The same request classes through `@mark1russell7/service`. Paired runs in one job give the overhead as its own law: CPU time for each request, base memory and lag. An interval that holds zero means no overhead. Part 1 gave the service subject and the plan `overhead`. Part 2 gave the laws of the overhead (a law set with a `base`). Part 3 gives the law files and the compositions of layer 2 on the Intel Xeon 6975P-C. From 1000 requests each second, the runner uses 1.5 to 2 times the CPU of the bare server. The lag is CAP-68. |
| CAP-30 | Laws of the parts of the runner | later | P1 | L | CAP-29 | The cost of each loop, each decision of a limiter, each retry and each check, against their count and their period. Retries multiply the load, and the law gives the factor. The runner uses more CPU than the bare server (CAP-29), thus the laws of its parts tell where the cost is. |
| CAP-31 | The constants of the stability border | later | P2 | M | CAP-30 | The runner has a stability border from weights of load and capacity (SYS-69 and SYS-70 of the systems roadmap). The measured weights go to that repository as data with intervals. |
| CAP-32 | The overhead of the procedures host | later | P2 | M | CAP-29 | A typed call over HTTP, WebSocket and MCP against a bare handler. The reference service of the systems repository (SYS-93) is the subject, with its store. |
| CAP-33 | The gate of the runner laws | later | P1 | S | CAP-29 | The gate holds the overhead laws on each pull request and each night. As proof, it fails once on a runner with an added cost. A release of the runner that moves a law shows in the gate. |
| CAP-68 | The event-loop lag of a subject | later | P1 | S | CAP-29 | Each subject measures its own event-loop lag with `@mark1russell7/lag` and writes it in a line. The lab records it as a measure. Thus the overhead of the runner gets a lag law. |
| CAP-69 | The files of the subject in the law conditions | later | P2 | S | CAP-29 | A digest of the files of a subject is a condition of each law. Thus a fit refuses to pool the runs of two versions of a subject. |

## Layer 3: apps

| ID | Item | Status | Priority | Size | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-49 | The start memory of alerts | blocked (AL-102) | P0 | M | CAP-4, CAP-19 | A law gives the start memory of alerts over the age of its log, its live reports and its other stores. Each case opens a seeded store in a fresh process in CI. The law gives the knee and the stores that fit in 1 GB. alerts owns the fix of the cause, and its gate reads the limit. The disk model caps the operations at the byte rate divided by 4 KiB, and the start records the time of each write of the snapshot. |
| CAP-59 | The gate of the snapshot write on the small target | later | P1 | S | CAP-49, CAP-65 | The lab holds a limit on the longest block of each write of the snapshot of the alerts start, on the mean and peak disks. The limit is the worst of 5 or more rounds plus their spread. Then the gate also holds the longest block of the whole start, which the liveness probe sees. That part uses the entry `/node` of `@mark1russell7/lag`. |
| CAP-51 | The arm of the horizon change of alerts | done | P1 | XS | CAP-49 | The plan `alerts-start-horizon` adds the arm `horizon`: the build where quiet incidents retire 6 hours after their last change. It measures the two points of the knee of the cloud log in 3 rounds. The arm tells if the deploy of the change ends the loop of the cloud start. |
| CAP-52 | The horizon arm over the log sizes | dropped | P1 | S | CAP-51 | The arms `new` and `horizon` over the log sizes of `alerts-start`. The case shows how the horizon change moves the knee of the start memory. A job with 3 arms on those points needs more than 360 minutes, thus the case is a plan of its own. CAP-62 dropped it. Each commit of alerts with a contract has the horizon change, thus no contract build can be the arm `new`. The plan `alerts-start-log` measures the build with the change, and the README of the lab keeps the results of `new`. |
| CAP-34 | The contract of an app | done | P1 | M | CAP-7, CAP-10 | An app gives its request classes, its load variables, a start command with fakes of its outside services, and its live metrics. Each app uses the same contract. |
| CAP-62 | The start of an app from its contract | done | P1 | M | CAP-34 | The lab reads the contract file at the commit of each arm, and it starts the app from it: install, check, seed and run. The program `app-start` imports the script of the run in the process of the child, thus the container holds only the app. The facts of the start of alerts move from the lab into the contract file in the repository of alerts. Part 3 retires four plans of the start subject and the subject case of `alerts-start-app`, and the README of the lab keeps their results. The plan `alerts-start-log` replaces `alerts-start`: 9 rungs of the log of the app, from 2 MiB to 400,000,000 B. The bytes plans and the removal of the start subject go with CAP-65. |
| CAP-63 | The weight of time in the mean of a gauge | later | P3 | S | CAP-34 | The mean of a level gives the same weight to each reading of its gauge, thus a missed reading moves the mean. A mean with the time between the readings as the weight goes into `@mark1russell7/rigor-statistics`. |
| CAP-64 | The fakes of the outside services of an app | done | P1 | M | CAP-62 | The lab starts the fake of each service of a contract in a sidecar container that shares the network of the child. Thus the fake is not in the memory of the child. The run gets the URL of each fake. The sidecar is a feature of `@mark1russell7/rigor-bench` 0.3.3. |
| CAP-65 | The events of a start in the contract | later | P1 | M | CAP-62 | The contract of an app names the JSON lines of its run that the lab records, for example each pass and each write of the snapshot. Then the start subject `alerts` and its programs go. |
| CAP-66 | The load of an app from its contract | done | P1 | M | CAP-62, CAP-64 | A point of an app case names the rate of each class and the amounts of its requests. The fake of each outside service gets the workload of the point and sends the events of its classes. The new measure `watchCores` gives the CPU time over the watch, thus its law over the rate gives the cost of one event. The memory of the sidecar of the fakes is the field `fakes` of the case. The plan `alerts-start-event` drives the class `event` of alerts. The requests of an HTTP class come with CAP-71. |
| CAP-71 | The requests of an HTTP class | later | P2 | M | CAP-66 | The lab sends the requests of each HTTP class of a contract at the rate of a point. The load driver of the harness is in its Docker image, and no app of the roadmap has an HTTP class yet. Until then, the lab refuses a rate above 0 for an HTTP class. |
| CAP-70 | The lab readings of an app | later | P2 | S | CAP-62 | The run of alerts prints the series of the metrics of its contract in one JSON line after ready and after each pass (alerts AL-132). The metric reader of that line moves from the testkit of alerts into `@mark1russell7/capacity` (alerts AL-135). Then the lab records the series of each start. |
| CAP-35 | The workload of alerts | later | P1 | M | CAP-34, CAP-66 | The load variables of alerts: sources, events for each second, the share of duplicates, open incidents, routes and channels. A ladder of rungs goes from 1 source to 10,000 sources. The contract of alerts gives the variables, its classes and the fake of its feeds. The lab plan of the rungs reads them. The ladders of feeds, persons, incidents and the log give 20 start laws. On the target, the heap limit stops a start at approximately 4800 persons. The plan `alerts-start-event` of CAP-66 gives the ladder of the class `event`. The ladder of the class `update` and the results come next. |
| CAP-67 | The levels of alerts together | later | P2 | M | CAP-35 | The routes of alerts are the persons times the open incidents and the system incidents. A grid of the two levels gives the law of their product. The ladders of CAP-35 move one level at a time. |
| CAP-36 | The laws of alerts | later | P1 | L | CAP-17, CAP-26, CAP-35, CAP-66 | The cost of each event, each poll of a source and each route. Memory for each open incident. The lag in a burst of events. Each law has its knee. |
| CAP-37 | The scale rule of alerts | later | P1 | M | CAP-6, CAP-36 | The load at which alerts needs one more instance, and the memory and CPU of each instance, with intervals. The rule names what binds first, and what stops a second instance today. |
| CAP-38 | The scale rule in the infrastructure code | later | P2 | M | CAP-37 | The rule is a file that the infrastructure code reads: the size of an instance, the lowest and highest count, and the metric and threshold that add an instance. |
| CAP-39 | Cloud machine types | later | P2 | M | CAP-27, CAP-37 | Runs on real cloud machines give the factor of each machine type. These runs cost money, so the item starts with a budget question and a monthly cap. |
| CAP-40 | The live check of a law | later | P2 | M | CAP-37 | The laws read the live metrics of the app: the instances that the current load needs, the headroom, and the load of the next step. A law that drifts from the live values raises a flag. |
| CAP-41 | A second session for layer 3 | later | P2 | XS | CAP-34 | Layer 3 gets its own work stream when the contract of an app is stable. The laws of each app then move in parallel with layers 1 and 2. |
| CAP-42 | The next apps | later | P3 | L | CAP-37 | Each next app gets its laws and its scale rule through the same contract. |

## Site and docs

| ID | Item | Status | Priority | Size | Needs | Summary |
| --- | --- | --- | --- | --- | --- | --- |
| CAP-43 | The roadmap and its tracker | done | P0 | S |  | The whole plan of the three layers as items, each with a priority, a size and its dependencies. The tracker of the project mirrors this file. |
| CAP-44 | The site as a live demo of the laws | later | P1 | M | CAP-6, CAP-20 | The site shows each law as a curve with its interval and its knee. A reader moves the load, and sees the count of instances and the resource that binds first. |
| CAP-45 | The method and the docs | later | P1 | S | CAP-20 | The README tells how to read a law, how a law gets its numbers, and where a law is valid. It tells how to add a subject and an app. |
| CAP-46 | The history of each law | later | P2 | S | CAP-17, CAP-44 | Each law keeps the values of its constants for each run. The site shows them as a line, so a change of Node or of the runner is visible. |
