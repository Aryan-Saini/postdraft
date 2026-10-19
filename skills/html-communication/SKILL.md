---
name: html-communication
description: When communicating a plan, spec, write-up, findings or UI mocks as a readable document, or when user says "create a doc", use skill.
metadata:
  requires: "npx, and postplan-aryan auth in ~/.postplan (see SETUP.md in Aryan-Saini/postdraft)"
---

# HTML Communication

## 1 · When to use, and the default path

For a plan, spec, write-up, findings, summary, report, comparison or set of UI
mocks meant to be read as a document. Not for HTML that ships in a product.
**Write Markdown. Do not write HTML.**

```bash
npx postplan-aryan@latest render plan.md    # optional: preview plan.html first
npx postplan-aryan@latest upload plan.md    # renders, publishes, prints the URL
```

`upload plan.md` renders to `plan.html` and publishes that, but remembers the
draft under `plan.md`: re-upload the same `.md` and the URL stays, the version
bumps. The renderer owns typography, colour, spacing, chart geometry and the
SVG; you own words, structure and numbers. **Never write CSS, never
hand-position an SVG, never set a font or a colour.** Section 11 is the one
exception.

## 2 · Document format (always applies)

Frontmatter, the lead, then sections.

```markdown
---
title: Q3 warehouse plan
byline: Jane Doe
date: Sep 22, 2026
status: On track
---

Pick-to-ship is 41 hours against a 24 hour target, and the whole gap is putaway.
```

Those four keys become the byline chips under the title. Two optional keys set
the browser tab only: `tab:` (the `<title>`, max 80 chars; `title:` stays the h1)
and `icon: black | indigo` (favicon, default `black`). No other keys are allowed.
A status reading blocked/critical/fail turns the dot red,
risk/warn/late amber, anything else green.

**The lead is the answer:** the first paragraph says what the reader came for,
not a preamble, a scope note or a summary of what follows.

**Headings.** `##` is a section and builds the contents strip, so a document
wants three to eight. `###` is a subsection, `####` a small sans label. Never
skip a level; `#` is unnecessary, the frontmatter title is the `h1`.

**Lists.** Ordered nests `1.` → `a.` → `i.`, bulleted disc → circle → square,
both by two-space indent, tasks are `- [ ]` and `- [x]`. Bullets carry parallel
items only; anything with a because-clause is a paragraph.

**Table, chart or sentence.** Two or three numbers are a sentence. Six or fewer
with no time axis, or values a reader looks up one at a time, are a table. Five
or more with a shape (a trend, a ranking, a split) are a chart. Never both for
the same numbers.

**Inline marks.** `**bold**` `*italic*` `~~struck~~` `==highlight==`
`++underline++` `` `code` `` `H~2~O` `r^2^` `[text](url)` `[^1]` `$E = mc^2$`.
**Containers**, closed with `:::`: `::: center`, `::: right`, `::: subtext` (a
step down in size, not colour), `::: columns` (blank-line-separated paragraphs
become columns, collapsing under 520px).

**Voice.** Sentence case, short sentences, no em dashes, no marketing, no "it's
worth noting". Sources and caveats go last, under `## Sources`. **No grey text.
Every glyph is white; hierarchy is size and weight.** Figure notes are
fragments, not sentences: "September is partial", not "Note that September is
partial through the 22nd and should be read with care."

## 3 · Need a chart

One fence per chart. Every kind takes the same envelope (`title`, `note`,
`caption`, `format`) plus its own data keys. Keep data inline up to roughly 50
rows; past that put the JSON in a file beside the document and point at it with
`"src": "rows.json"`. At most **8 series or parts**; fold the tail into "Other"
or use `small-multiples`. `format` is `int` `compact` `usd` `pct` `ms`, where
`pct` takes a fraction (`0.031` renders `3.1%`). Tones: `good warn bad flat`.

Value labels on `delta`, `waterfall` and `funnel` take the mark's tone (green up, red down, honouring `higherIsBetter`); a series `"tone":"good|bad|warn|flat"` colours its line and end label. Ticks and axis labels stay white.

````markdown
```chart columns
{"title":"Orders shipped","note":"September is partial","format":"int",
 "labels":["Jul","Aug","Sep"],"values":[812,904,1130]}
```
````

The other thirteen kinds take that fence and envelope with this body:

