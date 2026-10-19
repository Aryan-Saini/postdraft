/**
 * The `question` fence: one answerable question, rendered as real inputs.
 *
 * The question's spec rides in `data-q` (see `src/questions.js`), which is what
 * the page script grades against and what the upload endpoint reads to learn
 * which questions a version has. The prompt, options, answer and explanation
 * are inline Markdown, rendered here with the same marks and math as prose.
 *
 * Without script the inputs still render, but nothing is checked or saved: the
 * Check button, which only a question with an answer key gets, ships `hidden`
 * and the script reveals it.
 *
 * @module render/questions
 */

import { escapeHtml, inlineMarkdown } from "./parse.js";
import { renderInlineMath } from "./math.js";
import { MAX_ANSWER_CHARS, checkAnswer, grade, parseNumber, toSave } from "../questions.js";

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
    `<div class="q-foot">${q.answer === undefined ? "" : '<button type="button" class="q-submit" hidden>Check</button>'}` +
    `<span class="q-status" role="status" aria-live="polite"></span></div>` +
    `<div class="q-result" hidden></div>` +
    (reveal.length ? `<div class="q-reveal" hidden>${reveal.join("")}</div>` : "") +
    `</section>`;
}

/**
 * Question behaviour, one loop over every `.q` on the page.
 *
 * Each answer is kept in localStorage under `postdraft:<draft>:<question>` as
 * the reader types, so a reload or a dead connection loses nothing, and
 * autosaves to `/api/d/<draft>/answers` on this origin: text 1.5 s after the
 * last keystroke and on blur, a choice as soon as it is picked, anything still
 * pending with a keepalive request when the page is hidden or closed. Only a
 * value that differs from the last one sent goes out (see `toSave`). Saving
 * never grades: Check does that, revealing the answer and explanation.
 *
 * A save the server did not take stays marked unsent and is retried on the next
 * load or when the browser comes back online. Opened from disk, there is no
 * draft id, so answers stay local.
 */
export const QUESTIONS_SCRIPT = `(() => {
  const MAX_ANSWER_CHARS = ${JSON.stringify(MAX_ANSWER_CHARS)};
  const parseNumber = ${parseNumber};
  const grade = ${grade};
  const checkAnswer = ${checkAnswer};
  const toSave = ${toSave};
  const path = /^https?:$/.test(location.protocol) ? /^\\/d\\/([^/]+)(?:\\/v\\/(\\d+))?/.exec(location.pathname) : null;
  const draft = path ? decodeURIComponent(path[1]) : null;
  const version = path && path[2] ? Number(path[2]) : null;
  const scope = "postdraft:" + (draft || location.pathname) + ":";
  const load = (id) => { try { return JSON.parse(localStorage.getItem(scope + id)) || {}; } catch { return {}; } };
  const keep = (id, rec) => { try { localStorage.setItem(scope + id, JSON.stringify(rec)); } catch {} };
  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const blank = (v) => (Array.isArray(v) ? v.length === 0 : !String(v).trim());
  const NUMBER_HINT = "Enter a number like 0.5 or 2/3.";
  const retries = [];
  const flushes = [];
  for (const box of document.querySelectorAll(".q[data-q]")) {
    let spec;
    try { spec = JSON.parse(box.dataset.q); } catch { continue; }
    const field = box.querySelector(".q-in");
    const picks = [...box.querySelectorAll(".q-opt input")];
    const button = box.querySelector(".q-submit");
    const status = box.querySelector(".q-status");
    const result = box.querySelector(".q-result");
    const reveal = box.querySelector(".q-reveal");
    // rec: { value: what is in the input, saved: { value, at, synced, error, offline }, checked: the value Check graded }
    const rec = load(spec.id);
    // Pages from before autosave kept one "sent" record for Check and Save alike.
    if (rec.sent) { rec.saved = rec.sent; if (button) rec.checked = rec.sent.value; delete rec.sent; }
    let timer = 0;
    let flying = null;
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
      const now = read();
      const checked = rec.checked !== undefined && same(rec.checked, now);
      const ok = checked ? grade(spec, now) : null;
      result.hidden = ok === null;
      result.textContent = ok ? "Correct" : "Not quite";
      result.className = "q-result " + (ok ? "q-ok" : "q-miss");
      if (reveal) reveal.hidden = !checked;
      const answer = checkAnswer(spec, now);
      const saved = rec.saved;
      if (!answer.ok) say(blank(now) ? "" : spec.kind === "number" ? NUMBER_HINT : "Not saved: " + answer.error + ".");
      else if (!draft) say("Saved on this device");
      else if (!saved || !same(saved.value, answer.value)) say("Saving…");
      else if (saved.synced) say("Saved " + clock(saved.at));
      else if (saved.error) say("Not saved: " + saved.error + ". Kept on this device.", true);
      else if (saved.offline) say("Saved on this device");
      else say("Saving…");
    };
    // POST rec.saved unless it is synced or already on its way. One request per
    // question at a time; a value saved meanwhile goes when it lands.
    const send = async (keepalive) => {
      const saved = rec.saved;
      if (!draft || !saved || saved.synced || flying === saved || (flying && !keepalive)) return;
      flying = saved;
      saved.error = "";
      saved.offline = false;
      refresh();
      let again = false;
      try {
        const res = await fetch("/api/d/" + encodeURIComponent(draft) + "/answers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: spec.id, value: saved.value, version }),
          keepalive: !!keepalive,
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 429) again = true;
        else if (!res.ok) throw new Error(body.error || "the server answered " + res.status);
        else {
          saved.synced = true;
          saved.at = typeof body.savedAt === "number" ? body.savedAt : saved.at;
        }
      } catch (err) {
        if (err instanceof TypeError) saved.offline = true;
        else saved.error = err.message;
      }
      if (flying === saved) flying = null;
      if (rec.saved === saved) { keep(spec.id, rec); refresh(); }
      // One save per question per second: a quick resave waits its turn.
      if (again) setTimeout(() => send(), 1200);
      else if (rec.saved !== saved) send();
    };
    // Autosave: record the current input as rec.saved and send it, if it is an
    // answer and not the one already sent.
    const save = (keepalive) => {
      clearTimeout(timer);
      timer = 0;
      const value = toSave(spec, read(), rec.saved && rec.saved.value);
      if (value !== null) {
        rec.saved = { value, at: Date.now(), synced: false };
        keep(spec.id, rec);
        send(keepalive);
      }
      refresh();
    };
    const check = () => {
      const value = read();
      if (blank(value)) return say(spec.kind === "multi" || spec.kind === "choice" ? "Pick an option first." : "Answer first.", true);
      if (spec.kind === "number" && parseNumber(value) === null) return say(NUMBER_HINT, true);
      rec.checked = value;
      keep(spec.id, rec);
      save();
    };
    if (rec.value !== undefined) write(rec.value);
    refresh();
    save();
    send();
    retries.push(() => { save(); send(); });
    flushes.push(() => { if (timer) save(true); });
    box.addEventListener("input", () => {
      rec.value = read();
      keep(spec.id, rec);
      clearTimeout(timer);
      if (field) { timer = setTimeout(() => save(), 1500); refresh(); } else save();
    });
    if (field) {
      field.addEventListener("blur", () => save());
      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.isComposing && (field.tagName === "INPUT" || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          if (button) check(); else save();
        }
      });
    }
    if (button) { button.addEventListener("click", check); button.hidden = false; }
  }
  addEventListener("online", () => { for (const retry of retries) retry(); });
  // A pending edit must not wait out its debounce on a closing tab.
  const flush = () => { for (const f of flushes) f(); };
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
})();`;
