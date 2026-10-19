#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import {
  inferProject, isBuild, isoInstant, objectName, parseAssetRef, planExpiry, randomId, slugify
} from "../src/assets.js";
import { parseDraftRef } from "../src/draft-ref.js";
import { bundleHash, defaultRoots, installSkills, updateIfStale, writeState } from "../src/skills.js";
import { installPage, itmsLink, manifestPlist, readIpaInfo } from "../src/ios.js";
import { fmtBytes } from "../src/render/filetypes.js";
import { validateHtml } from "../src/html-policy.js";
import { render } from "../src/render/index.js";
import { formatError } from "../src/render/schema/index.js";

// Single source of truth for the version: package.json. CI bumps it on every
// merge to main, so a hardcoded copy here would immediately drift.
const { version: VERSION, name: PACKAGE_NAME } = createRequire(import.meta.url)("../package.json");
// The same code ships as `postdraft` and `postplan-aryan`. Help and errors use the
// name it was invoked as: the npm bin link's basename, or the package name when
// node runs this file directly (`node bin/postplan.js`, Windows shims).
const invokedAs = path.basename(process.argv[1] ?? "");
const CLI_NAME = invokedAs.endsWith(".js") ? PACKAGE_NAME : invokedAs;
// No deployment is baked in: point the CLI at your own instance with
// `postdraft auth set <key> --api-url <url>`, or POSTPLAN_API_URL.
const DEFAULT_API_URL = process.env.POSTPLAN_API_URL || "https://postplan.dev";
const POSTPLAN_DIR = path.join(os.homedir(), ".postplan");
const CONFIG_PATH = path.join(POSTPLAN_DIR, "config.json");
const CREDENTIALS_PATH = path.join(POSTPLAN_DIR, "credentials.json");
const DRAFTS_PATH = path.join(POSTPLAN_DIR, "drafts.json");
const SKILLS_STATE_PATH = path.join(POSTPLAN_DIR, "skills.json");

class CliError extends Error {}

const CONTENT_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", heic: "image/heic", avif: "image/avif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/mp4",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
  pdf: "application/pdf", json: "application/json", zip: "application/zip",
  md: "text/markdown", txt: "text/plain", csv: "text/csv", log: "text/plain",
  html: "text/html", css: "text/css", js: "text/javascript", ts: "text/plain",
  py: "text/x-python", sh: "text/x-shellscript", yml: "text/yaml", yaml: "text/yaml",
  apk: "application/vnd.android.package-archive", dmg: "application/x-apple-diskimage",
  plist: "text/xml", xml: "text/xml", msi: "application/x-msi"
};

