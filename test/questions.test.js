import test from "node:test";
import assert from "node:assert/strict";

import { parseMarkdown, render } from "../src/render/index.js";
import { validateDoc, formatError } from "../src/render/schema/index.js";
import { validateHtml } from "../src/html-policy.js";
import { QUESTIONS_SCRIPT } from "../src/render/questions.js";
import {
  MAX_ANSWER_CHARS, MAX_QUESTIONS, answerReport, checkAnswer, extractQuestions, grade, parseNumber, toSave,
} from "../src/questions.js";

const doc = (...bodies) =>
  `---\ntitle: T\n---\n\nLead.\n${bodies.map((b) => `\n\`\`\`question\n${b}\n\`\`\`\n`).join("")}`;
const errors = (...bodies) => {
  const { doc: parsed, errors: parse } = parseMarkdown(doc(...bodies), { file: "q.md" });
  assert.deepEqual(parse, []);
  return validateDoc(parsed, { file: "q.md" }).map(formatError);
};

const ALL = [
  '{"id":"name","kind":"short","prompt":"Your name?"}',
  '{"id":"essay","kind":"long","prompt":"Why?","answer":"Because.","explain":"See *lecture 3*."}',
  '{"id":"frac","kind":"number","prompt":"Two thirds?","answer":"2/3","tolerance":0.01}',
  '{"id":"cap","kind":"choice","prompt":"Capital of **France**?","options":["Lyon","Paris"],"answer":"Paris"}',
  '{"id":"primes","kind":"multi","prompt":"Primes?","options":["2","4","5"],"answer":["2","5"]}',
];

test("a question fence validates every kind", () => {
  assert.deepEqual(errors(...ALL), []);
});

test("a duplicate question id is reported at the second fence", () => {
  assert.deepEqual(errors('{"id":"a","kind":"short","prompt":"x"}', '{"id":"a","kind":"long","prompt":"y"}'), [
    'q.md:11 question: /id duplicate question id "a"; first used on line 7',
  ]);
});

test("a bad kind, a choice without options and a key that is not an option are named", () => {
  assert.deepEqual(errors('{"id":"a","kind":"essay","prompt":"x"}'), [
    'q.md:7 question: /kind expected one of short long number choice multi, got "essay"',
  ]);
  assert.deepEqual(errors('{"id":"a","kind":"choice","prompt":"x"}'), [
    "q.md:7 question: /options expected at least 2 options, got nothing",
  ]);
  assert.deepEqual(errors('{"id":"a","kind":"choice","prompt":"x","options":["p","q"],"answer":"r"}'), [
    'q.md:7 question: /answer expected one of the options, got "r"',
  ]);
  assert.deepEqual(errors('{"id":"a b","kind":"number","prompt":"x","answer":"lots","options":["p","q"]}'), [
    'q.md:7 question: /id expected letters, digits, "_", "." or "-", up to 64 characters, got "a b"',
    "q.md:7 question: /options only choice and multi take options, not number",
    'q.md:7 question: /answer expected a number or a fraction like "2/3", got "lots"',
  ]);
});

test("a question renders working inputs and the page passes the upload policy", () => {
  const { html, errors: errs } = render(doc(...ALL), { file: "q.md" });
  assert.deepEqual(errs, []);
  assert.match(html, /<input class="q-in" type="text" maxlength="1000"/);
  assert.match(html, /<textarea class="q-in" rows="5" maxlength="10000"/);
  assert.equal(html.match(/<input type="radio" name="q-cap" value="\d">/g).length, 2);
  assert.equal(html.match(/<input type="checkbox" name="q-primes" value="\d">/g).length, 3);
  assert.match(html, /Capital of <strong>France<\/strong>\?/);
  assert.match(html, /<button type="button" class="q-submit" hidden>Check<\/button>/);
  // Autosave makes a Save button redundant: only a question with a key gets one, to Check.
  assert.equal(html.match(/<button type="button" class="q-submit" hidden>Check<\/button>/g).length, 4);
  assert.doesNotMatch(html, />Save<\/button>/);
  assert.equal(html.match(/<script>/g).length, 1);
  assert.ok(html.includes(QUESTIONS_SCRIPT));
  assert.deepEqual(validateHtml(html).errors, []);
  // The embedded grade() and parseNumber() must survive toString.
  assert.doesNotThrow(() => new Function(QUESTIONS_SCRIPT));
});

test("the server reads back exactly the specs the page grades against, without explanations", () => {
  const { html } = render(doc(...ALL), { file: "q.md" });
  assert.deepEqual(extractQuestions(html), [
    { id: "name", kind: "short", prompt: "Your name?" },
    { id: "essay", kind: "long", prompt: "Why?", answer: "Because." },
    { id: "frac", kind: "number", prompt: "Two thirds?", answer: "2/3", tolerance: 0.01 },
    { id: "cap", kind: "choice", prompt: "Capital of **France**?", options: ["Lyon", "Paris"], answer: "Paris" },
    { id: "primes", kind: "multi", prompt: "Primes?", options: ["2", "4", "5"], answer: ["2", "5"] },
  ]);
  assert.deepEqual(extractQuestions("<p>no questions</p>"), []);
  // Hand-written HTML is not trusted: a bad id or kind is dropped, a duplicate keeps the first.
  const q = (spec) => `<div data-q='${JSON.stringify(spec)}'></div>`;
  assert.deepEqual(extractQuestions(
    q({ id: "a b", kind: "short", prompt: "" }) + q({ id: "x", kind: "poll" }) + "<div data-q='nope'></div>" +
    q({ id: "ok", kind: "short", prompt: "one" }) + q({ id: "ok", kind: "long", prompt: "two" }),
  ), [{ id: "ok", kind: "short", prompt: "one" }]);
  const many = Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => q({ id: `q${i}`, kind: "short", prompt: "" })).join("");
  assert.throws(() => extractQuestions(many), /at most 200 questions, got 201/);
});

test("numbers take decimals, exponents and fractions, and grade within tolerance", () => {
  assert.equal(parseNumber("2/3"), 2 / 3);
  assert.equal(parseNumber(" -7 / 4 "), -1.75);
  assert.equal(parseNumber(".5"), 0.5);
  assert.equal(parseNumber("1e-3"), 0.001);
  for (const bad of ["", "1/0", "two", "1,000", "1/2/3", "0x10"]) assert.equal(parseNumber(bad), null, bad);

  const frac = { id: "f", kind: "number", prompt: "", answer: "2/3" };
  assert.equal(grade(frac, "0.6666667"), true);
  assert.equal(grade(frac, "0.67"), false);
  assert.equal(grade({ ...frac, tolerance: 0.01 }, "0.67"), true);
  assert.equal(grade({ id: "m", kind: "multi", prompt: "", answer: ["a", "b"] }, ["b", "a"]), true);
  assert.equal(grade({ id: "m", kind: "multi", prompt: "", answer: ["a", "b"] }, ["a"]), false);
  assert.equal(grade({ id: "s", kind: "short", prompt: "", answer: "x" }, "x"), null);
  assert.equal(grade({ id: "c", kind: "choice", prompt: "" }, "x"), null);
});

test("the server refuses answers that do not fit the question", () => {
  const choice = { id: "c", kind: "choice", prompt: "", options: ["a", "b"] };
  const multi = { id: "m", kind: "multi", prompt: "", options: ["a", "b"] };
  assert.deepEqual(checkAnswer({ id: "s", kind: "short", prompt: "" }, "  hi  "), { ok: true, value: "hi" });
  assert.deepEqual(checkAnswer({ id: "s", kind: "short", prompt: "" }, "   "), { ok: false, error: "the answer is empty" });
  assert.deepEqual(checkAnswer({ id: "s", kind: "short", prompt: "" }, "x".repeat(MAX_ANSWER_CHARS.short + 1)),
    { ok: false, error: "the answer is longer than 1000 characters" });
  assert.equal(checkAnswer({ id: "l", kind: "long", prompt: "" }, "x".repeat(MAX_ANSWER_CHARS.long)).ok, true);
  assert.equal(checkAnswer({ id: "l", kind: "long", prompt: "" }, "x".repeat(MAX_ANSWER_CHARS.long + 1)).ok, false);
  assert.deepEqual(checkAnswer({ id: "n", kind: "number", prompt: "" }, "lots"), { ok: false, error: "not a number" });
  assert.deepEqual(checkAnswer({ id: "n", kind: "number", prompt: "" }, " 2/3 "), { ok: true, value: "2/3" });
  assert.deepEqual(checkAnswer(choice, "c"), { ok: false, error: "not one of the options" });
  assert.deepEqual(checkAnswer(choice, ["a"]), { ok: false, error: "expected text" });
  assert.deepEqual(checkAnswer(multi, ["a", "a"]), { ok: false, error: "an option is listed twice" });
  assert.deepEqual(checkAnswer(multi, []), { ok: false, error: "pick at least one option" });
  assert.deepEqual(checkAnswer(multi, "a"), { ok: false, error: "expected a list of options" });
  assert.deepEqual(checkAnswer(multi, ["b", "a"]), { ok: true, value: ["b", "a"] });
});

test("autosave sends only a value the server would take, and never the same one twice", () => {
  const short = { id: "s", kind: "short", prompt: "" };
  const num = { id: "n", kind: "number", prompt: "" };
  const multi = { id: "m", kind: "multi", prompt: "", options: ["a", "b"] };
  assert.equal(toSave(short, "  hi ", undefined), "hi");
  assert.equal(toSave(short, "hi  ", "hi"), null);
  assert.equal(toSave(short, "hip", "hi"), "hip");
  assert.equal(toSave(short, "   ", undefined), null);
  assert.equal(toSave(num, "2/", undefined), null);
  assert.equal(toSave(num, "2/3", "0.5"), "2/3");
  assert.deepEqual(toSave(multi, ["a", "b"], ["a"]), ["a", "b"]);
  assert.equal(toSave(multi, ["a"], ["a"]), null);
  assert.equal(toSave(multi, [], ["a"]), null);
});

test("the page script autosaves without grading and flushes a pending edit on hide", () => {
  // The helpers it calls must be embedded, since the page has no imports.
  for (const fn of ["checkAnswer", "toSave", "MAX_ANSWER_CHARS"]) assert.match(QUESTIONS_SCRIPT, new RegExp(`const ${fn} = `));
  assert.match(QUESTIONS_SCRIPT, /setTimeout\(\(\) => save\(\), 1500\)/);
  assert.match(QUESTIONS_SCRIPT, /addEventListener\("pagehide", flush\)/);
  assert.match(QUESTIONS_SCRIPT, /visibilityState === "hidden"/);
  assert.match(QUESTIONS_SCRIPT, /keepalive: !!keepalive/);
});

test("the answers report lists the latest version's questions, then answers to removed ones", () => {
  const questions = [
    { id: "cap", kind: "choice", prompt: "Capital?", options: ["Lyon", "Paris"], answer: "Paris" },
    { id: "why", kind: "long", prompt: "Why?" },
  ];
  const at = Date.parse("2026-10-19T19:41:00Z");
  const rows = [
    { questionId: "cap", value: "Lyon", versionNumber: 2, savedAt: at, history: [{ value: "Paris", versionNumber: 1, savedAt: at - 1000 }] },
    { questionId: "gone", value: "x", versionNumber: 1, savedAt: at, history: [] },
  ];
  assert.deepEqual(answerReport(questions, rows), [
    { id: "cap", kind: "choice", prompt: "Capital?", options: ["Lyon", "Paris"], expected: "Paris", answer: "Lyon",
      correct: false, savedAt: "2026-10-19T19:41:00.000Z", versionNumber: 2,
      history: [{ answer: "Paris", savedAt: "2026-10-19T19:40:59.000Z", versionNumber: 1 }] },
    { id: "why", kind: "long", prompt: "Why?", options: null, expected: null, answer: null, correct: null,
      savedAt: null, versionNumber: null, history: [] },
    { id: "gone", kind: null, prompt: null, options: null, expected: null, answer: "x", correct: null,
      savedAt: "2026-10-19T19:41:00.000Z", versionNumber: 1, history: [] },
  ]);
});
