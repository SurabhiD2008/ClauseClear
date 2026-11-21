// Helpers shared by the verify checks: the tracked file list and child processes.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** Files git tracks, plus untracked files that are not ignored. */
export function trackedFiles(root: string): string[] {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr}`);
  return result.stdout
    .split("\0")
    .filter((f) => f !== "" && existsSync(path.join(root, f)))
    .sort();
}

export interface RunResult {
  code: number;
  output: string;
  durationMs: number;
}

/** Runs a shell command in root and captures its combined output without colours. */
export function run(root: string, command: string, env: Record<string, string> = {}): RunResult {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, FORCE_COLOR: "0", ...env },
  });
  const output = `${result.stdout}${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: result.status ?? 1, output, durationMs: Date.now() - started };
}
