// The service subject of layer 2: the work of the bare subject through the service runner of
// `@mark1russell7/service`. The two subjects do the same work for each class. Thus the difference
// of their measures is the cost of the runner.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { kubernetes, service } from "@mark1russell7/service";
import { handle, httpTransport, probeHandler } from "@mark1russell7/service/http";
import { classOf, type RequestClass } from "./class.ts";
import { perform } from "./perform.ts";

/** This name is the controller of the requests of the classes. */
export const CONTROLLER = "classes";

/** This name is the route of each request of a class. */
export const ROUTE = "class";

/** This path goes before the paths of the probes. A path of a class starts with `/?`, thus the two do not mix. */
export const PROBE_PREFIX = "/health";

const s = (value: number): { readonly value: number; readonly unit: string } => ({ value, unit: "s" });

/** These options change the service subject. */
export interface NodeHttpServiceOptions {
  /** This number is the port of the listener. With 0, the system gives a free port. */
  readonly port: number;
  /** This time is an added CPU time for each request, in microseconds, as in the bare subject. The default is 0. */
  readonly cost?: number;
  /** This time is the time that the server keeps an idle connection, in ms. 0 keeps each connection. The default is the default of Node. */
  readonly keepAliveTimeout?: number;
}

/** The service subject is the server of `node:http` and the declaration of its service. */
export interface NodeHttpService {
  readonly server: Server;
  readonly service: ReturnType<typeof service>;
}

/**
 * This function makes the service subject. The server of `node:http` is a transport of the service, and
 * each request of a class goes through `handle`. Thus the service admits it, counts it and can cut it.
 *
 * - The work of a class is the work of the bare subject (`perform`), and the reply has the same bytes.
 * - The probes answer on the same port, after `PROBE_PREFIX`, as the probes of a pod do.
 * - The declaration is a pod at the defaults of Kubernetes, with no dependency and no check.
 * - A path that is not a class gets 404, and a body of a different size gets 500. The bare subject gives 400 to both.
 */
export const nodeHttpService = (options: NodeHttpServiceOptions): NodeHttpService => {
  const cost = options.cost ?? 0;
  const server = createServer();
  // The transport sets keepAliveTimeout to the idle close less the buffer of Node. A close with no bound keeps each connection.
  const keep = options.keepAliveTimeout ?? server.keepAliveTimeout;
  const idleClose = keep === 0 ? { value: Number.POSITIVE_INFINITY, unit: "ms" } : { value: keep + server.keepAliveTimeoutBuffer, unit: "ms" };
  const http = httpTransport(
    server,
    { server_idle_close: idleClose, server_idle_sweep_interval: s(1), server_retry_after: s(1) },
    { listen: { port: options.port, host: "0.0.0.0" } },
  );
  // The route reads the class one time, and the work gets it from this map.
  const asked = new WeakMap<IncomingMessage, RequestClass>();
  const route = (request: IncomingMessage): string | null => {
    const value = classOf(request.url ?? "");
    if (value === undefined) return null;
    asked.set(request, value);
    return ROUTE;
  };
  const work = (request: IncomingMessage): Promise<Uint8Array> =>
    new Promise((resolve, reject) => {
      const value = asked.get(request) as RequestClass;
      let read = 0;
      request.on("data", (chunk: Buffer) => {
        read += chunk.length;
      });
      request.on("end", () => {
        if (read !== value.body) reject(new RangeError(`The body has ${read} bytes, and the class has ${value.body}.`));
        else perform(cost > 0 ? { ...value, work: value.work + cost } : value, resolve);
      });
    });
  const svc = service("node-http-service")
    .profile(kubernetes({ grace: s(30), preStop: s(0) }))
    .server("http", http.knobs, http)
    .readiness({ type: "debounce", interval: s(5), failAfter: 3, recoverAfter: 1 })
    .liveness({ type: "window", failAfter: s(45) })
    .startup(s(60));
  svc.controller(CONTROLLER).route(ROUTE, { idempotent: true });
  http.mount(probeHandler(() => svc.health, { prefix: PROBE_PREFIX }));
  http.mount(handle(CONTROLLER, route, work));
  return { server, service: svc };
};
