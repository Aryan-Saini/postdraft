import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseMarkdown } from "../src/render/index.js";
import {
  validateDoc, formatError, normalize, CHART_KINDS, FORMATS,
} from "../src/render/schema/index.js";

const GALLERY = fileURLToPath(new URL("../examples/gallery.md", import.meta.url));

/**
 * Wrap a fence body in a document whose fence lands on a known line, so a
 * fixture can pin the `file:line` half of an error string as well as the text.
 *
 * Lines 1-3 are the frontmatter, 4 is blank, 5 is the lead, 6 is blank, so the
 * opening ``` of `pad(0)` is line 7. `pad` pushes it further down.
 */
const doc = (fence, pad = 0) =>
  `---\ntitle: T\n---\n\nLead.\n${"\n".repeat(pad + 1)}${fence}\n`;

/** Parse + validate, asserting the parser itself had nothing to say. */
const check = (md, file = "plan.md") => {
  const r = parseMarkdown(md, { file });
  assert.deepEqual(r.errors, [], `parser complained: ${JSON.stringify(r.errors)}`);
  return validateDoc(r.doc, { file });
};

/** Every diagnostic, formatted the way the CLI prints it. */
const lines = (md, file) => check(md, file).map(formatError);

/** Assert a snippet validates clean. */
const clean = (md) => {
  const errors = check(md);
  assert.deepEqual(errors.map(formatError), [], "expected no errors");
};

/** Assert a snippet produces exactly one diagnostic, equal to `expected`. */
const one = (md, expected, pad = 0) => {
  const got = lines(doc(md, pad));
  assert.deepEqual(got, [expected]);
};

/* ============================================================ the golden file */

test("examples/gallery.md validates with zero errors", () => {
  const src = readFileSync(GALLERY, "utf8");
  const parsed = parseMarkdown(src, { file: "examples/gallery.md" });
  assert.deepEqual(parsed.errors, [], "gallery does not parse cleanly");
  const errors = validateDoc(parsed.doc, { file: "examples/gallery.md" });
  assert.deepEqual(errors.map(formatError), []);
});

/* ================================================ the plan's error strings */
// Each of these reproduces one line from the plan's Errors section byte for
// byte, including the file and the line number.

test("plan error 1: a short series names the length it had to match", () => {
  // The fence opens on line 40, so its body's second line is 41.
  const md = doc(
    '```chart lines\n{"labels":["W1","W2","W3","W4","W5","W6","W7","W8"],\n' +
    ' "series":[{"name":"Median","values":[284,301,296,340,366,392,401]}]}\n```',
    34,
  );
  assert.deepEqual(lines(md), [
    "plan.md:41 chart lines: /series/0/values expected 8 numbers to match labels, got 7",
  ]);
});

test("plan error 2: a non-number in a values array is pointed at by index", () => {
  const md = doc(
    '```chart columns\n{"labels":["Apr","May","Jun","Jul"],"values":[61,78,96,"n/a"]}\n```',
    56,
  );
  assert.deepEqual(lines(md), [
    'plan.md:63 chart columns: /values/3 expected number, got "n/a"',
  ]);
});

test("plan error 3: an unknown chart kind lists every kind", () => {
  const md = doc('```chart pie\n{"labels":["a"],"values":[1]}\n```', 73);
  assert.deepEqual(lines(md), [
    'plan.md:80 unknown block "chart pie"; kinds: columns bars lines grouped stacked ' +
    "delta whisker heatmap waterfall scatter funnel schedule small-multiples share",
  ]);
});

test("plan error 4: an html fence runs the upload policy", () => {
  const md = doc('```html\n<script src="https://cdn.example.com/x.js"></script>\n```', 105);
  assert.deepEqual(lines(md), [
    "plan.md:112 html: <script src=…> rejected by upload policy",
  ]);
});

/* ============================================ one passing fixture per kind */

