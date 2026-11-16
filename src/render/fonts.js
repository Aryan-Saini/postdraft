/**
 * Webfonts embedded in every document as data: URIs, so a doc looks the same on
 * any machine and still loads nothing from outside itself. Only the latin subset
 * ships; other scripts fall through to the system stacks in shell.js.
 *
 * Prose is Inter, the exact file T3 Code bundles. Code is Cascadia Code unless
 * the block's language has a home font (CODE_FONTS): the font that language's
 * own toolchain ships, so Go reads like Go and Rust like rustdoc. A page embeds
 * only the code fonts its blocks use (`fontFaces`). Licences sit beside the
 * files; Go Mono is subset to latin from golang.org/x/image/font/gofont.
 *
 * @module render/fonts
 */

import { readFileSync } from "node:fs";

/**
 * Every embedded face. `css` is what a block with `data-font="<key>"` sets:
 * `--mono` swaps the family for the block and `--code-features` its OpenType
 * features (Cascadia's `ss01` cursive italics mean something else in other fonts).
 */
const FACES = {
  inter: { family: "Inter Variable", file: "inter-latin-wght.woff2", weight: "100 900" },
  cascadia: { family: "Cascadia Code Variable", file: "cascadia-code-latin-wght.woff2", weight: "200 700" },
  jetbrains: { family: "JetBrains Mono Variable", file: "jetbrains-mono-latin-wght.woff2", weight: "100 800" },
  fira: { family: "Fira Code Variable", file: "fira-code-latin-wght.woff2", weight: "300 700" },
  sourcecode: { family: "Source Code Pro Variable", file: "source-code-pro-latin-wght.woff2", weight: "200 900" },
  go: { family: "Go Mono", file: "go-mono-latin.woff2", weight: "400" },
  plex: { family: "IBM Plex Mono", file: "ibm-plex-mono-latin-400.woff2", weight: "400" },
};

/** @typedef {"cascadia-mono" | "jetbrains" | "fira" | "sourcecode" | "go" | "plex" | "sf"} CodeFont */

/**
 * Canonical language key (code.js `langKey`) -> code font. Anything unlisted,
 * TS/JS/Node included, stays on Cascadia Code with its ligatures.
 * @type {Record<string, CodeFont>}
 */
export const CODE_FONTS = {
  // A fence with no language: nothing to go on, so the IDE-neutral JetBrains default.
  "": "jetbrains",
  // Visual Studio's default. Ligatures off: `->`, `<<` and `/=` mean exactly what they say in C.
  c: "cascadia-mono", cpp: "cascadia-mono", cs: "cascadia-mono",
  // JetBrains IDEs: PyCharm, IntelliJ, DataGrip.
  py: "jetbrains", java: "jetbrains", kotlin: "jetbrains", scala: "jetbrains", sql: "jetbrains",
  // Fira Code's ligatures were drawn for these languages' operators.
  erlang: "fira", elixir: "fira", haskell: "fira", ocaml: "fira", clojure: "fira", fsharp: "fira",
  rust: "sourcecode", // rustdoc's code font
  go: "go", // Go Mono, drawn by Bigelow & Holmes for the Go project
  // Assembly has no home font. It is hex, registers and columns: Plex Mono's slashed
  // zero and distinct digits, no ligatures, IBM's mainframe lineage.
  asm: "plex",
  // Xcode's SF Mono only exists on Apple devices and cannot be embedded; elsewhere Cascadia.
  swift: "sf", objc: "sf",
};

/** The CSS a block with `data-font="<key>"` gets. */
export const CODE_FONT_CSS = [
  `.code[data-font="cascadia-mono"]{--code-features:"calt" 0;--code-ligatures:none}`,
  `.code[data-font="jetbrains"]{--mono:"JetBrains Mono Variable",var(--mono-fallback);--code-features:"calt" 1}`,
  `.code[data-font="fira"]{--mono:"Fira Code Variable",var(--mono-fallback);--code-features:"calt" 1}`,
  `.code[data-font="sourcecode"]{--mono:"Source Code Pro Variable",var(--mono-fallback);--code-features:"calt" 1}`,
  `.code[data-font="go"]{--mono:"Go Mono",var(--mono-fallback);--code-features:"calt" 1}`,
  `.code[data-font="plex"]{--mono:"IBM Plex Mono",var(--mono-fallback);--code-features:"zero" 1}`,
  `.code[data-font="sf"]{--mono:ui-monospace,"SF Mono","Cascadia Code Variable",var(--mono-fallback);--code-features:"calt" 1}`,
].join("\n");

/** Which embedded face each code font needs, if any. */
const FACE_OF = /** @type {Record<CodeFont, keyof typeof FACES | null>} */ ({
  "cascadia-mono": null, jetbrains: "jetbrains", fira: "fira", sourcecode: "sourcecode", go: "go", plex: "plex", sf: null,
});

/** @type {Map<string, string>} */
const cache = new Map();

/** The @font-face rule for one face, read and encoded once per process. */
function face(/** @type {keyof typeof FACES} */ key) {
  let rule = cache.get(key);
  if (rule) return rule;
  const { family, file, weight } = FACES[key];
  const data = readFileSync(new URL(`./fonts/${file}`, import.meta.url)).toString("base64");
  const format = weight.includes(" ") ? "woff2-variations" : "woff2";
  rule = `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:${weight};` +
    `src:url(data:font/woff2;base64,${data}) format("${format}")}`;
  cache.set(key, rule);
  return rule;
}

/**
 * The @font-face rules a page body needs: Inter and Cascadia always, plus the
 * face behind every `data-font` a code block in the body carries.
 *
 * @param {string} body
 * @returns {string}
 */
export function fontFaces(body) {
  /** @type {Set<keyof typeof FACES>} */
  const keys = new Set(["inter", "cascadia"]);
  for (const m of body.matchAll(/data-font="([a-z-]+)"/g)) {
    const k = FACE_OF[/** @type {CodeFont} */ (m[1])];
    if (k) keys.add(k);
  }
  return [...keys].map(face).join("");
}
