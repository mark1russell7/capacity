# capacity

This repository has the performance algebra: the cost of one request as laws over each load variable.

A law gives one measure as a function of the load. The measures are CPU time, memory, garbage collection time, event-loop lag and network bytes. The load variables are the request rate, size and duration, the concurrency, the heap size and the process age. Each law has an interval and its evidence from CI.

The laws have three layers: bare Node, the service runner on Node, and each app. The scale rule of a service comes from its laws. It tells the load at which the service needs one more instance, and the memory and the CPU of each instance.

**State:** the [roadmap](docs/ROADMAP.md) has the plan, the path of a law and the status of each item.

**Method:** [the method](docs/METHOD.md) tells how to read a law, how a law gets its numbers, and where it is valid. It also tells how to add a subject and an app.

## Packages

| Package | What it has |
| --- | --- |
| [`@mark1russell7/capacity`](packages/capacity/README.md) | The models and the rules: the law record and its value at a load point, the workload record and the algebra of demands. |
| [`@capacity/lab`](packages/lab/README.md) | The subjects of the measurement: the bare server of Node and the request classes. |
| `@capacity/site` | The site of the repository: the coverage matrix of the laws, and the curve of each law with the band of its interval, its knee and the points of its runs. |

## Rules

- A timed run starts only in CI. A computer with other work gives numbers that nobody can use.
- This repository holds the models and the rules. The measurement comes from the home of each part.
- A gate holds each law. A change that breaks a law fails the gate.

The roadmap names the home of each part, and [`CLAUDE.md`](CLAUDE.md) has the rules for a change.
