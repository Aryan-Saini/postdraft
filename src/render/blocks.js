/**
 * Block IR -> HTML.
 *
 * One function per block kind, all of them pure string builders over the classes
 * `shell.js` defines. Charts, code, diagrams and math are drawn by `charts.js`,
 * `code.js`, `diagram.js` and `math.js`, which this module only dispatches to.
 *
 * The markdown blocks WP1 hands over are already HTML, so prose needs six
 * rewrites on the way out: inline math spans and display-math placeholders
 * become MathML, tables gain their scroll wrapper, an image titled `zoom`
 * becomes a lightbox figure, inline code that names a file becomes a chip, and
 * every image gets its hidden load-failure panel (`media.js`).
 *
 * @module render/blocks
 */

import { escapeHtml } from "./parse.js";
import { meter, sparkline } from "./charts.js";
import { CHART_SCRIPT, isControlled, renderChartBlock } from "./chart-controls.js";
import { COPY_SCRIPT, codeSprite, iconKey, pathButton, renderCode, renderDiff } from "./code.js";
import { renderFlow, renderSequence } from "./diagram.js";
import { DIAGRAMS, drawOnce, renderDiagram } from "./diagrams/index.js";
import { renderInlineMath, renderMathBlock, unescapeHtml } from "./math.js";
import { MEDIA_SCRIPT, withFailPanels } from "./media.js";
import { FILES_SCRIPT, renderFiles } from "./files.js";
import { QUESTIONS_SCRIPT, renderQuestion } from "./questions.js";
import { fileSymbol } from "./filetypes.js";

/** @typedef {import("./ir.js").Block} Block */
/** @typedef {import("./ir.js").Doc} Doc */
/** @typedef {import("./ir.js").Meta} Meta */

/** Per-document render state: lightbox ids are document-wide, a `sources`
 * heading changes how the list under it is styled, `chips` records that a
 * file chip needs the copy script and the file glyph, and `media` that a
 * failure panel needs the media script and its icons, `slides` that a
 * slideshow needs the slides script and the chevrons, and `files` that a file
 * card needs the files script, with `fileIcons` the type glyphs its cards draw,
 * `controls` that a switchable chart needs the chart script, and `questions`
 * that a question needs the questions script.
 * @typedef {{ lightboxes: string[], zoomCount: number, heading: string, chips: boolean, media: boolean,
 *   slides: boolean, files: boolean, controls: boolean, questions: boolean, fileIcons: Set<string> }} Ctx */

/** @returns {Ctx} */
const newCtx = () => ({
  lightboxes: [], zoomCount: 0, heading: "", chips: false, media: false, slides: false, files: false, controls: false,
  questions: false, fileIcons: new Set(),
});

/* ------------------------------------------------------------------ document */

/**
 * Render a whole document body: title, byline, contents strip, then every block
 * in order, with any lightbox overlays collected at the end.
 *
 * A document with code blocks, file chips, media or file cards also gets, once
 * each, the icon sprite they reference (top of the body) and the document
 * script (end of the body): the copy script, plus the media script when there
 * are failure panels, the slides script when there is a slideshow, the files
 * script when there are file cards, the chart script when a chart has controls and the
 * questions script when there are questions. A document with none of them stays
 * script-free. The sprite carries only the glyphs the document uses.
 *
 * @param {Doc} doc
 * @returns {string}
 */
