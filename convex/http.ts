import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { validateHtml } from "../src/html-policy.js";
import { assetSlug, parseAssetKey, taggingHeader, validateSignRequest } from "../src/assets.js";
import { MAX_OPTIONS, QUESTION_ID, extractQuestions } from "../src/questions.js";
import { draftKey, presign, s3Config, type S3Config } from "./lib/s3";
import {
  assetsTarget, backend, publicUrl, putHtml, readText, readUrl, removeObject, storageOrigin, uploadSlot,
} from "./lib/storage";
import { uploadPage } from "./lib/uploadPage";
import { downloadPage } from "./lib/downloadPage";

/**
 * The Postplan API, served by Convex instead of express + Postgres + S3.
 *
 * The CLI (`npx postplan upload`) speaks exactly three endpoints, so those are
 * reproduced byte-for-byte in shape. Convex functions replace express and Convex
 * tables replace Postgres. The bytes go to S3 or to Convex file storage,
 * whichever the deployment's env picks (see `lib/storage.ts`).
 */

const MAX_HTML_BYTES = Number(process.env.MAX_HTML_BYTES ?? 512 * 1024);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Bearer auth. With POSTPLAN_API_KEY set, a matching key is required; without
 * it the deployment is open, which is fine for a single-user instance and is
 * how the CLI already behaves (it only sends the header when a key exists).
 */
function authorize(request: Request): { ok: true; account: string } | { ok: false } {
  const expected = process.env.POSTPLAN_API_KEY;
  if (!expected) return { ok: true, account: "open" };
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token && token === expected ? { ok: true, account: "owner" } : { ok: false };
}

function baseUrl(request: Request): string {
  return process.env.POSTPLAN_PUBLIC_BASE_URL ?? new URL(request.url).origin;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * A readable slug plus a random id: `physio-exercise-sheets-84gosen4`.
 *
 * The URL is the only credential, so a purely readable slug would be guessable by
 * anyone who knows what Aryan is working on -- the id is what makes it safe. With
 * nothing readable to work from, the id alone is the slug.
 *
 * This is the handle, not the primary key. The Convex document id still resolves
 * the same record (see the lookups in uploads.ts / drafts.ts), so a link is
 * recoverable even if the slug is lost.
 */
function newSlug(readable?: string): string {
  const base = (readable ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return base ? `${base}-${randomId()}` : randomId(12);
}

const http = httpRouter();

http.route({
  path: "/api/me",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    return json({ account_id: auth.account, plan: "self-hosted", backend: "convex" });
  }),
});

http.route({
  path: "/api/uploads",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);

    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return json({ error: "Invalid body." }, 400);
    const { html, filename, draftId, description, metadata } = body as Record<string, unknown>;

    if (typeof html !== "string" || !html.trim()) {
      return json({ error: "html is required." }, 400);
    }
    if (typeof filename !== "string" || !filename.trim()) {
      return json({ error: "filename is required." }, 400);
    }
    const bytes = new TextEncoder().encode(html).length;
    if (bytes > MAX_HTML_BYTES) {
      return json(
        { error: `HTML exceeds ${MAX_HTML_BYTES} bytes.`, errors: [`Got ${bytes} bytes.`] },
        413,
      );
    }

    // Re-validate server side. The CLI checks too, but a client check is only a
    // convenience -- this HTML is served from our own origin.
    const validation = validateHtml(html, {});
    if (!validation.ok) {
      return json({ error: "HTML failed Postplan validation.", errors: validation.errors }, 400);
    }

    // The questions this version carries decide which answers /api/d/ accepts
    // and whether its CSP may connect at all.
    let questions;
    try {
      questions = extractQuestions(html);
    } catch (err) {
      return json({ error: "HTML failed Postplan validation.", errors: [err instanceof Error ? err.message : String(err)] }, 400);
    }

    const id =
      typeof draftId === "string" && draftId
        ? draftId
        : newSlug(filename.replace(/\.[a-z0-9]+$/i, ""));

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");

    // In S3 the key is the content hash, so uploading the same HTML twice is
    // idempotent. Either way a failed store leaves no row pointing at nothing.
    const key = backend() === "s3" ? draftKey(s3Config(), id, sha256) : `drafts/${id}/${sha256}.html`;
    let stored;
    try {
      stored = await putHtml(ctx, key, html);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }

    const { versionNumber } = await ctx.runMutation(internal.drafts.upsert, {
      draftId: id,
      filename,
      description: typeof description === "string" ? description : undefined,
      key,
      storageId: stored.storageId,
      sha256,
      bytes,
      metadata: metadata ?? undefined,
      createdBy: auth.account,
      questions,
    });

    const publicUrl = `${baseUrl(request)}/d/${id}`;
    return json({
      draftId: id,
      publicUrl,
      rawUrl: `${publicUrl}/raw`,
      versionNumber,
      warnings: validation.warnings ?? [],
    });
  }),
});

