// The work of one request of a synthetic subject, with no transport. Each subject (a server of
// node:http, the service runner, a different protocol) does this same work, thus a difference
// between two subjects is the cost of the transport and of the layer.

import { getHeapStatistics } from "node:v8";
import type { RequestClass } from "./class.ts";

/**
 * This function gives the CPU time that the process used from its start, in microseconds. It is
 * the clock of the work. A test holds its resolution on Linux, where the subjects are.
 */
export const processCpu = (): number => {
  const usage = process.cpuUsage();
  return usage.user + usage.system;
};

let sink = 0;

/** This function does `count` turns of a small calculation. A turn allocates no memory, and it asks nothing of the system. */
export const turn = (count: number): void => {
  let value = sink;
  for (let at = 0; at < count; at += 1) value = (Math.imul(value, 1_664_525) + 1_013_904_223) | 0;
  sink = value;
};

/** This count is the turns of the smallest piece of work: approximately 1 microsecond of compiled code. */
export const SMALLEST = 1024;
/** This count is the turns of the largest piece of work. It is the limit when the clock does not move. */
export const LARGEST: number = 1024 * 1024;

/**
 * This function uses the CPU for `us` microseconds of CPU time of the process. It blocks the
 * event loop.
 *
 * The time is CPU time, not time on a clock. A CPU limit that stops the container makes the work
 * longer, and it does not make the work smaller.
 *
 * The work is pieces of turns with one read of the clock between two pieces. The speed of a piece
 * gives the size of the next piece: half of the time that stays. Thus the work has few reads of
 * the clock, and it ends no more than one small piece after its time.
 */
export const spin = (us: number, clock: () => number = processCpu, burn: (count: number) => void = turn): void => {
  if (us <= 0) return;
  let at = clock();
  const end = at + us;
  let count = SMALLEST;
  while (at < end) {
    burn(count);
    const next = clock();
    const wanted = next > at ? ((count / (next - at)) * (end - next)) / 2 : count * 2;
    count = Math.min(Math.max(Math.floor(wanted), SMALLEST), LARGEST);
    at = next;
  }
};

/** This count is the numbers of one piece of garbage. A piece of 8 KiB stays in the young generation. */
const PIECE = 1024;
/** This count is the bytes of one number of an array of V8 in Node, which has no pointer compression. */
const NUMBER_BYTES = 8;

let garbage: number[] = [];

/**
 * This function allocates `bytes` bytes of arrays and drops them. Only the last piece stays, until
 * the next call. Thus the allocation rate of a subject is the rate of its requests times `alloc`.
 */
export const allocate = (bytes: number): void => {
  for (let left = bytes; left > 0; left -= PIECE * NUMBER_BYTES) {
    garbage = new Array<number>(Math.ceil(Math.min(left, PIECE * NUMBER_BYTES) / NUMBER_BYTES)).fill(0);
  }
};

/** This function gives the count of numbers of the last piece of garbage. A test reads it. */
export const lastGarbage = (): number => garbage.length;

/** This function gives the bytes of the heap that are in use. The count has the garbage that the collector did not free. */
export const usedHeap = (): number => getHeapStatistics().used_heap_size;

/** This count is the entries of one piece of the ballast. */
export const BALLAST_PIECE = 1024;

/**
 * This function makes live objects until the used heap is `bytes` larger, and it gives them in
 * pieces. The objects are small, thus the garbage collector has many objects to visit. A caller
 * keeps the pieces for the life of the process: they are the live heap of the subject.
 *
 * The size is a setting, not a reading: the used heap also has garbage. A piece has a fixed
 * size, thus the pieces make no garbage.
 */
export const ballastOf = (bytes: number, used: () => number = usedHeap): readonly (readonly object[])[] => {
  const held: object[][] = [];
  if (bytes <= 0) return held;
  const end = used() + bytes;
  while (used() < end) {
    const piece = new Array<object>(BALLAST_PIECE);
    for (let at = 0; at < BALLAST_PIECE; at += 1) piece[at] = { id: at, next: [at] };
    held.push(piece);
  }
  return held;
};

let filler = Buffer.alloc(0);

/**
 * This function gives a reply of `bytes` bytes, each the letter `x`. The reply is a part of one
 * buffer that grows to the largest reply. Thus a reply allocates no memory for its bytes.
 */
export const replyOf = (bytes: number): Buffer => {
  if (bytes > filler.length) {
    let size = Math.max(filler.length, 1024);
    while (size < bytes) size *= 2;
    filler = Buffer.alloc(size, "x");
  }
  return filler.subarray(0, bytes);
};

/**
 * This function does the work of a request after the subject read its body. It allocates, it
 * works, and it waits. Then it gives the reply to `done`.
 */
export const perform = (asked: RequestClass, done: (reply: Buffer) => void): void => {
  allocate(asked.alloc);
  spin(asked.work);
  if (asked.wait === 0) done(replyOf(asked.reply));
  else setTimeout(() => done(replyOf(asked.reply)), asked.wait);
};
