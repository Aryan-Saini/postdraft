import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseMarkdown } from "../src/render/parse.js";
import {
  FORMATS, SERIES, TONE_INK, compact, fixed, formatter, inkOn, logTicks, meter, renderChart, seriesColor, sparkline, ticks,
} from "../src/render/charts.js";
import { validateChart } from "../src/render/schema/chart.js";
import { CSS } from "../src/render/shell.js";
import { renderFlow, renderSequence } from "../src/render/diagram.js";

const gallery = readFileSync(fileURLToPath(new URL("../examples/gallery.md", import.meta.url)), "utf8");
const { doc, errors } = parseMarkdown(gallery, { file: "gallery.md" });

test("the gallery parses cleanly, so the fixtures below are the real shapes", () => {
  assert.deepEqual(errors, []);
});

/** Every chart kind the spec lists, each with its gallery fixture. */
const CHART_KINDS = [
  "columns", "bars", "lines", "grouped", "stacked", "delta", "whisker", "heatmap",
  "waterfall", "scatter", "funnel", "schedule", "small-multiples", "share",
];

const chartsByKind = new Map();
for (const b of doc.blocks) if (b.type === "chart" && !chartsByKind.has(b.kind)) chartsByKind.set(b.kind, b);

test("ticks() covers the range with round steps", () => {
  assert.deepEqual(ticks(168), { top: 200, ticks: [0, 50, 100, 150, 200] });
  assert.deepEqual(ticks(1), { top: 1, ticks: [0, 0.25, 0.5, 0.75, 1] });
  // A non-positive max still yields a usable scale rather than NaN geometry.
  assert.deepEqual(ticks(0), { top: 1, ticks: [0, 1] });
  assert.deepEqual(ticks(-5), { top: 1, ticks: [0, 1] });
  const { top, ticks: tk } = ticks(1340);
  assert.equal(top, 1500);
  assert.equal(tk.at(-1), 1500);
  assert.ok(top >= 1340);
});

test("compact() shortens at each magnitude and keeps the sign", () => {
  assert.equal(compact(412), "412");
  assert.equal(compact(1284), "1.3k");
  assert.equal(compact(4200000), "4.2M");
  assert.equal(compact(2e9), "2B");
  assert.equal(compact(-41000), "-41k");
  assert.equal(compact(1000), "1k");
});

test("each format preset renders its documented shape", () => {
  assert.equal(FORMATS.int(1284), "1,284");
  assert.equal(FORMATS.compact(1284), "1.3k");
  assert.equal(FORMATS.usd(412000), "$412k");
  assert.equal(FORMATS.usd(-412000), "-$412k");
  assert.equal(FORMATS.pct(0.031), "3.1%");
  assert.equal(FORMATS.ms(412), "412 ms");
  assert.equal(FORMATS.ms(1340), "1,340 ms");
  // An unknown or missing format falls back to compact rather than throwing.
  assert.equal(formatter("nope")(1284), "1.3k");
  assert.equal(formatter(undefined)(1284), "1.3k");
});

test("the palette caps at eight series", () => {
  assert.equal(seriesColor(0), SERIES[0]);
  assert.equal(seriesColor(7), SERIES[7]);
  assert.throws(() => seriesColor(8), RangeError);
});

test("a sparkline needs two points", () => {
  assert.throws(() => sparkline([5]), RangeError);
  assert.throws(() => sparkline([]), RangeError);
  const svg = sparkline([1, 2, 3]);
  assert.match(svg, /^<svg /);
  assert.match(svg, /class="spark"/);
  // A flat series divides by a span of zero unless the guard holds.
  assert.doesNotMatch(sparkline([4, 4, 4]), /NaN/);
});

test("meter clamps to its track", () => {
  assert.match(meter(486, { max: 512, label: "Largest document" }), /width:94\.92%/);
  assert.match(meter(900, { max: 512 }), /width:100%/);
  assert.match(meter(-3, { max: 512 }), /width:0%/);
});

for (const kind of CHART_KINDS) {
  test(`chart ${kind} renders an svg from its gallery fixture`, () => {
    const block = chartsByKind.get(kind);
    assert.ok(block, `gallery.md has no "chart ${kind}" fixture`);
    const html = renderChart(block);
    assert.match(html, /<svg /);
    assert.match(html, /<figure class="fig">/);
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  });
}

test("an unknown chart kind renders nothing rather than throwing", () => {
  assert.equal(renderChart({ type: "chart", kind: "pie", data: { labels: ["a"], values: [1] } }), "");
});

test("charts survive an empty data set without throwing", () => {
  for (const kind of CHART_KINDS) {
    assert.doesNotThrow(() => renderChart({ type: "chart", kind, data: {} }), kind);
  }
});

