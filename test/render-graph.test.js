import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseMarkdown, render as renderDoc } from "../src/render/index.js";
import { textW } from "../src/render/diagrams/svg.js";
import { validateDoc, formatError } from "../src/render/schema/index.js";
import { normalize, render } from "../src/render/diagrams/graph.js";
import { rank, place, spread, crossings } from "../src/render/diagrams/graph-layout.js";

/** Every diagnostic for one `graph` fence; the fence opens on line 5. */
const errorsOf = (body) => {
  const md = `---\ntitle: T\n---\n\n\`\`\`graph\n${JSON.stringify(body)}\n\`\`\`\n`;
  const r = parseMarkdown(md, { file: "g.md" });
  assert.deepEqual(r.errors, []);
  return validateDoc(r.doc, { file: "g.md" }).map(formatError);
};

const draw = (body) => render({ type: "graph", line: 1, data: normalize(body) });
const count = (svg, re) => (svg.match(re) ?? []).length;

test("examples/diagrams/graph.md validates with zero errors", () => {
  const path = fileURLToPath(new URL("../examples/diagrams/graph.md", import.meta.url));
  const r = parseMarkdown(readFileSync(path, "utf8"), { file: "graph.md" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(validateDoc(r.doc, { file: "graph.md" }).map(formatError), []);
});

test("validation names what it expected for each bad input", () => {
  assert.deepEqual(errorsOf([]), ["g.md:5 graph: expected an object { nodes, edges }, got an array of 0"]);
  assert.deepEqual(errorsOf({ nodes: [] }), ["g.md:5 graph: /nodes expected at least one node, got an empty array"]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a" }], dir: "up" }), ["g.md:5 graph: /dir expected one of down right, got \"up\""]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a" }, { id: "a" }] }),
    ["g.md:5 graph: /nodes/1/id duplicate node id \"a\"; ids must be unique"]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a", shape: "hex", tone: "red" }] }), [
    "g.md:5 graph: /nodes/0/shape expected one of box round circle double dot diamond store, got \"hex\"",
    "g.md:5 graph: /nodes/0/tone expected one of good warn bad flat span c1 c2 c3 c4 c5 c6 c7 c8, got \"red\"",
  ]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a", x: 3 }], edges: [], colour: 1 }), [
    "g.md:5 graph: /colour unknown key \"colour\"; keys: title note compact dir mono nodes edges groups",
    "g.md:5 graph: /nodes/0/x unknown key \"x\"; keys: id label shape tone fill start side below mono rank",
  ]);
});

test("edges must name real nodes, and the error lists the ids", () => {
  assert.deepEqual(errorsOf({ nodes: [{ id: "a" }, { id: "b" }], edges: [{ from: "a", to: "c" }] }),
    ["g.md:5 graph: /edges/0/to no node with id \"c\"; ids: a b"]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a" }], edges: [{ from: "a", to: "a", step: 0 }, { from: "a", to: "a", step: 1.5 }] }), [
    "g.md:5 graph: /edges/0/step expected a positive integer, got 0",
    "g.md:5 graph: /edges/1/step expected a positive integer, got 1.5",
  ]);
});

test("normalize fills node and edge defaults; a label defaults to the id", () => {
  const g = normalize({ nodes: [{ id: "a" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] });
  assert.equal(g.dir, "down");
  assert.equal(g.compact, false);
  assert.deepEqual(g.nodes[0], {
    id: "a", label: "a", shape: "box", tone: "", fill: "", start: false, side: "", below: "", mono: false, rank: null,
  });
  assert.equal(g.nodes[1].label, "B");
  assert.deepEqual(g.edges[0], { from: "a", to: "b", label: "", tone: "", dashed: false, step: 0, back: false });
  assert.deepEqual(normalize({ nodes: [{ id: "a" }] }).edges, []);
  assert.deepEqual(normalize({ nodes: [{ id: "a" }] }).groups, []);
});

test("normalize: body mono is every node's default, and a group gets an empty label and tone", () => {
  const g = normalize({ mono: true, nodes: [{ id: "a" }, { id: "b", mono: false }], groups: [{ nodes: ["a"] }] });
  assert.deepEqual(g.nodes.map((d) => d.mono), [true, false]);
  assert.deepEqual(g.groups, [{ label: "", tone: "", nodes: ["a"] }]);
});

test("validation: fill, below and rank name what they expected", () => {
  assert.deepEqual(errorsOf({ nodes: [{ id: "a", fill: "blue", below: 3, rank: -1 }, { id: "b", rank: 1.5 }, { id: "c", rank: 150 }] }), [
    "g.md:5 graph: /nodes/0/fill expected one of good warn bad flat span c1 c2 c3 c4 c5 c6 c7 c8, got \"blue\"",
    "g.md:5 graph: /nodes/0/below expected string, got 3",
    "g.md:5 graph: /nodes/0/rank expected an integer from 0 to 149, got -1",
    "g.md:5 graph: /nodes/1/rank expected an integer from 0 to 149, got 1.5",
    "g.md:5 graph: /nodes/2/rank expected an integer from 0 to 149, got 150",
  ]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a", shape: "dot", fill: "c1" }], mono: "yes" }), [
    "g.md:5 graph: /mono expected true or false, got \"yes\"",
    "g.md:5 graph: /nodes/0/fill a dot has no inside to fill; use \"tone\" to colour it",
  ]);
});

