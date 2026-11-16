import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseMarkdown, parseIr, parseInfo, splitFrontmatter, slugify, render } from "../src/render/index.js";

const GALLERY = fileURLToPath(new URL("../examples/gallery.md", import.meta.url));

/** Parse a snippet and fail loudly on unexpected diagnostics. */
const clean = (md) => {
  const r = parseMarkdown(md, { file: "t.md" });
  assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
  return r.doc;
};
const html = (md) => clean(md).blocks.map((b) => b.html ?? "").join("\n");
const only = (md, type) => {
  const b = clean(md).blocks.find((x) => x.type === type);
  assert.ok(b, `no ${type} block in:\n${md}`);
  return b;
};

const TITLED = (body) => `---\ntitle: T\n---\n\n${body}\n`;

test("frontmatter splits on the first colon, strings only", () => {
  const { meta, body, bodyLine, errors } = splitFrontmatter(
    "---\ntitle: Q3: warehouse plan\nbyline: Aryan Saini\ndate: 2026-09-22\n---\n\nLead.\n",
  );
  assert.deepEqual(meta, { title: "Q3: warehouse plan", byline: "Aryan Saini", date: "2026-09-22" });
  assert.equal(body, "\nLead.\n");
  assert.equal(bodyLine, 6);
  assert.deepEqual(errors, []);
});

test("frontmatter reports a line with no colon", () => {
  const { errors } = splitFrontmatter("---\ntitle: T\nnot a pair\n---\n");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 3);
});

test("no frontmatter leaves the body untouched", () => {
  const { meta, body, bodyLine } = splitFrontmatter("# Title\n\nLead.\n");
  assert.deepEqual(meta, {});
  assert.equal(body, "# Title\n\nLead.\n");
  assert.equal(bodyLine, 1);
});

test("unknown frontmatter keys are an error, not a silent drop", () => {
  const { doc, errors } = parseMarkdown("---\ntitle: T\ncolour: red\n---\n\nLead.\n", { file: "t.md" });
  assert.equal(doc.meta.title, "T");
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /unknown frontmatter key "colour"/);
  // The complaint points at the key, not at the top of the file.
  assert.equal(errors[0].line, 3);
});

test("the first h1 becomes the title when frontmatter has none", () => {
  const doc = clean("# Q3 warehouse plan\n\nThe lead.\n");
  assert.equal(doc.meta.title, "Q3 warehouse plan");
  assert.equal(doc.blocks.filter((b) => b.type === "heading").length, 0);
});

test("the first paragraph after the title is the lead", () => {
  const doc = clean("# T\n\nThe lead.\n\nNot the lead.\n");
  assert.equal(doc.blocks[0].lead, true);
  assert.equal(doc.blocks[1].lead, undefined);
});

test("headings are emitted separately with a slug", () => {
  const b = only(TITLED("## Stage latency, p95"), "heading");
  assert.equal(b.level, 2);
  assert.equal(b.text, "Stage latency, p95");
  assert.equal(b.slug, "stage-latency-p95");
  assert.equal(slugify("  Two   Words! "), "two-words");
});

test("a heading renders its inline marks and slugs the text under them", () => {
  const b = only(TITLED("## The `upload` path is **fast**"), "heading");
  assert.equal(b.html, "The <code>upload</code> path is <strong>fast</strong>");
  assert.equal(b.text, "The upload path is fast");
  assert.equal(b.slug, "the-upload-path-is-fast");

  // The same run titles the document when the h1 is the only title there is.
  assert.equal(clean("# The `upload` path\n\nLead.\n").meta.title, "The upload path");
});

test("fence info-string grammar: kind, key=value, quoted values, bare flags", () => {
  assert.deepEqual(parseInfo('ts file=src/upload.ts lines title="The upload path"'), {
    raw: 'ts file=src/upload.ts lines title="The upload path"',
    kind: "ts",
    words: ["lines"],
    flags: ["lines"],
    attrs: { file: "src/upload.ts", title: "The upload path" },
  });
  assert.equal(parseInfo("chart columns id=thr").kind, "chart");
  assert.deepEqual(parseInfo("chart columns id=thr").words, ["columns"]);
  assert.deepEqual(parseInfo("").kind, "");
});