http.route({
  path: "/api/drafts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    return json({ drafts: await ctx.runQuery(internal.drafts.list, {}) });
  }),
});

/**
 * One draft's versions (`/versions`: newest first, each with its own URL) or
 * the answers readers saved to its questions (`/answers`; see answerReport in
 * src/questions.js for the shape, which `postdraft answers --json` prints).
 */
http.route({
  pathPrefix: "/api/drafts/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const match = new URL(request.url).pathname.match(/^\/api\/drafts\/([^/]+)\/(versions|answers)\/?$/);
    if (!match) return json({ error: "Not found." }, 404);
    const draftId = decodeURIComponent(match[1]);
    if (match[2] === "answers") {
      const answers = await ctx.runQuery(internal.answers.forDraft, { draftId });
      if (!answers) return json({ error: "No such draft." }, 404);
      return json({ ...answers, publicUrl: `${baseUrl(request)}/d/${answers.draftId}` });
    }
    const found = await ctx.runQuery(internal.drafts.versions, { draftId });
    if (!found) return json({ error: "No such draft." }, 404);
    const publicUrl = `${baseUrl(request)}/d/${found.draftId}`;
    return json({
      ...found,
      publicUrl,
      versions: found.versions.map((row) => ({
        ...row,
        url: `${publicUrl}/v/${row.versionNumber}`,
        rawUrl: `${publicUrl}/v/${row.versionNumber}/raw`,
      })),
    });
  }),
});

/** Largest answer request taken, in bytes. The longest answer is 10,000 characters. */
const MAX_ANSWER_BODY = 64 * 1024;

/**
 * A reader saves an answer: `{ questionId, value, version? }`. No API key: the
 * draft id is the credential, as the slug is on /u/, and the published page is
 * the only client. Everything about the answer is checked in `answers.save`.
 * JSON only: a cross-site page can POST text/plain without a preflight, never JSON.
 */
http.route({
  pathPrefix: "/api/d/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const match = new URL(request.url).pathname.match(/^\/api\/d\/([^/]+)\/answers$/);
    if (!match) return json({ error: "Not found." }, 404);
    if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
      return json({ error: "Expected application/json." }, 415);
    }
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_ANSWER_BODY) return json({ error: "Request too large." }, 413);
    const text = await request.text();
    if (text.length > MAX_ANSWER_BODY) return json({ error: "Request too large." }, 413);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON." }, 400);
    }
    const { questionId, value, version } = (body ?? {}) as Record<string, unknown>;
    if (typeof questionId !== "string" || !QUESTION_ID.test(questionId)) {
      return json({ error: "questionId is required." }, 400);
    }
    const isValue = typeof value === "string"
      || (Array.isArray(value) && value.length <= MAX_OPTIONS && value.every((x) => typeof x === "string"));
    if (!isValue) return json({ error: "value must be text or a list of options." }, 400);
    if (version !== undefined && version !== null && !(Number.isInteger(version) && (version as number) > 0)) {
      return json({ error: "version must be a version number." }, 400);
    }
    const result = await ctx.runMutation(internal.answers.save, {
      draftId: decodeURIComponent(match[1]),
      questionId,
      value: value as string | string[],
      versionNumber: typeof version === "number" ? version : undefined,
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ savedAt: result.savedAt, versionNumber: result.versionNumber });
  }),
});

/**
 * Upload requests. The page and its two endpoints are deliberately unauthenticated:
 * the slug is the credential, because whoever uploads is often not the person who
 * generated the link. Creating and reading a request still requires the API key.
 */