test("delta reads the higherIsBetter flag from the block", () => {
  const block = chartsByKind.get("delta");
  // Latency: the +44 ms bar must be red, not green.
  assert.match(renderChart(block), /fill="#d03b3b"><title>Total: \+44 ms/);
  const flipped = { ...block, data: { ...block.data, higherIsBetter: true } };
  assert.match(renderChart(flipped), /fill="#0ca30c"><title>Total: \+44 ms/);
});

test("waterfall draws the indices in totals as balances", () => {
  const html = renderChart(chartsByKind.get("waterfall"));
  // Aug total and Sep total are the blue balance bars; the steps are green or red.
  assert.equal(html.match(/fill="#3987e5"/g).length, 2);
});

test("two diagrams on one page get distinct marker ids", () => {
  const flowBlock = doc.blocks.find((b) => b.type === "flow");
  const seqBlock = doc.blocks.find((b) => b.type === "sequence");
  const a = renderFlow(flowBlock);
  const b = renderSequence(seqBlock);
  const idOf = (html) => html.match(/<marker id="([^"]+)"/)[1];
  assert.notEqual(idOf(a), idOf(b));
  // A second render of the same block mints a fresh id too.
  assert.notEqual(idOf(a), idOf(renderFlow(flowBlock)));
  for (const html of [a, b]) assert.ok(html.includes(`marker-end="url(#${idOf(html)})"`));
  assert.match(a, /<svg /);
  assert.match(b, /<svg /);
});

test("labels are escaped, not interpolated", () => {
  const html = renderChart({
    type: "chart", kind: "columns",
    data: { format: "int", labels: ['<script>"x"'], values: [3] },
  });
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /&lt;script&gt;/);
});

/* ------------------------------------------------ label clipping and tone */

const LONG = "A twenty-four char label"; // 24 characters
const BIG = 412000; // "412,000" under format int: 7 characters

/** Wide fixtures: a 24-character category and a 7-character value in every kind. */
const WIDE = {
  columns: { labels: [LONG, "b", "c", LONG], values: [BIG, 9, 12, BIG] },
  bars: { labels: [LONG, "b"], values: [BIG, 9000] },
  lines: {
    labels: ["W1", "W2", "W3", "W4"],
    series: [{ name: "a", values: [1, 2, 3, BIG] }, { name: "b", values: [3, 2, 1, BIG - 90000], tone: "bad" }],
  },
  grouped: { labels: [LONG, "b", LONG], series: [{ name: "a", values: [BIG, 2, 3] }, { name: "b", values: [1, 2, BIG] }] },
  stacked: { labels: [LONG, "b", LONG], series: [{ name: "a", values: [BIG, 2, 3] }, { name: "b", values: [1, 2, BIG] }] },
  delta: { labels: [LONG, "b", LONG], values: [-BIG, 12, BIG] },
  whisker: { labels: [LONG, "b"], mid: [BIG, 10], lo: [1000, 5], hi: [BIG + 1000, 20] },
  heatmap: { rows: [LONG, "b"], cols: ["00", "03", "06", "09", "12", "15", "18", "21"], values: [[1, 2, 3, 4, 5, 6, 7, BIG], [0, 0, 0, 0, 0, 0, 0, 1]] },
  waterfall: { labels: [LONG, "b", LONG], values: [BIG, -100000, 312000], totals: [0, 2] },
  scatter: { points: [{ x: BIG, y: BIG, label: LONG }, { x: 10, y: 10 }], xTitle: LONG, yTitle: LONG },
  funnel: { labels: [LONG, "b", LONG], values: [BIG, 333720, 226930] },
  schedule: {
    tasks: [{ label: LONG, start: "2026-08-30", end: "2026-09-20" }, { label: "b", start: "2026-09-02", end: "2026-10-31", tone: "bad" }],
  },
  "small-multiples": { labels: ["W1", "W2", "W3"], series: [{ name: LONG, values: [1, 2, BIG] }, { name: "b", values: [1, 2, 3] }, { name: LONG, values: [3, 2, BIG] }] },
  share: { labels: [LONG, "b"], values: [BIG, 9] },
};

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * Every `<text>` the svg draws, with its estimated horizontal extent. The
 * anchor follows the shell's CSS, where a class rule beats a presentation
 * attribute: tick-y and val-end end, val-left starts, tick-x / val / cell-val
 * centre; otherwise the attribute, else start.
 */
