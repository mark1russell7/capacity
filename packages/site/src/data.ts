import type { KneeRule, Law } from "@mark1russell7/capacity";
import type { LawEntry, PlanEntry } from "./coverage.ts";

// Each glob imports one field of each law file. The build keeps only these fields in the page, and not the replicates.
const lawIds = import.meta.glob<string>("../../capacity/laws/**/*.law.json", { eager: true, import: "id" });
const lawTitles = import.meta.glob<string>("../../capacity/laws/**/*.law.json", { eager: true, import: "title" });
const lawSubjects = import.meta.glob<string>("../../capacity/laws/**/*.law.json", { eager: true, import: "subject" });
const lawVariables = import.meta.glob<Law["variables"]>("../../capacity/laws/**/*.law.json", { eager: true, import: "variables" });
const lawMeasures = import.meta.glob<Law["measure"]>("../../capacity/laws/**/*.law.json", { eager: true, import: "measure" });
const lawConditions = import.meta.glob<Law["conditions"]>("../../capacity/laws/**/*.law.json", { eager: true, import: "conditions" });

// This glob loads the text of a whole law file only when a reader opens a cell of the law.
const lawTexts = import.meta.glob<string>("../../capacity/laws/**/*.law.json", { query: "?raw", import: "default" });

interface PlanFile {
  readonly id: string;
  readonly title: string;
  readonly cases: readonly { readonly subject: string }[];
  readonly laws?: {
    readonly class: string;
    readonly variable: { readonly id: string };
    readonly measures: readonly { readonly id: string; readonly knee?: KneeRule }[];
  };
  readonly startLaws?: { readonly variable: { readonly id: string }; readonly measures: readonly { readonly id: string; readonly law: string }[] };
}

const planFiles = import.meta.glob<PlanFile>("../../lab/plans/*.json", { eager: true, import: "default" });

/** These entries are the law files of the package capacity, in the order of their paths. */
export const LAWS: readonly LawEntry[] = Object.keys(lawIds)
  .sort()
  .map((path) => ({
    path,
    id: lawIds[path]!,
    title: lawTitles[path]!,
    subject: lawSubjects[path]!,
    variables: lawVariables[path]!.map((each) => each.id),
    measure: lawMeasures[path]!.id,
    unit: lawMeasures[path]!.unit,
    cpu: String(lawConditions[path]!["cpu.model"] ?? "an unknown CPU"),
    lawClass: typeof lawConditions[path]!["class"] === "string" ? (lawConditions[path]!["class"] as string) : undefined,
  }));

/** These entries are the plans of the lab, in the order of their paths. */
export const PLANS: readonly PlanEntry[] = Object.keys(planFiles)
  .sort()
  .map((path) => planEntry(planFiles[path]!));

/** This function gives the entry of a plan file: the subjects of its cases, the variable of its laws and its start measures. A law name keys each start measure. */
export function planEntry(plan: PlanFile): PlanEntry {
  return {
    id: plan.id,
    title: plan.title,
    subjects: [...new Set(plan.cases.map((each) => each.subject))],
    variable: plan.laws?.variable.id ?? plan.startLaws?.variable.id,
    start: Object.fromEntries((plan.startLaws?.measures ?? []).map((each) => [each.law, each.id])),
    lawClass: plan.laws?.class,
    knees: Object.fromEntries((plan.laws?.measures ?? []).flatMap((each) => (each.knee === undefined ? [] : [[each.id, each.knee]]))),
  };
}

/** This function loads the whole law file of an entry, with its replicates. */
export const loadLaw = async (entry: LawEntry): Promise<Law> => JSON.parse(await lawTexts[entry.path]!()) as Law;
