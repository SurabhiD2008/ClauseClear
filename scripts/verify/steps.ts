// Checks for verify that need more than one command: output summaries, the
// bundle budget and the fresh-clone run.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { BUNDLE_BUDGET_GZIP_BYTES } from "../../shared/src/constants.js";
import { run } from "./files.js";

const lastMatch = (output: string, regex: RegExp) =>
  [...output.matchAll(regex)].at(-1)?.[0]?.trim();

export function vitestSummary(output: string, code: number): string {
  const parts = [
    lastMatch(output, /Test Files .*$/gm),
    lastMatch(output, /Tests .*$/gm),
    lastMatch(output, /^Lines\s+:.*$/gm),
  ];
  const text = parts.filter((p) => p !== undefined).join("; ");
  return text === "" ? `exit ${String(code)}` : text;
}

export function e2eSummary(output: string, code: number, scope: string): string {
  const count = (word: string) =>
    /(\d+) /.exec(lastMatch(output, new RegExp(`^\\s*\\d+ ${word}.*$`, "gm")) ?? "")?.[1] ?? "0";
  const text = `${count("passed")} passed, ${count("failed")} failed, ${count("flaky")} flaky, ${count("skipped")} skipped (${scope})`;
  return code === 0 ? text : `${text}; exit ${String(code)}`;
}

/** The scripts index.html loads at once (entry and modulepreloads), gzipped. */
export function bundleCheck(root: string): { pass: boolean; summary: string; log: string } {
  const dist = path.join(root, "client", "dist");
  const indexPath = path.join(dist, "index.html");
  if (!existsSync(indexPath))
    return { pass: false, summary: "no client build to measure", log: "" };
  const html = readFileSync(indexPath, "utf8");
  const refs = new Set([
    ...[...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1] ?? ""),
    ...[...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)].map(
      (m) => m[1] ?? "",
    ),
  ]);
  const files = [...refs].map((ref) => {
    const data = readFileSync(path.join(dist, ref.replace(/^\//, "")));
    return { ref, bytes: data.length, gzip: gzipSync(data, { level: 9 }).length };
  });
  const total = files.reduce((sum, f) => sum + f.gzip, 0);
  return {
    pass: files.length > 0 && total <= BUNDLE_BUDGET_GZIP_BYTES,
    summary: `${(total / 1000).toFixed(1)} KB gzipped initial JS in ${String(files.length)} file(s); budget ${String(BUNDLE_BUDGET_GZIP_BYTES / 1000)} KB`,
    log: files
      .map((f) => `${f.ref}: ${String(f.bytes)} bytes, ${String(f.gzip)} gzipped`)
      .join("\n"),
  };
}

/**
 * Clones the committed repository into a temporary folder, installs from the
 * lockfile and runs `npm run verify` there with nothing else running. Only
 * committed work is checked, which is what a reader of the repository gets.
 */
export function freshCloneCheck(root: string): { pass: boolean; summary: string; log: string } {
  const temp = mkdtempSync(path.join(tmpdir(), "cc-fresh-clone-"));
  const dir = path.join(temp, "repo");
  const logs: string[] = [];
  const branch = run(root, "git rev-parse --abbrev-ref HEAD").output.trim();
  try {
    const steps = [
      // Only the branch being verified, as a reader cloning it gets it; other local
      // branches never leave this machine.
      {
        label: "clone",
        cmd: `git clone --quiet --single-branch --branch "${branch}" "${root}" "${dir}"`,
        cwd: temp,
      },
      { label: "install", cmd: "npm ci --prefer-offline --no-audit --no-fund", cwd: dir },
      { label: "verify", cmd: "npm run verify", cwd: dir },
    ];
    for (const step of steps) {
      const result = run(step.cwd, step.cmd);
      logs.push(`$ ${step.cmd}\n${result.output}`);
      if (result.code !== 0) {
        const last = result.output
          .trim()
          .split("\n")
          .filter((l) => /^(PASS|FAIL)/.test(l));
        return {
          pass: false,
          summary: `${step.label} failed${last.length > 0 ? `: ${last.filter((l) => l.startsWith("FAIL")).join("; ")}` : ""}`,
          log: logs.join("\n"),
        };
      }
    }
    const verifyLines = (logs.at(-1) ?? "").split("\n").filter((l) => l.startsWith("PASS")).length;
    return {
      pass: true,
      summary: `clean clone installed and passed verify (${String(verifyLines)} checks)`,
      log: logs.join("\n"),
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