function textExtents(svg) {
  const [vx, , vw] = svg.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  const out = [];
  for (const m of svg.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)) {
    const attrs = m[1];
    if (/transform=/.test(attrs)) continue; // the rotated y title stands on the left edge
    const cls = (attrs.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
    const x = Number(attrs.match(/\bx="([^"]+)"/)[1]);
    const px = cls.includes("cell-val") ? 11 : 12;
    const w = unescape(m[2]).length * 6.5 * (px / 12);
    const anchor = cls.includes("tick-y") || cls.includes("val-end") ? "end"
      : cls.includes("val-left") ? "start"
      : cls.some((c) => ["tick-x", "val", "cell-val"].includes(c)) ? "middle"
      : attrs.match(/text-anchor="([^"]+)"/)?.[1] ?? "start";
    const lo = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    out.push({ text: unescape(m[2]), lo, hi: lo + w, min: vx, max: vx + vw, attrs });
  }
  return out;
}

const svgsOf = (html) => [...html.matchAll(/<svg [\s\S]*?<\/svg>/g)].map((m) => m[0]);

for (const kind of CHART_KINDS) {
  test(`chart ${kind}: no label leaves the viewBox, gallery or widest fixture`, () => {
    for (const block of [chartsByKind.get(kind), { type: "chart", kind, data: { format: "int", ...WIDE[kind] } }]) {
      for (const svg of svgsOf(renderChart(block))) {
        for (const t of textExtents(svg)) {
          assert.ok(t.lo >= t.min && t.hi <= t.max,
            `${kind}: "${t.text}" spans ${t.lo.toFixed(1)}..${t.hi.toFixed(1)}, viewBox ${t.min}..${t.max}`);
        }
      }
    }
  });
}

test("delta value labels carry their bar's tone", () => {
  const html = renderChart(chartsByKind.get("delta"));
  // Latency, lower is better: +44 ms is red, -11 ms is green.
  assert.match(html, /class="val" style="fill:#d03b3b">\+44 ms</);
  assert.match(html, /class="val" style="fill:#0ca30c">-11 ms</);
});

test("waterfall step labels are toned, balances stay white", () => {
  const html = renderChart(chartsByKind.get("waterfall"));
  assert.match(html, /style="fill:#0ca30c">34</);
  assert.match(html, /style="fill:#d03b3b">-41</);
  assert.match(html, /class="val">168</);
});

test("funnel step drops are red and right-aligned", () => {
  const drops = [...renderChart(chartsByKind.get("funnel")).matchAll(/class="val val-end"([^>]*)>([^<]+)</g)];
  assert.equal(drops.length, 4);
  for (const [, attrs, text] of drops) {
    assert.match(text, /^-\d+%$/);
    assert.equal(attrs, ' style="fill:#d03b3b"');
  }
});

test("a series tone colours its line, key and end label; others stay white", () => {
  const html = renderChart({ type: "chart", kind: "lines", data: { format: "int", ...WIDE.lines } });
  assert.match(html, /stroke="#d03b3b" stroke-width="2"/);
  assert.match(html, /class="stroke" style="background:#d03b3b"/);
  assert.match(html, /class="val val-left" style="fill:#d03b3b">322,000</);
  assert.match(html, /class="val val-left">412,000</);
  // Ticks never take a colour.
  assert.doesNotMatch(html, /class="tick[^"]*" style=/);
});

test("heatmap cell ink follows the fill's luminance", () => {
  const html = renderChart({ type: "chart", kind: "heatmap", data: { rows: ["a"], cols: ["x", "y"], values: [[0, 10]] } });
  assert.match(html, /class="cell-val" fill="#fff">0</);
  assert.equal(inkOn("#ffffff"), "#000");
  assert.equal(inkOn("#0b0b0b"), "#fff");
});

test("every tone ink clears 3:1 on true black", () => {
  const lum = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const [tone, hex] of Object.entries(TONE_INK)) {
    assert.ok((lum(hex) + 0.05) / 0.05 >= 3, `${tone} ${hex}`);
  }
});

