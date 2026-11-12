/**
 * `graph` fence: layered directed graphs. DAGs, work and span, dependency
 * graphs, state machines, automata and computation graphs all share it.
 *
 * Authors give nodes and edges only. `graph-layout.js` finds back edges and
 * layers, orders and spaces the nodes; this module sizes nodes, routes every
 * edge, and places labels where they cover no node, label or other edge.
 *
 * Edge kinds, by how they are drawn:
 *   forward   straight, or a smooth curve through dummy points when it skips layers
 *   detour    a skip edge that would cross nodes: out of the side, round them, back in
 *   bowed     a->b and b->a together: two curves bowed apart
 *   flat      between two nodes pinned to one rank: straight across, or arced over the nodes between
 *   back      a dashed loop round the outer side of the drawing
 *   self      a small loop beside the node (right of it going down, above it going right)
 *
 * Groups draw a dashed outline round their members (and the skip edges that
 * pass them) with the label at its top-left corner.
 *
 * @module render/diagrams/graph
 */

import {
  Ctx, ptr, show, wantObject, wantArray, wantNonEmptyArray, wantText,
  optionalString, optionalBoolean, optionalEnum, unknownKeys, tooMany,
} from "../schema/common.js";
import { mix } from "../charts.js";
import { DIAGRAM_TONES, INK, inkOf, markers, text, badge, clip, svgOpen, figure, bounds, textW, n } from "./svg.js";
import { rank, place } from "./graph-layout.js";

export const SHAPES = /** @type {const} */ (["box", "round", "circle", "double", "dot", "diamond", "store"]);
const DIRS = /** @type {const} */ (["down", "right"]);

/**
 * @typedef {{ id: string, label: string, shape: typeof SHAPES[number], tone: string, fill: string,
 *   start: boolean, side: string, below: string, mono: boolean, rank: number | null }} GraphNode
 * @typedef {{ from: string, to: string, label: string, tone: string, dashed: boolean,
 *   step: number, back: boolean }} GraphEdge
 * @typedef {{ label: string, nodes: string[], tone: string }} GraphGroup
 * @typedef {{ title: string, note: string, compact: boolean, dir: typeof DIRS[number], mono: boolean,
 *   nodes: GraphNode[], edges: GraphEdge[], groups: GraphGroup[] }} GraphBody
 */

/* ------------------------------------------------------------------ schema */

/** Layout cost grows with crossings between layers; past these a graph is unreadable anyway. */
export const MAX_NODES = 150, MAX_EDGES = 300, MAX_GROUPS = 16;
/** A rank pins a node to a layer; there are never more layers than nodes. */
export const MAX_RANK = MAX_NODES - 1;

const NODE_KEYS = ["id", "label", "shape", "tone", "fill", "start", "side", "below", "mono", "rank"];

/**
 * `{ nodes: [{ id, label?, shape?, tone?, fill?, start?, side?, below?, mono?, rank? }],
 *    edges?: [{ from, to, ... }], groups?: [{ label?, nodes, tone? }] }`.
 * Node ids are unique and every edge end and group member must name one. Once
 * everything else is valid, ranks are checked against the edges: a pin the
 * layering cannot honour is reported at the node.
 */
export function validate(errors, block, file) {
  const ctx = new Ctx(errors, file, block.line, "graph");
  if (!wantObject(ctx, block.data, "", "an object { nodes, edges }")) return;
  const body = /** @type {Record<string, unknown>} */ (block.data);
  const before = errors.length;

  optionalString(ctx, body.title, "/title");
  optionalString(ctx, body.note, "/note");
  optionalBoolean(ctx, body.compact, "/compact");
  optionalBoolean(ctx, body.mono, "/mono");
  optionalEnum(ctx, body.dir, "/dir", DIRS);
  unknownKeys(ctx, body, "", ["title", "note", "compact", "dir", "mono", "nodes", "edges", "groups"]);

  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Map<string, number>} */
  const pins = new Map();
  if (Array.isArray(body.nodes) && body.nodes.length > MAX_NODES) {
    ctx.at("/nodes", `expected at most ${MAX_NODES} nodes, got ${body.nodes.length}; split the graph`);
    return; // checking edges against ids that were never collected would only add noise
  } else if (wantNonEmptyArray(ctx, body.nodes, "/nodes", "at least one node")) {
    /** @type {unknown[]} */ (body.nodes).forEach((node, i) => {
      const np = ptr("", "nodes", i);
      if (!wantObject(ctx, node, np, "a node { id }")) return;
      if (wantText(ctx, node.id, ptr(np, "id"), "a node id")) {
        const id = /** @type {string} */ (node.id);
        // Control characters are reserved: the layout keys its own dummy points and edge pairs with them.
        if (/[\u0000-\u001f]/.test(id)) ctx.at(ptr(np, "id"), `expected an id without control characters, got ${show(id)}`);
        if (ids.has(id)) ctx.at(ptr(np, "id"), `duplicate node id ${JSON.stringify(id)}; ids must be unique`);
        ids.add(id);
        if (Number.isInteger(node.rank) && /** @type {number} */ (node.rank) >= 0 && /** @type {number} */ (node.rank) <= MAX_RANK) {
          pins.set(id, /** @type {number} */ (node.rank));
        }
      }
      optionalString(ctx, node.label, ptr(np, "label"));
      optionalEnum(ctx, node.shape, ptr(np, "shape"), SHAPES);
      optionalEnum(ctx, node.tone, ptr(np, "tone"), DIAGRAM_TONES);
      optionalEnum(ctx, node.fill, ptr(np, "fill"), DIAGRAM_TONES);
      if (node.fill !== undefined && node.shape === "dot") ctx.at(ptr(np, "fill"), `a dot has no inside to fill; use "tone" to colour it`);
      optionalBoolean(ctx, node.start, ptr(np, "start"));
      optionalString(ctx, node.side, ptr(np, "side"));
      optionalString(ctx, node.below, ptr(np, "below"));
      optionalBoolean(ctx, node.mono, ptr(np, "mono"));
      if (node.rank !== undefined && !(Number.isInteger(node.rank) && /** @type {number} */ (node.rank) >= 0 && /** @type {number} */ (node.rank) <= MAX_RANK)) {
        ctx.at(ptr(np, "rank"), `expected an integer from 0 to ${MAX_RANK}, got ${show(node.rank)}`);
      }
      unknownKeys(ctx, node, np, NODE_KEYS);
    });
  }

  /** @type {{ from: string, to: string, back: boolean, i: number }[]} */
  const links = [];
  if (Array.isArray(body.edges) && body.edges.length > MAX_EDGES) {
    ctx.at("/edges", `expected at most ${MAX_EDGES} edges, got ${body.edges.length}; split the graph`);
  } else if (body.edges !== undefined && wantArray(ctx, body.edges, "/edges", "an array of edges")) {
    /** @type {unknown[]} */ (body.edges).forEach((edge, i) => {
      const ep = ptr("", "edges", i);
      if (!wantObject(ctx, edge, ep, "an edge { from, to }")) return;
      for (const end of /** @type {const} */ (["from", "to"])) {
        if (!wantText(ctx, edge[end], ptr(ep, end), "a node id")) continue;
        if (!ids.has(/** @type {string} */ (edge[end]))) {
          ctx.at(ptr(ep, end), `no node with id ${show(edge[end])}; ids: ${[...ids].join(" ")}`);
        }
      }
      optionalString(ctx, edge.label, ptr(ep, "label"));
      optionalEnum(ctx, edge.tone, ptr(ep, "tone"), DIAGRAM_TONES);
      optionalBoolean(ctx, edge.dashed, ptr(ep, "dashed"));
      optionalBoolean(ctx, edge.back, ptr(ep, "back"));
      if (edge.step !== undefined && !(Number.isInteger(edge.step) && /** @type {number} */ (edge.step) > 0)) {
        ctx.at(ptr(ep, "step"), `expected a positive integer, got ${show(edge.step)}`);
      }
      unknownKeys(ctx, edge, ep, ["from", "to", "label", "tone", "dashed", "step", "back"]);
      if (typeof edge.from === "string" && typeof edge.to === "string" && edge.from !== edge.to) {
        links.push({ from: edge.from, to: edge.to, back: edge.back === true, i });
      }
    });
  }

  checkGroups(ctx, body.groups, ids);
  if (errors.length === before) checkRanks(ctx, ids, pins, links);
}

