# postdraft

Publish a self-contained HTML document and get a link back.

> Originally forked from Theo's [postplan](https://www.npmjs.com/package/postplan) ([t3dotgg](https://github.com/t3dotgg)). Huge thanks to Theo for the idea and the original CLI, and for the HTML security policy, which still lives on here. Since then it has been heavily rebuilt: a new Convex backend, content-addressed storage, versioning and agent-first setup.

```bash
npx postdraft auth set <api-key> --api-url https://<your-deployment>.convex.site
npx postdraft upload plan.html
```

Also published as [`postplan-aryan`](https://www.npmjs.com/package/postplan-aryan)
with identical code: every release ships the same version under both names, so
`npx postplan-aryan ...` keeps working exactly like `npx postdraft ...`.

No deployment is baked into the published package: the CLI reads `--api-url`,
then `POSTPLAN_API_URL`, then `~/.postplan/config.json`. Point it at your own
instance.

## Set it up with an agent

Paste this into Claude Code, Codex or any coding agent:

```text
Set up postdraft for me by following https://raw.githubusercontent.com/Aryan-Saini/postdraft/main/SETUP.md
```

[SETUP.md](SETUP.md) has the agent ask whether files go to Convex storage or S3,
create a Convex project on your account, deploy this server, lock it with an API
key, authenticate the CLI and install the skills. The only things you do are
approve the Convex login and answer that one question.

## Skills

`skills/` holds the agent skills that drive the CLI: `html-communication`,
`file-upload`, `send-file-link` and `request-upload-link`. They ship in the npm
package.

```bash
npx postdraft@latest skills install              # ~/.claude/skills and/or ~/.agents/skills
npx postdraft@latest skills install --dir <path> # anywhere else
```

A folder is only replaced if the installer wrote it, so a hand-maintained skill
of the same name is skipped unless you pass `--force`. The install is recorded in
`~/.postplan/skills.json`. After that, any command run from a newer package whose
skills changed reinstalls them into the same folders and prints, on stderr, which
SKILL.md files changed and that the agent should re-read them. Set
`POSTPLAN_NO_SKILL_UPDATE=1` to turn that off.

## Rendering Markdown

`render` turns a Markdown document into the same self-contained HTML the upload
endpoint accepts: one file, no webfont, no network call. Charts, diagrams and
formulas are generated as inline SVG and MathML at render time.

Code blocks are highlighted at render time in One Dark Pro with a language icon,
and each has a Copy button that puts the raw source on the clipboard.
`file=src/x.ts` puts a click-to-copy path in the header (`range=12-40` numbers an edit from line 12), and a
backticked path in prose, like `convex/http.ts`, renders as a chip that copies it. That copy handler is the
only script a document carries, and a document with neither code nor paths has none.

```bash
npx postdraft render plan.md    # writes plan.html
npx postdraft upload plan.md    # renders, then publishes
```

A document is frontmatter, prose, and fences whose info string names a block:

```markdown
---
title: Q3 warehouse plan
byline: Aryan Saini
status: On track
---

Pick-to-ship is 41 hours against a 24 hour target, and the gap is all putaway.

## Throughput

​```chart columns
{"title":"Orders shipped","format":"int",
 "labels":["Jul","Aug","Sep"],"values":[812,904,1130]}
​```
```

Two optional keys change the browser tab only: `tab:` sets the `<title>` (up to
80 characters; the `h1` stays `title:`), and `icon: black | indigo` picks the
embedded favicon (default `black`).

`upload plan.md` renders to `plan.html` and publishes that, but remembers the
draft under `plan.md`, so re-uploading the source keeps the same URL.

`--out <path>` moves the output, `--emit-ir` also writes the block IR as JSON,
and `render` accepts that JSON back in place of the Markdown. A document that
does not validate prints one diagnostic per line and writes nothing.

A `file` fence renders download cards: `{"src":"https://…","name":"app.apk","size":48213333,"expires":"2026-09-26T21:00:00Z"}`,
or an array of them for a list. Each card shows the type's icon and label (inferred from the extension, or set with
`kind`), the size, and Download, Open and Copy link. When `expires` is set, or the src is a signed S3 URL, a pill shows
the date, then a countdown inside 48 hours, and once it passes the card says the link expired instead of offering a
dead Download. The icons come from material-icon-theme (MIT), Lucide (ISC) and simple-icons (CC0), copied in by
`scripts/file-icons.mjs`; the /s/ send page uses the same set.

The full grammar (every block kind, its JSON shape, and the error messages)
lives in the `html-communication` skill's `SKILL.md`. `examples/gallery.md`
renders one of everything and is the fixture the tests check.

## Where uploads go

Uploads go to whichever instance you configured, **not** `postplan.dev`. Run
`auth set` once per machine; without it the CLI falls back to `postplan.dev`,
which is somebody else's server.