```jsonc
// bars / funnel / share: a ranking, an ordered drop-off, a strip instead of a pie
{"labels":["Plans","Findings","Other"],"values":[412,298,108]}
// delta:     signed change against zero; higherIsBetter flips the colours
{"labels":["Validate","Serve"],"values":[-3,26],"higherIsBetter":false}
// waterfall: a bridge; totals lists the label indices that are totals
{"labels":["Aug","New","Churn","Sep"],"values":[168,34,-41,121],"totals":[0,3]}
// lines:     a trend; area fills under it, zeroFloor pins the axis to 0
{"labels":["W1","W2","W3"],"series":[{"name":"p50","values":[284,303,297]}],"area":true}
// grouped / stacked / small-multiples: same labels + series shape as lines
{"labels":["Q3","Q4"],"series":[{"name":"Created","values":[42,51]},{"name":"Updated","values":[18,22]}]}
// whisker:   lo <= mid <= hi, one of each per label
{"labels":["Serve"],"mid":[96],"lo":[58],"hi":[1340]}
// heatmap:   values is one row of numbers per row label
{"rows":["Mon","Tue"],"cols":["00","12"],"values":[[1,14],[0,16]]}
// scatter:   points with an optional bubble size
{"xTitle":"Minutes","yTitle":"KB","points":[{"x":24,"y":102,"size":9,"label":"Plans"}]}
// log axes:  lines and scatter take xScale / yScale linear|log2|log10; lines takes numeric x,
//            which a log x needs; a dashed series is a reference line
{"xScale":"log2","yScale":"log2","x":[1,4,16,64],"series":[{"name":"Ideal","values":[1,4,16,64],"dashed":true}]}
// ML lines:  each series may carry its own points instead of labels / x (ROC, train vs val);
//            refs: "diagonal" | {"y":n,"label"?} | {"x":n,"label"?}; square makes the plot 1:1
{"xTitle":"FPR","yTitle":"TPR","square":true,"refs":["diagonal"],"series":[{"name":"AUC 0.91","points":[[0,0],[0.1,0.7],[0.3,0.88],[1,1]]}]}
// ML heatmap: emphasis "diagonal" outlines row = col cells (a confusion matrix); decimals 0..6
//            prints every cell to that many places (attention weights) and replaces format
{"rows":["cat","dog"],"cols":["cat","dog"],"values":[[88,12],[9,91]],"emphasis":"diagonal"}
// ML scatter: series [{name, points, tone}] colour groups with a legend; marks [{at:[x,y],label}] are crosses
{"series":[{"name":"sports","points":[[1,2],[1.4,2.2]]},{"name":"finance","points":[[5,6],[5.3,5.8]]}],"marks":[{"at":[1.2,2.1],"label":"k1"}]}
// schedule:  ISO dates, ticks fall on month boundaries
{"tasks":[{"label":"Convex backend","start":"2026-08-14","end":"2026-08-29","done":true}]}
// annotated scatter: a series point may be [x, y, "name"]; labels names them beside the dot
//            (a label that would collide is left to hover); pareto joins the points nothing
//            beats toward a corner; quadrant shades that corner from the median of each axis
{"labels":true,"pareto":"top-left","quadrant":"top-left","series":[{"name":"Atlas","points":[[20,58,"Ultra"],[0.4,44,"Mini"]]}]}
```

**Switchable charts.** When a reader should flip between metrics, scales or a
table, add `views` and/or `controls` to any kind but `share`. `views` is 2 to 6
tabs over one chart slot: each is a `label` plus the keys it changes (series,
values, x, axis titles, scales, format, note; never the title). `controls` puts
a settings icon top right with these switches:

| Control | Kinds | Switches |
| --- | --- | --- |
| `log-x`, `log-y` | lines (log-x needs `x` or points), scatter | the axis between linear and log for every view; the chart's own scale is the default, and a view cannot set its own |
| `sort` | bars, columns | authored order or largest first |
| `labels`, `pareto`, `quadrant` | scatter | that annotation, which the body must already draw |
| `legend` | lines, scatter, 2+ series with the same names, tones and dashes (and the same annotations) in every view | clicking a key hides that series and its point labels |
| `table` | everything but whisker, heatmap, schedule, small-multiples | the plot for its numbers |

````markdown
```chart scatter
{"title":"Intelligence vs cost and speed","yTitle":"Index","xTitle":"Cost (USD)","xScale":"log10",
 "labels":true,"pareto":"top-left",
 "series":[{"name":"Atlas","points":[[20,58,"Ultra"],[0.4,44,"Mini"]]},{"name":"Dune","points":[[0.9,52,"R2"]]}],
 "views":[{"label":"vs Cost"},
          {"label":"vs Speed","xTitle":"Tokens/s","pareto":"top-right",
           "series":[{"name":"Atlas","points":[[52,58,"Ultra"],[190,44,"Mini"]]},{"name":"Dune","points":[[64,52,"R2"]]}]}],
 "controls":["log-x","labels","pareto","legend","table"]}
```
````

