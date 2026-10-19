import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { answerValue } from "./schema";
import { findDraft } from "./drafts";
import { answerReport, checkAnswer } from "../src/questions.js";

/**
 * Answers readers type into a draft's `question` fences.
 *
 * `save` is reached from the unauthenticated `POST /api/d/<draftId>/answers`,
 * so everything it is handed is untrusted: the question must exist in the
 * version the reader has open, the value must fit that question, and one
 * question takes at most one save a second. The draft id is the credential, as
 * a slug is on `/u/` and `/s/`.
 */

/** Earlier answers kept per question, beyond the latest. */
const HISTORY = 20;

/** Minimum gap between two saves of one question. */
const MIN_INTERVAL_MS = 1000;

type SaveResult =
  | { ok: true; savedAt: number; versionNumber: number }
  | { ok: false; status: 400 | 404 | 429; error: string };

/** One version of a draft by number. */
const versionOf = (ctx: QueryCtx, draftId: string, versionNumber: number) =>
  ctx.db
    .query("versions")
    .withIndex("by_draft_version", (q) => q.eq("draftId", draftId).eq("versionNumber", versionNumber))
    .unique();

export const save = internalMutation({
  args: {
    draftId: v.string(),
    questionId: v.string(),
    value: answerValue,
    // The version the reader has open, from a `/v/<n>` URL; the latest otherwise.
    versionNumber: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SaveResult> => {
    const draft = await findDraft(ctx, args.draftId);
    if (!draft) return { ok: false, status: 404, error: "No such draft." };
    const versionNumber = args.versionNumber ?? draft.latestVersion;
    const version = await versionOf(ctx, draft.draftId, versionNumber);
    if (!version) return { ok: false, status: 404, error: "No such version." };
    const spec = version.questions?.find((q) => q.id === args.questionId);
    if (!spec) return { ok: false, status: 404, error: "This version has no such question." };
    const checked = checkAnswer(spec, args.value);
    if (!checked.ok) return { ok: false, status: 400, error: checked.error };

    const savedAt = Date.now();
    const existing = await ctx.db
      .query("answers")
      .withIndex("by_draft_question", (q) => q.eq("draftId", draft.draftId).eq("questionId", spec.id))
      .unique();
    if (!existing) {
      await ctx.db.insert("answers", {
        draftId: draft.draftId, questionId: spec.id, versionNumber, value: checked.value, savedAt, history: [],
      });
      return { ok: true, savedAt, versionNumber };
    }
    if (savedAt - existing.savedAt < MIN_INTERVAL_MS) {
      return { ok: false, status: 429, error: "saving too fast, try again in a second" };
    }
    // Re-sending the same answer moves its time; only a different one is history.
    const changed = JSON.stringify(existing.value) !== JSON.stringify(checked.value);
    const history = changed
      ? [...existing.history, { value: existing.value, versionNumber: existing.versionNumber, savedAt: existing.savedAt }]
      : existing.history;
    await ctx.db.patch(existing._id, { value: checked.value, versionNumber, savedAt, history: history.slice(-HISTORY) });
    return { ok: true, savedAt, versionNumber };
  },
});

/** Every question of a draft's latest version with its latest answer, or null when the draft does not exist. */
export const forDraft = internalQuery({
  args: { draftId: v.string() },
  handler: async (ctx, args) => {
    const draft = await findDraft(ctx, args.draftId);
    if (!draft) return null;
    const latest = await versionOf(ctx, draft.draftId, draft.latestVersion);
    // One row per question id ever answered, which the per-version cap bounds.
    const rows = await ctx.db
      .query("answers")
      .withIndex("by_draft_question", (q) => q.eq("draftId", draft.draftId))
      .take(2000);
    return {
      draftId: draft.draftId,
      latestVersionNumber: draft.latestVersion,
      questions: answerReport(latest?.questions ?? [], rows),
    };
  },
});
