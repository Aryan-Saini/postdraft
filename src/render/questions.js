/**
 * The `question` fence: one answerable question, rendered as real inputs.
 *
 * The question's spec rides in `data-q` (see `src/questions.js`), which is what
 * the page script grades against and what the upload endpoint reads to learn
 * which questions a version has. The prompt, options, answer and explanation
 * are inline Markdown, rendered here with the same marks and math as prose.
 *
 * Without script the inputs still render, but nothing is checked or saved: the
 * submit button ships `hidden` and the script reveals it.
 *
 * @module render/questions
 */

import { escapeHtml, inlineMarkdown } from "./parse.js";
import { renderInlineMath } from "./math.js";
import { MAX_ANSWER_CHARS, grade, parseNumber } from "../questions.js";

/** @typedef {import("../questions.js").QuestionSpec & { explain?: string }} QuestionData */

const inline = (text) => renderInlineMath(inlineMarkdown(text));

/**
 * Render a validated `question` block.
 * @param {{ data: unknown }} block
 * @returns {string}
 */
export function renderQuestion(block) {
  const q = /** @type {QuestionData} */ (block.data);
  const id = `q-${q.id}`;
  /** @type {import("../questions.js").QuestionSpec} */
  const spec = { id: q.id, kind: q.kind, prompt: q.prompt };
  if (q.options) spec.options = q.options;
  if (q.answer !== undefined) spec.answer = q.answer;
  if (q.tolerance !== undefined) spec.tolerance = q.tolerance;

  const label = `aria-labelledby="${escapeHtml(id)}-p"`;
  let input;
  if (q.kind === "long") {
    input = `<textarea class="q-in" rows="5" maxlength="${MAX_ANSWER_CHARS.long}" ${label}></textarea>`;
  } else if (q.kind === "choice" || q.kind === "multi") {
    const type = q.kind === "choice" ? "radio" : "checkbox";
    const opts = (q.options ?? []).map((o, i) =>
      `<label class="q-opt"><input type="${type}" name="${escapeHtml(id)}" value="${i}"><span>${inline(o)}</span></label>`);
    input = `<div class="q-opts" role="group" ${label}>${opts.join("")}</div>`;
  } else {
    // `number` is a text field: a fraction like 2/3 needs a slash no numeric keypad has.
    const extra = q.kind === "number" ? ' autocapitalize="off" spellcheck="false"' : "";
    input = `<input class="q-in" type="text" maxlength="${MAX_ANSWER_CHARS[q.kind]}" autocomplete="off"${extra} ${label}>`;
  }

  const reveal = [];
  if (q.answer !== undefined) {
    const shown = Array.isArray(q.answer) ? q.answer.map(inline).join(", ") : inline(String(q.answer));
    reveal.push(`<p><span class="q-label">Answer</span> ${shown}</p>`);
  }
  if (q.explain) reveal.push(`<p>${inline(q.explain)}</p>`);

  return `<section class="q" id="${escapeHtml(id)}" data-q="${escapeHtml(JSON.stringify(spec))}">` +
    `<div class="q-prompt" id="${escapeHtml(id)}-p">${inline(q.prompt)}</div>${input}` +
    `<div class="q-foot"><button type="button" class="q-submit" hidden>${q.answer === undefined ? "Save" : "Check"}</button>` +
    `<span class="q-status" role="status" aria-live="polite"></span></div>` +
    `<div class="q-result" hidden></div>` +
    (reveal.length ? `<div class="q-reveal" hidden>${reveal.join("")}</div>` : "") +
    `</section>`;
}

/**
 * Question behaviour, one loop over every `.q` on the page.
 *
 * Each answer is kept in localStorage under `postdraft:<draft>:<question>` as
 * the reader types, so a reload or a dead connection loses nothing. Submitting
 * grades it against `data-q`, reveals the answer and explanation, and POSTs it to
 * `/api/d/<draft>/answers` on this origin. A submission the server did not take
 * stays marked unsent and is retried on the next load or when the browser comes
 * back online. Opened from disk, there is no draft id, so answers stay local.
 */
