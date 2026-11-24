// The watch of the event loop of a subject. Each 100 ms, the subject writes one line `loop` with the
// span of the watch (`watchEventLoop` of `@mark1russell7/lag/node`). A run of 1 s thus has about 10 spans.
//
// - `ms` is the length of the span. The line `t` is the end of the span.
// - `resolution` is the step of the timer of the histogram, in ms. Each sample of the delay is the time
//   between two firings of that timer. Thus the lag of a sample is the sample less the resolution.
// - `count` is the samples of the span. `mean` and `max` are their mean and their largest delay in ms, or null with no sample.
//   The count and the mean of each span give the mean of a run, with no error.
// - `active` and `idle` are the busy and the idle time of the loop in the span, in ms, or null.

import { watchEventLoop } from "@mark1russell7/lag/node";
import { emit } from "./lines.ts";

/** This time is the length of each span of the watch, in ms. */
export const LOOP_PERIOD_MS = 100;

/**
 * This function starts the watch of the event loop, and it writes one line `loop` at each period. It gives the function
 * that stops the watch. The timer does not keep the process alive.
 */
export const watchLoop = (periodMs: number = LOOP_PERIOD_MS): (() => void) => {
  const watch = watchEventLoop();
  const timer = setInterval(() => {
    const span = watch.span();
    emit("loop", {
      ms: span.durationMs,
      resolution: span.resolutionMs,
      count: span.delay?.count ?? 0,
      mean: span.delay?.meanMs ?? null,
      max: span.delay?.maxMs ?? null,
      active: span.busy?.activeMs ?? null,
      idle: span.busy?.idleMs ?? null,
    });
  }, periodMs);
  // a helper timer: the server keeps the process alive, not the watch
  timer.unref();
  return () => {
    clearInterval(timer);
    watch.stop();
  };
};
