import { constantIntervals, type Law } from "@mark1russell7/capacity";
import { byId, copyText, setupTheme } from "@mark1russell7/site-pages/chrome";
import { curveChart, stackChart } from "./chart.ts";
import { coverage, cpuModels, cpuName, goalCells, kneeRuleOf, nextItem, tally, type Cell, type SubjectMatrix } from "./coverage.ts";
import { amountText, curveOf, significant as amount, unitWords } from "./curves.ts";
import { COMPOSITIONS, LAWS, PLANS, loadLaw, loadLaws } from "./data.ts";
import { lawIdsOf, stackBaseOf, stackOf } from "./stack.ts";

const ROADMAP = "https://github.com/mark1russell7/capacity/blob/main/docs/ROADMAP.md";
const STATE_TEXT = { law: "A law with its interval", measured: "Measured in CI, no law yet", none: "Not measured" } as const;
const STATE_MARK = { law: "●", measured: "◐", none: "·" } as const;

setupTheme(byId<HTMLButtonElement>("theme"), "theme");

const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

/** This function makes an element with a class and a text. */
const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className !== "") element.className = className;
  if (text !== "") element.textContent = text;
  return element;
};

const percentText = (value: number): string => (value === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1));

const models = cpuModels(LAWS);
const select = byId<HTMLSelectElement>("cpu");
for (const model of models) select.append(new Option(cpuName(model), model));
if (models.length === 0) byId("cpu-label").hidden = true;

interface Selection {
  readonly subject: string;
  readonly row: string;
  readonly family: string;
}

