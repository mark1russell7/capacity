// The bare subject of layer 1: a server of node:http with no framework and no runner. It is the
// base that each other layer compares with, thus it uses nothing but Node.

import { createServer, type Server } from "node:http";
import { classOf } from "./class.ts";
import { perform } from "./perform.ts";

/**
 * This function makes the bare subject: a server of `node:http` at the defaults of Node. Each
 * request names its class in its path. The server reads the body, does the work of the class and
 * sends the reply. It answers 400 for a path that is not a class, and for a body of a different size.
 */
export const nodeHttp = (): Server =>
  createServer((request, response) => {
    const asked = classOf(request.url ?? "");
    let read = 0;
    request.on("data", (chunk: Buffer) => {
      read += chunk.length;
    });
    request.on("end", () => {
      if (asked === undefined || read !== asked.body) {
        response.writeHead(400, { "content-length": 0 }).end();
        return;
      }
      perform(asked, (reply) => {
        response.writeHead(200, { "content-length": reply.length }).end(reply);
      });
    });
  });