function guessType(name) {
  const ext = name.toLowerCase().split(".").pop();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

const program = new Command();

program
  .name(CLI_NAME)
  .description("Publish a self-contained HTML document and get a link back.")
  .version(VERSION);

// Installed skills follow the CLI: before any command, a bundle that changed since
// `skills install` is reinstalled, and the agent is told to re-read it. stderr, so
// one-line and --json output stays parseable. POSTPLAN_NO_SKILL_UPDATE=1 opts out.
program.hook("preAction", (_program, action) => {
  if (process.env.POSTPLAN_NO_SKILL_UPDATE || action.parent?.name() === "skills") return;
  try {
    const refreshed = updateIfStale({ statePath: SKILLS_STATE_PATH, version: VERSION });
    if (refreshed?.length) {
      console.error(`${CLI_NAME}: updated the installed skills to ${VERSION}:`);
      for (const file of refreshed) console.error(`  ${file}`);
      console.error("Re-read the SKILL.md of the skill you are using before you continue; its instructions may have changed.");
    }
  } catch (err) {
    console.error(`${CLI_NAME}: could not update the installed skills: ${err.message}`);
  }
});

const skillsCommand = program.command("skills").description("Install the agent skills that drive this CLI.");

skillsCommand
  .command("install")
  .description("Copy the bundled skills into your agent's skills folder. They update themselves after that.")
  .option("--dir <path...>", "Skills folder(s) to install into (default: ~/.claude/skills and/or ~/.agents/skills)")
  .option("--force", `Replace same-named skill folders that ${CLI_NAME} did not install`)
  .action((options) => {
    const roots = (options.dir ?? defaultRoots()).map((dir) => path.resolve(dir.replace(/^~(?=$|\/)/, os.homedir())));
    const { installed, skipped } = installSkills({ roots, version: VERSION, force: options.force });
    for (const dir of installed) console.log(`Installed ${dir}`);
    for (const { path: dir, reason } of skipped) console.log(`Skipped ${dir}: ${reason}`);
    writeState(SKILLS_STATE_PATH, { hash: bundleHash(), version: VERSION, roots });
    if (!installed.length) throw new CliError("No skills were installed.");
  });

const authCommand = program.command("auth").description("Manage CLI authentication.");

authCommand
  .command("set")
  .argument("<api-key>", "Postplan API key")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .action((apiKey, options) => {
    saveCredentials(apiKey, options.apiUrl);
    console.log("Postplan credentials saved.");
  });

authCommand
  .command("login")
  .description("Log in by pasting an API key from the browser. Works over SSH.")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .action(async (options) => {
    const { apiUrl } = readAuth(options.apiUrl, { requireApiKey: false });

    console.log("Open this in your browser (any device):\n");
    console.log(`  ${apiUrl}/cli/auth\n`);
    console.log("Sign in, generate a key, then paste it below.\n");

    const readline = await import("node:readline/promises");
    const { once } = await import("node:events");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let apiKey;
    try {
      // rl.question never resolves if stdin closes (EOF/ctrl-d) — race the
      // close event so that path hits the "No key entered" error below
      // instead of exiting 0 silently.
      apiKey = (
        await Promise.race([
          rl.question("Paste your API key: "),
          once(rl, "close").then(() => "")
        ])
      ).trim();
    } finally {
      rl.close();
    }

    if (!apiKey) {
      throw new CliError("No key entered. Nothing saved.");
    }

    const response = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new CliError(body.error || "That key was rejected. Nothing saved.");
    }

    saveCredentials(apiKey, options.apiUrl);
    console.log(`\nLogged in as ${body.accountName} (key: ${body.apiKeyName}).`);
  });

program
  .command("whoami")
  .description("Check the configured Postplan credentials.")
  .action(async () => {
    const { apiUrl, apiKey } = readAuth();
    const response = await fetch(`${apiUrl}/api/me`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new CliError(body.error || "Authentication failed.");
    }
    console.log(`Account: ${body.accountName} (${body.accountId})`);
    console.log(`API key: ${body.apiKeyName} (${body.apiKeyId})`);
  });

program
  .command("render")
  .argument("<input>", "Markdown (.md) or an already-built IR (.json)")
  .option("--out <path>", "Where to write the HTML (default: the input path with .html)")
  .option("--emit-ir", "Also write the block IR beside the output, as .json")
  .option("--upload", "Publish the rendered HTML, keyed by the source path")
  .option("--draft <draft-id>", "Update a specific draft")
  .option("--new", "Always create a new draft")
  .option("--description <text>", "Set a short description for the draft")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .description("Render Markdown to a self-contained HTML document.")
  .action(async (input, options) => {
    const source = path.resolve(input);
    const out = options.out ? path.resolve(options.out) : withExtension(source, ".html");
    const { html, ir } = renderFile(source);

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html);
    console.log(out);

    if (options.emitIr) {
      const irPath = withExtension(out, ".json");
      fs.writeFileSync(irPath, `${JSON.stringify(ir, null, 2)}\n`);
      console.log(irPath);
    }

    if (options.upload) await publish(out, source, options);
  });