A view overrides keys but cannot remove one, so every view keeps the base
shape: put `points` series in every view or in none. The Pareto frontier and
quadrant cover every series, whichever are hidden. Every state is drawn ahead
of time and switched with CSS, so it works with scripts off. Views times log toggles times sort is at most 12 charts; each
panel is validated, and an error names the view and scale it came from
(`chart lines (view "Val", log y): ...`). Use log as a toggle when only the
scale changes and as its own view when it rides along with a different metric.

## 4 · Need a stat tile or a hero number

`stats` is a dense grid, `hero` one big centred number, same body either way:
tiles of `k` label, `v` number, `as` as-of line, `delta` change text, `tone`,
`spark` (two or more points), `meter` `{max}`.

````markdown
```hero
[{"k":"Net burn","v":412000,"format":"usd","as":"Aug 2026","delta":"-6.0% vs July","tone":"good"}]
```

```stats
[{"k":"Documents","v":1284,"format":"int","delta":"+18.4% vs August","tone":"good","spark":[61,78,96,142,168,121]},
 {"k":"Largest","v":486,"format":"int","delta":"95% of the cap","meter":{"max":512}}]
```
````

## 5 · Need code or a diff

A plain fence with a language is highlighted. `file=` or `title=` adds a header,
the bare word `lines` numbers them. Languages: `ts js py sh sql rust go json
yaml html xml css md toml` plus the usual aliases; anything else renders
escaped.

````markdown
```ts file=src/upload.ts lines
export async function upload(html: string) {
  return post("/api/uploads", { html });
}
```

```diff title="Add a CSP to served drafts"
-  "Cache-Control": "private, max-age=30",
+  "Content-Security-Policy": "default-src 'none'"
```
````

## 6 · Need a diagram

Every diagram is a JSON fence laid out by the renderer: never give coordinates.
Mermaid does not render here. Pick the fence by what you are drawing:

| Drawing | Fence |
| --- | --- |
| Request path, pipeline of steps, decision flow | `flow` |
| Calls between services in order | `sequence` |
| Any rooted tree: processes, recursion, reduce/scan, decision, parse | `tree` |
| DAG, critical path, dependencies, state machine, automaton, computation graph | `graph` |
| Process timelines with messages between them | `lanes` |
| Linked list, array with index pointers, stack | `structure` |
| Rows by time steps: CPU pipeline, per-step schedule | `pipeline` |
| Memory hierarchy, protocol stack | `layers` |
| Tables and references | `er` |
| Sorting network | `sortnet` |
| Ring, mesh, torus, hypercube, star, complete, tree interconnect | `topology` |
| Flow volumes between stages | `sankey` |
| Token row: dependency parse, subword spans, POS/NER tags, attention, alignment | `tokens` |
| Fully connected network, autoencoder | `nn` |
| Tensor shapes through a CNN | `tensors` |
| HMM / Viterbi lattice | `trellis` |
| Transformer or ResNet block, unrolled RNN | `graph` with `groups`, `fill`, `rank` |
| Confusion matrix, ROC/PR, loss curves, embedding clusters | `chart` (section 3 and below) |

Every fence below takes `title`, `note` and `compact`. Tones are `good warn bad
flat span c1`…`c8` (`span` is the critical-path amber). Consecutive fences with
`"compact": true` share a row, for snapshots and small multiples. Unknown keys
fail the render.

**Limits**, each reported at the fence when crossed: one diagram or chart may
render to 320 KB. `tree` 400 nodes, 32 deep, 32 cells a node. `graph` 150 nodes, 300
edges, no control characters in ids. `lanes` 24 lanes, 200 segments a lane, 100
messages, names up to 40 characters, times within ±1e9. `structure` 64 cells,
64 pointers. `pipeline` 64 rows, 128 steps, 2048 filled cells. `layers` 32.
`er` 24 tables (no dots in names), 40 fields each, 100 links. `sortnet` 32
wires, 64 layers. `topology` paths of 128 hops. `sankey` 2 to 100 nodes, 400
links, values 1e-9 to 1e15. `lanes` segments span at least 1e-6 in total;
`structure` `start` stays within ±1e9. Log axes take values from 1e-100 to
1e100; a numeric `x` takes up to 1000 values within ±1e15 spanning at least 1e-300.
`graph` 16 groups, ranks 0 to 149. `tokens` 64 tokens, 128 arcs, 6 tag rows, 64
spans, 512 alignment links, weights 0 to 1, 8 BIO entity types; tokens and arc
and span labels up to 40 characters, tag names and tags 24. `nn` 2 to 12
layers of up to 1e6 neurons (over 12 collapse round an ellipsis), 64 dropout
pairs, input and output labels 24 characters, names 40. `tensors` 12 stages,
dims 1 to 1e6, ops and labels 24 characters. `trellis` 2 to 8 states, 16
observations, labels 16 characters. `chart heatmap` 40 rows and cols; `chart
lines` points and `chart scatter` series up to 1000 points each (2000 in a
scatter), 8 refs, 32 marks, 300 labelled points with labels up to 60 characters;
a linear axis spans or reaches at least 1e-300. `views` 2 to 6, tab labels 40
characters, 12 panels in all.

