import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { byline, contents, render, renderBlock, renderBody, GENERATOR } from "../src/render/index.js";
import { parseMarkdown } from "../src/render/parse.js";
import { CSS, FAVICON_BLACK, FAVICON_INDIGO } from "../src/render/shell.js";

const GALLERY = fileURLToPath(new URL("../examples/gallery.md", import.meta.url));

/** Render a snippet to its document body and fail loudly on any diagnostic. */
const body = (md) => {
  const source = /^---/.test(md) ? md : `---\ntitle: T\n---\n\n${md}\n`;
  const { doc, errors } = parseMarkdown(source, { file: "t.md" });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  return renderBody(doc);
};

/* ------------------------------------------------------------------ shell */

test("the byline is a date pill with a calendar glyph, an author and a status dot", () => {
  const html = byline({ title: "T", date: "Sep 22, 2026", byline: "Aryan Saini", status: "Draft v3" });
  assert.match(html, /<div class="byline">/);
  assert.match(html, /<svg viewBox="0 0 16 16"[\s\S]*?<\/svg>Sep 22, 2026<\/span>/);
  assert.match(html, /<span class="chip">@Aryan Saini<\/span>/);
  assert.match(html, /<span class="chip good"><span class="dot"><\/span>Draft v3<\/span>/);
  assert.equal((html.match(/class="sep"/g) ?? []).length, 2);

  // The dot takes its colour from the words, so a blocked document reads as blocked.
  assert.match(byline({ title: "T", status: "Blocked on review" }), /class="chip critical"/);
  assert.match(byline({ title: "T", status: "At risk" }), /class="chip warn"/);
  assert.equal(byline({ title: "T" }), "");
});

test("the contents strip is built from the h2 blocks, and needs at least two", () => {
  const { doc } = parseMarkdown("# T\n\n## First one\n\ntext\n\n### Deeper\n\n## Second one\n", { file: "t.md" });
  assert.equal(
    contents(doc.blocks),
    '<div class="contents"><a href="#first-one">First one</a><a href="#second-one">Second one</a></div>',
  );
  const { doc: one } = parseMarkdown("# T\n\n## Only one\n\ntext\n", { file: "t.md" });
  assert.equal(contents(one.blocks), "");
});

test("the generator is stamped into the head", () => {
  const { html } = render("# T\n\nLead.\n", { file: "t.md" });
  assert.match(html, /<meta name="generator" content="postplan-render \d+\.\d+\.\d+">/);
  assert.match(GENERATOR, /^postplan-render /);
});