program
  .command("upload")
  .argument("<file>", "HTML file path, or Markdown to render first")
  .option("--draft <draft-id>", "Update a specific draft")
  .option("--new", "Always create a new draft")
  .option("--description <text>", "Set a short description for the draft")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .description("Upload or update an HTML draft. Markdown is rendered first.")
  .action(async (file, options) => {
    const resolvedFile = path.resolve(file);

    if (!fs.existsSync(resolvedFile)) {
      throw new CliError(`File does not exist: ${resolvedFile}`);
    }

    // Markdown is rendered to the sibling .html and that is what is published,
    // but the draft stays keyed by the .md: re-uploading the source it was
    // written from keeps the URL, which is the path an author actually edits.
    if (path.extname(resolvedFile).toLowerCase() === ".md") {
      const out = withExtension(resolvedFile, ".html");
      fs.writeFileSync(out, renderFile(resolvedFile).html);
      await publish(out, resolvedFile, options);
      return;
    }

    await publish(resolvedFile, resolvedFile, options);
  });

/**
 * Render a `.md` or a `.json` IR, or report every diagnostic and exit. Nothing
 * is written on failure, so a bad document never leaves a stale file behind.
 */
function renderFile(source) {
  if (!fs.existsSync(source)) throw new CliError(`File does not exist: ${source}`);
  const text = fs.readFileSync(source, "utf8");
  const input = path.extname(source).toLowerCase() === ".json" ? parseJson(text, source) : text;

  const result = render(input, { file: source });
  if (result.errors.length) {
    // Sorted by line so the list reads down the document, whichever stage of the
    // pipeline found each problem.
    for (const error of [...result.errors].sort((a, b) => a.line - b.line)) console.error(formatError(error));
    process.exit(1);
  }
  return result;
}

/**
 * `JSON.parse` for an IR input, reported the way every other diagnostic is:
 * `plan.json:12 invalid JSON: …`, not a raw stack trace.
 */
function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const at = /at position (\d+)/.exec(message);
    const line = at ? text.slice(0, Number(at[1])).split("\n").length : 1;
    const reason = message.replace(/,?\s*(?:\.\.\.)?"[\s\S]*"(?:\.\.\.)?\s*is not valid JSON/, "").trim();
    throw new CliError(`${source}:${line} invalid JSON: ${reason || "not valid JSON"}`);
  }
}

/** Swap a path's extension, so `plan.md` becomes `plan.html`. */
function withExtension(file, ext) {
  return path.join(path.dirname(file), `${path.basename(file, path.extname(file))}${ext}`);
}

/**
 * Publish `htmlPath`, remembering the draft under `key`. The two differ only for
 * Markdown, where the key is the source the author edits and the HTML is a build
 * artifact that may be deleted between runs.
 */
