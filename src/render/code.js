/**
 * Syntax highlighting without a runtime highlighter.
 *
 * Highlighting happens here, at render time, and ships as plain `<span>`
 * elements coloured with One Dark Pro's hexes. The tokenizer is deliberately
 * small: one pass, ordered rules, first match wins, plus a little state (the
 * previous token, names declared so far, where a JSX tag is open) so a
 * declaration, a call and a property access can be told apart. It covers the
 * languages the spec lists and degrades to plain text for anything else, which
 * is the right failure mode for a document. A real grammar is out of scope.
 *
 * Token classes (`t-kw`, `t-str`, …) are styled by the shell's stylesheet. The
 * one script a document carries, `COPY_SCRIPT`, and the icon sprite are emitted
 * once per document by `renderBody`; the blocks here only reference them.
 *
 * @module render/code
 */

import { CODE_FONTS } from "./fonts.js";

/** @typedef {import("./ir.js").CodeBlock} CodeBlock */
/** @typedef {import("./ir.js").DiffBlock} DiffBlock */

/**
 * Tokenizer state, shared across the lines of a numbered block.
 * `prev` is the last significant token; `modes` is the JSX nesting stack
 * (`"jsx"` for element children, `"{"` for an expression inside JSX); `tag` is
 * the JSX tag currently open, with the stack depth it was opened at. `lang` is
 * the tokenizer key (`tokKey`), so a Vue block tokenizes as `html`.
 *
 * @typedef {{ lang: string, prev: string, bol: boolean, cmd: boolean,
 *   declared: Set<string>, modes: string[], tag: { closing: boolean, depth: number } | null }} State
 */

/** @typedef {(word: string, st: State, after: string) => string | null} Classify */
/** @typedef {(rest: string, st: State) => { len: number, html: string } | null} Scanner */
/** @typedef {[RegExp, string | null | Classify] | Scanner} Rule */

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

const words = (s) => new Set(s.trim().split(/\s+/));

const KEYWORDS = {
  ts: words("abstract as async await break case catch class const continue declare default delete do else enum export extends finally for from function if implements import in infer instanceof interface keyof let namespace new of private protected public readonly return satisfies static super switch throw try type typeof var void while yield"),
  js: words("async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new of return static super switch throw try typeof var void while yield"),
  py: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"),
  sh: words("cd echo export fi for if then else elif do done function in local return set source while case esac until"),
  sql: words("select from where group by order having join left right inner outer on as insert into values update set delete limit offset with and or not null is in create table primary key references returning distinct"),
  rust: words("as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return static struct super trait type unsafe use where while"),
  go: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
  erlang: words("after and andalso band begin bnot bor bsl bsr bxor case catch cond div end fun if let not of or orelse receive rem try when xor"),
  elixir: words("after alias and case catch cond def defdelegate defexception defguard defimpl defmacro defmodule defp defprotocol defstruct do else end fn for if import in not or quote raise receive require rescue try unless unquote use when with"),
  ruby: words("alias and begin break case class def do else elsif end ensure for if in module next not or redo require rescue retry return super then undef unless until when while yield attr_reader attr_writer attr_accessor private protected public"),
  java: words("abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package permits private protected public record return sealed short static super switch synchronized throw throws transient try var void volatile while yield"),
  kotlin: words("as break by class companion continue data do else enum for fun if import in init inline interface internal is lateinit object open operator override package private protected public reified return sealed super suspend throw try typealias val var when while"),
  swift: words("as associatedtype async await break case catch class continue default defer deinit do else enum extension fallthrough fileprivate for func guard if import in init inout internal is let mutating open operator private protocol public repeat rethrows return some static struct subscript super switch throw throws try typealias var where while"),
  c: words("auto bool break case char class const constexpr continue default delete do double else enum extern float for goto if inline int long namespace new noexcept nullptr operator private protected public register return short signed sizeof static static_cast struct switch template throw try typedef typename union unsigned using virtual void volatile while"),
  cs: words("abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach get goto if implicit in init int interface internal is lock long namespace new object operator out override params private protected public readonly record ref return sbyte sealed set short sizeof static string struct switch throw try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while yield"),
  php: words("abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enum extends final finally fn for foreach function global goto if implements include include_once instanceof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield"),
  graphql: words("query mutation subscription fragment on type input enum interface union scalar schema extend directive implements repeatable"),
  proto: words("syntax package import option message enum service rpc returns repeated optional required map oneof reserved stream extend extensions to max edition"),
  // The next four have their own rule sets; these lists are what those rules consult.
  dockerfile: words("FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS"),
  makefile: words("include -include sinclude ifeq ifneq ifdef ifndef else endif define endef export unexport override vpath"),
  env: words("export"),
  ini: words("true false yes no on off"),
};

/** Languages with their own rule set rather than the C-like one. */
const RULE_LANGS = ["json", "yaml", "html", "xml", "css", "md", "toml", "dockerfile", "makefile", "env", "ini"];

// Info-string spellings -> the canonical key, which picks the icon.
const ALIASES = {
  typescript: "ts", tsx: "ts", mts: "ts", cts: "ts", javascript: "js", jsx: "js", mjs: "js", cjs: "js",
  python: "py", py3: "py", bash: "sh", shell: "sh", zsh: "sh", console: "sh",
  golang: "go", rs: "rust", markdown: "md", mdx: "md", tml: "toml", yml: "yaml", svg: "xml",
  erl: "erlang", ex: "elixir", exs: "elixir", rb: "ruby", kt: "kotlin", kts: "kotlin",
  h: "c", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", csharp: "cs", "c#": "cs",
  docker: "dockerfile", make: "makefile", mk: "makefile", dotenv: "env", cfg: "ini",
  gql: "graphql", protobuf: "proto", txt: "text", plain: "text", plaintext: "text",
  postgres: "sql", postgresql: "sql", plpgsql: "sql", mysql: "sql", sqlite: "sql",
  hs: "haskell", ml: "ocaml", clj: "clojure", "f#": "fsharp",
  "objective-c": "objc", objectivec: "objc", "obj-c": "objc",
  assembly: "asm", nasm: "asm", masm: "asm", gas: "asm", x86asm: "asm", armasm: "asm", s: "asm",
};

// Canonical keys that borrow another language's tokenizer but keep their own icon.
const SHARED = { cpp: "c", svelte: "html", vue: "html" };

/** The tokenizer a canonical key runs. */
const tokKey = (key) => SHARED[/** @type {keyof typeof SHARED} */ (key)] ?? key;

/** Does this tokenizer key get tokenized at all? */
const known = (key) => Boolean(KEYWORDS[key]) || RULE_LANGS.includes(key);

