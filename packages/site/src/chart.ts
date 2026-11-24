/**
 * The charts of the page: the curve of a law, and the stack of a composition with layers. The two charts share one frame
 * (the axes, the ticks and the titles), one plot box and one hover. A chart draws at the width of its box, thus its text
 * keeps one size on a phone. A pointer or the arrow keys show the values at each step. A pointer on a run point shows its values.
 */
import { amountText, axisUnit, kneeSentence, linearTicks, logTicks, runsSentence, significant, unitWords, type Curve } from "./curves.ts";
import type { OpenValue } from "@mark1russell7/capacity";
import type { Load, Step } from "./scale.ts";
import { RATE_UNIT, STACK_NAMES, bandText, stackSentence, type RateRange, type Stack } from "./stack.ts";

const SVG = "http://www.w3.org/2000/svg";
const HEIGHT = 240;
const MARGIN = { top: 28, right: 14, bottom: 40, left: 52 } as const;
/** This number is the width of one character of a label, in pixels, at the font size of the labels. It is a safe guess, not a measure. */
const LABEL_WIDTH = 7;

/** This count is the rows of the table of a chart. */
const TABLE_ROWS = 9;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Readonly<Record<string, string | number>> = {}): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
};

const html = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (className !== "") element.className = className;
  if (text !== "") element.textContent = text;
  return element;
};

/** A frame spec tells the steps of the x axis, the range of the values, their unit and the titles of a chart. */
interface FrameSpec {
  readonly xs: readonly number[];
  readonly log: boolean;
  readonly xTitle: string;
  readonly unit: string;
  readonly top: number;
  readonly bottom: number;
  readonly label: string;
}

/** A frame is the SVG of a chart with its axes. Its functions give the place of an amount of x and the place of a value. */
interface Frame {
  readonly chart: SVGSVGElement;
  readonly width: number;
  readonly plotHeight: number;
  readonly xOf: (x: number) => number;
  readonly yOf: (value: number) => number;
}