async function publish(htmlPath, key, options) {
    const resolvedFile = htmlPath;
    const { apiUrl, apiKey } = readAuth(options.apiUrl, { requireApiKey: false });

    const html = fs.readFileSync(resolvedFile, "utf8");
    const validation = validateHtml(html);

    if (!validation.ok) {
      throw new CliError(`HTML failed Postplan validation:\n- ${validation.errors.join("\n- ")}`);
    }

    const drafts = readDrafts();
    const knownDraft = drafts.files?.[key];
    const draftId = options.new ? null : options.draft || knownDraft?.draftId || null;

    const payload = {
      html,
      filename: path.basename(resolvedFile),
      draftId,
      description: options.description,
      metadata: {
        ...collectGitMetadata(path.dirname(resolvedFile)),
        ...collectCiMetadata(),
        cliVersion: VERSION,
        fileSha256: sha256(html)
      }
    };

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": `postplan/${VERSION}`
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(`${apiUrl}/api/uploads`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    const body = await response.json();
    if (!response.ok) {
      const details = body.errors?.length ? `\n- ${body.errors.join("\n- ")}` : "";
      throw new CliError(`${body.error || "Upload failed."}${details}`);
    }

    drafts.files ||= {};
    drafts.files[key] = {
      draftId: body.draftId,
      publicUrl: body.publicUrl,
      rawUrl: body.rawUrl || `${body.publicUrl.replace(/\/+$/, "")}/raw`,
      latestVersionNumber: body.versionNumber,
      updatedAt: new Date().toISOString()
    };
    writeJson(DRAFTS_PATH, drafts, 0o600);

    console.log(draftId ? "Updated draft" : "Uploaded draft");
    console.log(`URL: ${body.publicUrl}`);
    console.log(`Raw HTML: ${body.rawUrl || `${body.publicUrl.replace(/\/+$/, "")}/raw`}`);
    console.log(`Draft ID: ${body.draftId}`);
    console.log(`Version: ${body.versionNumber}`);
    console.log(`History: ${body.publicUrl.replace(/\/+$/, "")}/v/${body.versionNumber}`);
    for (const warning of body.warnings || []) {
      console.warn(`Warning: ${warning}`);
    }
}

program
  .command("generate-upload-link")
  // 0.2.0 shipped this as `generate-link`; keep it working for anything cached.
  .alias("generate-link")
  .description("Create a link someone can open on a phone to send files in.")
  .argument("[reason]", "why the link exists, shown on the page")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--days <n>", "How long the link stays open (default 7)", (v) => Number(v))
  .action(async (reason, options) => {
      const { apiUrl, apiKey } = readAuth(options.apiUrl);
      const response = await fetch(`${apiUrl}/api/upload-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ reason: reason || undefined, days: options.days })
      });
      const body = await response.json();
      if (!response.ok) throw new CliError(body.error || "Could not create the link.");
      console.log(body.url);
  });

program
  .command("send")
  .description("Send files out: returns a link to preview or download them on a phone.")
  .argument("<files...>", "files to send")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--reason <text>", "what these files are, shown on the page")
  .option("--days <n>", "How long the link stays open (default 7)", (v) => Number(v))
  .action(async (files, options) => {
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const resolved = files.map((f) => path.resolve(f));
    for (const file of resolved) {
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        throw new CliError(`Not a file: ${file}`);
      }
    }

    const created = await fetch(`${apiUrl}/api/upload-requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        reason: options.reason || path.basename(resolved[0]),
        days: options.days,
        direction: "out"
      })
    });
    const info = await created.json();
    if (!created.ok) throw new CliError(info.error || "Could not create the link.");

    for (const file of resolved) {
      const name = path.basename(file);
      const type = guessType(name);
      const signed = await fetch(`${apiUrl}/api/u/${info.slug}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, contentType: type })
      });
      const slot = await signed.json();
      if (!signed.ok) throw new CliError(slot.error || `Could not prepare ${name}.`);
      const storageId = await sendBytes(slot, type, fs.readFileSync(file), name);
      const recorded = await fetch(`${apiUrl}/api/u/${info.slug}/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: slot.key, name, size: fs.statSync(file).size, contentType: type, storageId })
      });
      if (!recorded.ok) throw new CliError(`Could not record ${name}.`);
    }
    console.log(info.url);
  });

program
  .command("fetch")
  .description("Download what was sent to an upload link.")
  .argument("<slug>", "the upload link's slug")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--output <dir>", "Where to write the files")
  .action(async (slug, options) => {
      const { apiUrl, apiKey } = readAuth(options.apiUrl);
      const response = await fetch(`${apiUrl}/api/upload-requests/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ slug })
      });
      const body = await response.json();
      if (!response.ok) throw new CliError(body.error || "Could not read that link.");
      if (!body.files.length) {
        console.log("Nothing has been sent to this link yet.");
        return;
      }
      const dir = options.output || path.join(os.homedir(), "Downloads", `upload-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const file of body.files) {
        const safe = path.basename(file.name).replace(/[/\\]/g, "_") || "file";
        const destination = path.join(dir, safe);
        const data = await fetch(file.url);
        if (!data.ok) throw new CliError(`Could not download ${file.name} (${data.status})`);
        fs.writeFileSync(destination, Buffer.from(await data.arrayBuffer()));
        console.log(destination);
      }
      console.log(`Downloaded ${body.files.length} file(s) to ${dir}`);
  });