The instance stores each document in its S3 bucket and serves it at
`/d/<draftId>`. Re-uploading the same file path updates that URL in place and
bumps the version, so a link you already sent keeps working and keeps showing the
latest. `--new` starts a separate draft instead.

Draft ids are random and unguessable, and there is no listing URL: a link leads to
one document and nothing else. `/d/<id>/raw` returns the source.

## Versions

Every upload keeps the versions before it. Nothing is overwritten or deleted.

- `/d/<id>` is always the latest version.
- `/d/<id>/v/<n>` is version `n`, exactly as it was uploaded, and `/d/<id>/v/<n>/raw`
  is its source. These URLs never change, so they are served with
  `Cache-Control: private, max-age=31536000, immutable`. A missing version is a 404.
- Every response carries `X-Postplan-Version: <n>`.

Published HTML is stored and served as uploaded; the server never re-renders it.
A renderer change only affects what you upload next, so an old version keeps
looking the way it did.

`upload` prints a `History:` line with the URL of the version it just made.
`versions` lists them all, and takes a draft id or any of its URLs:

```bash
npx postdraft versions https://<deployment>.convex.site/d/<id>
```

It prints the version, date, bytes, uploader, git commit (when uploaded from a
repo) and URL of each, newest first. `--json` prints the raw response from
`GET /api/drafts/<id>/versions`.

## Assets

`asset` publishes files (screenshots, recordings, builds, exports) and prints a URL
to paste into a PR, a README or a `file` fence.

```bash
npx postdraft@latest asset shot.png                 # public, permanent
npx postdraft@latest asset export.csv --private     # stable /a/ link
npx postdraft@latest asset app.ipa                  # 7 days, plus an iOS install page
npx postdraft@latest asset a.png b.mp4 --project laborhutt --expires 24h --json
```

- **Name.** The basename lowercased and hyphenated, with 8 random chars before the
  extension: `Login Flow.mp4` becomes `login-flow-k3f9x2m8.mp4`. Names never collide
  and URLs are not guessable.
- **Project.** The folder the object is filed under: the git repo's name, else the
  current folder's, else `random` for a generic folder (`~`, Desktop, Downloads,
  tmp). `--project` overrides it.
- **Public (default).** Stored at `public/<project>/<name>` in the assets bucket
  and printed as the bucket's permanent, unsigned URL. That prefix must be
  public-read.
- **`--private`.** Stored at `protected/<project>/<name>` and printed as
  `https://<deployment>/a/<slug>`. That link never changes; each visit gets a 302 to
  a 5-minute presigned GET, so a raw bucket URL is never what gets shared. The slug is
  the credential, as on `/s/`. Unknown slugs get a 404.
- **Expiry.** Builds (`.ipa .apk .aab .app .dmg .pkg .exe .msi`, or a `.zip` whose
  name contains "build") default to `--expires 7d`; everything else is permanent.
  `--expires` takes `7d`, `24h`, `never` or an ISO date, and prints
  `Expires: 2026-10-02T14:03:11Z`, which a `file` fence's `expires` accepts as is.
  After it, `/a/<slug>` returns 410 "This file expired".
- **Deletion.** Anything expiring within 7 days is tagged `autodelete=7d`, for a
  bucket lifecycle rule that deletes objects with that tag 7 days after upload. A
  longer expiry is enforced by `/a/` only, and the bytes stay until you remove them.
  A public URL is plain S3, so it keeps working until the object is deleted.
- **iOS.** For an `.ipa` the CLI reads `CFBundleIdentifier` and
  `CFBundleShortVersionString` from `Payload/*.app/Info.plist` (python3, or `unzip`
  and `plutil` on a Mac) and uploads a manifest `.plist` and an install `.html`
  beside it, with the same visibility and expiry. It prints the
  `itms-services://?action=download-manifest&url=…` link and the page URL. For a
  private ipa the manifest points at the ipa's `/a/` link. `--no-manifest` skips it.

`--json` prints `{ url, slug, visibility, expiresAt, key }` for one file (an ipa
adds `install`), or an array of those for several.

```bash
npx postdraft assets                 # newest first: project, name, visibility, size, expires, url
npx postdraft asset rm <slug|url>    # deletes the object and its record
```

The CLI asks `POST /api/assets/sign` for a presigned PUT, sends the bytes straight
to S3, then calls `POST /api/assets/record`. The server builds the key, so a client
cannot write outside `public/` and `protected/`, and it signs the `x-amz-tagging`
header, which S3 refuses unsigned on a presigned request. Record reads the size and
type back from S3, so a PUT that never landed leaves no row.

In S3 mode the assets bucket can be separate from the drafts bucket and uses the
same access keys. Without `ASSETS_BUCKET` and `ASSETS_REGION` the asset endpoints
answer 503 with a message saying so. Convex mode needs neither.

## Storage

A deployment stores bytes in S3 when `S3_BUCKET` is set and in Convex file
storage otherwise. Convex storage needs no setup. The differences:

