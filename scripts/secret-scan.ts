// Secret scan for npm run audit (SPEC section 12): the repository's files and
// the built client, searched for key-shaped strings and for the actual values
// of the keys in .env. Matches are reported by file and pattern only; a value
// is never printed.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface SecretHit {
  file: string;
  pattern: string;
  /** Set when the hit is a known test canary that is meant to be there. */
  allowed?: string;
}

/** Key shapes for the providers ClauseClear uses, plus common others. */
export const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "Google API key (AIza…)", regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: "NVIDIA API key (nvapi-…)", regex: /nvapi-[0-9A-Za-z_-]{20,}/g },
  { name: "private key block", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "GitHub token", regex: /\bgh[pousr]_[0-9A-Za-z]{30,}/g },
  { name: "Slack token", regex: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
  { name: "Stripe key", regex: /\b[sr]k_(live|test)_[0-9A-Za-z]{16,}/g },
];

/**
 * Test canaries that are fake by construction and must stay where they are.
 * Each is explained in AUDIT.md ("Secret scan exemptions").
 */
export const ALLOWED_CANARIES: { file: string; value: string; reason: string }[] = [
  {
    file: "server/src/routes/analyze.test.ts",
    // Built from parts so this file does not itself match the pattern.
    value: ["AIza", "FAKE-canary-key-0123456789abcdef"].join(""),
    reason: "fake key the API tests set to prove it never reaches a log line or a response",
  },
];

/** Values of KEY, TOKEN or SECRET variables in an env file, at least 16 characters long. */
export function envSecrets(envFile: string): { name: string; value: string }[] {
  if (!existsSync(envFile)) return [];
  const out: { name: string; value: string }[] = [];
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"#\s]+)"?/.exec(line);
    if (m?.[1] === undefined || m[2] === undefined) continue;
    if (/KEY|TOKEN|SECRET/.test(m[1]) && m[2].length >= 16) out.push({ name: m[1], value: m[2] });
  }
  return out;
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Tracked files plus untracked files that are not ignored (.env is ignored). */
export function repoFiles(root: string): string[] {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    maxBuffer: 1 << 28,
  });
  return out
    .toString("utf8")
    .split("\0")
    .filter((f) => f !== "" && existsSync(path.join(root, f)))
    .map((f) => path.join(root, f));
}

export function scanFiles(
  root: string,
  files: string[],
  secrets: { name: string; value: string }[],
): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const file of files) {
    if (!statSync(file).isFile()) continue;
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const text = readFileSync(file).toString("latin1");
    for (const { name, regex } of SECRET_PATTERNS) {
      for (const m of text.matchAll(regex)) {
        const allowed = ALLOWED_CANARIES.find((c) => c.file === rel && c.value === m[0]);
        hits.push({ file: rel, pattern: name, ...(allowed ? { allowed: allowed.reason } : {}) });
      }
    }
    for (const { name, value } of secrets) {
      if (text.includes(value)) hits.push({ file: rel, pattern: `value of ${name} from .env` });
    }
  }
  return hits;
}

export const builtFiles = (root: string) => [
  ...walk(path.join(root, "client", "dist")),
  ...walk(path.join(root, "server", "dist")),
];