/**
 * `postplan asset <file...>`: publish files to the assets bucket. Public files
 * get their permanent bucket URL; `--private` ones a stable `/a/<slug>` link that
 * redirects to a short-lived signed URL. Builds expire in 7 days by default, and
 * an `.ipa` also gets an iOS manifest and install page.
 */
const assetCommand = program
  .command("asset")
  .description("Publish files and print their URLs. Public by default.")
  .argument("[files...]", "files to publish")
  .option("--private", "Keep it private, reachable only through a stable /a/ link")
  .option("--project <name>", "Folder to file it under (default: the git repo, else the current folder)")
  .option("--expires <when>", "7d, 24h, never, or an ISO date (builds default to 7d)")
  .option("--no-manifest", "For an .ipa, skip the iOS manifest and install page")
  .option("--json", "Print {url, slug, visibility, expiresAt, key}")
  .option("--api-url <url>", "Override the default API base URL")
  .action(async (files, options) => {
    if (!files.length) throw new CliError(`Give at least one file: ${CLI_NAME} asset <file> [<file>...]`);
    const visibility = options.private ? "private" : "public";
    const project = options.project === undefined ? currentProject() : slugify(options.project);
    if (!project) throw new CliError(`--project needs letters or digits, got ${JSON.stringify(options.project)}`);

    // Everything that can fail locally fails before the first byte is sent.
    const plans = files.map((f) => {
      const file = path.resolve(f);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new CliError(`Not a file: ${file}`);
      const base = path.basename(file);
      let expiry;
      try {
        expiry = planExpiry({ name: base, expires: options.expires });
      } catch (err) {
        throw new CliError(err.message);
      }
      let ios = null;
      if (options.manifest && base.toLowerCase().endsWith(".ipa")) {
        try {
          ios = readIpaInfo(file);
        } catch (err) {
          throw new CliError(`${err.message}\nPass --no-manifest to upload it without the install page.`);
        }
      }
      return { file, base, suffix: randomId(), ...expiry, ios };
    });

    const auth = readAuth(options.apiUrl);
    const results = [];
    for (const plan of plans) {
      const common = { project, visibility, expiresAt: plan.expiresAt, tags: plan.tags };
      const asset = await putAsset(auth, {
        ...common,
        name: objectName(plan.base, plan.suffix),
        contentType: guessType(plan.base),
        body: fs.readFileSync(plan.file)
      });
      const result = { ...asset, file: plan.file };
      if (plan.ios) {
        // The manifest points at the ipa, and the page at the manifest, so they go up in that order.
        const stem = plan.base.replace(/\.ipa$/i, "");
        const manifest = await putAsset(auth, {
          ...common,
          name: objectName(`${stem}.plist`, plan.suffix),
          contentType: "text/xml",
          body: Buffer.from(manifestPlist({ url: asset.url, ...plan.ios }))
        });
        const link = itmsLink(manifest.url);
        const page = await putAsset(auth, {
          ...common,
          name: objectName(`${stem}.html`, plan.suffix),
          contentType: "text/html; charset=utf-8",
          body: Buffer.from(installPage({ ...plan.ios, link }))
        });
        result.install = { link, manifest, page };
      }
      results.push(result);
    }

    if (options.json) {
      const shaped = results.map(({ file: _file, ...rest }) => rest);
      console.log(JSON.stringify(shaped.length === 1 ? shaped[0] : shaped, null, 2));
      return;
    }
    results.forEach((result, i) => {
      if (i) console.log("");
      console.log(`Uploaded ${path.basename(result.file)} (${result.visibility})`);
      console.log(`URL: ${result.url}`);
      if (result.expiresAt) console.log(`Expires: ${isoInstant(result.expiresAt)}`);
      if (result.install) {
        console.log(`Install: ${result.install.link}`);
        console.log(`Install page: ${result.install.page.url}`);
      }
    });
  });

