import { describe, expect, it } from "vitest";
import { swapCommandsOf, swapFileMiB, swapNeedOf, swapTotalOf } from "./swap.ts";

describe("the swap of a runner", () => {
  it("reads the need and the swap of the runner", () => {
    expect(swapNeedOf("2147483648")).toBe(2147483648);
    expect(() => swapNeedOf("2G")).toThrow('The swap is not a whole number of bytes: "2G".');
    expect(() => swapNeedOf(undefined)).toThrow(RangeError);
    expect(swapTotalOf("MemTotal:       16384000 kB\nSwapTotal:       4194300 kB\nSwapFree:  4194300 kB\n")).toBe(4194300 * 1024);
    expect(() => swapTotalOf("MemTotal: 1 kB\n")).toThrow("no line SwapTotal");
  });

  it("adds a file with one MiB more than the shortfall, and no file when the runner has enough swap", () => {
    expect(swapFileMiB(2147483648, 0)).toBe(2049);
    expect(swapFileMiB(2147483648, 1048576)).toBe(2048);
    expect(swapFileMiB(2147483648, 2147483648)).toBe(0);
    expect(swapCommandsOf(0)).toEqual([]);
    expect(swapCommandsOf(2049)).toEqual([
      ["sudo", "fallocate", "-l", "2049M", "/lab.swap"],
      ["sudo", "chmod", "600", "/lab.swap"],
      ["sudo", "mkswap", "/lab.swap"],
      ["sudo", "swapon", "/lab.swap"],
    ]);
  });
});
