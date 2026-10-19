/**
 * Markdown -> block IR.
 *
 * marked does CommonMark and GFM; everything Postplan adds on top is a marked
 * extension here (`:::` containers, GitHub alerts, `==`/`++`/`~`/`^`, footnotes,
 * `$…$`), and everything structural is a fence routed by its info string.
 *
 * @module render/parse
 */

import { Marked } from "marked";
import { ALERT_TONES, BLOCK_TYPES, DATA_FENCES, emptyDoc } from "./ir.js";

/** @typedef {import("./ir.js").Block} Block */
/** @typedef {import("./ir.js").Doc} Doc */
/** @typedef {import("./ir.js").Footnote} Footnote */
/** @typedef {import("./ir.js").Meta} Meta */
/** @typedef {import("./ir.js").ParseResult} ParseResult */
/** @typedef {import("./ir.js").RenderError} RenderError */

const DATA_FENCE_SET = new Set(DATA_FENCES);
const META_KEYS = /** @type {const} */ (["title", "byline", "date", "status", "tab", "icon"]);
const KNOWN_META = new Set(META_KEYS);

/** Cell tone prefixes allowed in a GFM table cell, mapped to their class suffix. */
const CELL_TONES = { good: "good", warn: "warn", bad: "bad", flat: "flat" };

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** @param {string} s */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/**
 * The visible text of an inline HTML run: tags dropped, the escapes `marked`
 * writes decoded. A heading's id and its contents-strip label come from this,
 * so `## The <code>api</code>` does not slug as "the-code-api-code".
 *
 * @param {string} html
 * @returns {string}
 */
export function textOf(html) {
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);
}

/** GitHub-style anchor slug; used for heading ids and the contents strip. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-") || "section";
}

/* ------------------------------------------------------------------ frontmatter */

/**
 * Split a leading `---` block. Flat `key: value`, strings only, first colon wins:
 * no YAML library, so a date or a colon in a title cannot change the parse.
 *
 * `lines` holds the source line each key was written on, so a complaint about a
 * key points at that key rather than at the top of the file.
 *
 * @param {string} text
 * @returns {{ meta: Record<string, string>, lines: Record<string, number>, body: string, bodyLine: number, errors: {line: number, message: string}[] }}
 */
export function splitFrontmatter(text) {
  /** @type {Record<string, string>} */
  const meta = {};
  /** @type {Record<string, number>} */
  const lines = {};
  /** @type {{line: number, message: string}[]} */
  const errors = [];
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { meta, lines, body: text, bodyLine: 1, errors };

  m[1].split(/\r?\n/).forEach((raw, i) => {
    const line = i + 2; // line 1 is the opening ---
    if (!raw.trim()) return;
    const colon = raw.indexOf(":");
    if (colon === -1) {
      errors.push({ line, message: `frontmatter line is not "key: value": ${raw.trim()}` });
      return;
    }
    const key = raw.slice(0, colon).trim();
    if (!key) {
      errors.push({ line, message: "frontmatter key is empty" });
      return;
    }
    meta[key] = raw.slice(colon + 1).trim();
    lines[key] = line;
  });

  return { meta, lines, body: text.slice(m[0].length), bodyLine: countLines(m[0]) + 1, errors };
}

