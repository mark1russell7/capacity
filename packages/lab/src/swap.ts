/** The bytes of one mebibyte. */
const MIB = 1048576;

/** This function gives the bytes of a swap from the text of the argument. It throws a `RangeError` on a text that is not a whole number. */
export const swapNeedOf = (text: string | undefined): number => {
  if (text === undefined || !/^\d+$/.test(text)) throw new RangeError(`The swap is not a whole number of bytes: "${text ?? ""}".`);
  return Number(text);
};

/** This function gives the bytes of the line `SwapTotal` of the text of `/proc/meminfo`. */
export const swapTotalOf = (meminfo: string): number => {
  const match = /^SwapTotal:\s+(\d+) kB$/m.exec(meminfo);
  if (match === null) throw new RangeError("The text of /proc/meminfo has no line SwapTotal.");
  return Number(match[1]) * 1024;
};

/**
 * This function gives the size in MiB of the swap file that a runner with `have` bytes of swap needs for `need` bytes.
 * The header of a swap file takes one page, thus the file has 1 MiB more. The size is 0 when the runner has enough swap.
 */
export const swapFileMiB = (need: number, have: number): number => (have >= need ? 0 : Math.ceil((need - have) / MIB) + 1);

/** This function gives the commands that add a swap file of `mib` MiB, as argv lists. A size of 0 gives no command. */
export const swapCommandsOf = (mib: number, file: string = "/lab.swap"): readonly (readonly [string, ...string[]])[] =>
  mib === 0
    ? []
    : [
        ["sudo", "fallocate", "-l", `${mib}M`, file],
        ["sudo", "chmod", "600", file],
        ["sudo", "mkswap", file],
        ["sudo", "swapon", file],
      ];