/** `groups`: each `{ label?, nodes, tone? }`; a node belongs to at most one group. */
function checkGroups(ctx, groups, /** @type {Set<string>} */ ids) {
  if (groups === undefined) return;
  if (tooMany(ctx, groups, "/groups", MAX_GROUPS, "groups") || !wantArray(ctx, groups, "/groups", "an array of groups")) return;
  /** @type {Map<string, number>} */
  const owner = new Map();
  /** @type {unknown[]} */ (groups).forEach((g, gi) => {
    const gp = ptr("", "groups", gi);
    if (!wantObject(ctx, g, gp, "a group { label, nodes }")) return;
    optionalString(ctx, g.label, ptr(gp, "label"));
    optionalEnum(ctx, g.tone, ptr(gp, "tone"), DIAGRAM_TONES);
    unknownKeys(ctx, g, gp, ["label", "nodes", "tone"]);
    const mp = ptr(gp, "nodes");
    if (tooMany(ctx, g.nodes, mp, MAX_NODES, "node ids") || !wantNonEmptyArray(ctx, g.nodes, mp, "at least one node id")) return;
    /** @type {unknown[]} */ (g.nodes).forEach((id, k) => {
      const ip = ptr(mp, k);
      if (!wantText(ctx, id, ip, "a node id")) return;
      const s = /** @type {string} */ (id);
      if (!ids.has(s)) { ctx.at(ip, `no node with id ${show(s)}; ids: ${[...ids].join(" ")}`); return; }
      const was = owner.get(s);
      if (was === gi) ctx.at(ip, `${JSON.stringify(s)} is listed twice in this group`);
      else if (was !== undefined) ctx.at(ip, `${JSON.stringify(s)} is already in group ${was}; a node belongs to at most one group`);
      else owner.set(s, gi);
    });
  });
}

/**
 * Report pins the layering cannot honour: a node pinned earlier than an edge
 * into it allows, a `back` hint that disagrees with both ends' ranks, or a
 * cycle the pins forbid breaking.
 * @param {Ctx} ctx @param {Set<string>} ids @param {Map<string, number>} pins
 * @param {{ from: string, to: string, back: boolean, i: number }[]} links
 */
function checkRanks(ctx, ids, pins, links) {
  if (!pins.size) return;
  const order = [...ids];
  for (const e of links) {
    const a = pins.get(e.from), b = pins.get(e.to);
    if (e.back && a !== undefined && b !== undefined && a <= b) {
      ctx.at(ptr("", "edges", e.i, "back"), `contradicts the ranks: ${JSON.stringify(e.from)} is rank ${a} and ${JSON.stringify(e.to)} rank ${b}, so this edge already ${a === b ? "runs across one layer" : "points forward"}; drop "back"`);
    }
  }
  const { conflicts, cyclic } = rank(order, links, pins);
  for (const c of conflicts) {
    ctx.at(ptr("", "nodes", order.indexOf(c.id), "rank"),
      `${JSON.stringify(c.id)} is pinned to rank ${c.rank}, but the edge from ${JSON.stringify(c.via)} needs it at rank ${c.need} or later; raise this rank` +
      // Nothing can be pinned before rank 0, so only suggest moving the source when there is room.
      (c.need - 1 > 0 ? ` or pin ${JSON.stringify(c.via)} earlier` : ""));
  }
  if (cyclic && !conflicts.length) ctx.at("/nodes", "the pinned ranks force a cycle of edges to run forward; unpin a node on the cycle");
}

/**
 * Fill defaults on a validated body. A node's label defaults to its id and its
 * `mono` to the body's; `step: 0` means no badge and `rank: null` no pin.
 * @returns {GraphBody}
 */
export function normalize(data) {
  const mono = data.mono ?? false;
  return {
    title: "", note: "", compact: false, dir: "down", ...data, mono,
    nodes: data.nodes.map((d) => ({
      label: d.id, shape: "box", tone: "", fill: "", start: false, side: "", below: "", rank: null, ...d, mono: d.mono ?? mono,
    })),
    edges: (data.edges ?? []).map((e) => ({ label: "", tone: "", dashed: false, step: 0, back: false, ...e })),
    groups: (data.groups ?? []).map((g) => ({ label: "", tone: "", ...g })),
  };
}

/* ------------------------------------------------------------------ geometry */

/** @typedef {[number, number]} Pt */
/** @typedef {{ x0: number, y0: number, x1: number, y1: number }} Box */
/**
 * A node once placed. `ext` is how far it and its decorations (start arrow,
 * self-loop, side note, caption) reach from its centre on each side;
 * `sideAt` is where its side note starts, as an offset from the centre.
 * @typedef {{ d: GraphNode, w: number, h: number, kind: "rect" | "ellipse" | "diamond",
 *   x: number, y: number, layer: number, loop: GraphEdge | undefined, sideAt: number,
 *   ext: { l: number, r: number, t: number, b: number } }} Placed
 */
/**
 * A routed edge: a sampled polyline for placement and hit tests, which side of
 * travel its label may sit on (1 left, 0 either), and whether its label was
 * already put at a fixed spot (loops and detours).
 * @typedef {{ e: GraphEdge, pts: Pt[], side: 0 | 1, fixed: boolean }} Route
 */

const START = 30;      // length of the entry arrow on a start state
const LOOP = 22;       // how far a self-loop reaches past the node
const LABEL_H = 14;    // edge-label box height
const BOW = 13;        // how far each curve of an a<->b pair bows out
const BELOW = 18;      // room under a node for its caption
const GROUP_PAD = 12;  // group outline to its members
const ARC = 22;        // how far an arc between two nodes of one layer clears the nodes between them

const labelW = (/** @type {string} */ t) => textW(t, 11.5) + 4;
const font = (/** @type {GraphNode} */ d) => (d.mono ? 12 : 13);
const captionW = (/** @type {GraphNode} */ d) => (d.below ? textW(d.below, 11.5, true) + 6 : 0);

const WRAP = 28;       // a node label longer than this wraps onto more lines
const LINE = 16;       // node-label line height

/**
 * A node label split into lines of roughly equal length, so a long label grows
 * the node taller rather than stretching the whole diagram wide. Circles and
 * dots keep one line: they size from their label in both directions.
 */
