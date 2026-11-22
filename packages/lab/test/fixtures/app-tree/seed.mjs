// The seed of the app of the tests: it writes a log of the bytes of --log into the folder --out.
// Its last line gives the amount that it wrote, as the contract of an app tells.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { out: { type: "string" }, log: { type: "string" } } });
const bytes = Number(values.log);
writeFileSync(join(values.out, "log"), Buffer.alloc(bytes, 120));
console.log("The seed wrote the log.");
console.log(JSON.stringify({ amounts: { log: bytes } }));