assetCommand
  .command("rm")
  .description("Delete an asset: its object and its record.")
  .argument("<ref>", "the asset's slug, /a/ link or bucket URL")
  .option("--api-url <url>", "Override the default API base URL")
  .action(async (ref, options) => {
    const parsed = parseAssetRef(ref);
    if (!parsed) throw new CliError(`Not an asset slug or URL: ${ref}`);
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const body = await postJson(`${apiUrl}/api/assets/remove`, apiKey, parsed, "Could not delete that asset.");
    console.log(`Deleted ${body.key}`);
  });

program
  .command("assets")
  .description("List your published assets, newest first.")
  .option("--api-url <url>", "Override the default API base URL")
  .option("--json", "Print the raw JSON response")
  .action(async (options) => {
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const response = await fetch(`${apiUrl}/api/assets`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new CliError(body.error || `Could not list assets (${response.status}).`);
    const assets = body.assets || [];
    if (options.json) {
      console.log(JSON.stringify(assets, null, 2));
      return;
    }
    if (!assets.length) {
      console.log(`No assets yet. Publish one with: ${CLI_NAME} asset <file>`);
      return;
    }
    const now = Date.now();
    const rows = [
      ["PROJECT", "NAME", "VISIBILITY", "SIZE", "EXPIRES", "URL"],
      ...assets.map((a) => [
        a.project,
        a.name,
        a.visibility,
        fmtBytes(a.size),
        a.expiresAt ? (a.expiresAt < now ? "expired" : isoInstant(a.expiresAt)) : "never",
        a.url
      ])
    ];
    const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
    for (const row of rows) {
      console.log(row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  "));
    }
  });

/**
 * Send one file's bytes to an upload slot from a sign endpoint: a PUT to S3 with
 * the signed headers, or a POST to Convex storage. Resolves to the Convex
 * `storageId` the record call needs, or undefined for S3.
 */
async function sendBytes(slot, contentType, body, name) {
  const method = slot.method || "PUT";
  const sent = await fetch(slot.url, {
    method,
    headers: { "Content-Type": contentType, ...slot.headers },
    body
  });
  if (!sent.ok) throw new CliError(`Upload failed for ${name} (${sent.status}).`);
  return method === "POST" ? (await sent.json()).storageId : undefined;
}

/**
 * One asset upload: get a slot, send the bytes straight to storage, then record
 * it. Resolves to the record response, `{ url, slug, visibility, expiresAt, key }`.
 */
async function putAsset({ apiUrl, apiKey }, { name, project, visibility, contentType, body, expiresAt, tags }) {
  const slot = await postJson(
    `${apiUrl}/api/assets/sign`,
    apiKey,
    { name, project, contentType, size: body.length, visibility, expires: expiresAt, tags },
    `Could not prepare ${name}.`
  );
  const storageId = await sendBytes(slot, contentType, body, name);
  return postJson(
    `${apiUrl}/api/assets/record`, apiKey, { key: slot.key, expires: expiresAt, storageId }, `Could not record ${name}.`
  );
}

/** POST JSON with the API key; the parsed body, or a CliError carrying the server's message. */
async function postJson(url, apiKey, payload, failure) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new CliError(body.error || `${failure} (${response.status})`);
  return body;
}

/** The project for an asset uploaded from here: git repo, else folder, else `random`. */
function currentProject() {
  const cwd = process.cwd();
  const remoteName = parseRemote(git(["config", "--get", "remote.origin.url"], cwd)).name;
  const root = git(["rev-parse", "--show-toplevel"], cwd);
  return inferProject({ repoName: remoteName || (root ? path.basename(root) : null), cwd, home: os.homedir() });
}

program
  .command("list")
  .description("List the drafts published to your account.")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .option("--json", "Print the raw JSON response")
  .action(async (options) => {
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const response = await fetch(`${apiUrl}/api/drafts`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new CliError(body.error || "Failed to list drafts.");
    }

    const drafts = body.drafts || [];

    if (options.json) {
      console.log(JSON.stringify(drafts, null, 2));
      return;
    }

    if (!drafts.length) {
      console.log(`No drafts yet. Publish one with: ${CLI_NAME} upload <file>`);
      return;
    }

    console.log(`Drafts (${drafts.length})\n`);
    for (const draft of drafts) {
      const repo = draft.repoOrg && draft.repoName ? `${draft.repoOrg}/${draft.repoName}` : "no repo";
      const version = draft.latestVersionNumber ? `v${draft.latestVersionNumber}` : "no versions";
      const count = `${draft.versionCount} version${draft.versionCount === 1 ? "" : "s"}`;
      const disabled = draft.disabled ? " · disabled" : "";

      console.log(draft.title || "Untitled Draft");
      console.log(`  ${repo} · ${version} · ${count} · updated ${timeAgo(draft.updatedAt)}${disabled}`);
      console.log(`  ${draft.publicUrl}`);
      if (draft.description) {
        console.log(`  ${draft.description}`);
      }
      console.log("");
    }
  });

program
  .command("versions")
  .argument("<draft>", "Draft id, or any of its URLs")
  .description("List every published version of a draft, newest first.")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .option("--json", "Print the raw JSON response")
  .action(async (draft, options) => {
    const ref = parseDraftRef(draft);
    if (!ref) throw new CliError(`Not a draft id or draft URL: ${draft}`);
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const response = await fetch(`${apiUrl}/api/drafts/${encodeURIComponent(ref.draftId)}/versions`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CliError(body.error || `Failed to list versions (${response.status}).`);
    }

    if (options.json) {
      console.log(JSON.stringify(body, null, 2));
      return;
    }

    const versions = body.versions || [];
    console.log(`${body.filename || body.draftId} (${versions.length} version${versions.length === 1 ? "" : "s"})`);
    console.log(`${body.publicUrl}\n`);
    const rows = [
      ["VERSION", "DATE", "BYTES", "UPLOADER", "COMMIT", "URL"],
      ...versions.map((v) => [
        `v${v.versionNumber}`,
        formatDate(v.createdAt),
        String(v.bytes),
        v.createdBy || "",
        v.gitCommitSha ? v.gitCommitSha.slice(0, 7) : "",
        v.url
      ])
    ];
    const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
    for (const row of rows) {
      console.log(row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join("  "));
    }
  });

program
  .command("answers")
  .argument("<draft>", "Draft id, or any of its URLs")
  .description("Show the answers readers saved to a draft's questions.")
  .option("--api-url <url>", "Override the default Postplan API base URL")
  .option("--json", "Print the raw JSON response")
  .action(async (draft, options) => {
    const ref = parseDraftRef(draft);
    if (!ref) throw new CliError(`Not a draft id or draft URL: ${draft}`);
    const { apiUrl, apiKey } = readAuth(options.apiUrl);
    const response = await fetch(`${apiUrl}/api/drafts/${encodeURIComponent(ref.draftId)}/answers`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new CliError(body.error || `Failed to read answers (${response.status}).`);
    }

    if (options.json) {
      console.log(JSON.stringify(body, null, 2));
      return;
    }

    const questions = body.questions || [];
    const answered = questions.filter((q) => q.answer !== null).length;
    console.log(`${body.draftId} v${body.latestVersionNumber}: ${answered} of ${questions.length} answered`);
    console.log(`${body.publicUrl}\n`);
    const show = (value) => (Array.isArray(value) ? value.join(", ") : String(value));
    for (const q of questions) {
      console.log(`${q.id}${q.kind ? ` (${q.kind})` : " (not in the latest version)"}${q.prompt ? `  ${q.prompt}` : ""}`);
      if (q.answer === null) {
        console.log("  no answer yet\n");
        continue;
      }
      const verdict = q.correct === true ? "correct" : q.correct === false ? `wrong, expected ${show(q.expected)}` : "";
      console.log(`  ${show(q.answer).replace(/\n/g, "\n  ")}`);
      console.log(`  ${[verdict, `saved ${formatDate(q.savedAt)}`, `v${q.versionNumber}`].filter(Boolean).join(" · ")}\n`);
    }
  });

program.exitOverride();

program.parseAsync(process.argv).catch((error) => {
  if (error instanceof CliError) {
    console.error(error.message);
    process.exit(1);
  }

  if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
    process.exit(0);
  }

  console.error(error.message || error);
  process.exit(1);
});