function linesOf(/** @type {GraphNode} */ d) {
  const label = String(d.label);
  if (label.length <= WRAP || ["circle", "double", "dot"].includes(d.shape)) return [label];
  const target = label.length / Math.ceil(label.length / WRAP);
  /** @type {string[]} */
  const lines = [];
  let line = "";
  for (const word of label.split(/\s+/)) {
    line = line ? `${line} ${word}` : word;
    if (line.length >= target) {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Node size from its label and shape. Circles grow to fit their label. */
function sizeOf(/** @type {GraphNode} */ d) {
  const lines = linesOf(d);
  const tw = Math.max(...lines.map((l) => textW(l, font(d), d.mono)));
  const extra = (lines.length - 1) * LINE;
  switch (d.shape) {
    case "dot": return { w: 9, h: 9, kind: /** @type {const} */ ("ellipse") };
    case "circle": case "double": {
      const r = Math.max(40, tw + (d.shape === "double" ? 26 : 18));
      return { w: r, h: r, kind: /** @type {const} */ ("ellipse") };
    }
    // The text block's corners must stay inside the diamond: at 1.5x the text
    // width, the height needs about 2.6x the text block's.
    case "diamond": return { w: Math.max(64, tw * 1.5 + 22), h: Math.max(46, lines.length * LINE * 2.6), kind: /** @type {const} */ ("diamond") };
    case "store": return { w: Math.max(44, tw + 26), h: 40 + extra, kind: /** @type {const} */ ("rect") };
    default: return { w: Math.max(44, tw + 26), h: 32 + extra, kind: /** @type {const} */ ("rect") };
  }
}

/**
 * Where a ray from the node's centre toward (ux, uy) leaves it. A ray that
 * would run through the caption under the node leaves past the caption, so
 * edges never cross that text.
 * @returns {Pt}
 */
function edgeOf(/** @type {Placed} */ p, /** @type {number} */ ux, /** @type {number} */ uy) {
  const len = Math.hypot(ux, uy) || 1;
  const vx = ux / len, vy = uy / len;
  if (p.d.below && vy > 1e-9) {
    const half = Math.max(p.w, captionW(p.d)) / 2, top = p.h / 2;
    if (Math.abs((vx * top) / vy) <= half) {
      const t = Math.min((top + BELOW) / vy, Math.abs(vx) > 1e-9 ? half / Math.abs(vx) : Infinity);
      return [p.x + vx * t, p.y + vy * t];
    }
  }
  if (p.kind !== "diamond") return clip(p, vx, vy, p.kind);
  const t = 1 / (Math.abs(vx) / (p.w / 2) + Math.abs(vy) / (p.h / 2));
  return [p.x + vx * t, p.y + vy * t];
}

/** Smooth path through points (Catmull-Rom as cubic Beziers), plus a sampled polyline. */
function spline(/** @type {Pt[]} */ ps) {
  if (ps.length === 2) return { path: `M${n(ps[0][0])},${n(ps[0][1])} L${n(ps[1][0])},${n(ps[1][1])}`, pts: ps };
  let path = `M${n(ps[0][0])},${n(ps[0][1])}`;
  /** @type {Pt[]} */
  const pts = [ps[0]];
  for (let i = 0; i + 1 < ps.length; i++) {
    const p0 = ps[Math.max(0, i - 1)], p1 = ps[i], p2 = ps[i + 1], p3 = ps[Math.min(ps.length - 1, i + 2)];
    /** @type {Pt} */ const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    /** @type {Pt} */ const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    path += ` C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(p2[0])},${n(p2[1])}`;
    pts.push(...cubic(p1, c1, c2, p2));
  }
  return { path, pts };
}

/** Eight samples along a cubic Bezier, excluding its start. */
function cubic(/** @type {Pt} */ a, /** @type {Pt} */ b, /** @type {Pt} */ c, /** @type {Pt} */ d) {
  /** @type {Pt[]} */
  const out = [];
  for (let k = 1; k <= 8; k++) {
    const t = k / 8, u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
    ]);
  }
  return out;
}

/** A quadratic Bezier from `s` through control `c` to `t`, plus a sampled polyline. */
function quad(/** @type {Pt} */ s, /** @type {Pt} */ c, /** @type {Pt} */ t) {
  const path = `M${n(s[0])},${n(s[1])} Q${n(c[0])},${n(c[1])} ${n(t[0])},${n(t[1])}`;
  /** @type {Pt[]} */
  const pts = [s];
  for (let k = 1; k <= 8; k++) {
    const u = k / 8, v = 1 - u;
    pts.push([v * v * s[0] + 2 * v * u * c[0] + u * u * t[0], v * v * s[1] + 2 * v * u * c[1] + u * u * t[1]]);
  }
  return { path, pts };
}

/** An orthogonal polyline with rounded corners. */
function rounded(/** @type {Pt[]} */ ps, r = 10) {
  let path = `M${n(ps[0][0])},${n(ps[0][1])}`;
  for (let i = 1; i + 1 < ps.length; i++) {
    const [px, py] = ps[i - 1], [x, y] = ps[i], [nx, ny] = ps[i + 1];
    const a = Math.min(r, Math.hypot(x - px, y - py) / 2), b = Math.min(r, Math.hypot(nx - x, ny - y) / 2);
    const ux = Math.sign(x - px), uy = Math.sign(y - py), vx = Math.sign(nx - x), vy = Math.sign(ny - y);
    path += ` L${n(x - ux * a)},${n(y - uy * a)} Q${n(x)},${n(y)} ${n(x + vx * b)},${n(y + vy * b)}`;
  }
  const last = ps[ps.length - 1];
  return path + ` L${n(last[0])},${n(last[1])}`;
}

/** Point and unit tangent at fraction `t` of a polyline's length. */
function along(/** @type {Pt[]} */ pts, /** @type {number} */ t) {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let left = seg.reduce((a, b) => a + b, 0) * t;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const f = seg[i] ? Math.min(1, left / seg[i]) : 0, len = seg[i] || 1;
      return { x: ax + (bx - ax) * f, y: ay + (by - ay) * f, tx: (bx - ax) / len, ty: (by - ay) / len };
    }
    left -= seg[i];
  }
  return { x: pts[0][0], y: pts[0][1], tx: 1, ty: 0 };
}

const overlaps = (/** @type {Box} */ a, /** @type {Box} */ b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const boxAt = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ w, /** @type {number} */ h) =>
  ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });

/** Does segment p-q pass through box b? (Liang-Barsky.) */
function crossesBox(/** @type {Box} */ b, /** @type {Pt} */ p, /** @type {Pt} */ q) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pk, qk] of [[-dx, p[0] - b.x0], [dx, b.x1 - p[0]], [-dy, p[1] - b.y0], [dy, b.y1 - p[1]]]) {
    if (pk === 0) { if (qk < 0) return false; continue; }
    const r = qk / pk;
    if (pk < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}
const lineHits = (/** @type {Box} */ b, /** @type {Pt[]} */ pts) => pts.some((p, i) => i > 0 && crossesBox(b, pts[i - 1], p));

/** Bounding box of some points, grown by `pad`. */
function hullOf(/** @type {Pt[]} */ pts, pad = 1) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/* ------------------------------------------------------------------ render */

/** Render a validated, normalized `graph` block. */
export function render(block) {
  const g = /** @type {GraphBody} */ (block.data);
  return figure(draw(g), g.title, g.note);
}

/**
 * Merge parallel edges (same from and to) into one whose label lists them all,
 * the way an automaton writes `a, b` on a single arrow. Style comes from the first.
 * @param {GraphEdge[]} edges
 */
function merge(edges) {
  /** @type {Map<string, GraphEdge>} */
  const out = new Map();
  for (const e of edges) {
    const key = `${e.from}\u0000${e.to}`;
    const seen = out.get(key);
    if (!seen) out.set(key, { ...e });
    else if (e.label) seen.label = seen.label ? `${seen.label}, ${e.label}` : e.label;
  }
  return [...out.values()];
}

/** Lay out and draw the whole graph as an SVG string. */
function draw(/** @type {GraphBody} */ g) {
  const down = g.dir !== "right";
  const edges = merge(g.edges);
  const loopOf = new Map(edges.filter((e) => e.from === e.to).map((e) => [e.from, e]));
  const links = edges.filter((e) => e.from !== e.to);

  // A box that many edges meet gets wide enough to give each its own port.
  /** @type {Map<string, number>} */
  const degree = new Map();
  for (const e of links) for (const k of [`${e.from}>`, `${e.to}<`]) degree.set(k, (degree.get(k) ?? 0) + 1);
  /** @type {Map<string, Placed>} */
  const nodes = new Map(g.nodes.map((d) => {
    const s = sizeOf(d);
    const most = Math.max(degree.get(`${d.id}>`) ?? 0, degree.get(`${d.id}<`) ?? 0);
    if (down && s.kind === "rect") s.w = Math.max(s.w, 14 * (most - 1) + 28);
    const ext = { l: s.w / 2, r: s.w / 2, t: s.h / 2, b: s.h / 2 };
    if (d.start) ext.l += START;
    const loop = loopOf.get(d.id);
    if (loop && down) ext.r += LOOP + (loop.label ? 6 + labelW(loop.label) : 4);
    if (loop && !down) {
      ext.t += LOOP + (loop.label ? 6 + LABEL_H : 4);
      ext.l = Math.max(ext.l, labelW(loop.label) / 2);
      ext.r = Math.max(ext.r, labelW(loop.label) / 2);
    }
    if (d.below) ext.b += BELOW;
    let sideAt = 0;
    if (d.side && down) { sideAt = ext.r + 8; ext.r = sideAt + labelW(d.side); }
    if (d.side && !down) {
      ext.b += 6 + LABEL_H;
      ext.l = Math.max(ext.l, labelW(d.side) / 2);
      ext.r = Math.max(ext.r, labelW(d.side) / 2);
    }
    if (d.below) {
      ext.l = Math.max(ext.l, captionW(d) / 2);
      ext.r = Math.max(ext.r, captionW(d) / 2);
    }
    return [d.id, { d, ...s, x: 0, y: 0, layer: 0, loop, sideAt, ext }];
  }));
  const at = (/** @type {string} */ id) => /** @type {Placed} */ (nodes.get(id));
  // Cross axis runs along a layer, main axis from layer to layer.
  const crossLo = (/** @type {Placed} */ p) => (down ? p.ext.l : p.ext.t);
  const crossHi = (/** @type {Placed} */ p) => (down ? p.ext.r : p.ext.b);
  const mainLo = (/** @type {Placed} */ p) => (down ? p.ext.t : p.ext.l);
  const mainHi = (/** @type {Placed} */ p) => (down ? p.ext.b : p.ext.r);
  /** Half the outline (not decorations) across and along. */
  const halfCross = (/** @type {Placed} */ p) => (down ? p.w : p.h) / 2;
  const halfMain = (/** @type {Placed} */ p) => (down ? p.h : p.w) / 2;
  /** How far an edge leaving toward the next layer starts from the centre: past the caption going down. */
  const exitMain = (/** @type {Placed} */ p) => halfMain(p) + (down && p.d.below ? BELOW : 0);

  const pins = new Map(g.nodes.filter((d) => d.rank !== null).map((d) => [d.id, /** @type {number} */ (d.rank)]));
  const { layer, back, flat } = rank(g.nodes.map((d) => d.id), links, pins);
  for (const p of nodes.values()) p.layer = /** @type {number} */ (layer.get(p.d.id));
  const forward = links.filter((_, i) => !back[i] && !flat[i]);
  const backs = links.filter((_, i) => back[i]);
  const flats = links.filter((_, i) => flat[i]);
  // A back edge whose reverse is a forward edge is drawn as a bowed pair along the forward route.
  const fwdIndex = new Map(forward.map((e, i) => [`${e.from}\u0000${e.to}`, i]));
  /** @type {Map<number, GraphEdge>} */
  const partner = new Map();
  const loops = backs.filter((e) => {
    const i = fwdIndex.get(`${e.to}\u0000${e.from}`);
    if (i === undefined) return true;
    partner.set(i, e);
    return false;
  });
  const flatKeys = new Set(flats.map((e) => `${e.from}\u0000${e.to}`));
  const paired = (/** @type {GraphEdge} */ e) => flatKeys.has(`${e.to}\u0000${e.from}`);
  /** Cross-axis room an edge within one layer needs between its ends. */
  const flatGap = (/** @type {GraphEdge} */ e) => (down
    ? Math.max(40, (e.label ? labelW(e.label) + 20 : 0) + (e.step ? 24 : 0))
    : 40 + (e.label && paired(e) ? LABEL_H : 0));

  // Going right, labels and badges stack above and below edges, so neighbours need more room.
  const worded = !down && links.some((e) => e.label || e.step);
  const pairs = [...partner.values()].some((e) => e.label || e.step);
  const groupPad = { lo: GROUP_PAD + 10 + (down ? 0 : LABEL_H + 4), hi: GROUP_PAD + 10 };
  const arrange = () => place(
    g.nodes.map((d) => ({ id: d.id, lo: crossLo(at(d.id)), hi: crossHi(at(d.id)) })), layer, forward, worded ? (pairs ? 96 : 64) : 30,
    {
      flat: flats.map((e) => ({ from: e.from, to: e.to, gap: flatGap(e) })),
      groups: g.groups.map((gr) => ({ members: gr.nodes, ...groupPad })),
      room: forward.map((e) => (e.label ? (down ? labelW(e.label) : LABEL_H) + 8 : 0)),
    },
  );
  let { layers, cross, chains, straight } = arrange();
  // Going right, a self-loop on the lowest node of a column hangs underneath, clear of the edges above it.
  // Order does not depend on sizes, so moving the loop's room and placing again keeps every node's slot.
  /** @type {Set<Placed>} */
  const under = new Set();
  if (!down) {
    for (const keys of layers) {
      const row = keys.filter((k) => nodes.has(k));
      const p = at(row[row.length - 1]);
      if (row.length > 1 && p.loop && !p.d.below && !p.d.side) under.add(p);
    }
    for (const p of under) {
      const reach = p.ext.t - p.h / 2;
      p.ext.t = p.h / 2;
      p.ext.b += reach;
    }
    if (under.size) ({ layers, cross, chains, straight } = arrange());
  }

  // Main-axis gaps: room for labels between layers.
  const depth = layers.length;
  const gaps = Array.from({ length: Math.max(0, depth - 1) }, () => (down ? 40 : 52));
  forward.forEach((e, i) => {
    const a = at(e.from).layer, b = at(e.to).layer;
    const mid = a + Math.floor((b - a - 1) / 2);
    const words = [e, partner.get(i)].filter((x) => x && (x.label || x.step));
    for (const x of /** @type {GraphEdge[]} */ (words)) {
      // A bowed pair carries two labels and two badges along one gap, so it gets more of it.
      const pair = partner.has(i) && (x.step || x.label) ? 1 : 0;
      const room = down ? 52 + pair * 28 : labelW(x.label) + 30 + (x.step && mid === a ? 24 : 0) + pair * 64;
      gaps[mid] = Math.max(gaps[mid], room);
    }
  });
  /** Is there a real node strictly between `a` and `b` in their shared layer? */
  const between = (/** @type {GraphEdge} */ e) => {
    const row = layers[at(e.from).layer].filter((k) => nodes.has(k));
    const i = row.indexOf(e.from), j = row.indexOf(e.to);
    return Math.abs(i - j) > 1;
  };
  const arced = new Set(flats.filter(between));
  for (const e of arced) {
    const l = at(e.from).layer;
    if (l > 0) gaps[l - 1] += ARC + (e.label ? LABEL_H : 0);
  }
  /** Each group's first and last layer. */
  const spans = g.groups.map((gr) => {
    let l0 = Infinity, l1 = -Infinity;
    for (const id of gr.nodes) { l0 = Math.min(l0, at(id).layer); l1 = Math.max(l1, at(id).layer); }
    return { l0, l1 };
  });
  spans.forEach(({ l0, l1 }, gi) => {
    if (l0 > 0) gaps[l0 - 1] += GROUP_PAD + (down && g.groups[gi].label ? LABEL_H + 4 : 0);
    if (l1 < depth - 1) gaps[l1] += GROUP_PAD;
  });
  const reach = layers.map((keys) => {
    let lo = 0, hi = 0;
    for (const k of keys) {
      const p = nodes.get(k);
      if (p) { lo = Math.max(lo, mainLo(p)); hi = Math.max(hi, mainHi(p)); }
    }
    return { lo, hi };
  });
  /** @type {number[]} */
  const mainAt = [];
  reach.forEach((r, l) => mainAt.push(l === 0 ? 0 : mainAt[l - 1] + reach[l - 1].hi + gaps[l - 1] + r.lo));

  const crossOf = (/** @type {Placed} */ p) => (down ? p.x : p.y);
  const mainOf = (/** @type {Placed} */ p) => (down ? p.y : p.x);
  /** Abstract (cross, main) to screen [x, y], and back. */
  const xy = (/** @type {number} */ c, /** @type {number} */ m) => /** @type {Pt} */ (down ? [c, m] : [m, c]);
  const cm = (/** @type {Pt} */ pt) => /** @type {Pt} */ (down ? pt : [pt[1], pt[0]]);
  /** @type {Map<string, Pt>} */
  const dummy = new Map();
  /** Where a long edge enters and leaves each layer it passes, so it bends only in the gaps. @type {Map<string, Pt[]>} */
  const band = new Map();
  layers.forEach((keys, l) => keys.forEach((k) => {
    const c = /** @type {number} */ (cross.get(k));
    const p = nodes.get(k);
    if (p) [p.x, p.y] = xy(c, mainAt[l]);
    else {
      dummy.set(k, xy(c, mainAt[l]));
      band.set(k, reach[l].lo + reach[l].hi < 1 ? [xy(c, mainAt[l])] : [xy(c, mainAt[l] - reach[l].lo), xy(c, mainAt[l] + reach[l].hi)]);
    }
  }));

  const mk = markers();
  /** Stroke colour, arrow colour and width for an edge. */
  const inkFor = (/** @type {GraphEdge} */ e) => ({
    stroke: inkOf(e.tone, INK.line), arrow: inkOf(e.tone, INK.arrow), width: e.tone === "span" ? 2.4 : 1.5,
  });
  const stroke = (/** @type {GraphEdge} */ e, /** @type {string} */ d, dashed = e.dashed) => {
    const k = inkFor(e);
    return `<path d="${d}" fill="none" stroke="${k.stroke}" stroke-width="${k.width}"` +
      (dashed ? ` stroke-dasharray="5 3"` : "") + ` marker-end="url(#${mk.id(k.arrow)})"/>`;
  };

  /** @type {Route[]} */
  const routes = [];
  /** Labels that sit at fixed spots (loops, side notes, captions, detours): obstacles for the placer. @type {Box[]} */
  const fixed = [];
  let lines = "", words = "";

  /** Where the nearest item past `key` on side `s` of its layer begins, or infinitely far when there is none. */
  const nextOut = (/** @type {string} */ key, /** @type {number} */ l, /** @type {number} */ s) => {
    const row = layers[l], i = row.indexOf(key), j = i + s;
    if (j < 0 || j >= row.length) return s * Infinity;
    const c = /** @type {number} */ (cross.get(row[j])), p = nodes.get(row[j]);
    return p ? c - s * (s > 0 ? crossLo(p) : crossHi(p)) : c;
  };
  /** Does `p` carry decorations on side `s` that an edge leaving that side would cut through? */
  const busy = (/** @type {Placed} */ p, /** @type {number} */ s) => (s < 0 ? crossLo(p) : crossHi(p)) > halfCross(p) + 1;

  // A long edge that cannot run straight, between two nodes with nothing beyond
  // them, detours round the outside of everything it passes: a skip connection.
  /** @type {Map<number, -1 | 1>} */
  const detour = new Map();
  /** Cross position of each detour's straight run. @type {Map<number, number>} */
  const runAt = new Map();
  forward.forEach((e, i) => {
    const keys = chains[i];
    if (!keys.length || straight[i] || partner.has(i)) return;
    const a = at(e.from), b = at(e.to);
    const off = /** @type {number} */ (cross.get(keys[0])) - crossOf(a);
    if (Math.abs(off) < 1) return;
    const s = off > 0 ? 1 : -1;
    if (busy(a, s) || busy(b, s)) return;
    // Only an edge that has to go round something detours: its dummies lie past both ends' sides.
    let out = -Infinity;
    for (const k of keys) out = Math.max(out, s * /** @type {number} */ (cross.get(k)));
    const sideA = s * crossOf(a) + halfCross(a), sideB = s * crossOf(b) + halfCross(b);
    if (out < sideA + 8 || out < sideB + 8) return;
    // The run sits past the dummies and both ends; everything beyond it on that side must clear it and its words.
    const co = s * Math.max(out, sideA + 18, sideB + 18);
    const room = 10 + (e.label ? (down ? labelW(e.label) : LABEL_H) + 6 : 0);
    const clear = [[e.from, a.layer], ...keys.map((k, j) => [k, a.layer + 1 + j]), [e.to, b.layer]]
      .every(([k, l]) => s * (nextOut(/** @type {string} */ (k), /** @type {number} */ (l), s) - co) >= room);
    if (clear) { detour.set(i, s); runAt.set(i, co); }
  });
  // Detour ends share the node's side, spread along it: arrivals first, departures after.
  /** @type {Map<string, Pt>} */
  const sidePort = new Map();
  /** @type {Map<string, { p: Placed, s: number, ends: { key: string, order: number }[] }>} */
  const sides = new Map();
  for (const [i, s] of detour) {
    const e = forward[i];
    for (const [id, key, order] of /** @type {const} */ ([[e.from, `${i}>`, at(e.to).layer], [e.to, `${i}<`, -at(e.from).layer - 1e3]])) {
      const side = sides.get(`${s}\u0000${id}`) ?? { p: at(id), s, ends: [] };
      side.ends.push({ key, order });
      sides.set(`${s}\u0000${id}`, side);
    }
  }
  for (const { p, s, ends } of sides.values()) {
    ends.sort((u, v) => u.order - v.order);
    const step = ends.length > 1 ? Math.min(10, (2 * halfMain(p) - 10) / (ends.length - 1)) : 0;
    ends.forEach((end, j) => {
      const off = (j - (ends.length - 1) / 2) * step;
      sidePort.set(end.key, cm(edgeOf(p, ...xy(s * halfCross(p), off))));
    });
  }

  // Forward edges, and their bowed partners.
  /** @type {Map<number, Box>} */
  const detourLabel = new Map();
  const vias = forward.map((_, i) => (straight[i] || detour.has(i) ? [] : chains[i].flatMap((k) => /** @type {Pt[]} */ (band.get(k)))));
  const ports = portsFor(forward, vias, partner, nodes, down, detour, exitMain);
  forward.forEach((e, i) => {
    const a = at(e.from), b = at(e.to), via = vias[i];
    const s = detour.get(i);
    if (s !== undefined) {
      const [c0, m0] = /** @type {Pt} */ (sidePort.get(`${i}>`)), [c3, m3] = /** @type {Pt} */ (sidePort.get(`${i}<`));
      const co = /** @type {number} */ (runAt.get(i));
      const r = detourPath(c0, m0, c3, m3, co,
        mainAt[a.layer + 1] - reach[a.layer + 1].lo - m0, m3 - (mainAt[b.layer - 1] + reach[b.layer - 1].hi));
      const pts = r.pts.map(([c, m]) => xy(c, m));
      lines += stroke(e, r.d(xy));
      routes.push({ e, pts, side: 0, fixed: true });
      if (e.label) {
        // Level with the middle layer it passes, so the words sit beside a node rather than in a gap.
        const w = labelW(e.label), mid = Math.min(r.m2, Math.max(r.m1, mainAt[a.layer + 1 + Math.floor((chains[i].length - 1) / 2)]));
        const [x, y] = down ? [co + s * (6 + w / 2), mid] : [mid, co + s * (6 + LABEL_H / 2)];
        words += down ? text(co + s * 6, y + 4, e.label, { anchor: s < 0 ? "end" : "start" }) : text(x, y + 4, e.label);
        fixed.push(boxAt(x, y, w, LABEL_H));
        detourLabel.set(i, boxAt(x, y, w, LABEL_H));
      }
      return;
    }
    const back = partner.get(i);
    const draws = back ? [{ e, from: a, to: b, via, bow: BOW }, { e: back, from: b, to: a, via: [...via].reverse(), bow: BOW }] :
      [{ e, from: a, to: b, via, bow: 0 }];
    for (const r of draws) {
      const route = bend(r.from, r.to, r.via, r.bow, ports.get(`${i}>`), ports.get(`${i}<`));
      lines += stroke(r.e, route.path);
      routes.push({ e: r.e, pts: route.pts, side: r.bow ? 1 : 0, fixed: false });
    }
  });

  // Edges within one layer: straight across to a neighbour, bowed when both ways, arced over anything between.
  for (const e of flats) {
    const a = at(e.from), b = at(e.to);
    if (!arced.has(e)) {
      const route = bend(a, b, [], paired(e) ? BOW : 0);
      lines += stroke(e, route.path);
      routes.push({ e, pts: route.pts, side: paired(e) ? 1 : 0, fixed: false });
      continue;
    }
    const sgn = crossOf(b) > crossOf(a) ? 1 : -1;
    const s0 = edgeOf(a, ...xy(sgn * 0.5, -1)), t0 = edgeOf(b, ...xy(-sgn * 0.5, -1));
    const l = a.layer, peak = mainAt[l] - reach[l].lo - ARC;
    const [c0, m0] = cm(s0), [c1, m1] = cm(t0);
    const route = quad(s0, xy((c0 + c1) / 2, (4 * peak - m0 - m1) / 2), t0);
    lines += stroke(e, route.path);
    routes.push({ e, pts: route.pts, side: 0, fixed: false });
  }

  // Group outlines: members, and the long edges touching them while they pass the members' layers.
  const real = [...nodes.values()];
  const extBox = (/** @type {Placed} */ p) => ({ x0: p.x - p.ext.l, y0: p.y - p.ext.t, x1: p.x + p.ext.r, y1: p.y + p.ext.b });
  const rects = g.groups.map((gr, gi) => {
    const members = new Set(gr.nodes);
    const own = gr.nodes.map((id) => extBox(at(id)));
    let lo = Infinity, hi = -Infinity;
    for (const id of gr.nodes) { const p = at(id); lo = Math.min(lo, mainOf(p) - mainLo(p)); hi = Math.max(hi, mainOf(p) + mainHi(p)); }
    /** @type {Pt[]} */
    const inner = [];
    forward.forEach((e, i) => {
      if (!chains[i].length || !(members.has(e.from) || members.has(e.to))) return;
      const r = routes.find((x) => x.e === e);
      for (const pt of r?.pts ?? []) if (cm(pt)[1] > lo && cm(pt)[1] < hi) inner.push(pt);
    });
    /** @type {Box[]} */
    const labels = [];
    forward.forEach((e, i) => {
      const b = detourLabel.get(i);
      if (b && (members.has(e.from) || members.has(e.to)) && cm([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2])[1] > lo && cm([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2])[1] < hi) labels.push(b);
    });
    const box = bounds([...own, ...labels, ...inner.map(([x, y]) => ({ x0: x, y0: y, x1: x, y1: y }))], GROUP_PAD);
    return { gr, x0: box.x, y0: box.y, x1: box.x + box.w, y1: box.y + box.h, l0: spans[gi].l0, l1: spans[gi].l1 };
  });
  let outlines = "";
  /** Group borders, so labels keep off them. @type {Pt[][]} */
  const rims = [];
  for (const r of rects) {
    const color = inkOf(r.gr.tone, INK.rule);
    outlines += `<rect x="${n(r.x0)}" y="${n(r.y0)}" width="${n(r.x1 - r.x0)}" height="${n(r.y1 - r.y0)}" rx="8" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="4 3"/>`;
    rims.push([[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1], [r.x0, r.y0]]);
    if (r.gr.label) {
      words += text(r.x0 + 2, r.y0 - 5, r.gr.label, { anchor: "start" });
      fixed.push({ x0: r.x0, y0: r.y0 - 5 - 11, x1: r.x0 + 2 + labelW(r.gr.label), y1: r.y0 - 2 });
    }
  }

  // Back edges loop round the outside, nested when there are several on one side.
  /** Everything a loop has to clear, as cross extents per layer. */
  const extents = [...real.map((p) => ({ lo: crossOf(p) - crossLo(p), hi: crossOf(p) + crossHi(p), layer: p.layer })),
    ...[...dummy].map(([k, pt]) => ({ lo: pt[down ? 0 : 1], hi: pt[down ? 0 : 1], layer: layers.findIndex((ks) => ks.includes(k)) })),
    ...rects.flatMap((r) => {
      const [lo, hi] = down ? [r.x0, r.x1] : [r.y0, r.y1];
      return Array.from({ length: r.l1 - r.l0 + 1 }, (_, k) => ({ lo, hi, layer: r.l0 + k }));
    })];
  let cMin = Infinity, cMax = -Infinity;
  for (const p of real) { cMin = Math.min(cMin, crossOf(p)); cMax = Math.max(cMax, crossOf(p)); }
  const middle = (cMin + cMax) / 2;
  const used = { [-1]: Infinity, [1]: -Infinity };
  /** Is `p` the outermost real node of its layer on side `s`? */
  const outer = (/** @type {Placed} */ p, /** @type {number} */ s) => {
    const row = layers[p.layer].filter((k) => nodes.has(k));
    return (s < 0 ? row[0] : row.at(-1)) === p.d.id;
  };
  const sorted = [...loops].sort((x, y) => (at(x.from).layer - at(x.to).layer) - (at(y.from).layer - at(y.to).layer));
  for (const e of sorted) {
    const a = at(e.from), b = at(e.to);
    const rule = crossOf(a) < middle - 1 ? -1 : 1;
    const span = extents.filter((it) => it.layer >= b.layer && it.layer <= a.layer);
    // Long edges past either end on side s: the loop's short legs would cut across them.
    const beyond = (/** @type {number} */ s) => [a, b].reduce((sum, p) => sum + [...dummy].filter(([k, pt]) =>
      layers[p.layer].includes(k) && s * ((down ? pt[0] : pt[1]) - crossOf(p)) > 0).length, 0);
    const score = (/** @type {number} */ s) => (outer(a, s) ? 0 : 2) + (outer(b, s) ? 0 : 2) +
      (busy(a, s) ? 1 : 0) + (busy(b, s) ? 1 : 0) + Math.min(2, beyond(s)) + (s === rule ? 0 : 0.5);
    const s = score(-1) < score(1) ? -1 : 1;
    let edge = s < 0 ? Infinity : -Infinity;
    for (const it of span) edge = s < 0 ? Math.min(edge, it.lo) : Math.max(edge, it.hi);
    const co = s < 0 ? Math.min(edge - 24, used[-1] - 14) : Math.max(edge + 24, used[1] + 14);
    const lw = e.label ? (down ? labelW(e.label) : LABEL_H) + 6 : 0;
    used[s] = co + s * lw;

    // Leave and enter from the outer side when nothing is in the way, else through the gap past the layer.
    const channel = (/** @type {Placed} */ p, /** @type {1 | -1} */ dir) => {
      const l = p.layer, half = dir > 0 ? reach[l].hi : reach[l].lo;
      const gap = dir > 0 ? (gaps[l] ?? 36) : (gaps[l - 1] ?? 36);
      return mainAt[l] + dir * (half + gap / 2);
    };
    /** @type {Pt[]} */
    let tail;
    if (outer(a, s) && !busy(a, s)) tail = [edgeOf(a, ...xy(s, 0)), xy(co, mainOf(a))];
    else {
      const m = channel(a, 1), c0 = crossOf(a) + s * halfCross(a) / 2;
      tail = [xy(c0, mainOf(a) + exitMain(a)), xy(c0, m), xy(co, m)];
    }
    /** @type {Pt[]} */
    let head;
    if (outer(b, s) && !busy(b, s)) head = [xy(co, mainOf(b)), edgeOf(b, ...xy(s, 0))];
    else {
      const m = channel(b, -1), c0 = crossOf(b) + s * halfCross(b) / 2;
      head = [xy(co, m), xy(c0, m), xy(c0, mainOf(b) - halfMain(b))];
    }
    const pts = [...tail, ...head];
    lines += stroke(e, rounded(pts), true);
    routes.push({ e, pts, side: 0, fixed: true });
    if (e.label) {
      const m0 = cm(/** @type {Pt} */ (tail.at(-1)))[1], m1 = cm(head[0])[1];
      const mid = (m0 + m1) / 2, w = labelW(e.label);
      const [x, y] = down ? [co + s * (6 + w / 2), mid] : [mid, co + s * (6 + LABEL_H / 2)];
      words += down ? text(co + s * 6, y + 4, e.label, { anchor: s < 0 ? "end" : "start" }) : text(x, y + 4, e.label);
      fixed.push(boxAt(x, y, w, LABEL_H));
    }
  }

  // Self-loops, start arrows, side notes and captions.
  for (const p of nodes.values()) {
    if (p.loop) {
      const e = p.loop;
      const v = under.has(p) ? 1 : -1;
      const [p1, p2] = down ? [edgeOf(p, 1, -0.45), edgeOf(p, 1, 0.45)] : [edgeOf(p, -0.45, v), edgeOf(p, 0.45, v)];
      const c = LOOP / 0.75;
      /** @type {[Pt, Pt]} */
      const [c1, c2] = down ? [[p1[0] + c, p1[1] - 16], [p2[0] + c, p2[1] + 16]] : [[p1[0] - 16, p1[1] + v * c], [p2[0] + 16, p2[1] + v * c]];
      lines += stroke(e, `M${n(p1[0])},${n(p1[1])} C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(p2[0])},${n(p2[1])}`);
      routes.push({ e, pts: [p1, ...cubic(p1, c1, c2, p2)], side: 0, fixed: true });
      if (e.label) {
        const w = labelW(e.label);
        const [x, y] = down ? [p1[0] + LOOP + 6 + w / 2, p.y] : [p.x, p1[1] + v * (LOOP + 4 + LABEL_H / 2)];
        words += down ? text(p1[0] + LOOP + 6, y + 4, e.label, { anchor: "start" }) : text(x, y + 4, e.label);
        fixed.push(boxAt(x, y, w, LABEL_H));
      }
    }
    if (p.d.start) {
      const [x2, y2] = edgeOf(p, -1, 0);
      lines += `<path d="M${n(x2 - START)},${n(y2)} L${n(x2)},${n(y2)}" stroke="${INK.arrow}" stroke-width="1.5" marker-end="url(#${mk.id(INK.arrow)})"/>`;
    }
    if (p.d.side) {
      const w = labelW(p.d.side);
      const [x, y] = down ? [p.x + p.sideAt + w / 2, p.y] : [p.x, p.y + p.h / 2 + (p.d.below ? BELOW : 0) + 6 + LABEL_H / 2];
      words += down ? text(x - w / 2, y + 4, p.d.side, { anchor: "start" }) : text(x, y + 4, p.d.side);
      fixed.push(boxAt(x, y, w, LABEL_H));
    }
    if (p.d.below) {
      const y = p.y + p.h / 2 + BELOW / 2 + 2;
      words += text(p.x, y + 4, p.d.below, { mono: true });
      fixed.push(boxAt(p.x, y, captionW(p.d), LABEL_H));
    }
  }

  // Badges near the source end, then labels beside the midpoint, each where it covers the least.
  const solid = [...real.map((p) => boxAt(p.x, p.y, p.w + 6, p.h + 6)), ...fixed];
  /** @type {Box[]} */
  const taken = [];
  // Beside means straight across: right/left first going down, above/below first going right.
  /** @type {[number, number][]} */
  const dirs = down ? [[1, 0], [-1, 0], [0, -1], [0, 1]] : [[0, -1], [0, 1], [1, 0], [-1, 0]];
  // Each route's bounding box, so a candidate only runs the point-by-point hit test
  // against routes that come near it; without this, placement is quadratic in route points.
  const hull = new Map(routes.map((r) => [r, hullOf(r.pts)]));
  const spot = (/** @type {Route} */ r, /** @type {number} */ w, /** @type {number} */ h, /** @type {number[]} */ ts) => {
    // Fallback when every candidate is ruled out: just beside the midpoint.
    const m = along(r.pts, 0.5);
    let best = { cost: Infinity, x: m.x + m.ty * (w / 2 + 6), y: m.y - m.tx * (h / 2 + 6), box: boxAt(0, 0, 0, 0) };
    best.box = boxAt(best.x, best.y, w, h);
    ts.forEach((t, ti) => {
      const p = along(r.pts, t);
      dirs.forEach(([dx, dy], di) => {
        // A bowed edge keeps its words on the side it bows to.
        if (r.side && (dx * p.ty - dy * p.tx) * r.side <= 0.2) return;
        // Distance that clears the line across the box's whole extent.
        const off = dx ? w / 2 + 5 + (h / 2) * Math.abs(p.tx / (p.ty || 1e-9)) : h / 2 + 4 + (w / 2) * Math.abs(p.ty / (p.tx || 1e-9));
        if (off > Math.max(w, h) + 40) return;
        const x = p.x + dx * off, y = p.y + dy * off, box = boxAt(x, y, w, h);
        // Words that touch read as one; keep a few pixels between them.
        const near = boxAt(x, y, w + 8, h + 4);
        let cost = ti * 3 + di * 2;
        for (const o of solid) if (overlaps(box, o)) cost += 1000; else if (overlaps(near, o)) cost += 40;
        for (const o of taken) if (overlaps(box, o)) cost += 1000; else if (overlaps(near, o)) cost += 40;
        for (const o of routes) if (overlaps(box, /** @type {Box} */ (hull.get(o))) && lineHits(box, o.pts)) cost += o === r ? 120 : 80;
        for (const rim of rims) if (lineHits(box, rim)) cost += 60;
        if (cost < best.cost) best = { cost, x, y, box };
      });
    });
    taken.push(best.box);
    return best;
  };
  let marks = "";
  for (const r of routes) {
    if (!r.e.step) continue;
    const b = spot(r, 19, 19, [0.2, 0.28, 0.14, 0.36]);
    marks += badge(b.x, b.y, r.e.step, inkFor(r.e).arrow === INK.arrow ? INK.bright : inkFor(r.e).arrow);
  }
  for (const r of routes) {
    if (!r.e.label || r.fixed) continue;
    const w = labelW(r.e.label);
    const b = spot(r, w, LABEL_H, [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]);
    words += text(b.x, b.y + 4, r.e.label);
  }

  let shapes = "";
  for (const p of real) shapes += node(p);

  const box = bounds([
    ...real.map(extBox),
    ...routes.map((r) => hullOf(r.pts, 0)),
    ...rects, ...fixed, ...taken,
  ], 10);
  return svgOpen(box, { label: g.title || "graph", compact: g.compact }) + mk.defs() + outlines + lines + shapes + marks + words + "</svg>";
}

/**
 * A skip connection round the side, in abstract (cross, main) coordinates: out
 * of the source's side, a quarter turn into a straight run at cross `co`, a
 * quarter turn back into the target's side. `roomA` and `roomB` are how far the
 * turns may reach along the main axis before the next layer begins.
 * @returns {{ d: (xy: (c: number, m: number) => Pt) => string, pts: Pt[], m1: number, m2: number }}
 */
function detourPath(/** @type {number} */ c0, /** @type {number} */ m0, /** @type {number} */ c3, /** @type {number} */ m3,
  /** @type {number} */ co, /** @type {number} */ roomA, /** @type {number} */ roomB) {
  const k = 0.55;
  const half = Math.max(0, (m3 - m0) / 2);
  const r1 = Math.min(half, Math.max(6, Math.min(Math.abs(co - c0), roomA - 4)));
  const r2 = Math.min(half, Math.max(6, Math.min(Math.abs(co - c3), roomB - 4)));
  const m1 = m0 + r1, m2 = m3 - r2;
  /** @type {Pt[]} */
  const ctl = [
    [c0, m0], [c0 + (co - c0) * k, m0], [co, m1 - r1 * k], [co, m1],
    [co, m2], [co, m2 + r2 * k], [c3 + (co - c3) * k, m3], [c3, m3],
  ];
  const pts = [ctl[0], ...cubic(ctl[0], ctl[1], ctl[2], ctl[3]), ...cubic(ctl[4], ctl[5], ctl[6], ctl[7])];
  const d = (/** @type {(c: number, m: number) => Pt} */ xy) => {
    const [p0, p1, p2, p3, p4, p5, p6, p7] = ctl.map(([c, m]) => xy(c, m).map(n).join(","));
    return `M${p0} C${p1} ${p2} ${p3} L${p4} C${p5} ${p6} ${p7}`;
  };
  return { d, pts, m1, m2 };
}

/**
 * Spread the ends of forward edges along the facing side of box-like nodes, so
 * several edges into one box arrive side by side instead of on one point.
 * Ends are ordered by where the edge comes from, so spreading adds no crossings.
 * Keys are `${edge}>` for the source end and `${edge}<` for the target end.
 * Detours leave and enter through a node's side, so they take no port here.
 * @param {GraphEdge[]} forward @param {Pt[][]} vias @param {Map<number, GraphEdge>} partner
 * @param {Map<string, Placed>} nodes @param {boolean} down @param {Map<number, number>} detour
 * @param {(p: Placed) => number} exitMain how far below its centre an edge leaves a node going down the layers
 */
function portsFor(forward, vias, partner, nodes, down, detour, exitMain) {
  /** @type {Map<string, Pt>} */
  const ports = new Map();
  /** One side of one node and the edge ends that meet it. @type {Map<string, { p: Placed, sign: number, ends: { key: string, toward: Pt }[] }>} */
  const sides = new Map();
  forward.forEach((e, i) => {
    if (partner.has(i) || detour.has(i)) return;
    const a = /** @type {Placed} */ (nodes.get(e.from)), b = /** @type {Placed} */ (nodes.get(e.to));
    const after = vias[i][0] ?? [b.x, b.y], before = vias[i].at(-1) ?? [a.x, a.y];
    for (const [p, key, toward, sign] of /** @type {const} */ ([[a, `${i}>`, after, 1], [b, `${i}<`, before, -1]])) {
      if (p.kind !== "rect") continue;
      const side = sides.get(`${sign}\u0000${p.d.id}`) ?? { p, sign, ends: [] };
      side.ends.push({ key, toward });
      sides.set(`${sign}\u0000${p.d.id}`, side);
    }
  });
  for (const { p, sign, ends } of sides.values()) {
    const room = down ? p.w - 16 : p.h - 10;
    const step = ends.length > 1 ? Math.min(down ? 14 : 9, room / (ends.length - 1)) : 0;
    ends.sort((u, v) => (down ? u.toward[0] - v.toward[0] : u.toward[1] - v.toward[1]));
    ends.forEach((end, j) => {
      const off = (j - (ends.length - 1) / 2) * step;
      ports.set(end.key, down ? [p.x + off, p.y + (sign > 0 ? exitMain(p) : -p.h / 2)] : [p.x + sign * p.w / 2, p.y + off]);
    });
  }
  return ports;
}

/**
 * Route between two nodes through optional dummy points. `bow` pushes the
 * route to the left of travel, so a->b and b->a separate.
 * `from` and `to` pin the end points to ports when the caller has spread them.
 * @param {Placed} a @param {Placed} b @param {Pt[]} via @param {number} bow
 * @param {Pt} [from] @param {Pt} [to]
 */
function bend(a, b, via, bow, from, to) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len;
  if (!via.length && bow) {
    /** @type {Pt} */
    const c = [(a.x + b.x) / 2 + nx * bow * 2, (a.y + b.y) / 2 + ny * bow * 2];
    return quad(edgeOf(a, c[0] - a.x, c[1] - a.y), c, edgeOf(b, c[0] - b.x, c[1] - b.y));
  }
  const mid = via.map(([x, y]) => /** @type {Pt} */ ([x + nx * bow, y + ny * bow]));
  const first = mid[0] ?? [b.x, b.y], last = mid.at(-1) ?? [a.x, a.y];
  const s = from ?? edgeOf(a, first[0] - a.x, first[1] - a.y), t = to ?? edgeOf(b, last[0] - b.x, last[1] - b.y);
  return spline([s, ...mid, t]);
}