http.route({
  path: "/api/upload-requests",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const body: unknown = await request.json();
    const { reason, days } = (body ?? {}) as Record<string, unknown>;
    const { direction } = (body ?? {}) as Record<string, unknown>;
    const out = direction === "out";
    const slug = newSlug(typeof reason === "string" ? reason : undefined);
    await ctx.runMutation(internal.uploads.create, {
      slug,
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : undefined,
      createdBy: auth.account,
      days: typeof days === "number" ? days : 7,
      direction: out ? "out" : "in",
    });
    return json({ slug, url: `${baseUrl(request)}/${out ? "s" : "u"}/${slug}` });
  }),
});

http.route({
  path: "/api/upload-requests/list",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const body: unknown = await request.json();
    const { slug } = (body ?? {}) as Record<string, unknown>;
    if (typeof slug !== "string") return json({ error: "slug is required." }, 400);
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return json({ error: "no such upload link" }, 404);
    const files = await Promise.all(
      found.files.map(async (f) => ({
        name: f.name,
        size: f.size,
        contentType: f.contentType,
        url: await readUrl(ctx, f, 3600),
      })),
    );
    return json({ slug, reason: found.request.reason ?? null, expiresAt: found.request.expiresAt, files });
  }),
});

/** Mint an upload slot for the phone. No API key: the slug is the credential. */
http.route({
  pathPrefix: "/api/u/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const path = new URL(request.url).pathname;
    const match = path.match(/^\/api\/u\/([^/]+)\/(sign|record)$/);
    if (!match) return json({ error: "Not found." }, 404);
    const [, slug, action] = match;

    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return json({ error: "no such upload link" }, 404);
    if (found.request.expiresAt < Date.now()) return json({ error: "this link has expired" }, 410);

    const body: unknown = await request.json();
    const fields = (body ?? {}) as Record<string, unknown>;

    if (action === "sign") {
      const { name, contentType } = fields;
      if (typeof name !== "string" || typeof contentType !== "string") {
        return json({ error: "name and contentType are required." }, 400);
      }
      const suffix = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase().slice(0, 20) : "";
      const prefix = backend() === "s3" ? `${s3Config().prefix}/` : "";
      const key = `${prefix}uploads/${slug}/${found.files.length + 1}${suffix}`;
      return json({ key, ...(await uploadSlot(ctx, key)) });
    }

    const { key, name, size, contentType, storageId } = fields;
    if (typeof key !== "string" || typeof name !== "string" || typeof size !== "number" || typeof contentType !== "string") {
      return json({ error: "key, name, size and contentType are required." }, 400);
    }
    if (backend() === "convex") {
      const file = typeof storageId === "string" ? await ctx.runQuery(internal.files.metadata, { storageId }) : null;
      if (!file) return json({ error: "storageId is not a stored file." }, 400);
      await ctx.runMutation(internal.uploads.addFile, {
        slug, key, name, size: file.size, contentType, storageId: file.storageId,
      });
      return json({ ok: true });
    }
    await ctx.runMutation(internal.uploads.addFile, { slug, key, name, size, contentType });
    return json({ ok: true });
  }),
});

/**
 * Assets: `postplan asset` publishes a file. The CLI asks for an upload slot,
 * sends the bytes straight to storage, then records the upload.
 * The server builds the key itself (`public/` or `protected/` + project + name),
 * so a client can never write outside those two prefixes.
 */

/** The assets bucket (null in Convex mode), or the 503 that says S3 assets are not configured. */
function assetsOr503(): S3Config | null | Response {
  try {
    return assetsTarget();
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 503);
  }
}

/** Where an asset is reached: its permanent storage URL when public, `/a/<slug>` when private. */
async function assetUrl(
  ctx: ActionCtx,
  config: S3Config | null,
  row: Pick<Doc<"assets">, "visibility" | "bucket" | "key" | "slug" | "storageId">,
  request: Request,
): Promise<string> {
  return row.visibility === "public" ? publicUrl(ctx, row, config) : `${baseUrl(request)}/a/${row.slug}`;
}

/** Size and type of an S3 object, from a HEAD, or null when it is not there. */
async function headObject(config: S3Config, key: string) {
  const head = await fetch(await presign(config, "HEAD", key, 60), { method: "HEAD" });
  if (!head.ok) return null;
  return {
    size: Number(head.headers.get("Content-Length") ?? 0),
    contentType: head.headers.get("Content-Type") ?? "application/octet-stream",
    storageId: undefined,
  };
}

const readJson = async (request: Request): Promise<unknown> => request.json().catch(() => null);