test("code fences carry lang, file, title and the lines flag", () => {
  const b = only(TITLED('```ts file=src/upload.ts lines title="Upload"\nconst x = 1;\n```'), "code");
  assert.equal(b.lang, "ts");
  assert.equal(b.file, "src/upload.ts");
  assert.equal(b.title, "Upload");
  assert.equal(b.lines, true);
  assert.equal(b.source, "const x = 1;");
});

test("an explicit id= wins, otherwise ids are type-N", () => {
  const doc = clean(TITLED("```js\na\n```\n\n```js id=second\nb\n```\n\n```js\nc\n```"));
  assert.deepEqual(doc.blocks.filter((b) => b.type === "code").map((b) => b.id), ["code-1", "second", "code-2"]);
});

test("an unknown fence kind is still a code block, with the raw info kept for WP2", () => {
  const b = only(TITLED("```chart pie\n{}\n```"), "chart");
  assert.equal(b.kind, "pie");
  assert.equal(b.info, "chart pie");
});

test("data fences parse their JSON body", () => {
  const b = only(TITLED('```chart columns\n{"labels":["a"],"values":[1]}\n```'), "chart");
  assert.deepEqual(b.data, { labels: ["a"], values: [1] });
});

test("malformed fence JSON maps its position back to a source line", () => {
  const src = "---\ntitle: T\n---\n\nLead.\n\n```chart columns\n{\n  \"labels\": [\"a\"],\n  \"values\": [1,]\n}\n```\n";
  const { errors, doc } = parseMarkdown(src, { file: "plan.md" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].file, "plan.md");
  assert.equal(errors[0].block, "chart columns");
  assert.equal(errors[0].line, 10); // the `"values": [1,]` line, not the fence
  assert.equal(doc.blocks.find((b) => b.type === "chart").data, null);
});

test("a fence body that is not JSON at all reports the opening line", () => {
  const { errors } = parseMarkdown(TITLED("```stats\nnope\n```"), { file: "t.md" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].block, "stats");
  assert.equal(errors[0].line, 6);
});

test("diff, html and math fences route to their own blocks", () => {
  assert.equal(only(TITLED('```diff title="Add a CSP"\n-a\n+b\n```'), "diff").title, "Add a CSP");
  assert.equal(only(TITLED("```html\n<div class=\"mocks\"></div>\n```"), "html").html, '<div class="mocks"></div>');
  assert.equal(only(TITLED("```math\n\\frac{a}{b}\n```"), "math").tex, "\\frac{a}{b}");
  assert.equal(only(TITLED("$$\nE = \\hbar\\omega\n$$"), "math").tex, "E = \\hbar\\omega");
});

test(":::containers become their own blocks with rendered markdown inside", () => {
  const doc = clean(TITLED("::: center\nA **centred** line.\n:::\n\n::: columns\nOne.\n\nTwo.\n:::"));
  const [a, b] = doc.blocks.filter((x) => x.type === "container");
  assert.equal(a.kind, "center");
  assert.equal(a.html, "<p>A <strong>centred</strong> line.</p>");
  assert.equal(b.kind, "columns");
  assert.equal(b.html.match(/<p>/g).length, 2);
});

test("GitHub alerts become callouts, aliases included", () => {
  const doc = clean(TITLED("> [!warn] Risk\n> Presigns expire.\n\n> [!caution] Blocked\n> The README lies.\n\n> [!tip] Shipped\n> Done.\n\n> [!note]\n> Bare."));
  assert.deepEqual(
    doc.blocks.filter((b) => b.type === "callout").map((b) => [b.tone, b.title]),
    [["warn", "Risk"], ["critical", "Blocked"], ["good", "Shipped"], ["note", "Note"]],
  );
  assert.equal(doc.blocks.find((b) => b.type === "callout").html, "<p>Presigns expire.</p>");
});