/** This function makes the frame of a chart at one width: the grid, the ticks and the titles of the two axes. */
const frameOf = (width: number, spec: FrameSpec): Frame => {
  const { xs, log, unit } = spec;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xLow = xs[0]!;
  const xHigh = xs.at(-1)!;
  const xOf = (x: number): number =>
    MARGIN.left + plotWidth * (log ? Math.log(x / xLow) / Math.log(xHigh / xLow) : (x - xLow) / (xHigh - xLow || 1));

  // The axis of the value starts at 0, thus a flat law looks flat. A law with values below 0 shows its line of 0.
  const bottom = Math.min(0, spec.bottom);
  const shown = axisUnit(unit, Math.max(Math.abs(spec.top), Math.abs(bottom)));
  const yTicks = linearTicks(bottom / shown.factor, spec.top / shown.factor, 4);
  const yLow = Math.min(bottom / shown.factor, yTicks[0]!);
  const yHigh = Math.max(spec.top / shown.factor, yTicks.at(-1)!);
  const yOf = (value: number): number => MARGIN.top + plotHeight * (1 - (value / shown.factor - yLow) / (yHigh - yLow || 1));

  const chart = svg("svg", { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: "curve-svg", tabindex: 0, role: "img" });
  chart.setAttribute("aria-label", spec.label);

  for (const tick of yTicks) {
    const y = yOf(tick * shown.factor);
    chart.append(svg("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: y, y2: y, class: tick === 0 ? "curve-zero" : "curve-grid" }));
    const label = svg("text", { x: MARGIN.left - 6, y: y + 4, class: "curve-label", "text-anchor": "end" });
    label.textContent = significant(tick);
    chart.append(label);
  }
  const yTitle = svg("text", { x: MARGIN.left, y: 14, class: "curve-label", "text-anchor": "start" });
  yTitle.textContent = unitWords(shown.unit);
  chart.append(yTitle);

  const xTicks = log ? logTicks(xLow, xHigh) : linearTicks(xLow, xHigh, Math.max(2, Math.floor(plotWidth / 90)));
  // On a narrow chart, each second tick of a log axis keeps its label, thus the labels do not touch.
  const every = log && xTicks.length * 48 > plotWidth ? 2 : 1;
  xTicks.forEach((tick, index) => {
    const x = xOf(tick);
    chart.append(svg("line", { x1: x, x2: x, y1: HEIGHT - MARGIN.bottom, y2: HEIGHT - MARGIN.bottom + 4, class: "curve-axis" }));
    if (index % every !== 0) return;
    const text = significant(tick);
    // A label at an end of the axis that does not fit around its tick ends at the edge of the chart.
    const half = (text.length * LABEL_WIDTH) / 2;
    const anchor = x + half > width ? "end" : x - half < 0 ? "start" : "middle";
    const label = svg("text", { x: anchor === "end" ? width - 1 : anchor === "start" ? 1 : x, y: HEIGHT - MARGIN.bottom + 17, class: "curve-label", "text-anchor": anchor });
    label.textContent = text;
    chart.append(label);
  });
  chart.append(svg("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: HEIGHT - MARGIN.bottom, y2: HEIGHT - MARGIN.bottom, class: "curve-axis" }));
  const xTitle = svg("text", { x: MARGIN.left + plotWidth / 2, y: HEIGHT - 4, class: "curve-label", "text-anchor": "middle" });
  xTitle.textContent = spec.xTitle;
  chart.append(xTitle);
  return { chart, width, plotHeight, xOf, yOf };
};

/** This function gives the path of a band between two lines of values over the steps of x. */
const areaPath = (frame: Frame, xs: readonly number[], upper: (index: number) => number, lower: (index: number) => number): string => {
  const top = xs.map((x, index) => `${frame.xOf(x)},${frame.yOf(upper(index))}`);
  const under = xs.map((x, index) => `${frame.xOf(x)},${frame.yOf(lower(index))}`).reverse();
  return `M${[...top, ...under].join("L")}Z`;
};

/** This function gives the path of a line of values over the steps of x. */
const linePath = (frame: Frame, xs: readonly number[], value: (index: number) => number): string =>
  `M${xs.map((x, index) => `${frame.xOf(x)},${frame.yOf(value(index))}`).join("L")}`;

/**
 * The marks of a hover are the points with a hit target of their own. The attribute `data-mark` of a target gives the index
 * of its mark. `at` gives the place of a mark, and `rows` gives the rows of its tip.
 */
interface HoverMarks {
  readonly at: (index: number) => { readonly x: number; readonly y: number };
  readonly rows: (index: number) => readonly HTMLElement[];
}

/** A hover spec tells the values of the dots at a step and the class of each dot. It also tells the rows of the tip and the marks. */
interface HoverSpec {
  readonly xs: readonly number[];
  readonly dots: readonly { readonly className: string; readonly value: (index: number) => number }[];
  readonly rows: (index: number) => readonly HTMLElement[];
  readonly marks?: HoverMarks;
}

/** This function gives the index of the mark of a hit target, or undefined for another element. */
const markOf = (target: EventTarget | null): number | undefined => {
  const value = target instanceof Element ? target.getAttribute("data-mark") : null;
  return value === null ? undefined : Number(value);
};

/**
 * This function adds the hover to a frame: a line and dots at the nearest step, a tip with the values, and the arrow keys.
 * A pointer on the hit target of a mark shows a ring at the mark and the tip of the mark.
 */
const addHover = (frame: Frame, tip: HTMLElement, spec: HoverSpec): void => {
  const { chart, xOf, yOf, width } = frame;
  const { xs } = spec;
  const cross = svg("line", { y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, class: "curve-cross", visibility: "hidden" });
  const dots = spec.dots.map((dot) => svg("circle", { r: 5, class: `curve-dot ${dot.className}`, visibility: "hidden" }));
  const ring = svg("circle", { r: 6, class: "curve-run-ring", visibility: "hidden" });
  chart.append(cross, ...dots, ring);

  /** This function puts the tip right of the place `x`, or left of it when the tip does not fit. */
  const placeTip = (x: number, y: number): void => {
    tip.hidden = false;
    const left = x + 12 + tip.offsetWidth > width ? x - 12 - tip.offsetWidth : x + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${y}px`;
  };

  let at = -1;
  const showMark = (index: number): void => {
    const marks = spec.marks;
    if (marks === undefined) return;
    cross.setAttribute("visibility", "hidden");
    for (const dot of dots) dot.setAttribute("visibility", "hidden");
    const place = marks.at(index);
    ring.setAttribute("cx", String(place.x));
    ring.setAttribute("cy", String(place.y));
    ring.setAttribute("visibility", "visible");
    tip.replaceChildren(...marks.rows(index));
    placeTip(place.x, Math.max(0, Math.min(place.y - 12, HEIGHT - MARGIN.bottom - tip.offsetHeight)));
  };
  const show = (index: number): void => {
    ring.setAttribute("visibility", "hidden");
    at = Math.max(0, Math.min(xs.length - 1, index));
    const x = xOf(xs[at]!);
    cross.setAttribute("x1", String(x));
    cross.setAttribute("x2", String(x));
    cross.setAttribute("visibility", "visible");
    spec.dots.forEach((dot, which) => {
      dots[which]!.setAttribute("cx", String(x));
      dots[which]!.setAttribute("cy", String(yOf(dot.value(at))));
      dots[which]!.setAttribute("visibility", "visible");
    });
    tip.replaceChildren(...spec.rows(at));
    placeTip(x, MARGIN.top);
  };
  const hide = (): void => {
    cross.setAttribute("visibility", "hidden");
    ring.setAttribute("visibility", "hidden");
    for (const dot of dots) dot.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  const point = (event: PointerEvent): void => {
    const mark = markOf(event.target);
    if (mark === undefined) show(nearest(event.clientX));
    else showMark(mark);
  };
  const nearest = (clientX: number): number => {
    const x = clientX - chart.getBoundingClientRect().left;
    let best = 0;
    xs.forEach((each, index) => {
      if (Math.abs(xOf(each) - x) < Math.abs(xOf(xs[best]!) - x)) best = index;
    });
    return best;
  };
  chart.addEventListener("pointermove", point);
  chart.addEventListener("pointerdown", point);
  chart.addEventListener("pointerleave", hide);
  chart.addEventListener("blur", hide);
  chart.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -xs.length, End: xs.length }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    show(at < 0 ? (step > 0 ? 0 : xs.length - 1) : at + step);
  });
};

/** This function makes the box of a plot. It draws the SVG at the width of the box, and again after a change of the width. */
const plotBox = (draw: (width: number, tip: HTMLElement) => SVGSVGElement): HTMLElement => {
  const plot = html("div", "curve-plot");
  const tip = html("div", "curve-tip");
  tip.hidden = true;
  plot.append(tip);
  let drawn = 0;
  new ResizeObserver(() => {
    const width = Math.round(plot.clientWidth);
    if (width === 0 || width === drawn) return;
    drawn = width;
    tip.hidden = true;
    plot.querySelector("svg")?.remove();
    plot.prepend(draw(width, tip));
  }).observe(plot);
  return plot;
};

/** This function gives a table of the values at some steps, for a reader who does not read the chart. A quiet table shows its last column in the quiet ink. */
const valueTable = (heads: readonly string[], count: number, cells: (index: number) => readonly [string, ...string[]], quiet = false): HTMLElement => {
  const details = html("details", "curve-table");
  details.append(html("summary", "", "The values as a table"));
  const table = html("table", "constants");
  const head = html("tr");
  head.append(...heads.map((each) => html("th", "", each)));
  table.append(head);
  const rows = Math.min(TABLE_ROWS, count);
  for (let row = 0; row < rows; row++) {
    const [first, ...rest] = cells(Math.round((row * (count - 1)) / Math.max(1, rows - 1)));
    const line = html("tr");
    line.append(html("td", "", first), ...rest.map((each, column) => html("td", quiet && column === rest.length - 1 ? "quiet" : "", each)));
    table.append(line);
  }
  details.append(table);
  return details;
};

/** This function gives the legend of a curve with run points: the law, its interval and the runs. */
const curveLegend = (level: string): HTMLElement => {
  const legend = html("ul", "curve-legend");
  for (const [key, name] of [["law", "law"], ["band", level], ["runs", "runs"]] as const) {
    const item = html("li");
    item.append(html("span", `curve-swatch ${key}`), name);
    legend.append(item);
  }
  return legend;
};

/**
 * This function makes the chart of a curve, its sentence of the knee and a table of its values. A curve with run points
 * also draws each point as a dot, with a hit target of 12 px and a tip, and a legend.
 */
export const curveChart = (curve: Curve, title: string): HTMLElement => {
  const { points, runs, variable, unit } = curve;
  const xs = points.map((each) => each.x);
  const log = variable.scale === "log" && variable.min > 0;
  const level = `${Math.round(curve.level * 100)} % interval`;
  // A point outside the steps of the curve stays out of the chart. The slack keeps a point at an end of the range.
  const slack = (xs.at(-1)! - xs[0]!) * 1e-9;
  const shown = runs.filter((each) => each.x >= xs[0]! - slack && each.x <= xs.at(-1)! + slack);
  const box = html("figure", "curve");
  const plot = plotBox((width, tip) => {
    const frame = frameOf(width, {
      xs,
      log,
      unit,
      top: Math.max(...points.map((each) => each.high), ...shown.map((each) => each.value)),
      bottom: Math.min(...points.map((each) => each.low), ...shown.map((each) => each.value)),
      xTitle: `${variable.id}, ${unitWords(variable.unit)}${log ? " (log scale)" : ""}`,
      label: `${title}. ${amountText(points[0]!.value, unit)} at ${amountText(xs[0]!, variable.unit)}, ${amountText(points.at(-1)!.value, unit)} at ${amountText(xs.at(-1)!, variable.unit)}. ${kneeSentence(curve)} ${runsSentence(curve)}`.trim(),
    });
    const { chart, xOf } = frame;
    const knee = curve.knee;
    if (knee?.value != null) {
      const from = xOf(Math.max(xs[0]!, knee.low ?? xs[0]!));
      const to = xOf(Math.min(xs.at(-1)!, knee.high ?? xs.at(-1)!));
      chart.append(svg("rect", { x: from, y: MARGIN.top, width: Math.max(1, to - from), height: frame.plotHeight, class: "curve-knee-band" }));
      const x = xOf(knee.value);
      chart.append(svg("line", { x1: x, x2: x, y1: MARGIN.top - 4, y2: HEIGHT - MARGIN.bottom, class: "curve-knee" }));
      const text = `knee ${amountText(knee.value, variable.unit)}`;
      // A label of 12 px is about 7 px for each character. A label that does not fit right of its line goes left of it.
      const anchor = x + text.length * LABEL_WIDTH > width - MARGIN.right ? "end" : "start";
      const label = svg("text", { x, y: MARGIN.top - 8, class: "curve-label curve-knee-label", "text-anchor": anchor });
      label.textContent = text;
      chart.append(label);
    }
    chart.append(svg("path", { d: areaPath(frame, xs, (index) => points[index]!.high, (index) => points[index]!.low), class: "curve-band" }));
    // The dots of the runs go under the line, thus the line of the law stays clear. Their hit targets go over the line.
    const at = (index: number): { readonly x: number; readonly y: number } => ({ x: xOf(shown[index]!.x), y: frame.yOf(shown[index]!.value) });
    const marks = shown.map((_, index) => svg("circle", { cx: at(index).x, cy: at(index).y, r: 3, class: "curve-run" }));
    chart.append(...marks);
    chart.append(svg("path", { d: linePath(frame, xs, (index) => points[index]!.value), class: "curve-line" }));
    const targets = shown.map((_, index) => svg("circle", { cx: at(index).x, cy: at(index).y, r: 6, class: "curve-run-hit", "data-mark": index }));
    chart.append(...targets);
    addHover(frame, tip, {
      xs,
      dots: [{ className: "", value: (index) => points[index]!.value }],
      rows: (index) => {
        const point = points[index]!;
        return [
          html("strong", "", amountText(point.value, unit)),
          html("span", "", `${amountText(point.low, unit)} to ${amountText(point.high, unit)}`),
          html("span", "", `at ${amountText(point.x, variable.unit)}`),
        ];
      },
      marks: {
        at,
        rows: (index) => {
          const run = shown[index]!;
          return [
            html("strong", "", amountText(run.value, unit)),
            html("span", "", `at ${amountText(run.x, variable.unit)}`),
            html("span", "", run.date === undefined ? "a run point" : `the run of ${run.date.slice(0, 10)}`),
          ];
        },
      },
    });
    return chart;
  });
  const caption = `${kneeSentence(curve)} ${runsSentence(curve)}`.trim();
  box.append(
    ...(shown.length > 0 ? [curveLegend(level)] : []),
    plot,
    html("figcaption", "curve-caption", caption),
    valueTable([variable.id, "value", level], points.length, (index) => {
      const point = points[index]!;
      return [amountText(point.x, variable.unit), amountText(point.value, unit), `${amountText(point.low, unit)} to ${amountText(point.high, unit)}`];
    }, true),
  );
  return box;
};

/** This function makes the chart of a stack: the base layer and the part that the composition adds, with a legend and a table. */
export const stackChart = (stack: Stack, title: string): HTMLElement => {
  const { points, unit, range } = stack;
  const xs = points.map((each) => each.x);
  const log = range.scale === "log" && range.min > 0;
  const box = html("figure", "curve stack");
  const legend = html("ul", "curve-legend");
  for (const [key, name] of [["base", STACK_NAMES.base], ["added", STACK_NAMES.added]] as const) {
    const item = html("li");
    item.append(html("span", `curve-swatch ${key}`), name);
    legend.append(item);
  }
  const plot = plotBox((width, tip) => {
    const frame = frameOf(width, {
      xs,
      log,
      unit,
      top: Math.max(...points.map((each) => Math.max(each.total.high, each.base.high))),
      bottom: Math.min(...points.map((each) => Math.min(each.base.low, each.total.low))),
      xTitle: `rate, requests/s${log ? " (log scale)" : ""}`,
      label: `${title}. ${stackSentence(stack, points.at(-1)!)}`,
    });
    const { chart } = frame;
    const base = (index: number): number => points[index]!.base.value;
    const total = (index: number): number => points[index]!.total.value;
    chart.append(svg("path", { d: areaPath(frame, xs, base, () => 0), class: "stack-area base" }));
    chart.append(svg("path", { d: areaPath(frame, xs, total, base), class: "stack-area added" }));
    chart.append(svg("path", { d: areaPath(frame, xs, (index) => points[index]!.base.high, (index) => points[index]!.base.low), class: "stack-band base" }));
    chart.append(svg("path", { d: areaPath(frame, xs, (index) => points[index]!.total.high, (index) => points[index]!.total.low), class: "stack-band added" }));
    chart.append(svg("path", { d: linePath(frame, xs, base), class: "stack-line base" }));
    chart.append(svg("path", { d: linePath(frame, xs, total), class: "stack-line added" }));
    addHover(frame, tip, {
      xs,
      dots: [
        { className: "base", value: base },
        { className: "added", value: total },
      ],
      rows: (index) => {
        const point = points[index]!;
        return [
          html("strong", "", `${STACK_NAMES.total}: ${amountText(point.total.value, unit)}`),
          html("span", "", `${STACK_NAMES.base}: ${bandText(point.base, unit)}`),
          html("span", "", `${STACK_NAMES.added}: ${bandText(point.added, unit)}`),
          html("span", "", `at ${amountText(point.x, RATE_UNIT)}`),
        ];
      },
    });
    return chart;
  });
  const level = `${Math.round(stack.level * 100)} % intervals`;
  box.append(
    legend,
    plot,
    html("figcaption", "curve-caption", `${stackSentence(stack, points[0]!)} ${stackSentence(stack, points.at(-1)!)} The bands are the ${level}.`),
    valueTable(["rate", STACK_NAMES.base, STACK_NAMES.added, STACK_NAMES.total], points.length, (index) => {
      const point = points[index]!;
      return [amountText(point.x, RATE_UNIT), bandText(point.base, unit), bandText(point.added, unit), bandText(point.total, unit)];
    }),
  );
  return box;
};

/** A step chart is the figure of the count of instances over the rate. Its function `mark` moves the mark to the rate of the slider. */
export interface StepChart {
  readonly figure: HTMLElement;
  readonly mark: (value: number, count: number | null) => void;
}

/** This function gives the path of a line of steps. Each value holds up to the next x, then the line goes up or down. */
const stepPath = (frame: Frame, xs: readonly number[], value: (index: number) => number): string =>
  `M${xs.map((x, index) => `${index === 0 ? "" : `${frame.xOf(x)},${frame.yOf(value(index - 1))}L`}${frame.xOf(x)},${frame.yOf(value(index))}`).join("L")}`;

/** This function gives the path of a band of steps between two lines of values. */
const stepArea = (frame: Frame, xs: readonly number[], upper: (index: number) => number, lower: (index: number) => number): string => {
  const line = (value: (index: number) => number): string[] =>
    xs.flatMap((x, index) => (index === 0 ? [`${frame.xOf(x)},${frame.yOf(value(0))}`] : [`${frame.xOf(x)},${frame.yOf(value(index - 1))}`, `${frame.xOf(x)},${frame.yOf(value(index))}`]));
  return `M${[...line(upper), ...line(lower).reverse()].join("L")}Z`;
};

/**
 * This function makes the chart of the count of instances over the load, with its interval. The region past the values
 * that each law measured has its own fill and label. A mark shows the load of the slider.
 */
export const stepChart = (steps: readonly Step[], load: Pick<Load, "unit" | "axis">, measured: RateRange, most: number, title: string): StepChart => {
  const xs = steps.map((each) => each.value);
  // A count past the search draws at the top of the search. The tip tells that it is more.
  const count = (index: number): number => steps[index]!.count.value ?? most;
  const low = (index: number): number => steps[index]!.count.interval.low ?? most;
  const high = (index: number): number => steps[index]!.count.interval.high ?? most;
  const top = Math.max(4, ...steps.map((_, index) => high(index)));
  let at: { value: number; count: number | null } | undefined;
  let place: ((value: number, count: number | null) => void) | undefined;
  const figure = html("figure", "curve scale-chart");
  const plot = plotBox((width, tip) => {
    const frame = frameOf(width, {
      xs,
      log: true,
      unit: "{instance}",
      top,
      bottom: 0,
      xTitle: `${load.axis} (log scale)`,
      label: `${title}. The count of instances over the load, from ${amountText(xs[0]!, load.unit)} to ${amountText(xs.at(-1)!, load.unit)}.`,
    });
    const { chart, xOf, yOf } = frame;
    if (measured.max < xs.at(-1)!) {
      const edge = xOf(Math.max(xs[0]!, measured.max));
      chart.append(svg("rect", { x: edge, y: MARGIN.top, width: Math.max(0, width - MARGIN.right - edge), height: frame.plotHeight, class: "scale-past" }));
      chart.append(svg("line", { x1: edge, x2: edge, y1: MARGIN.top - 4, y2: HEIGHT - MARGIN.bottom, class: "scale-edge" }));
      // The label starts at the edge. Near the right end of the chart, it ends at the right end.
      const text = "past the measures";
      const room = width - MARGIN.right - edge - 6 >= text.length * LABEL_WIDTH;
      const label = svg("text", { x: room ? edge + 6 : width - MARGIN.right, y: MARGIN.top - 8, class: "curve-label", "text-anchor": room ? "start" : "end" });
      label.textContent = text;
      chart.append(label);
    }
    chart.append(svg("path", { d: stepArea(frame, xs, high, low), class: "curve-band" }));
    chart.append(svg("path", { d: stepPath(frame, xs, count), class: "curve-line" }));
    const cross = svg("line", { y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, class: "scale-mark", visibility: "hidden" });
    const dot = svg("circle", { r: 6, class: "scale-dot", visibility: "hidden" });
    chart.append(cross, dot);
    place = (where, value) => {
      const x = xOf(where);
      cross.setAttribute("x1", String(x));
      cross.setAttribute("x2", String(x));
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(yOf(value ?? most)));
      cross.setAttribute("visibility", "visible");
      dot.setAttribute("visibility", "visible");
    };
    if (at !== undefined) place(at.value, at.count);
    addHover(frame, tip, {
      xs,
      dots: [{ className: "", value: count }],
      rows: (index) => {
        const step = steps[index]!;
        const value = step.count.value;
        return [
          html("strong", "", value === null ? `more than ${most} instances` : `${value} ${value === 1 ? "instance" : "instances"}`),
          html("span", "", countInterval(step.count, most)),
          html("span", "", `at ${amountText(step.value, load.unit)}`),
          ...(step.extrapolated ? [html("span", "quiet", "past the measures")] : []),
        ];
      },
    });
    return chart;
  });
  figure.append(plot, valueTable(["load", "instances", "interval"], steps.length, (index) => {
    const step = steps[index]!;
    return [amountText(step.value, load.unit), step.count.value === null ? `more than ${most}` : String(step.count.value), countInterval(step.count, most)];
  }, true));
  return {
    figure,
    mark: (value, count) => {
      at = { value, count };
      place?.(value, count);
    },
  };
};

/** This function gives the text of the interval of a count of instances. */
export const countInterval = (count: OpenValue, most: number): string => {
  const end = (value: number | null): string => (value === null ? `more than ${most}` : String(value));
  return `interval ${end(count.interval.low)} to ${end(count.interval.high)}`;
};