const PASSING = {
  "chart columns": '{"title":"T","format":"int","labels":["a","b"],"values":[1,2]}',
  "chart bars": '{"labels":["a","b"],"values":[4,1]}',
  "chart lines": '{"format":"ms","area":true,"zeroFloor":false,"labels":["a","b"],' +
    '"series":[{"name":"S","values":[1,2]}]}',
  "chart grouped": '{"labels":["a","b"],"series":[{"name":"S","values":[1,2]},{"name":"T","values":[3,4]}]}',
  "chart stacked": '{"labels":["a","b"],"series":[{"name":"S","values":[1,2]},{"name":"T","values":[3,4]}]}',
  "chart delta": '{"higherIsBetter":false,"labels":["a","b"],"values":[-3,44]}',
  "chart whisker": '{"labels":["a"],"mid":[18],"lo":[11],"hi":[41]}',
  "chart heatmap": '{"rows":["Mon","Tue"],"cols":["00","03","06"],"values":[[1,0,2],[0,1,3]]}',
  "chart waterfall": '{"labels":["Open","Add","Close"],"values":[100,20,120],"totals":[0,2]}',
  "chart scatter": '{"xTitle":"x","yTitle":"y","points":[{"label":"P","x":1,"y":2,"size":3},{"x":4,"y":5}]}',
  "chart funnel": '{"labels":["a","b"],"values":[100,40]}',
  "chart schedule": '{"tasks":[{"label":"A","start":"2026-08-10","end":"2026-08-14","done":true},' +
    '{"label":"B","start":"2026-08-14","end":"2026-09-01"}]}',
  "chart small-multiples": '{"labels":["a","b"],"series":[{"name":"S","values":[1,2]}]}',
  "chart share": '{"labels":["a","b","c"],"values":[612,284,131]}',
  stats: '[{"k":"Docs","v":1284,"format":"int","delta":"+18%","tone":"good","spark":[1,2,3]},' +
    '{"k":"Cap","v":486,"meter":{"max":512}}]',
  hero: '[{"k":"Burn","v":412000,"format":"usd","as":"Aug 2026","delta":"-6%","tone":"good"}]',
  flow: '{"title":"T","cols":[[{"id":"a","label":"A","shape":"round"}],' +
    '[{"id":"b","label":"B","shape":"diamond"},{"id":"c","label":"C","tone":"bad"}]],' +
    '"edges":[{"from":"a","to":"b"},{"from":"b","to":"c","label":"reject"}]}',
  sequence: '{"actors":["Agent","Convex"],"msgs":[{"from":"Agent","to":"Convex","label":"POST"},' +
    '{"from":"Convex","to":"Agent","label":"200","dashed":true}]}',
  timeline: '[{"when":"Aug 12","what":"Forked","state":"done","note":"n"},{"when":"Next","what":"Ship"}]',
  slides: '[{"src":"https://e.example/1.png","caption":"One"},{"src":"data:image/png;base64,iVBORw0KGgo="}]',
  video: '{"src":"https://e.example/c.mp4","poster":"https://e.example/p.png","caption":"0:42"}',
};

for (const [fence, body] of Object.entries(PASSING)) {
  test(`${fence} accepts its documented body`, () => {
    clean(doc(`\`\`\`${fence}\n${body}\n\`\`\``));
  });
}

test("an html fence of plain markup passes the policy", () => {
  clean(doc('```html\n<div class="mocks"><p>Hi</p></div>\n```'));
});

test("every chart kind has a passing fixture", () => {
  const covered = Object.keys(PASSING)
    .filter((k) => k.startsWith("chart "))
    .map((k) => k.slice("chart ".length));
  assert.deepEqual(covered.sort(), [...CHART_KINDS].sort());
});

/* ============================================================ the enums */

test("format is the enum, and the error names the whole enum", () => {
  one(
    '```chart columns\n{"format":"currency","labels":["a"],"values":[1]}\n```',
    'plan.md:7 chart columns: /format expected one of int compact usd pct ms, got "currency"',
  );
  assert.deepEqual([...FORMATS], ["int", "compact", "usd", "pct", "ms"]);
});

test("an unknown ::: container lists the container kinds", () => {
  one(
    "::: middle\nA line.\n:::",
    'plan.md:7 unknown block "::: middle"; kinds: center right subtext columns, or a colour: red orange amber yellow green teal cyan blue indigo violet purple pink gray white',
  );
});

test("a timeline state outside the enum names the enum", () => {
  one(
    '```timeline\n[{"when":"Aug","what":"A","state":"soon"}]\n```',
    'plan.md:7 timeline: /0/state expected one of done now next, got "soon"',
  );
});

/* ============================================================ media src */
// Published documents draw only https: and data: images, so anything else is
// caught at render time, wherever the image is written.

const FIX = "must be https: or data: (publish it with file-upload first)";