export function renderBody(doc) {
  const ctx = newCtx();
  const parts = [];
  if (doc.meta.title) parts.push(`<h1>${escapeHtml(doc.meta.title)}</h1>`);
  const line = byline(doc.meta);
  if (line) parts.push(line);

  // The lead is the opening paragraph and sits above the contents strip, the way
  // the renderer puts the answer before the navigation.
  const blocks = doc.blocks ?? [];
  let i = 0;
  if (blocks[0]?.type === "markdown" && blocks[0].lead) parts.push(renderBlock(blocks[i++], ctx));

  const toc = contents(blocks);
  if (toc) parts.push(toc);

  for (; i < blocks.length; i++) {
    // Consecutive compact diagrams share one wrapping row, so snapshots and
    // small topologies read side by side.
    if (!isCompactDiagram(blocks[i]) || !isCompactDiagram(blocks[i + 1])) {
      parts.push(renderBlock(blocks[i], ctx));
      continue;
    }
    const row = [];
    while (isCompactDiagram(blocks[i])) row.push(renderBlock(blocks[i++], ctx));
    i--;
    parts.push(`<div class="fig-row">\n${row.join("\n")}\n</div>`);
  }
  parts.push(...ctx.lightboxes);

  const wrap = `<div class="wrap"><main>\n${parts.filter(Boolean).join("\n")}\n</main></div>`;
  const code = blocks.filter((b) => b.type === "code" || b.type === "diff");
  if (!code.length && !ctx.chips && !ctx.media && !ctx.slides && !ctx.files && !ctx.controls && !ctx.questions) return wrap;
  const icons = code.map((b) => (b.type === "diff" ? "diff" : iconKey(b.lang)));
  if (code.length || ctx.media || ctx.files) icons.push("copy");
  if (ctx.chips || code.some((b) => b.file)) icons.push("file");
  if (ctx.media) icons.push("image-off", "video-off", "open");
  if (ctx.slides) icons.push("chevron-left", "chevron-right");
  if (ctx.files) icons.push("download", "open");
  // A type glyph may be a language icon a code block already put in the sprite.
  const have = new Set(icons);
  const glyphs = [...ctx.fileIcons].filter((k) => !have.has(k)).map((k) => fileSymbol(k, `icon-${k}`)).join("");
  const script = [COPY_SCRIPT, ctx.media && MEDIA_SCRIPT, ctx.slides && SLIDES_SCRIPT, ctx.files && FILES_SCRIPT,
    ctx.controls && CHART_SCRIPT, ctx.questions && QUESTIONS_SCRIPT]
    .filter(Boolean).join("\n");
  // A page whose only script is the chart one references no glyphs, so it gets no sprite.
  const sprite = icons.length || glyphs ? `${codeSprite(icons, glyphs)}\n` : "";
  return `${sprite}${wrap}\n<script>${script}</script>`;
}

/**
 * The byline row: a date pill with the calendar glyph, an @author pill, and a
 * status pill whose dot takes its colour from the status text.
 *
 * @param {Meta} meta
 * @returns {string} empty when the document carries no byline metadata
 */
export function byline(meta) {
  const chips = [];
  if (meta.date) {
    chips.push(
      `<span class="chip"><svg viewBox="0 0 16 16" aria-hidden="true">` +
      `<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1.5v3M11 1.5v3"/></svg>` +
      `${escapeHtml(meta.date)}</span>`,
    );
  }
  if (meta.byline) chips.push(`<span class="chip">@${escapeHtml(meta.byline)}</span>`);
  if (meta.status) {
    chips.push(`<span class="chip ${statusTone(meta.status)}"><span class="dot"></span>${escapeHtml(meta.status)}</span>`);
  }
  if (!chips.length) return "";
  return `<div class="byline">${chips.join('<span class="sep">·</span>')}</div>`;
}

/** Status words that colour the byline dot; anything else reads as on track. */
function statusTone(status) {
  const s = String(status).toLowerCase();
  if (/block|critical|fail|stopped/.test(s)) return "critical";
  if (/risk|warn|late|slipping/.test(s)) return "warn";
  return "good";
}

/**
 * The contents strip, built from the `##` headings so it needs no second parse.
 * One heading is not a table of contents, so fewer than two renders nothing.
 *
 * @param {Block[]} blocks
 * @returns {string}
 */
export function contents(blocks) {
  const tops = blocks.filter((b) => b.type === "heading" && b.level === 2);
  if (tops.length < 2) return "";
  const links = tops.map((h) => `<a href="#${escapeHtml(h.slug)}">${escapeHtml(h.text)}</a>`).join("");
  return `<div class="contents">${links}</div>`;
}

/* ------------------------------------------------------------------ blocks */

/**
 * Render one block. Unknown types render nothing: WP2's validator is what tells
 * the author about them, and a half-rendered block would hide that error.
 *
 * @param {Block} block
 * @param {Ctx} [ctx]
 * @returns {string}
 */
