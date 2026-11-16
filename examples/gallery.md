---
title: Postplan component gallery
byline: Aryan Saini
date: Sep 24, 2026
status: Draft v3
---

Every block a Postplan document can carry, on one page, with real numbers in it. Nothing here needs a
script, a webfont or a network call: the charts are generated SVG, the code is tokenized at build time,
and the whole page is one file under 512 KB.

## Type

Body copy sits at 17px on a 25px line in T3 Code's UI font, white until the author colours it. **Bold**
lifts a phrase by weight. :red[Any run] can take a :green[named colour], a :#3987e5[hex] or a
:bg-amber[wash behind it], and `::: name` tints a whole block. Inline `const x = 1` and a [link](https://claude.ai) read without breaking the line
rhythm. ==Highlighted== text, ++underlined++ text and ~~struck~~ text read as expected; water is H~2~O and
the area scales as r^2^.[^measure]

### Third level heading

Headings are the body sans at semibold, tracked in as they grow.

#### Fourth level heading

Text under a fourth level heading.

1. First step
   1. Nested numbered under the first
   2. Second nested
      1. Third level nested
2. Second step
   - Bullet under a number
     - Deeper bullet
3. Third step

- Top bullet
  - Second level
    - Third level
- Bullets carry parallel items only

- [ ] An open task
- [x] A finished task

> A quote takes a hairline rule, not a tinted card.

```html
<dl class="spec">
  <dt>Size cap</dt><dd>512 KB per document, enforced server side</dd>
  <dt>Scripts</dt><dd>Inline classic only; no modules, no external src</dd>
  <dt>Images</dt><dd>data: URIs inline, or an https URL from file-upload</dd>
  <dt>Update</dt><dd>Re-upload the same path; the URL is stable, the version bumps</dd>
</dl>
```

::: center
A centred line, for a quote or a figure label.
:::

::: right
Right-aligned, for a sign-off or a total.
:::

::: subtext
Secondary text under a paragraph, a table or a figure. White, like every other sentence; it steps down by size, not by colour.
:::

::: columns
Two short paragraphs side by side; each blank-line-separated paragraph becomes a column.

Under 520px the group collapses to one column, so the reading order is the source order.
:::

## Callouts

> [!note] Note
> A rule and a label. No tinted panel, no icon set, no rounded pill around the whole paragraph.

> [!good] Shipped
> Validation moved server side on Sep 14, so a bad document now fails at upload rather than in the
> reader's browser.

> [!warn] Risk
> S3 presigns expire in 120 seconds. A cold viewer on a slow link can miss the window and see a 502.

> [!critical] Blocked
> The README still documents Railway and Postgres. Anyone provisioning from it today gets a stack that no
> longer exists.

## Stat tiles

The renderer's stat is centred: title, one big number, the as-of line, then the signed change with its
basis. One per view as a hero, or a row of them.

```hero
[{"k":"Net burn, August","v":412000,"format":"usd","as":"Aug 2026","delta":"−6.0% vs July","tone":"good"},
 {"k":"Documents published","v":1284,"format":"int","as":"Sep 2026, to date","delta":"+18.4% vs August","tone":"good"},
 {"k":"Median upload","v":412,"format":"ms","as":"Week 38","delta":"+38 ms vs August","tone":"warn"}]
```

Tiles are the denser form: label above, number, change, and a 12-point sparkline, sharing one hairline grid.

```stats id=throughput
[{"k":"Documents published","v":1284,"format":"int","delta":"+18.4% vs August","tone":"good",
  "spark":[620,680,705,790,860,910,980,1040,1085,1160,1210,1284]},
 {"k":"Median upload","v":412,"format":"ms","delta":"+38 ms vs August","tone":"warn",
  "spark":[300,318,330,322,341,360,372,366,390,398,404,412]},
 {"k":"Rejected at validation","v":0.031,"format":"pct","delta":"−1.2 pts vs August","tone":"good",
  "spark":[7.1,6.8,6.2,5.9,5.4,5.1,4.6,4.3,4.3,3.8,3.4,3.1]},
 {"k":"Largest document","v":486,"format":"int","delta":"95% of the cap","meter":{"max":512}}]
```

## Tables

A row per item, a column per attribute, units in the header. Numbers are tabular and right-aligned so the
column can be read down. Tone is carried by the value's colour plus its own text, never colour alone.

| Left | Center | Right |
|:---|:---:|---:|
| a | b | 1,240 |
| longer cell text here | c | 88 |

A table sizes to its content and honours the alignment markers; a wide one takes the full column.

| Stage | Owner | p50 (ms) | p95 (ms) | Error rate |
|:---|:---|---:|---:|---:|
| Validate | Aryan | 18 | 41 | good:0.2% |
| S3 put | Aryan | 212 | 905 | warn:1.4% |
| Serve | Aryan | 96 | 1,340 | bad:4.8% |
| Total | Aryan | 326 | 2,286 | flat:2.1% |

::: subtext
p95 serve time is the S3 presign round trip, not the document itself.
:::

## Charts

Generated as inline SVG from the data, so geometry, ticks and labels line up without hand placement. Hover
any mark for its value. The palette is the eight-slot categorical set, validated against a true-black surface.

```chart columns id=published
{"title":"Documents published per month","note":"September is partial, through the 22nd.","format":"int",
 "labels":["Apr","May","Jun","Jul","Aug","Sep"],"values":[61,78,96,142,168,121]}
```

```chart lines
{"title":"Upload latency, median","note":"Milliseconds, weekly.","format":"ms","area":true,"zeroFloor":false,
 "labels":["W1","W2","W3","W4","W5","W6","W7","W8"],
 "series":[{"name":"Median","values":[284,301,296,340,366,392,401,412]}]}
```

```chart lines
{"title":"Stage latency","note":"Three series get a legend and a labelled end point. S3 put carries a bad tone.","format":"ms",
 "labels":["W1","W2","W3","W4","W5","W6","W7","W8"],
 "series":[{"name":"Validate","values":[18,19,17,18,20,19,18,18]},
           {"name":"S3 put","values":[180,195,210,240,232,244,220,212],"tone":"bad"},
           {"name":"Serve","values":[70,79,96,121,118,130,118,96]}]}
```

```chart bars
{"title":"Documents by kind","note":"Ranked, so the bars go sideways and the labels stay horizontal.",
 "format":"int","labels":["Plans","Findings","PR reviews","UI mocks","Runbooks","Other"],
 "values":[412,298,211,164,91,108]}
```

```chart grouped
{"title":"Create vs update","format":"int","labels":["Q3 25","Q4 25","Q1 26","Q2 26"],
 "series":[{"name":"Created","values":[42,51,66,78]},{"name":"Updated","values":[18,22,26,31]}]}
```

```chart stacked
{"title":"Publishes by harness","note":"Stacked because the segments sum to the month's total.","format":"int",
 "labels":["Apr","May","Jun","Jul","Aug","Sep"],
 "series":[{"name":"Claude Code","values":[30,38,44,70,82,58]},
           {"name":"Codex","values":[18,22,31,42,51,40]},
           {"name":"Other harness","values":[13,18,21,30,35,23]}]}
```

```chart delta
{"title":"Change in p50 vs August","note":"Signed change reads against zero. Slower is worse here, so up is red.",
 "format":"ms","higherIsBetter":false,
 "labels":["Validate","S3 put","Serve","Presign","Total"],"values":[-3,32,26,-11,44]}
```

```chart whisker
{"title":"Latency spread by stage","note":"Dot is the median, whisker spans p05 to p95.","format":"ms",
 "labels":["Validate","S3 put","Serve"],"mid":[18,212,96],"lo":[11,148,58],"hi":[41,905,1340]}
```

```chart heatmap
{"title":"Uploads by hour and weekday","note":"One hue, light to dark. Counts sit in the cell.","format":"int",
 "rows":["Mon","Tue","Wed","Thu","Fri","Sat","Sun"],
 "cols":["00","03","06","09","12","15","18","21"],
 "values":[[1,0,2,9,14,18,12,6],[0,1,3,11,16,21,15,7],[2,0,1,12,19,24,14,8],
           [1,1,2,10,17,22,16,9],[3,2,4,14,21,26,11,5],[0,0,1,3,5,6,4,2],
           [0,1,0,2,4,5,3,1]]}
```

## More charts

Shapes that come up often enough to be worth a primitive: a bridge between two totals, two numeric axes, an
ordered drop-off, a schedule, one panel per item, and a share of a whole that is not a pie.

```chart waterfall
{"title":"What moved between August and September","note":"Green adds, red removes, blue is a balance.",
 "format":"int","labels":["Aug total","New repos","Churned","Reruns","Partial Sep","Sep total"],
 "values":[168,34,-41,18,-58,121],"totals":[0,5]}
```

```chart scatter
{"title":"Document size against time to write","note":"Bubble area is the number of documents of that kind.",
 "xTitle":"Minutes to write","yTitle":"KB","format":"int",
 "points":[{"label":"Plans","x":42,"y":186,"size":412},{"label":"Findings","x":61,"y":143,"size":298},
           {"label":"PR reviews","x":28,"y":96,"size":211},{"label":"UI mocks","x":88,"y":240,"size":164},
           {"label":"Runbooks","x":34,"y":71,"size":91},{"label":"Other","x":52,"y":110,"size":108}]}
```

```chart funnel
{"title":"Reader drop-off","note":"Percentages on the right are the step-to-step change.","format":"int",
 "labels":["Document opened","Scrolled past the lead","Reached a chart","Reached the end","Replied or commented"],
 "values":[4820,3910,2640,1180,412]}
```

```chart schedule
{"title":"Build schedule","note":"Green is finished, blue is planned.",
 "tasks":[{"label":"Vendor postplan","start":"2026-08-10","end":"2026-08-14","done":true},
          {"label":"Convex backend","start":"2026-08-14","end":"2026-08-29","done":true},
          {"label":"S3 storage","start":"2026-08-29","end":"2026-09-15","done":true},
          {"label":"Component system","start":"2026-09-16","end":"2026-10-03"},
          {"label":"Fold into the skill","start":"2026-10-01","end":"2026-10-14"}]}
```

```chart small-multiples
{"title":"Publishes by harness","format":"int","labels":["W1","W2","W3","W4","W5","W6","W7","W8"],
 "series":[{"name":"Claude Code","values":[42,48,51,63,71,78,74,82]},
           {"name":"Codex","values":[18,22,26,31,34,39,44,51]},
           {"name":"Cursor","values":[9,11,10,14,13,16,18,17]},
           {"name":"opencode","values":[3,4,6,5,8,9,12,14]},
           {"name":"CI","values":[12,14,13,19,22,21,25,28]},
           {"name":"Manual","values":[7,6,5,6,4,5,3,4]}]}
```

```chart share
{"title":"Share of publishes","note":"A strip rather than a pie: angles are hard to compare, lengths are not.",
 "format":"int","labels":["Claude Code","Codex","Cursor","opencode","CI"],"values":[612,284,131,96,161]}
```

## Code

Highlighted at build time into plain spans in One Dark Pro. Three headers: a snippet names only its
language, a file block leads with the path it lands at (click the path to copy it), and a caption block
leads with a title. Copy puts the raw source on the clipboard; with scripts blocked the button is hidden
and the block still reads the same.

In prose, a backticked path renders as a chip that copies itself: the handler lives in `convex/http.ts`,
the plan in `./plan.md`, the token in `~/.npmrc`, and the tokenizer at `src/render/code.js:42`. A command
like `npm install marked` or a word like `lines` stays inline code.

```ts file=src/upload.ts range=12-20
export async function upload(html: string, filename: string): Promise<Draft> {
  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_HTML_BYTES) throw new UploadError(`${bytes} bytes exceeds the cap`);

  const check = validateHtml(html, {});
  if (!check.ok) throw new UploadError(check.errors.join("\n"));

  return post("/api/uploads", { html, filename });
}
```

```tsx file=src/DraftCard.tsx lines
export function DraftCard({ draft, onOpen }: { draft: Draft; onOpen: (id: string) => void }) {
  const label = `v${draft.versionNumber} · ${draft.warnings.length} warnings`;
  return (
    <li className="draft" data-id={draft.draftId}>
      <button type="button" onClick={() => onOpen(draft.draftId)}>{draft.title}</button>
      <Badge tone={draft.warnings.length ? "warn" : "good"}>{label}</Badge>
    </li>
  );
}
```

```python file=scripts/retry.py title="Retry a flaky upload"
@retry(times=3, backoff=0.5)
def upload(self, path: str) -> dict:
    html = self.render(path)
    size = len(html.encode("utf-8"))
    if size > MAX_HTML_BYTES:
        raise UploadError(f"{path}: {size / 1024:.1f} KiB exceeds the cap")
    return self.client.post("/api/uploads", json={"html": html, "filename": path})
```

```bash
npx postplan-aryan@latest upload ./plan.html --description "Q3 warehouse plan"
# Draft  https://postplan.example/d/q3-warehouse-8fk2
# Version 4
```

```erlang file=src/upload_server.erl
-module(upload_server).
-export([start/1]).

%% Accept uploads until told to stop.
start(Limit) ->
    receive
        {upload, From, Html} when byte_size(Html) =< Limit ->
            From ! {ok, draft_id(Html)},
            start(Limit);
        {upload, From, _Html} ->
            From ! {error, too_large},
            start(Limit);
        stop -> ok
    end.
```

```json title="Upload response"
{
  "draftId": "q3-warehouse-8fk2",
  "publicUrl": "https://postplan.example/d/q3-warehouse-8fk2",
  "versionNumber": 4,
  "warnings": []
}
```

```diff title="Add a CSP to served drafts"
@@ convex/http.ts @@
 const headers = {
   "Content-Type": "text/html; charset=utf-8",
-  "Cache-Control": "private, max-age=30",
+  "Cache-Control": "private, max-age=30, must-revalidate",
+  "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'",
 };
```

## Images and video

A figure is the image at full column width, corners at 8px, a hairline border, and the caption underneath in
white and left aligned, the way the renderer captions an embed with its provenance. A title of `zoom`
turns the figure into a lightbox target. The alt text doubles as the caption unless a line directly under the
image gives one. Every src is an https URL from file-upload or a data: URI.

![Dashboard after the S3 move · captured Sep 21](https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-dash-ync0se04.png "zoom")

A before and after pair sits side by side and stacks on a narrow screen. It goes in an `html` fence, so each half
carries its own label.

```html
<div class="pair">
  <figure class="img"><div class="lbl">Before</div><img src="https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-before-0nukcsng.png" alt="List view before the change"></figure>
  <figure class="img"><div class="lbl">After</div><img src="https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-after-dn3r3w41.png" alt="List view after the change"></figure>
</div>
```

### Slideshow

Several screenshots of one flow go in a slideshow: swipe, scroll sideways, use the arrows or the arrow keys,
or tap a dot. Scroll-snap does the paging, so with scripts blocked the arrows go and it stays a swipeable strip.

```slides
[{"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-slide-1-7b7u24d4.png","caption":"The list view before the change"},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-slide-2-xphizy3h.png","caption":"Detail pane with the new sparkline column"},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-slide-3-p3tv75dp.png","caption":"Settings, unchanged"}]
```

### Video

Video takes the same figure. Always mp4 with a poster frame, so the block reads as a still when nothing is
playing, and never a bare link. The native player carries the controls.

```video
{"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-clip-5wyjcg1z.mp4",
 "poster":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-poster-gd1v9qj3.png",
 "caption":"Placeholder clip, 0:02"}
```

## When media fails

A link can 404, a signed S3 URL can expire, a video can be the wrong format. Each case renders as a labelled panel instead of a broken glyph.

### Missing file

![A screenshot that was never uploaded](https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-fail-missing.png "zoom")

### Expired signed link

![A presigned screenshot, signed in January 2024 for five minutes](https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-fail-signed.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20240101%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240101T000000Z&X-Amz-Expires=300&X-Amz-SignedHeaders=host&X-Amz-Signature=0000000000000000000000000000000000000000000000000000000000000000)

### Unsupported video

```video
{"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-fail-clip.mov",
 "poster":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-poster-gd1v9qj3.png",
 "caption":"A QuickTime recording, not an mp4"}
```

### One bad slide

```slides
[{"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-slide-1-7b7u24d4.png","caption":"Loads"},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-fail-slide.png","caption":"This slide's file is missing"},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-slide-3-p3tv75dp.png","caption":"Loads"}]
```

### Plain image, no zoom

Without a `zoom` title there is no lightbox to disable; the panel takes the image's place in the paragraph.

![A plain image whose file is missing](https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/gallery-fail-plain.png)

| State | What the reader sees | What an agent should do |
|:---|:---|:---|
| Missing file | Couldn't load this image. | Re-upload with file-upload |
| Expired signed link | This link has expired. | Republish the document |
| Unsupported video | This video format isn't supported here. | Use mp4 with H.264 video |
| One bad slide | Couldn't load this image. | Re-upload that slide with file-upload |
| Plain image, no zoom | Couldn't load this image. | Re-upload with file-upload |

## Files

Anything the reader should download goes in a `file` fence: the type's icon, the name in mono, the size and kind, and
Download, Open and Copy link on the right. `expires` puts a pill on the meta line: a date when the link has more than
two days left, a countdown under 48 hours that turns amber under 6 hours and red under 1, and once it passes, a line
saying the link expired in place of Download and Open. A signed S3 URL carries its own expiry, so it needs no `expires`.

```file
{"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/syncafy-1.4.2-k2n8v5qd.apk","name":"syncafy-1.4.2.apk","size":48213333,
 "note":"Release build for the Pixel test group. Allow installs from unknown sources first."}
```

A list renders as rows on one surface.

```file
[{"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/syncafy-1.4.2-p7w3c9xa.ipa","name":"Syncafy-1.4.2.ipa","size":61874210},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/field-photos-sep-m4t8r2ye.zip","name":"field-photos-sep.zip","size":312448120,"expires":"2026-09-25T19:00:00Z",
  "note":"Every site photo from September, 1,214 files."},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/q3-invoice-summary-h6d2k9sb.pdf","name":"q3-invoice-summary.pdf","size":284311,"expires":"2026-09-01"},
 {"src":"https://aryan-personal-files.s3.us-east-1.amazonaws.com/public/postplan/routes-export-w9q4n7jz.csv?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260924%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260924T180000Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=0000000000000000000000000000000000000000000000000000000000000000",
  "name":"routes-export.csv","size":1840022}]
```

## Diagrams

The flow and sequence shapes mermaid is normally used for, drawn as SVG with computed geometry.

```flow
{"title":"Publish path","note":"Rejection happens before any byte reaches storage.",
 "cols":[[{"id":"cli","label":"CLI upload","shape":"round"}],
         [{"id":"val","label":"Validate","shape":"diamond"}],
         [{"id":"s3","label":"S3","shape":"store"},{"id":"err","label":"400 rejected","tone":"bad"}],
         [{"id":"row","label":"Convex row"}],
         [{"id":"view","label":"/d/:id","shape":"round"}]],
 "edges":[{"from":"cli","to":"val"},{"from":"val","to":"s3","label":"ok"},
          {"from":"val","to":"err","label":"reject"},{"from":"s3","to":"row"},
          {"from":"row","to":"view"}]}
```

```sequence
{"title":"Upload and read","actors":["Agent","Convex","S3","Reader"],
 "msgs":[{"from":"Agent","to":"Convex","label":"POST /api/uploads"},
         {"from":"Convex","to":"S3","label":"PUT html (presigned)"},
         {"from":"S3","to":"Convex","label":"200","dashed":true},
         {"from":"Convex","to":"Agent","label":"publicUrl","dashed":true},
         {"from":"Reader","to":"Convex","label":"GET /d/:id"},
         {"from":"Convex","to":"Reader","label":"html","dashed":true}]}
```

## Math

MathML renders natively in every current browser, so a formula needs no KaTeX bundle and no image. The
half-life is $t_{1/2} = \frac{\ln 2}{\lambda}$, inline, at body size.

$$
p_{95} = \mu + 1.645\,\sigma
$$

```math
\text{cost} = \frac{\text{bytes} \times \text{reads}}{10^{6}} \times 0.09
```

## Timeline

```timeline
[{"when":"Aug 12","what":"Forked postplan 0.0.4 from npm","state":"done",
  "note":"Vendored unmodified so the diff against upstream stays readable."},
 {"when":"Aug 28","what":"Replaced express and Postgres with Convex","state":"done"},
 {"when":"Sep 14","what":"Moved draft HTML to S3, addressed by content hash","state":"done",
  "note":"Uploading the same bytes twice is now a no-op."},
 {"when":"Sep 22","what":"Component gallery, this page","state":"now"},
 {"when":"Next","what":"Fold the components into the skill as copyable references"}]
```

## Mock frames

When the document is a set of UI variants, each frame is labelled and laid out for side-by-side comparison.
The `html` fence is the escape hatch: emitted verbatim, inheriting the document's tokens, and policy-checked
with the rest of the page. Inside it, colour utilities
mark direction, status and series.

```html
<div class="mocks">
  <div class="mock"><div class="mock-head">A · Watchlist</div><div class="mock-body">
    <div class="ticker"><span class="sym dot-c1">NVDA</span><span class="px">$132.40</span><span class="delta up">+2.1%</span></div>
    <div class="ticker"><span class="sym dot-c2">AAPL</span><span class="px">$228.15</span><span class="delta down">−0.8%</span></div>
    <div class="ticker"><span class="sym dot-c3">MSFT</span><span class="px">$431.02</span><span class="delta up">+0.6%</span></div>
    <div class="ticker"><span class="sym dot-c4">TSLA</span><span class="px">$251.77</span><span class="delta down">−3.4%</span></div>
    <div class="ticker"><span class="sym dot-c5">AMZN</span><span class="px">$193.60</span><span class="delta up">+1.2%</span></div>
  </div></div>
  <div class="mock"><div class="mock-head">B · Status</div><div class="mock-body">
    <div class="ticker"><span class="sym">API</span><span class="pill bg-up up">Healthy</span></div>
    <div class="ticker"><span class="sym">Uploads</span><span class="pill bg-up up">Healthy</span></div>
    <div class="ticker"><span class="sym">Renderer</span><span class="pill bg-warn warn">Degraded</span></div>
    <div class="ticker"><span class="sym">Webhooks</span><span class="pill bg-down critical">Down</span></div>
  </div></div>
  <div class="mock"><div class="mock-head">C · Tiles</div><div class="mock-body">
    <div class="mock-grid">
      <div><div class="small">Published</div><div class="mock-big">1,284</div><div class="small delta up">+18.4%</div></div>
      <div><div class="small">Rejected</div><div class="mock-big">3.1%</div><div class="small delta down">+0.9 pts</div></div>
    </div>
  </div></div>
</div>
```

## Sources

- Figures are illustrative, generated for this gallery on Sep 22, 2026.
- Palette: the eight-slot categorical set, validated against surface `#000000`.
- Upload policy: `src/html-policy.js` in postdraft.[^policy]

[^measure]: The measure is 744px with 22px of side padding, so a line lands near 75 characters.
[^policy]: The same validator the server runs, re-applied to the assembled document.