test("a slide, poster or clip src must be https: or data:", () => {
  one(
    '```slides\n[{"src":"https://e.example/1.png"},{"src":"./shots/2.png"}]\n```',
    `plan.md:7 slides: image src "./shots/2.png" ${FIX}`,
  );
  assert.deepEqual(lines(doc('```video\n{"src":"http://e.example/c.mp4","poster":"/p.png"}\n```')), [
    `plan.md:7 video: video src "http://e.example/c.mp4" ${FIX}`,
    `plan.md:7 video: image src "/p.png" ${FIX}`,
  ]);
});

test("a markdown image or an html fence img must be https: or data:", () => {
  one('![Dash](dash.png "zoom")', `plan.md:7 image src "dash.png" ${FIX}`);
  one('```html\n<div class="pair"><img src="before.png?v=1&amp;x=2" alt="B"></div>\n```',
    `plan.md:7 image src "before.png?v=1&x=2" ${FIX}`);
  clean(doc('![Dash](https://e.example/d.png "zoom")\n\n![Dot](data:image/png;base64,iVBORw0KGgo=)'));
});

test("a src= inside an alt or title is not read as the src", () => {
  clean(doc('![A](https://x.example/a.png "alt with src=foo")'));
  clean(doc('```html\n<img alt=" src=bad.png" title=\'poster=x\' src="https://x.example/a.png">\n```'));
  one('```html\n<img alt="src=https://x.example/a.png" src="a.png">\n```', `plan.md:7 image src "a.png" ${FIX}`);
});

/* ============================================================ numbers */

test("non-finite numbers are rejected, JSON literals and all", () => {
  // JSON has no NaN, so the only route in is the IR path or a huge literal.
  one(
    '```chart columns\n{"labels":["a","b"],"values":[1,1e400]}\n```',
    "plan.md:7 chart columns: /values/1 expected a finite number, got Infinity",
  );
});

test("a tile value must be a number", () => {
  one(
    '```stats\n[{"k":"Docs","v":"1,284"}]\n```',
    'plan.md:7 stats: /0/v expected number, got "1,284"',
  );
});

/* ============================================================ the series cap */

test("more than eight series says what to do about it", () => {
  const series = Array.from({ length: 11 }, (_, i) =>
    `{"name":"S${i}","values":[1,2]}`).join(",");
  one(
    `\`\`\`chart lines\n{"labels":["a","b"],"series":[${series}]}\n\`\`\``,
    'plan.md:7 chart lines: /series expected at most 8 series, got 11; fold the tail ' +
    'into "Other" or facet with chart small-multiples',
  );
});

test("a share strip caps at eight parts too", () => {
  const labels = JSON.stringify(Array.from({ length: 9 }, (_, i) => `p${i}`));
  const values = JSON.stringify(Array.from({ length: 9 }, () => 1));
  one(
    `\`\`\`chart share\n{"labels":${labels},"values":${values}}\n\`\`\``,
    'plan.md:7 chart share: /labels expected at most 8 parts, got 9; fold the tail ' +
    'into "Other" or facet with chart small-multiples',
  );
});

/* ============================================ per-primitive invariants */

test("whisker needs lo <= mid <= hi", () => {
  assert.deepEqual(lines(doc('```chart whisker\n{"labels":["a"],"mid":[5],"lo":[9],"hi":[20]}\n```')), [
    "plan.md:7 chart whisker: /lo/0 expected lo <= mid, got 9 > 5",
  ]);
  assert.deepEqual(lines(doc('```chart whisker\n{"labels":["a"],"mid":[25],"lo":[9],"hi":[20]}\n```')), [
    "plan.md:7 chart whisker: /mid/0 expected mid <= hi, got 25 > 20",
  ]);
});

test("heatmap values are a rows x cols matrix", () => {
  one(
    '```chart heatmap\n{"rows":["Mon","Tue"],"cols":["00","03"],"values":[[1,2],[3,4,5]]}\n```',
    "plan.md:7 chart heatmap: /values/1 expected 2 numbers to match cols, got 3",
  );
  one(
    '```chart heatmap\n{"rows":["Mon","Tue"],"cols":["00","03"],"values":[[1,2]]}\n```',
    "plan.md:7 chart heatmap: /values expected 2 rows to match rows, got 1",
  );
});

