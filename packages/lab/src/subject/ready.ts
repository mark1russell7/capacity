// The checks of the ready signals of a contract (`AppReady`), for the programs `app-start` and `fakes`. A signal
// `line` is a text in the output of a process. A signal `http` is a status 200 of a path of the process. The recorder
// of the lines of a run (`AppLine`) keeps the JSON lines that the contract names, for the program `app-start`.
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

/** This count is the most lines of one kind that a recorder keeps. */
export const LINE_LIMIT = 100_000;

/** This count is the most characters of a line that a recorder reads. A longer line is not a line of the lab. */
const LINE_CHARS = 1_000_000;

/** These fields of a line `write` are the times of the write, in milliseconds. */
export const WRITE_FIELDS = ["longestMs", "writeMs", "rowsMs", "wallMs", "cpuMs"] as const;

/** A line of a run that the recorder keeps: its kind, the time of its write in milliseconds, and its fields. */
export interface RecordedLine {
  readonly kind: string;
  readonly ms: number;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** A recorder of the lines of one stream. `write` reads one chunk of the stream at the time `at`, and `lines` gives the kept lines. */
export interface LineRecorder {
  readonly write: (chunk: string, at: number) => void;
  readonly lines: () => readonly RecordedLine[];
}

/**
 * This function gives a recorder of the JSON lines of one stream. The recorder joins the chunks into lines. It keeps each
 * JSON object line whose field `ev` is the `ev` of one of `kinds`. The time of the line is the time of its last chunk. The
 * recorder keeps at most `limit` lines of each kind.
 */
export const lineRecorder = (kinds: readonly { readonly kind: string; readonly ev: string }[], limit: number = LINE_LIMIT): LineRecorder => {
  const kindOf = new Map(kinds.map((each) => [each.ev, each.kind]));
  const counts = new Map<string, number>();
  const kept: RecordedLine[] = [];
  let tail = "";
  const read = (text: string, at: number): void => {
    const trimmed = text.trim();
    if (!trimmed.startsWith("{") || !trimmed.includes('"ev"')) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) return;
    const fields = value as Readonly<Record<string, unknown>>;
    const kind = typeof fields["ev"] === "string" ? kindOf.get(fields["ev"]) : undefined;
    if (kind === undefined) return;
    const count = counts.get(kind) ?? 0;
    if (count >= limit) return;
    counts.set(kind, count + 1);
    kept.push({ kind, ms: at, fields });
  };
  return {
    write: (chunk, at) => {
      if (kindOf.size === 0) return;
      const parts = (tail + chunk).split("\n");
      tail = parts.pop() ?? "";
      if (tail.length > LINE_CHARS) tail = "";
      for (const part of parts) read(part, at);
    },
    lines: () => kept,
  };
};

/**
 * This function gives the fields `passes` and `writes` of the line of a child from the recorded lines of a run. `passes` is the
 * count of the lines `pass` from `readyAt` to `endAt`, and `writes` is each line `write` up to `endAt`, with its times. A run
 * whose contract names no line of a kind gives null for that field.
 */
export const runLineFields = (
  kinds: readonly { readonly kind: string }[],
  lines: readonly RecordedLine[],
  readyAt: number,
  endAt: number,
): { readonly passes: number | null; readonly writes: readonly Readonly<Record<string, number>>[] | null } => {
  const named = new Set(kinds.map((each) => each.kind));
  const passes = named.has("pass") ? lines.filter((line) => line.kind === "pass" && line.ms >= readyAt && line.ms <= endAt).length : null;
  const writes = named.has("write")
    ? lines
        .filter((line) => line.kind === "write" && line.ms <= endAt)
        .map((line) => {
          const times: Record<string, number> = { ms: line.ms };
          for (const key of WRITE_FIELDS) {
            const value = line.fields[key];
            if (typeof value === "number" && Number.isFinite(value)) times[key] = value;
          }
          return times;
        })
    : null;
  return { passes, writes };
};
