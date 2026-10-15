/**
 * The document shell: tokens, type scale and every component's CSS, plus the
 * wrapper that turns a body string into a complete HTML file.
 *
 * @module render/shell
 */
//
// One <style> block, no external stylesheet, no webfont. The type scale copies
// Claude's document renderer, measured off a PDF export: a ~700px column, body
// at 17px on a 25px line, list pitch 28px, serif headings at regular weight
// (h1 34, h2 24, h3 19.5), filled byline chips, fully gridded tables. Anthropic
// Serif / Sans / Mono are not shippable, so each gets the nearest system stack.
// The page plane stays true black; chart colours are the validated dark palette.

export const CSS = `
:root{
  --bg:#000;                 /* page plane: Aryan's true black (the system's is #0d0d0d) */
  --surface:#1a1a19;         /* chart / code surface, from the palette's dark surface */
  --surface-2:#232321;
  --line:#2c2c2a;            /* gridline hairline */
  --line-strong:#383835;     /* baseline / axis / table rule */
  /* No grey text. Every glyph in the document is white and hierarchy is carried
     by size and weight: metadata at 12-14px regular, body at 17px, labels at
     600. Hairlines, panels, dots and the chart palette keep their own colour,
     and so do the syntax-highlight tokens, which are not grey. The one other
     exception is the colour utilities an html fence may use (see .fence). */
  --ink:#fff;                /* every glyph */
  --mark:#898781;            /* dots and other non-text marks, never a glyph */
  --grid:#2c2c2a;
  --axis:#383835;
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500;
  --s5:#d55181; --s6:#008300; --s7:#9085e9; --s8:#e66767;
  --good:#0ca30c; --warn:#fab219; --serious:#ec835a; --critical:#d03b3b;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
  /* Aryan's editor font stack (VS Code / Cursor), with the system monospace as the floor */
  --mono:"Cascadia Code","Cascadia Mono","JetBrains Mono",Menlo,Monaco,ui-monospace,monospace;
}
*{box-sizing:border-box}
/* A component's display:block/flex must not beat the hidden attribute. */
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 var(--sans);
  font-feature-settings:"kern" 1}
.wrap{max-width:744px;margin:0 auto;padding:56px 22px 96px}
/* A grid track of minmax(0,1fr) stops a wide table, code block or chart from
   propagating its intrinsic width up and giving the whole page a sideways scroll. */
main{display:grid;grid-template-columns:minmax(0,1fr)}
main > *{min-width:0}

/* ---- headings: serif, regular weight, like the renderer ---- */
h1,h2,h3{font-family:var(--serif);font-weight:400;color:var(--ink);letter-spacing:-.005em}
h1{font-size:46px;line-height:1.12;margin:0 0 30px;letter-spacing:-.01em}
h2{font-size:24px;line-height:1.25;margin:44px 0 12px;scroll-margin-top:16px}
h3{font-size:19.5px;line-height:1.3;margin:30px 0 8px}
h4{font:600 17px/1.4 var(--sans);color:var(--ink);margin:24px 0 6px}
h2 + p,h3 + p,h4 + p{margin-top:0}

/* ---- byline ---- */
.byline{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin:0 0 28px;font-size:15.5px}
.chip{display:inline-flex;align-items:center;gap:7px;padding:4px 12px;border-radius:999px;
  background:#262624;color:var(--ink);white-space:nowrap;line-height:1.4}
.chip svg{width:14px;height:14px;flex:none;stroke:var(--ink);fill:none;stroke-width:1.6}
.chip .dot{width:6px;height:6px;border-radius:50%;background:var(--mark)}
.chip.good .dot{background:var(--good)} .chip.warn .dot{background:var(--warn)}
.chip.critical .dot{background:var(--critical)}
.byline .sep{color:var(--ink)}
.lead{color:var(--ink);margin:0 0 20px}
.contents{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px;margin:0 0 8px;padding:10px 0;
  border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.contents a{color:var(--ink);border:0}
.contents a:hover{text-decoration:underline}

/* ---- prose ---- */
p{margin:0 0 14px}
strong{color:var(--ink);font-weight:600}
a{color:#5c9cf0;text-decoration:underline;text-decoration-color:rgba(92,156,240,.45);text-underline-offset:3px}
a:hover{text-decoration-color:#5c9cf0}
ul,ol{margin:0 0 14px;padding-left:26px}
li{margin:4px 0}
li > ul,li > ol{margin:4px 0 0}
/* a loose list wraps each item in a <p>; keep the item's own rhythm, not the body's */
li > p{margin:0 0 6px}
li > p:last-child{margin-bottom:0}
li::marker{color:var(--ink)}
/* the renderer's nesting: 1 → a → i, and disc → circle → square */
ol{list-style:decimal} ol ol{list-style:lower-alpha} ol ol ol{list-style:lower-roman}
ul{list-style:disc} ul ul{list-style:circle} ul ul ul{list-style:square}
.center{text-align:center}
.right{text-align:right}
.subtext{font-size:15px;color:var(--ink);margin:0 0 14px}
.subtext p{margin:0 0 6px}
.subtext p:last-child{margin-bottom:0}
/* auto-fit collapses the group to one column on a phone, keeping source order */
.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 24px;margin:0 0 14px}
.columns > p{margin:0}
/* CommonMark runs a plain bullet list and a task list written back to back into
   one list, so the checkbox item styles itself rather than relying on the parent. */
ul.tasks{list-style:none;padding-left:26px}
ul.tasks > li{list-style:disc}
ul.tasks > li:has(> .box){display:flex;gap:10px;align-items:baseline;list-style:none;margin-left:-26px}
ul.tasks li p{margin:0}
ul.tasks .box{flex:none;width:15px;height:15px;border-radius:3px;border:1px solid var(--line-strong);
  background:var(--surface-2);position:relative;top:2px}
ul.tasks li.done .box{background:#3a3a37;border-color:#3a3a37}
ul.tasks li.done .box::after{content:"";position:absolute;left:4.5px;top:1.5px;width:4px;height:8px;
  border:solid #cfcfc8;border-width:0 2px 2px 0;transform:rotate(45deg)}
ul.tasks li.done span{color:var(--ink);text-decoration:line-through}
hr{border:0;border-top:1px solid var(--line-strong);margin:26px 0}
blockquote{margin:0 0 14px;padding:4px 0 4px 18px;border-left:3px solid var(--line-strong);color:var(--ink)}
code{font:.9em/1.5 var(--mono);background:var(--surface);border-radius:4px;padding:2px 6px;color:var(--ink)}
kbd{font:.85em var(--mono);background:var(--surface-2);border:1px solid var(--line-strong);
  border-bottom-width:2px;border-radius:4px;padding:1px 6px;color:var(--ink)}
.small{font-size:15px;color:var(--ink)}

/* ---- callouts ---- */
.note{display:grid;grid-template-columns:82px minmax(0,1fr);gap:12px;align-items:start;
  border-left:3px solid #4a4a46;padding:4px 0 4px 16px;margin:0 0 16px}
.note .tag{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);
  padding-top:5px;overflow-wrap:break-word}
.note p{margin:0}
.note.good{border-left-color:var(--good)} .note.good .tag{color:var(--good)}
.note.warn{border-left-color:var(--warn)} .note.warn .tag{color:var(--warn)}
.note.critical{border-left-color:var(--critical)} .note.critical .tag{color:var(--critical)}
.math-error{color:var(--critical)}

/* ---- stat tiles ---- */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:1px;
  background:var(--line);border:1px solid var(--line);border-radius:6px;overflow:hidden;margin:0 0 22px}
.stat{background:var(--bg);padding:14px 16px 13px}
.stat .k{font-size:13.5px;color:var(--ink);margin-bottom:6px}
.stat .v{font-size:28px;line-height:1.1;font-weight:600;color:var(--ink);letter-spacing:-.02em}
.stat .d{font-size:13.5px;margin-top:6px;color:var(--ink)}
.stat .d b{font-weight:600}
.stat .d .up{color:var(--good)} .stat .d .down{color:var(--critical)}
.stat .spark{margin-top:10px;display:block}

/* ---- tables: fully gridded, header band, like the renderer ---- */
.tbl-wrap{overflow-x:auto;margin:0 0 20px;-webkit-overflow-scrolling:touch}
/* A wide table sizes to its content between the column and the viewport (less
   the page gutter), centred on the column. A grid item overflows its track on
   both sides when centred, so it spills evenly instead of off the right edge. */
.tbl-wrap.wide{justify-self:center;width:max-content;min-width:100%;max-width:min(calc(100vw - 44px),1440px)}
/* macOS hides overlay scrollbars, so a table that still overflows gave no sign
   it scrolls. A styled scrollbar is always drawn. */
.tbl-wrap::-webkit-scrollbar{height:8px}
.tbl-wrap::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:4px}
.tbl-wrap::-webkit-scrollbar-track{background:transparent}
table{border-collapse:collapse;font-size:15.5px;min-width:min(100%,440px)}
th,td{border:1px solid var(--line-strong);padding:9px 14px;text-align:left;vertical-align:middle}
th{font-weight:400;color:var(--ink);background:var(--surface)}
td{color:var(--ink)}
.num{text-align:right;font-variant-numeric:tabular-nums}
.t-good{color:var(--good)} .t-bad{color:#e66767} .t-warn{color:var(--warn)}
.t-flat{color:var(--ink)}
table.full{width:100%}

/* ---- figures & charts: centred title, note and caption below ---- */
.fig{margin:0 0 28px;max-width:100%}
.fig-title{font:600 15px/1.4 var(--sans);color:var(--ink);text-align:center;margin:0 0 6px}
.fig-note{font-size:14px;color:var(--ink);margin-top:6px}
.fig-cap{font-size:14px;color:var(--ink);margin-top:8px}
svg.chart{display:block;overflow:visible;min-width:520px}
svg.chart.compact{min-width:0}
svg.chart.diagram{margin:0 auto}
.fig-row{display:flex;flex-wrap:wrap;gap:8px 28px;align-items:flex-start;justify-content:center;margin:0 0 28px}
.fig-row>.fig{flex:1 1 220px;min-width:0;margin:0}
.fig-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
/* Every chart label gets a true-black halo, so one crossing a bar, line or gridline still reads. */
.chart text{paint-order:stroke fill;stroke:#000;stroke-width:3px;stroke-linejoin:round}
.chart .grid{stroke:var(--grid);stroke-width:1}
.chart .axis{stroke:var(--axis);stroke-width:1}
.chart .tick{fill:var(--ink);font:12px var(--sans);font-variant-numeric:tabular-nums}
.chart .tick-y{text-anchor:end} .chart .tick-x{text-anchor:middle}
.chart .val{fill:var(--ink);font:12px var(--sans);text-anchor:middle;font-variant-numeric:tabular-nums}
.chart .val-left{text-anchor:start} .chart .val-end{text-anchor:end}
.chart .cell-val{font:11px var(--sans);text-anchor:middle;font-variant-numeric:tabular-nums}
.chart .node-label{fill:var(--ink);font:13px var(--sans);text-anchor:middle}
.chart .edge-label{fill:var(--ink);font:11.5px var(--sans);text-anchor:middle}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin:2px 0 10px;font-size:13.5px;color:var(--ink)}
.pctn{color:var(--ink);font-variant-numeric:tabular-nums}
.key{display:inline-flex;align-items:center;gap:7px}
.swatch{width:10px;height:10px;border-radius:2px;display:inline-block}
.key .stroke{width:14px;height:2px;border-radius:1px;display:inline-block}
.spark{vertical-align:middle}

/* ---- switchable charts: the state is in the form controls, :has() shows the matching panel ---- */
.cx{position:relative}
.cx-hd{position:relative;min-height:22px}
.cx-hd .fig-title{padding:0 30px}
.cx-set{position:absolute;right:0;top:0;z-index:4}
/* Not the document's collapsible sections: no rules, no +/- marker. */
.cx details.cx-set{border:0;padding:0}
.cx details.cx-set summary::before{content:none}
.cx-set summary{list-style:none;cursor:pointer;display:flex;padding:3px;opacity:.75}
.cx-set summary::-webkit-details-marker{display:none}
.cx-set summary:hover,.cx-set[open] summary{opacity:1}
.cx-set summary:focus-visible{outline:2px solid #5c9cf0;outline-offset:2px;border-radius:4px}
.cx-set summary svg{width:16px;height:16px;stroke:var(--ink);fill:none;stroke-width:1.6;stroke-linecap:round}
.cx-set summary circle{fill:#000}
.cx-set>.cx-pop{position:absolute;right:0;top:28px;margin:0;background:#000;border:1px solid var(--line-strong);padding:6px 14px 8px;
  font-size:13.5px;min-width:200px;white-space:nowrap}
.cx-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:6px 0;cursor:pointer}
.cx-row + .cx-row{border-top:1px solid var(--line)}
.cx-row input{appearance:none;-webkit-appearance:none;margin:0;width:12px;height:12px;border:1.5px solid var(--ink);
  border-radius:2px;cursor:pointer;flex:none}
.cx-row input:checked{background:var(--ink)}
.cx-row input:focus-visible{outline:2px solid #5c9cf0;outline-offset:2px}
.cx-reset{all:unset;cursor:pointer;margin-top:6px;font-size:13px;text-decoration:underline;text-underline-offset:4px}
.cx-reset[hidden]{display:none}
.cx-tabs{display:flex;gap:0 22px;flex-wrap:wrap;justify-content:center;border-bottom:1px solid var(--line-strong);
  margin:4px 0 10px;font-size:14px}
.cx-tabs label{cursor:pointer;position:relative}
.cx-tabs span{display:block;padding:0 0 7px;margin-bottom:-1px;border-bottom:2px solid transparent;opacity:.6}
.cx-tabs label:hover span{opacity:1}
.cx-tabs input:checked+span{opacity:1;border-bottom-color:var(--ink)}
.cx-tabs input:focus-visible+span{outline:2px solid #5c9cf0;outline-offset:2px}
.cx-tabs input,.cx-legend input{position:absolute;opacity:0;width:1px;height:1px;margin:0}
.cx-legend .key{cursor:pointer;position:relative}
.cx-legend .key:has(input:not(:checked)){opacity:.4}
.cx-legend .key:has(input:focus-visible){outline:2px solid #5c9cf0;outline-offset:2px}
.chart .pl{font-size:11px}
.cx:has(.ct[value="1"]:checked) .cv:not([data-v="1"]),.cx:has(.ct[value="2"]:checked) .cv:not([data-v="2"]),
.cx:has(.ct[value="3"]:checked) .cv:not([data-v="3"]),.cx:has(.ct[value="4"]:checked) .cv:not([data-v="4"]),
.cx:has(.ct[value="5"]:checked) .cv:not([data-v="5"]),.cx:has(.ct[value="0"]:checked) .cv:not([data-v="0"]),
.cx:has(.co[data-k="log-x"]:checked) .cv[data-x="lin"],.cx:has(.co[data-k="log-x"]:not(:checked)) .cv[data-x="log"],
.cx:has(.co[data-k="log-y"]:checked) .cv[data-y="lin"],.cx:has(.co[data-k="log-y"]:not(:checked)) .cv[data-y="log"],
.cx:has(.co[data-k="sort"]:checked) .cv[data-o="as"],.cx:has(.co[data-k="sort"]:not(:checked)) .cv[data-o="val"],
.cx:has(.co[data-k="table"]:checked) .cv:not([data-t]),.cx:has(.co[data-k="table"]:checked) .cx-legend,.cx:not(:has(.co[data-k="table"]:checked)) .cv[data-t],
.cx:has(.co[data-k="labels"]:not(:checked)) .k-labels,.cx:has(.co[data-k="pareto"]:not(:checked)) .k-pareto,
.cx:has(.co[data-k="quadrant"]:not(:checked)) .k-quadrant,
.cx:has(.cl[value="0"]:not(:checked)) [data-series="0"],.cx:has(.cl[value="1"]:not(:checked)) [data-series="1"],
.cx:has(.cl[value="2"]:not(:checked)) [data-series="2"],.cx:has(.cl[value="3"]:not(:checked)) [data-series="3"],
.cx:has(.cl[value="4"]:not(:checked)) [data-series="4"],.cx:has(.cl[value="5"]:not(:checked)) [data-series="5"],
.cx:has(.cl[value="6"]:not(:checked)) [data-series="6"],.cx:has(.cl[value="7"]:not(:checked)) [data-series="7"]{display:none}

/* ---- images and video ---- */
/* A plain Markdown image (no zoom) otherwise renders at its natural width and overflows a phone column. */
main img{max-width:100%;height:auto}
.img{margin:0 0 28px}
.img img,.img video{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}
.img.plain img{border:0;border-radius:0}
.img.narrow{max-width:420px}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:0 0 8px}
.pair figure{margin:0}
.pair .lbl{font-size:12.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--ink);margin:0 0 6px}
.img figcaption{font-size:14px;color:var(--ink);margin-top:8px}

/* ---- lightbox: :target, no script. A thumbnail links to #id; the overlay links back to #_ ---- */
.img a.zoom{display:block;cursor:zoom-in}
.lightbox{display:none;position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.94);padding:24px}
.lightbox:target{display:grid;place-items:center}
.lightbox a{display:grid;place-items:center;width:100%;height:100%;cursor:zoom-out;text-decoration:none}
.lightbox img{max-width:100%;max-height:92vh;width:auto;height:auto;border-radius:6px}
.lightbox .cap{position:fixed;left:0;right:0;bottom:16px;text-align:center;font-size:14px;color:var(--ink)}

/* ---- media load failure ---- */
/* The script reveals a panel in the figure's own box. The aspect ratio comes
   from the element's width/height when it has them; content taller than the
   box grows it rather than overflowing. Both lines are white; size carries the
   hierarchy. */
.media-fail{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;width:100%;
  aspect-ratio:16/9;padding:20px 16px;border:1px solid var(--line);border-radius:8px;background:var(--surface);
  text-align:center;color:var(--ink)}
.mf-icon{width:20px;height:20px;flex:none;margin-bottom:8px}
.mf-title{font-size:17px;line-height:1.4}
.mf-cause{font-size:14px;line-height:1.45;max-width:46ch}
.mf-cause:empty{display:none}
.mf-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:12px}
.media-fail a.copy{text-decoration:none}
.img a.zoom[aria-disabled]{cursor:default}
/* The no-script floor: Chrome and Firefox draw an image's pseudo-elements only
   when it failed, so a broken image shows its alt text in a hairline box. */
img{position:relative}
img::before{content:"";position:absolute;inset:0;background:var(--surface);border:1px solid var(--line);border-radius:8px}
img::after{content:attr(alt);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:12px 16px;font:14px/1.45 var(--sans);color:var(--ink);text-align:center}

/* ---- file cards: one surface, a row per file, a hairline between ---- */
.files{margin:0 0 20px;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.file{display:flex;align-items:center;gap:14px;padding:14px 16px}
.file + .file{border-top:1px solid var(--line)}
.ft-icon{width:24px;height:24px;flex:none;color:var(--ink)}
.fc-main{flex:1 1 auto;min-width:0}
.fc-name{font:14.5px/1.4 var(--mono);overflow-wrap:anywhere}
.fc-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:3px;font-size:13px;line-height:1.4;
  font-variant-numeric:tabular-nums}
.fc-pill{display:inline-flex;align-items:center;padding:1px 9px;border-radius:999px;background:#262624;white-space:nowrap}
.fc-pill.warn{color:var(--warn)} .fc-pill.critical{color:var(--critical)}
.fc-note,.fc-gone{font-size:14px;line-height:1.45;margin-top:6px}
.fc-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;flex:none}
a.copy{text-decoration:none}
.copy.primary{background:#fff;border-color:#fff;color:#000}
.copy.primary:hover{background:#e6e6e3;border-color:#e6e6e3}

/* ---- slideshow: scroll-snap, dots are anchors; the arrows exist only with script ---- */
.slides{margin:0 0 8px}
.slides .stage{position:relative}
.slides .track:focus-visible{outline:2px solid #5c9cf0;outline-offset:2px;border-radius:8px}
.slides .track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;gap:12px;scroll-behavior:smooth;
  scrollbar-width:none;-webkit-overflow-scrolling:touch}
.slides .track::-webkit-scrollbar{display:none}
.slides .track > figure{flex:0 0 100%;scroll-snap-align:start;margin:0;scroll-margin:0}
.slides .track img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid var(--line)}
.slides .track figcaption{font-size:14px;color:var(--ink);margin-top:8px}
.slides .dots{display:flex;gap:8px;justify-content:center;margin:10px 0 0}
/* Centred on the image: the caption below it is 14px on a ~20px line plus an 8px gap. */
.slides .arrow{position:absolute;top:calc(50% - 14px);transform:translateY(-50%);width:44px;height:44px;padding:0;
  display:flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--line);
  background:#1a1a19;color:#fff;cursor:pointer;opacity:0;transition:opacity .15s}
.slides .arrow svg{width:20px;height:20px}
.slides .arrow.prev{left:10px}
.slides .arrow.next{right:10px}
.slides .arrow[hidden]{display:none}
.slides:hover .arrow,.slides:focus-within .arrow{opacity:1}
.slides .arrow:focus-visible{outline:2px solid #5c9cf0;outline-offset:2px}
@media (hover:none){.slides .arrow{opacity:1}}
.slides .dots a{width:8px;height:8px;border-radius:50%;background:#383835;display:block}
.slides .dots a:hover{background:var(--mark)}
.slides .dots a[aria-current]{background:#fff}
.slides .count{font-size:13px;color:var(--ink);text-align:center;margin-top:6px}

/* ---- hero stat, the renderer's centred stat widget ---- */
.hero{ text-align:center;margin:8px 0 28px}
.hero .k{font:600 15px/1.4 var(--sans);color:var(--ink)}
.hero .v{font-size:34px;line-height:1.15;font-weight:600;color:var(--ink);letter-spacing:-.02em;margin-top:2px}
.hero .as{font-size:13.5px;color:var(--ink);margin-top:2px}
.hero .d{font-size:13.5px;color:var(--ink)}
.hero .d b{font-weight:600}
.hero .d .up{color:var(--good)} .hero .d .down{color:var(--critical)}
.heroes{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}

/* ---- meters ---- */
.meter{margin:0 0 12px;max-width:420px}
.meter-head{display:flex;justify-content:space-between;font-size:13.5px;color:var(--ink);margin-bottom:5px}
.meter-track{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden}
.meter-fill{height:100%;border-radius:3px}

/* ---- code: One Dark Pro on the surface, at the editor's 15/1.4 scaled to the page ---- */
code,.code pre{font-feature-settings:"calt" 1,"ss01" 1;font-variant-ligatures:contextual;tab-size:2}
.code{border-radius:8px;background:var(--surface);margin:0 0 20px;overflow:hidden;border:1px solid var(--line)}
/* The head wraps rather than truncating a path on a desktop; a phone keeps one row (see the media query). */
.code-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;min-height:44px;padding:5px 8px 5px 14px;
  border-bottom:1px solid var(--line);background:var(--surface-2)}
.code-name{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;min-width:0}
.code-sep{color:var(--ink)}
.code-title{font:14px/1.4 var(--sans);color:var(--ink)}
.code-range{font:12px var(--mono);color:var(--ink);white-space:nowrap}
/* a path, in a file header or an inline chip: click copies it */
.code-path,.file-chip{display:inline-flex;align-items:center;min-width:0;max-width:100%;margin:0;color:var(--ink);
  font-family:var(--mono);cursor:pointer;text-align:left}
.code-path{gap:7px;padding:2px 0;border:0;background:none;font-size:13px;line-height:1.4}
.code-path:hover .p-name,.file-chip:hover .p-name{text-decoration:underline;text-underline-offset:3px}
.code-path:focus-visible,.file-chip:focus-visible{outline:2px solid #5c9cf0;outline-offset:2px;border-radius:4px}
.p-text{display:flex;min-width:0}
.p-dir,.p-name{white-space:pre}
.file-icon{width:14px;height:14px;flex:none}
.file-chip{gap:5px;padding:0 8px;border:1px solid var(--line-strong);border-radius:999px;background:transparent;
  font-size:.85em;line-height:1.55;vertical-align:baseline}
.file-chip .file-icon{width:12px;height:12px}
.code-path[data-state]::after,.file-chip[data-state]::after{font:12px var(--sans);margin-left:6px}
.code-path[data-state=copied]::after,.file-chip[data-state=copied]::after{content:"Copied"}
.code-path[data-state=selected]::after,.file-chip[data-state=selected]::after{content:"Selected"}
.code-lang{display:inline-flex;align-items:center;gap:7px;font-size:11.5px;letter-spacing:.07em;
  text-transform:uppercase;color:var(--ink);white-space:nowrap}
.code-icon{width:16px;height:16px;flex:none}
.code-tools{margin-left:auto;display:flex;align-items:center;gap:12px;flex:none}
.copy{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--line-strong);
  border-radius:999px;background:transparent;color:var(--ink);font:13px/1 var(--sans);cursor:pointer}
.copy:hover{border-color:#5a5a55}
.copy:focus-visible{outline:2px solid #5c9cf0;outline-offset:2px}
.copy[hidden]{display:none}
.copy-icon{width:14px;height:14px;flex:none}
.sprite{position:absolute;width:0;height:0;overflow:hidden}
.code pre{margin:0;padding:14px 0;overflow-x:auto;font:15px/1.4 var(--mono);color:#abb2bf}
.code.plain pre{color:var(--ink)}
.code pre > code{display:block;padding:0 18px;width:max-content;min-width:100%}
.code code{background:0;border:0;padding:0;font-size:inherit;color:inherit;border-radius:0}
/* numbered lines: a white 13px gutter, a hairline, and numbers that drag-copy skips */
.code-lines,.diff-lines{margin:0;padding:0;list-style:none;min-width:max-content}
.code-lines{counter-reset:l;position:relative}
.code-lines::before{content:"";position:absolute;top:-14px;bottom:-14px;left:44px;border-left:1px solid var(--line)}
.code-lines li,.diff-lines li{white-space:pre;margin:0;display:block}
.code-lines li{counter-increment:l;padding:0 18px 0 58px}
.code-lines li::before{content:counter(l);display:inline-block;width:32px;margin:0 26px 0 -58px;text-align:right;
  font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums;user-select:none;-webkit-user-select:none}
.t-kw{color:#c678dd} .t-str{color:#98c379} .t-num,.t-const{color:#d19a66} .t-fn{color:#61afef}
.t-type{color:#e5c07b} .t-var,.t-this,.t-prop,.t-key{color:#e06c75} .t-op{color:#56b6c2}
.t-punc{color:#abb2bf} .t-com{color:#7f848e;font-style:italic} .t-tag{color:#e06c75}
.t-attr,.t-flag{color:#d19a66} .t-regex{color:#98c379} .t-esc{color:#56b6c2} .t-meta{color:#e5c07b}
/* diff: tinted rows, a +/- sign column, context in the default code colour */
.diff-lines li{padding:0 18px 0 0;color:#abb2bf}
.d-sign{display:inline-block;width:30px;text-align:center}
.diff-lines .d-add{color:#98c379;background:rgba(152,195,121,.12)}
.diff-lines .d-del{color:#e06c75;background:rgba(224,108,117,.12)}
.diff-lines .d-hunk{color:#61afef;padding-left:30px}

/* ---- timeline ---- */
.timeline{list-style:none;margin:0 0 20px;padding:0 0 0 20px;border-left:1px solid var(--line-strong)}
.timeline li{position:relative;padding:0 0 18px 6px}
.timeline li::before{content:"";position:absolute;left:-25px;top:8px;width:8px;height:8px;border-radius:50%;
  background:var(--mark);box-shadow:0 0 0 3px var(--bg)}
.timeline li.done::before{background:var(--good)}
.timeline li.now::before{background:var(--s1)}
.timeline .when{font-size:13px;color:var(--ink);font-variant-numeric:tabular-nums}
.timeline .what{color:var(--ink)}
.timeline p{margin:2px 0 0;font-size:15px;color:var(--ink)}

/* ---- key/value spec list ---- */
dl.spec{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 20px;margin:0 0 20px;font-size:15.5px}
dl.spec dt{color:var(--ink)}
dl.spec dd{margin:0}

/* ---- collapsible ---- */
details{border-top:1px solid var(--line);padding:12px 0}
details:last-of-type{border-bottom:1px solid var(--line)}
summary{cursor:pointer;color:var(--ink);list-style:none;display:flex;gap:10px;align-items:center}
summary::-webkit-details-marker{display:none}
summary::before{content:"+";color:var(--ink);font:15px var(--mono)}
details[open] summary::before{content:"\\2212"}
details > *:not(summary){margin-top:10px}

/* ---- math ---- */
math{font-size:19px;color:var(--ink)}
.math-block{margin:0 0 20px;padding:12px 0;text-align:center}

/* ---- comparison grid for mocks ---- */
.mocks{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:0 0 20px}
.mock{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--surface)}
.mock .mock-head{padding:6px 12px;border-bottom:1px solid var(--line);font-size:12px;
  letter-spacing:.07em;text-transform:uppercase;color:var(--ink)}
.mock .mock-body{padding:14px}
/* the html fence's own idiom: a big number and a label/value row, no inline styles */
.mock-big{font-size:22px;font-weight:600;color:var(--ink);letter-spacing:-.02em}
.mock-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:6px}
.mock-row:first-child{margin-top:0}
/* a stock-list row: symbol, price, signed change, a hairline between rows. The
   symbol takes the slack, so a row of symbol + pill works as a status line too. */
.ticker{display:flex;gap:12px;align-items:baseline;padding:7px 0;border-top:1px solid var(--line);font-size:14px}
.ticker:first-child{border-top:0;padding-top:0}
.ticker:last-child{padding-bottom:0}
.ticker .sym{flex:1 1 auto;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ticker .px,.ticker .delta{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.ticker .delta{min-width:56px}
/* tiles inside a mock on one hairline grid: two columns, .three for three */
.mock-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);
  border:1px solid var(--line);border-radius:6px;overflow:hidden}
.mock-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
.mock-grid > *{background:var(--surface);padding:10px 12px;min-width:0}

/* ---- colour utilities for html fences ----
   The one place besides syntax tokens where a glyph may carry colour. The
   renderer wraps every html fence in .fence (display:contents, so layout is
   unchanged) and these rules are scoped to it, so prose stays white. Palette
   only: the eight series slots and the status tokens. Colour in a mock means
   something (up, down, a series); never decoration. */
.fence{display:contents}
.fence :is(.up,.good):not(.note,.chip){color:var(--good)}
.fence :is(.down,.bad,.critical):not(.note,.chip){color:var(--critical)}
.fence .warn:not(.note,.chip){color:var(--warn)}
.fence .serious{color:var(--serious)}
.fence .c1{color:var(--s1)} .fence .c2{color:var(--s2)} .fence .c3{color:var(--s3)} .fence .c4{color:var(--s4)}
.fence .c5{color:var(--s5)} .fence .c6{color:var(--s6)} .fence .c7{color:var(--s7)} .fence .c8{color:var(--s8)}
.fence .delta{font-weight:600;font-variant-numeric:tabular-nums}
.fence .pill{display:inline-flex;align-items:center;gap:7px;padding:2px 10px;border-radius:999px;
  background:#262624;white-space:nowrap;font-size:13px;line-height:1.4}
/* washes: the tone at 14% over the surface, for chips and rows; text stays white unless a tone is added */
.fence .bg-c1{--wash:var(--s1)} .fence .bg-c2{--wash:var(--s2)} .fence .bg-c3{--wash:var(--s3)}
.fence .bg-c4{--wash:var(--s4)} .fence .bg-c5{--wash:var(--s5)} .fence .bg-c6{--wash:var(--s6)}
.fence .bg-c7{--wash:var(--s7)} .fence .bg-c8{--wash:var(--s8)}
.fence .bg-up{--wash:var(--good)} .fence .bg-down{--wash:var(--critical)} .fence .bg-warn{--wash:var(--warn)}
.fence [class*="bg-"]{background:color-mix(in srgb,var(--wash) 14%,transparent)}
/* dots: an 8px disc before the text */
.fence .dot-c1{--dot:var(--s1)} .fence .dot-c2{--dot:var(--s2)} .fence .dot-c3{--dot:var(--s3)}
.fence .dot-c4{--dot:var(--s4)} .fence .dot-c5{--dot:var(--s5)} .fence .dot-c6{--dot:var(--s6)}
.fence .dot-c7{--dot:var(--s7)} .fence .dot-c8{--dot:var(--s8)}
.fence .dot-up{--dot:var(--good)} .fence .dot-down{--dot:var(--critical)} .fence .dot-warn{--dot:var(--warn)}
.fence [class*="dot-"]::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;
  background:var(--dot);margin-right:7px;vertical-align:.08em}

/* ---- footnotes ---- */
sup.fn{font-size:.72em;line-height:0}
sup.fn a{text-decoration:none;color:#5c9cf0}
ol.footnotes{font-size:14.5px;color:var(--ink);margin:8px 0 0;padding-left:22px}
ol.footnotes li{margin:5px 0}
ol.footnotes a.fn-back{text-decoration:none;color:var(--ink);margin-left:4px}
ol.footnotes a.fn-back:hover{color:var(--ink)}

/* ---- sources ---- */
.sources{font-size:14.5px;color:var(--ink);padding-left:20px}
.sources li{margin:4px 0}
.sources a,.sources code{color:var(--ink)}

@media (max-width:520px){
  body{font-size:16px}
  h1{font-size:34px} h2{font-size:22px}
  .wrap{padding:36px 18px 72px}
  /* A path keeps one row: the directory ellipsizes so the file name stays whole.
     A title after a path drops to its own line, and the language beside a path
     shows as its icon alone (the label is still in the DOM). */
  .code-head{flex-wrap:nowrap}
  .code-name{flex:1 1 auto}
  .code-path{flex:0 1 auto}
  .p-dir{min-width:2ch;overflow:hidden;text-overflow:ellipsis}
  .p-name{flex:none}
  .code-title{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .code-range{flex:none}
  .code-name + .code-tools .code-lang{font-size:0;gap:0}
  /* A file's actions drop under its name, lined up with the text. */
  .file{flex-wrap:wrap;align-items:flex-start;gap:10px 12px;padding:14px}
  .ft-icon{margin-top:1px}
  .fc-main{flex-basis:calc(100% - 36px)}
  .fc-actions{flex-basis:100%;justify-content:flex-start;padding-left:36px}
}
/* ---- paper: the same palette inverted, so every var(--ink) glyph prints black on white ---- */
@page{size:auto;margin:14mm 13mm}
@media print{
  :root{color-scheme:light;--bg:#fff;--surface:#f2f2ef;--surface-2:#e8e8e4;--line:#d4d4cf;--line-strong:#9a9a94;--ink:#000;
    --mark:#6f6f6a;--grid:#dcdcd7;--axis:#9a9a94;--warn:#a86b00}
  html,body{background:#fff;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-size:11.5pt;line-height:1.45}
  .wrap{max-width:none;padding:0}
  h1{font-size:24pt;margin-top:0}
  .contents,.code-tools,.cx-set,.cx-reset,.slides .arrow,.lightbox,.sprite,.fc-actions,.mf-actions,
  button.copy{display:none!important}
  a{color:#0b4fb3}
  /* Dark-only fills: chips, pills and the done box take the light surface. */
  .chip,.fc-pill,.fence .pill{background:var(--surface-2)}
  ul.tasks li.done .box{background:#9a9a94;border-color:#9a9a94}
  .note{border-left-color:#9a9a94}
  /* Syntax tokens darkened to hold contrast on the light surface. */
  .code pre,.t-punc,.diff-lines li{color:#2b2b2b}
  .t-kw{color:#7a2fa0} .t-str,.t-regex{color:#2d6b16} .t-num,.t-const,.t-attr,.t-flag{color:#9a4f00}
  .t-fn{color:#1d5bb8} .t-type,.t-meta{color:#8a6100} .t-var,.t-this,.t-prop,.t-key,.t-tag{color:#b3262f}
  .t-op,.t-esc{color:#0d7480} .t-com{color:#5f5f5a}
  .diff-lines .d-add{color:#2d6b16;background:#e6f2df} .diff-lines .d-del{color:#b3262f;background:#f7e1e2}
  /* Figures keep their dark palette and print inverted: black planes turn white, white glyphs
     black, and hue-rotate puts the series and tone colours back on their own hue. */
  svg.chart{--ink:#fff;--mark:#898781;--grid:#2c2c2a;--axis:#383835;--surface:#1a1a19;--line:#2c2c2a;
    --line-strong:#383835;filter:invert(1) hue-rotate(180deg)}
  /* Everything prints at the page width: no sideways scrolling on paper. */
  .tbl-wrap,.fig-scroll,.code pre{overflow:visible}
  .tbl-wrap.wide{width:auto;max-width:none}
  svg.chart{min-width:0!important;max-width:100%}
  .code pre{white-space:pre-wrap;overflow-wrap:anywhere}
  .code pre > code{width:auto}
  /* Keep a block in one piece and a heading with what follows it. */
  h1,h2,h3,h4{break-after:avoid;page-break-after:avoid}
  .fig,.cv,.note,.code,.stat,.hero,img,svg,tr,.file,.timeline li{break-inside:avoid;page-break-inside:avoid}
  .fig-title,.cx-hd,.cx-tabs,.legend{break-after:avoid;page-break-after:avoid}
  thead{display:table-header-group}
  p,li{orphans:3;widows:3}
}
`;

