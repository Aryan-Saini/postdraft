/**
 * Diagrams as inline SVG.
 *
 * Claude's documents render mermaid; Postplan cannot, because mermaid needs a
 * script at view time. These two cover what mermaid is actually used for in a
 * spec: a left-to-right flow (laid out by the `graph` engine) and a call
 * sequence. Neither is ever hand-positioned.
 *
 * @module render/diagram
 */

import { normalize, render as renderGraph } from "./diagrams/graph.js";

/** @typedef {import("./ir.js").FlowBlock} FlowBlock */
/** @typedef {import("./ir.js").SequenceBlock} SequenceBlock */
/** @typedef {{ id: string, label: string, shape?: "box" | "round" | "diamond" | "store", tone?: string }} FlowNode */
/** @typedef {{ from: string, to: string, label?: string }} FlowEdge */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const n = (v) => Math.round(v * 100) / 100;

// A marker id is document-global, so each diagram mints its own: two diagrams on
// one page must not share `url(#arw)`.
let markerSeq = 0;
const arrowDefs = (id) =>
  `<defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
  `<path d="M0,1 L9,5 L0,9 z" fill="#6f6f6a"/></marker></defs>`;

/**
 * A call sequence. `actors` is a list of names; `msgs` is
 * [{ from, to, label, dashed?: true, note?: string }] in order.
 */
export function sequence(actors, msgs, { title = "", note = "" } = {}) {
  const laneW = Math.min(180, 680 / actors.length);
  const W = actors.length * laneW;
  const top = 34, step = 42;
  const H = top + msgs.length * step + 18;
  const xOf = (name) => actors.indexOf(name) * laneW + laneW / 2;

  const arw = `arw${++markerSeq}`;
  let body = arrowDefs(arw);
  for (const m of msgs) {
    for (const who of [m.from, m.to]) {
      if (!actors.includes(who)) throw new Error(`sequence message names an unknown actor: ${who}`);
    }
  }
  actors.forEach((a, i) => {
    const x = i * laneW + laneW / 2;
    body += `<rect x="${n(x - laneW / 2 + 10)}" y="4" width="${n(laneW - 20)}" height="24" rx="5" fill="#0b0b0b" stroke="#2a2a27" stroke-width="1.5"/>`;
    body += `<text x="${n(x)}" y="20" class="node-label">${esc(a)}</text>`;
    body += `<line x1="${n(x)}" y1="30" x2="${n(x)}" y2="${n(H - 8)}" stroke="#1e1e1c" stroke-width="1"/>`;
  });
  msgs.forEach((m, i) => {
    const y = top + i * step + 20;
    const x1 = xOf(m.from), x2 = xOf(m.to);
    const dir = x2 > x1 ? -4 : 4;
    body += `<line x1="${n(x1)}" y1="${n(y)}" x2="${n(x2 + dir)}" y2="${n(y)}" stroke="#3a3a37" stroke-width="1.5" ` +
      (m.dashed ? `stroke-dasharray="4 3" ` : "") + `marker-end="url(#${arw})"/>`;
    body += `<text x="${n((x1 + x2) / 2)}" y="${n(y - 8)}" class="edge-label">${esc(m.label)}</text>`;
  });
  return figure(`<svg viewBox="-6 -4 ${W + 12} ${H + 8}" width="100%" class="chart diagram" role="img" aria-label="${esc(title || "sequence diagram")}">${body}</svg>`, title, note);
}

function figure(svg, title, note) {
  return `<figure class="fig">` +
    (title ? `<figcaption class="fig-title">${esc(title)}</figcaption>` : "") +
    `<div class="fig-scroll">${svg}</div>` +
    (note ? `<div class="fig-note">${esc(note)}</div>` : "") + `</figure>`;
}

/**
 * Render one `flow` block. A flow is a left-to-right `graph` whose columns are
 * pinned ranks, so it gets the graph's text-sized nodes and label placement
 * instead of fixed-width boxes that long labels overflow.
 * @param {FlowBlock} block
 */
export function renderFlow(block) {
  const d = /** @type {{ title?: string, note?: string, cols?: FlowNode[][], edges?: FlowEdge[] }} */ (block?.data ?? {});
  const nodes = (d.cols ?? []).flatMap((col, rank) => col.map((node) => ({ ...node, rank })));
  const data = normalize({ title: d.title ?? "", note: d.note ?? "", dir: "right", nodes, edges: d.edges ?? [] });
  return renderGraph({ ...block, data });
}

/**
 * Render one `sequence` block.
 * @param {SequenceBlock} block
 */
export function renderSequence(block) {
  const d = /** @type {any} */ (block?.data ?? {});
  return sequence(d.actors ?? [], d.msgs ?? [], { title: d.title ?? "", note: d.note ?? "" });
}

export { esc };