test("validation: groups are capped, name real nodes, and share no node", () => {
  const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(errorsOf({ nodes, groups: Array.from({ length: 17 }, () => ({ nodes: ["a"] })) }),
    ["g.md:5 graph: /groups expected at most 16 groups, got 17"]);
  assert.deepEqual(errorsOf({ nodes, groups: [{ nodes: Array.from({ length: 151 }, () => "a") }] }),
    ["g.md:5 graph: /groups/0/nodes expected at most 150 node ids, got 151"]);
  assert.deepEqual(errorsOf({ nodes, groups: { label: "x" } }), ["g.md:5 graph: /groups expected an array of groups, got an object"]);
  assert.deepEqual(errorsOf({ nodes, groups: [null, { nodes: [] }, { label: 6, nodes: ["q", "a", "a"], tone: "red", colour: 1 }, { nodes: ["a", 7] }] }), [
    "g.md:5 graph: /groups/0 expected a group { label, nodes }, got null",
    "g.md:5 graph: /groups/1/nodes expected at least one node id, got an empty array",
    "g.md:5 graph: /groups/2/label expected string, got 6",
    "g.md:5 graph: /groups/2/tone expected one of good warn bad flat span c1 c2 c3 c4 c5 c6 c7 c8, got \"red\"",
    "g.md:5 graph: /groups/2/colour unknown key \"colour\"; keys: label nodes tone",
    "g.md:5 graph: /groups/2/nodes/0 no node with id \"q\"; ids: a b c",
    "g.md:5 graph: /groups/2/nodes/2 \"a\" is listed twice in this group",
    "g.md:5 graph: /groups/3/nodes/0 \"a\" is already in group 2; a node belongs to at most one group",
    "g.md:5 graph: /groups/3/nodes/1 expected a node id, got 7",
  ]);
});

test("validation: a pin the edges cannot honour is reported at the node, not drawn", () => {
  // b feeds c, so c cannot sit on b's rank or above it.
  assert.deepEqual(errorsOf({ nodes: [{ id: "a" }, { id: "b" }, { id: "c", rank: 1 }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] }), [
    "g.md:5 graph: /nodes/2/rank \"c\" is pinned to rank 1, but the edge from \"b\" needs it at rank 2 or later; raise this rank or pin \"b\" earlier",
  ]);
  assert.deepEqual(errorsOf({ nodes: [{ id: "a", rank: 0 }, { id: "b", rank: 2 }], edges: [{ from: "a", to: "b", back: true }] }), [
    "g.md:5 graph: /edges/0/back contradicts the ranks: \"a\" is rank 0 and \"b\" rank 2, so this edge already points forward; drop \"back\"",
  ]);
  // Pins on both ends of a cycle fix both edges forward; nothing on it can turn round.
  const cyc = errorsOf({ nodes: [{ id: "a", rank: 0 }, { id: "b", rank: 1 }, { id: "c" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }] });
  assert.equal(cyc.length, 0, "c -> a is free, so the cycle breaks there");
  // Rank checks wait until everything else is valid.
  assert.deepEqual(errorsOf({ nodes: [{ id: "a" }, { id: "c", rank: 0 }], edges: [{ from: "a", to: "c" }, { from: "a", to: "zz" }] }),
    ["g.md:5 graph: /edges/1/to no node with id \"zz\"; ids: a c"]);
});

