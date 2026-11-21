import { describe, expect, it } from "vitest";
import { EMPTY } from "./class.ts";
import { BALLAST_PIECE, LARGEST, SMALLEST, allocate, ballastOf, lastGarbage, perform, processCpu, replyOf, spin, usedHeap } from "./perform.ts";

/**
 * This function makes a CPU for a test: a clock in whole microseconds, and work that moves the
 * clock at `speed` turns for each microsecond. The clock shows a time only at each `step`.
 */
const machineOf = (speed: number, step = 1) => {
  const machine = {
    time: 0,
    reads: 0,
    pieces: [] as number[],
    clock: (): number => {
      machine.reads += 1;
      return Math.floor(machine.time / step) * step;
    },
    burn: (count: number): void => {
      machine.pieces.push(count);
      machine.time += count / speed;
    },
  };
  return machine;
};

const onLinux = process.platform === "linux";

/** This function reads a clock for some milliseconds, and it gives each step between two values of the clock, in order of size. */
const stepsOf = (clock: () => number, ms: number): readonly number[] => {
  const steps: number[] = [];
  const end = performance.now() + ms;
  let last = clock();
  while (performance.now() < end) {
    const next = clock();
    if (next !== last) steps.push(next - last);
    last = next;
  }
  return steps.sort((a, b) => a - b);
};

const middle = (sorted: readonly number[]): number => sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;

describe("spin", () => {
  it.each([
    [100, 50],
    [1000, 700],
    [5000, 1000],
    [250_000, 3],
  ])("works for %d microseconds at %d turns for each microsecond, and no more than one small piece above", (us, speed) => {
    const machine = machineOf(speed);
    spin(us, machine.clock, machine.burn);
    expect(machine.time).toBeGreaterThanOrEqual(us);
    // The clock shows whole microseconds, thus the work can end 1 microsecond after the last small piece.
    expect(machine.time).toBeLessThan(us + SMALLEST / speed + 1);
  });

  it("reads the clock a small number of times", () => {
    const machine = machineOf(1000);
    spin(100_000, machine.clock, machine.burn);
    // The largest piece is about 1049 microseconds at this speed: 96 such pieces, then the halves of the rest.
    expect(machine.reads).toBeLessThan(100_000 / (LARGEST / 1000) + 30);
    expect(Math.max(...machine.pieces)).toBe(LARGEST);
  });

  it("does larger pieces when the clock does not move, to the largest piece", () => {
    // A clock of Windows: it shows a time only at each 15 625 microseconds.
    const machine = machineOf(1000, 15_625);
    spin(2000, machine.clock, machine.burn);
    expect(machine.time).toBeGreaterThanOrEqual(15_625);
    expect(machine.time).toBeLessThan(15_625 + LARGEST / 1000);
    expect(Math.max(...machine.pieces)).toBeLessThanOrEqual(LARGEST);
    expect(machine.pieces.slice(0, 4)).toEqual([SMALLEST, SMALLEST * 2, SMALLEST * 4, SMALLEST * 8]);
  });

  it("does not read the clock for no time", () => {
    const machine = machineOf(1000);
    spin(0, machine.clock, machine.burn);
    expect(machine.reads).toBe(0);
    expect(machine.pieces).toEqual([]);
  });

  it("uses at least the CPU time on the clock of the process", () => {
    const start = processCpu();
    spin(2000);
    expect(processCpu() - start).toBeGreaterThanOrEqual(2000);
  });
});

