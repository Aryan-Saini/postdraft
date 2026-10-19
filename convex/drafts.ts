import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { questionSpec } from "./schema";

/** A draft by slug, falling back to its Convex document id (same as uploads). Also used by answers.ts. */
export async function findDraft(ctx: QueryCtx, draftId: string) {
  const draft = await ctx.db
    .query("drafts")
    .withIndex("by_draftId", (q) => q.eq("draftId", draftId))
    .unique();
  if (draft) return draft;
  const id = ctx.db.normalizeId("drafts", draftId);
  return id ? await ctx.db.get(id) : null;
}

export const upsert = internalMutation({
  args: {
    draftId: v.string(),
    filename: v.string(),
    description: v.optional(v.string()),
    key: v.string(),
    storageId: v.optional(v.id("_storage")),
    sha256: v.optional(v.string()),
    bytes: v.number(),
    metadata: v.optional(v.any()),
    createdBy: v.string(),
    questions: v.optional(v.array(questionSpec)),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("drafts")
      .withIndex("by_draftId", (q) => q.eq("draftId", args.draftId))
      .unique();
    const versionNumber = existing ? existing.latestVersion + 1 : 1;

    if (existing) {
      await ctx.db.patch(existing._id, {
        filename: args.filename,
        description: args.description ?? existing.description,
        latestVersion: versionNumber,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("drafts", {
        draftId: args.draftId,
        filename: args.filename,
        description: args.description,
        latestVersion: versionNumber,
        createdBy: args.createdBy,
        updatedAt: Date.now(),
      });
    }

    await ctx.db.insert("versions", {
      draftId: args.draftId,
      versionNumber,
      key: args.key,
      storageId: args.storageId,
      sha256: args.sha256,
      bytes: args.bytes,
      metadata: args.metadata,
      createdBy: args.createdBy,
      description: args.description,
      questions: args.questions?.length ? args.questions : undefined,
      createdAt: Date.now(),
    });
    return { versionNumber };
  },
});

/** The newest version of a draft -- what a public URL serves. */
export const latest = internalQuery({
  args: { draftId: v.string() },
  handler: async (ctx, args) => {
    const draft = await findDraft(ctx, args.draftId);
    if (!draft) return null;
    const version = await ctx.db
      .query("versions")
      .withIndex("by_draft_version", (q) =>
        q.eq("draftId", draft.draftId).eq("versionNumber", draft.latestVersion),
      )
      .unique();
    return version ? { draft, version } : null;
  },
});

/** One exact version of a draft, or null. Versions never change once written. */
export const version = internalQuery({
  args: { draftId: v.string(), versionNumber: v.number() },
  handler: async (ctx, args) => {
    const draft = await findDraft(ctx, args.draftId);
    if (!draft) return null;
    return await ctx.db
      .query("versions")
      .withIndex("by_draft_version", (q) =>
        q.eq("draftId", draft.draftId).eq("versionNumber", args.versionNumber),
      )
      .unique();
  },
});

/** Every version of a draft, newest first, or null when the draft does not exist. */
export const versions = internalQuery({
  args: { draftId: v.string() },
  handler: async (ctx, args) => {
    const draft = await findDraft(ctx, args.draftId);
    if (!draft) return null;
    const rows = await ctx.db
      .query("versions")
      .withIndex("by_draft_version", (q) => q.eq("draftId", draft.draftId))
      .order("desc")
      .collect();
    return {
      draftId: draft.draftId,
      filename: draft.filename,
      latestVersionNumber: draft.latestVersion,
      versions: rows.map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const text = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : null);
        return {
          versionNumber: row.versionNumber,
          bytes: row.bytes,
          createdAt: new Date(row.createdAt).toISOString(),
          // Pre-0.7.0 versions did not record an uploader; the draft's creator did them all.
          createdBy: row.createdBy ?? draft.createdBy,
          sha256: row.sha256 ?? null,
          description: row.description ?? null,
          gitBranch: text("gitBranch"),
          gitCommitSha: text("gitCommitSha"),
          gitCommitSubject: text("gitCommitSubject"),
        };
      }),
    };
  },
});

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const drafts = await ctx.db.query("drafts").order("desc").take(100);
    // Field names match what the upstream CLI renders, or `list` prints undefined.
    return await Promise.all(
      drafts.map(async (d) => {
        const versions = await ctx.db
          .query("versions")
          .withIndex("by_draft", (q) => q.eq("draftId", d.draftId))
          .collect();
        const newest = versions.at(-1);
        const meta = (newest?.metadata ?? {}) as Record<string, unknown>;
        return {
          draftId: d.draftId,
          title: d.filename,
          description: d.description ?? null,
          publicUrl: `${process.env.POSTPLAN_PUBLIC_BASE_URL ?? process.env.CONVEX_SITE_URL ?? ""}/d/${d.draftId}`,
          latestVersionNumber: d.latestVersion,
          versionCount: versions.length,
          repoName: (meta.repoName as string) ?? null,
          repoOrg: (meta.repoOrg as string) ?? null,
          disabled: false,
          updatedAt: new Date(d.updatedAt).toISOString(),
        };
      }),
    );
  },
});