test("rank: DFS in input order marks the edge closing a cycle, and layers by longest path", () => {
  const { layer, back } = rank(["a", "b", "c", "d"], [
    { from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "a", to: "c" }, { from: "c", to: "d" },
  ]);
  assert.deepEqual(back, [false, false, true, false, false]);
  assert.deepEqual(["a", "b", "c", "d"].map((id) => layer.get(id)), [0, 1, 2, 3]);
});

test("rank: the back hint reverses an edge unless that would close a cycle", () => {
  // y -> m and m -> y: the hint picks which one points backwards.
  const hinted = rank(["m", "y"], [{ from: "m", to: "y", back: true }, { from: "y", to: "m" }]);
  assert.deepEqual(hinted.back, [true, false]);
  assert.equal(hinted.layer.get("y"), 0);
  assert.equal(hinted.layer.get("m"), 1);
  // A hint on the only path between two nodes cannot point backwards.
  const wrong = rank(["a", "b", "c"], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "c", back: true }]);
  assert.deepEqual(wrong.back, [false, false, false]);
});

test("rank: a source sits just above its nearest successor", () => {
  const { layer } = rank(["x", "m", "z", "add"], [{ from: "x", to: "m" }, { from: "m", to: "add" }, { from: "z", to: "add" }]);
  assert.equal(layer.get("z"), layer.get("add") - 1);
  assert.equal(layer.get("x"), 0);
});

test("rank: pins hold nodes on their rank; an edge within one rank is flat; empty ranks close up", () => {
  const ids = ["x1", "x2", "h1", "h2", "y1"];
  const edges = [{ from: "x1", to: "h1" }, { from: "x2", to: "h2" }, { from: "h1", to: "h2" }, { from: "h2", to: "y1" }];
  const { layer, flat, conflicts } = rank(ids, edges, new Map([["x1", 0], ["x2", 0], ["h1", 4], ["h2", 4]]));
  assert.deepEqual(flat, [false, false, true, false]);
  assert.deepEqual(ids.map((id) => layer.get(id)), [0, 0, 1, 1, 2]);
  assert.deepEqual(conflicts, []);
  // An edge from a later rank to an earlier one is a back edge.
  assert.deepEqual(rank(["a", "b"], [{ from: "b", to: "a" }], new Map([["a", 0], ["b", 1]])).back, [true]);
});

test("rank: of an a->b, b->a pair with no hint, the one listed second points back", () => {
  const { back, layer } = rank(["x", "m", "y"], [
    { from: "x", to: "m" }, { from: "m", to: "x" }, { from: "m", to: "y" }, { from: "y", to: "m" },
  ]);
  assert.deepEqual(back, [false, true, false, true]);
  assert.deepEqual(["x", "m", "y"].map((id) => layer.get(id)), [0, 1, 2]);
});

test("spread keeps the minimum gaps and otherwise stays at the wanted spots", () => {
  assert.deepEqual(spread([0, 100, 200], [10, 10]), [0, 100, 200]);
  // Three items wanting one spot spread evenly around it.
  assert.deepEqual(spread([50, 50, 50], [20, 20]), [30, 50, 70]);
  const xs = spread([5, 0, 3, 40], [12, 30, 8]);
  [12, 30, 8].forEach((m, i) => assert.ok(xs[i + 1] - xs[i] >= m - 1e-9));
});

test("place never lets two items in a layer overlap, and long edges get one dummy per skipped layer", () => {
  const ids = ["libc", "zlib", "nghttp2", "pcre2", "openssl", "libcurl", "git"];
  const forward = [
    ["libc", "zlib"], ["libc", "nghttp2"], ["libc", "pcre2"], ["libc", "openssl"], ["zlib", "openssl"],
    ["zlib", "libcurl"], ["zlib", "git"], ["openssl", "libcurl"], ["nghttp2", "libcurl"], ["libcurl", "git"], ["pcre2", "git"],
  ].map(([from, to]) => ({ from, to }));
  const { layer } = rank(ids, forward);
  const nodes = ids.map((id, i) => ({ id, lo: 20 + i * 3, hi: 30 + i * 5 }));
  const { layers, cross, chains } = place(nodes, layer, forward);
  const ext = new Map(nodes.map((d) => [d.id, d]));
  for (const keys of layers) {
    for (let i = 1; i < keys.length; i++) {
      const a = ext.get(keys[i - 1]), b = ext.get(keys[i]);
      const need = (a?.hi ?? 0) + (b?.lo ?? 0) + (a && b ? 30 : 20);
      assert.ok(cross.get(keys[i]) - cross.get(keys[i - 1]) >= need - 1e-6, `${keys[i - 1]} and ${keys[i]} overlap`);
    }
  }
  forward.forEach((e, i) => assert.equal(chains[i].length, layer.get(e.to) - layer.get(e.from) - 1));
});