http.route({
  path: "/api/assets/sign",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const config = assetsOr503();
    if (config instanceof Response) return config;
    const parsed = validateSignRequest(await readJson(request));
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    const tagging = taggingHeader(parsed.value.tags);
    // For S3 the client must send these headers verbatim: they are part of the signature.
    const headers: Record<string, string> = tagging ? { "x-amz-tagging": tagging } : {};
    const slot = await uploadSlot(ctx, parsed.value.key, headers, config ?? undefined);
    return json({ key: parsed.value.key, ...slot });
  }),
});

http.route({
  path: "/api/assets/record",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const config = assetsOr503();
    if (config instanceof Response) return config;
    const { key, expires, storageId } = ((await readJson(request)) ?? {}) as Record<string, unknown>;
    const parsed = typeof key === "string" ? parseAssetKey(key) : null;
    if (!parsed || typeof key !== "string") return json({ error: "key is not an asset key." }, 400);
    if (expires !== undefined && expires !== null && (typeof expires !== "number" || expires <= Date.now())) {
      return json({ error: "expires must be a future epoch-ms time." }, 400);
    }
    // Size and type come from storage, not the client, and an upload that never
    // landed leaves no row behind.
    const stored = config
      ? await headObject(config, key)
      : typeof storageId === "string"
        ? await ctx.runQuery(internal.files.metadata, { storageId })
        : null;
    if (!stored) return json({ error: `Storage has no object for ${key}.` }, 400);

    const slug = assetSlug(parsed.name);
    const row = {
      slug,
      key,
      bucket: config ? config.bucket : "convex",
      visibility: parsed.visibility,
      project: parsed.project,
      name: parsed.name,
      size: stored.size,
      contentType: stored.contentType,
      expiresAt: typeof expires === "number" ? expires : undefined,
      storageId: stored.storageId,
      createdBy: auth.account,
    };
    await ctx.runMutation(internal.assets.create, row);
    return json({
      url: await assetUrl(ctx, config, row, request),
      slug,
      visibility: row.visibility,
      expiresAt: row.expiresAt ?? null,
      key,
    });
  }),
});

http.route({
  path: "/api/assets",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const config = assetsOr503();
    if (config instanceof Response) return config;
    const rows = await ctx.runQuery(internal.assets.list, { createdBy: auth.account });
    return json({
      assets: await Promise.all(rows.map(async (row) => ({
        slug: row.slug,
        key: row.key,
        project: row.project,
        name: row.name,
        visibility: row.visibility,
        size: row.size,
        contentType: row.contentType,
        expiresAt: row.expiresAt ?? null,
        createdAt: row._creationTime,
        url: await assetUrl(ctx, config, row, request),
      }))),
    });
  }),
});

/** Delete one asset, object and row, by `{ slug }` or `{ key }`. */
http.route({
  path: "/api/assets/remove",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const auth = authorize(request);
    if (!auth.ok) return json({ error: "Unauthorized." }, 401);
    const config = assetsOr503();
    if (config instanceof Response) return config;
    const { slug, key } = ((await readJson(request)) ?? {}) as Record<string, unknown>;
    const row =
      typeof slug === "string"
        ? await ctx.runQuery(internal.assets.bySlug, { slug })
        : typeof key === "string"
          ? await ctx.runQuery(internal.assets.byKey, { key })
          : null;
    if (!row || row.createdBy !== auth.account) return json({ error: "No such asset." }, 404);
    try {
      await removeObject(ctx, row, config ?? undefined);
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
    await ctx.runMutation(internal.assets.remove, { id: row._id });
    return json({ slug: row.slug, key: row.key });
  }),
});

/** Plain page for a dead asset link: black, white text, nothing else. */
const assetNotice = (text: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<meta name="color-scheme" content="dark"><title>${text}</title></head>`
      + `<body style="margin:0;background:#000;color:#fff;font:17px/1.5 system-ui,-apple-system,sans-serif">`
      + `<main style="width:min(560px,calc(100% - 32px));margin:0 auto;padding:44px 0">${text}</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      },
    },
  );

/**
 * A stable link to one asset. No API key: the slug is the credential, as on /s/.
 * A private asset redirects to a 5-minute presigned GET, so the raw bucket URL
 * is never the thing that gets shared; a public one redirects to its bucket URL.
 * In Convex mode both redirect to the file's storage URL, which does not expire,
 * so there `/a/` is a stable handle rather than a short-lived one.
 */
