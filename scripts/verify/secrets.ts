// Secret check: tracked files, the built client and server, every commit in
// git history, and the values of the keys in a local .env. A fake key is then
// planted in a copy of the built client and a source file, and the scan must
// find it, which proves the scan works on real output.
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ALLOWED_CANARIES,
  SECRET_PATTERNS,
  builtFiles,
  envSecrets,
  repoFiles,
  scanFiles,
  type SecretHit,
} from "../secret-scan.js";

export interface SecretsResult {
  hits: SecretHit[];
  historyHits: string[];
  envValuesChecked: number;
  canaryFound: boolean;
}

/**
 * Scans the patch text of every commit that is or will be published (this
 * branch and the remote branches) for key shapes and current .env values. Local
 * branches that are never pushed are not part of the published history.
 */
export function scanHistory(root: string, secrets: { name: string; value: string }[]): string[] {
  const log = spawnSync("git", ["log", "-p", "HEAD", "--remotes", "--format=commit %H"], {
    cwd: root,
    encoding: "latin1",
    maxBuffer: 1 << 30,
  });
  if (log.status !== 0) return [`git log failed: ${log.stderr}`];
  const hits: string[] = [];
  let commit = "";
  for (const line of log.stdout.split("\n")) {
    if (line.startsWith("commit ")) commit = line.slice(7, 15);
    if (!line.startsWith("+")) continue;
    for (const { name, regex } of SECRET_PATTERNS) {
      for (const m of line.matchAll(regex)) {
        if (ALLOWED_CANARIES.some((c) => c.value === m[0])) continue;
        hits.push(`${commit}: ${name}`);
      }
    }
    for (const { name, value } of secrets)
      if (line.includes(value)) hits.push(`${commit}: value of ${name}`);
  }
  return [...new Set(hits)];
}

function plantedCanaryFound(root: string): boolean {
  const temp = mkdtempSync(path.join(tmpdir(), "cc-secret-canary-"));
  try {
    const fakeGoogle = ["AIza", "Sy", "CANARY", randomBytes(16).toString("hex").slice(0, 27)].join(
      "",
    );
    const fakeEnv = `canary${randomBytes(12).toString("hex")}`;
    const dist = path.join(temp, "client", "dist");
    if (existsSync(path.join(root, "client", "dist")))
      cpSync(path.join(root, "client", "dist"), dist, { recursive: true });
    mkdirSync(path.join(dist, "assets"), { recursive: true });
    const chunk =
      readdirSync(path.join(dist, "assets")).find((f) => f.endsWith(".js")) ?? "canary.js";
    const chunkPath = path.join(dist, "assets", chunk);
    const original = existsSync(chunkPath) ? readFileSync(chunkPath, "utf8") : "";
    writeFileSync(chunkPath, `${original}\n;var k="${fakeGoogle}";`);
    writeFileSync(path.join(temp, ".env"), `GEMINI_API_KEY=${fakeEnv}\n`);
    mkdirSync(path.join(temp, "src"), { recursive: true });
    writeFileSync(path.join(temp, "src", "config.ts"), `export const key = "${fakeEnv}";\n`);
    const planted = scanFiles(
      temp,
      builtFiles(temp).concat(path.join(temp, "src", "config.ts")),
      envSecrets(path.join(temp, ".env")),
    );
    return (
      planted.some((h) => h.pattern.startsWith("Google API key")) &&
      planted.some((h) => h.pattern.includes("GEMINI_API_KEY"))
    );
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function checkSecrets(root: string): SecretsResult {
  const secrets = envSecrets(path.join(root, ".env"));
  const hits = scanFiles(root, [...repoFiles(root), ...builtFiles(root)], secrets);
  return {
    hits,
    historyHits: scanHistory(root, secrets),
    envValuesChecked: secrets.length,
    canaryFound: plantedCanaryFound(root),
  };
}
