import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GATE_ALPHA, GATE_JOBS, lawGate, lawRead, type GateCase, type GateJob, type GateRead } from "./gate.ts";
import type { Law } from "./law.ts";
import { sampleLaw } from "./sample.fixture.ts";
import { lawValue } from "./value.ts";

/** These rates are the sample points of a job: each one is in the range of the sample law, from 100 to 4000. */
const RATES = [100, 200, 400, 800, 1200, 1600, 2400, 3000] as const;

/** This function gives the value of a law at a rate with its constants. */
const valueAt = (law: Law, rate: number): number => {
  const found = lawValue(law, { rate });
  if (found.tag === "err") throw new Error(found.error.message);
  return found.value.value;
};

/** This function gives one read at each rate: the value of the law times a factor. */
const readsOf = (law: Law, factor: number, rates: readonly number[] = RATES): readonly GateRead[] =>
  rates.map((rate) => ({ point: { rate }, value: valueAt(law, rate) * factor }));

/** This function gives a job with one read at each rate, at the value of the law times a factor. */
const jobOf = (law: Law, name: string, factor: number, rates?: readonly number[]): GateJob => ({ job: name, reads: readsOf(law, factor, rates) });

const caseOf = (law: Law, factors: readonly number[]): GateCase => ({ law, jobs: factors.map((factor, index) => jobOf(law, `job ${index + 1}`, factor)) });

describe("lawRead", () => {
  it("tells a value within, above and below the run range of the law", () => {
    const law = sampleLaw();
    const value = valueAt(law, 1000);
    const within = lawRead(law, { rate: 1000 }, value);
    expect(within.tag === "ok" && within.value.side).toBe("within");
    const high = lawRead(law, { rate: 1000 }, value * 1.5);
    expect(high.tag === "ok" && high.value.side).toBe("high");
    const low = lawRead(law, { rate: 1000 }, value / 1.5);
    expect(low.tag === "ok" && low.value.side).toBe("low");
    if (within.tag === "ok") {
      expect(within.value.run.low).toBeLessThan(value);
      expect(within.value.run.high).toBeGreaterThan(value);
    }
  });

  it("uses the run range of lawValue at the level of the options", () => {
    const law = sampleLaw();
    const read = lawRead(law, { rate: 2000 }, 1, { level: 0.9 });
    const value = lawValue(law, { rate: 2000 }, { level: 0.9 });
    expect(read.tag === "ok" && value.tag === "ok" && read.value.run).toEqual(value.tag === "ok" ? value.value.run : undefined);
  });

  it("gives a problem for a point outside the range of the law, and for a value that is not finite", () => {
    const law = sampleLaw();
    const outside = lawRead(law, { rate: 5000 }, 0.2);
    expect(outside.tag === "err" && outside.error.code).toBe("point");
    expect(outside.tag === "err" && outside.error.message).toContain("from 100 to 4000");
    const nan = lawRead(law, { rate: 1000 }, Number.NaN);
    expect(nan.tag === "err" && nan.error.code).toBe("value");
    const level = lawRead(law, { rate: 1000 }, 0.1, { level: 0.999 });
    expect(level.tag === "err" && level.error.code).toBe("level");
  });
});

