/**
 * `question` fences: one answerable question each.
 *
 *     {"id":"capital","kind":"choice","prompt":"Capital of France?",
 *      "options":["Lyon","Paris"],"answer":"Paris","explain":"Since 508."}
 *
 * `id` must be unique across the document (checked in `validateDoc`, which sees
 * every fence). `answer` is optional; when present it must be gradable for its
 * kind, so a typo in the key fails the render instead of marking every reader
 * wrong.
 *
 * @module render/schema/question
 */

import { MAX_OPTIONS, QUESTION_ID, QUESTION_KINDS, parseNumber } from "../../questions.js";
import {
  Ctx, ptr, show, wantObject, wantText, wantNumber, optionalString, optionalEnum, unknownKeys,
} from "./common.js";

const KEYS = ["id", "kind", "prompt", "options", "answer", "explain", "tolerance"];
const HAS_OPTIONS = new Set(["choice", "multi"]);

/**
 * @param {import("../ir.js").RenderError[]} errors
 * @param {{ data: unknown, line: number }} block
 * @param {string} file
 */
export function validateQuestion(errors, block, file) {
  const ctx = new Ctx(errors, file, block.line, "question");
  if (!wantObject(ctx, block.data, "", "a question { id, kind, prompt }")) return;
  const q = /** @type {Record<string, unknown>} */ (block.data);

  if (wantText(ctx, q.id, "/id", "an id") && !QUESTION_ID.test(/** @type {string} */ (q.id))) {
    ctx.at("/id", `expected letters, digits, "_", "." or "-", up to 64 characters, got ${show(q.id)}`);
  }
  if (q.kind === undefined) ctx.at("/kind", `expected one of ${QUESTION_KINDS.join(" ")}, got nothing`);
  else optionalEnum(ctx, q.kind, "/kind", QUESTION_KINDS);
  wantText(ctx, q.prompt, "/prompt", "a prompt");
  optionalString(ctx, q.explain, "/explain");
  unknownKeys(ctx, q, "", KEYS);

  const kind = /** @type {string} */ (q.kind);
  if (!QUESTION_KINDS.includes(/** @type {never} */ (kind))) return;

  const options = HAS_OPTIONS.has(kind) ? optionList(ctx, q.options) : null;
  if (!HAS_OPTIONS.has(kind) && q.options !== undefined) ctx.at("/options", `only choice and multi take options, not ${kind}`);

  if (q.tolerance !== undefined) {
    if (kind !== "number") ctx.at("/tolerance", `only number takes a tolerance, not ${kind}`);
    else if (wantNumber(ctx, q.tolerance, "/tolerance") && /** @type {number} */ (q.tolerance) < 0) {
      ctx.at("/tolerance", `expected zero or more, got ${show(q.tolerance)}`);
    }
  }

  if (q.answer !== undefined) answerKey(ctx, kind, q.answer, options);
}

/**
 * `options` for choice and multi: 2 to 26 distinct, non-empty strings.
 * @returns {string[] | null} the options when they checked out
 */
function optionList(ctx, v) {
  if (!Array.isArray(v)) {
    ctx.at("/options", `expected at least 2 options, got ${show(v)}`);
    return null;
  }
  if (v.length < 2 || v.length > MAX_OPTIONS) {
    ctx.at("/options", `expected 2 to ${MAX_OPTIONS} options, got ${v.length}`);
    return null;
  }
  let ok = true;
  const seen = new Set();
  v.forEach((o, i) => {
    if (!wantText(ctx, o, ptr("/options", i), "an option")) ok = false;
    else if (seen.has(o)) ok = ctx.at(ptr("/options", i), `duplicate option ${show(o)}`);
    seen.add(o);
  });
  return ok ? v : null;
}

/** The answer key, which must be one the page can grade. */
function answerKey(ctx, kind, answer, options) {
  if (kind === "number") {
    if (parseNumber(answer) === null) ctx.at("/answer", `expected a number or a fraction like "2/3", got ${show(answer)}`);
    return;
  }
  if (kind === "multi") {
    if (!Array.isArray(answer) || answer.length === 0) {
      ctx.at("/answer", `expected a list of the correct options, got ${show(answer)}`);
      return;
    }
    if (options) {
      answer.forEach((a, i) => {
        if (!options.includes(a)) ctx.at(ptr("/answer", i), `expected one of the options, got ${show(a)}`);
      });
    }
    return;
  }
  if (!wantText(ctx, answer, "/answer", "the answer as a string")) return;
  if (kind === "choice" && options && !options.includes(answer)) {
    ctx.at("/answer", `expected one of the options, got ${show(answer)}`);
  }
}
