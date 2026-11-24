/**
 * The chart of the curve of a law: the line of the value, the band of its interval, and the knee with its interval.
 * The chart draws at the width of its box, thus its text keeps one size on a phone. A pointer or the arrow keys show the
 * value at each step of the curve.
 */
import { amountText, axisUnit, kneeSentence, linearTicks, logTicks, significant, unitWords, type Curve } from "./curves.ts";

const SVG = "http://www.w3.org/2000/svg";
const HEIGHT = 240;
const MARGIN = { top: 28, right: 14, bottom: 40, left: 52 } as const;

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

/** This function makes the chart of a curve, its sentence of the knee and a table of its values. */
export const curveChart = (curve: Curve, title: string): HTMLElement => {
  const box = html("figure", "curve");
  const plot = html("div", "curve-plot");
  const tip = html("div", "curve-tip");
  tip.hidden = true;
  plot.append(tip);
  const caption = html("figcaption", "curve-caption", kneeSentence(curve));
  box.append(plot, caption, valueTable(curve));
  let drawn = 0;
  const draw = (): void => {
    const width = Math.round(plot.clientWidth);
    if (width === 0 || width === drawn) return;
    drawn = width;
    tip.hidden = true;
    plot.querySelector("svg")?.remove();
    plot.prepend(chartSvg(curve, title, width, tip));
  };
  new ResizeObserver(draw).observe(plot);
  return box;
};