describe("lawGate", () => {
  it("passes jobs whose reads agree with their law", () => {
    const gate = lawGate([caseOf(sampleLaw(), [1, 1.01, 0.99])]);
    expect(gate.outcome).toBe("pass");
    expect(gate.cases[0]?.outcome).toBe("within");
    expect(gate.cases[0]?.jobs.map((job) => [job.reads, job.high, job.low])).toEqual([
      [8, 0, 0],
      [8, 0, 0],
      [8, 0, 0],
    ]);
    expect(gate.level).toBe(0.95);
    expect(gate.alpha).toBe(GATE_ALPHA);
    expect(gate.need).toBe(GATE_JOBS);
    expect(gate.share).toBeCloseTo(0.025, 12);
  });

  it("blocks a measure above its law in two jobs, and a measure below it", () => {
    const high = lawGate([caseOf(sampleLaw(), [1.5, 1.5])]);
    expect(high.outcome).toBe("block");
    expect(high.blocks).toEqual(["node-http/reply/cpu"]);
    expect(high.cases[0]?.reason).toContain("above its law");
    expect(high.cases[0]?.sides.map((side) => [side.side, side.reject])).toEqual([
      ["high", true],
      ["low", false],
    ]);
    const low = lawGate([caseOf(sampleLaw(), [0.6, 0.6, 1])]);
    expect(low.outcome).toBe("block");
    expect(low.cases[0]?.reason).toContain("below its law");
  });

  it("does not block on one job alone, because one runner can be odd", () => {
    const gate = lawGate([caseOf(sampleLaw(), [1.5, 1, 1])]);
    expect(gate.outcome).toBe("pass");
    expect(gate.cases[0]?.jobs[0]?.high).toBe(8);
    const two = lawGate([caseOf(sampleLaw(), [1.5, 1, 1])], { jobs: 1 });
    expect(two.outcome).toBe("block");
  });

  it("gives no read for a case with too few jobs, and lists each job with no read", () => {
    const law = sampleLaw();
    const noisy: GateJob = { job: "noisy", reads: readsOf(law, 1), noRead: "The noise floor of cpu is 0.3. Its limit is 0.1." };
    const gate = lawGate([{ law, jobs: [jobOf(law, "quiet", 1), noisy] }]);
    expect(gate.outcome).toBe("no read");
    expect(gate.noRead).toEqual(["node-http/reply/cpu"]);
    expect(gate.cases[0]?.outcome).toBe("cannot decide");
    expect(gate.cases[0]?.reason).toContain("1 jobs read the law. The gate needs 2 jobs or more. The noise floor of cpu is 0.3.");
    expect(gate.cases[0]?.noRead).toEqual([{ job: "noisy", reason: "The noise floor of cpu is 0.3. Its limit is 0.1." }]);
  });

  it("does not read a point outside the range of the law, and gives no read for a job with no read in the range", () => {
    const law = sampleLaw();
    const gate = lawGate([{ law, jobs: [jobOf(law, "a", 1, [1000, 5000]), jobOf(law, "b", 1, [6000]), jobOf(law, "c", 1)] }]);
    const [found] = gate.cases;
    expect(found?.jobs.map((job) => [job.job, job.reads, job.unread.length])).toEqual([
      ["a", 1, 1],
      ["c", 8, 0],
    ]);
    expect(found?.noRead[0]?.job).toBe("b");
    expect(found?.noRead[0]?.reason).toContain("no read in the range of the law");
  });

  it("keeps each read that the caller left out, and gives no read for a job with only such reads", () => {
    const law = sampleLaw();
    const left = "rate/30000: the subject served 0.9 of the offered rate. The law needs 0.97.";
    const gate = lawGate([{ law, jobs: [{ ...jobOf(law, "a", 1), unread: [left] }, jobOf(law, "b", 1), { job: "c", reads: [], unread: [left] }] }]);
    const [found] = gate.cases;
    expect(found?.jobs.map((job) => [job.job, job.reads, job.unread])).toEqual([
      ["a", 8, [left]],
      ["b", 8, []],
    ]);
    expect(found?.noRead).toEqual([{ job: "c", reason: `The job has no read in the range of the law. ${left}` }]);
    expect(gate.outcome).toBe("pass");
  });

  it("gives no read for reads too few to reject a side, also with each read on that side", () => {
    const law = sampleLaw();
    const gate = lawGate([{ law, jobs: [jobOf(law, "a", 3, [1000]), jobOf(law, "b", 3, [2000])] }]);
    expect(gate.outcome).toBe("no read");
    expect(gate.cases[0]?.reason).toContain("too few to reject a side");
  });

  it("blocks when one case is beyond, also with a case that cannot decide", () => {
    const law = sampleLaw();
    const other: Law = { ...law, id: "node-http/reply/memory" };
    const gate = lawGate([caseOf(law, [1.5, 1.5]), caseOf(other, [1])]);
    expect(gate.outcome).toBe("block");
    expect(gate.blocks).toEqual(["node-http/reply/cpu"]);
    expect(gate.noRead).toEqual(["node-http/reply/memory"]);
  });

  it("gives no read with no case, never a pass", () => {
    expect(lawGate([]).outcome).toBe("no read");
  });

  it.each([{ level: 1 }, { level: 0 }, { alpha: 0 }, { alpha: 1 }, { jobs: 0 }, { jobs: 1.5 }])("refuses the options %o", (options) => {
    expect(() => lawGate([], options)).toThrow(RangeError);
  });

  it("never blocks reads at the law, and never passes reads far above it, for each count of jobs (property test)", () => {
    const law = sampleLaw();
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 8 }), fc.integer({ min: 3, max: 8 }), (jobs, count) => {
        const rates = RATES.slice(0, count);
        const at = lawGate([{ law, jobs: Array.from({ length: jobs }, (_, index) => jobOf(law, `job ${index}`, 1, rates)) }]);
        expect(at.outcome).toBe("pass");
        const far = lawGate([{ law, jobs: Array.from({ length: jobs }, (_, index) => jobOf(law, `job ${index}`, 2, rates)) }]);
        expect(far.outcome).toBe("block");
      }),
    );
  });

  it("gives the same outcome for each order of the jobs (property test)", () => {
    const law = sampleLaw();
    fc.assert(
      fc.property(fc.shuffledSubarray([1, 1, 1.5, 1.5, 0.6, 1.02], { minLength: 2 }), (factors) => {
        const forward = lawGate([caseOf(law, factors)]);
        const backward = lawGate([caseOf(law, [...factors].reverse())]);
        expect(backward.outcome).toBe(forward.outcome);
        expect(backward.cases[0]?.sides.map((side) => side.adjusted)).toEqual(forward.cases[0]?.sides.map((side) => side.adjusted));
      }),
    );
  });
});
