import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { render } from "../src/render/index.js";
import { textW } from "../src/render/diagrams/svg.js";

/*
 * Layout invariants for the node-and-edge diagrams (`flow`, `graph`): every node
 * label sits inside its node, and no two labels overlap. Widths use `textW`, the
 * same estimate the layout uses, so this checks that the layout accounts for its
 * text at all. `flow` once drew fixed-width boxes and long labels spilled across
 * each other; this is the test that would have caught it.
 */

const FENCES = new Set(["flow", "graph"]);

/** Every `flow` and `graph` fence in the examples, as `{ name, info, body }`. */
function exampleFences() {
  const dirs = ["../examples/", "../examples/diagrams/"].map((d) => fileURLToPath(new URL(d, import.meta.url)));
  const out = [];
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const md = readFileSync(dir + file, "utf8");
      for (const m of md.matchAll(/^```(\w+)\n([\s\S]*?)^```$/gm)) {
        if (FENCES.has(m[1])) out.push({ name: `${file}:${m[1]}`, info: m[1], body: m[2] });
      }
    }
  }
  return out;
}

/** A decision flow with the long labels real documents use. */
const LONG_FLOW = JSON.stringify({
  title: "Launch",
  cols: [[{ id: "a", label: "App launch", shape: "round" }],
    [{ id: "b", label: "checkGate(version, bundle)", shape: "diamond" }],
    [{ id: "c", label: "ok: normal check with a short time budget" },
      { id: "d", label: "stale bundle: is a newer update published for this runtime?", shape: "diamond" },
      { id: "e", label: "hard gate: the installed binary is too old", tone: "bad" }],
    [{ id: "f", label: "Open the app", shape: "round", tone: "good" },
      { id: "g", label: "Hold the splash screen and download with no time limit, then reload" },
      { id: "h", label: "Store wall", tone: "bad", shape: "store" }]],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "ok" }, { from: "b", to: "d", label: "stale_bundle" },
    { from: "b", to: "e", label: "hard" }, { from: "c", to: "f" }, { from: "d", to: "g", label: "yes" },
    { from: "d", to: "h", label: "no" }, { from: "e", to: "h" }, { from: "g", to: "f" }],
});

/** Text boxes for every node and edge label in an SVG string. */
function labels(svg) {
  return [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)" class="(node-label|edge-label)"(?: style="([^"]*)")?>([^<]*)<\/text>/g)]
    .map(([, x, y, cls, style = "", raw]) => {
      const t = raw.replace(/&(amp|lt|gt|quot);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[e]);
      const size = Number(/font-size:([\d.]+)px/.exec(style)?.[1] ?? (cls === "node-label" ? 13 : 11.5));
      const w = textW(t, size, style.includes("--mono"));
      const anchor = /text-anchor:(\w+)/.exec(style)?.[1] ?? "middle";
      const x0 = anchor === "start" ? Number(x) : anchor === "end" ? Number(x) - w : Number(x) - w / 2;
      return { t, cls, x0, x1: x0 + w, y0: Number(y) - size * 0.75, y1: Number(y) + size * 0.2 };
    });
}

/** Node outlines: rects and stores as boxes, diamonds as a centre and half-diagonals, circles. */
function shapes(svg) {
  const out = [];
  for (const [, x, y, w, h] of svg.matchAll(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx/g)) {
    out.push({ kind: "box", x0: +x, y0: +y, x1: +x + +w, y1: +y + +h });
  }
  for (const [, ...p] of svg.matchAll(/<path d="M([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+) L([-\d.]+),([-\d.]+) Z"/g)) {
    const [tx, ty, rx, , , by, lx] = p.map(Number);
    out.push({ kind: "diamond", cx: tx, cy: (ty + by) / 2, hw: (rx - lx) / 2, hh: (by - ty) / 2,
      x0: lx, y0: ty, x1: rx, y1: by });
  }
  for (const [, cx, cy, r] of svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)) {
    out.push({ kind: "circle", cx: +cx, cy: +cy, r: +r, x0: +cx - +r, y0: +cy - +r, x1: +cx + +r, y1: +cy + +r });
  }
  for (const [, x, y, w, h] of svg.matchAll(/<path d="M([-\d.]+),([-\d.]+) a[\d.]+,6 0 0 1 ([\d.]+),0 v([\d.]+)/g)) {
    out.push({ kind: "box", x0: +x, y0: +y - 6, x1: +x + +w, y1: +y + +h + 6 });
  }
  return out;
}

const EPS = 1;

/** Problems in one rendered figure: labels outside their node, and overlapping labels. */
function problems(svg) {
  const found = [];
  const ls = labels(svg), ss = shapes(svg);
  for (const l of ls.filter((l) => l.cls === "node-label")) {
    const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2;
    const s = ss.find((s) => cx >= s.x0 && cx <= s.x1 && cy >= s.y0 && cy <= s.y1);
    if (!s) {
      found.push(`node label ${JSON.stringify(l.t)} is in no node`);
    } else if (s.kind === "box") {
      if (l.x0 < s.x0 - EPS || l.x1 > s.x1 + EPS) found.push(`node label ${JSON.stringify(l.t)} spills out of its box`);
    } else if (s.kind === "circle") {
      // Text sits in the circle's middle band; its half-width must fit the radius.
      if ((l.x1 - l.x0) / 2 > s.r + EPS) found.push(`node label ${JSON.stringify(l.t)} spills out of its circle`);
    } else {
      const corner = (x, y) => Math.abs(x - s.cx) / s.hw + Math.abs(y - s.cy) / s.hh;
      if (Math.max(corner(l.x0, l.y0), corner(l.x1, l.y0), corner(l.x0, l.y1), corner(l.x1, l.y1)) > 1.02) {
        found.push(`node label ${JSON.stringify(l.t)} spills out of its diamond`);
      }
    }
  }
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      const a = ls[i], b = ls[j];
      if (a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS) {
        found.push(`labels ${JSON.stringify(a.t)} and ${JSON.stringify(b.t)} overlap`);
      }
    }
  }
  return found;
}

const fences = [{ name: "long-label flow", info: "flow", body: LONG_FLOW }, ...exampleFences()];

test("the examples include flow and graph fences to check", () => {
  assert.ok(fences.filter((f) => f.info === "flow").length >= 2);
  assert.ok(fences.filter((f) => f.info === "graph").length >= 5);
});

for (const f of fences) {
  test(`labels fit their nodes and do not overlap: ${f.name} ${f.body.slice(0, 40)}`, () => {
    const r = render(`---\ntitle: T\n---\n\nLead.\n\n\`\`\`${f.info}\n${f.body}\n\`\`\`\n`);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(problems(r.html), []);
  });
}
