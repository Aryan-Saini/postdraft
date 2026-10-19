/**
 * Answerable questions: the rules shared by the renderer, the reader's browser
 * and the Convex server.
 *
 * A `question` fence renders to an element carrying its spec as JSON in
 * `data-q`. The page script reads that spec to grade an answer, the upload
 * endpoint reads it (through `extractQuestions`) to learn which questions a
 * version has, and the answer endpoint checks every submission against it with
 * `checkAnswer`. `parseNumber` and `grade` are also embedded in the page script
 * by `Function.prototype.toString`, so they must stay self-contained: no
 * imports, no module-level references except each other by name.
 *
 * @module questions
 */

import * as parse5 from "parse5";

/** The five kinds of question. */
export const QUESTION_KINDS = /** @type {const} */ (["short", "long", "number", "choice", "multi"]);

/** @typedef {typeof QUESTION_KINDS[number]} QuestionKind */

/**
 * What the page carries in `data-q` and the server stores per version.
 * `answer` is the key: option text for `choice`, a list of option texts for
 * `multi`, a number or a fraction string for `number`, free text otherwise.
 * @typedef {{ id: string, kind: QuestionKind, prompt: string, options?: string[],
 *   answer?: string | number | string[], tolerance?: number }} QuestionSpec
 */

/** A reader's answer: text for every kind but `multi`, which is a list of option texts. */
/** @typedef {string | string[]} AnswerValue */

/** Stable, URL-safe and short: it keys localStorage, the answers table and the CLI output. */
export const QUESTION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Most questions one document may carry. */
export const MAX_QUESTIONS = 200;

/** Most options a `choice` or `multi` question may offer. */
export const MAX_OPTIONS = 26;

/** Longest answer the server accepts, in characters, per kind. */
export const MAX_ANSWER_CHARS = { short: 1000, long: 10000, number: 64, choice: 2000, multi: 2000 };

const KIND_SET = new Set(QUESTION_KINDS);