// Word lists the identifier classifier consults.
const THIS = words("this self");
const CONSTANTS = words("true false null undefined NaN Infinity None True False nil iota");
const DECL_VAR = words("const let var mut val");
const DECL_FN = words("function def defp fn func fun rpc");
const DECL_TYPE = words("class struct interface enum trait impl type");
const BUILTIN_TYPES = {
  ts: words("string number boolean void unknown never any object bigint symbol"),
  go: words("int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string bool byte rune error any"),
  rust: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str"),
  proto: words("double float int32 int64 uint32 uint64 sint32 sint64 fixed32 fixed64 sfixed32 sfixed64 bool string bytes"),
};
// After one of these a `/` starts a regex literal rather than dividing.
const REGEX_AFTER_WORD = words("return typeof case do else in of new delete void throw yield await");
// JSX can only open where an expression can start.
const JSX_AFTER = words("( , = return ? : && || => { [ ??");

const span = (cls, text) => `<span class="t-${cls}">${esc(text)}</span>`;

/** A string literal, with its backslash escapes picked out. */
const strSpan = (text) =>
  `<span class="t-str">${esc(text).replace(/\\(?:u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g,
    (e) => `<span class="t-esc">${e}</span>`)}</span>`;

/** @returns {State} */
const newState = (lang) =>
  ({ lang, prev: "", bol: true, cmd: true, declared: new Set(), modes: [], tag: null });

const top = (st) => st.modes[st.modes.length - 1];

/* ------------------------------------------------------------ identifiers */

/**
 * What a C-like identifier is, from the word itself, the token before it and
 * the text after it. Order matters: `x.type` is a property even though `type`
 * is a keyword, and `let mut x` declares `x`, not `mut`.
 *
 * @type {Classify}
 */