/** The favicon `<link>` in a rendered page, decoded back to its SVG source. */
const favicon = (html) => {
  const m = html.match(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml;base64,([^"]+)">/);
  assert.ok(m, "favicon link present");
  return Buffer.from(m[1], "base64").toString("utf8");
};

test("every document embeds the favicon, true black unless icon: indigo", () => {
  const plain = render("# T\n\nLead.\n", { file: "t.md" });
  assert.deepEqual(plain.errors, []);
  assert.ok(favicon(plain.html).startsWith("<svg"));
  assert.equal(favicon(plain.html), FAVICON_BLACK);

  const indigo = render("---\ntitle: T\nicon: indigo\n---\n\nLead.\n", { file: "t.md" });
  assert.equal(favicon(indigo.html), FAVICON_INDIGO);
  const black = render("---\ntitle: T\nicon: black\n---\n\nLead.\n", { file: "t.md" });
  assert.equal(favicon(black.html), FAVICON_BLACK);
});

test("an icon outside the enum is an error that names the enum", () => {
  const { html, errors } = render("---\ntitle: T\nicon: red\n---\n\nLead.\n", { file: "t.md" });
  assert.equal(html, null);
  assert.deepEqual(errors.map((e) => e.message), ['icon: expected one of black indigo, got "red"']);
});

test("tab sets the <title> on its own; title still sets the h1", () => {
  const { html, errors } = render("---\ntitle: Q3 warehouse plan\ntab: Q3 plan\n---\n\nLead.\n", { file: "t.md" });
  assert.deepEqual(errors, []);
  assert.match(html, /<title>Q3 plan<\/title>/);
  assert.match(html, /<h1>Q3 warehouse plan<\/h1>/);
  assert.match(render("# Memo\n\nLead.\n", { file: "t.md" }).html, /<title>Memo<\/title>/);

  const long = render(`---\ntitle: T\ntab: ${"x".repeat(81)}\n---\n\nLead.\n`, { file: "t.md" });
  assert.deepEqual(long.errors.map((e) => e.message), ["tab: expected 1 to 80 characters, got 81"]);
});

test("images inside the column are capped at its width", () => {
  assert.match(CSS, /main img\{max-width:100%;height:auto\}/);
  // A plain image (no zoom title) lands inside <main>, where the cap applies.
  const { html } = render("# T\n\nLead.\n\n![wide](https://example.test/wide.png)\n", { file: "t.md" });
  assert.match(html, /<main>[\s\S]*<img src="https:\/\/example\.test\/wide\.png"[\s\S]*<\/main>/);
});

test("a document with no fences renders as prose in the shell", () => {
  const { html, errors } = render("# Memo\n\nThe answer first.\n\nThen the reasoning.\n", { file: "memo.md" });
  assert.deepEqual(errors, []);
  assert.match(html, /<h1>Memo<\/h1>/);
  assert.match(html, /<p class="lead">The answer first\.<\/p>/);
  assert.match(html, /<p>Then the reasoning\.<\/p>/);
  assert.doesNotMatch(html, /class="contents"/);
});

/* ------------------------------------------------------------------ blocks */

test("a callout keeps its tone class and its title as the tag", () => {
  const html = body("> [!warn] Risk\n> Presigns expire in 120 seconds.\n");
  assert.match(html, /<div class="note warn"><span class="tag">Risk<\/span>/);
  assert.match(html, /Presigns expire in 120 seconds\./);
  assert.match(body("> [!note] Note\n> Plain.\n"), /<div class="note"><span class="tag">Note<\/span>/);
});

test("table cells carry their alignment and tone classes, inside a scroll wrapper", () => {
  const html = body([
    "| Stage | Owner | p50 | p95 | Error rate |",
    "|:---|:---|---:|---:|---:|",
    "| Validate | Aryan | 18 | 41 | good:0.2% |",
    "| Serve | Aryan | 96 | 1,340 | bad:4.8% |",
  ].join("\n"));
  assert.match(html, /<div class="tbl-wrap"><table class="full">/);
  assert.match(html, /<td class="num t-good">0\.2%<\/td>/);
  assert.match(html, /<td class="num t-bad">4\.8%<\/td>/);

  // Three columns is a narrow table, so it sizes to its content instead.
  const narrow = body("| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |\n");
  assert.match(narrow, /<div class="tbl-wrap"><table>/);
  assert.match(narrow, /<td class="center">2<\/td>/);

  // Six columns breaks out of the reading column instead of squeezing.
  const wide = body("| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |\n");
  assert.match(wide, /<div class="tbl-wrap wide"><table class="full">/);
});

test("a task list renders checkbox items and leaves plain items alone", () => {
  const html = body("- [ ] An open task\n- [x] A finished task\n");
  assert.match(html, /<ul class="tasks">/);
  assert.match(html, /<li><span class="box"><\/span><span>An open task<\/span><\/li>/);
  assert.match(html, /<li class="done"><span class="box"><\/span><span>A finished task<\/span><\/li>/);
});

test('an image titled "zoom" becomes a figure linked to a lightbox overlay', () => {
  const html = body('![Dashboard](https://example.test/d.png "zoom")\n');
  assert.match(html, /<figure class="img"><a class="zoom" href="#lb-1"><img src="https:\/\/example\.test\/d\.png" alt="Dashboard"><\/a><span class="media-fail"[^>]*>.*?<\/span><\/span><figcaption>Dashboard<\/figcaption><\/figure>/);
  assert.match(html, /<div class="lightbox" id="lb-1"><a href="#_"><img src="https:\/\/example\.test\/d\.png" alt="Dashboard"><\/a><div class="cap">Dashboard<\/div><\/div>/);
  // The overlay is lifted out of the paragraph and sits at the end of the document.
  assert.ok(html.indexOf('class="lightbox"') > html.indexOf('class="zoom"'));
  assert.doesNotMatch(html, /data-zoom/);

  // A line under the image is its caption; the alt stays on the img only.
  const captioned = body('![Dashboard, Sep 21](https://example.test/d.png "zoom")\nAfter the S3 move\n');
  assert.match(captioned, /alt="Dashboard, Sep 21"><\/a><span class="media-fail"[^>]*>.*?<\/span><\/span><figcaption>After the S3 move<\/figcaption><\/figure>/);
  assert.match(captioned, /<div class="cap">After the S3 move<\/div>/);
  assert.equal(captioned.match(/Dashboard, Sep 21/g)?.length, 2, "alt appears on the thumbnail and overlay img only");

  // An untitled image stays inline prose.
  const plain = body("Text.\n\n![Plain](https://example.test/p.png)\n");
  assert.match(plain, /<p><img src="https:\/\/example\.test\/p\.png" alt="Plain"><span class="media-fail"[^>]*>.*?<\/span><\/span><\/p>/);
  assert.doesNotMatch(plain, /lightbox/);
});

test("a slideshow gets a snap track, anchored dots and a count", () => {
  const html = body('```slides\n[{"src":"https://e.test/1.png","caption":"List"},{"src":"https://e.test/2.png","caption":"Detail"}]\n```\n');
  assert.match(html, /<div class="slides"><div class="stage"><div class="track" tabindex="0" role="region" aria-label="Slideshow, 2 slides">/);
  assert.match(html, /<figure id="slides-1-1"><img src="https:\/\/e\.test\/1\.png" alt="List" loading="lazy"><span class="media-fail"[^>]*>.*?<\/span><\/span><figcaption>1 · List<\/figcaption><\/figure>/);
  assert.match(html, /<div class="dots"><a href="#slides-1-1" aria-label="Slide 1"><\/a><a href="#slides-1-2" aria-label="Slide 2"><\/a><\/div>/);
  assert.match(html, /<div class="count">2 slides<\/div>/);
});

test("each slideshow gets prev and next arrows, hidden until the slides script runs", () => {
  const two = '```slides\n[{"src":"https://e.test/1.png"},{"src":"https://e.test/2.png"},{"src":"https://e.test/3.png"}]\n```';
  const html = body(`${two}\n\n${two}\n`);
  const shows = html.match(/<div class="slides">.*?<div class="count">/gs) ?? [];
  assert.equal(shows.length, 2);
  for (const show of shows) {
    assert.match(show, /<div class="track" tabindex="0"/);
    assert.match(show, /<button type="button" class="arrow prev" aria-label="Previous slide" hidden><svg[^>]*><use href="#icon-chevron-left"\/><\/svg><\/button>/);
    assert.match(show, /<button type="button" class="arrow next" aria-label="Next slide" hidden><svg[^>]*><use href="#icon-chevron-right"\/><\/svg><\/button>/);
    assert.equal(show.match(/<figure /g)?.length, 3);
    assert.equal(show.match(/<div class="dots">(.*?)<\/div>/)?.[1].match(/<a /g)?.length, 3);
  }
  assert.match(html, /<symbol id="icon-chevron-left"/);
  assert.match(html, /<symbol id="icon-chevron-right"/);
  assert.match(CSS, /\.slides \.arrow\{[^}]*opacity:0/);
  assert.match(CSS, /@media \(hover:none\)\{\.slides \.arrow\{opacity:1\}\}/);
});

test("a video is a figure with a poster and a typed source", () => {
  const html = body('```video\n{"src":"https://e.test/c.webm","poster":"https://e.test/p.png","caption":"Upload flow, 0:42"}\n```\n');
  assert.match(html, /<figure class="img"><video controls preload="metadata" poster="https:\/\/e\.test\/p\.png">/);
  assert.match(html, /<source src="https:\/\/e\.test\/c\.webm" type="video\/webm">/);
  assert.match(html, /<figcaption>Upload flow, 0:42<\/figcaption>/);
});

test("footnotes render as a numbered list at the end, linked both ways", () => {
  const html = body("Body copy.[^a]\n\nMore.[^b]\n\n[^a]: The first note.\n[^b]: The second note.\n");
  assert.match(html, /<sup class="fn"><a id="fnref-1" href="#fn-1">1<\/a><\/sup>/);
  assert.match(html, /<hr><ol class="footnotes"><li id="fn-1">The first note\.<a class="fn-back" href="#fnref-1"/);
  assert.match(html, /<li id="fn-2">The second note\./);
  assert.ok(html.indexOf('class="footnotes"') > html.indexOf("More."));
});

test("stat tiles and hero stats format their value and split the delta", () => {
  const tiles = body('```stats\n[{"k":"Documents published","v":1284,"format":"int","delta":"+18.4% vs August","tone":"good"},\n {"k":"Largest document","v":486,"format":"int","delta":"95% of the cap"}]\n```\n');
  assert.match(tiles, /<div class="stats"><div class="stat"><div class="k">Documents published<\/div><div class="v">1,284<\/div>/);
  assert.match(tiles, /<div class="d"><b class="up">\+18\.4%<\/b> vs August<\/div>/);
  // No tone means no direction to signal, so the whole line stays muted.
  assert.match(tiles, /<div class="d">95% of the cap<\/div>/);

  const hero = body('```hero\n[{"k":"Net burn","v":412000,"format":"usd","as":"Aug 2026","delta":"−6.0% vs July","tone":"good"}]\n```\n');
  assert.match(hero, /<div class="hero"><div class="k">Net burn<\/div><div class="v">\$412k<\/div><div class="as">Aug 2026<\/div>/);
});

test("a tile meter takes its colour from its tone", () => {
  const of = (tone) =>
    body(`\`\`\`stats\n[{"k":"Cap","v":80,"meter":{"max":100${tone}}}]\n\`\`\`\n`);
  // No tone keeps the default amber; a named tone and a literal colour both land.
  assert.match(of(""), /class="meter-fill" style="width:80%;background:#fab219"/);
  assert.match(of(',"tone":"bad"'), /class="meter-fill" style="width:80%;background:#d03b3b"/);
  assert.match(of(',"tone":"#123456"'), /class="meter-fill" style="width:80%;background:#123456"/);
});

test("a heading keeps its inline marks, and its id stays the plain text", () => {
  const html = body("## The `upload` path is **fast**\n\n## Second\n");
  assert.match(html, /<h2 id="the-upload-path-is-fast">The <code>upload<\/code> path is <strong>fast<\/strong><\/h2>/);
  // The contents strip links the plain text, so no markup leaks into it.
  assert.match(html, /<a href="#the-upload-path-is-fast">The upload path is fast<\/a>/);
});

test("a timeline marks done and current entries", () => {
  const html = body('```timeline\n[{"when":"Aug 12","what":"Forked postplan","state":"done","note":"Vendored unmodified."},\n {"when":"Sep 22","what":"This page","state":"now"},\n {"when":"Next","what":"Fold into the skill"}]\n```\n');
  assert.match(html, /<li class="done"><span class="when">Aug 12<\/span><div class="what">Forked postplan<\/div><p>Vendored unmodified\.<\/p><\/li>/);
  assert.match(html, /<li class="now">/);
  assert.match(html, /<li><span class="when">Next<\/span>/);
});

test("containers and html fences pass through as the classes the shell styles", () => {
  assert.match(body("::: subtext\nSecondary text.\n:::\n"), /<div class="subtext">\s*<p>Secondary text\.<\/p>/);
  assert.match(body('```html\n<div class="mocks">A</div>\n```\n'), /<div class="mocks">A<\/div>/);
});

test("mock colour utilities exist, scoped to html fences, in palette colours only", () => {
  const rule = (sel) => new RegExp(`${sel.replace(/[.()]/g, "\\$&")}\\{[^}]*\\}`);
  const tones = [".fence :is(.up,.good):not(.note,.chip)", ".fence :is(.down,.bad,.critical):not(.note,.chip)",
    ".fence .warn:not(.note,.chip)", ".fence .serious", ".fence .delta", ".fence .pill", ".ticker", ".mock-grid"];
  for (const sel of tones) assert.match(CSS, rule(sel), sel);
  for (let i = 1; i <= 8; i++) {
    assert.match(CSS, new RegExp(`\\.fence \\.c${i}\\{color:var\\(--s${i}\\)\\}`));
    assert.match(CSS, new RegExp(`\\.fence \\.bg-c${i}\\{--wash:var\\(--s${i}\\)\\}`));
    assert.match(CSS, new RegExp(`\\.fence \\.dot-c${i}\\{--dot:var\\(--s${i}\\)\\}`));
  }
  for (const t of ["up", "down", "warn"]) {
    assert.match(CSS, new RegExp(`\\.fence \\.bg-${t}\\{--wash:`));
    assert.match(CSS, new RegExp(`\\.fence \\.dot-${t}\\{--dot:`));
  }
  // Every rule in the utility block reads a token; none brings its own hex.
  const block = CSS.slice(CSS.indexOf("/* ---- colour utilities"), CSS.indexOf("/* ---- footnotes"));
  assert.deepEqual(block.replace(/background:#262624/, "").match(/#[0-9a-f]{3,8}\b/gi), null);
});

test("an html fence keeps its class names and is wrapped in the .fence scope", () => {
  const src = '<div class="ticker"><span class="sym dot-c1">NVDA</span><span class="delta up">+2.1%</span></div>';
  const html = body(`\`\`\`html\n${src}\n\`\`\`\n`);
  assert.ok(html.includes(`<div class="fence">${src}</div>`), html);
  // Prose never gets the scope, so a stray class name there stays white.
  assert.doesNotMatch(body("Up and down.\n"), /class="fence"/);
});

/* ------------------------------------------------------------------ assembly */

test("a data fence can load its rows from a file beside the document", () => {
  const dir = mkdtempSync(join(tmpdir(), "postplan-src-"));
  writeFileSync(join(dir, "rows.json"), JSON.stringify({ labels: ["Apr"], values: [61] }));
  const md = '---\ntitle: T\n---\n\nLead.\n\n```chart columns\n{"title":"Published","src":"rows.json"}\n```\n';

  const ok = render(md, { file: join(dir, "plan.md") });
  assert.deepEqual(ok.errors, []);
  const chart = ok.doc.blocks.find((b) => b.type === "chart");
  // `normalize` has already filled the chart envelope, so only the authored keys
  // and the loaded rows are asserted here.
  const { title, labels, values } = chart.data;
  assert.deepEqual({ title, labels, values }, { title: "Published", labels: ["Apr"], values: [61] });
  assert.equal("src" in chart.data, false);

  const missing = render(md.replace("rows.json", "nope.json"), { file: join(dir, "plan.md") });
  assert.equal(missing.html, null);
  assert.equal(missing.errors.length, 1);
  assert.equal(missing.errors[0].block, "chart columns");
  assert.equal(missing.errors[0].line, 7); // the line of the opening fence
  assert.match(missing.errors[0].message, /^src "nope\.json": ENOENT/);
});

test("a src is scoped to the document directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "postplan-src-"));
  mkdirSync(join(dir, "doc"));
  writeFileSync(join(dir, "secret.json"), JSON.stringify({ labels: ["Apr"], values: [61] }));
  const md = (src) =>
    `---\ntitle: T\n---\n\nLead.\n\n\`\`\`chart columns\n${JSON.stringify({ src })}\n\`\`\`\n`;
  const at = (src) => render(md(src), { file: join(dir, "doc", "plan.md") });

  for (const src of ["../secret.json", "sub/../../secret.json", join(dir, "secret.json")]) {
    const { html, errors } = at(src);
    assert.equal(html, null);
    assert.deepEqual(
      errors.map((e) => `${e.line} ${e.block}: ${e.message}`),
      [`7 chart columns: src ${JSON.stringify(src)} escapes the document directory`],
      src,
    );
  }

  // `doc-notes` is a sibling that merely shares the prefix of `doc`, so the
  // check has to compare against `doc/` and not `doc`.
  mkdirSync(join(dir, "doc-notes"));
  writeFileSync(join(dir, "doc-notes", "rows.json"), JSON.stringify([1, 2]));
  assert.match(
    at("../doc-notes/rows.json").errors[0].message,
    /^src "\.\.\/doc-notes\/rows\.json" escapes the document directory$/,
  );
});

test("rows from a side file are validated like rows written inline", () => {
  const dir = mkdtempSync(join(tmpdir(), "postplan-src-"));
  writeFileSync(join(dir, "rows.json"), JSON.stringify({ labels: ["Apr", "May"], values: [61, "n/a"] }));
  const md = '---\ntitle: T\n---\n\nLead.\n\n```chart columns\n{"title":"T","src":"rows.json"}\n```\n';

  const { html, errors } = render(md, { file: join(dir, "plan.md") });
  assert.equal(html, null);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.equal(errors[0].line, 7);
  assert.equal(errors[0].block, "chart columns");
  assert.match(errors[0].message, /^\/values\/1 /);
  assert.match(errors[0].message, /"n\/a"/);
});

test("a side file that is not JSON is named but never quoted", () => {
  const dir = mkdtempSync(join(tmpdir(), "postplan-src-"));
  writeFileSync(join(dir, "rows.json"), '{"labels":["Apr"],"values":[nan],"secret":"hunter2"}');
  const md = '---\ntitle: T\n---\n\nLead.\n\n```chart columns\n{"src":"rows.json"}\n```\n';

  const { html, errors } = render(md, { file: join(dir, "plan.md") });
  assert.equal(html, null);
  // The shape complaint is suppressed: the read already failed, once.
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0].message, /^src "rows\.json": invalid JSON: /);
  assert.equal(/hunter2|labels/.test(errors[0].message), false, errors[0].message);
});

test("html a document could not upload is rejected, at the fence that wrote it", () => {
  const { html, errors } = render('---\ntitle: T\n---\n\nLead.\n\n```html\n<iframe src="https://example.test"></iframe>\n```\n', { file: "t.md" });
  assert.equal(html, null);
  // The schema runs the upload policy over each html fence, so the diagnostic
  // carries the fence's line instead of pointing at the whole document. The
  // document-level re-check in `render` still stands behind it.
  assert.ok(errors.some((e) => e.block === "html" && e.line === 7 && /<iframe>/.test(e.message)), JSON.stringify(errors));
});

test("examples/gallery.md renders with no errors", () => {
  const { html, errors } = render(readFileSync(GALLERY, "utf8"), { file: GALLERY });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.match(html, /<title>Postplan component gallery<\/title>/);
  assert.match(html, /<div class="contents">/);
  assert.match(html, /<ul class="sources">/);
  // 155 KB: the media failure panels and their script added about 10 KB, toned
  // chart labels about 0.5 KB, the "When media fails" examples about 6 KB, and
  // the Files section (five cards, their glyphs, the files script) about 15 KB,
  // and the print stylesheet with the switchable-chart rules about 4 KB.
  assert.ok(Buffer.byteLength(html) < 160 * 1024, "the gallery stays under 160 KB");
});

test("an unknown block type renders nothing rather than half a block", () => {
  assert.equal(renderBlock({ id: "x", line: 1, type: "nope" }), "");
});

test("print inverts the palette so no glyph prints white on paper", () => {
  const print = CSS.slice(CSS.indexOf("@media print"));
  // Every text colour is var(--ink), so remapping it is what makes the page legible.
  assert.match(print, /--ink:#000/);
  assert.match(print, /color-scheme:light/, "a dark scheme paints the page margins black");
  // Figures keep their dark palette and print inverted, so tinted nodes do not end up black-on-navy.
  assert.match(print, /svg\.chart\{--ink:#fff;[^}]*filter:invert\(1\) hue-rotate\(180deg\)\}/);
  assert.match(print, /break-inside:avoid/);
});