### flow and sequence

````markdown
```flow
{"title":"Publish path","note":"Rejection precedes storage",
 "cols":[[{"id":"cli","label":"CLI upload","shape":"round"}],
         [{"id":"val","label":"Validate","shape":"diamond"}],
         [{"id":"s3","label":"S3","shape":"store"},{"id":"err","label":"400 rejected","tone":"bad"}]],
 "edges":[{"from":"cli","to":"val"},{"from":"val","to":"s3","label":"ok"},
          {"from":"val","to":"err","label":"reject"}]}
```

```sequence
{"title":"Upload and read","actors":["Agent","Convex","S3"],
 "msgs":[{"from":"Agent","to":"Convex","label":"POST /api/uploads"},
         {"from":"Convex","to":"S3","label":"PUT html"},{"from":"S3","to":"Convex","label":"200","dashed":true}]}
```
````

Flow shapes are `box` `round` `diamond` `store`. Node ids are unique across all
columns and every edge endpoint must name one; sequence endpoints must name a
declared actor.

### tree

Shorthand or nested nodes; no ids. Values can flow along edges: `up` goes to
the parent in red, `down` comes from it in blue, and `{"v":5,"step":2}` puts a
numbered badge at the sending end, so the picture says who sent first. The
root's `up` is the tree's output.

````markdown
```tree
{"title":"Scan","shape":"circle","tree":{"children":[
  {"up":{"v":5,"step":2},"down":{"v":0,"step":3},"children":[
    {"shape":"cells","cells":[2,1],"up":{"v":3,"step":1},"down":{"v":0,"step":4},"below":"0 2"},
    {"shape":"cells","cells":[3,-1],"up":{"v":2,"step":1},"down":{"v":3,"step":4},"below":"3 6"}]}]}}
```
````

`tree` is `"Root(A,B(C,D))"` (labels hold anything but `( ) ,`) or a node.
`dir` `down` `up` `right` `left`. `layout` `tidy`, `spine` (a parent sits on
its first child: Schwartz trees) or `leaves` (every leaf on the bottom row:
parse trees). `shape` `box` `round` `circle` `ellipse` `dot` `cells` `text`
(a bare label, no outline; its tone colours the words). `arrows`
`none` `toParent` `toChild`. `levels` captions each depth. `until: k` shows
steps up to k without moving anything, for snapshots. `mono`. Node keys:
`label` `children` `shape` `tone` `mono` `below` `belowTone` `edge` (label on
the edge from the parent) `cells` (with shape `cells`) `up` `down`. At most 400
nodes, 32 deep.

### graph

Nodes and edges only; the renderer layers them. Cycles are found and drawn as
dashed loops round the outside, a self-edge is a small loop, parallel edges
merge into one arrow labelled `a, b`, and a pair `a->b` `b->a` becomes two bowed
curves. `step` badges an edge near its source.

````markdown
```graph
{"title":"Ends in ab","dir":"right",
 "nodes":[{"id":"q0","shape":"circle","start":true},{"id":"q1","shape":"circle"},{"id":"q2","shape":"double","tone":"good"}],
 "edges":[{"from":"q0","to":"q0","label":"b"},{"from":"q0","to":"q1","label":"a"},{"from":"q1","to":"q1","label":"a"},
          {"from":"q1","to":"q2","label":"b"},{"from":"q2","to":"q1","label":"a"},{"from":"q2","to":"q0","label":"b"}]}
```
````

`dir` `down` `right`. Node: `id` `label` `shape` (`box` `round` `circle`
`double` `dot` `diamond`) `tone` `start` (entry arrow) `side` (annotation)
`mono` `fill` (a tone wash inside) `below` (a mono caption under the node, such
as `q = 6`) `rank` (pins the node to a layer; equal ranks share a row and the
edges between them run straight across). Edge: `from` `to` `label` `tone`
`dashed` `step` `back` (mark the backward one when every node has edges both
ways, as with gradients). Body: `mono` (every label in the code face) and
`groups` [{`label` `nodes` `tone`}], a dashed outline round repeated blocks. A
long edge that would cross the nodes it skips detours round the side: residual
and skip connections.