export function renderBlock(block, ctx = newCtx()) {
  switch (block.type) {
    case "markdown": return prose(block, ctx);
    case "heading": {
      ctx.heading = block.slug;
      const l = Math.min(Math.max(block.level, 1), 6);
      // An IR written by hand may carry only `text`; marks are optional, escaping is not.
      return `<h${l} id="${escapeHtml(block.slug)}">${block.html ?? escapeHtml(block.text)}</h${l}>`;
    }
    case "callout": {
      const cls = block.tone === "note" ? "note" : `note ${block.tone}`;
      return `<div class="${cls}"><span class="tag">${escapeHtml(block.title)}</span>\n<div>${withFailPanels(fileChips(block.html, ctx), ctx)}</div></div>`;
    }
    case "container":
      return `<div class="${escapeHtml(block.kind)}">\n${withFailPanels(fileChips(block.html, ctx), ctx)}\n</div>`;
    case "chart":
      if (isControlled(block.data)) ctx.controls = true;
      return drawOnce(block, () => renderChartBlock(block));
    case "stats": return stats(block);
    case "hero": return hero(block);
    case "timeline": return timeline(block);
    case "slides": return withFailPanels(slides(block, ctx), ctx);
    case "video": return withFailPanels(video(block), ctx);
    case "file": return renderFiles(block, ctx);
    case "question":
      ctx.questions = true;
      return renderQuestion(block);
    case "code": return renderCode(block);
    case "diff": return renderDiff(block);
    case "flow": return renderFlow(block);
    case "sequence": return renderSequence(block);
    case "math": return renderMathBlock(block.tex);
    // .fence scopes the mock colour utilities to fence output; it is display:contents.
    case "html": return `<div class="fence">${withFailPanels(block.html, ctx)}</div>`;
    case "footnotes": return footnotes(block);
    default: return Object.hasOwn(DIAGRAMS, block.type) ? renderDiagram(block) : "";
  }
}

/** A diagram fence that asked for `compact`. */
function isCompactDiagram(block) {
  return !!block && Object.hasOwn(DIAGRAMS, block.type) && block.data?.compact === true;
}

/* ------------------------------------------------------------------ prose */

/** Markdown HTML from the parser, with the six rewrites the shell needs. */
function prose(block, ctx) {
  let html = renderInlineMath(block.html);
  html = fillMathBlocks(html);
  html = wrapTables(html);
  html = zoomFigures(html, ctx);
  html = fileChips(html, ctx);
  html = withFailPanels(html, ctx);
  if (block.lead) html = html.replace(/^<p>/, '<p class="lead">');
  // The list under a "Sources" heading is the provenance list, not body copy.
  if (ctx.heading === "sources") html = html.replace(/^<ul>/, '<ul class="sources">');
  return html;
}

// A `$$…$$` formula inside a paragraph group reaches us as an empty placeholder
// carrying the escaped TeX, the same way inline math does.
const MATH_BLOCK_PLACEHOLDER = /<div class="math-block" data-tex="([^"]*)"><\/div>/g;

/** Replace every display-math placeholder in prose HTML with its MathML. */
function fillMathBlocks(html) {
  return html.replace(MATH_BLOCK_PLACEHOLDER, (_m, attr) => renderMathBlock(unescapeHtml(attr)));
}

/** From this many columns a table breaks out of the reading column. */
const WIDE_TABLE_COLS = 6;

/**
 * Give every table the horizontal scroll wrapper, and let a table with four or
 * more columns take the full column width; a narrow one sizes to its content,
 * which is what the renderer does. Six or more columns cannot fit the reading
 * column without squeezing cells to a word a line, so that wrapper is `wide`
 * and may grow past the column toward the viewport.
 */
function wrapTables(html) {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (_, inner) => {
    const firstRow = /<tr>([\s\S]*?)<\/tr>/.exec(inner)?.[1] ?? "";
    const cols = (firstRow.match(/<t[hd][\s>]/g) ?? []).length;
    const cls = cols >= 4 ? ' class="full"' : "";
    const wrap = cols >= WIDE_TABLE_COLS ? "tbl-wrap wide" : "tbl-wrap";
    return `<div class="${wrap}"><table${cls}>${inner}</table></div>`;
  });
}

/**
 * `![alt](src "zoom")` becomes a figure whose thumbnail links to a `:target`
 * overlay. The overlay is collected on the context and emitted once at the end
 * of the document, so it is never nested inside a paragraph.
 *
 * Text on the lines directly under the image, in the same paragraph, is its
 * caption. Without one the alt text is shown instead, so an image never
 * carries the same sentence twice.
 */