/** One node's outline and label. `fill` washes the inside with its tone; `tone` colours the outline. */
function node(/** @type {Placed} */ p) {
  const { d, x, y, w, h } = p;
  const color = inkOf(d.tone, INK.box), width = d.tone === "span" ? 2.4 : 1.5;
  const inside = d.fill ? mix(inkOf(d.fill, INK.box), 0.16) : INK.fill;
  const outline = `fill="${inside}" stroke="${color}" stroke-width="${width}"`;
  let out;
  switch (d.shape) {
    case "dot":
      return `<circle cx="${n(x)}" cy="${n(y)}" r="4.5" fill="${inkOf(d.tone, INK.bright)}"/>`;
    case "circle": case "double":
      out = `<circle cx="${n(x)}" cy="${n(y)}" r="${n(w / 2)}" ${outline}/>`;
      if (d.shape === "double") out += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(w / 2 - 4)}" fill="none" stroke="${color}" stroke-width="1.2"/>`;
      break;
    case "diamond":
      out = `<path d="M${n(x)},${n(y - h / 2)} L${n(x + w / 2)},${n(y)} L${n(x)},${n(y + h / 2)} L${n(x - w / 2)},${n(y)} Z" ${outline}/>`;
      break;
    case "store": // a cylinder: a database, a bucket, a queue
      out = `<path d="M${n(x - w / 2)},${n(y - h / 2 + 6)} a${n(w / 2)},6 0 0 1 ${n(w)},0 v${n(h - 12)} a${n(w / 2)},6 0 0 1 ${n(-w)},0 Z" ${outline}/>`;
      break;
    default:
      out = `<rect x="${n(x - w / 2)}" y="${n(y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${d.shape === "round" ? n(h / 2) : 6}" ${outline}/>`;
  }
  const lines = linesOf(d);
  const top = y + 4.5 - (lines.length - 1) * LINE / 2;
  return out + lines.map((line, i) =>
    text(x, top + i * LINE, line, { cls: "node-label", mono: d.mono, size: d.mono ? 12 : undefined })).join("");
}
