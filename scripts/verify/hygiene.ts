// The forbidden-pattern scan. Every tracked text file is checked line by line
// against the rules below; a hit fails the gate unless verify.allowlist.json has
// an entry for that exact file, rule and trimmed line, with a reason.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  isAllowed,
  loadAllowlist,
  unusedEntries,
  type AllowEntry,
  type Finding,
} from "./allowlist.js";
import { trackedFiles } from "./files.js";

export const MAX_FILE_LINES = 300;

const SOURCE = /\.(ts|tsx|js|mjs|cjs|css)$/;
const TEST_FILE =
  /\.(test|spec|property\.test)\.ts$|^client\/e2e\/|\/testing\/|^playwright\.config\.ts$/;
const APP_SOURCE = /^(server|client|shared)\/src\//;
const MEDIA_EXT = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm|mov|mp3|wav|ogg)$/i;
const PLANNING_NAME =
  /(^|\/)(PLAN|DESIGN|DECISIONS|VERIFY|SPEC|ASSUMPTIONS|PROGRESS|AUDIT|CLAUDE|Fable|Builds_skills)\.md$/i;

interface LineRule {
  id: string;
  /** Which files the rule reads. */
  applies: (file: string) => boolean;
  test: (line: string) => boolean;
}

const commentText = (line: string) => {
  const m = /(\/\/.*$|\/\*.*$|^\s*\*.*$|<!--.*$|^\s*#.*$)/.exec(line);
  return m?.[0] ?? "";
};

const LINE_RULES: LineRule[] = [
  {
    id: "secret-fallback",
    applies: (f) => SOURCE.test(f),
    test: (l) => /\b\w*(SECRET|KEY|TOKEN|PASSWORD)\w*\b[^\n]*(\?\?|\|\|)\s*["'`][^"'`]/.test(l),
  },
  {
    id: "cors-wildcard",
    applies: (f) => SOURCE.test(f) || f.endsWith(".json"),
    test: (l) =>
      /\bcors\(\s*\)/.test(l) ||
      /origin:\s*["'`]\*["'`]/.test(l) ||
      /Access-Control-Allow-Origin["']?\s*[,:]\s*["']?\s*(value["']?\s*:\s*["'])?\*/.test(l),
  },
  {
    id: "focused-or-skipped-test",
    applies: (f) => SOURCE.test(f),
    test: (l) =>
      /\b(it|test|describe)\.(only|skip|todo|fixme)\b/.test(l) ||
      /\b(xit|xdescribe|fit|fdescribe)\(/.test(l) ||
      /\btest\.fixme\(/.test(l),
  },
  {
    id: "print-debugging",
    applies: (f) => APP_SOURCE.test(f) && !TEST_FILE.test(f),
    test: (l) => /\bconsole\.(log|debug|info|trace)\(|\bdebugger\b/.test(l),
  },
  {
    id: "todo-marker",
    applies: (f) => SOURCE.test(f) || f.endsWith(".md"),
    test: (l) => /\b(TODO|FIXME|HACK|XXX)\b/.test(l),
  },
  {
    id: "suppression-without-reason",
    applies: (f) => SOURCE.test(f),
    test: (l) =>
      /@ts-(ignore|nocheck)\b/.test(l) ||
      (l.includes("@ts-expect-error") && !/@ts-expect-error\s+--\s+\S/.test(l)) ||
      (l.includes("eslint-disable") &&
        !/eslint-disable[\w-]*\s+[\w@/-]+(,\s*[\w@/-]+)*\s+--\s+\S/.test(l)),
  },
  {
    // Even a suppression with its reason on the line needs an allow-list entry.
    id: "suppression",
    applies: (f) => SOURCE.test(f),
    test: (l) => l.includes("eslint-disable") || l.includes("@ts-expect-error"),
  },
  {
    id: "unchecked-cast",
    applies: (f) => SOURCE.test(f),
    test: (l) => /\bas\s+any\b|\bas\s+unknown\s+as\b|<any>/.test(l),
  },
  {
    id: "raw-html-or-eval",
    applies: (f) => SOURCE.test(f) || f.endsWith(".html"),
    test: (l) =>
      /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|\beval\(|new Function\(/.test(
        l,
      ),
  },
  {
    id: "placeholder-text",
    applies: (f) => SOURCE.test(f) || /\.(json|html|md)$/.test(f),
    test: (l) => /lorem ipsum|coming soon|href=["']#?["']|\bTBD\b/i.test(l),
  },
  {
    id: "hardcoded-host-or-path",
    // The configuration schema is where defaults such as the local smoke URL live.
    applies: (f) => SOURCE.test(f) && !TEST_FILE.test(f) && f !== "server/src/configSchema.ts",
    test: (l) => /\blocalhost\b|127\.0\.0\.1|\/Users\/|\/home\/\w|[A-Z]:\\\\/.test(l),
  },
  {
    id: "model-id-literal",
    applies: (f) => SOURCE.test(f) && !f.startsWith("server/src/config"),
    test: (l) =>
      /["'`](gemini-\d|gpt-\d|claude-|o\d-|llama|gemma-?\d|mistral|mixtral|google\/gemma|meta\/llama)/i.test(
        l,
      ),
  },
  {
    id: "planning-reference",
    applies: (f) => SOURCE.test(f) || /(^|\/)\.env\.example$|\.ya?ml$|\.html$/.test(f),
    test: (l) =>
      /\bSPEC\b|SPEC\.md|[Pp]rompts? \d+\b|\bA\d{1,3}\b|ASSUMPTIONS|design\.md|AUDIT\.md|Builds_skills|PROGRESS\.md|\.planning\b|\bR-F?\d+\b|\bstep \d+ of the plan/.test(
        commentText(l),
      ),
  },
  {
    id: "emoji-in-copy",
    applies: (f) => f === "README.md" || /^client\/src\/.*\.(tsx|json)$/.test(f),
    test: (l) => /\p{Extended_Pictographic}/u.test(l),
  },
];

/** Version ranges in any package.json; engines are checked separately by name. */
function manifestFindings(file: string, text: string): Finding[] {
  const out: Finding[] = [];
  const json = JSON.parse(text) as Record<string, unknown>;
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "overrides",
    "engines",
  ]) {
    const deps = json[field] as Record<string, unknown> | undefined;
    for (const [name, spec] of Object.entries(deps ?? {})) {
      if (typeof spec !== "string") continue;
      if (/^\d+\.\d+\.\d+$/.test(spec)) continue;
      const line = `"${name}": "${spec}"`;
      out.push({ rule: "version-range", file, line, detail: `${field}.${name} is ${spec}` });
    }
  }
  return out;
}

function fileFindings(files: string[], root: string): Finding[] {
  const out: Finding[] = [];
  if (!existsSync(path.join(root, "LICENSE")))
    out.push({ rule: "missing-license", file: "LICENSE", line: null, detail: "no LICENSE file" });
  const byHash = new Map<string, string>();
  for (const file of files) {
    if (file.startsWith(".planning/"))
      out.push({ rule: "planning-file", file, line: null, detail: "tracked under .planning/" });
    else if (PLANNING_NAME.test(file))
      out.push({ rule: "planning-file", file, line: null, detail: "planning document tracked" });
    if (
      MEDIA_EXT.test(file) &&
      !file.startsWith("media/") &&
      !file.startsWith("client/src/assets/")
    )
      out.push({ rule: "media-location", file, line: null, detail: "media outside media/" });
    if (
      /thumbnail|thumb|gallery|cover|submission/i.test(path.basename(file)) ||
      /\/(thumbnails?|gallery|covers?|submission|screenshots)\//i.test(`/${file}`)
    )
      out.push({ rule: "media-name", file, line: null, detail: "disallowed media name" });
    const data = readFileSync(path.join(root, file));
    if (data.length > 0) {
      const hash = createHash("sha256").update(data).digest("hex");
      const first = byHash.get(hash);
      if (first === undefined) byHash.set(hash, file);
      else
        out.push({ rule: "duplicate-file", file, line: null, detail: `same content as ${first}` });
    }
  }
  return out;
}

export interface HygieneResult {
  findings: Finding[];
  /** Allow-list entries that match nothing any more. */
  stale: AllowEntry[];
  allowed: number;
  files: number;
}

export function scanHygiene(root: string): HygieneResult {
  const allowlist = loadAllowlist(root);
  const files = trackedFiles(root);
  const findings: Finding[] = fileFindings(files, root);
  for (const file of files) {
    if (!/\.(ts|tsx|js|mjs|cjs|css|json|html|md|ya?ml)$|(^|\/)\.env\.example$/.test(file)) continue;
    if (file === "package-lock.json" || file.startsWith("fixtures/")) continue;
    const text = readFileSync(path.join(root, file), "utf8");
    if (path.basename(file) === "package.json") findings.push(...manifestFindings(file, text));
    const lines = text.split(/\r?\n/);
    if (SOURCE.test(file) && lines.length - 1 > MAX_FILE_LINES)
      findings.push({
        rule: "file-size",
        file,
        line: null,
        detail: `${String(lines.length - 1)} lines`,
      });
    // This file spells out the forbidden patterns, so its lines are not scanned.
    if (file === "scripts/verify/hygiene.ts") continue;
    for (const line of lines)
      for (const rule of LINE_RULES)
        if (rule.applies(file) && rule.test(line))
          findings.push({
            rule: rule.id,
            file,
            line: line.trim(),
            detail: line.trim().slice(0, 160),
          });
  }
  const failing = findings.filter((f) => !isAllowed(allowlist, f));
  return {
    findings: failing,
    stale: unusedEntries(allowlist, findings),
    allowed: findings.length - failing.length,
    files: files.length,
  };
}