function zoomFigures(html, ctx) {
  const img = /<img\b[^>]*\bdata-zoom="1"[^>]*>/;
  const wrapped = new RegExp(`<p>\\s*(${img.source})([\\s\\S]*?)</p>`, "g");
  const replace = (tag, caption = "") => {
    const id = `lb-${++ctx.zoomCount}`;
    const text = caption.replace(/^\s*(?:<br>)?\s*/, "").trim() || (/alt="([^"]*)"/.exec(tag)?.[1] ?? "");
    const clean = tag.replace(/\s*data-zoom="1"/, "");
    const cap = text ? `<figcaption>${text}</figcaption>` : "";
    ctx.lightboxes.push(
      `<div class="lightbox" id="${id}"><a href="#_">${clean}</a>` +
      (text ? `<div class="cap">${text}</div>` : "") + `</div>`,
    );
    return `<figure class="img"><a class="zoom" href="#${id}">${clean}</a>${cap}</figure>`;
  };
  return html
    .replace(wrapped, (_, tag, caption) => replace(tag, caption))
    .replace(new RegExp(img.source, "g"), (tag) => replace(tag));
}

/** Extensions that make a slash-free token a file name (`plan.md`), and the extensionless names that count too. */
const FILE_EXT = new Set(("ts tsx mts cts js jsx mjs cjs json jsonc md mdx txt html htm css scss sass less " +
  "py rb rs go java kt kts swift c h cc cpp hpp cs php erl ex exs sh bash zsh fish ps1 sql graphql gql " +
  "proto xml svg yaml yml toml ini cfg conf lock csv tsv pdf png jpg jpeg gif webp mp4 vue svelte astro " +
  "prisma tf lua dart zig nix").split(" "));
const FILE_NAMES = new Set(["Dockerfile", "Makefile", "Gemfile", "Procfile", "Justfile"]);

/**
 * The path an inline code token names, split from an optional `:42`,
 * `:12-40` or `:12:5` suffix, or null when it is not a path.
 *
 * It is a path when it has no spaces, no URL scheme, and either contains a
 * `/` (which covers `~/` and `./`) or ends in a known extension. `Next.js`
 * style names (one capitalised word + `.js`) and `process.env`-style member
 * access stay code.
 *
 * @param {string} text the token's decoded text
 * @returns {{ path: string, line: string } | null}
 */
export function filePath(text) {
  const m = /^([\w.~@\-/[\]]+?)(:\d+(?:[-:]\d+)?)?$/.exec(text);
  if (!m) return null;
  const [, path, line = ""] = m;
  if (!/[A-Za-z]/.test(path) || /^\/\/|\/\/|^www\./i.test(path)) return null;
  if (path.includes("/")) return /[^/]/.test(path) && path !== "~/" ? { path, line } : null;
  if (FILE_NAMES.has(path) || /^\.env(?:\.[\w-]+)?$/.test(path)) return { path, line };
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1];
  if (!ext || !FILE_EXT.has(ext.toLowerCase()) || /^\./.test(path)) return null;
  if (/^[A-Z][A-Za-z0-9]*\.js$/.test(path)) return null;
  return { path, line };
}

/**
 * Inline code that names a file becomes a chip that copies its path. Code
 * inside a link or a `<pre>` is left alone: a button cannot sit in a link.
 */
function fileChips(html, ctx) {
  return html.replace(/<a\b[\s\S]*?<\/a>|<pre\b[\s\S]*?<\/pre>|<code>([^<]*)<\/code>/g, (whole, inner) => {
    if (inner === undefined) return whole;
    const text = unescapeHtml(inner);
    const hit = filePath(text);
    if (!hit) return whole;
    ctx.chips = true;
    return pathButton(hit.path, { cls: "file-chip", label: text });
  });
}

/* ------------------------------------------------------------------ tiles */

/** Dense stat tiles sharing one hairline grid, each with a sparkline or a meter. */
function stats(block) {
  const items = asArray(block.data);
  if (!items.length) return "";
  const tiles = items.map((it) => {
    const parts = [`<div class="k">${escapeHtml(it.k ?? "")}</div>`, `<div class="v">${value(it)}</div>`];
    if (it.delta) parts.push(`<div class="d">${delta(it)}</div>`);
    // `normalize` fills `spark: []` on every tile, and a line needs two points.
    if (Array.isArray(it.spark) && it.spark.length >= 2) {
      parts.push(sparkline(it.spark, { color: sparkColor(it.tone) }));
    }
    if (it.meter) parts.push(meter(Number(it.v), { max: Number(it.meter.max), tone: meterColor(it.meter.tone) }));
    return `<div class="stat">${parts.join("")}</div>`;
  });
  return `<div class="stats">${tiles.join("")}</div>`;
}

