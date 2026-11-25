/**
 * The command of the swap of a runner. The workflows `lab.yml` and `start-gate.yml` start it before a start case.
 *
 * ```text
 * node src/swap.main.ts <bytes>
 * ```
 *
 * - Some runners have no swap. The check child of a start case refuses a host with less swap than its target (`planSwap`).
 * - The command adds a swap file when the runner has less swap than the bytes of its argument (`swapFileMiB`).
 * - A command that fails gives the exit code 1.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { errorMessage } from "@mark1russell7/text";
import { swapCommandsOf, swapFileMiB, swapNeedOf, swapTotalOf } from "./swap.ts";

try {
  const need = swapNeedOf(process.argv[2]);
  const mib = swapFileMiB(need, swapTotalOf(readFileSync("/proc/meminfo", "utf8")));
  for (const [command, ...args] of swapCommandsOf(mib)) execFileSync(command, args, { stdio: "inherit" });
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
