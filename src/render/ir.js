/**
 * The Postplan block IR.
 *
 * A document is a flat list of blocks. The parser (parse.js) produces it from
 * Markdown; `postplan render blocks.json` accepts it directly, so the shape is
 * the contract between every work package. Data fences (`chart`, `stats`, …)
 * keep their body as `unknown`: WP2's validators are the only code allowed to
 * claim it has a shape.
 *
 * @module render/ir
 */

import { DIAGRAM_FENCES } from "./diagrams/names.js";

/**
 * One diagnostic. `line` is 1-based in the source file; `block` names the block
 * that produced it (`"chart lines"`, `"frontmatter"`, …).
 * @typedef {{ file: string, line: number, block: string, message: string }} RenderError
 */

/**
 * Frontmatter. `tab` overrides the `<title>` (the h1 is always `title`); `icon`
 * picks the favicon, validated against `FAVICONS` in shell.js.
 * @typedef {{ title: string, byline?: string, date?: string, status?: string, tab?: string, icon?: import("./shell.js").Icon }} Meta
 */

/** @typedef {"note"|"good"|"warn"|"critical"} CalloutTone */
/** @typedef {"center"|"right"|"subtext"|"columns"} ContainerKind */
/** @typedef {1|2|3|4|5|6} HeadingLevel */

/**
 * Fields every block carries. `line` is the 1-based source line the block
 * starts on; for a fence that is the line of the opening ``` . `broken` marks a
 * data fence whose JSON did not parse: the syntax error is already reported, so
 * validation skips its body rather than reporting the shape twice.
 * @typedef {{ id: string, line: number, broken?: true }} BlockBase
 */

/** Prose already rendered to inline HTML. `lead` marks the opening paragraph.
 * @typedef {BlockBase & { type: "markdown", html: string, lead?: true }} MarkdownBlock */

/** Emitted separately from prose so the contents strip can be built without re-parsing.
 * `html` is the heading with its inline marks rendered; `text` is the same run
 * as plain text, which is what `slug` and the contents strip use.
 * @typedef {BlockBase & { type: "heading", level: HeadingLevel, text: string, html?: string, slug: string }} HeadingBlock */

/** @typedef {BlockBase & { type: "callout", tone: CalloutTone, title: string, html: string }} CalloutBlock */

/** @typedef {BlockBase & { type: "container", kind: ContainerKind, html: string }} ContainerBlock */

/** `kind` is the second info word (`chart columns` -> `"columns"`); WP2 rejects unknown ones.
 * @typedef {BlockBase & { type: "chart", kind: string, info: string, data: unknown }} ChartBlock */

/** @typedef {BlockBase & { type: "stats", info: string, data: unknown }} StatsBlock */
/** @typedef {BlockBase & { type: "hero", info: string, data: unknown }} HeroBlock */
/** @typedef {BlockBase & { type: "flow", info: string, data: unknown }} FlowBlock */
/** @typedef {BlockBase & { type: "sequence", info: string, data: unknown }} SequenceBlock */
/** @typedef {BlockBase & { type: "timeline", info: string, data: unknown }} TimelineBlock */
/** One of the fences in `render/diagrams` (`tree`, `graph`, …); `type` is the fence name.
 * @typedef {BlockBase & { type: import("./diagrams/names.js").DIAGRAM_FENCES[number], info: string, data: unknown }} DiagramBlock */
/** @typedef {BlockBase & { type: "slides", info: string, data: unknown }} SlidesBlock */
/** @typedef {BlockBase & { type: "video", info: string, data: unknown }} VideoBlock */
/** One download or a list of them; see `validateFile`.
 * @typedef {BlockBase & { type: "file", info: string, data: unknown }} FileBlock */

/** One answerable question; see `validateQuestion` and `src/questions.js`.
 * @typedef {BlockBase & { type: "question", info: string, data: unknown }} QuestionBlock */

/** @typedef {BlockBase & { type: "code", lang: string, info: string, source: string, file?: string, title?: string, range?: string, lines?: true }} CodeBlock */

/** @typedef {BlockBase & { type: "diff", info: string, source: string, file?: string, title?: string }} DiffBlock */

/** Display LaTeX, from a `math` fence or `$$…$$`. WP4 converts `tex` to MathML.
 * @typedef {BlockBase & { type: "math", tex: string }} MathBlock */

/** Verbatim HTML from an `html` fence. The only escape hatch; policy-checked at assembly.
 * @typedef {BlockBase & { type: "html", info: string, html: string }} HtmlBlock */

/** @typedef {{ label: string, html: string }} Footnote */

/** Always last when present; `items` is in order of first reference.
 * @typedef {BlockBase & { type: "footnotes", items: Footnote[] }} FootnotesBlock */

/**
 * @typedef {MarkdownBlock | HeadingBlock | CalloutBlock | ContainerBlock | ChartBlock
 *   | StatsBlock | HeroBlock | FlowBlock | SequenceBlock | TimelineBlock | SlidesBlock
 *   | VideoBlock | FileBlock | QuestionBlock | CodeBlock | DiffBlock | MathBlock | HtmlBlock | FootnotesBlock | DiagramBlock} Block
 */

/** @typedef {{ version: 1, meta: Meta, blocks: Block[] }} Doc */

/** @typedef {{ doc: Doc, errors: RenderError[] }} ParseResult */

/** Block `type` values the IR accepts. */
export const BLOCK_TYPES = /** @type {const} */ ([
  "markdown", "heading", "callout", "container", "chart", "stats", "hero",
  "code", "diff", "flow", "sequence", "math", "timeline", "slides", "video",
  "file", "question", "html", "footnotes", ...DIAGRAM_FENCES,
]);

/** Fence kinds that carry a JSON body rather than source text. */
export const DATA_FENCES = /** @type {const} */ ([
  "chart", "stats", "hero", "flow", "sequence", "timeline", "slides", "video", "file", "question", ...DIAGRAM_FENCES,
]);

/** Callout tones, plus the GitHub alert names that map onto them. */
export const ALERT_TONES = {
  note: "note", info: "note", important: "note",
  good: "good", tip: "good", success: "good",
  warn: "warn", warning: "warn",
  critical: "critical", caution: "critical", danger: "critical",
};

/** `::: kind` values the renderer understands. */
export const CONTAINER_KINDS = /** @type {const} */ (["center", "right", "subtext", "columns"]);

/** An empty document, so callers always get a `Doc` back even on a fatal parse. */
export function emptyDoc() {
  return /** @type {Doc} */ ({ version: 1, meta: { title: "" }, blocks: [] });
}