````markdown
```graph
{"title":"Transformer encoder block",
 "nodes":[{"id":"in","label":"input + pos","shape":"round"},{"id":"mha","label":"multi-head attention","fill":"c1"},
  {"id":"add","label":"add & norm"},{"id":"out","label":"output","shape":"round"}],
 "edges":[{"from":"in","to":"mha"},{"from":"mha","to":"add"},{"from":"in","to":"add","label":"residual"},{"from":"add","to":"out"}],
 "groups":[{"label":"x 6","nodes":["mha","add"]}]}
```
````

### lanes

One row per process, state segments over time, dashed arrows for messages.
States colour themselves: `busy` blue, `send` green, `recv` violet, `blocked`
red, `idle` grey. A segment label that does not fit is dropped.

````markdown
```lanes
{"title":"Message passing is asynchronous","axis":"time (ms)",
 "lanes":[{"name":"Pid1","segs":[{"from":0,"to":2,"label":"Pid2 ! Msg","state":"send"},{"from":2,"to":6,"label":"busy"}]},
          {"name":"Pid2","segs":[{"from":0,"to":4,"label":"busy"},{"from":4,"to":6,"label":"receive","state":"recv"}]}],
 "msgs":[{"from":{"lane":"Pid1","t":1.5},"to":{"lane":"Pid2","t":4.2},"label":"Msg"}]}
```
````

`lanes` [{`name`, `segs` [{`from` `to` `label` `state`}]}], `msgs` [{`from`
{`lane` `t`}, `to` {`lane` `t`}, `label`, `step`}], `axis` (draws time ticks).

### structure

`list` chains `[value | next]` cells: `head` names the entry pointer, `doubly`
adds prev arrows, `cycle` bends the last next back to an index. `array` prints
indices from `start` and draws named pointers under cells. `stack` is a column,
top first.

````markdown
```structure
{"kind":"array","cells":[2,5,8,12,16],"pointers":[{"name":"lo","at":0,"tone":"c1"},{"name":"mid","at":2,"tone":"warn"}]}
```
````

`kind` `list` `array` `stack`. list: `cells` [{`v` `label` `tone`}] `head`
`doubly` `cycle`. array: `cells` [value or {`v` `tone`}] `pointers` [{`name`
`at` `tone`}] `start`. stack: `cells` `top`.

### pipeline, layers, er

````markdown
```pipeline
{"title":"Load-use stall","rows":[
 {"label":"lw r1,0(r2)","cells":["IF","ID","EX","MEM","WB"]},
 {"label":"add r3,r1,r4","start":1,"cells":["IF","ID","stall","EX","MEM","WB"]}]}
```

```layers
{"title":"Memory hierarchy","items":[{"label":"Registers","note":"< 1 ns"},{"label":"L1","note":"1 ns"},{"label":"DRAM","note":"80 ns"}]}
```

```er
{"entities":[{"name":"users","fields":[{"name":"id","type":"uuid","key":"pk"},["email","text"]]},
             {"name":"posts","fields":[{"name":"id","type":"uuid","key":"pk"},{"name":"user_id","type":"uuid","key":"fk"}]}],
 "links":[{"from":"posts.user_id","to":"users.id","card":"N:1"}]}
```
````

`pipeline`: `rows` [{`label` `start` (0-based column) `cells` (text or
`null`)}], `cycles`, `stall` (default `"stall"`, drawn as a dashed bubble);
each distinct cell text gets a colour, 8 at most. `layers`: `items` [{`label`
`note` `tone`}] top to bottom, `shape` `pyramid` or `stack`. `er`: `entities`
[{`name` `fields` ([name, type] or {`name` `type` `key`: `pk`|`fk`})}],
`links` [{`from` `to` as `table.field`, `card` like `N:1`}].

### sortnet, topology, sankey

````markdown
```sortnet
{"title":"Odd-even transposition","inputs":[3,1,2],"layers":[[[0,1]],[[1,2]],[[0,1]]]}
```

```topology
{"kind":"hypercube","size":3,"path":[0,1,3,7],"compact":true}
```

```sankey
{"nodes":[{"id":"in","label":"Ingress"},{"id":"api","label":"API"},{"id":"cdn","label":"CDN"}],
 "links":[{"from":"in","to":"api","value":900},{"from":"in","to":"cdn","value":300}]}
```
````

`sortnet` runs the network: a comparator `[a, b]` leaves the min on wire `a`,
swaps show red, values print after each step (`values: false` hides them).
`topology` `kind` `ring` `line` `mesh` `torus` `hypercube` `star` `complete`
`tree`, `size` (count, side, dimension or depth), `labels` `index` `binary`
`coords`, `path` (a route, checked hop by hop). `sankey` `nodes` [{`id`
`label` `tone`}], `links` [{`from` `to` `value`}], `format`; cycles are rejected.