function readAuth(apiUrlOverride, { requireApiKey = true } = {}) {
  const config = readJson(CONFIG_PATH, {});
  const credentials = readJson(CREDENTIALS_PATH, {});
  const apiUrl = (
    apiUrlOverride ||
    process.env.POSTPLAN_API_URL ||
    config.apiUrl ||
    DEFAULT_API_URL
  ).replace(/\/+$/, "");
  const apiKey = process.env.POSTPLAN_API_KEY || credentials.apiKey;

  if (requireApiKey && !apiKey) {
    throw new CliError(`Missing API key. Run: ${CLI_NAME} auth set <api-key>`);
  }

  return { apiUrl, apiKey };
}

function ensureStateDir() {
  fs.mkdirSync(POSTPLAN_DIR, { recursive: true, mode: 0o700 });
}

function saveCredentials(apiKey, apiUrlOverride) {
  ensureStateDir();

  if (apiUrlOverride) {
    writeJson(CONFIG_PATH, {
      ...readJson(CONFIG_PATH, {}),
      apiUrl: apiUrlOverride.replace(/\/+$/, "")
    });
  }

  writeJson(
    CREDENTIALS_PATH,
    {
      apiKey,
      updatedAt: new Date().toISOString()
    },
    0o600
  );
}

function readDrafts() {
  return readJson(DRAFTS_PATH, { files: {} });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, mode = 0o600) {
  ensureStateDir();
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(file, mode);
}