test("spread: a light item gives way to a heavy one wanting the same spot", () => {
  const [node, dummy] = spread([0, 0], [50], [1, 0.001]);
  assert.ok(Math.abs(node) < 0.1);
  assert.ok(dummy - node >= 50 - 1e-9);
});

test("place: group members sit together and outsiders stay out of the outline", () => {
  // b and d are in the group; c sits between them by input order and must leave.
  const ids = ["s", "b", "c", "d", "t"];
  const forward = [["s", "b"], ["s", "c"], ["s", "d"], ["b", "t"], ["c", "t"], ["d", "t"]].map(([from, to]) => ({ from, to }));
  const { layer } = rank(ids, forward);
  const nodes = ids.map((id) => ({ id, lo: 20, hi: 20 }));
  const { layers, cross } = place(nodes, layer, forward, 30, { groups: [{ members: ["b", "d"], lo: 22, hi: 22 }] });
  const row = layers[1];
  assert.equal(Math.abs(row.indexOf("b") - row.indexOf("d")), 1);
  const lo = Math.min(cross.get("b"), cross.get("d")) - 20 - 22, hi = Math.max(cross.get("b"), cross.get("d")) + 20 + 22;
  assert.ok(cross.get("c") + 20 <= lo + 1e-6 || cross.get("c") - 20 >= hi - 1e-6, "c is outside the group");
});

test("place: a flat edge's source comes first, with room for its label between", () => {
  const { layer } = rank(["b", "a"], [{ from: "a", to: "b" }], new Map([["a", 0], ["b", 0]]));
  const { layers, cross } = place([{ id: "b", lo: 20, hi: 20 }, { id: "a", lo: 20, hi: 20 }], layer, [], 30, { flat: [{ from: "a", to: "b", gap: 60 }] });
  assert.deepEqual(layers[0], ["a", "b"]);
  assert.ok(cross.get("b") - cross.get("a") >= 100 - 1e-6);
});

test("place: a long edge with room runs straight, its dummies on the line between its ends", () => {
  const forward = [["a", "b"], ["b", "c"], ["c", "d"], ["a", "d"]].map(([from, to]) => ({ from, to }));
  const { layer } = rank(["a", "b", "c", "d"], forward);
  const { chains, cross, straight } = place(["a", "b", "c", "d"].map((id) => ({ id, lo: 20, hi: 20 })), layer, forward);
  // a -> d passes the chain's middle nodes, so its two dummies share one cross position beside them.
  assert.equal(straight[3], false);
  assert.equal(cross.get(chains[3][0]), cross.get(chains[3][1]));
  assert.ok(cross.get(chains[3][0]) - cross.get("b") >= 40 - 1e-6);
  // The chain itself stays in one column: the skip edge does not drag it sideways.
  assert.ok(Math.abs(cross.get("a") - cross.get("b")) < 0.5 && Math.abs(cross.get("b") - cross.get("d")) < 0.5);
});

test("crossings counts swapped pairs between adjacent layers", () => {
  const down = new Map([["a", ["d"]], ["b", ["c"]]]);
  assert.equal(crossings([["a", "b"], ["c", "d"]], down), 1);
  assert.equal(crossings([["a", "b"], ["d", "c"]], down), 0);
});

test("render merges parallel edges into one arrow with joined labels", () => {
  const svg = draw({
    dir: "right",
    nodes: [{ id: "q0", shape: "circle", start: true }, { id: "q1", shape: "double" }],
    edges: [{ from: "q0", to: "q1", label: "a" }, { from: "q0", to: "q1", label: "b" }, { from: "q1", to: "q1", label: "a" }],
  });
  assert.match(svg, />a, b</);
  // One merged edge, one self-loop, one start arrow.
  assert.equal(count(svg, /marker-end=/g), 3);
  // A double state is two concentric circles; q0 is one.
  assert.equal(count(svg, /<circle /g), 3);
});

test("render draws a 2-cycle as two bowed curves and a longer cycle as one dashed outer loop", () => {
  const svg = draw({
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "b", to: "c" }, { from: "c", to: "a", label: "retry" }],
  });
  // Bowed curves are single quadratics; the outer loop is a rounded polyline.
  assert.equal(count(svg, /d="M[\d.,-]+ Q[\d.,-]+ [\d.,-]+"/g), 2);
  assert.equal(count(svg, /stroke-dasharray/g), 1);
  assert.match(svg, />retry</);
});