/** The centred hero stat: title, big number, as-of line, signed change. */
function hero(block) {
  const items = asArray(block.data);
  if (!items.length) return "";
  const tiles = items.map((it) => {
    const parts = [`<div class="k">${escapeHtml(it.k ?? "")}</div>`, `<div class="v">${value(it)}</div>`];
    if (it.as) parts.push(`<div class="as">${escapeHtml(it.as)}</div>`);
    if (it.delta) parts.push(`<div class="d">${delta(it)}</div>`);
    return `<div class="hero">${parts.join("")}</div>`;
  });
  return tiles.length === 1 ? tiles[0] : `<div class="heroes">${tiles.join("")}</div>`;
}

const SPARK_TONES = { good: "#199e70", warn: "#c98500", bad: "#d03b3b", critical: "#d03b3b" };
const sparkColor = (tone) => SPARK_TONES[tone] ?? "#3987e5";

/** Meter fill colours. A tone may also be given as a literal `#rrggbb`. */
const METER_TONES = { good: "#199e70", warn: "#fab219", bad: "#d03b3b", critical: "#d03b3b", flat: "#8a8f98" };
const meterColor = (tone) =>
  METER_TONES[tone] ?? (typeof tone === "string" && /^#[0-9a-fA-F]{3,8}$/.test(tone) ? tone : "#fab219");

const value = (it) => escapeHtml(format(it.v, it.format));

/** The word that separates a change from what it is measured against. */
const BASIS = /\s(?:vs|of|since|over|against|from)\s/;

/**
 * A delta reads `+18.4% vs August`: the magnitude is bold and coloured by tone,
 * the basis stays muted. With no tone (`95% of the cap`) the whole line is muted,
 * because there is no direction to signal.
 */
function delta(it) {
  const text = String(it.delta);
  if (!it.tone) return escapeHtml(text);
  const at = BASIS.exec(text);
  const head = at ? text.slice(0, at.index) : text.split(/\s/, 1)[0];
  const dir = it.tone === "good" ? "up" : "down";
  return `<b class="${dir}">${escapeHtml(head)}</b>${escapeHtml(text.slice(head.length))}`;
}

/**
 * The format presets. Never a template string: the enum keeps the output
 * predictable and the error message short when an author invents one.
 *
 * @param {unknown} v
 * @param {string} [preset] one of `int` `compact` `usd` `pct` `ms`
 * @returns {string}
 */
export function format(v, preset) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? "");
  switch (preset) {
    case "int": return Math.round(n).toLocaleString("en-US");
    case "compact": return compact(n);
    case "usd": return (n < 0 ? "-$" : "$") + compact(Math.abs(n));
    case "pct": return `${trim(n * 100)}%`;
    case "ms": return `${Math.round(n).toLocaleString("en-US")} ms`;
    default: return trim(n);
  }
}

/** 1284 -> 1.28k, 412000 -> 412k: three significant figures, then a unit. */
function compact(n) {
  const abs = Math.abs(n);
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
  for (const [scale, unit] of units) {
    if (abs >= scale) return trim(Number((n / scale).toPrecision(3))) + unit;
  }
  return trim(Number(n.toPrecision(3)));
}