http.route({
  pathPrefix: "/a/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/a/".length).replace(/\/+$/, ""));
    const row = slug ? await ctx.runQuery(internal.assets.bySlug, { slug }) : null;
    if (!row) return assetNotice("This file does not exist.", 404);
    if (row.expiresAt !== undefined && row.expiresAt < Date.now()) return assetNotice("This file expired", 410);
    const config = assetsOr503();
    if (config instanceof Response) return config;
    const location =
      row.visibility === "public" ? await publicUrl(ctx, row, config) : await readUrl(ctx, row, 300, config ?? undefined);
    return new Response(null, {
      status: 302,
      headers: {
        Location: location,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }),
});

/**
 * The sandbox for our own two file pages.
 *
 * Same shape as the draft CSP below, with one deliberate hole: `connect-src` names
 * this origin (the sign and record calls) and the storage host (the S3 bucket or
 * the `.convex.cloud` origin) at request time, because the upload page sends bytes straight to storage
 * and the download page fetches text files to preview them. `blob:` is in `img-src`
 * and `media-src` so a picked file can be shown before it is sent. Everything else
 * is off: no frames in either direction, no forms, no workers, no base retargeting.
 * `frame-src 'none'` is why the PDF preview is a panel and not an iframe.
 */
const filePageCsp = (): string =>
  [
    "default-src 'none'",
    "img-src https: data: blob:",
    "media-src https: data: blob:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "script-src 'unsafe-inline'",
    `connect-src 'self' ${storageOrigin()}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "worker-src 'none'",
  ].join("; ");

const filePageHeaders = () => ({
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": filePageCsp(),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

/** A dead link or an expired one: same plain page, same headers. */
const filePageNotice = (title: string, text: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
      + `<meta name="viewport" content="width=device-width,initial-scale=1">`
      + `<meta name="color-scheme" content="dark"><title>${title}</title></head>`
      + `<body style="margin:0;background:#000;color:#898781;font:17px/1.5 system-ui,-apple-system,sans-serif">`
      + `<main style="width:min(560px,calc(100% - 32px));margin:0 auto;padding:44px 0">${text}</main></body></html>`,
    { status, headers: filePageHeaders() },
  );

/** The page someone opens to send files in. */
http.route({
  pathPrefix: "/u/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/u/".length).replace(/\/+$/, ""));
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return filePageNotice("Not found", "That link is not valid any more.", 404);
    if (found.request.expiresAt < Date.now()) {
      return filePageNotice("Expired", "This upload link has expired.", 410);
    }
    return new Response(
      uploadPage(slug, found.request.reason, found.files, found.request.expiresAt),
      { status: 200, headers: filePageHeaders() },
    );
  }),
});

/** Files an agent sent to Aryan: previewable on a phone, downloadable to keep. */
http.route({
  pathPrefix: "/s/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const slug = decodeURIComponent(new URL(request.url).pathname.slice("/s/".length).replace(/\/+$/, ""));
    const found = await ctx.runQuery(internal.uploads.bySlug, { slug });
    if (!found) return filePageNotice("Not found", "That link is not valid any more.", 404);
    if (found.request.expiresAt < Date.now()) {
      return filePageNotice("Expired", "This link has expired.", 410);
    }
    const files = await Promise.all(
      found.files.map(async (f) => ({
        name: f.name,
        size: f.size,
        contentType: f.contentType,
        url: await readUrl(ctx, f, 3600),
      })),
    );
    // "Sent" is when the last file landed; for an empty link, when the link was made.
    const sentAt = found.files.reduce(
      (latest, f) => Math.max(latest, f.uploadedAt),
      found.request._creationTime,
    );
    return new Response(
      downloadPage({
        reason: found.request.reason,
        files,
        sentAt,
        expiresAt: found.request.expiresAt,
      }),
      { status: 200, headers: filePageHeaders() },
    );
  }),
});

/**
 * The sandbox for served drafts, enforced by the browser.
 *
 * The upload policy (`src/html-policy.js`) allows inline classic `<script>`, so the
 * CSP has to keep `script-src 'unsafe-inline'` -- a draft's own scripts still run.
 * What it takes away is everything that script could reach out with: `connect-src
 * 'none'` kills fetch/XHR/WebSocket/beacon, `frame-src`/`frame-ancestors 'none'`
 * stops it framing anything or being framed, `form-action 'none'` stops posts,
 * `worker-src 'none'` stops workers, and `base-uri 'none'` stops base-tag
 * retargeting. Images, media and fonts are the only remote loads left.
 *
 * What it does NOT do: it cannot block same-origin DOM or storage APIs, so a draft
 * can still read and write `localStorage`/`sessionStorage`/cookies for this origin,
 * and it does nothing at all for non-browser clients like curl -- the bytes are
 * served verbatim either way.
 *
 * One opening: a version with `question` fences gets `connect-src` set to that
 * draft's own answer endpoint, `<origin>/api/d/<draftId>/answers`, and nothing
 * else. The path is exact, so the page can save answers to its own draft and
 * still reach no other URL, on this origin or any other. Every other version
 * keeps `connect-src 'none'`.
 *
 * This covers `/d/` only. The `/u/` and `/s/` pages are our own HTML, not uploaded
 * HTML, and they need cross-origin fetch, PUT and framing against S3, so they are
 * deliberately left out of it.
 */
const draftCsp = (connect: string[] = []): string =>
  [
    "default-src 'none'",
    "img-src https: data:",
    "media-src https: data:",
    "style-src 'unsafe-inline'",
    "font-src data:",
    "script-src 'unsafe-inline'",
    `connect-src ${connect.length ? connect.join(" ") : "'none'"}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "worker-src 'none'",
  ].join("; ");