test("render: step badges, span tone and markers per colour", () => {
  const svg = draw({
    nodes: [{ id: "a", tone: "span" }, { id: "b", tone: "span" }, { id: "c" }],
    edges: [{ from: "a", to: "b", tone: "span", step: 1 }, { from: "a", to: "c", step: 2, label: "x" }],
  });
  // Two badges: a disc plus its number each.
  assert.equal(count(svg, /r="8.5"/g), 2);
  assert.equal(count(svg, /stroke-width="2.4"/g), 3);
  // One marker for the span colour, one for the neutral arrow.
  assert.equal(count(svg, /<marker /g), 2);
  assert.match(svg, /^<figure class="fig">/);
});

test("render: a long edge between offset nodes routes through its dummy points as one smooth path", () => {
  const svg = draw({
    nodes: [{ id: "a" }, { id: "x" }, { id: "b" }, { id: "c" }, { id: "d" }],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "a", to: "d" }, { from: "x", to: "d" }],
  });
  assert.equal(count(svg, /<path d="M[^"]* C/g), 1);
  assert.equal(count(svg, /<rect /g), 5);
});

/** Numbers in a path's d attribute. */
const nums = (/** @type {string} */ d) => (d.match(/-?[\d.]+/g) ?? []).map(Number);
/** Every node rect as { x, y, w, h } keyed by its label. */
const boxes = (/** @type {string} */ svg) => {
  const out = new Map();
  const re = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="[\d.]+" fill="[^"]+" stroke="[^"]+" stroke-width="[\d.]+"\/><text [^>]*>([^<]+)</g;
  for (const m of svg.matchAll(re)) out.set(m[5], { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) });
  return out;
};

test("render: a residual skips its node round the side, leaving and entering through the nodes' sides", () => {
  const svg = draw({
    nodes: [{ id: "in" }, { id: "attention" }, { id: "add" }],
    edges: [{ from: "in", to: "attention" }, { from: "attention", to: "add" }, { from: "in", to: "add", label: "residual" }],
  });
  const b = boxes(svg);
  const [i, a, add] = ["in", "attention", "add"].map((k) => b.get(k));
  // One column.
  assert.ok(Math.abs(i.x + i.w / 2 - (a.x + a.w / 2)) < 0.5);
  assert.ok(Math.abs(a.x + a.w / 2 - (add.x + add.w / 2)) < 0.5);
  const d = /<path d="(M[^"]* L[^"]* C[^"]*)"/.exec(svg)?.[1] ?? "";
  const p = nums(d);
  // Starts on in's right side, ends on add's right side, and runs past attention's right edge in between.
  assert.ok(Math.abs(p[0] - (i.x + i.w)) < 0.5, "leaves the side");
  assert.ok(Math.abs(p[p.length - 2] - (add.x + add.w)) < 0.5, "enters the side");
  assert.ok(Math.max(...p.filter((_, k) => k % 2 === 0)) > a.x + a.w + 10, "clears the node it skips");
  assert.match(svg, />residual</);
});

test("render: fill washes a node, below captions sit under it and edges leave past them", () => {
  const svg = draw({
    nodes: [{ id: "a", fill: "c1", below: "q = 6" }, { id: "b", fill: "c1", tone: "c1" }],
    edges: [{ from: "a", to: "b" }],
  });
  assert.equal(count(svg, /fill="#121f2e"/g), 2);
  // Only b carries the tone on its outline.
  assert.equal(count(svg, /stroke="#3987e5"/g), 1);
  assert.match(svg, /font-family:var\(--mono\)">q = 6</);
  const a = boxes(svg).get("a");
  const edge = nums(/<path d="(M[^"]+)" fill="none"/.exec(svg)?.[1] ?? "");
  assert.ok(edge[1] >= a.y + a.h + 16, "the edge starts under the caption");
});

test("render: nodes pinned to one rank sit on one row, joined by straight edges", () => {
  const svg = draw({
    nodes: [{ id: "h1", rank: 0 }, { id: "h2", rank: 0 }, { id: "h3", rank: 0 }],
    edges: [{ from: "h1", to: "h2", label: "W" }, { from: "h2", to: "h3", label: "W" }],
  });
  const b = boxes(svg);
  assert.equal(new Set(["h1", "h2", "h3"].map((k) => b.get(k).y)).size, 1);
  assert.ok(b.get("h1").x < b.get("h2").x && b.get("h2").x < b.get("h3").x);
  for (const m of svg.matchAll(/<path d="M([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+)"/g)) assert.equal(m[2], m[4]);
  assert.equal(count(svg, />W</g), 2);
});

