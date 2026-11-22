// The checks of the ready signals of a contract (`AppReady`), for the programs `app-start` and `fakes`. A signal
// `line` is a text in the output of a process. A signal `http` is a status 200 of a path of the process.
//
// This module imports no module of Node. The program `app-start` imports it in the process of the app, and a module
// that the lab loads first makes the import of that module by the app faster.

import type * as Http from "node:http";

/** This time is the interval of the probes of a ready signal `http`, in milliseconds. */
export const READY_POLL_MS = 10;

/**
 * This function gives a check of the chunks of one stream for a text. The check gives true from the chunk that
 * completes the text, also when the text is in two chunks.
 */
export const textWatch = (text: string): ((chunk: string) => boolean) => {
  const keep = Math.max(0, text.length - 1);
  let tail = "";
  let seen = false;
  return (chunk) => {
    if (seen) return true;
    const joined = tail + chunk;
    seen = joined.includes(text);
    tail = joined.slice(joined.length - keep);
    return seen;
  };
};

/**
 * This function gives true when the path on the port of the loopback gives the status 200. It gives false for another
 * status, an error or no answer in 1 second. The caller gives the module `node:http`, thus this module loads nothing.
 */
export const httpProbe = (http: typeof Http, port: number, path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path, agent: false, timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