/** Headers for the uploaded HTML we serve from this origin: the sandbox above, plus no sniffing. */
const htmlSecurityHeaders = (connect: string[] = []) => ({
  "Content-Security-Policy": draftCsp(connect),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
});

/**
 * The answer endpoint a draft page may connect to, as CSP sources: one per
 * origin the reader might be on (the request's own, and the public base URL
 * when that differs). The id is percent-encoded so it can never end the
 * directive; an id that needed encoding gets no source at all.
 */
function answerSources(request: Request, draftId: string): string[] {
  if (!/^[A-Za-z0-9_-]+$/.test(draftId)) return [];
  const origins = new Set([new URL(request.url).origin]);
  try {
    origins.add(new URL(baseUrl(request)).origin);
  } catch {
    // a malformed POSTPLAN_PUBLIC_BASE_URL: the request's own origin still works
  }
  return [...origins].map((origin) => `${origin}/api/d/${draftId}/answers`);
}

const notFound = (text: string) =>
  new Response("<!doctype html><meta charset=utf-8><title>Not found</title>"
    + `<body style='background:#000;color:#888;font:16px system-ui;padding:48px'>${text}`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8", ...htmlSecurityHeaders() },
    });

/**
 * The published document. `/d/<id>` serves the latest version, which is what keeps
 * one URL stable across uploads; `/d/<id>/v/<n>` serves version n exactly. Both
 * take a `/raw` suffix. Convex has no route params, so this one prefix route parses
 * the version itself. A version's bytes never change, so its URL caches forever.
 */
async function serveDraft(ctx: ActionCtx, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  const raw = path.endsWith("/raw");
  const rest = decodeURIComponent(
    path.slice("/d/".length).replace(/\/raw$/, "").replace(/\/+$/, ""),
  );
  const pinned = rest.match(/^(.+)\/v\/(\d+)$/);

  // The id as the reader typed it: the page posts answers to the same one.
  const requested = pinned ? pinned[1] : rest;
  let version;
  if (pinned) {
    version = await ctx.runQuery(internal.drafts.version, {
      draftId: pinned[1],
      versionNumber: Number(pinned[2]),
    });
    if (!version) return notFound("No such version.");
  } else {
    const found = await ctx.runQuery(internal.drafts.latest, { draftId: rest });
    if (!found) return notFound("No such draft.");
    version = found.version;
  }

  const connect = version.questions?.length ? answerSources(request, requested) : [];
  const html = await readText(ctx, version);
  if (html === null) return new Response("Draft content missing", { status: 502 });
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": raw ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      "Cache-Control": pinned ? "private, max-age=31536000, immutable" : "private, max-age=30",
      "X-Postplan-Version": String(version.versionNumber),
      // /raw is plain text and is never rendered, so it needs nosniff but no CSP.
      ...(raw ? { "X-Content-Type-Options": "nosniff" } : htmlSecurityHeaders(connect)),
    },
  });
}

http.route({
  pathPrefix: "/d/",
  method: "GET",
  handler: httpAction(serveDraft),
});

export default http;
