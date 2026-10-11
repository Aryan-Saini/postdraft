# postdraft

> **This repo is PUBLIC and its CLI is published to npm as `postdraft` and
> `postplan-aryan`** (same code, same version, via `pnpm release`).
> Anything committed here is world-readable, and anything under `bin/` or `src/`
> is downloaded by anyone who runs `npx postdraft` or `npx postplan-aryan`.
>
> **Never put in this repo:** deployment names or `*.convex.site` URLs, S3 bucket
> or prefix names, IAM user names, AWS account ids, API keys, or anything from
> `.env.local`. Not in code, not in docs, not in a commit message, not in a test
> fixture.
>
> All of that is configuration, and it belongs in environment variables:
> `.env.local` (gitignored) for the deployment, `npx convex env set --prod` for
> server secrets, and `~/.postplan/` for the CLI's endpoint and key. Use the
> placeholders in `.env.example` when documenting.
>
> Git history counts. Scrubbing a file in a later commit does not remove it —
> history was already rewritten once for this. Check before committing, not after.

Postplan with a Convex backend. Fork of postplan (MIT, t3dotgg) with the express +
Postgres + S3 server replaced by Convex functions and Convex tables. The CLI started as
upstream's and has grown commands of its own (`render`, `skills`, `asset`, ...).

## Upstream

Upstream is the npm package `postplan`; it has no public repo. The `upstream` branch holds each
release's tarball untouched, and syncing is a merge of that branch into `main`. Run the
`update` skill (`.agents/skills/update/SKILL.md`, `/update` in Claude Code) to pull a new
release. Never edit the `upstream` branch by hand.

## The deployment: prod is the only environment

**This project has exactly one environment: the Convex _production_ deployment.**

```
<team>:<project>:prod   ->   <deployment>
  functions   https://<deployment>.convex.cloud
  api + pages https://<deployment>.convex.site
```

The actual deployment is not recorded here. It lives in `.env.local`, which is
gitignored -- see `.env.example`.

There is **no dev deployment and no preview deployment, and none should ever be
created.** The dev deployment was deleted deliberately. Published draft links point
at the URLs above, so every push is a live change -- there is no staging step.

- Push changes with **`npx convex deploy`**.
- **Never run `npx convex dev`.** It provisions a dev deployment, which would split
  this project across two environments and leave the CLI writing drafts somewhere
  nobody's links point at.
- Env vars live on prod: `npx convex env list --prod`, `npx convex env set --prod`.
  There is no second set to keep in sync.
- `.env.local` pins `CONVEX_DEPLOYMENT=prod:<deployment>`; it is gitignored and
  machine-local. On a fresh clone, copy `.env.example` and fill it in -- do not run
  `convex dev` to generate it.

## Storage

Draft HTML goes to **S3**, not Convex file storage:
`s3://<bucket>/<prefix>/<draftId>/<sha256>.html`.

Objects are addressed by content hash, so re-uploading identical HTML is idempotent
and a failed PUT never leaves a row pointing at nothing.

- The bucket is private. Drafts are reachable only through `/d/<draftId>`.
- Use a dedicated IAM user with object access only -- no `ListBucket`, no reach
  beyond the prefix.
- Credentials live only in Convex env vars (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_BUCKET`, `S3_REGION`, `S3_PREFIX`). They are never in the repo.

## The API contract is upstream's

The CLI talks to these endpoints, and so does upstream's, so they must keep their exact
shapes or the CLI breaks:

- `POST /api/uploads` -> `{ draftId, publicUrl, rawUrl, versionNumber, warnings[] }`
- `GET /api/me`
- `GET /api/drafts`

`src/html-policy.js` is shared between the CLI and the server and is **enforced
server side** -- a client-side check alone is worthless, since this HTML is served
from our own origin. One upstream change: `Buffer.byteLength` became `TextEncoder`,
because Convex is V8 without Node globals.

## No listing

Draft ids are random and unguessable, and a link must lead to exactly one document.
`GET /api/drafts` is Bearer-authenticated and agent-facing; do not add a public
listing route.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
