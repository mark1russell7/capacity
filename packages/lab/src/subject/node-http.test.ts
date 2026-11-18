import type { Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EMPTY, pathOf, requestOf, type RequestClass } from "./class.ts";
import { nodeHttp } from "./node-http.ts";

let server: Server;
let port = 0;

beforeAll(async () => {
  server = nodeHttp();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const send = (asked: RequestClass, path = pathOf(asked)): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${path}`, asked.body === 0 ? {} : { method: "POST", body: "x".repeat(asked.body) });

/** This function writes some text to a new connection and gives all that the server sends until `done` tells that it is whole. */
const exchange = (text: string, done: (reply: string) => boolean): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    let reply = "";
    socket.on("data", (chunk: Buffer) => {
      reply += chunk.toString("latin1");
      if (done(reply)) {
        socket.destroy();
        resolve(reply);
      }
    });
    socket.on("error", reject);
  });

describe("nodeHttp", () => {
  it("answers 200 with no body for the class that asks no work", async () => {
    const response = await send(EMPTY);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect(await response.text()).toBe("");
  });

  it("sends a reply of the bytes of the class", async () => {
    const response = await send({ ...EMPTY, reply: 5000 });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("x".repeat(5000));
  });

  it("reads a body of the bytes of the class", async () => {
    const response = await send({ ...EMPTY, body: 100_000, reply: 3 });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("xxx");
  });

  it("does each part of a class in one request", async () => {
    const start = performance.now();
    const response = await send({ body: 10, alloc: 50_000, work: 1000, wait: 30, reply: 20 });
    expect(response.status).toBe(200);
    expect(await response.text()).toHaveLength(20);
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("answers 400 for a body that does not have the bytes of the class", async () => {
    const response = await send({ ...EMPTY, body: 5 }, "/?body=6");
    expect(response.status).toBe(400);
    expect((await send(EMPTY, "/?body=6")).status).toBe(400);
  });

  it("answers 400 for a path that is not a class", async () => {
    expect((await send(EMPTY, "/health")).status).toBe(400);
    expect((await send(EMPTY, "/?size=1")).status).toBe(400);
    expect((await send({ ...EMPTY, body: 5 }, "/?work=x")).status).toBe(400);
  });

  it("answers each request of requestOf on one connection, in order", async () => {
    const first = requestOf({ ...EMPTY, body: 4, reply: 3 }, `127.0.0.1:${port}`);
    const second = requestOf({ ...EMPTY, reply: 5 }, `127.0.0.1:${port}`);
    const bad = "GET /nothing HTTP/1.1\r\nhost: subject\r\n\r\n";
    const reply = await exchange(first + bad + second, (text) => text.endsWith("xxxxx"));
    const statuses = [...reply.matchAll(/HTTP\/1\.1 (\d{3}) /g)].map((match) => match[1]);
    expect(statuses).toEqual(["200", "400", "200"]);
    const lengths = [...reply.matchAll(/content-length: (\d+)/gi)].map((match) => match[1]);
    expect(lengths).toEqual(["3", "0", "5"]);
    expect(reply).not.toMatch(/connection: close/i);
  });
});