describe("the clock of the work on Linux", () => {
  it.skipIf(!onLinux)("moves in steps of 50 microseconds or less", () => {
    const thread = (): number => {
      const usage = process.threadCpuUsage();
      return usage.user + usage.system;
    };
    const steps = { process: stepsOf(processCpu, 40), thread: stepsOf(thread, 40) };
    // The log shows the clock that the work does not use, to compare.
    console.info(
      `clock steps in microseconds: ${JSON.stringify({
        process: { values: steps.process.length, smallest: steps.process[0], middle: middle(steps.process), largest: steps.process.at(-1) },
        thread: { values: steps.thread.length, smallest: steps.thread[0], middle: middle(steps.thread), largest: steps.thread.at(-1) },
      })}`,
    );
    expect(steps.process.length).toBeGreaterThan(100);
    expect(middle(steps.process)).toBeLessThanOrEqual(50);
  });

  // The clock of the process adds the CPU time of each of its threads. Thus a thread of V8 that
  // runs during the last piece adds its time to one run: the CI run 44921110367 gave the runs
  // [11, 10, 1138, 13, 14] microseconds above. The middle run holds the bound. Each run holds 0.
  it.skipIf(!onLinux)("gives work of the CPU time, and the middle run is no more than 5 % above", () => {
    spin(20_000);
    const overs: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const start = processCpu();
      spin(20_000);
      overs.push(processCpu() - start - 20_000);
    }
    console.info(`work above 20 000 microseconds, in microseconds: ${JSON.stringify(overs)}`);
    expect(Math.min(...overs)).toBeGreaterThanOrEqual(0);
    expect(middle([...overs].sort((a, b) => a - b))).toBeLessThanOrEqual(1000);
  });
});

describe("allocate", () => {
  it("allocates pieces of 8 KiB, and the last piece is the rest", () => {
    allocate(8192);
    expect(lastGarbage()).toBe(1024);
    allocate(20_000);
    expect(lastGarbage()).toBe(Math.ceil((20_000 - 2 * 8192) / 8));
    allocate(1);
    expect(lastGarbage()).toBe(1);
  });

  it("allocates nothing for 0 bytes", () => {
    allocate(64);
    allocate(0);
    expect(lastGarbage()).toBe(8);
  });
});

describe("ballastOf", () => {
  it("gives no piece for 0 bytes, and it does not read the heap", () => {
    let reads = 0;
    expect(ballastOf(0, () => reads++)).toEqual([]);
    expect(reads).toBe(0);
  });

  it("adds pieces until the used heap is larger by the bytes", () => {
    // The heap of the test: 600 bytes larger at each read after the first read.
    let reads = 0;
    const held = ballastOf(1000, () => 600 * Math.max(0, reads++ - 1));
    // The reads give 0 at the start, then 0, 600 and 1200: two pieces, then the end.
    expect(held).toHaveLength(2);
    expect(reads).toBe(4);
    for (const piece of held) expect(piece).toHaveLength(BALLAST_PIECE);
    expect(held[0]?.[5]).toEqual({ id: 5, next: [5] });
  });

  it("holds objects of the real heap", () => {
    const bytes = 4 * 1024 * 1024;
    const start = usedHeap();
    const held = ballastOf(bytes);
    // An entry is less than 256 bytes, thus the pieces have at least this count of entries.
    expect(held.length * BALLAST_PIECE).toBeGreaterThanOrEqual(bytes / 256);
    expect(usedHeap()).toBeGreaterThan(start);
  });
});

describe("replyOf", () => {
  it("gives the bytes of the reply, each the letter x", () => {
    expect(replyOf(0)).toHaveLength(0);
    for (const bytes of [1, 1000, 1024, 1025, 70_000]) {
      const reply = replyOf(bytes);
      expect(reply).toHaveLength(bytes);
      expect(reply.every((byte) => byte === 0x78)).toBe(true);
    }
  });

  it("gives a part of one buffer, thus a smaller reply allocates no bytes", () => {
    const large = replyOf(100_000);
    const small = replyOf(10);
    expect(small.buffer).toBe(large.buffer);
    expect(small).toHaveLength(10);
  });
});

describe("perform", () => {
  it("gives the reply at once for a class with no wait", () => {
    let reply: Buffer | undefined;
    perform({ ...EMPTY, alloc: 100, reply: 7 }, (bytes) => {
      reply = bytes;
    });
    expect(reply).toHaveLength(7);
  });

  it("gives the reply after the wait", async () => {
    const start = performance.now();
    const reply = await new Promise<Buffer>((resolve) => perform({ ...EMPTY, wait: 30, reply: 3 }, resolve));
    expect(performance.now() - start).toBeGreaterThanOrEqual(25);
    expect(reply).toHaveLength(3);
  });
});