### tokens

A row of token boxes with NLP structure around it. `arcs` go above the row:
dependency arcs point head to dependent with the label on the arch, nested by
span. `root` drops an arrow into one token. With `weights: true` arcs become
attention links whose width and opacity follow `weight`. `spans` bracket
ranges under the row (subword pieces of one word). `tags` adds named rows under
the row; a BIO row (B-X, I-X, O) becomes one coloured bar per entity. For
alignment, give `rows` (exactly two) and `links` instead of `tokens`. Long rows
scroll sideways at full size.

````markdown
```tokens
{"tokens":["The","cat","sat"],"root":2,
 "arcs":[{"from":2,"to":1,"label":"nsubj"},{"from":1,"to":0,"label":"det"}],
 "tags":{"POS":["DET","NOUN","VERB"]}}
```
````

`tokens`, `arcs` [{`from` `to` `label` `tone` `weight`}], `root`, `weights`,
`tags` {name: [one per token]}, `spans` [{`from` `to` (inclusive) `label`
`tone`}], `rows` [{`name` `tokens`}] with `links` [[i, j, weight]].

### nn, tensors, trellis

````markdown
```nn
{"layers":[3,4,4,2],"inputs":["x1","x2","x3"],"outputs":["y1","y2"],"names":["input","hidden 1","hidden 2","output"]}
```

```tensors
{"stages":[{"dims":[224,224,3],"label":"image"},{"op":"conv 7x7 /2","dims":[112,112,64]},{"op":"avgpool","dims":[512]}]}
```

```trellis
{"states":["Hot","Cold"],"obs":["3","1","3"],"start":"π","scores":[[0.32,0.0384,0.0184],[0.02,0.064,0.0019]],"path":[0,1,0]}
```
````

`nn` draws a fully connected network from `layers`; a layer over 12 neurons
shows its first and last 5 round an ellipsis and every column prints its true
size. `inputs` and `outputs` label the first and last layer, `names` caption
each column, `tones` colour each layer, `weights: true` shades edges with
seeded illustrative weights (blue positive, orange negative), `dropout`
[[layer, neuron]] draws neurons hollow. `tensors` draws `stages` left to right:
`dims` [h, w, c] is a box with channels as depth, [h, w] a face, [n] a bar,
sized on a log scale; `op` labels the arrow into a stage, `label` sits under
it. `trellis` puts `states` down the side and `obs` across the top; `scores`
(states x obs) print in the nodes, `path` (one state index per column) draws
the best path, `transitions: "path"` drops the faint all-pairs edges.

## 7 · Need a formula

`$…$` inline, `$$…$$` on its own lines, or a `math` fence. All three become
MathML through temml: no image, no bundle, selectable text.

> **The `$` heuristic.** A `$` followed by a digit or a space is money or prose,
> never math, so `$412k` and `$ 5` stay literal. A formula that *starts* with a
> digit needs `$$…$$` or a `math` fence.

```markdown
Half-life is $t_{1/2} = \frac{\ln 2}{\lambda}$, and the p95 bound is

$$
p_{95} = \mu + 1.645\,\sigma
$$
```

Notation: `\frac{a}{b}` `\sqrt{x}` `x^{2}` `x_{i}` `\sum_{i=1}^{n}` `\int_0^\infty`
`\alpha \beta \mu \sigma \lambda \Delta` `\times \cdot \le \ge \ne \approx`
`\text{bytes}` `\mathrm{kg}`.

## 8 · Need an image, a screenshot, a slideshow or a video

The document carries no local files. **Publish the asset first with the
`file-upload` skill**, then use the https URL it returns; that URL is public and
permanent, so treat it like a PR screenshot. Publish with `postplan asset` and paste the URL. The title `zoom` makes a figure a
click-to-enlarge lightbox, and the alt text is the caption.
Every image, slide, poster and clip src must be an https URL from `file-upload` or a `data:` URI; relative paths do not render and fail the build.

```markdown
![Dashboard after the S3 move · captured Sep 21](https://…/dash.png "zoom")
```

````markdown
```slides
[{"src":"https://…/1.png","caption":"The list view before the change"},
 {"src":"https://…/2.png","caption":"After"}]
```

```video
{"src":"https://…/clip.mp4","poster":"https://…/poster.png","caption":"Upload flow, 0:42"}
```
````