test("an unknown alert tone falls back to note and reports", () => {
  const { doc, errors } = parseMarkdown(TITLED("> [!spicy] Hm\n> Body."), { file: "t.md" });
  assert.equal(doc.blocks.find((b) => b.type === "callout").tone, "note");
  assert.match(errors[0].message, /unknown alert tone "spicy"/);
});

test("a plain blockquote stays prose", () => {
  assert.match(html(TITLED("> Just a quote.")), /<blockquote>/);
});

test("table alignment survives and a tone prefix becomes a class", () => {
  const out = html(TITLED("| Stage | p50 | Note |\n|:---|---:|:---:|\n| Validate | good:18 | bad:slow |"));
  assert.match(out, /<th class="num">p50<\/th>/);
  assert.match(out, /<th class="center">Note<\/th>/);
  assert.match(out, /<td class="num t-good">18<\/td>/);
  assert.match(out, /<td class="center t-bad">slow<\/td>/);
  assert.doesNotMatch(out, /good:/);
});

test("task lists render as boxes, plain lists do not", () => {
  const out = html(TITLED("- [ ] An open task\n- [x] A finished task"));
  assert.match(out, /<ul class="tasks">/);
  assert.match(out, /<li><span class="box"><\/span><span>An open task<\/span><\/li>/);
  assert.match(out, /<li class="done"><span class="box"><\/span><span>A finished task<\/span><\/li>/);
  assert.doesNotMatch(html(TITLED("- plain\n- list")), /class="tasks"/);
});

test("inline extensions: highlight, underline, sub, sup, strike, code", () => {
  const out = html(TITLED("==h== ++u== ~~s~~ H~2~O r^2^ `c`".replace("++u==", "++u++")));
  assert.match(out, /<mark>h<\/mark>/);
  assert.match(out, /<u>u<\/u>/);
  assert.match(out, /<del>s<\/del>/);
  assert.match(out, /H<sub>2<\/sub>O/);
  assert.match(out, /r<sup>2<\/sup>/);
  assert.match(out, /<code>c<\/code>/);
});

test("inline math is escaped into data-tex, money is left alone", () => {
  const out = html(TITLED("Half-life $t_{1/2} = \\frac{\\ln 2}{\\lambda}$ costs $412k a month."));
  assert.match(out, /<span class="math-inline" data-tex="t_\{1\/2\} = \\frac\{\\ln 2\}\{\\lambda\}"><\/span>/);
  assert.match(out, /\$412k a month/);
});

test("inline math escapes angle brackets in the TeX", () => {
  assert.match(html(TITLED("$a < b$")), /data-tex="a &lt; b"/);
});

test("footnotes are numbered by reference order and collected at the end", () => {
  const doc = clean(TITLED("First[^a] then second[^b].\n\n[^b]: Bee.\n[^a]: Ay."));
  const fn = doc.blocks.at(-1);
  assert.equal(fn.type, "footnotes");
  assert.deepEqual(fn.items, [{ label: "a", html: "Ay." }, { label: "b", html: "Bee." }]);
  assert.match(doc.blocks[0].html, /<sup class="fn"><a id="fnref-1" href="#fn-1">1<\/a><\/sup>/);
});

test("a referenced but undefined footnote is an error", () => {
  const { errors } = parseMarkdown(TITLED("Text[^x]."), { file: "t.md" });
  assert.match(errors[0].message, /\[\^x\] is referenced but never defined/);
});

test("an image titled zoom is flagged for the lightbox", () => {
  assert.match(html(TITLED('![Dash](https://x/d.png "zoom")')), /<img src="https:\/\/x\/d\.png" alt="Dash" data-zoom="1">/);
  assert.match(html(TITLED('![Dash](https://x/d.png "plain")')), /title="plain">/);
});

