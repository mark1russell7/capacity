# @capacity/lab

This package has the subjects of the measurement: the programs that a run measures, and the request classes that a run sends to them.

**State: CAP-18 of the [roadmap](../../docs/ROADMAP.md).** The package has the bare subject of layer 1. The measurement cell (CAP-10) comes next. The package is private: it is a tool of this repository.

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