test("waterfall totals must index the labels", () => {
  one(
    '```chart waterfall\n{"labels":["a","b"],"values":[1,2],"totals":[0,5]}\n```',
    "plan.md:7 chart waterfall: /totals/1 expected a label index between 0 and 1, got 5",
  );
});

test("schedule dates are ISO and ordered", () => {
  one(
    '```chart schedule\n[]\n```'.replace("[]", '{"tasks":[{"label":"A","start":"Aug 10","end":"2026-08-14"}]}'),
    'plan.md:7 chart schedule: /tasks/0/start expected an ISO date YYYY-MM-DD, got "Aug 10"',
  );
  one(
    '```chart schedule\n{"tasks":[{"label":"A","start":"2026-09-01","end":"2026-08-14"}]}\n```',
    'plan.md:7 chart schedule: /tasks/0/end expected end on or after start, got "2026-08-14" before "2026-09-01"',
  );
  one(
    '```chart schedule\n{"tasks":[{"label":"A","start":"2026-02-31","end":"2026-03-04"}]}\n```',
    'plan.md:7 chart schedule: /tasks/0/start expected an ISO date YYYY-MM-DD, got "2026-02-31"',
  );
});

test("a flow edge cannot name a node that does not exist", () => {
  one(
    '```flow\n{"cols":[[{"id":"a","label":"A"}]],"edges":[{"from":"a","to":"zz"}]}\n```',
    'plan.md:7 flow: /edges/0/to no node with id "zz"; ids: a',
  );
});

test("flow node ids are unique across columns", () => {
  one(
    '```flow\n{"cols":[[{"id":"a","label":"A"}],[{"id":"a","label":"B"}]],"edges":[]}\n```',
    'plan.md:7 flow: /cols/1/0/id duplicate node id "a"; ids must be unique across columns',
  );
});

test("a sequence message cannot name an undeclared actor", () => {
  one(
    '```sequence\n{"actors":["Agent"],"msgs":[{"from":"Agent","to":"S3","label":"PUT"}]}\n```',
    'plan.md:7 sequence: /msgs/0/to no actor named "S3"; actors: Agent',
  );
});

test("a sparkline of one point is a dot", () => {
  one(
    '```stats\n[{"k":"Docs","v":1,"spark":[7]}]\n```',
    "plan.md:7 stats: /0/spark expected at least 2 sparkline values, got 1",
  );
});

test("a typo'd key is named rather than dropped", () => {
  assert.deepEqual(lines(doc('```chart columns\n{"lables":["a"],"values":[1]}\n```')), [
    "plan.md:7 chart columns: /labels expected an array of labels, got nothing",
    'plan.md:7 chart columns: /lables unknown key "lables"; keys: title note caption format src views controls labels values',
  ]);
});

/* ============================================================ document rules */

test("block ids are unique across the document", () => {
  const md = doc(
    '```chart columns id=dup\n{"labels":["a"],"values":[1]}\n```\n\n' +
    '```chart bars id=dup\n{"labels":["a"],"values":[1]}\n```',
  );
  assert.deepEqual(lines(md), [
    'plan.md:11 chart: duplicate block id "dup"; first used on line 7',
  ]);
});

test("every error is collected, never the first one only", () => {
  const md = doc(
    '```chart columns\n{"labels":["a","b"],"values":[1,"x"],"format":"euros"}\n```\n\n' +
    '```chart pie\n{}\n```\n\n```stats\n[{"k":"A"}]\n```',
  );
  assert.equal(check(md).length, 4);
});

test("a body of the wrong type is a diagnostic, not a throw", () => {
  one('```chart columns\n[1,2,3]\n```', "plan.md:7 chart columns: expected an object, got an array of 3");
  one('```stats\n{"k":"A"}\n```', "plan.md:7 stats: expected at least one tile, got an object");
});

test("a chart with a src defers its rows to the side file", () => {
  clean(doc('```chart columns\n{"title":"T","format":"int","src":"data/x.json"}\n```'));
  one(
    '```chart columns\n{"src":"data/x.json","labels":["a"]}\n```',
    'plan.md:7 chart columns: /labels unknown key "labels"; keys: title note caption format src views controls',
  );
});

test("a JSON syntax error is reported once, by the parser", () => {
  const r = parseMarkdown(doc('```chart columns\n{"labels":["a",}\n```'), { file: "plan.md" });
  assert.equal(r.errors.length, 1);
  // The body parsed to null; the schema stays quiet rather than piling on.
  assert.deepEqual(validateDoc(r.doc, { file: "plan.md" }), []);
});