/** This function reads the selected cell from the hash of the address, for example `#node.rate.cpu`. */
const selectionOf = (hash: string): Selection | undefined => {
  const [subject, row, family, ...rest] = decodeURIComponent(hash.replace(/^#/, "")).split(".");
  return subject && row && family && rest.length === 0 ? { subject, row, family } : undefined;
};

let selected = selectionOf(location.hash);

/** This function shows the counts of the goal and the bar of each subject. */
const showDone = (matrices: readonly SubjectMatrix[]): void => {
  const all = tally(goalCells(matrices));
  byId("percent").textContent = percentText(all.percent);
  byId("done-text").textContent =
    `${all.law} of the ${all.cells} cells of the goal have a law. ${all.measured} have measures with no law, and ${all.none} have no measure.`;
  const bars = byId("bars");
  bars.replaceChildren(
    ...matrices.map((matrix) => {
      const counts = tally(goalCells([matrix]));
      const item = make("li");
      const head = make("div", "bar-head");
      head.append(make("span", "bar-name", matrix.subject.title), make("span", "bar-count", `${counts.law} laws, ${counts.measured} measured, of ${counts.cells}`));
      const bar = make("div", "bar");
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${matrix.subject.title}: ${counts.law} cells with a law, ${counts.measured} measured with no law, ${counts.none} not measured.`);
      for (const state of ["law", "measured", "none"] as const) {
        const part = make("span", `part ${state}`);
        part.style.flexGrow = String(counts[state]);
        bar.append(part);
      }
      item.append(head, bar);
      return item;
    }),
  );
};

/** This function shows the details of a law: its curve and knee, its form, the interval of each constant, its range and its runs. */
const lawDetails = (entry: (typeof LAWS)[number]): HTMLElement => {
  const box = make("div", "law-box");
  box.append(make("h4", "", entry.title));
  const facts = make("p", "facts", `The measure ${entry.measure}, in ${entry.unit}. The law file loads.`);
  box.append(facts);
  void loadLaw(entry).then(
    (law: Law) => {
      const variable = law.variables.map((each) => `${each.id} from ${amount(each.min)} to ${amount(each.max)} ${unitWords(each.unit)}`).join(", ");
      facts.textContent = `The measure ${law.measure.id}, in ${law.measure.unit}. The form ${law.form.id}, over ${variable}.`;
      const curve = curveOf(law, kneeRuleOf(entry, PLANS));
      box.append(typeof curve === "string" ? make("p", "quiet", curve) : curveChart(curve, entry.title));
      const intervals = constantIntervals(law);
      if (intervals.tag === "ok") {
        const table = make("table", "constants");
        const level = Math.round((intervals.value[0]?.level ?? 0.95) * 100);
        const caption = make("caption", "", `Each constant, with its ${level} % interval from ${law.replicates.length} bootstrap fits`);
        table.append(caption);
        if (intervals.value.some((each) => each.id === "knee")) {
          caption.append(". The constant knee is the bend of the form, not the knee of the rule of the lab in the chart");
        }
        for (const each of intervals.value) {
          const row = make("tr");
          row.append(make("th", "", each.id), make("td", "", amount(each.value)), make("td", "quiet", `${amount(each.interval.low)} to ${amount(each.interval.high)}`));
          table.append(row);
        }
        box.append(table);
      } else {
        box.append(make("p", "quiet", `The law has no interval: ${intervals.error.message}`));
      }
      const runs = make("p", "runs", "The runs: ");
      law.evidence.runs.forEach((run, index) => {
        if (index > 0) runs.append(", ");
        const link = make("a", "", run.date.slice(0, 10));
        link.href = run.url;
        runs.append(link);
      });
      runs.append(`. The noise floor of the measure is ${amountText(law.noise.floor, law.measure.unit)}: a smaller change is not a result.`);
      box.append(runs);
    },
    (error: unknown) => {
      facts.textContent = `The law file did not load: ${String(error)}`;
    },
  );
  return box;
};

/** This function gives the details of a cell: its laws, or the plans that measure it, and its next item. */
const cellDetails = (matrix: SubjectMatrix, cell: Cell): HTMLElement => {
  const row = matrix.rows.find((each) => each.id === cell.row)!;
  const family = matrix.families.find((each) => each.id === cell.family)!;
  const box = make("div", "detail");
  box.setAttribute("role", "region");
  box.setAttribute("aria-label", `${matrix.subject.title}, ${row.id}, ${family.title}`);
  box.append(make("h3", "", `${family.title} over ${row.id}`), make("p", `state ${cell.state}`, `${STATE_MARK[cell.state]} ${STATE_TEXT[cell.state]}`));
  box.append(make("p", "quiet", `${row.title}. ${matrix.subject.note}`));
  if (cell.state === "law") {
    for (const law of cell.laws) box.append(lawDetails(law));
  } else if (cell.state === "measured") {
    box.append(make("p", "", `The plans ${cell.plans.map((each) => each.id).join(", ")} of the lab record this measure on each run of CI. No law of it is fitted yet.`));
  } else {
    box.append(make("p", "", "No plan of the lab measures this cell yet."));
  }
  const next = nextItem(cell);
  const item = make("p", "next");
  const link = make("a", "", `${next.id}: ${next.title}`);
  link.href = ROADMAP;
  item.append(cell.state === "law" ? "The item of this law: " : "The item that gives its law: ", link);
  box.append(item);
  return box;
};

/** This function shows the matrix of each subject, and the details of the selected cell under its matrix. */
const showMatrices = (matrices: readonly SubjectMatrix[]): void => {
  const root = byId("matrices");
  root.replaceChildren(
    ...matrices.map((matrix) => {
      const section = make("section", "subject");
      const counts = tally(goalCells([matrix]));
      section.append(make("h3", "", matrix.subject.title), make("p", "quiet", `${matrix.subject.note} ${counts.law} of ${counts.cells} cells of the goal have a law.`));
      const scroll = make("div", "scroll");
      const table = make("table", "matrix");
      const head = make("tr");
      head.append(make("th", "corner", "Variable"));
      for (const family of matrix.families) {
        const cell = make("th", "", family.short);
        cell.title = family.title;
        cell.scope = "col";
        head.append(cell);
      }
      const thead = make("thead");
      thead.append(head);
      const tbody = make("tbody");
      matrix.rows.forEach((row, index) => {
        const line = make("tr");
        const name = make("th", "", row.id);
        name.title = row.title;
        name.scope = "row";
        line.append(name);
        for (const cell of matrix.cells[index]!) {
          const td = make("td");
          const button = make("button", `cell ${cell.state}${cell.goal ? "" : " extra"}`, STATE_MARK[cell.state]);
          button.type = "button";
          const family = matrix.families.find((each) => each.id === cell.family)!;
          button.setAttribute("aria-label", `${family.title} over ${row.id}: ${STATE_TEXT[cell.state]}`);
          const on = selected?.subject === cell.subject && selected.row === cell.row && selected.family === cell.family;
          button.setAttribute("aria-pressed", String(on));
          button.addEventListener("click", () => {
            selected = on ? undefined : { subject: cell.subject, row: cell.row, family: cell.family };
            history.replaceState(null, "", selected === undefined ? location.pathname + location.search : `#${selected.subject}.${selected.row}.${selected.family}`);
            render();
            if (!on) document.querySelector<HTMLElement>(".detail")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          });
          td.append(button);
          line.append(td);
        }
        tbody.append(line);
      });
      table.append(thead, tbody);
      scroll.append(table);
      section.append(scroll);
      const chosen = matrix.cells.flat().find((each) => each.subject === selected?.subject && each.row === selected.row && each.family === selected.family);
      if (chosen !== undefined) section.append(cellDetails(matrix, chosen));
      return section;
    }),
  );
};

