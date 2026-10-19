import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A question a version carries, read from its `data-q` attributes at upload (see src/questions.js). */
export const questionSpec = v.object({
  id: v.string(),
  kind: v.union(v.literal("short"), v.literal("long"), v.literal("number"), v.literal("choice"), v.literal("multi")),
  prompt: v.string(),
  options: v.optional(v.array(v.string())),
  answer: v.optional(v.union(v.string(), v.number(), v.array(v.string()))),
  tolerance: v.optional(v.number()),
});

/** A reader's answer: text, or for `multi` the option texts picked. */
export const answerValue = v.union(v.string(), v.array(v.string()));

export default defineSchema({
  // A draft is a stable URL. Re-uploading the same file updates it in place and
  // adds a version, which is the whole point of the CLI's draftId round-trip.
  drafts: defineTable({
    draftId: v.string(),
    filename: v.string(),
    description: v.optional(v.string()),
    latestVersion: v.number(),
    createdBy: v.string(),
    updatedAt: v.number(),
  }).index("by_draftId", ["draftId"]),

  // An upload request: a link someone opens on a phone to send files in. The slug
  // is the credential, since whoever uploads may not be the person who made it.
  uploadRequests: defineTable({
    slug: v.string(),
    // "in" = someone sends files to Aryan; "out" = an agent sends files to him.
    // Optional so rows created before the outbound direction existed still load.
    direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
    reason: v.optional(v.string()),
    createdBy: v.string(),
    expiresAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_expiresAt", ["expiresAt"]),

  uploadFiles: defineTable({
    slug: v.string(),
    key: v.string(),
    name: v.string(),
    size: v.number(),
    contentType: v.string(),
    // Set in Convex storage mode; S3 rows are addressed by `key` alone.
    storageId: v.optional(v.id("_storage")),
    uploadedAt: v.number(),
  }).index("by_slug", ["slug"]),

  // A file published with `postplan asset`: in S3 mode the assets bucket (not the
  // drafts bucket), in Convex mode Convex storage. Public ones are served straight from the bucket; private ones only
  // through `/a/<slug>`, where the slug is the credential.
  assets: defineTable({
    slug: v.string(),
    key: v.string(),
    bucket: v.string(),
    visibility: v.union(v.literal("public"), v.literal("private")),
    project: v.string(),
    name: v.string(),
    size: v.number(),
    contentType: v.string(),
    expiresAt: v.optional(v.number()),
    // Set in Convex storage mode, where `bucket` is "convex" and `key` is only a label.
    storageId: v.optional(v.id("_storage")),
    createdBy: v.string(),
  })
    .index("by_slug", ["slug"])
    .index("by_key", ["key"])
    .index("by_createdBy", ["createdBy"])
    .index("by_expiresAt", ["expiresAt"]),

  versions: defineTable({
    draftId: v.string(),
    versionNumber: v.number(),
    key: v.string(),
    // Set in Convex storage mode; S3 versions are addressed by `key` alone.
    storageId: v.optional(v.id("_storage")),
    sha256: v.optional(v.string()),
    bytes: v.number(),
    metadata: v.optional(v.any()),
    // Who uploaded this version and the description it was uploaded with.
    // Optional: versions written before 0.7.0 have neither.
    createdBy: v.optional(v.string()),
    description: v.optional(v.string()),
    // The questions this version's HTML carries. Absent on versions without any,
    // and on every version uploaded before questions existed.
    questions: v.optional(v.array(questionSpec)),
    createdAt: v.number(),
  })
    .index("by_draft", ["draftId"])
    .index("by_draft_version", ["draftId", "versionNumber"]),

  // The latest answer to one question of one draft, from whoever holds the link,
  // with up to 20 earlier answers kept in `history`, oldest first.
  answers: defineTable({
    draftId: v.string(),
    questionId: v.string(),
    versionNumber: v.number(),
    value: answerValue,
    savedAt: v.number(),
    history: v.array(v.object({ value: answerValue, versionNumber: v.number(), savedAt: v.number() })),
  }).index("by_draft_question", ["draftId", "questionId"]),
});