test("validateDoc never mutates the document", () => {
  const { doc: parsed } = parseMarkdown(doc('```chart columns\n{"labels":["a"],"values":[1]}\n```'), {});
  const before = JSON.stringify(parsed);
  validateDoc(parsed, { file: "plan.md" });
  assert.equal(JSON.stringify(parsed), before);
});

/* ============================================================ normalize */

test("normalize fills the defaults renderers would branch on", () => {
  const { doc: parsed } = parseMarkdown(doc(
    '```chart lines\n{"labels":["a"],"series":[{"name":"S","values":[1]}]}\n```\n\n' +
    '```stats\n[{"k":"Docs","v":1}]\n```\n\n' +
    '```chart schedule\n{"tasks":[{"label":"A","start":"2026-01-01","end":"2026-02-01"}]}\n```',
  ), {});
  const before = JSON.stringify(parsed);
  const out = normalize(parsed);

  const chart = out.blocks.find((b) => b.kind === "lines");
  assert.equal(chart.data.title, "");
  assert.equal(chart.data.note, "");
  assert.equal(chart.data.format, "compact");
  assert.equal(chart.data.area, false);
  assert.equal(chart.data.zeroFloor, true);

  const stats = out.blocks.find((b) => b.type === "stats");
  assert.deepEqual(stats.data[0], {
    k: "Docs", v: 1, format: "compact", as: "", delta: "", tone: "", spark: [], meter: null,
  });

  const sched = out.blocks.find((b) => b.kind === "schedule");
  assert.equal(sched.data.tasks[0].done, false);

  assert.equal(out.meta.byline, "");
  assert.equal(JSON.stringify(parsed), before, "normalize mutated its input");
});

test("normalize keeps authored values and leaves prose alone", () => {
  const { doc: parsed } = parseMarkdown(doc(
    '```chart lines\n{"title":"Kept","format":"ms","zeroFloor":false,"labels":["a"],' +
    '"series":[{"name":"S","values":[1]}]}\n```',
  ), {});
  const out = normalize(parsed);
  const chart = out.blocks.find((b) => b.kind === "lines");
  assert.equal(chart.data.title, "Kept");
  assert.equal(chart.data.format, "ms");
  assert.equal(chart.data.zeroFloor, false);
  assert.equal(out.blocks.find((b) => b.type === "markdown").html.includes("Lead."), true);
});

test("normalize leaves the whole gallery renderable without undefined", () => {
  const src = readFileSync(GALLERY, "utf8");
  const { doc: parsed } = parseMarkdown(src, { file: "examples/gallery.md" });
  const out = normalize(parsed);
  for (const block of out.blocks) {
    if (block.type !== "chart") continue;
    assert.equal(typeof block.data.title, "string");
    assert.equal(typeof block.data.note, "string");
    assert.ok(FORMATS.includes(block.data.format), `${block.kind} format ${block.data.format}`);
  }
});

test("normalize fills the ML chart keys, and point series pass through untouched", () => {
  const { doc: parsed } = parseMarkdown(doc(
    '```chart lines\n{"series":[{"name":"ROC","points":[[0,0],[1,1]]}]}\n```\n\n' +
    '```chart scatter\n{"series":[{"name":"a","points":[[1,2]]}]}\n```',
  ), {});
  assert.deepEqual(validateDoc(parsed), []);
  const out = normalize(parsed);
  const lines = out.blocks.find((b) => b.kind === "lines").data;
  assert.deepEqual([lines.refs, lines.xTitle, lines.yTitle, lines.square], [[], "", "", false]);
  assert.deepEqual(lines.series[0], { name: "ROC", points: [[0, 0], [1, 1]], tone: "" });
  const scatter = out.blocks.find((b) => b.kind === "scatter").data;
  assert.deepEqual(scatter.marks, []);
  assert.equal(scatter.points, undefined);
});

test("a ref the axis cannot carry is reported with its file and line", () => {
  one('```chart lines\n{"labels":["a","b"],"refs":["diagonal"],"series":[{"name":"s","values":[1,2]}]}\n```',
    "plan.md:7 chart lines: /refs/0 needs a numeric x axis; give x or series points");
});