export const QUESTIONS_SCRIPT = `(() => {
  const parseNumber = ${parseNumber};
  const grade = ${grade};
  const path = /^https?:$/.test(location.protocol) ? /^\\/d\\/([^/]+)(?:\\/v\\/(\\d+))?/.exec(location.pathname) : null;
  const draft = path ? decodeURIComponent(path[1]) : null;
  const version = path && path[2] ? Number(path[2]) : null;
  const scope = "postdraft:" + (draft || location.pathname) + ":";
  const load = (id) => { try { return JSON.parse(localStorage.getItem(scope + id)) || {}; } catch { return {}; } };
  const keep = (id, rec) => { try { localStorage.setItem(scope + id, JSON.stringify(rec)); } catch {} };
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const blank = (v) => (Array.isArray(v) ? v.length === 0 : !String(v).trim());
  const retries = [];
  for (const box of document.querySelectorAll(".q[data-q]")) {
    let spec;
    try { spec = JSON.parse(box.dataset.q); } catch { continue; }
    const field = box.querySelector(".q-in");
    const picks = [...box.querySelectorAll(".q-opt input")];
    const button = box.querySelector(".q-submit");
    const status = box.querySelector(".q-status");
    const result = box.querySelector(".q-result");
    const reveal = box.querySelector(".q-reveal");
    const rec = load(spec.id);
    const option = (p) => spec.options[Number(p.value)];
    const read = () => spec.kind === "multi" ? picks.filter((p) => p.checked).map(option)
      : spec.kind === "choice" ? (picks.filter((p) => p.checked).map(option)[0] || "")
      : field.value;
    const write = (v) => {
      if (field) field.value = typeof v === "string" ? v : "";
      for (const p of picks) p.checked = Array.isArray(v) ? v.includes(option(p)) : v === option(p);
    };
    const say = (text, bad) => { status.textContent = text; status.classList.toggle("bad", !!bad); };
    const refresh = () => {
      const sent = rec.sent;
      const now = read();
      const current = !!sent && same(sent.value, now);
      const ok = current ? grade(spec, sent.value) : null;
      result.hidden = ok === null;
      result.textContent = ok ? "Correct" : "Not quite";
      result.className = "q-result " + (ok ? "q-ok" : "q-miss");
      if (reveal) reveal.hidden = !current;
      if (!current) say(blank(now) ? "" : "Not submitted");
      else if (!draft) say("Saved on this device " + clock(sent.at));
      else if (sent.synced) say("Saved " + clock(sent.at));
      else if (sent.error) say("Not saved: " + sent.error + ". Kept on this device.", true);
      else say("Saving…");
    };
    const send = async () => {
      const sent = rec.sent;
      if (!draft || !sent || sent.synced) return;
      sent.error = "";
      refresh();
      try {
        const res = await fetch("/api/d/" + encodeURIComponent(draft) + "/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: spec.id, value: sent.value, version }),
        });
        const body = await res.json().catch(() => ({}));
        // One save per question per second: a quick resubmit waits its turn.
        if (res.status === 429) { setTimeout(() => { if (rec.sent === sent) send(); }, 1200); return; }
        if (!res.ok) throw new Error(body.error || "the server answered " + res.status);
        sent.synced = true;
        sent.at = typeof body.savedAt === "number" ? body.savedAt : sent.at;
      } catch (err) {
        sent.error = err instanceof TypeError ? "could not reach the server" : err.message;
      }
      if (rec.sent === sent) { keep(spec.id, rec); refresh(); }
    };
    const submit = () => {
      const value = read();
      if (blank(value)) return say(spec.kind === "multi" || spec.kind === "choice" ? "Pick an option first." : "Answer first.", true);
      if (spec.kind === "number" && parseNumber(value) === null) return say("Enter a number like 0.5 or 2/3.", true);
      rec.value = value;
      rec.sent = { value, at: Date.now(), synced: false };
      keep(spec.id, rec);
      refresh();
      send();
    };
    if (rec.value !== undefined) write(rec.value);
    refresh();
    if (rec.sent && same(rec.sent.value, read())) send();
    retries.push(() => { if (rec.sent && same(rec.sent.value, read())) send(); });
    box.addEventListener("input", () => { rec.value = read(); keep(spec.id, rec); refresh(); });
    if (field) field.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing && (field.tagName === "INPUT" || e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
    button.addEventListener("click", submit);
    button.hidden = false;
  }
  addEventListener("online", () => { for (const retry of retries) retry(); });
})();`;
