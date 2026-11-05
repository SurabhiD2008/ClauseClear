// Checks the interface copy against the voice rules in SPEC section 10:
// "Avoid em dashes, 'not just X but Y', triplets of adjectives and words like
// seamless, powerful or unlock." Every string in client/src/i18n/en.json is
// checked; hi.json is checked for dashes only (the word lists are English).
// Prints each violation by key and exits 1 if there is any.
//   npm run voice:check
//   npm run voice:check -- path/to/copy.json
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

interface Rule {
  name: string;
  test: (text: string) => string | null;
}

/** Marketing words and fillers that add nothing to a plain sentence. */
const WORDS = [
  "seamless",
  "seamlessly",
  "powerful",
  "unlock",
  "unlocks",
  "effortless",
  "effortlessly",
  "robust",
  "leverage",
  "empower",
  "empowers",
  "cutting-edge",
  "game-changer",
  "game-changing",
  "revolutionary",
  "supercharge",
  "streamline",
  "world-class",
  "best-in-class",
  "next-generation",
  "innovative",
  "simply",
  "basically",
  "actually",
  "really",
  "very",
  "literally",
  "truly",
  "incredibly",
  "just",
];

/** Common adjective endings, for the "three adjectives in a row" heuristic. */
const ADJECTIVE = /^[a-z]+(ful|ous|ive|able|ible|al|ic|less|ent|ant|ed|y)$/i;

const RULES: Rule[] = [
  {
    name: "em dash",
    test: (text) => (/[—―]|\s--\s/.test(text) ? "uses an em dash" : null),
  },
  {
    name: "not just X but Y",
    test: (text) => {
      const m = /\bnot (just|only|merely)\b[^.?!]*\bbut\b/i.exec(text);
      return m === null ? null : `"${m[0]}"`;
    },
  },
  {
    name: "filler or marketing word",
    test: (text) => {
      const found = WORDS.filter((word) =>
        new RegExp(`(?<![\\p{L}-])${word}(?![\\p{L}-])`, "iu").test(text),
      );
      return found.length === 0 ? null : found.map((w) => `"${w}"`).join(", ");
    },
  },
  {
    name: "triplet of adjectives",
    test: (text) => {
      const m = /\b([a-z]+), ([a-z]+),? (?:and|or) ([a-z]+)\b/i.exec(text);
      if (m === null) return null;
      const words = m.slice(1, 4);
      // Two adjective-shaped words make it a triplet ("careful, thorough and reliable").
      return words.filter((w) => ADJECTIVE.test(w)).length >= 2 ? `"${m[0]}"` : null;
    },
  },
];

function flatten(node: unknown, prefix = ""): [string, string][] {
  if (typeof node === "string") return [[prefix, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => flatten(v, `${prefix}[${String(i)}]`));
  if (typeof node === "object" && node !== null) {
    return Object.entries(node).flatMap(([k, v]) =>
      flatten(v, prefix === "" ? k : `${prefix}.${k}`),
    );
  }
  return [];
}

const load = (lang: string) =>
  flatten(JSON.parse(readFileSync(path.join(ROOT, `client/src/i18n/${lang}.json`), "utf8")));

// A file argument checks that file with every rule instead (used to show the
// script catches each rule: npm run voice:check -- some-bad-copy.json).
const only = process.argv[2];
const files: { lang: string; strings: [string, string][]; rules: Rule[] }[] =
  only === undefined
    ? [
        { lang: "en", strings: load("en"), rules: RULES },
        { lang: "hi", strings: load("hi"), rules: RULES.filter((r) => r.name === "em dash") },
      ]
    : [
        {
          lang: path.basename(only, ".json"),
          strings: flatten(JSON.parse(readFileSync(only, "utf8"))),
          rules: RULES,
        },
      ];

let total = 0;
for (const { lang, strings, rules } of files) {
  const found: string[] = [];
  for (const [key, text] of strings) {
    for (const rule of rules) {
      const detail = rule.test(text);
      if (detail !== null) found.push(`  ${lang}.json  ${key}  [${rule.name}] ${detail}`);
    }
  }
  console.log(
    `${lang}.json: ${String(strings.length)} strings, ${String(rules.length)} rule(s), ${String(found.length)} violation(s)`,
  );
  for (const line of found) console.log(line);
  total += found.length;
}
console.log(`Total violations: ${String(total)}`);
process.exitCode = total === 0 ? 0 : 1;