Always mp4, never webm, which iPhone Safari will not play, and always a poster
frame (`ffmpeg -ss <seconds> -i clip.mp4 -frames:v 1 poster.png`). Never a bare
link instead, which reads as though there is no video.

If an image fails at view time the reader sees a labelled panel with Open and Copy; publish with file-upload so links never expire.

**Need a download** (a build, an archive, an export): a `file` fence, one object or a list.
Publish with `postplan asset` and paste the URL.
Use it for anything the reader should download; set `expires` when the link will stop working
and the card shows the date, a countdown inside 48 hours, and an expired state after.

```file
[{"src":"https://…/acme-1.4.2.apk","name":"acme-1.4.2.apk","size":48213333,
  "expires":"2026-09-26T21:00:00Z","note":"Internal build, Android 12+"},
 {"src":"https://…/export.zip","name":"export.zip","size":3100000}]
```

The type icon, the `48.2 MB · APK · Android package` line and Download / Open / Copy come
from the name; `kind` overrides the extension. A signed S3 URL gets its expiry read automatically.

## 9 · Need a callout, a toned table, a timeline or a footnote

```markdown
> [!NOTE] Context
> A rule and a label, not a tinted card.
```

Tones are `NOTE` `GOOD` `WARN` `CRITICAL`, with the GitHub aliases (`TIP`,
`IMPORTANT`, `CAUTION`, `DANGER`) mapping onto them; the text after the tag is
the label. A table cell prefixed `good:` `warn:` `bad:` `flat:` takes that
colour and the prefix is stripped. Right-align numbers with `---:`.

```markdown
| Stage | p95 (ms) | Error rate |
| --- | ---: | ---: |
| Serve | 1,340 | bad:4.8% |
```

````markdown
```timeline
[{"when":"Aug 12","what":"Forked postplan","state":"done","note":"Vendored unmodified."},
 {"when":"Sep 22","what":"This page","state":"now"},{"when":"Next","what":"Fold into the skill"}]
```
````

`when` is display text, not a date: a timeline reads in the order you write it,
unlike `chart schedule`, drawn to scale. States: `done` `now` `next`. Footnotes
are `[^1]` in the text and `[^1]: The note.` on its own line, collected at the
end.

## 10 · Need the reader to answer

A `question` fence is one question with a real input. Use it for practice sets,
quizzes and anything the reader should answer in the document itself.

````markdown
```question
{"id":"stable","kind":"choice","prompt":"Which one is a **stable** sort?",
 "options":["Quicksort","Merge sort","Heapsort"],"answer":"Merge sort",
 "explain":"Merge takes from the left run on ties."}
```
````

| Kind | Input | `answer` | Checked how |
| --- | --- | --- | --- |
| `short` | one line | text | revealed, not graded |
| `long` | textarea | text | revealed, not graded |
| `number` | one line, takes `0.5`, `-2`, `1e-3` and `2/3` | a number or `"2/3"` | within `tolerance`, default one part in a million |
| `choice` | pick one | one option, exactly | graded |
| `multi` | pick any | a list of options | graded, order ignored |

`id` is required and unique in the document: answers are saved under it, so keep it
when you edit the question. `prompt`, `options`, `answer` and `explain` take inline
Markdown and `$…$`. `options` (2 to 26) is for `choice` and `multi` only, `tolerance`
for `number` only. Without `answer` there is no button and nothing is graded; with
it, Check shows Correct or Not quite, then the answer and `explain`. The key ships in
the page, so a reader who opens the source can see it.

Answers autosave as the reader types, to the browser and then to the server, and
survive a reload. Saving never grades: only Check does. Read them back with:

```bash
npx postplan-aryan@latest answers <url-or-draft-id>          # one block per question
npx postplan-aryan@latest answers <url-or-draft-id> --json   # for agents
```

`--json` is `{ draftId, latestVersionNumber, publicUrl, questions[] }`, each question
`{ id, kind, prompt, options, expected, answer, correct, savedAt, versionNumber, history[] }`.
`answer` is the reader's latest (null when unanswered), `expected` the key, `correct`
true, false or null (no key, or free text). Answers to a question a later version
dropped come last with `prompt: null`.

## 11 · Need something the renderer has no block for

An `html` fence is emitted verbatim and inherits the document's styling. Use
the shell's class names rather than inline styles: `mocks` `mock`
`mock-head` `mock-body` `mock-big` `mock-row` (UI mock frames), `pair` + `lbl`
(before/after), `img` `img.narrow` `img.plain` `fig` `fig-title` `fig-note`
`fig-cap` `fig-scroll`, `dl.spec` + `dt`/`dd`, `stats` `stat` `k` `v` `d`,
`hero`, `note` `note.good` `note.warn` `note.critical` + `tag`, `small`
`subtext` `center` `right` `columns`, `tbl-wrap` `table.full` `num` `t-good`
`t-warn` `t-bad` `t-flat`, `key` `swatch` `legend` `meter` `meter-track`
`meter-fill` `meter-head`.

