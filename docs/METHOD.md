# The method

This guide tells how to read a law, how a law gets its numbers, and where a law is valid. It also tells how to add a subject and an app.

The READMEs of the packages are the reference. This guide links to them, and it does not repeat them.

## How to read a law

A law gives one measure as a function of one or more load variables. Each law is one JSON file in [`packages/capacity/laws`](../packages/capacity/laws). The fields are in [A law](../packages/capacity/README.md#a-law).

Read the file [`node-http/rate/xeon-6975p-c/cpu.request.law.json`](../packages/capacity/laws/node-http/rate/xeon-6975p-c/cpu.request.law.json) in this order:

1. **The measure.** `cpu.request` in `{core}·ms/{request}` is the CPU time of one request.
2. **The variables.** The variable `rate` goes from 100 to 36000 requests each second. The law holds only in this range.
3. **The conditions.** These facts did not change between the points: the CPU model, 1 core, 512 MiB, Poisson arrivals and a pool of 64 connections. The law holds only under them.
4. **The form.** The form `power` won. Five other forms lost, and `fit.losers` keeps each one with its error.
5. **The constants.** The form reads `base`, `scale` and `exponent`. These values give the value of the law.
6. **The replicates.** Each of the 1000 rows is one more fit of all the constants. The rows give the doubt of each answer.
7. **The evidence and the noise.** Each point comes from a CI run in `evidence`. The noise floor of the measure comes from the runs in `noise`.

Do not read an interval from one constant. Ask a query. The query evaluates the form with each row of the replicates, thus its interval is correct also for a query that joins laws.

| Question | Query | Reference |
| --- | --- | --- |
| What is the cost at this load? | `lawValue(law, point)` | [The value of a law](../packages/capacity/README.md#the-value-of-a-law) |
| Where does the cost leave its floor? | `lawKnee(law, variable, rule)` | [The knee of a law](../packages/capacity/README.md#the-knee-of-a-law) |
| What load fills this amount? | `lawReach(law, variable, amount)` | [The reach of a law](../packages/capacity/README.md#the-reach-of-a-law) |
| Is a new run in the range of the law? | `lawGate(entries)` | [The gate of the laws](../packages/capacity/README.md#the-gate-of-the-laws) |
| What is the cost of a mix of requests? | a composition | [The composition of laws](../packages/capacity/README.md#the-composition-of-laws) |
| When does a service need one more instance? | the scale rule | [The scale rule](../packages/capacity/README.md#the-scale-rule) |

The answer of `lawValue` has two ranges:

- `interval` is the doubt of the law. It holds 0.95 of the values of the replicates.
- `run` is where one new measured run falls. It is wider, because it adds the residuals. A gate uses `run`.

## How a law gets its numbers

A law comes from CI only. A computer with other work gives times that nobody can use.

```text
plan file  ->  Lab run (lab.yml)  ->  records  ->  fit (laws.yml)  ->  law file  ->  pull request
```

1. **The plan.** A plan file in [`packages/lab/plans`](../packages/lab/plans) gives the cases, the count of jobs and the law set. Refer to [The plans](../packages/lab/README.md#the-plans).
2. **The Lab run.** The workflow `lab.yml` starts each job of the plan on one runner machine. Each job measures each point of each case.
3. **The records.** Each job uploads its records and its manifest `timed.json` as an artifact of the run.
4. **The fit.** The workflow `laws.yml` downloads the records of the named runs. It fits each form of each measure, and it keeps the form with the smallest held-out error.
5. **The doubt.** The bootstrap draws whole jobs, because a job is one machine. Thus the replicates hold the variation between the machines.
6. **The check.** `checkLaw` examines each law before the workflow writes it. The workflow uploads the files as the artifact `laws-<run>`.
7. **The pull request.** A pull request puts the files into `packages/capacity/laws/<subject>/<plan>/<cpu>/<measure>.law.json`. A test reads each file.

A law needs 40 points or more and 5 jobs or more on one CPU model. Thus start a plan with 5 runs or more:

```sh
gh workflow run lab.yml -R mark1russell7/capacity -f plans=<plan> -f runs='[1,2,3,4,5]'
gh workflow run laws.yml -R mark1russell7/capacity -f runs='<Lab run> <more Lab runs>'
```

The fit can pool the runs of one plan. Each record holds its own case. Thus a later run with more points adds to the earlier runs. The details are in [The laws](../packages/lab/README.md#the-laws) and [The laws of the start cases](../packages/lab/README.md#the-laws-of-the-start-cases).

## Where a law is valid

A law is valid in the ranges of its variables, under its conditions, on its CPU model. Each other use is an extrapolation.

- **The range.** A point outside a range gives a value, but the name of the variable is in `outside`. Do not use that value as a measurement.
- **Past the range.** A cost does not fall past the edge of its measures. It stays flat or it keeps its law. Thus a law cannot give a cost below 0.
- **The conditions.** A law of 1 core does not tell the cost on 2 cores. A different CPU model needs its own law.
- **A reach outside the range.** `lawReach` can give a load past the range. Treat it as a forecast, and add points near it.

An example from alerts: the laws of its event ladder reach the memory limit of the target at 48 events each second. The points go to 30 events each second. Thus the lab adds rungs from 40 to 70 events each second (CAP-86). Refer to [The load ladder of events](../packages/lab/README.md#the-load-ladder-of-events).

## How to add a subject

A subject is a server that the lab measures under load. The bare subject `node-http` is layer 1, and `node-http-service` is layer 2. Each layer does the same work as the layer below it. Thus the difference of two layers is the cost of the layer.

1. Write the program in `packages/lab/src/subject`. It imports only Node, its own files and the packages of its layer.
2. Give it the flags and the JSON lines of the bare subject: `listening`, `stopping` and `fail`. Refer to [The program](../packages/lab/README.md#the-program).
3. Give it no instrument. The container gives the CPU time, the memory and the network bytes, thus each subject has the same instruments.
4. Add its record (a `LabSubject`) to `subjects.ts`, and add it to `SUBJECTS` in `case.ts`.
5. Add a plan with the cases of the subject and a law set. Each measure of the law set needs a noise floor.
6. Start the plan in CI, fit the laws, and put the files into a pull request.

The records of the two subjects are in [The bare subject](../packages/lab/README.md#the-bare-subject) and [The service subject](../packages/lab/README.md#the-service-subject).

## How to add an app

An app gives its own contract. The lab reads the contract from the tree of the app, thus the lab has no subject record for an app.

### In the repository of the app

1. Write `capacity-app.json` at the root, in the format `capacity-app/1`. Refer to [The contract of an app](../packages/capacity/README.md#the-contract-of-an-app).
2. Give each load variable its kind, its unit and its range: `request`, `level` or `store`.
3. Give each class of request its rate range, its request variables and its entry.
4. Give the commands `install`, `check` and `seed`, and the process `run` with its ready signal. A command is a program and its arguments, with no shell.
5. Make the seed write the store of a point. Its last line is a JSON record with the field `amounts`.
6. Give a fake for each outside service. The lab starts each fake in a sidecar, with the workload of the point.
7. Give each live series in `metrics`. Then the live metrics of the app give its workload.
8. Add a test that reads the contract with `readApp`. A contract with a problem fails the test.

### In this repository

1. Add a plan with a start case. Its `app` is the HTTPS URL of the repository, and its `subject` is the id of the contract.
2. Pin each arm and the seeder to a commit of the app.
3. Give the points: one amount of each store variable, and the rate of each class with load.
4. Give the target: the machine that the case models. It has an image, a memory, a swap, CPUs and a heap limit.
5. Give the start law set: the variable and the measures. A start law moves one variable, and each other variable stays at one amount.
6. Start the plan with 5 runs or more, fit the laws with `laws.yml`, and read the summary.

The app cases are in [The app cases](../packages/lab/README.md#the-app-cases). Alerts is the first app, and its plans are the examples.
