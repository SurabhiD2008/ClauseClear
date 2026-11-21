// npm run verify: the fast gate. npm run verify:final (--final): everything in
// verify, plus three consecutive test runs in random order, the browser suite on
// every width and a fresh-clone check. Every check runs even when an earlier one
// fails; each prints one PASS or FAIL line. The table goes to
// .planning/VERIFY.md, full logs to audit/logs/, and the exit code is 1 if
// anything failed. Needs no network and no API keys (the fresh clone copies the
// local repository).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkDependencies } from "./deps.js";
import { checkDocs } from "./docs.js";
import { run } from "./files.js";
import { scanHygiene } from "./hygiene.js";
import { bundleCheck, e2eSummary, freshCloneCheck, vitestSummary } from "./steps.js";
import { checkSecrets } from "./secrets.js";

export interface Step {
  name: string;
  pass: boolean;
  durationMs: number;
  summary: string;
}

const ROOT = process.cwd();
const FINAL = process.argv.includes("--final");
const LOG_DIR = path.join(ROOT, "audit", "logs");
mkdirSync(LOG_DIR, { recursive: true });
const steps: Step[] = [];
const started = new Date();

function record(step: Step, log: string): void {
  writeFileSync(path.join(LOG_DIR, `${step.name}.txt`), log);
  steps.push(step);
  const seconds = (step.durationMs / 1000).toFixed(1).padStart(6);
  console.log(
    `${step.pass ? "PASS" : "FAIL"}  ${step.name.padEnd(14)} ${seconds} s  ${step.summary}`,
  );
}

function command(
  name: string,
  cmd: string,
  summarise: (output: string, code: number) => string,
  env = {},
): boolean {
  const { code, output, durationMs } = run(ROOT, cmd, env);
  record({ name, pass: code === 0, durationMs, summary: summarise(output, code) }, output);
  return code === 0;
}

function timed<T>(fn: () => T): { value: T; durationMs: number } {
  const t = Date.now();
  const value = fn();
  return { value, durationMs: Date.now() - t };
}

command("lint", "npm run lint", (o, c) =>
  c === 0
    ? "eslint (0 warnings) and prettier clean"
    : `${/(\d+) problems?/.exec(o)?.[1] ?? "?"} eslint problem(s) or prettier issues`,
);
command("types", "npm run typecheck", (o, c) =>
  c === 0 ? "strict tsc clean" : `${String((o.match(/error TS\d+/g) ?? []).length)} type error(s)`,
);
command("tests", "npm run test:coverage", vitestSummary);
const built = command("build", "npm run build", (_o, c) =>
  c === 0 ? "shared, server and client built" : `exit ${String(c)}`,
);
const projects = FINAL ? "" : " --project=desktop";
command(
  "browser",
  `npx playwright test${projects} --reporter=line`,
  (o, c) => e2eSummary(o, c, FINAL ? "all five widths" : "desktop width"),
  built ? { E2E_SKIP_BUILD: "1" } : {},
);

{
  const { value, durationMs } = timed(() => checkSecrets(ROOT));
  const unexpected = value.hits.filter((h) => h.allowed === undefined);
  const pass = unexpected.length === 0 && value.historyHits.length === 0 && value.canaryFound;
  const summary = `${String(unexpected.length)} file hit(s), ${String(value.historyHits.length)} history hit(s), ${String(value.envValuesChecked)} .env value(s) checked; planted canary ${value.canaryFound ? "found" : "NOT found"}`;
  const log = [...unexpected.map((h) => `${h.file}: ${h.pattern}`), ...value.historyHits].join(
    "\n",
  );
  record({ name: "secrets", pass, durationMs, summary }, log);
}

{
  const audit = run(ROOT, "npm audit --omit=dev --audit-level=high --json");
  const counts = (
    JSON.parse(audit.output.slice(audit.output.indexOf("{"))) as {
      metadata: { vulnerabilities: Record<string, number> };
    }
  ).metadata.vulnerabilities;
  const severe = (counts.high ?? 0) + (counts.critical ?? 0);
  const { value: deps, durationMs } = timed(() => checkDependencies(ROOT));
  const pass = severe === 0 && deps.missing.length === 0 && deps.unused.length === 0;
  const summary = `${String(severe)} high/critical in production packages; ${String(deps.missing.length)} missing, ${String(deps.unused.length)} unused`;
  record(
    { name: "dependencies", pass, durationMs: durationMs + audit.durationMs, summary },
    [
      ...deps.missing.map((m) => `missing ${m}`),
      ...deps.unused.map((u) => `unused ${u}`),
      audit.output,
    ].join("\n"),
  );
}

{
  const { value, durationMs } = timed(() => scanHygiene(ROOT));
  const lines = [
    ...value.findings.map((f) => `${f.rule}  ${f.file}  ${f.detail}`),
    ...value.stale.map((e) => `stale allow-list entry: ${e.rule} ${e.file} ${e.line ?? ""}`),
  ];
  const summary = `${String(value.findings.length)} finding(s), ${String(value.stale.length)} stale exception(s), ${String(value.allowed)} allowed with a reason, ${String(value.files)} files`;
  record({ name: "hygiene", pass: lines.length === 0, durationMs, summary }, lines.join("\n"));
}

{
  const { value, durationMs } = timed(() => checkDocs(ROOT));
  record(
    {
      name: "docs",
      pass: value.length === 0,
      durationMs,
      summary:
        value.length === 0
          ? "commands, variables, links and numbers agree"
          : `${String(value.length)} problem(s)`,
    },
    value.join("\n"),
  );
}

{
  const { value, durationMs } = timed(() => bundleCheck(ROOT));
  record({ name: "bundle", pass: value.pass, durationMs, summary: value.summary }, value.log);
}

command("results", "npm run results:check", (o, c) =>
  c === 0
    ? "every sample and fixture result holds"
    : (o.trim().split("\n").at(-1) ?? `exit ${String(c)}`),
);

if (FINAL) {
  for (const n of [1, 2, 3])
    command(`tests-run-${String(n)}`, "npx vitest run --sequence.shuffle", vitestSummary);
  const { value, durationMs } = timed(() => freshCloneCheck(ROOT));
  record({ name: "fresh-clone", pass: value.pass, durationMs, summary: value.summary }, value.log);
}

const pass = steps.every((s) => s.pass);
const table = [
  "# VERIFY",
  "",
  `Generated by \`npm run ${FINAL ? "verify:final" : "verify"}\`. Started ${started.toISOString()}, finished ${new Date().toISOString()}. Overall: **${pass ? "PASS" : "FAIL"}**.`,
  "",
  "| Check | Result | Time | Summary |",
  "| --- | --- | --- | --- |",
  ...steps.map(
    (s) =>
      `| ${s.name} | ${s.pass ? "PASS" : "FAIL"} | ${(s.durationMs / 1000).toFixed(1)} s | ${s.summary.replace(/\|/g, "\\|")} |`,
  ),
  "",
  "Full logs: `audit/logs/<check>.txt`.",
  "",
].join("\n");
mkdirSync(path.join(ROOT, ".planning"), { recursive: true });
writeFileSync(path.join(ROOT, ".planning", "VERIFY.md"), table);
console.log(`\nOverall: ${pass ? "PASS" : "FAIL"}  (.planning/VERIFY.md)`);
process.exitCode = pass ? 0 : 1;