**Colour inside a fence.** Colour in mocks means something (up, down, a series);
never decoration. These classes work only inside an `html` fence (prose stays
white) and use only the palette tokens:

| Class | Colour / effect | Example |
|---|---|---|
| `up` `good` · `down` `bad` `critical` | text `#0ca30c` · `#d03b3b` | `<span class="delta up">+2.1%</span>` |
| `warn` · `serious` | text `#fab219` · `#ec835a` | `<span class="warn">Degraded</span>` |
| `c1`…`c8` | text in series colour `--s1`…`--s8` | `<b class="c3">Series C</b>` |
| `bg-c1`…`bg-c8` `bg-up` `bg-down` `bg-warn` | 14% tinted wash, text unchanged | `<div class="mock-row bg-down">…</div>` |
| `dot-c1`…`dot-c8` `dot-up` `dot-down` `dot-warn` | 8px dot before the text | `<span class="dot-c1">NVDA</span>` |
| `delta` | 600 weight, tabular nums; pair with a tone | `<span class="delta down">−0.8%</span>` |
| `pill` | the byline chip look; pair with `bg-*` + a tone | `<span class="pill bg-up up">Healthy</span>` |
| `ticker` + `sym` `px` `delta` | stock-list row, hairline between rows | `<div class="ticker"><span class="sym">NVDA</span><span class="px">$132.40</span><span class="delta up">+2.1%</span></div>` |
| `mock-grid` (`.three`) | 2 (or 3) column hairline tile grid | `<div class="mock-grid"><div>…</div><div>…</div></div>` |

Write the sign yourself (`+2.1%`, `−0.8%`); the class only colours it. For a
one-off colour no class covers, inline `style="color:#hex"` passes the upload
policy; take the hex from the palette.

````markdown
```html
<dl class="spec">
  <dt>Size cap</dt><dd>512 KB per document, enforced server side</dd>
</dl>
```
````

The fence runs through the upload policy at render time, so a rejected tag fails
the render rather than the publish. Never include external or module scripts,
inline event handlers, `javascript:` URLs, forms, frames, embeds, objects, meta
refresh, linked stylesheets, secrets or filesystem paths.

**Hand-write a whole `.html` only when the document *is* the mock:** full-page
UI variants where the page's own look is the subject. Then it is one file, true
black, white text, no decorative chrome, responsive, variants labelled
`A`/`B`/`C`, the same file across iterations so the URL stays stable. Every
other document is Markdown.

The sandbox: an inline classic script runs, but a CSP blocks `fetch`, frames,
forms, workers and popups; storage is **not** blocked. The one exception is a
page with `question` fences, which may POST to its own answer endpoint and nothing else. Keep a scripted page
useful with JavaScript off. In a script-free file give external links
`target="_blank" rel="noopener noreferrer"`; if any script exists, omit it.

## 12 · When the render fails

Nothing is written and every problem prints at once, one per line:

```
plan.md:41 chart lines: /series/0/values expected 8 numbers to match labels, got 7
plan.md:80 unknown block "chart pie"; kinds: columns bars lines …
plan.md:12 frontmatter: unknown frontmatter key "author"; keys: title byline date status tab icon
```

`file:line block: /json/pointer message`. The pointer walks the fence's JSON
body, so `/series/0/values` is the first series' values array. Read it literally
and fix that key: the message names the shape expected and what it got. A JSON
syntax error points at the offending byte's line, not at the fence.

## 13 · Publish and report back

Uploading is the point of this skill: every document created or updated with it
is published. Do not ask for separate permission and never stop at the local file. Write `plan.md`, run
`npx postplan-aryan@latest upload plan.md`, report the local path and the URL.
Re-upload the same `.md` to update that URL and bump the version; `--new` only
for a genuinely separate draft. Never open a browser or claim the document is
hosted before the upload succeeds, and do not verify in a browser unless asked.
Every upload is kept; `<url>/v/<n>` opens an earlier version and `npx postplan-aryan@latest versions <url>` lists them.

Report the document link and nothing else. Uploaded images and videos belong
inside the document, so do not repeat their URLs in chat. Link as short
markdown: never a bare URL, never a `/raw` variant, no emoji prefix. Wrong:
`📄 Doc (updated): https://….convex.site/d/pr55-hur21q1v/raw`. Right:
`[Doc](https://<deployment>.convex.site/d/pr55-hur21q1v)`.