test("chart text gets a true-black halo from the stylesheet", () => {
  assert.match(CSS, /\.chart text\{[^}]*paint-order:stroke fill;stroke:#000;stroke-width:3px;stroke-linejoin:round/);
});

/* ------------------------------------------------------------ log axes */

/** Diagnostics for one chart body, message text only. */
const chartErrs = (kind, data) => {
  const out = [];
  validateChart(out, { kind, data, line: 1 }, "t.md");
  return out.map((e) => e.message);
};

const SPEEDUP = {
  xScale: "log2", yScale: "log2", x: [1, 2, 4, 8, 16, 32, 64],
  series: [
    { name: "Ideal", values: [1, 2, 4, 8, 16, 32, 64], dashed: true },
    { name: "Amdahl f = 5%", values: [1, 1.9, 3.48, 5.93, 9.14, 12.55, 15.42] },
  ],
};

test("logTicks() snaps to powers of the base and thins a wide range", () => {
  assert.deepEqual(logTicks(1, 64, 2), { lo: 1, hi: 64, ticks: [1, 2, 4, 8, 16, 32, 64] });
  assert.deepEqual(logTicks(0.023, 1.9, 10), { lo: 0.01, hi: 10, ticks: [0.01, 0.1, 1, 10] });
  // A single power still spans one step.
  assert.deepEqual(logTicks(8, 8, 2).ticks, [8, 16]);
  const wide = logTicks(1, 2 ** 20, 2);
  assert.ok(wide.ticks.length <= 9);
  assert.equal(wide.ticks[0], 1);
  assert.ok(wide.hi >= 2 ** 20 && wide.ticks.at(-1) === wide.hi);
});

test("log axes place powers of the base evenly and dash a reference series", () => {
  const html = renderChart({ type: "chart", kind: "lines", data: SPEEDUP });
  const ideal = html.match(/<path d="([^"]+)"[^>]*stroke-dasharray="6 5"/)[1];
  const pts = [...ideal.matchAll(/[ML]([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(pts.length, 7);
  const steps = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
  // Ideal speedup on log2-log2 is a straight line: every doubling is the same step.
  for (const [dx, dy] of steps) {
    assert.ok(Math.abs(dx - steps[0][0]) < 0.02 && Math.abs(dy - steps[0][1]) < 0.02);
  }
  assert.equal((html.match(/stroke-dasharray/g) ?? []).length, 1);
  assert.match(html, /class="stroke" style="background:repeating-linear-gradient/);
  // Gridlines on both log axes: 7 horizontal, 7 vertical.
  assert.equal((html.match(/class="grid"/g) ?? []).length, 14);
  for (const t of ["1", "2", "64"]) assert.match(html, new RegExp(`class="tick tick-x">${t}<`));
});

test("log tick labels below one never round to zero", () => {
  const html = renderChart({ type: "chart", kind: "lines", data: {
    format: "int", yScale: "log10", labels: ["a", "b"], series: [{ name: "loss", values: [1.8, 0.023] }],
  } });
  for (const t of ["0.01", "0.1", "1", "10"]) assert.match(html, new RegExp(`class="tick tick-y">${t}<`));
});

test("lines and scatter keep labels inside the viewBox on log axes", () => {
  const blocks = [
    { type: "chart", kind: "lines", data: SPEEDUP },
    { type: "chart", kind: "lines", data: { yScale: "log10", x: [0.5, 3, 900], series: [{ name: "a", values: [1e-6, 3, BIG] }] } },
    { type: "chart", kind: "scatter", data: { xScale: "log10", yScale: "log2", points: [{ x: 0.001, y: 0.25 }, { x: BIG, y: 4096 }], xTitle: LONG, yTitle: LONG } },
  ];
  for (const block of blocks) {
    for (const t of textExtents(svgsOf(renderChart(block))[0])) {
      assert.ok(t.lo >= t.min && t.hi <= t.max, `"${t.text}" spans ${t.lo.toFixed(1)}..${t.hi.toFixed(1)}`);
    }
  }
});

test("explicit linear scales render exactly what absent scales do", () => {
  const plain = { labels: ["a", "b", "c"], series: [{ name: "s", values: [3, 9, 4] }] };
  const lines = (data) => renderChart({ type: "chart", kind: "lines", data });
  assert.equal(lines({ ...plain, xScale: "linear", yScale: "linear" }), lines(plain));
  const pts = { points: [{ x: 1, y: 2 }, { x: 30, y: 40 }] };
  const scatter = (data) => renderChart({ type: "chart", kind: "scatter", data });
  assert.equal(scatter({ ...pts, xScale: "linear", yScale: "linear" }), scatter(pts));
});

test("log axes reject values they cannot place, with a pointer to each", () => {
  assert.deepEqual(chartErrs("lines", { yScale: "log10", labels: ["a", "b"], series: [{ name: "s", values: [1, 0] }] }),
    ["/series/0/values/1 expected a value > 0 on the log10 y axis, got 0"]);
  assert.deepEqual(chartErrs("lines", { xScale: "log2", x: [0, 1], series: [{ name: "s", values: [1, 2] }] }),
    ["/x/0 expected a value > 0 on the log2 x axis, got 0"]);
  assert.deepEqual(chartErrs("lines", { xScale: "log2", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] }),
    ['/x expected an array of numbers for xScale "log2", got nothing']);
  assert.deepEqual(chartErrs("lines", { yScale: "ln", labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }] }),
    ['/yScale expected one of linear log2 log10, got "ln"']);
  assert.deepEqual(chartErrs("scatter", { xScale: "log10", points: [{ x: -3, y: 1 }] }),
    ["/points/0/x expected a value > 0 on the log10 x axis, got -3"]);
});

test("numeric x must increase and set the series length", () => {
  assert.deepEqual(chartErrs("lines", { x: [1, 4, 2], series: [{ name: "s", values: [1, 2, 3] }] }),
    ["/x/2 expected x to increase, got 2 after 4"]);
  assert.deepEqual(chartErrs("lines", { x: [1, 2, 3], series: [{ name: "s", values: [1, 2] }] }),
    ["/series/0/values expected 3 numbers to match x, got 2"]);
  assert.deepEqual(chartErrs("lines", { x: [1, 2], labels: ["a"], series: [{ name: "s", values: [1, 2] }] }),
    ["/labels expected 2 labels to match x, got 1"]);
  assert.deepEqual(chartErrs("lines", { x: [1, 2], series: [{ name: "s", values: [1, 2], dashed: "yes" }] }),
    ['/series/0/dashed expected true or false, got "yes"']);
  // `dashed` belongs to lines only.
  assert.deepEqual(chartErrs("grouped", { labels: ["a"], series: [{ name: "s", values: [1], dashed: true }] }),
    ['/series/0/dashed unknown key "dashed"; keys: name values tone']);
});

/* ------------------------------------------------ ML evaluation additions */

const chart = (kind, data) => renderChart({ type: "chart", kind, data });

test("heatmap emphasis outlines exactly the diagonal, under the cell values", () => {
  const data = { format: "int", rows: ["cat", "dog", "bird"], cols: ["cat", "dog", "bird"], values: [[88, 7, 5], [9, 85, 6], [3, 4, 93]] };
  const html = chart("heatmap", { ...data, emphasis: "diagonal" });
  const outlines = [...html.matchAll(/<rect x="([\d.]+)" y="([\d.]+)"[^>]*fill="none" stroke="#0ca30c"/g)];
  assert.equal(outlines.length, 3);
  // One per row and column, and each drawn before its value so the number sits on top.
  assert.equal(new Set(outlines.map((m) => m[1])).size, 3);
  assert.equal(new Set(outlines.map((m) => m[2])).size, 3);
  assert.match(html, /fill="none" stroke="#0ca30c" stroke-width="2"\/><text [^>]*class="cell-val"[^>]*>88</);
  assert.doesNotMatch(chart("heatmap", data), /stroke="#0ca30c"/);
});

test("heatmap decimals print every cell to the same places, never -0", () => {
  const html = chart("heatmap", { decimals: 2, rows: ["q"], cols: ["a", "b", "c"], values: [[0.6, 0.05, 0.004]] });
  const cells = [...html.matchAll(/class="cell-val"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(cells, ["0.60", "0.05", "0.00"]);
  assert.equal(fixed(2)(-0.001), "0.00");
  assert.equal(fixed(0)(41.6), "42");
});

const ROC = {
  xTitle: "false positive rate", yTitle: "true positive rate", square: true, refs: ["diagonal"],
  series: [
    { name: "A", points: [[0, 0], [0.05, 0.6], [0.2, 0.9], [1, 1]] },
    { name: "B", points: [[0, 0], [0.3, 0.6], [1, 1]] },
  ],
};

test("point series draw on their own x, named in a legend, with no end labels", () => {
  const html = chart("lines", ROC);
  const paths = [...html.matchAll(/<path d="([^"]+)" fill="none"[^>]*><title>([^<]+)<\/title>/g)];
  assert.deepEqual(paths.map((m) => m[2]), ["A", "B"]);
  assert.deepEqual(paths.map((m) => m[1].split(" ").length), [4, 3]);
  assert.equal((html.match(/class="key"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /val-left|r="9"/);
  // A single point series still gets its legend: the name is the only label it has.
  assert.match(chart("lines", { series: [ROC.series[0]] }), /class="key"/);
});

test("square makes the plot as wide as it is tall and the diagonal runs corner to corner", () => {
  const html = chart("lines", ROC);
  const axis = html.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="[\d.]+" class="axis"\/>/).slice(1).map(Number);
  const grid = [...html.matchAll(/y1="([\d.]+)"[^>]*class="grid"/g)].map((m) => Number(m[1]));
  const [x0, y1, x1] = axis;
  const y0 = Math.min(...grid);
  assert.ok(Math.abs((x1 - x0) - (y1 - y0)) < 0.02, `plot ${x1 - x0} wide, ${y1 - y0} tall`);
  const diag = html.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#6f6f6a"[^>]*stroke-dasharray="5 4"/).slice(1).map(Number);
  assert.deepEqual(diag, [x0, y1, x1, y0]);
  assert.match(html, /style="max-width:[\d.]+px;margin:0 auto"[^>]*class="chart compact"/);
  assert.match(html, /rotate\(-90\)[^>]*>true positive rate</);
  assert.match(html, /class="tick tick-x">false positive rate</);
});

test("ref labels step aside from the lines they would sit on", () => {
  // The curve ends on the baseline at the right, so the label moves to the left end.
  const pr = chart("lines", { square: true, refs: [{ y: 0.3, label: "no skill" }], series: [{ name: "AP", points: [[0, 1], [0.5, 0.9], [1, 0.3]] }] });
  assert.match(pr, /class="tick" text-anchor="start">no skill</);
  // Nothing in the way: the default is the right end.
  const flat = chart("lines", { refs: [{ y: 0.3, label: "floor" }], series: [{ name: "s", points: [[0, 1], [1, 0.9]] }] });
  assert.match(flat, /class="tick" text-anchor="end">floor</);
  for (const html of [pr, flat]) {
    for (const t of textExtents(svgsOf(html)[0])) assert.ok(t.lo >= t.min && t.hi <= t.max, `"${t.text}" leaves the viewBox`);
  }
});

test("an x ref widens the axis to reach it and works on a log y axis", () => {
  const html = chart("lines", {
    yScale: "log10", refs: [{ x: 80, label: "early stop" }],
    series: [{ name: "train", points: [[1, 2.1], [10, 0.4], [40, 0.05]] }, { name: "val", points: [[5, 1.2], [30, 0.3]] }],
  });
  assert.match(html, /class="tick tick-x">80</);
  assert.match(html, /class="tick tick-y">0.01</);
  assert.match(html, />early stop</);
  assert.doesNotMatch(html, /NaN|Infinity/);
});

test("a y ref on a categorical axis is folded into the y range", () => {
  const html = chart("lines", { labels: ["a", "b"], refs: [{ y: 500, label: "budget" }], series: [{ name: "s", values: [10, 20] }] });
  const ref = Number(html.match(/<line x1="[\d.]+" y1="([\d.]+)"[^>]*stroke-dasharray="5 4"/)[1]);
  assert.ok(ref >= 16 && ref < 206, `ref at y ${ref}`);
  assert.match(html, />budget</);
});

test("the new keys at their defaults render exactly what their absence does", () => {
  const off = { refs: [], xTitle: "", yTitle: "", square: false };
  for (const kind of ["lines", "scatter"]) {
    const block = chartsByKind.get(kind);
    assert.equal(renderChart({ ...block, data: { ...off, marks: [], ...block.data } }), renderChart(block));
  }
  const heat = chartsByKind.get("heatmap");
  assert.equal(renderChart({ ...heat, data: { ...heat.data, emphasis: "" } }), renderChart(heat));
});

test("scatter series colour their groups, share one legend and carry centroid marks", () => {
  const html = chart("scatter", {
    series: [
      { name: "sports", points: [[-4, 2], [-3.5, 2.4], [-3, 1.6]] },
      { name: "finance", points: [[3, 3], [3.6, 3.8]], tone: "bad" },
    ],
    marks: [{ at: [-3.5, 2], label: "k1" }, { at: [3.3, 3.4] }],
  });
  assert.equal((html.match(/<circle /g) ?? []).length, 5);
  assert.match(html, /<g fill="#3987e5"[^>]*><title>sports<\/title>/);
  assert.match(html, /<g fill="#d03b3b"[^>]*><title>finance<\/title>/);
  assert.equal((html.match(/class="key"/g) ?? []).length, 2);
  // Each mark is a black-outlined white cross; only the labelled one prints text.
  assert.equal((html.match(/stroke="#fff" stroke-width="2.5"/g) ?? []).length, 2);
  assert.match(html, /class="tick" text-anchor="start">k1</);
  // The axes fit the cloud rather than starting at zero.
  const xs = [...html.matchAll(/class="tick tick-x">([^<]+)</g)].map((m) => Number(m[1]));
  assert.ok(xs[0] < -3.9 && xs[0] >= -5 && xs.at(-1) >= 3.6 && xs.at(-1) <= 5, `x ticks ${xs}`);
});

test("a negative low point on a zero-floored numeric x still ticks on round steps", () => {
  const html = chart("lines", { x: [-3.7, 0, 4], series: [{ name: "s", values: [1, 2, 3] }] });
  const xs = [...html.matchAll(/class="tick tick-x">([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(xs, ["-4", "-2", "0", "2", "4"]);
});

test("ML additions are rejected with a pointer when malformed", () => {
  const pts = (k) => Array.from({ length: k }, (_, i) => [i, i]);
  const cases = [
    ["lines", { labels: ["a", "b"], series: [{ name: "s", points: [[0, 1], [1, 2]] }] }, '/labels cannot be combined with series points; each series carries its own [x, y] pairs'],
    ["lines", { series: [{ name: "a", points: [[0, 1], [1, 2]] }, { name: "b", values: [1, 2] }] }, "/series/1/values cannot be combined with points; give every series points"],
    ["lines", { series: [{ name: "s", points: [[0, 1], [1]] }] }, "/series/0/points/1 expected an [x, y] pair, got an array of 1"],
    ["lines", { series: [{ name: "s", points: [[0, 1]] }] }, "/series/0/points expected at least 2 [x, y] pairs, got 1"],
    ["lines", { series: [{ name: "s", points: pts(1001) }] }, "/series/0/points expected at most 1000 points, got 1001"],
    ["lines", { series: [{ name: "s", points: [[0, 1], [1e16, 2]] }] }, "/series/0/points/1/0 expected a value within ±1e15, got 10000000000000000; rescale the units"],
    ["lines", { yScale: "log10", series: [{ name: "s", points: [[0, 1], [1, 0]] }] }, "/series/0/points/1/1 expected a value > 0 on the log10 y axis, got 0"],
    ["lines", { series: [{ name: "s", points: [[0, 1], [1e-320, 1]] }] }, "/series expected the x values to span or reach at least 1e-300, got 1e-320; rescale the units"],
    ["lines", { labels: ["a", "b"], refs: ["diagonal"], series: [{ name: "s", values: [1, 2] }] }, "/refs/0 needs a numeric x axis; give x or series points"],
    ["lines", { labels: ["a", "b"], refs: [{ x: 1 }], series: [{ name: "s", values: [1, 2] }] }, "/refs/0/x needs a numeric x axis; give x or series points"],
    ["lines", { yScale: "log10", refs: ["diagonal"], series: [{ name: "s", points: [[1, 1], [2, 2]] }] }, '/refs/0 expected the same xScale and yScale for the diagonal, got "linear" and "log10"'],
    ["lines", { refs: [{ x: 1, y: 2 }], series: [{ name: "s", points: [[0, 1], [1, 2]] }] }, "/refs/0 expected one of x or y, got both; give each line its own ref"],
    ["lines", { refs: ["diag"], series: [{ name: "s", points: [[0, 1], [1, 2]] }] }, '/refs/0 expected "diagonal", { "y": n } or { "x": n }, got "diag"'],
    ["lines", { refs: Array(9).fill("diagonal"), series: [{ name: "s", points: [[0, 1], [1, 2]] }] }, "/refs expected at most 8 refs, got 9"],
    ["lines", { yScale: "log2", refs: [{ y: -1 }], series: [{ name: "s", points: [[0, 1], [1, 2]] }] }, "/refs/0/y expected a value > 0 on the log2 y axis, got -1"],
    ["lines", { square: "yes", labels: ["a"], series: [{ name: "s", values: [1] }] }, '/square expected true or false, got "yes"'],
    ["scatter", { points: [{ x: 1, y: 1 }], series: [{ name: "s", points: [[1, 1]] }] }, "/points cannot be combined with series; give each group its own points"],
    ["scatter", { series: [{ name: "a", points: pts(1000) }, { name: "b", points: pts(1000) }, { name: "c", points: pts(1) }] }, "/series expected at most 2000 points across all series, got 2001; sample them"],
    ["scatter", { series: [{ name: "s", points: [[1, 1]] }], marks: [{ at: [1] }] }, "/marks/0/at expected an [x, y] pair, got an array of 1"],
    ["scatter", { series: [{ name: "s", points: [[1, 1]] }], marks: Array(33).fill({ at: [1, 1] }) }, "/marks expected at most 32 marks, got 33"],
    ["scatter", { points: Array(1001).fill({ x: 1, y: 1 }) }, "/points expected at most 1000 points, got 1001"],
    ["heatmap", { rows: ["a", "b"], cols: ["a"], values: [[1], [2]], emphasis: "diagonal" }, "/emphasis expected as many rows as cols for the diagonal, got 2 rows and 1 cols"],
    ["heatmap", { rows: ["a"], cols: ["a"], values: [[1]], emphasis: "rows" }, '/emphasis expected one of diagonal, got "rows"'],
    ["heatmap", { rows: ["a"], cols: ["a"], values: [[1]], decimals: 7 }, "/decimals expected an integer from 0 to 6, got 7"],
    ["heatmap", { rows: ["a"], cols: ["a"], values: [[1]], decimals: 2, format: "pct" }, "/decimals cannot be combined with format; decimals prints every cell as a plain number"],
    ["heatmap", { rows: Array(41).fill("r"), cols: ["a"], values: [] }, "/rows expected at most 40 rows, got 41"],
  ];
  for (const [kind, data, expected] of cases) assert.deepEqual(chartErrs(kind, data), [expected], `${kind} ${JSON.stringify(data).slice(0, 80)}`);
});

test("malformed ML bodies are diagnostics, never throws", () => {
  const junk = [null, 1, "x", [], {}, [null], [[null, null]], [{}], { at: null }];
  for (const v of junk) {
    for (const [kind, key] of [["lines", "series"], ["lines", "refs"], ["scatter", "series"], ["scatter", "marks"], ["heatmap", "emphasis"], ["heatmap", "decimals"]]) {
      const base = kind === "heatmap" ? { rows: ["a"], cols: ["a"], values: [[1]] } : { series: [{ name: "s", points: [[0, 1], [1, 2]] }] };
      assert.doesNotThrow(() => chartErrs(kind, { ...base, [key]: v }));
      assert.doesNotThrow(() => chartErrs(kind, { series: [{ name: "s", points: v }], refs: [v], marks: [{ at: v, label: v }] }));
    }
  }
});

test("a negative y reference pulls the baseline below zero, and wide heatmap headers sit over their cells", () => {
  const neg = chart("lines", { labels: ["a", "b"], series: [{ name: "s", values: [1, 2] }], refs: [{ y: -1, label: "threshold" }] });
  const y = Number(/y="([\d.]+)"[^>]*>threshold</.exec(neg)?.[1]);
  const top = Number(/viewBox="[-\d.]+ [-\d.]+ [\d.]+ ([\d.]+)"/.exec(neg)?.[1]);
  assert.ok(y > 0 && y < top, `threshold label at y=${y} must sit inside a ${top} tall chart`);

  const hm = chart("heatmap", { rows: ["r"], cols: Array.from({ length: 20 }, (_, i) => "c" + i), values: [Array(20).fill(0.123456)], decimals: 6 });
  const xs = [...hm.matchAll(/<text x="([\d.]+)"[^>]*class="tick tick-x">c/g)].map((m) => Number(m[1]));
  assert.equal(new Set(xs).size, 20);
});

test("a constant axis too small to tick is rejected, not drawn with NaN", () => {
  for (const v of [1e-320, 5e-324]) {
    assert.match(chartErrs("lines", { zeroFloor: false, series: [{ name: "s", points: [[0, v], [1, v]] }] })[0], /span or reach at least 1e-300/);
    assert.match(chartErrs("scatter", { series: [{ name: "s", points: [[v, v]] }] })[0], /span or reach at least 1e-300/);
  }
  // Above the floor tiny data renders: constant 1e-10, and a 2e-22 span the old tick loop could not finish.
  for (const values of [[1e-10, 1e-10], [0.000001, 0.0000010000000000000002]]) {
    for (const zeroFloor of [true, false]) {
      const body = { labels: ["a", "b"], series: [{ name: "s", values }], zeroFloor };
      assert.deepEqual(chartErrs("lines", body), []);
      assert.doesNotMatch(chart("lines", body), /NaN|Infinity/);
    }
  }
  // Marks count toward the plotted domain, and beside flat points they must sit on the 0-based axes.
  assert.match(chartErrs("scatter", { series: [{ name: "s", points: [[0, 0]] }], marks: [{ at: [5e-324, 5e-324] }] })[0], /reach at least 1e-300/);
  assert.match(chartErrs("scatter", { points: [{ x: 1, y: 1 }], marks: [{ at: [-10, -10] }] })[0], /^\/marks\/0\/at expected coordinates of 0 or more/);
});

test("extreme but valid ML bodies render finite geometry", () => {
  const bodies = [
    ["lines", { series: [{ name: "s", points: [[-1e15, -1e15], [1e15, 1e15]] }], refs: ["diagonal", { x: 0, label: "z" }, { y: 0, label: "z" }] }],
    ["lines", { zeroFloor: false, series: [{ name: "s", points: [[0, 2e-9], [1, 2e-9]] }] }],
    ["lines", { xScale: "log10", yScale: "log10", refs: ["diagonal"], series: [{ name: "s", points: [[1e-100, 1e100], [1e100, 1e-100]] }] }],
    ["scatter", { series: [{ name: "s", points: [[5, 5]] }], marks: [{ at: [5, 5], label: "only" }] }],
    ["scatter", { xScale: "log2", series: [{ name: "s", points: [[1e-100, -1e15], [1e100, 1e15]] }] }],
  ];
  for (const [kind, data] of bodies) {
    assert.deepEqual(chartErrs(kind, data), [], kind);
    assert.doesNotMatch(chart(kind, data), /NaN|Infinity/, JSON.stringify(data).slice(0, 80));
  }
});