test("raw HTML in prose is escaped; only the html fence passes through", () => {
  assert.match(html(TITLED("A <b>bold</b> lie.")), /A &lt;b&gt;bold&lt;\/b&gt; lie\./);
  assert.match(html(TITLED("<script>alert(1)</script>")), /&lt;script&gt;/);
});

test("block lines are 1-based and point at the opening fence", () => {
  const doc = clean("---\ntitle: T\n---\n\nLead.\n\n## Head\n\n```js\nx\n```\n");
  assert.deepEqual(doc.blocks.map((b) => [b.type, b.line]), [["markdown", 5], ["heading", 7], ["code", 9]]);
});

test("a document with no title reports it", () => {
  const { errors } = parseMarkdown("Just prose.\n", { file: "t.md" });
  assert.match(errors[0].message, /no title/);
});

test("parseIr accepts a built IR and fills ids and lines", () => {
  const { doc, errors } = parseIr({
    version: 1,
    meta: { title: "T", byline: "A" },
    blocks: [{ type: "markdown", html: "<p>x</p>" }, { type: "chart", kind: "columns", id: "c", data: {} }],
  }, { file: "blocks.json" });
  assert.deepEqual(errors, []);
  assert.deepEqual(doc.meta, { title: "T", byline: "A" });
  assert.deepEqual(doc.blocks.map((b) => [b.id, b.line]), [["markdown-1", 1], ["c", 2]]);
});

test(":name[text] colours any inline run, headings and table cells included", () => {
  assert.match(html(TITLED("Costs :red[$412 a week] now.")), /<span style="color:var\(--c-red\)">\$412 a week<\/span>/);
  assert.match(html(TITLED("Brand :#3987E5[blue].")), /<span style="color:#3987e5">blue<\/span>/);
  assert.match(html(TITLED(":bg-amber[Needs sign-off]")), /<span class="hl" style="--hl:var\(--c-amber\)">Needs sign-off<\/span>/);
  assert.match(html(TITLED("Text :grey[aside].")), /color:var\(--c-gray\)/);

  // Inline Markdown nests inside, brackets included, and the mark nests inside bold.
  assert.match(html(TITLED(":green[**up** [18%](https://x.dev) `n`]")),
    /<span style="color:var\(--c-green\)"><strong>up<\/strong> <a href="https:\/\/x.dev">18%<\/a> <code>n<\/code><\/span>/);
  assert.match(html(TITLED("**:red[Do not merge]**")), /<strong><span style="color:var\(--c-red\)">Do not merge<\/span><\/strong>/);

  const h = only(TITLED("intro\n\n## :red[Fix first]"), "heading");
  assert.equal(h.html, '<span style="color:var(--c-red)">Fix first</span>');
  assert.equal(h.text, "Fix first");
  assert.equal(h.slug, "fix-first");

  assert.match(html(TITLED("| Bug | Cost |\n| - | - |\n| Payout | :amber[Medium] |")), /<td><span style="color:var\(--c-amber\)">Medium<\/span><\/td>/);
});

test("colour marks leave look-alike prose alone", () => {
  assert.doesNotMatch(html(TITLED("Note:red[1] and `:red[x]` and :red[unclosed")), /<span/);
});