test("render: a group is one dashed outline round its members with its label at the top left", () => {
  const svg = draw({
    nodes: [{ id: "in" }, { id: "a" }, { id: "b" }, { id: "out" }],
    edges: [{ from: "in", to: "a" }, { from: "a", to: "b" }, { from: "b", to: "out" }],
    groups: [{ label: "x 6", nodes: ["a", "b"], tone: "c2" }],
  });
  const m = /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="8" fill="none" stroke="#d95926" stroke-width="1" stroke-dasharray="4 3"\/>/.exec(svg);
  assert.ok(m);
  const [x, y, w, h] = m.slice(1).map(Number);
  const b = boxes(svg);
  for (const k of ["a", "b"]) {
    const r = b.get(k);
    assert.ok(r.x > x && r.y > y && r.x + r.w < x + w && r.y + r.h < y + h, `${k} inside`);
  }
  for (const k of ["in", "out"]) {
    const r = b.get(k);
    assert.ok(r.y + r.h < y || r.y > y + h, `${k} outside`);
  }
  const label = /<text x="([\d.-]+)" y="([\d.-]+)" class="edge-label" style="text-anchor:start">x 6</.exec(svg);
  assert.ok(label && Math.abs(Number(label[1]) - x - 2) < 0.5 && Number(label[2]) < y);
});

test("render: going right, a self-loop on the lowest node of a column hangs underneath", () => {
  const svg = draw({
    dir: "right",
    nodes: [{ id: "a", shape: "circle" }, { id: "b", shape: "circle" }, { id: "c", shape: "circle" }],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "c", to: "c", label: "x" }],
  });
  const c = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)"/g)].map((m) => Number(m[2]));
  const loop = /<path d="M[\d.-]+,([\d.-]+) C[\d.-]+,([\d.-]+)/.exec(svg.slice(svg.lastIndexOf("<path d=\"M")));
  assert.ok(loop && Number(loop[2]) > Number(loop[1]), "the loop's control point is below its start");
  assert.ok(Math.max(...c) > Math.min(...c));
});

test("examples/diagrams/ml-graphs.md validates with zero errors", () => {
  const path = fileURLToPath(new URL("../examples/diagrams/ml-graphs.md", import.meta.url));
  const r = parseMarkdown(readFileSync(path, "utf8"), { file: "ml-graphs.md" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(validateDoc(r.doc, { file: "ml-graphs.md" }).map(formatError), []);
});

test("a long node label wraps onto lines and the node grows to hold the widest one", () => {
  const label = "Hold the splash, download with no time limit";
  const svg = draw({ nodes: [{ id: "a", label }, { id: "b", label: "is an update available?", shape: "diamond" }] });
  const lines = [...svg.matchAll(/class="node-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(lines.slice(0, 2), ["Hold the splash, download", "with no time limit"]);
  const rect = svg.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="([^"]+)"/);
  assert.ok(Number(rect[1]) >= textW("Hold the splash, download"), "box is at least as wide as its widest line");
  assert.ok(Number(rect[2]) > 32, "box is taller than a one-line box");
});

test("flow draws through graph: columns stay in order and back or same-column edges still render", () => {
  const md = "---\ntitle: T\n---\n\n```flow\n" + JSON.stringify({
    cols: [[{ id: "a", label: "Start", shape: "round" }], [{ id: "b", label: "Check", shape: "diamond" }],
      [{ id: "c", label: "Store", shape: "store" }, { id: "d", label: "Retry" }]],
    edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "ok" }, { from: "b", to: "d", label: "no" },
      { from: "d", to: "b" }, { from: "c", to: "d" }],
  }) + "\n```\n";
  const r = renderDoc(md);
  assert.deepEqual(r.errors, []);
  const xOf = (label) => Number(r.html.match(new RegExp(`<text x="([^"]+)"[^>]*class="node-label"[^>]*>${label}<`))[1]);
  assert.ok(xOf("Start") < xOf("Check") && xOf("Check") < xOf("Store"));
  assert.match(r.html, / a[\d.]+,6 0 0 1 /, "store draws as a cylinder");
});