const stacks = byId<HTMLDivElement>("stacks");

/** These titles name the measure of a composition. The axis of the chart gives the unit. */
const STACK_TITLES: Readonly<Record<string, string>> = { cpu: "CPU", memory: "The highest memory" };

/** These compositions have a base layer: the runner on bare Node. Each one is on the CPU model of its laws. */
const LAYERED = COMPOSITIONS.flatMap((composition) => {
  if (stackBaseOf(composition, COMPOSITIONS) === undefined) return [];
  const ids = lawIdsOf(composition, COMPOSITIONS);
  const cpus = new Set(LAWS.filter((law) => ids.includes(law.id)).map((law) => law.cpu));
  return cpus.size === 1 ? [{ composition, ids, cpu: [...cpus][0]! }] : [];
});

/** This function shows the stack of each composition with a base layer on a CPU model. It loads the law files of the charts. */
const showStacks = async (cpu: string): Promise<void> => {
  const chosen = LAYERED.filter((each) => each.cpu === cpu);
  if (chosen.length === 0) {
    stacks.replaceChildren(make("p", "quiet", `No composition of the service runner is on the ${cpuName(cpu)} yet.`));
    return;
  }
  const laws = await loadLaws([...new Set(chosen.flatMap((each) => each.ids))]);
  if (select.value !== cpu) return;
  stacks.replaceChildren(
    ...chosen.map(({ composition }) => {
      const stack = stackOf(composition, { laws, compositions: COMPOSITIONS });
      const title = STACK_TITLES[composition.measure.id] ?? composition.measure.id;
      if (typeof stack === "string") {
        const box = make("div", "stack");
        box.append(make("h3", "", title), make("p", "quiet", stack));
        return box;
      }
      const chart = stackChart(stack, composition.title);
      chart.prepend(make("h3", "", title));
      return chart;
    }),
  );
};

// The charts load about 0.4 MB of law files. They load when their section comes near the screen, not before.
let stacksSeen = false;
const loadStacks = (): void => {
  if (!stacksSeen) return;
  showStacks(select.value).catch((error: unknown) => {
    stacks.replaceChildren(make("p", "quiet", `The law files of the charts did not load: ${String(error)}`));
  });
};
new IntersectionObserver(
  (entries, observer) => {
    if (!entries.some((each) => each.isIntersecting)) return;
    observer.disconnect();
    stacksSeen = true;
    loadStacks();
  },
  { rootMargin: "400px" },
).observe(stacks);

/** This function shows the page for the selected CPU model. */
const render = (): void => {
  const matrices = coverage(LAWS, PLANS, select.value);
  showDone(matrices);
  showMatrices(matrices);
  loadStacks();
};

select.addEventListener("change", () => {
  selected = undefined;
  render();
});
render();
if (selected !== undefined) document.querySelector<HTMLElement>(".detail")?.scrollIntoView({ block: "center" });