test("an unknown colour is an error at its line that lists the colours", () => {
  const { errors } = parseMarkdown(TITLED("Fine.\n\nThis is :purpel[wrong]."), { file: "t.md" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 7);
  assert.match(errors[0].message, /^unknown colour ":purpel\[…\]"; colours: red orange .* white, or a hex like :#3987e5\[…\]$/);
});

test("::: name tints a whole block", () => {
  const src = TITLED("intro\n\n::: teal\nA whole block.\n:::");
  assert.equal(only(src, "container").kind, "teal");
  const { html: page, errors } = render(src, { file: "t.md" });
  assert.deepEqual(errors, []);
  assert.match(page ?? "", /<div class="tint" style="color:var\(--c-teal\)">\n<p>A whole block.<\/p>/);
});

test("parseIr rejects a bad shape without throwing", () => {
  assert.match(parseIr(null).errors[0].message, /must be an object/);
  assert.match(parseIr({ version: 2, meta: { title: "T" }, blocks: [] }).errors[0].message, /unsupported IR version 2/);
  assert.match(parseIr({ version: 1, meta: {}, blocks: [] }).errors[0].message, /meta\.title is required/);
  assert.match(parseIr({ version: 1, meta: { title: "T" } }).errors[0].message, /blocks must be an array/);
  assert.match(
    parseIr({ version: 1, meta: { title: "T" }, blocks: [{ type: "nope" }] }).errors[0].message,
    /unknown block type "nope"/,
  );
  assert.match(
    parseIr({ version: 1, meta: { title: "T" }, blocks: [{ type: "code", id: "a" }, { type: "code", id: "a" }] }).errors[0].message,
    /duplicate block id "a"/,
  );
});

test("render wires the pipeline end to end", () => {
  const out = render("# T\n\nLead.\n", { file: "t.md" });
  assert.deepEqual(out.errors, []);
  assert.match(out.html, /^<!doctype html>/);
  assert.match(out.html, /<title>T<\/title>/);
  assert.match(out.html, /<p class="lead">Lead\.<\/p>/);
});

test("examples/gallery.md parses clean", () => {
  const { doc, errors } = parseMarkdown(readFileSync(GALLERY, "utf8"), { file: "examples/gallery.md" });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.deepEqual(doc.meta, {
    title: "Postplan component gallery",
    byline: "Aryan Saini",
    date: "Sep 24, 2026",
    status: "Draft v3",
  });
  assert.equal(doc.blocks[0].lead, true);
});

test("examples/gallery.md block sequence is stable", () => {
  const { doc } = parseMarkdown(readFileSync(GALLERY, "utf8"), { file: "examples/gallery.md" });
  const seq = doc.blocks.map((b) => (b.type === "chart" ? `chart:${b.kind}` : b.type));
  assert.deepEqual(seq, [
    "markdown", "heading", "markdown", "heading", "markdown", "heading", "markdown",
    "html", "container", "container", "container", "container",
    "heading", "callout", "callout", "callout", "callout",
    "heading", "markdown", "hero", "markdown", "stats",
    "heading", "markdown", "container",
    "heading", "markdown",
    "chart:columns", "chart:lines", "chart:lines", "chart:bars", "chart:grouped", "chart:stacked",
    "chart:delta", "chart:whisker", "chart:heatmap",
    "heading", "markdown",
    "chart:waterfall", "chart:scatter", "chart:funnel", "chart:schedule",
    "chart:small-multiples", "chart:share",
    "heading", "markdown", "code", "code", "code", "code", "code", "code", "diff",
    "heading", "markdown", "html", "heading", "markdown", "slides", "heading", "markdown", "video",
    "heading", "markdown", "heading", "markdown", "heading", "markdown", "heading", "video",
    "heading", "slides", "heading", "markdown",
    "heading", "markdown", "file", "markdown", "file",
    "heading", "markdown", "flow", "sequence",
    "heading", "markdown", "math", "math",
    "heading", "timeline",
    "heading", "markdown", "html",
    "heading", "markdown", "footnotes",
  ]);
});

test("examples/gallery.md uses every block kind", () => {
  const { doc } = parseMarkdown(readFileSync(GALLERY, "utf8"), { file: "examples/gallery.md" });
  const kinds = new Set(doc.blocks.map((b) => b.type));
  for (const t of ["markdown", "heading", "callout", "container", "chart", "stats", "hero", "code",
    "diff", "flow", "sequence", "math", "timeline", "slides", "video", "file", "html", "footnotes"]) {
    assert.ok(kinds.has(t), `gallery.md is missing a ${t} block`);
  }
});