- **Public assets** are served from `<deployment>.convex.cloud/api/storage/<uuid>`
  instead of the bucket URL. Both are permanent and unguessable.
- **Private assets** (`/a/<slug>`) redirect to that same storage URL, which does
  not expire, instead of a 5-minute presigned URL.
- **Expiry** is enforced by a daily cron (`convex/cleanup.ts`) that deletes the
  bytes of expired assets and upload links, instead of the bucket's lifecycle rule.

Rows written in Convex mode carry a `storageId`; S3 rows do not. Switching modes
affects new uploads only.

## Self-hosting

You need a Convex project, and an S3 bucket only if you want S3. No Postgres, no
Railway. [SETUP.md](SETUP.md) is the full procedure; by hand:

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill in your deployment.
3. Set the server env vars on your deployment (the S3 ones only for S3 mode):

```bash
npx convex env set --prod S3_BUCKET <bucket>
npx convex env set --prod S3_REGION <region>
npx convex env set --prod S3_PREFIX <prefix>
npx convex env set --prod S3_ACCESS_KEY_ID <key>
npx convex env set --prod S3_SECRET_ACCESS_KEY <secret>
npx convex env set --prod POSTPLAN_PUBLIC_BASE_URL https://<deployment>.convex.site
npx convex env set --prod POSTPLAN_API_KEY <a long random string>
# only for `asset`:
npx convex env set --prod ASSETS_BUCKET <assets-bucket>
npx convex env set --prod ASSETS_REGION <region>
```

**Set `POSTPLAN_API_KEY`.** With it unset the upload endpoint is open, and anyone
who learns your deployment URL can write HTML into your bucket and have it served
from your origin.

4. `npx convex deploy`

Give the bucket a private prefix for drafts; they are reachable only through
`/d/<draftId>`. Use an IAM user scoped to that prefix, with no `ListBucket`.
For assets, the same user also needs `s3:PutObject`, `s3:PutObjectTagging`,
`s3:GetObject` and `s3:DeleteObject` on `<assets-bucket>/public/*` and
`<assets-bucket>/protected/*`.

## Content-Security-Policy

`GET /d/<draftId>` sets:

```
default-src 'none'; img-src https: data:; media-src https: data:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'; worker-src 'none'
```

plus `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The
not-found page carries the same headers. `/d/<draftId>/raw` is `text/plain` with
`nosniff` and no CSP, because it is never rendered.

What it guarantees, in a browser: the upload policy allows inline classic
`<script>`, so a draft's own scripts still run, but they cannot fetch
(`connect-src 'none'`), frame anything or be framed, submit a form, start a
worker, retarget relative URLs with a base tag, or load a remote script,
stylesheet or font. Images and media may load over https or as data URIs.

What it does not guarantee: it cannot block same-origin storage, so a draft can
read and write `localStorage`, `sessionStorage` and cookies for your deployment
origin alongside every other draft you host there. It also does nothing for
non-browser clients; `curl` gets the bytes verbatim. Treat the upload policy in
`src/html-policy.js`, not the CSP, as the real gate.

The upload and download pages (`/u/<slug>`, `/s/<slug>`) are the server's own
HTML rather than uploaded HTML, and they need cross-origin fetch, PUT and framing
against S3, so they are not covered by this policy.

## 0.6.0

Two changes can alter what an existing document renders:

- An image, video or poster src that is `http:` or relative is now a render
  error. Publish the file with file-upload first and use its `https:` URL (or a
  `data:` URI).
- A prose line directly under a `"zoom"` image becomes that image's caption.

## What changed from upstream

- `express` + `pg` + `@aws-sdk/client-s3` + `jose` are gone; Convex serves the API
  and holds drafts and versions.
- HTML goes to S3 addressed by content hash, so re-uploading identical HTML is
  idempotent.
- `src/html-policy.js` is unchanged apart from `Buffer.byteLength` becoming
  `TextEncoder`, since Convex is V8 without Node globals. It is still enforced
  server side.

## Releasing

```bash
pnpm release minor   # or patch, major, x.y.z
```

Bumps the version once, commits and tags it on `main`, pushes, then publishes
that version as both `postdraft` and `postplan-aryan`. If one publish fails, run
it again with the new version number (for example `pnpm release 0.11.1`) to
publish only the missing name. See `scripts/release.mjs`.

## Acknowledgements

postdraft started as a fork of [postplan](https://www.npmjs.com/package/postplan)
by Theo ([t3dotgg](https://github.com/t3dotgg)), MIT licensed. The idea, the
original CLI and the HTML security policy in `src/html-policy.js` are his.
The upstream source is the npm package itself (there is no public repo); the
first commit here vendors postplan 0.0.4 from npm unmodified, and the `upstream` branch
carries each later release so it can be merged in (see the `update` skill). Thank you, Theo.