const escText = (v) =>
  String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The document glyph both favicons share: a white page with a folded corner and three lines. */
const FAVICON_GLYPH =
  '<path d="M22 13h13l10 10v25a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3z" fill="#fff"/>' +
  '<path d="M35 13l10 10h-8a2 2 0 0 1-2-2v-8z" fill="#c7d2fe"/>' +
  '<rect x="24" y="29" width="16" height="3" rx="1.5" fill="#a5b4fc"/>' +
  '<rect x="24" y="36" width="16" height="3" rx="1.5" fill="#a5b4fc"/>' +
  '<rect x="24" y="43" width="10" height="3" rx="1.5" fill="#a5b4fc"/>';

/** The postplan.dev favicon: indigo rounded square. Opt-in with `icon: indigo`. */
export const FAVICON_INDIGO =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#4f46e5"/>${FAVICON_GLYPH}</svg>`;

/** True-black square with a 2px #383835 edge (inset 1px so the stroke is not clipped). The default. */
export const FAVICON_BLACK =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="13" fill="#000" stroke="#383835" stroke-width="2"/>${FAVICON_GLYPH}</svg>`;

/** Frontmatter `icon:` values, first is the default. */
export const FAVICONS = { black: FAVICON_BLACK, indigo: FAVICON_INDIGO };

/** @typedef {keyof typeof FAVICONS} Icon */

/**
 * Wrap body HTML in a complete, self-contained document: one <style>, no
 * external stylesheet, no webfont. The only script is the inline one a body
 * with code blocks, file chips, media or a slideshow brings for copying,
 * revealing media failure panels and paging slideshows.
 *
 * @param {{ title: string, body: string, generator?: string, icon?: Icon }} opts
 *   `title` is the tab title as given, never suffixed. `icon` picks the
 *   favicon, embedded as a data: URI (default `black`). `generator` is stamped as `<meta name="generator">` so a reader (and
 *   `postplan upload`) can tell a rendered document from a hand-written one.
 * @returns {string}
 */
export function page({ title, body, generator, icon = "black" }) {
  const t = escText(title);
  // The SVGs are ASCII, so btoa (present in Node and the browser) is enough.
  const favicon = `data:image/svg+xml;base64,${btoa(FAVICONS[icon])}`;
  const stamp = generator ? `\n<meta name="generator" content="${escText(generator)}">` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">${stamp}
<title>${t}</title>
<link rel="icon" type="image/svg+xml" href="${favicon}">
<style>${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}