function collectGitMetadata(cwd) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const parsedRemote = parseRemote(remote);
  const status = git(["status", "--porcelain"], cwd);

  return {
    repoOrg: parsedRemote.org || inferOrgFromRoot(repoRoot),
    repoName: parsedRemote.name || (repoRoot ? path.basename(repoRoot) : null),
    repoHost: parsedRemote.host || null,
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitCommitSha: git(["rev-parse", "HEAD"], cwd),
    gitCommitSubject: git(["log", "-1", "--format=%s"], cwd),
    // null when not a git repo; true/false when a working tree is present.
    gitDirty: status === null ? null : status.length > 0
  };
}

// Best-effort CI provenance. GitHub Actions is detected precisely (with a run
// URL); other CI systems are flagged generically. Nothing here is trusted for
// authorization — it is metadata for the dashboard and audit trail only.
function collectCiMetadata() {
  const env = process.env;
  if (env.GITHUB_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL || "https://github.com";
    const repo = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      ciProvider: "github_actions",
      ciRunUrl: repo && runId ? `${server}/${repo}/actions/runs/${runId}` : null,
      ciActor: env.GITHUB_ACTOR || null
    };
  }
  if (env.CI) {
    return { ciProvider: "unknown" };
  }
  return {};
}

function git(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

function parseRemote(remote) {
  if (!remote) return {};

  const cleaned = remote.replace(/\.git$/, "");
  const sshMatch = cleaned.match(/^[^@]+@([^:]+):([^/]+)\/(.+)$/);
  if (sshMatch) {
    return { host: sshMatch[1], org: sshMatch[2], name: path.basename(sshMatch[3]) };
  }

  try {
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return { host: url.hostname, org: parts[0], name: parts.at(-1) };
    }
  } catch {
    // Fall through to path parsing.
  }

  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return { org: parts.at(-2), name: parts.at(-1) };
  }

  return {};
}

function inferOrgFromRoot(repoRoot) {
  if (!repoRoot) return null;
  return path.basename(path.dirname(repoRoot));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** `2026-09-24 14:03` in local time, or `unknown`. */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timeAgo(value) {
  if (!value) return "unknown";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60]
  ];

  for (const [name, secs] of units) {
    const amount = Math.floor(seconds / secs);
    if (amount >= 1) return `${amount} ${name}${amount === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