/** This function gives the SVG of a curve at one width. */
const chartSvg = (curve: Curve, title: string, width: number, tip: HTMLElement): SVGSVGElement => {
  const { points, variable, unit } = curve;
  const log = variable.scale === "log" && variable.min > 0;
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const xLow = points[0]!.x;
  const xHigh = points.at(-1)!.x;
  const xOf = (x: number): number =>
    MARGIN.left + plotWidth * (log ? Math.log(x / xLow) / Math.log(xHigh / xLow) : (x - xLow) / (xHigh - xLow || 1));

  // The axis of the value starts at 0, thus a flat law looks flat. A law with values below 0 shows its line of 0.
  const top = Math.max(...points.map((each) => each.high));
  const bottom = Math.min(0, ...points.map((each) => each.low));
  const shown = axisUnit(unit, Math.max(Math.abs(top), Math.abs(bottom)));
  const yTicks = linearTicks(bottom / shown.factor, top / shown.factor, 4);
  const yLow = Math.min(bottom / shown.factor, yTicks[0]!);
  const yHigh = Math.max(top / shown.factor, yTicks.at(-1)!);
  const yOf = (value: number): number => MARGIN.top + plotHeight * (1 - (value / shown.factor - yLow) / (yHigh - yLow || 1));

  const chart = svg("svg", { width, height: HEIGHT, viewBox: `0 0 ${width} ${HEIGHT}`, class: "curve-svg", tabindex: 0, role: "img" });
  chart.setAttribute("aria-label", `${title}. ${amountText(points[0]!.value, unit)} at ${amountText(xLow, variable.unit)}, ${amountText(points.at(-1)!.value, unit)} at ${amountText(xHigh, variable.unit)}. ${kneeSentence(curve)}`);

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
    const label = svg("text", { x, y: HEIGHT - MARGIN.bottom + 17, class: "curve-label", "text-anchor": "middle" });
    label.textContent = significant(tick);
    chart.append(label);
  });
  chart.append(svg("line", { x1: MARGIN.left, x2: width - MARGIN.right, y1: HEIGHT - MARGIN.bottom, y2: HEIGHT - MARGIN.bottom, class: "curve-axis" }));
  const xTitle = svg("text", { x: MARGIN.left + plotWidth / 2, y: HEIGHT - 4, class: "curve-label", "text-anchor": "middle" });
  xTitle.textContent = `${variable.id}, ${unitWords(variable.unit)}${log ? " (log scale)" : ""}`;
  chart.append(xTitle);

  const knee = curve.knee;
  if (knee?.value != null) {
    const from = xOf(Math.max(xLow, knee.low ?? xLow));
    const to = xOf(Math.min(xHigh, knee.high ?? xHigh));
    chart.append(svg("rect", { x: from, y: MARGIN.top, width: Math.max(1, to - from), height: plotHeight, class: "curve-knee-band" }));
    const x = xOf(knee.value);
    chart.append(svg("line", { x1: x, x2: x, y1: MARGIN.top - 4, y2: HEIGHT - MARGIN.bottom, class: "curve-knee" }));
    const text = `knee ${amountText(knee.value, variable.unit)}`;
    // A label of 12 px is about 7 px for each character. A label that does not fit right of its line goes left of it.
    const anchor = x + text.length * 7 > width - MARGIN.right ? "end" : "start";
    const label = svg("text", { x, y: MARGIN.top - 8, class: "curve-label curve-knee-label", "text-anchor": anchor });
    label.textContent = text;
    chart.append(label);
  }

  const band = [...points.map((each) => `${xOf(each.x)},${yOf(each.high)}`), ...[...points].reverse().map((each) => `${xOf(each.x)},${yOf(each.low)}`)];
  chart.append(svg("path", { d: `M${band.join("L")}Z`, class: "curve-band" }));
  chart.append(svg("path", { d: `M${points.map((each) => `${xOf(each.x)},${yOf(each.value)}`).join("L")}`, class: "curve-line" }));

  const cross = svg("line", { y1: MARGIN.top, y2: HEIGHT - MARGIN.bottom, class: "curve-cross", visibility: "hidden" });
  const dot = svg("circle", { r: 5, class: "curve-dot", visibility: "hidden" });
  chart.append(cross, dot);

  let at = -1;
  const show = (index: number): void => {
    at = Math.max(0, Math.min(points.length - 1, index));
    const point = points[at]!;
    const x = xOf(point.x);
    const y = yOf(point.value);
    cross.setAttribute("x1", String(x));
    cross.setAttribute("x2", String(x));
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    cross.setAttribute("visibility", "visible");
    dot.setAttribute("visibility", "visible");
    tip.replaceChildren(
      html("strong", "", amountText(point.value, unit)),
      html("span", "", `${amountText(point.low, unit)} to ${amountText(point.high, unit)}`),
      html("span", "", `at ${amountText(point.x, variable.unit)}`),
    );
    tip.hidden = false;
    const left = x + 12 + tip.offsetWidth > width ? x - 12 - tip.offsetWidth : x + 12;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${MARGIN.top}px`;
  };
  const hide = (): void => {
    cross.setAttribute("visibility", "hidden");
    dot.setAttribute("visibility", "hidden");
    tip.hidden = true;
  };
  const nearest = (clientX: number): number => {
    const x = clientX - chart.getBoundingClientRect().left;
    let best = 0;
    points.forEach((each, index) => {
      if (Math.abs(xOf(each.x) - x) < Math.abs(xOf(points[best]!.x) - x)) best = index;
    });
    return best;
  };
  chart.addEventListener("pointermove", (event) => show(nearest(event.clientX)));
  chart.addEventListener("pointerdown", (event) => show(nearest(event.clientX)));
  chart.addEventListener("pointerleave", hide);
  chart.addEventListener("blur", hide);
  chart.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -points.length, End: points.length }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    show(at < 0 ? (step > 0 ? 0 : points.length - 1) : at + step);
  });
  return chart;
};

/** This function gives a table of 9 steps of a curve, for a reader who does not read the chart. */
const valueTable = (curve: Curve): HTMLElement => {
  const details = html("details", "curve-table");
  details.append(html("summary", "", "The values as a table"));
  const table = html("table", "constants");
  const head = html("tr");
  head.append(html("th", "", curve.variable.id), html("th", "", "value"), html("th", "", `${Math.round(curve.level * 100)} % interval`));
  table.append(head);
  const count = Math.min(9, curve.points.length);
  for (let index = 0; index < count; index++) {
    const point = curve.points[Math.round((index * (curve.points.length - 1)) / Math.max(1, count - 1))]!;
    const row = html("tr");
    row.append(
      html("td", "", amountText(point.x, curve.variable.unit)),
      html("td", "", amountText(point.value, curve.unit)),
      html("td", "quiet", `${amountText(point.low, curve.unit)} to ${amountText(point.high, curve.unit)}`),
    );
    table.append(row);
  }
  details.append(table);
  return details;
};