/** Drop a trailing `.0`, keeping thousands separators. */
function trim(n) {
  return Number(n.toFixed(2)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ media */

/** Dated timeline; `state` is `done`, `now`, or absent for something ahead. */
function timeline(block) {
  const items = asArray(block.data);
  if (!items.length) return "";
  const rows = items.map((it) => {
    const cls = it.state === "done" || it.state === "now" ? ` class="${it.state}"` : "";
    const note = it.note ? `<p>${escapeHtml(it.note)}</p>` : "";
    return `<li${cls}><span class="when">${escapeHtml(it.when ?? "")}</span>` +
      `<div class="what">${escapeHtml(it.what ?? "")}</div>${note}</li>`;
  });
  return `<ul class="timeline">${rows.join("")}</ul>`;
}

/**
 * Scroll-snap slideshow. The dots are anchors, so paging needs no script; the
 * arrows ship `hidden` and `SLIDES_SCRIPT` reveals them, so a reader with
 * scripts blocked gets the plain snap strip.
 */
function slides(block, ctx) {
  const items = asArray(block.data);
  if (!items.length) return "";
  ctx.slides = true;
  const figures = items.map((it, i) => {
    const id = `${block.id}-${i + 1}`;
    const cap = it.caption ? `<figcaption>${i + 1} · ${escapeHtml(it.caption)}</figcaption>` : "";
    return `<figure id="${escapeHtml(id)}"><img src="${escapeHtml(it.src ?? "")}" ` +
      `alt="${escapeHtml(it.alt ?? it.caption ?? `Slide ${i + 1}`)}" loading="lazy">${cap}</figure>`;
  });
  const dots = items.map((_, i) =>
    `<a href="#${escapeHtml(`${block.id}-${i + 1}`)}" aria-label="Slide ${i + 1}"></a>`).join("");
  const arrow = (dir, label) =>
    `<button type="button" class="arrow ${dir}" aria-label="${label}" hidden>` +
    `<svg viewBox="0 0 16 16" aria-hidden="true"><use href="#icon-chevron-${dir === "prev" ? "left" : "right"}"/></svg></button>`;
  return `<div class="slides"><div class="stage">` +
    `<div class="track" tabindex="0" role="region" aria-label="Slideshow, ${items.length} slides">${figures.join("")}</div>` +
    `${arrow("prev", "Previous slide")}${arrow("next", "Next slide")}</div>` +
    `<div class="dots">${dots}</div><div class="count">${items.length} slides</div></div>`;
}

/**
 * Slideshow behaviour: one delegated click and keydown listener, no inline
 * handlers. An arrow (or Left/Right on the focused track) scrolls the track by
 * one slide and scroll-snap settles it. On each `scroll` the arrow at an end
 * hides and the dot for the slide in view gets `aria-current`.
 */
export const SLIDES_SCRIPT = `(() => {
  const sync = (track) => {
    const box = track.closest(".slides");
    const max = track.scrollWidth - track.clientWidth;
    const prev = box.querySelector(".arrow.prev");
    const next = box.querySelector(".arrow.next");
    prev.hidden = track.scrollLeft <= 1;
    next.hidden = track.scrollLeft >= max - 1;
    for (const b of [prev, next]) if (b.hidden && document.activeElement === b) track.focus();
    const dots = box.querySelectorAll(".dots a");
    const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    dots.forEach((d, n) => { if (n === i) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
  };
  const page = (track, dir) => track.scrollBy({ left: dir * track.clientWidth, behavior: "smooth" });
  for (const track of document.querySelectorAll(".slides .track")) {
    track.addEventListener("scroll", () => sync(track), { passive: true });
    sync(track);
  }
  addEventListener("resize", () => { for (const t of document.querySelectorAll(".slides .track")) sync(t); });
  document.addEventListener("click", (e) => {
    const b = e.target instanceof Element ? e.target.closest(".slides .arrow") : null;
    if (b) page(b.closest(".slides").querySelector(".track"), b.classList.contains("next") ? 1 : -1);
  });
  document.addEventListener("keydown", (e) => {
    const t = e.target instanceof Element ? e.target.closest(".slides") : null;
    if (!t || (e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    page(t.querySelector(".track"), e.key === "ArrowRight" ? 1 : -1);
  });
})();`;

const VIDEO_TYPES = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };

/** A clip takes the same figure as an image: native player, poster, caption. */
function video(block) {
  const it = /** @type {Record<string, string>} */ (block.data ?? {});
  if (!it.src) return "";
  const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(it.src)?.[1]?.toLowerCase() ?? "mp4";
  const poster = it.poster ? ` poster="${escapeHtml(it.poster)}"` : "";
  const cap = it.caption ? `<figcaption>${escapeHtml(it.caption)}</figcaption>` : "";
  return `<figure class="img"><video controls preload="metadata"${poster}>` +
    `<source src="${escapeHtml(it.src)}" type="${VIDEO_TYPES[ext] ?? "video/mp4"}"></video>${cap}</figure>`;
}

/** Footnotes as a numbered list at the end, each linking back to its reference. */
function footnotes(block) {
  const items = block.items ?? [];
  if (!items.length) return "";
  const rows = items.map((it, i) =>
    `<li id="fn-${i + 1}">${it.html}<a class="fn-back" href="#fnref-${i + 1}" aria-label="Back to reference">↩</a></li>`);
  return `<hr><ol class="footnotes">${rows.join("")}</ol>`;
}

/** A data fence body that may be one object or a list of them. */
function asArray(data) {
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === "object");
  return data && typeof data === "object" ? [data] : [];
}