function identifier(word, st, after) {
  const { lang, prev } = st;
  const call = /^\s*\(/.test(after) || (lang === "rust" && after[0] === "!");
  // Erlang: keywords, then Capitalised variables, calls, and every other bare word is an atom.
  // It comes before the property check because `.` ends an Erlang clause.
  if (lang === "erlang") {
    if (KEYWORDS.erlang.has(word)) return "kw";
    return /^[A-Z_]/.test(word) ? "var" : call ? "fn" : "const";
  }
  if (prev === "." || prev === "?.") return call ? "fn" : "prop";
  if (THIS.has(word)) return "this";
  // SQL is case-insensitive: `NULL` is `null`, `SELECT` is `select`.
  const w = lang === "sql" ? word.toLowerCase() : word;
  if (CONSTANTS.has(w)) return "const";
  if (KEYWORDS[lang]?.has(w)) return "kw";
  if (DECL_FN.has(prev)) return "fn";
  if (DECL_TYPE.has(prev)) return "type";
  if (DECL_VAR.has(prev) || (lang === "go" && /^\s*:=/.test(after)) ||
      (lang === "py" && st.bol && /^\s*=(?!=)/.test(after))) {
    st.declared.add(word);
    return "var";
  }
  if (call) return /^[A-Z]/.test(word) && prev === "new" ? "type" : "fn";
  if (BUILTIN_TYPES[lang]?.has(word)) return "type";
  if (/^[A-Z][A-Z0-9_]+$/.test(word)) return "const";
  if (/^[A-Z]/.test(word)) return "type";
  // An object key or a parameter name: `{ html: …`, `(bytes: number`.
  if ((lang === "ts" || lang === "js") && /^\s*\??:(?!:)/.test(after) && "{,(".includes(prev) && prev) return "prop";
  if (st.declared.has(word)) return "var";
  return null;
}

/* ------------------------------------------------------------ scanners */

/** Index of the `}` closing a brace opened just before `from`, or -1. */
function closeBrace(src, from) {
  let depth = 1;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * A string with interpolation: a JS template literal (`${…}`) or a Python
 * f-string (`{…}`). The literal text is a string span; each hole is an escape
 * pair around the inner expression, tokenized as code. An unterminated string
 * runs to the end of what it was given, which is the rest of the line in a
 * numbered block.
 */
function interpolated(src, quote, open, st) {
  let i = quote.length, buf = quote, html = "";
  const flush = () => { if (buf) html += strSpan(buf); buf = ""; };
  while (i < src.length) {
    if (src[i] === "\\") { buf += src.slice(i, i + 2); i += 2; continue; }
    if (src.startsWith(quote, i)) { buf += quote; i += quote.length; break; }
    if (open === "{" && (src.startsWith("{{", i) || src.startsWith("}}", i))) { buf += src.slice(i, i + 2); i += 2; continue; }
    if (src.startsWith(open, i)) {
      const end = closeBrace(src, i + open.length);
      if (end < 0) { buf += src.slice(i); i = src.length; break; }
      flush();
      const inner = { ...newState(st.lang), declared: st.declared, bol: false };
      html += span("esc", open) + tokenize(src.slice(i + open.length, end), st.lang, inner) + span("esc", "}");
      i = end + 1;
      continue;
    }
    if (quote.length === 1 && quote !== "`" && src[i] === "\n") break;
    buf += src[i++];
  }
  flush();
  return { len: i, html };
}

/** @type {Scanner} */
const template = (rest, st) => (rest[0] === "`" ? interpolated(rest, "`", "${", st) : null);

/** @type {Scanner} */
const fString = (rest, st) => {
  const m = /^([fF][rR]?|[rR][fF])("""|'''|"|')/.exec(rest);
  if (!m) return null;
  const r = interpolated(rest.slice(m[1].length), m[2], "{", st);
  return { len: m[1].length + r.len, html: span("kw", m[1]) + r.html };
};

/** A regex literal, only where a `/` cannot be division. @type {Scanner} */
const regex = (rest, st) => {
  if (rest[0] !== "/") return null;
  const division = /[\w$)\]"'`]$/.test(st.prev) && !REGEX_AFTER_WORD.has(st.prev);
  if (division) return null;
  const m = /^\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuyv]*/.exec(rest);
  return m ? { len: m[0].length, html: span("regex", m[0]) } : null;
};

/** `<div`, `<Button`, `</li`, `<>`: a JSX tag opening where an expression can start. @type {Scanner} */
const jsxOpen = (rest, st) => {
  if (rest[0] !== "<") return null;
  const inChildren = top(st) === "jsx" && !st.tag;
  if (!inChildren && !(JSX_AFTER.has(st.prev) || st.prev === "")) return null;
  // `<T>(x) => …` and `<T,>` are TypeScript generics, not elements.
  if (/^<[A-Za-z]\w*(?:\s+extends\b[^>]*|,)?>\s*\(/.test(rest)) return null;
  const m = /^<(\/?)([A-Za-z][\w.:-]*)?/.exec(rest);
  if (!m) return null;
  const [, slash, name] = m;
  if (!name) {
    // A fragment, `<>` or `</>`.
    if (rest[m[0].length] !== ">") return null;
    if (slash) st.modes.pop(); else st.modes.push("jsx");
    return { len: m[0].length + 1, html: span("punc", rest.slice(0, m[0].length + 1)) };
  }
  st.tag = { closing: Boolean(slash), depth: st.modes.length };
  const cls = /^[A-Z]|\./.test(name) ? "type" : "tag";
  return { len: m[0].length, html: span("punc", `<${slash}`) + span(cls, name) };
};

/** The `>` or `/>` that ends the open JSX tag. @type {Scanner} */
const jsxClose = (rest, st) => {
  if (!st.tag || st.modes.length !== st.tag.depth) return null;
  const m = /^\/?>/.exec(rest);
  if (!m) return null;
  if (st.tag.closing) st.modes.pop();
  else if (m[0] === ">") st.modes.push("jsx");
  st.tag = null;
  return { len: m[0].length, html: span("punc", m[0]) };
};

/** An attribute name inside an open JSX tag. @type {Scanner} */
const jsxAttr = (rest, st) => {
  if (!st.tag || st.modes.length !== st.tag.depth) return null;
  const m = /^[A-Za-z_][\w:-]*/.exec(rest);
  return m ? { len: m[0].length, html: span("attr", m[0]) } : null;
};

/** Text between JSX tags, which is prose, not code. @type {Scanner} */
const jsxText = (rest, st) => {
  if (top(st) !== "jsx" || st.tag) return null;
  const m = /^[^<{]+/.exec(rest);
  return m ? { len: m[0].length, html: esc(m[0]) } : null;
};

/** A shell word: the command itself is a function call, anything after it plain. @type {Classify} */
const shellWord = (word, st) => {
  if (KEYWORDS.sh.has(word)) {
    st.cmd = !["export", "local", "in", "return"].includes(word);
    return "kw";
  }
  const isCmd = st.cmd;
  st.cmd = false;
  return isCmd ? "fn" : null;
};

/** `NAME=value` before a command: the command word still follows. @type {Scanner} */
const shellAssign = (rest, st) => {
  const m = /^([A-Za-z_]\w*)=("(?:[^"\\]|\\.)*"|'[^']*'|[^\s;|&]*)/.exec(rest);
  if (!m) return null;
  st.cmd = true;
  const value = m[2] ? (/^["']/.test(m[2]) ? strSpan(m[2]) : esc(m[2])) : "";
  return { len: m[0].length, html: span("var", m[1]) + span("op", "=") + value };
};

/** `#include` and friends, only where a line starts. @type {Scanner} */
const preprocessor = (rest, st) => {
  const m = st.bol ? /^#\s*[a-z]+/.exec(rest) : null;
  return m ? { len: m[0].length, html: span("meta", m[0]) } : null;
};

/** The `<stdio.h>` after an `#include`. @type {Scanner} */
const includePath = (rest, st) => {
  const m = st.prev.startsWith("#") ? /^<[\w./+-]+>/.exec(rest) : null;
  return m ? { len: m[0].length, html: span("str", m[0]) } : null;
};

/** An Erlang attribute, `-module(…)` or `-export(…)`, at the start of a line. @type {Scanner} */
const erlAttribute = (rest, st) => {
  const m = st.bol ? /^-[a-z_]+(?=\s*\()/.exec(rest) : null;
  return m ? { len: m[0].length, html: span("kw", m[0]) } : null;
};

/** `:ok`, a Ruby symbol or an Elixir atom; `::` is left to the operator rule. @type {Rule} */
const ATOM = [/^:[A-Za-z_]\w*[?!]?/, "const"];
/** `$name`, a PHP or GraphQL variable. @type {Rule} */
const DOLLAR_VAR = [/^\$[A-Za-z_]\w*/, "var"];

/** Line comments for the C-like rule set; anything absent uses `//`. */
const LINE_COMMENT = {
  py: /^#[^\n]*/, sql: /^--[^\n]*/, ruby: /^#[^\n]*/, elixir: /^#[^\n]*/, graphql: /^#[^\n]*/,
  erlang: /^%[^\n]*/, php: /^(?:\/\/|#)[^\n]*/,
};
/** Languages where `/*` is not a comment. */
const NO_BLOCK_COMMENT = words("ruby elixir erlang graphql");

/**
 * At most two language-specific rules each, run after comments and before
 * strings, so an Erlang `'quoted atom'` is not taken for a string and a Ruby
 * `@ivar` is not taken for a decorator.
 * @type {Record<string, Rule[]>}
 */
const EXTRA = {
  erlang: [erlAttribute, [/^'(?:[^'\\\n]|\\.)*'/, "const"]],
  elixir: [ATOM],
  ruby: [ATOM, [/^@@?[A-Za-z_]\w*/, "var"]],
  php: [DOLLAR_VAR, [/^<\?(?:php|=)?|^\?>/, "meta"]],
  graphql: [DOLLAR_VAR],
  c: [preprocessor, includePath],
};

/* ------------------------------------------------------------ rule sets */

// Rules run in order; the first that matches at the cursor wins.
/** @returns {Rule[]} */
function rulesFor(lang) {
  const base = /** @type {Rule[]} */ ([[/^\s+/, null]]);
  if (lang === "json") {
    return [
      ...base,
      [/^"(?:[^"\\]|\\.)*"(?=\s*:)/, "key"],
      [/^"(?:[^"\\]|\\.)*"/, "str"],
      [/^\b(?:true|false|null)\b/, "kw"],
      [/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i, "num"],
      [/^[{}\[\],:]/, "punc"],
      [/^[^\s{}\[\],:"]+/, null],
    ];
  }
  if (lang === "yaml") {
    return [
      ...base,
      [/^#[^\n]*/, "com"],
      [/^[\w.-]+(?=\s*:(?:\s|$))/, "key"],
      [/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/, "str"],
      [/^\b(?:true|false|null|yes|no)\b/, "kw"],
      [/^-?\d+(?:\.\d+)?/, "num"],
      [/^[^\s#]+/, null],
    ];
  }
  if (lang === "toml") {
    return [
      ...base,
      [/^#[^\n]*/, "com"],
      // A table header, `[server]` or `[[bin]]`, reads as the structure marker.
      [/^\[\[?[^\]\n]*\]\]?/, "tag"],
      [/^[A-Za-z_][\w.-]*(?=\s*=)|^"(?:[^"\\]|\\.)*"(?=\s*=)/, "key"],
      [/^"""[\s\S]*?"""|^'''[\s\S]*?'''/, "str"],
      [/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/, "str"],
      [/^\b(?:true|false)\b/, "kw"],
      // Offset date-time, local date, then plain numbers.
      [/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?/, "num"],
      [/^[+-]?(?:0x[0-9a-f_]+|\d[\d_]*(?:\.[\d_]+)?(?:e[+-]?\d+)?|inf|nan)\b/i, "num"],
      [/^[=,]/, "op"],
      [/^[{}\[\]]/, "punc"],
      [/^[^\s#=,{}\[\]"']+/, null],
    ];
  }
  if (lang === "md") {
    return [
      ...base,
      // `#` through `######`, plus the fence that opens or closes a code block.
      [/^#{1,6}[ \t][^\n]*/, "kw"],
      [/^(?:```|~~~)[^\n]*/, "meta"],
      [/^>[ \t]?/, "meta"],
      [/^(?:[-*+]|\d+\.)(?=[ \t])/, "punc"],
      [/^!?\[[^\]\n]*\]\([^)\n]*\)/, "fn"],
      [/^`[^`\n]+`/, "str"],
      [/^\*\*[^\n]+?\*\*|^__[^\n]+?__/, "type"],
      [/^\*[^*\n]+?\*|^_[^_\n]+?_/, "attr"],
      [/^~~[^\n]+?~~/, "com"],
      [/^https?:\/\/\S+/, "fn"],
      [/^[^\s*_`\[\]!#>~]+/, null],
    ];
  }
  if (lang === "html" || lang === "xml") {
    return [
      ...base,
      [/^<!--[\s\S]*?-->/, "com"],
      [/^<!DOCTYPE[^>\n]*>/i, "kw"],
      // Svelte's `{#if}` `{:else}` `{/each}` `{@html}` blocks.
      [/^\{[#/:@][a-z]+/, "kw"],
      [/^<\/?(?=[A-Za-z])/, "punc"],
      // A Vue `v-` directive reads as a keyword, any other `name=` as an attribute.
      [/^[A-Za-z][\w:-]*/, (w, st, after) =>
        st.prev === "<" || st.prev === "</" ? "tag" : w.startsWith("v-") ? "kw" : /^\s*=/.test(after) ? "attr" : null],
      [/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/, "str"],
      [/^&[#\w]+;/, "esc"],
      [/^\/?>|^=/, "punc"],
      [/^[^<>"'=\s&A-Za-z]+/, null],
    ];
  }
  if (lang === "css") {
    return [
      ...base,
      [/^\/\*[\s\S]*?\*\//, "com"],
      // At-rules and `!important` are the closest CSS has to keywords.
      [/^@[\w-]+|^!important\b/, "kw"],
      // Selectors: `.class` and `#id` coloured apart from a bare element.
      [/^[.#]?[\w-]+(?=[^{};]*\{)/, (w) => (w[0] === "." ? "attr" : w[0] === "#" ? "fn" : "tag")],
      [/^--[\w-]+|^[\w-]+(?=\s*:)/, "key"],
      [/^#[0-9a-f]{3,8}\b/i, "num"],
      [/^-?\d+(?:\.\d+)?(?:px|rem|em|%|s|ms|vh|vw|fr|deg)?/, "num"],
      [/^[\w-]+(?=\()/, "fn"],
      [/^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/, "str"],
      [/^[{};:,()]/, "punc"],
      [/^[^\s{};:,()]+/, null],
    ];
  }
  if (lang === "dockerfile") {
    return [
      ...base,
      [/^#[^\n]*/, "com"],
      [/^--[\w-]+/, "flag"],
      [/^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*)/, "var"],
      [/^"(?:[^"\\]|\\.)*"|^'[^']*'/, "str"],
      // An instruction opens a line; `AS` names a build stage mid-line.
      [/^[A-Za-z_][\w./:@-]*/, (w, st) =>
        (st.bol && KEYWORDS.dockerfile.has(w.toUpperCase())) || w === "AS" ? "kw" : null],
      [/^[^\s]/, null],
    ];
  }
  if (lang === "makefile") {
    return [
      ...base,
      [/^#[^\n]*/, "com"],
      [/^\$(?:\([^)\n]*\)|\{[^}\n]*\}|[@<^*?%+])/, "var"],
      [/^"(?:[^"\\]|\\.)*"|^'[^']*'/, "str"],
      // At the start of a line a word is a variable (`CC :=`) or a target (`build:`).
      [/^-?[.\w/%-]+/, (w, st, after) => {
        if (KEYWORDS.makefile.has(w)) return "kw";
        if (!st.bol) return null;
        if (/^[ \t]*(?:::?=|[+?!]?=)/.test(after)) return "var";
        return /^[ \t]*:/.test(after) ? "fn" : null;
      }],
      [/^[:+?!]?=|^:/, "op"],
      [/^[^\s]/, null],
    ];
  }
  if (lang === "env") {
    return [
      ...base,
      [/^#[^\n]*/, "com"],
      [/^[A-Za-z_][\w.-]*(?=\s*=)/, "key"],
      [/^[A-Za-z_]\w*/, (w, st) => (st.bol && KEYWORDS.env.has(w) ? "kw" : null)],
      [/^=/, "op"],
      [/^"(?:[^"\\]|\\.)*"|^'[^']*'/, "str"],
      [/^\$\{?[A-Za-z_]\w*\}?/, "var"],
      [/^[^\s"'$]+/, null],
    ];
  }
  if (lang === "ini") {
    return [
      ...base,
      [/^[;#][^\n]*/, "com"],
      [/^\[[^\]\n]*\]/, "tag"],
      [/^[\w.-]+(?=[ \t]*[=:])/, "key"],
      [/^"(?:[^"\\]|\\.)*"|^'[^']*'/, "str"],
      [/^[A-Za-z]+\b/, (w) => (KEYWORDS.ini.has(w.toLowerCase()) ? "kw" : null)],
      [/^-?\d+(?:\.\d+)?\b/, "num"],
      [/^[=:]/, "op"],
      [/^[^\s;#=:"']+/, null],
    ];
  }
  if (lang === "sh") {
    return [
      ...base,
      [/^#[^\n]*/, "com"],
      [/^"(?:[^"\\]|\\.)*"|^'[^']*'/, "str"],
      [/^\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[0-9@#?*$!-])/, "var"],
      [/^\$\(/, (_w, st) => { st.cmd = true; return "punc"; }],
      shellAssign,
      [/^--?[A-Za-z][\w-]*/, "flag"],
      [/^(?:&&|\|\||[|;&])/, (_w, st) => { st.cmd = true; return "op"; }],
      [/^[<>]=?|^=/, "op"],
      [/^[()]/, "punc"],
      [/^[\w./~@%+:,-]+/, shellWord],
      [/^[^\s]/, null],
    ];
  }
  const cLike = lang === "ts" || lang === "js";
  return [
    ...base,
    ...(cLike ? /** @type {Rule[]} */ ([jsxText, jsxClose, jsxAttr]) : []),
    [LINE_COMMENT[lang] ?? /^\/\/[^\n]*/, "com"],
    ...(NO_BLOCK_COMMENT.has(lang) ? [] : /** @type {Rule[]} */ ([[/^\/\*[\s\S]*?\*\//, "com"]])),
    ...(EXTRA[lang] ?? []),
    ...(cLike ? /** @type {Rule[]} */ ([template, regex, jsxOpen]) : []),
    ...(lang === "py" ? /** @type {Rule[]} */ ([fString]) : []),
    [/^(?:[rRbBuU]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?''')/, "str"],
    [/^`(?:[^`\\]|\\.)*`/, "str"],
    [/^"(?:[^"\\\n]|\\.)*"|^'(?:[^'\\\n]|\\.)*'/, "str"],
    [/^@[A-Za-z_][\w.]*/, "meta"],
    [/^\b(?:0x[0-9a-f]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?n?)\b/i, "num"],
    [/^[A-Za-z_$][\w$]*/, identifier],
    [/^\?\./, "punc"],
    [/^[=+\-*/%<>!&|^~?:]+/, "op"],
    [/^[{}()\[\];,.]/, "punc"],
    [/^[^\s]/, null],
  ];
}

const RULES = new Map();

/** Update the state after a token: newlines, the previous token, JSX braces. */
function track(st, text, cls) {
  if (!text.trim()) {
    if (text.includes("\n")) { st.bol = true; st.cmd = true; }
    return;
  }
  if (cls === "com") return;
  st.bol = false;
  st.prev = text;
  if (st.modes.length || st.tag) {
    if (text === "{") st.modes.push("{");
    else if (text === "}" && top(st) === "{") st.modes.pop();
  }
}

/**
 * Tokenize `src` into highlighted HTML. `st` carries across calls so a
 * numbered block, tokenized one line at a time, still knows what was declared
 * above and whether it is inside JSX.
 *
 * @param {string} src
 * @param {string} lang a tokenizer key
 * @param {State} [st]
 */
function tokenize(src, lang, st = newState(lang)) {
  if (!RULES.has(lang)) RULES.set(lang, rulesFor(lang));
  const rules = /** @type {Rule[]} */ (RULES.get(lang));
  let out = "", rest = src;
  let guard = 0;
  while (rest && guard++ < 200000) {
    let hit = null;
    for (const rule of rules) {
      if (typeof rule === "function") {
        const r = rule(rest, st);
        if (!r || !r.len) continue;
        hit = r;
        track(st, rest.slice(0, r.len), "scan");
        break;
      }
      const [re, how] = rule;
      const m = re.exec(rest);
      if (!m || !m[0]) continue;
      const text = m[0];
      const cls = typeof how === "function" ? how(text, st, rest.slice(text.length)) : how;
      hit = { len: text.length, html: cls === "str" ? strSpan(text) : cls ? span(cls, text) : esc(text) };
      track(st, text, cls);
      break;
    }
    if (!hit) hit = { len: 1, html: esc(rest[0]) };
    out += hit.html;
    rest = rest.slice(hit.len);
  }
  return out;
}

/* ------------------------------------------------------------ icons */

// One 16px glyph per language, in its conventional colour, drawn on a 16x16
// grid. Each is emitted once as a <symbol> in the document's sprite and
// referenced from every header with <use>.
const S = (d, color, w = 1.4) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
const LETTER_S = "M12.6 8.7c-.2-.5-.7-.8-1.3-.8-.8 0-1.3.4-1.3 1 0 1.4 2.8.8 2.8 2.4 0 .7-.6 1.1-1.4 1.1-.7 0-1.2-.3-1.5-.8";
const SHIELD = "M2 1.5h12l-1.1 12.2L8 15l-4.9-1.3z";
const HEXAGON = "M8 1.2l6 3.4v6.8L8 14.8 2 11.4V4.6z";
const ANGLES = "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5";
/** A hexagon with a white C, the C-family mark; `extra` draws the ++ or #. */
const cMark = (fill, extra = "") =>
  `<path d="${HEXAGON}" fill="${fill}"/>${S(extra ? "M7.6 5.9a2.6 2.6 0 1 0 0 4.2" : "M10.3 6a2.8 2.8 0 1 0 0 4", "#fff", 1.5)}${extra}`;

export const ICONS = {
  ts: `<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#3178c6"/>${S("M3.6 8h4.2M5.7 8v5", "#fff", 1.3)}${S(LETTER_S, "#fff", 1.2)}`,
  js: `<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#f7df1e"/>${S("M7.3 8v3.6c0 .9-.5 1.4-1.3 1.4-.6 0-1-.3-1.2-.7", "#000", 1.3)}${S(LETTER_S, "#000", 1.2)}`,
  py: `<path fill="#3572a5" d="M7.9 1.5c-2.7 0-2.6 1.2-2.6 1.2v1.6h2.7v.5H4.2S2 4.5 2 7.9c0 3.4 1.9 3.3 1.9 3.3h1.2V9.6s-.1-1.9 1.9-1.9h2.8s1.8 0 1.8-1.8V3.3S11.8 1.5 7.9 1.5zM6.4 2.4a.55.55 0 1 1 0 1.1.55.55 0 0 1 0-1.1z"/>` +
    `<path fill="#ffd43b" d="M8.1 14.5c2.7 0 2.6-1.2 2.6-1.2v-1.6H8v-.5h3.8S14 11.5 14 8.1c0-3.4-1.9-3.3-1.9-3.3h-1.2v1.6s.1 1.9-1.9 1.9H6.2S4.4 8.3 4.4 10.1v2.6s-.3 1.8 3.7 1.8zm1.5-.9a.55.55 0 1 1 0-1.1.55.55 0 0 1 0 1.1z"/>`,
  rust: `<circle cx="8" cy="8" r="6.2" fill="none" stroke="#dea584" stroke-width="1.8" stroke-dasharray="1.2 1.235"/>` +
    `<circle cx="8" cy="8" r="4.6" fill="none" stroke="#dea584" stroke-width="1.1"/>${S("M6.4 10.6V5.6h1.8a1.3 1.3 0 0 1 0 2.6H6.4M8.2 8.2l1.5 2.4", "#dea584", 1.1)}`,
  go: S("M1 6.5h2.5M.8 9h2M1.5 11.5h1.5M9.5 6.6a2.5 2.5 0 1 0 .3 2.9H7.9", "#00add8") +
    `<circle cx="12.8" cy="8.7" r="2.1" fill="none" stroke="#00add8" stroke-width="1.4"/>`,
  sh: S("M2.5 4l4 4-4 4M8 12.5h5.5", "#89e051", 1.6),
  json: S("M5.5 2.5c-1.4 0-2 .6-2 1.9v1.8c0 .9-.5 1.5-1.5 1.8 1 .3 1.5.9 1.5 1.8v1.8c0 1.3.6 1.9 2 1.9M10.5 2.5c1.4 0 2 .6 2 1.9v1.8c0 .9.5 1.5 1.5 1.8-1 .3-1.5.9-1.5 1.8v1.8c0 1.3-.6 1.9-2 1.9", "#cbcb41"),
  yaml: S("M2 3.5l2.7 4v5M7.4 3.5l-2.7 4M9.5 5h5M9.5 8.5h5M9.5 12h3.5", "#cb171e", 1.5),
  html: `<path d="${SHIELD}" fill="#e34c26"/>${S("M10.6 4.3H5.3l.3 3.2h4.7l-.4 3.5L8 11.6 6 11l-.1-1.4", "#fff", 1.1)}`,
  css: `<path d="${SHIELD}" fill="#563d7c"/>${S("M5.4 4.3h5.2l-.5 3.2H6.2M10.1 7.5l-.4 3.5L8 11.6 6 11l-.1-1.4", "#fff", 1.1)}`,
  sql: `<ellipse cx="8" cy="4" rx="5" ry="2" fill="none" stroke="#e38c00" stroke-width="1.3"/>${S("M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2", "#e38c00", 1.3)}`,
  md: `<rect x="1" y="3.5" width="14" height="9" rx="1.5" fill="#083fa1"/>${S("M3.5 10.5v-5l2 2.3 2-2.3v5M11 5.5v4.5M9.3 8.5l1.7 2 1.7-2", "#fff", 1.1)}`,
  toml: `<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#9c4121"/>${S("M4.5 5h7M8 5v7", "#fff", 1.5)}`,
  diff: S("M8 2.5v6M5 5.5h6", "#98c379", 1.5) + S("M5 12h6", "#e06c75", 1.5),
  xml: S(`${ANGLES}M9.2 3.5l-2.4 9`, "#f1662a"),
  erlang: S("M12.8 8.4H3.6C3.6 5.7 5.4 3.8 8 3.8s4.2 1.7 4.2 4M12.3 11.6c-1 1-2.3 1.6-4 1.6-2.6 0-4.6-2-4.6-4.7", "#b83998", 1.7),
  elixir: `<path d="M8 1.2C5.4 4.8 3.8 7.6 3.8 10.1a4.2 4.2 0 0 0 8.4 0c0-2.5-1.6-5.3-4.2-8.9z" fill="#8e5ea8"/>` +
    S("M7 6.5c-.9 1.4-1.4 2.6-1.4 3.6 0 1 .6 1.8 1.5 2.1", "#fff", .9),
  ruby: `<path d="M4.5 2.5h7l3 3.5L8 14 1.5 6z" fill="#cc342d"/>` +
    S("M1.5 6h13M4.5 2.5 5.6 6 8 14l2.4-8 1.1-3.5M5.6 6 8 2.5 10.4 6", "rgba(255,255,255,.55)", .8),
  java: S("M3.5 7.5h8v3a3 3 0 0 1-3 3h-2a3 3 0 0 1-3-3zM11.5 8.4h.9a1.5 1.5 0 0 1 0 3h-1.1", "#e76f00", 1.3) +
    S("M6 1.8c-.9.9.9 1.8 0 2.8M8.6 1.8c-.9.9.9 1.8 0 2.8", "#5382a1", 1.1),
  kotlin: `<path d="M2 2h12L8 8l6 6H2z" fill="#a97bff"/>`,
  swift: `<rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#f05138"/>` +
    S("M3.8 9.4c2.4 2 5.6 2.8 8 1.4M5 4.6c1.9 1.9 4.2 3.6 6.3 4.3M10.8 3.6c1.5 1.9 1.8 4.6 1 7.2", "#fff", 1.1),
  c: cMark("#5c8fd6"),
  cpp: cMark("#f34b7d", S("M9.4 8h2M10.4 7v2M11.9 8h2M12.9 7v2", "#fff", .9)),
  cs: cMark("#9b4f96", S("M10.2 6.4v3.2M11.8 6.4v3.2M9.5 7.3h3M9.5 8.7h3", "#fff", .8)),
  php: `<ellipse cx="8" cy="8" rx="7" ry="4.6" fill="#777bb4"/>` +
    S("M3.2 10.2V6.2h1.2a1 1 0 0 1 0 2.1H3.2M6.8 5v4.2M6.8 7.3c.3-.6.7-.9 1.2-.9.6 0 .9.4.9 1v1.8M10.6 10.2V6.2h1.2a1 1 0 0 1 0 2.1h-1.2", "#fff", .85),
  dockerfile: `<path fill="#2496ed" d="M2.5 7h2v2h-2zM5 7h2v2H5zM7.5 7h2v2h-2zM5 4.5h2v2H5zM7.5 4.5h2v2h-2zM7.5 2h2v2h-2z` +
    `M1.3 9.6h11.5c.5-.7.9-1.6 1-2.4.5 0 1 .2 1.4.5-.4.8-1.2 1.4-2.1 1.5C12 12.2 9.6 14 6.2 14 3.6 14 1.9 12.5 1.3 9.6z"/>`,
  makefile: `<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#427819"/>${S("M4.5 11.5v-7L8 8.5l3.5-4v7", "#fff", 1.3)}`,
  env: `<circle cx="5" cy="8" r="2.8" fill="none" stroke="#e5d559" stroke-width="1.4"/>${S("M7.8 8H14M12 8v2.4M14 8v1.8", "#e5d559", 1.4)}`,
  ini: S("M2.5 4.5h11M2.5 8h11M2.5 11.5h11", "#d1dbe0", 1.1) +
    `<circle cx="5.5" cy="4.5" r="1.5" fill="#d1dbe0"/><circle cx="10.5" cy="8" r="1.5" fill="#d1dbe0"/><circle cx="7" cy="11.5" r="1.5" fill="#d1dbe0"/>`,
  graphql: S("M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9zM8 1.8l5.4 9.3H2.6z", "#e10098", 1) +
    [[8, 1.8], [13.4, 4.9], [13.4, 11.1], [8, 14.2], [2.6, 11.1], [2.6, 4.9]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#e10098"/>`).join(""),
  svelte: S("M11.4 3.4C10 2.1 7.8 2 6.2 3.2L4.4 4.6c-1.4 1-1.7 3-.6 4.4M4.6 12.6c1.4 1.3 3.6 1.4 5.2.2l1.8-1.4c1.4-1 1.7-3 .6-4.4M9.8 6 6.2 10", "#ff3e00", 1.6),
  vue: `<path d="M1 2.5h3.2L8 9l3.8-6.5H15L8 14.5z" fill="#41b883"/><path d="M4.2 2.5h2.4L8 5l1.4-2.5h2.4L8 9z" fill="#35495e"/>`,
  text: S("M3 4h10M3 7h10M3 10h10M3 13h6", "#fff", 1.3),
  code: S(ANGLES, "#abb2bf"),
  file: S("M4 1.5h5l3.5 3.5v9.5H3.5V1.5zM9 1.5V5h3.5", "currentColor", 1.2),
  copy: S("M5.5 2.5h-1A1.5 1.5 0 0 0 3 4v9a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 13V4a1.5 1.5 0 0 0-1.5-1.5h-1", "currentColor", 1.3) +
    `<rect x="5.5" y="1.25" width="5" height="2.5" rx=".8" fill="none" stroke="currentColor" stroke-width="1.3"/>`,
  // The media failure panel: a framed landscape and a camera, each struck through, and the Open pill's arrow.
  "image-off": S("M13.5 10.5V3.5a1 1 0 0 0-1-1H5.5M2.5 4.5v8a1 1 0 0 0 1 1h8M2.5 10.5l3-3 3 3M9.5 8.5l1-1 3 3M1.5 1.5l13 13", "currentColor", 1.3),
  "video-off": S("M8 4.5h1.5a1 1 0 0 1 1 1V8M10.5 11v.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h1M10.5 7.5l4-2.5v6.5l-2.5-1.5M1.5 1.5l13 13", "currentColor", 1.3),
  download: S("M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 12.5v1a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1", "currentColor", 1.3),
  open: S("M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3", "currentColor", 1.3),
  // Slideshow arrows: monoline chevrons.
  "chevron-left": S("M10 3 5 8l5 5", "currentColor", 1.5),
  "chevron-right": S("M6 3l5 5-5 5", "currentColor", 1.5),
};

/** The icon a language label carries: its own, or the generic `</>` glyph. */
export function iconKey(lang) {
  const key = langKey(lang);
  if (!key) return "";
  return key in ICONS && !UI_ICONS.has(key) ? key : "code";
}

/** Sprite entries that are interface glyphs, never a language's icon. */
const UI_ICONS = words("copy file image-off video-off open download chevron-left chevron-right");

const useIcon = (key, cls) =>
  `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><use href="#icon-${key}"/></svg>`;

/**
 * The hidden sprite holding each icon the document uses. Emitted once at the
 * top of the body.
 *
 * @param {Iterable<string>} keys icon keys from `iconKey`, plus `copy` and
 *   `file` when a Copy button or a path is on the page, `image-off`,
 *   `video-off` and `open` for media failure panels, `chevron-left` and
 *   `chevron-right` for slideshow arrows, and `download` for file cards
 * @param {string} [extra] ready-made `<symbol>`s to add, such as file-type glyphs
 */
export function codeSprite(keys, extra = "") {
  const symbols = [...new Set(keys)].filter((k) => k in ICONS)
    .map((k) => `<symbol id="icon-${k}" viewBox="0 0 16 16">${ICONS[/** @type {keyof typeof ICONS} */ (k)]}</symbol>`);
  return `<svg class="sprite" aria-hidden="true" focusable="false">${symbols.join("")}${extra}</svg>`;
}

/**
 * The copy behaviour: one delegated listener, no inline handlers.
 *
 * A block's Copy button ships `hidden` and this reveals it, so a reader with
 * scripts blocked never sees a button that does nothing. Its text comes from
 * the block's `<template class="src">`, so the copy is the raw source, never the
 * highlighted markup or the line numbers.
 *
 * A path (`button[data-path]`: a file header or an inline file chip) copies
 * just its `data-path` and says "Copied" on itself through `data-state`. With
 * scripts blocked it still reads as the path.
 *
 * A media failure panel's "Copy link" (`button[data-copy]`) copies its
 * `data-copy` and says "Copied" in its label.
 *
 * Without the Clipboard API (or when it refuses) the text is selected instead,
 * ready for Ctrl+C. A link has no text on the page to select, so it goes
 * through a throwaway textarea and `execCommand("copy")`.
 */
export const COPY_SCRIPT = `(() => {
  for (const b of document.querySelectorAll("button.copy")) b.hidden = false;
  const timers = new WeakMap();
  const later = (el, fn) => {
    clearTimeout(timers.get(el));
    timers.set(el, setTimeout(fn, 1200));
  };
  const select = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const write = (text, ok, fail) => {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail);
    else fail();
  };
  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target.closest("button.copy, button[data-path]") : null;
    if (!el) return;
    if (el.dataset.copy !== undefined) {
      const label = el.querySelector("span");
      const say = (word) => {
        label.textContent = word;
        later(el, () => { label.textContent = "Copy link"; });
      };
      write(el.dataset.copy, () => say("Copied"), () => {
        const area = document.createElement("textarea");
        area.value = el.dataset.copy;
        document.body.append(area);
        area.select();
        const ok = document.execCommand("copy");
        area.remove();
        say(ok ? "Copied" : "Copy failed");
      });
      return;
    }
    if (el.dataset.path !== undefined) {
      const say = (word) => {
        el.dataset.state = word;
        later(el, () => { delete el.dataset.state; });
      };
      write(el.dataset.path, () => say("copied"), () => { select(el); say("selected"); });
      return;
    }
    const block = el.closest(".code");
    if (!block) return;
    const label = el.querySelector("span");
    const say = (word) => {
      label.textContent = word;
      later(el, () => { label.textContent = "Copy"; });
    };
    write(block.querySelector("template.src").content.textContent, () => say("Copied"),
      () => { select(block.querySelector("pre")); say("Selected"); });
  });
})();`;

/* ------------------------------------------------------------ blocks */

/** Resolve an info-string language to its canonical key, the one that picks the icon. */
export function langKey(lang) {
  const key = String(lang ?? "").toLowerCase();
  return ALIASES[key] ?? key;
}

/** Highlight a fragment of source. Unknown languages come back escaped, not styled. */
export function highlight(src, lang) {
  const key = tokKey(langKey(lang));
  return known(key) ? tokenize(String(src), key) : esc(src);
}

/** Text escaped for a double-quoted attribute. */
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

const COPY_BUTTON =
  `<button type="button" class="copy" aria-label="Copy code" hidden>${useIcon("copy", "copy-icon")}<span>Copy</span></button>`;

/**
 * A path that copies itself: a file glyph, then the directory and the file
 * name as separate spans, so a narrow screen can ellipsize the directory and
 * keep the name. Used by a file header (`code-path`) and an inline chip
 * (`file-chip`). `label` is what shows (a chip keeps its `:42`); `path` is what
 * lands on the clipboard.
 *
 * @param {string} path
 * @param {{ cls: string, label?: string }} opts
 */
export function pathButton(path, { cls, label = path }) {
  const cut = label.lastIndexOf("/", label.length - 2) + 1;
  const dir = label.slice(0, cut);
  return `<button type="button" class="${cls}" data-path="${escAttr(path)}" title="Copy path">` +
    `${useIcon("file", "file-icon")}<span class="p-text">${dir ? `<span class="p-dir">${esc(dir)}</span>` : ""}` +
    `<span class="p-name">${esc(label.slice(cut))}</span></span></button>`;
}

/**
 * The header. With nothing to name, the language sits alone on the left.
 * Otherwise the left carries the path (with its `L12–40` range), then the
 * title after a middot, and the language moves right, before Copy.
 *
 * @param {{ lang: string, icon: string, path?: string, range?: string, title?: string }} parts
 */
function header({ lang, icon, path = "", range = "", title = "" }) {
  const label = lang ? `<span class="code-lang">${icon ? useIcon(icon, "code-icon") : ""}${esc(lang)}</span>` : "";
  const names = [];
  if (path) {
    names.push(pathButton(path, { cls: "code-path" }) + (range ? `<span class="code-range">L${esc(range)}</span>` : ""));
  }
  if (title) names.push(`<span class="code-title">${esc(title)}</span>`);
  if (!names.length) return `<div class="code-head">${label}<span class="code-tools">${COPY_BUTTON}</span></div>`;
  return `<div class="code-head"><span class="code-name">${names.join('<span class="code-sep">·</span>')}</span>` +
    `<span class="code-tools">${label}${COPY_BUTTON}</span></div>`;
}

/**
 * `range=12-40` (or `12`): the first line number, and the label shown as
 * `L12–40`. Anything else is ignored.
 *
 * @param {string} range
 * @returns {{ start: number, label: string } | null}
 */
export function parseRange(range) {
  const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(String(range ?? "").trim());
  if (!m) return null;
  const start = Number(m[1]);
  return { start, label: m[2] ? `${start}–${Number(m[2])}` : String(start) };
}

/** The raw source the Copy button reads, inert inside a template. */
const source = (text) => `<template class="src">${esc(text)}</template>`;

const trimSource = (src) => String(src).replace(/^\n/, "").replace(/\s+$/, "");

/**
 * A fenced code block with a header (label, icon, Copy) and optional line
 * numbers. `lang` is a display label as well as the tokenizer selector. A
 * `range` turns numbering on and starts it at the range's first line; its
 * `L12–40` label shows next to the path, so only a file block carries it.
 *
 * @param {string} src
 * @param {{ lang?: string, file?: string, title?: string, range?: string, lines?: boolean }} [opts]
 */
export function code(src, { lang = "", file = "", title = "", range = "", lines = false } = {}) {
  const canon = langKey(lang);
  const key = tokKey(canon);
  const text = trimSource(src);
  const rng = parseRange(range);
  // Line numbering tokenizes line by line, sharing one state: splitting
  // already-tokenized markup on newlines would cut a multiline span in half.
  let body;
  if (lines || rng) {
    const st = newState(key);
    const start = rng && rng.start !== 1 ? ` style="counter-reset:l ${rng.start - 1}"` : "";
    body = `<ol class="code-lines"${start}>${text.split("\n").map((l) => {
      st.bol = true;
      st.cmd = true;
      const cell = known(key) ? tokenize(l, key, st) : esc(l);
      return `<li>${cell || "&nbsp;"}</li>`;
    }).join("")}</ol>`;
  } else {
    body = `<code>${known(key) ? tokenize(text, key) : esc(text)}</code>`;
  }
  const head = header({ lang, icon: iconKey(lang), path: file, range: rng?.label, title });
  const cls = canon === "text" ? "code has-head plain" : "code has-head";
  const font = CODE_FONTS[canon] ? ` data-font="${CODE_FONTS[canon]}"` : "";
  return `<div class="${cls}"${font}>${head}<pre>${body}</pre>${source(text)}</div>`;
}

/**
 * A unified diff: a +/- sign column, then the line, coloured per marker. No tokenizer.
 *
 * @param {string} src
 * @param {{ file?: string, title?: string }} [opts]
 */
export function diff(src, { file = "", title = "" } = {}) {
  const text = trimSource(src);
  const rows = text.split("\n").map((l) => {
    const kind = l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@") ? "hunk" : "ctx";
    if (kind === "hunk" || !l) return `<li class="d-${kind}">${esc(l) || "&nbsp;"}</li>`;
    return `<li class="d-${kind}"><span class="d-sign">${esc(l[0])}</span>${esc(l.slice(1))}</li>`;
  });
  return `<div class="code has-head diff">${header({ lang: "diff", icon: "diff", path: file, title })}` +
    `<pre><ol class="diff-lines">${rows.join("")}</ol></pre>${source(text)}</div>`;
}

/**
 * Render one `code` block: a snippet (language only), a file block (`file=`,
 * with an optional `range=`) or a captioned one (`title=`). File and title can
 * both be set.
 *
 * @param {CodeBlock} block
 */
export function renderCode(block) {
  return code(block?.source ?? "", {
    lang: block?.lang ?? "",
    // `||`, not `??`: normalize fills absent strings with "".
    file: block?.file || "",
    title: block?.title || "",
    range: block?.range || "",
    lines: block?.lines === true,
  });
}

/**
 * Render one `diff` block; `title=` names the change, `file=` the file it touches.
 * @param {DiffBlock} block
 */
export function renderDiff(block) {
  return diff(block?.source ?? "", { file: block?.file || "", title: block?.title || "" });
}

export { esc, KEYWORDS, RULE_LANGS };