/** Number of newlines in `s` (i.e. lines consumed). */
function countLines(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

/* ------------------------------------------------------------------ info strings */

/**
 * Fence info-string grammar: a kind, then `key=value` pairs (value optionally
 * double-quoted), then bare flags.
 *
 *     chart columns id=throughput
 *     ts file=src/upload.ts lines title="The upload path" range=12-40
 *
 * `words` holds the bare words after the kind: a chart's sub-kind, then flags.
 *
 * @param {string} info
 * @returns {{ raw: string, kind: string, words: string[], attrs: Record<string, string>, flags: string[] }}
 */
export function parseInfo(info) {
  const raw = String(info ?? "").trim();
  /** @type {string[]} */
  const bare = [];
  /** @type {Record<string, string>} */
  const attrs = {};

  const token = /([A-Za-z0-9_.\/-]+)=(?:"([^"]*)"|'([^']*)'|(\S*))|(\S+)/g;
  let m;
  while ((m = token.exec(raw)) !== null) {
    if (m[5] !== undefined) bare.push(m[5]);
    else attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  const kind = bare.shift() ?? "";
  return { raw, kind, words: bare, attrs, flags: bare };
}

/* ------------------------------------------------------------------ marked setup */

/**
 * Build a Marked instance wired to one parse. The footnote registry lives in the
 * closure because numbering depends on reference order across the whole document.
 *
 * @param {{ footnoteOrder: string[] }} state
 */
function buildMarked(state) {
  const md = new Marked({ gfm: true, breaks: false });

  /** Index of a footnote label, 1-based, assigned on first reference. */
  const fnIndex = (label) => {
    let i = state.footnoteOrder.indexOf(label);
    if (i === -1) i = state.footnoteOrder.push(label) - 1;
    return i + 1;
  };

  md.use({
    extensions: [
      {
        name: "container",
        level: "block",
        start: (src) => src.match(/^:::/m)?.index,
        tokenizer(src) {
          const m = /^::: *([a-z][a-z-]*) *\r?\n([\s\S]*?)(?:\r?\n)?::: *(?:\r?\n|$)/.exec(src);
          if (!m) return undefined;
          return { type: "container", raw: m[0], kind: m[1], body: m[2] };
        },
        renderer(token) {
          return `<div class="${escapeHtml(token.kind)}">\n${md.parse(token.body)}</div>\n`;
        },
      },
      {
        name: "alert",
        level: "block",
        start: (src) => src.match(/^> *\[!/m)?.index,
        tokenizer(src) {
          const m = /^> *\[!([A-Za-z]+)\][ \t]*([^\r\n]*)(?:\r?\n((?:>[^\r\n]*(?:\r?\n|$))*))?/.exec(src);
          if (!m) return undefined;
          const body = (m[3] ?? "").replace(/^> ?/gm, "").trimEnd();
          return { type: "alert", raw: m[0], tone: m[1].toLowerCase(), title: m[2].trim(), body };
        },
        renderer(token) {
          const tone = ALERT_TONES[token.tone] ?? "note";
          const cls = tone === "note" ? "note" : `note ${tone}`;
          const tag = token.title || tone[0].toUpperCase() + tone.slice(1);
          return `<div class="${cls}"><span class="tag">${escapeHtml(tag)}</span>\n${md.parse(token.body)}</div>\n`;
        },
      },
      {
        name: "mathBlock",
        level: "block",
        start: (src) => src.match(/\$\$/)?.index,
        tokenizer(src) {
          const m = /^\$\$[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*\$\$[ \t]*(?:\r?\n|$)/.exec(src);
          if (!m) return undefined;
          return { type: "mathBlock", raw: m[0], tex: m[1].trim() };
        },
        renderer(token) {
          return `<div class="math-block" data-tex="${escapeHtml(token.tex)}"></div>\n`;
        },
      },
      {
        name: "footnoteDef",
        level: "block",
        start: (src) => src.match(/^\[\^/m)?.index,
        tokenizer(src) {
          const m = /^\[\^([^\]\r\n]+)\]:[ \t]*([^\r\n]*)(?:\r?\n|$)/.exec(src);
          if (!m) return undefined;
          return { type: "footnoteDef", raw: m[0], label: m[1], body: m[2] };
        },
        // Definitions are lifted into the trailing footnotes block, never rendered in place.
        renderer: () => "",
      },
      {
        name: "footnoteRef",
        level: "inline",
        start: (src) => src.match(/\[\^/)?.index,
        tokenizer(src) {
          const m = /^\[\^([^\]\r\n]+)\](?!:)/.exec(src);
          if (!m) return undefined;
          return { type: "footnoteRef", raw: m[0], label: m[1] };
        },
        renderer(token) {
          const n = fnIndex(token.label);
          return `<sup class="fn"><a id="fnref-${n}" href="#fn-${n}">${n}</a></sup>`;
        },
      },
      {
        name: "mathInline",
        level: "inline",
        start: (src) => src.match(/\$/)?.index,
        tokenizer(src) {
          // `$` followed by a digit or a space is money or prose, not math.
          const m = /^\$(?![\s\d$])((?:\\.|[^$\\\r\n])+?)\$(?!\d)/.exec(src);
          if (!m) return undefined;
          return { type: "mathInline", raw: m[0], tex: m[1] };
        },
        renderer(token) {
          return `<span class="math-inline" data-tex="${escapeHtml(token.tex)}"></span>`;
        },
      },
      inlineWrap("highlight", /^==(?!=)([\s\S]+?)==/, "==", (inner) => `<mark>${inner}</mark>`),
      inlineWrap("underline", /^\+\+(?!\+)([\s\S]+?)\+\+/, "++", (inner) => `<u>${inner}</u>`),
      inlineWrap("sup", /^\^(?!\^)([^\^\s][^\^\r\n]*?)\^/, "^", (inner) => `<sup>${inner}</sup>`),
      // `~~` stays with GFM strikethrough; only a single tilde is a subscript.
      inlineWrap("sub", /^~(?!~)([^~\s][^~\r\n]*?)~(?!~)/, "~", (inner) => `<sub>${inner}</sub>`),
    ],
    // Token mutation happens in the renderers rather than in walkTokens: the parser is
    // driven token-by-token from parseMarkdown, a path marked's walk hook does not run on.
    renderer: {
      // Raw HTML in prose is inert; only an `html` fence passes through.
      html: (token) => escapeHtml(token.text ?? token.raw),
      image(token) {
        if (token.title === "zoom") token.zoom = true;
        const alt = token.tokens ? this.parser.parseInline(token.tokens, this.parser.textRenderer) : token.text;
        const zoom = token.zoom ? ' data-zoom="1"' : "";
        const title = token.title && !token.zoom ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${escapeHtml(token.href)}" alt="${escapeHtml(alt)}"${title}${zoom}>`;
      },
      tablecell(token) {
        applyCellTone(token);
        const tag = token.header ? "th" : "td";
        const cls = [];
        if (token.align === "right") cls.push("num");
        else if (token.align === "center") cls.push("center");
        if (token.tone) cls.push(`t-${token.tone}`);
        const attr = cls.length ? ` class="${cls.join(" ")}"` : "";
        return `<${tag}${attr}>${this.parser.parseInline(token.tokens)}</${tag}>\n`;
      },
      list(token) {
        const tasks = token.items.some((it) => it.task);
        const tag = token.ordered ? "ol" : "ul";
        const start = token.ordered && token.start !== 1 && token.start !== "" ? ` start="${token.start}"` : "";
        const cls = tasks ? ' class="tasks"' : "";
        let out = "";
        for (const item of token.items) out += this.listitem(item);
        return `<${tag}${start}${cls}>\n${out}</${tag}>\n`;
      },
      listitem(token) {
        if (!token.task) return `<li>${this.parser.parse(token.tokens)}</li>\n`;
        const body = this.parser.parse(token.tokens.filter((t) => t.type !== "checkbox"), !!token.loose);
        return `<li${token.checked ? ' class="done"' : ""}><span class="box"></span><span>${body}</span></li>\n`;
      },
      checkbox: () => "",
    },
  });

  return md;
}

/** @type {Marked | null} */
let fragments = null;

/**
 * One run of inline Markdown outside the document flow, such as a question's
 * prompt or an option, with the same marks and the same escaping of raw HTML as
 * prose. Inline math comes back as the placeholder `renderInlineMath` fills.
 *
 * @param {string} text
 * @returns {string}
 */
export function inlineMarkdown(text) {
  fragments ??= buildMarked({ footnoteOrder: [] });
  return /** @type {string} */ (fragments.parseInline(String(text))).trim();
}

/** A symmetric inline mark (`==x==`) that wraps its parsed content. */
function inlineWrap(name, re, marker, wrap) {
  return {
    name,
    level: /** @type {const} */ ("inline"),
    start: (src) => src.indexOf(marker) >= 0 ? src.indexOf(marker) : undefined,
    tokenizer(src) {
      const m = re.exec(src);
      if (!m) return undefined;
      return { type: name, raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
    },
    renderer(token) {
      return wrap(this.parser.parseInline(token.tokens));
    },
  };
}

/** Strip a `good:` / `warn:` / `bad:` / `flat:` prefix off a table cell onto `cell.tone`. */
function applyCellTone(cell) {
  const m = /^(good|warn|bad|flat):[ \t]*/.exec(cell.text);
  if (!m) return;
  cell.tone = CELL_TONES[m[1]];
  cell.text = cell.text.slice(m[0].length);
  const first = cell.tokens?.[0];
  if (first && typeof first.text === "string" && first.text.startsWith(m[0])) {
    first.text = first.text.slice(m[0].length);
    first.raw = first.raw.slice(m[0].length);
  }
}

/* ------------------------------------------------------------------ main parse */

/**
 * Parse a Markdown document into the block IR.
 *
 * @param {string} text
 * @param {{ file?: string }} [opts]
 * @returns {ParseResult}
 */
export function parseMarkdown(text, opts = {}) {
  const file = opts.file ?? "<input>";
  /** @type {RenderError[]} */
  const errors = [];
  const src = String(text).replace(/\r\n/g, "\n");

  const fm = splitFrontmatter(src);
  for (const e of fm.errors) errors.push({ file, line: e.line, block: "frontmatter", message: e.message });

  /** @type {Meta} */
  const meta = { title: "" };
  for (const [k, v] of Object.entries(fm.meta)) {
    if (KNOWN_META.has(k)) meta[k] = v;
    else errors.push({ file, line: fm.lines[k] ?? 1, block: "frontmatter", message: `unknown frontmatter key "${k}"; keys: ${META_KEYS.join(" ")}` });
  }

  const state = { footnoteOrder: /** @type {string[]} */ ([]) };
  const md = buildMarked(state);
  // The block-level API renders a run of inline tokens only from inside a
  // renderer; a parser built from the same options does it from out here.
  const inline = new md.Parser(md.defaults);
  const tokens = md.lexer(fm.body);

  /** @type {Block[]} */
  const blocks = [];
  /** @type {Record<string, number>} */
  const counters = {};
  /** @type {Map<string, string>} */
  const footnoteBodies = new Map();
  /** @type {object[]} */
  let group = [];
  let groupLine = 0;
  let titleTaken = false;
  let leadTaken = false;

  const nextId = (type, explicit) => {
    if (explicit) return explicit;
    counters[type] = (counters[type] ?? 0) + 1;
    return `${type}-${counters[type]}`;
  };

  const flush = () => {
    if (!group.length) return;
    const html = md.parser(group).trim();
    group = [];
    if (html) blocks.push({ id: nextId("markdown"), type: "markdown", line: groupLine, html });
  };

  let offset = 0;
  for (const token of tokens) {
    const line = fm.bodyLine + countLines(fm.body.slice(0, offset));
    offset += token.raw.length;

    if (token.type === "space") continue;

    if (token.type === "footnoteDef") {
      footnoteBodies.set(token.label, md.parseInline(token.body).trim());
      continue;
    }

    if (token.type === "heading") {
      // The first h1 titles the document; the shell renders it, so it is not a block.
      // A heading carries inline marks like any other prose: `html` is what the
      // document shows, `text` is the same run with its tags dropped, which is
      // what the contents strip and the slug are built from.
      const html = (token.tokens ? inline.parseInline(token.tokens) : escapeHtml(token.text)).trim();
      const text = textOf(html);
      if (token.depth === 1 && !titleTaken) {
        titleTaken = true;
        flush();
        if (!meta.title) meta.title = text;
        continue;
      }
      flush();
      leadTaken = true;
      blocks.push({
        id: nextId("heading"), type: "heading", line,
        level: /** @type {1|2|3|4|5|6} */ (token.depth), text, html, slug: slugify(text),
      });
      continue;
    }

    if (token.type === "container") {
      flush();
      leadTaken = true;
      // An unknown `::: kind` still becomes a container block; WP2 names it in the error.
      blocks.push({
        id: nextId("container"), type: "container", line,
        kind: /** @type {import("./ir.js").ContainerKind} */ (token.kind),
        html: md.parse(token.body).trim(),
      });
      continue;
    }

    if (token.type === "alert") {
      flush();
      leadTaken = true;
      const tone = ALERT_TONES[token.tone] ?? "note";
      if (!ALERT_TONES[token.tone]) {
        errors.push({ file, line, block: "callout", message: `unknown alert tone "${token.tone}"; tones: note good warn critical` });
      }
      blocks.push({
        id: nextId("callout"), type: "callout", line,
        tone: /** @type {import("./ir.js").CalloutTone} */ (tone),
        title: token.title || tone[0].toUpperCase() + tone.slice(1),
        html: md.parse(token.body).trim(),
      });
      continue;
    }

    if (token.type === "mathBlock") {
      flush();
      leadTaken = true;
      blocks.push({ id: nextId("math"), type: "math", line, tex: token.tex });
      continue;
    }

    if (token.type === "code") {
      flush();
      leadTaken = true;
      blocks.push(...fenceBlock(token, line, file, errors, nextId));
      continue;
    }

    // Everything else is prose. The first paragraph is the lead and stands alone.
    if (!leadTaken && token.type === "paragraph") {
      leadTaken = true;
      flush();
      const html = md.parser([token]).trim();
      blocks.push({ id: nextId("markdown"), type: "markdown", line, html, lead: true });
      continue;
    }
    leadTaken = true;
    if (!group.length) groupLine = line;
    group.push(token);
  }
  flush();

  if (state.footnoteOrder.length) {
    /** @type {Footnote[]} */
    const items = state.footnoteOrder.map((label) => {
      if (!footnoteBodies.has(label)) {
        errors.push({ file, line: 1, block: "footnotes", message: `footnote [^${label}] is referenced but never defined` });
      }
      return { label, html: footnoteBodies.get(label) ?? "" };
    });
    blocks.push({ id: nextId("footnotes"), type: "footnotes", line: countLines(src) + 1, items });
  }

  if (!meta.title) errors.push({ file, line: 1, block: "frontmatter", message: "no title: add a frontmatter title or an opening # heading" });

  return { doc: { version: 1, meta, blocks }, errors };
}

/**
 * Route one fence to its block by info string. Unknown kinds stay `code`, with the
 * raw info string kept so WP2 can reject `chart pie` by name.
 *
 * @param {{ lang: string, text: string }} token
 * @param {number} line
 * @param {string} file
 * @param {RenderError[]} errors
 * @param {(type: string, explicit?: string) => string} nextId
 * @returns {Block[]}
 */
function fenceBlock(token, line, file, errors, nextId) {
  const info = parseInfo(token.lang ?? "");
  const source = token.text ?? "";
  const id = info.attrs.id;
  const kind = info.kind;

  if (kind === "html") {
    return [{ id: nextId("html", id), type: "html", line, info: info.raw, html: source }];
  }
  if (kind === "math") {
    return [{ id: nextId("math", id), type: "math", line, tex: source.trim() }];
  }
  if (kind === "diff") {
    /** @type {import("./ir.js").DiffBlock} */
    const block = { id: nextId("diff", id), type: "diff", line, info: info.raw, source };
    const path = info.attrs.file || info.attrs.path;
    if (path) block.file = path;
    if (info.attrs.title) block.title = info.attrs.title;
    return [block];
  }
  if (DATA_FENCE_SET.has(kind)) {
    const label = kind === "chart" ? `chart ${info.words[0] ?? ""}`.trim() : kind;
    const { data, broken } = parseJsonBody(source, line, file, label, errors);
    // `broken` separates "the JSON did not parse" (already reported, so the
    // schema stays quiet) from an authored literal `null`, which it should flag.
    const flag = broken ? { broken: true } : {};
    if (kind === "chart") {
      return [{ id: nextId("chart", id), type: "chart", line, kind: info.words[0] ?? "", info: info.raw, data, ...flag }];
    }
    return [{ id: nextId(kind, id), type: /** @type {"stats"} */ (kind), line, info: info.raw, data, ...flag }];
  }

  /** @type {import("./ir.js").CodeBlock} */
  const block = { id: nextId("code", id), type: "code", line, lang: kind, info: info.raw, source };
  // `path=` is an alias for `file=`; `range=12-40` numbers from 12 and labels the path.
  const path = info.attrs.file || info.attrs.path;
  if (path) block.file = path;
  if (info.attrs.title) block.title = info.attrs.title;
  if (info.attrs.range) block.range = info.attrs.range;
  if (info.flags.includes("lines")) block.lines = true;
  return [block];
}

/**
 * JSON body of a data fence. On failure the error is reported at the source line
 * the JSON position maps to, not at the fence, so the message points at the byte.
 *
 * @returns {{ data: unknown, broken: boolean }} `broken` marks a body that did
 *   not parse, so the schema can skip it without also excusing a literal `null`.
 */
function parseJsonBody(source, fenceLine, file, block, errors) {
  try {
    return { data: JSON.parse(source), broken: false };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const inner = countLines(source.slice(0, jsonErrorOffset(raw, source)));
    errors.push({ file, line: fenceLine + 1 + inner, block, message: raw.replace(/\s+/g, " ") });
    return { data: null, broken: true };
  }
}

/**
 * Character offset of a JSON syntax error inside the body. V8 reports `position N`
 * for most errors but falls back to quoting a window of the source for others, so
 * the window is located in the body and the offending token found inside it.
 *
 * @param {string} message
 * @param {string} source
 * @returns {number}
 */
function jsonErrorOffset(message, source) {
  const at = /position (\d+)/.exec(message);
  if (at) return Number(at[1]);

  const window = /(?:\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/.exec(message);
  if (!window) return 0;
  const start = source.indexOf(window[1]);
  if (start < 0) return 0;
  const token = /Unexpected token '(.)'/.exec(message);
  const within = token ? window[1].indexOf(token[1]) : -1;
  return start + (within < 0 ? 0 : within);
}

/* ------------------------------------------------------------------ JSON input */

/**
 * Accept an already-built IR (`postplan render blocks.json`) and normalise its
 * top-level shape. Per-block bodies are WP2's to validate; this only guarantees
 * the walk in the renderer cannot trip over a missing `blocks` array.
 *
 * @param {unknown} json
 * @param {{ file?: string }} [opts]
 * @returns {ParseResult}
 */
export function parseIr(json, opts = {}) {
  const file = opts.file ?? "<input>";
  /** @type {RenderError[]} */
  const errors = [];
  const bad = (message, line = 1, block = "document") => errors.push({ file, line, block, message });

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    bad("IR must be an object { version, meta, blocks }");
    return { doc: emptyDoc(), errors };
  }
  const input = /** @type {Record<string, unknown>} */ (json);

  if (input.version !== 1) bad(`unsupported IR version ${JSON.stringify(input.version)}; expected 1`);

  /** @type {Meta} */
  const meta = { title: "" };
  const rawMeta = typeof input.meta === "object" && input.meta !== null ? /** @type {Record<string, unknown>} */ (input.meta) : null;
  if (!rawMeta) bad("meta must be an object with a title");
  else {
    for (const key of META_KEYS) {
      const v = rawMeta[key];
      if (v === undefined) continue;
      if (typeof v !== "string") bad(`meta.${key} must be a string`);
      else meta[key] = v;
    }
    if (!meta.title) bad("meta.title is required");
  }

  /** @type {Block[]} */
  const blocks = [];
  if (!Array.isArray(input.blocks)) {
    bad("blocks must be an array");
    return { doc: { version: 1, meta, blocks }, errors };
  }

  const seen = new Set();
  input.blocks.forEach((raw, i) => {
    const at = `blocks/${i}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad(`${at} must be an object`);
    const b = /** @type {Record<string, unknown>} */ (raw);
    if (typeof b.type !== "string" || !BLOCK_TYPES.includes(/** @type {never} */ (b.type))) {
      return bad(`${at}/type: unknown block type ${JSON.stringify(b.type)}`);
    }
    if (b.id !== undefined && typeof b.id !== "string") return bad(`${at}/id must be a string`);
    const id = typeof b.id === "string" && b.id ? b.id : `${b.type}-${i + 1}`;
    if (seen.has(id)) bad(`${at}/id: duplicate block id "${id}"`);
    seen.add(id);
    const line = Number.isInteger(b.line) ? /** @type {number} */ (b.line) : i + 1;
    blocks.push(/** @type {Block} */ ({ ...b, id, line }));
  });

  return { doc: { version: 1, meta, blocks }, errors };
}