/**
 * A number as a reader types it: `42`, `-0.5`, `1e-3`, `.5`, or a fraction
 * `2/3`, `-7/4`. Returns null for anything else, including a zero denominator.
 *
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseNumber(text) {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  if (typeof text !== "string") return null;
  const num = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
  const m = new RegExp(`^(${num})(?:\\s*/\\s*(${num}))?$`).exec(text.trim());
  if (!m) return null;
  const top = Number(m[1]);
  const bottom = m[2] === undefined ? 1 : Number(m[2]);
  const value = top / bottom;
  return bottom !== 0 && Number.isFinite(value) ? value : null;
}

/**
 * Whether `value` matches the spec's answer key: true or false for `number`,
 * `choice` and `multi`, null when there is no key or the kind is free text.
 * A number is right within `tolerance`, or one part in a million by default.
 *
 * @param {QuestionSpec} spec
 * @param {AnswerValue | null | undefined} value
 * @returns {boolean | null}
 */
export function grade(spec, value) {
  if (spec.answer === undefined || spec.answer === null) return null;
  if (spec.kind === "number") {
    const want = parseNumber(spec.answer);
    const got = parseNumber(value);
    if (want === null) return null;
    if (got === null) return false;
    const tolerance = typeof spec.tolerance === "number" ? spec.tolerance : 1e-6 * Math.max(1, Math.abs(want));
    return Math.abs(got - want) <= tolerance;
  }
  if (spec.kind === "choice") return value === spec.answer;
  if (spec.kind === "multi") {
    if (!Array.isArray(value) || !Array.isArray(spec.answer)) return false;
    const want = new Set(spec.answer);
    return value.length === want.size && value.every((v) => want.has(v));
  }
  return null;
}

/**
 * Check one submitted answer against its question, the way the server must:
 * the endpoint is reachable by anyone holding the link, so the value is
 * untrusted. Text is trimmed; `long` keeps its inner whitespace.
 *
 * @param {QuestionSpec} spec
 * @param {unknown} value
 * @returns {{ ok: true, value: AnswerValue } | { ok: false, error: string }}
 */
export function checkAnswer(spec, value) {
  const max = MAX_ANSWER_CHARS[spec.kind];
  if (spec.kind === "multi") {
    if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
      return { ok: false, error: "expected a list of options" };
    }
    const options = spec.options ?? [];
    if (value.length === 0) return { ok: false, error: "pick at least one option" };
    if (new Set(value).size !== value.length) return { ok: false, error: "an option is listed twice" };
    if (!value.every((v) => options.includes(v))) return { ok: false, error: "not one of the options" };
    return { ok: true, value };
  }
  if (typeof value !== "string") return { ok: false, error: "expected text" };
  const text = spec.kind === "long" ? value.replace(/^\s*\n|\s+$/g, "") : value.trim();
  if (!text) return { ok: false, error: "the answer is empty" };
  if (text.length > max) return { ok: false, error: `the answer is longer than ${max} characters` };
  if (spec.kind === "choice" && !(spec.options ?? []).includes(text)) return { ok: false, error: "not one of the options" };
  if (spec.kind === "number" && parseNumber(text) === null) return { ok: false, error: "not a number" };
  return { ok: true, value: text };
}

/** Cap a string from an uploaded page before it is stored. */
const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : undefined);

/**
 * Turn one parsed `data-q` value into a spec the server can store, or null.
 * Uploaded HTML need not come from the renderer, so every field is re-checked
 * and anything malformed is dropped rather than trusted.
 *
 * @param {unknown} raw
 * @returns {QuestionSpec | null}
 */
function toSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const q = /** @type {Record<string, unknown>} */ (raw);
  if (typeof q.id !== "string" || !QUESTION_ID.test(q.id)) return null;
  if (typeof q.kind !== "string" || !KIND_SET.has(/** @type {QuestionKind} */ (q.kind))) return null;
  const kind = /** @type {QuestionKind} */ (q.kind);
  /** @type {QuestionSpec} */
  const spec = { id: q.id, kind, prompt: clip(q.prompt, 2000) ?? "" };
  if (kind === "choice" || kind === "multi") {
    if (!Array.isArray(q.options)) return null;
    spec.options = q.options.filter((o) => typeof o === "string").slice(0, MAX_OPTIONS).map((o) => o.slice(0, 500));
  }
  const a = q.answer;
  if (kind === "multi" && Array.isArray(a) && a.every((x) => typeof x === "string")) spec.answer = a.slice(0, MAX_OPTIONS);
  else if (kind === "number" && (typeof a === "number" ? Number.isFinite(a) : typeof a === "string")) spec.answer = a;
  else if (kind !== "multi" && kind !== "number" && typeof a === "string") spec.answer = a.slice(0, MAX_ANSWER_CHARS.long);
  if (kind === "number" && typeof q.tolerance === "number" && q.tolerance >= 0 && Number.isFinite(q.tolerance)) {
    spec.tolerance = q.tolerance;
  }
  return spec;
}

/**
 * The questions a page carries, read from every `data-q` attribute in document
 * order. A duplicate id keeps its first spec. Throws when the page has more than
 * `MAX_QUESTIONS`, which the upload endpoint reports as a 400.
 *
 * @param {string} html
 * @returns {QuestionSpec[]}
 */
export function extractQuestions(html) {
  if (!html.includes("data-q")) return [];
  /** @type {QuestionSpec[]} */
  const found = [];
  const seen = new Set();
  const stack = [parse5.parse(html)];
  while (stack.length) {
    const node = stack.pop();
    const attr = node.attrs?.find((a) => a.name === "data-q");
    if (attr) {
      let spec = null;
      try {
        spec = toSpec(JSON.parse(attr.value));
      } catch {
        // not JSON: not a question
      }
      if (spec && !seen.has(spec.id)) {
        seen.add(spec.id);
        found.push(spec);
      }
    }
    const children = node.content?.childNodes ?? node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  if (found.length > MAX_QUESTIONS) throw new Error(`a document may carry at most ${MAX_QUESTIONS} questions, got ${found.length}`);
  return found;
}

/**
 * One stored answer row, as the server keeps it: the latest value, and earlier
 * ones oldest first.
 * @typedef {{ questionId: string, value: AnswerValue, versionNumber: number, savedAt: number,
 *   history: { value: AnswerValue, versionNumber: number, savedAt: number }[] }} AnswerRow
 */

/**
 * What `GET /api/drafts/<id>/answers` returns per question, and so what
 * `postdraft answers --json` prints. Questions come in the latest version's
 * order; an answer to a question that version no longer has follows, with
 * `prompt: null`. `answer` is the reader's, `expected` the key.
 *
 * @param {QuestionSpec[]} questions the latest version's
 * @param {AnswerRow[]} rows
 */
export function answerReport(questions, rows) {
  const byId = new Map(rows.map((row) => [row.questionId, row]));
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
  const entry = (/** @type {QuestionSpec | null} */ spec, /** @type {string} */ id) => {
    const row = byId.get(id);
    return {
      id,
      kind: spec ? spec.kind : null,
      prompt: spec ? spec.prompt : null,
      options: spec?.options ?? null,
      expected: spec?.answer ?? null,
      answer: row ? row.value : null,
      correct: spec && row ? grade(spec, row.value) : null,
      savedAt: row ? iso(row.savedAt) : null,
      versionNumber: row ? row.versionNumber : null,
      history: row ? row.history.map((h) => ({ answer: h.value, savedAt: iso(h.savedAt), versionNumber: h.versionNumber })) : [],
    };
  };
  const known = new Set(questions.map((q) => q.id));
  return [
    ...questions.map((q) => entry(q, q.id)),
    ...rows.filter((row) => !known.has(row.questionId)).map((row) => entry(null, row.questionId)),
  ];
}
