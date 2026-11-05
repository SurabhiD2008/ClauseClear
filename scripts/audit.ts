// npm run audit (SPEC section 12): typecheck, lint, unit, integration, build,
// end-to-end on all five projects, a secret scan of the repo and the built
// client, npm audit and the bundle budget. Every step runs even when an
// earlier one fails. Writes audit/report.json and AUDIT.md, prints a summary
// table, and exits 1 if any step failed.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
import { gzipSync } from "node:zlib";
import {
  ALLOWED_CANARIES,
  builtFiles,
  envSecrets,
  repoFiles,
  scanFiles,
  type SecretHit,
} from "./secret-scan.js";

const ROOT = process.cwd();
const AUDIT_DIR = path.join(ROOT, "audit");
const LOG_DIR = path.join(AUDIT_DIR, "logs");
const E2E_JSON = path.join(AUDIT_DIR, "e2e-results.json");
/** Initial client JavaScript, gzipped (SPEC section 12): 250 KB, counted as 250,000 bytes. */
export const BUNDLE_BUDGET_BYTES = 250_000;
const PROJECTS = ["desktop", "laptop", "tablet", "mobile", "small-phone"];

type Status = "pass" | "fail";
interface Step {
  name: string;
  status: Status;
  durationMs: number;
  summary: string;
  log?: string;
}

mkdirSync(LOG_DIR, { recursive: true });
const steps: Step[] = [];

function run(command: string, env: Record<string, string> = {}) {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    env: { ...process.env, FORCE_COLOR: "0", ...env },
  });
  const output = `${result.stdout}${result.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  return { code: result.status ?? 1, output, durationMs: Date.now() - started };
}

function record(step: Step, output?: string) {
  if (output !== undefined) {
    const log = path.join(LOG_DIR, `${step.name}.txt`);
    writeFileSync(log, output);
    step.log = path.relative(ROOT, log).replace(/\\/g, "/");
  }
  steps.push(step);
  console.log(
    `${step.status === "pass" ? "PASS" : "FAIL"}  ${step.name.padEnd(12)} ${(step.durationMs / 1000).toFixed(1).padStart(6)} s  ${step.summary}`,
  );
}

function commandStep(
  name: string,
  command: string,
  summarise: (output: string, code: number) => string,
  env?: Record<string, string>,
) {
  const { code, output, durationMs } = run(command, env);
  record(
    { name, status: code === 0 ? "pass" : "fail", durationMs, summary: summarise(output, code) },
    output,
  );
  return code === 0;
}

const lastMatch = (output: string, regex: RegExp) =>
  [...output.matchAll(regex)].at(-1)?.[0]?.trim();
const vitestSummary = (output: string, code: number) =>
  [lastMatch(output, /Test Files .*$/gm), lastMatch(output, /Tests .*$/gm)]
    .filter((s) => s !== undefined)
    .join("; ") || `exit ${String(code)}`;

// 1-5. The static checks, the test suites and the build.
commandStep("typecheck", "npm run typecheck", (o, c) =>
  c === 0 ? "tsc clean" : `${String((o.match(/error TS\d+/g) ?? []).length)} type error(s)`,
);
commandStep("lint", "npm run lint", (o, c) => {
  if (c === 0) return "eslint and prettier clean";
  const problems = /✖ (\d+) problems?/.exec(o)?.[1];
  return problems === undefined ? "prettier or eslint failed" : `${problems} eslint problem(s)`;
});
commandStep("unit", 'npx vitest run --exclude "src/routes/**"', vitestSummary);
commandStep("integration", "npx vitest run server/src/routes", vitestSummary);
const built = commandStep("build", "npm run build", (_o, c) =>
  c === 0 ? "shared, server and client built" : `exit ${String(c)}`,
);

// 6. End to end on all five projects, with the oddity guard.
interface E2eTest {
  project: string;
  file: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "flaky";
  error: string;
  guard: { check: string; detail: string }[];
  screenshot: string | null;
}
const e2eTests: E2eTest[] = [];
{
  rmSync(E2E_JSON, { force: true });
  const { code, output, durationMs } = run("npx playwright test --reporter=list,json", {
    PLAYWRIGHT_JSON_OUTPUT_NAME: E2E_JSON,
    ...(built ? { E2E_SKIP_BUILD: "1" } : {}),
  });
  if (existsSync(E2E_JSON)) {
    interface JsonSuite {
      file?: string;
      suites?: JsonSuite[];
      specs?: {
        title: string;
        file: string;
        tests: {
          projectName: string;
          status: string;
          results: { errors?: { message?: string }[] }[];
        }[];
      }[];
      title?: string;
    }
    const json = JSON.parse(readFileSync(E2E_JSON, "utf8")) as { suites: JsonSuite[] };
    const visit = (suite: JsonSuite, titles: string[]) => {
      const here =
        suite.file === undefined || suite.title === suite.file
          ? titles
          : [...titles, suite.title ?? ""];
      for (const spec of suite.specs ?? []) {
        for (const t of spec.tests) {
          // Playwright colours its messages; the report is plain text (prompt 18).
          const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");
          const messages = t.results.flatMap((r) =>
            (r.errors ?? []).map((e) => plain(e.message ?? "")),
          );
          const all = messages.join("\n");
          const guard = [...all.matchAll(/^ {2}\[([a-z-]+)\] (.*)$/gm)].map((m) => ({
            check: m[1] ?? "",
            detail: m[2] ?? "",
          }));
          const status =
            t.status === "skipped"
              ? "skipped"
              : t.status === "expected"
                ? "passed"
                : t.status === "flaky"
                  ? "flaky"
                  : "failed";
          e2eTests.push({
            project: t.projectName,
            file: spec.file,
            title: [...here, spec.title].filter((s) => s !== "").join(" › "),
            status,
            error:
              status === "failed" ? ((messages[0] ?? "").split("\n")[0]?.slice(0, 240) ?? "") : "",
            guard: status === "failed" ? guard : [],
            screenshot: /screenshot: (\S+)/.exec(all)?.[1] ?? null,
          });
        }
      }
      for (const child of suite.suites ?? []) visit(child, here);
    };
    for (const suite of json.suites) visit(suite, []);
  }
  const failed = e2eTests.filter((t) => t.status === "failed" || t.status === "flaky").length;
  const passed = e2eTests.filter((t) => t.status === "passed").length;
  const skipped = e2eTests.filter((t) => t.status === "skipped").length;
  record(
    {
      name: "e2e",
      status: code === 0 && failed === 0 && e2eTests.length > 0 ? "pass" : "fail",
      durationMs,
      summary: `${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped (${String(e2eTests.length)} total)`,
    },
    output,
  );
}

// 7. Secret scan: the repo, the built client and server, and a planted canary
// that must be found (proving the scan works on a real bundle).
const secretHits: SecretHit[] = [];
let canaryFound: string[] = [];
{
  const started = Date.now();
  const secrets = envSecrets(path.join(ROOT, ".env"));
  secretHits.push(...scanFiles(ROOT, [...repoFiles(ROOT), ...builtFiles(ROOT)], secrets));

  const temp = mkdtempSync(path.join(tmpdir(), "cc-secret-canary-"));
  try {
    // A fake Google key in a copy of the real built client, and a fake .env
    // value hidden in a source file. Both are made here and never written to the repo.
    const fakeGoogle = ["AIza", "Sy", "CANARY", randomBytes(16).toString("hex").slice(0, 27)].join(
      "",
    );
    const fakeEnv = `canary${randomBytes(12).toString("hex")}`;
    const dist = path.join(temp, "client", "dist");
    if (existsSync(path.join(ROOT, "client", "dist")))
      cpSync(path.join(ROOT, "client", "dist"), dist, { recursive: true });
    mkdirSync(path.join(dist, "assets"), { recursive: true });
    const chunk =
      readdirSync(path.join(dist, "assets")).find((f) => f.endsWith(".js")) ?? "canary.js";
    const chunkPath = path.join(dist, "assets", chunk);
    writeFileSync(
      chunkPath,
      `${existsSync(chunkPath) ? readFileSync(chunkPath, "utf8") : ""}\n;var k="${fakeGoogle}";`,
    );
    writeFileSync(path.join(temp, ".env"), `GEMINI_API_KEY=${fakeEnv}\n`);
    mkdirSync(path.join(temp, "src"), { recursive: true });
    writeFileSync(path.join(temp, "src", "config.ts"), `export const key = "${fakeEnv}";\n`);
    const planted = scanFiles(
      temp,
      builtFiles(temp).concat(path.join(temp, "src", "config.ts")),
      envSecrets(path.join(temp, ".env")),
    );
    canaryFound = planted.map((h) => `${h.file}: ${h.pattern}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const unexpected = secretHits.filter((h) => h.allowed === undefined);
  const canaryOk =
    canaryFound.some((h) => h.includes("Google API key")) &&
    canaryFound.some((h) => h.includes("value of GEMINI_API_KEY"));
  const lines = [
    `scanned repo files and client/dist + server/dist; .env values checked: ${String(secrets.length)}`,
    ...secretHits.map(
      (h) =>
        `${h.allowed === undefined ? "HIT " : "OK  "} ${h.file}: ${h.pattern}${h.allowed === undefined ? "" : ` (allowed: ${h.allowed})`}`,
    ),
    `planted canary results: ${canaryFound.join("; ") || "none found"}`,
  ];
  record(
    {
      name: "secrets",
      status: unexpected.length === 0 && canaryOk ? "pass" : "fail",
      durationMs: Date.now() - started,
      summary: `${String(unexpected.length)} unexpected hit(s), ${String(secretHits.length - unexpected.length)} allowed canary; planted canary ${canaryOk ? "detected in the built client and via .env" : "NOT detected"}`,
    },
    lines.join("\n"),
  );
}

// 8. npm audit: any known vulnerability fails, as npm audit's own exit code does.
let vulnerabilities: Record<string, number> = {};
{
  const { code, output, durationMs } = run("npm audit --json");
  try {
    vulnerabilities = (
      JSON.parse(output) as { metadata: { vulnerabilities: Record<string, number> } }
    ).metadata.vulnerabilities;
  } catch {
    vulnerabilities = {};
  }
  const parts = Object.entries(vulnerabilities)
    .filter(([k]) => k !== "total")
    .map(([k, v]) => `${k} ${String(v)}`);
  record(
    {
      name: "npm-audit",
      status: code === 0 ? "pass" : "fail",
      durationMs,
      summary: `${String(vulnerabilities.total ?? "?")} vulnerabilities (${parts.join(", ")})`,
    },
    output,
  );
}

// 9. Bundle budget: the scripts index.html loads at once (entry and modulepreloads), gzipped.
const bundle: { file: string; bytes: number; gzip: number }[] = [];
{
  const started = Date.now();
  const indexPath = path.join(ROOT, "client", "dist", "index.html");
  if (existsSync(indexPath)) {
    const html = readFileSync(indexPath, "utf8");
    const refs = [
      ...[...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1] ?? ""),
      ...[...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)].map(
        (m) => m[1] ?? "",
      ),
    ];
    for (const ref of new Set(refs)) {
      const file = path.join(ROOT, "client", "dist", ref.replace(/^\//, ""));
      const data = readFileSync(file);
      bundle.push({ file: ref, bytes: data.length, gzip: gzipSync(data, { level: 9 }).length });
    }
  }
  const total = bundle.reduce((sum, b) => sum + b.gzip, 0);
  record(
    {
      name: "bundle",
      status: bundle.length > 0 && total <= BUNDLE_BUDGET_BYTES ? "pass" : "fail",
      durationMs: Date.now() - started,
      summary: `${(total / 1000).toFixed(1)} KB gzipped initial JS in ${String(bundle.length)} file(s); budget ${String(BUNDLE_BUDGET_BYTES / 1000)} KB`,
    },
    bundle.map((b) => `${b.file}: ${String(b.bytes)} bytes, ${String(b.gzip)} gzipped`).join("\n"),
  );
}

// Per-project end-to-end table and the failures, grouped by guard check.
const perProject = PROJECTS.map((project) => {
  const mine = e2eTests.filter((t) => t.project === project);
  const count = (s: E2eTest["status"]) => mine.filter((t) => t.status === s).length;
  const failed = count("failed") + count("flaky");
  return {
    project,
    passed: count("passed"),
    failed,
    skipped: count("skipped"),
    status: mine.length > 0 && failed === 0 ? "pass" : "fail",
  };
});
const failures = e2eTests.filter((t) => t.status === "failed" || t.status === "flaky");
const byCheck: Record<string, number> = {};
for (const t of failures)
  for (const g of new Set(t.guard.map((x) => x.check))) byCheck[g] = (byCheck[g] ?? 0) + 1;

const overall: Status = steps.every((s) => s.status === "pass") ? "pass" : "fail";
const report = {
  generatedAt: new Date().toISOString(),
  overall,
  steps,
  e2e: { perProject, failuresByGuardCheck: byCheck, failures },
  secrets: { hits: secretHits, plantedCanary: canaryFound },
  npmAudit: vulnerabilities,
  bundle: { budgetBytes: BUNDLE_BUDGET_BYTES, files: bundle },
};
writeFileSync(path.join(AUDIT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

// AUDIT.md keeps its hand-written sections (exemptions, known issues) between runs.
const auditMd = path.join(ROOT, "AUDIT.md");
const previous = existsSync(auditMd) ? readFileSync(auditMd, "utf8") : "";
const kept = /<!-- manual -->[\s\S]*$/.exec(previous)?.[0] ?? "<!-- manual -->\n";
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const md = [
  "# Audit",
  "",
  `Written by \`npm run audit\` (scripts/audit.ts) on ${report.generatedAt}. Overall: **${overall.toUpperCase()}**. Raw data: \`audit/report.json\`; step logs: \`audit/logs/\`.`,
  "",
  "## Steps",
  "",
  "| Step | Result | Time | Summary |",
  "| --- | --- | --- | --- |",
  ...steps.map(
    (s) =>
      `| ${s.name} | ${s.status.toUpperCase()} | ${(s.durationMs / 1000).toFixed(1)} s | ${cell(s.summary)} |`,
  ),
  "",
  "## End to end per project",
  "",
  "| Project | Result | Passed | Failed | Skipped |",
  "| --- | --- | --- | --- | --- |",
  ...perProject.map(
    (p) =>
      `| ${p.project} | ${p.status.toUpperCase()} | ${String(p.passed)} | ${String(p.failed)} | ${String(p.skipped)} |`,
  ),
  "",
  "## Failing tests by guard check",
  "",
  Object.keys(byCheck).length === 0
    ? "No guard findings."
    : [
        "| Check | Failing tests |",
        "| --- | --- |",
        ...Object.entries(byCheck)
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => `| ${c} | ${String(n)} |`),
      ].join("\n"),
  "",
  "## Failing tests",
  "",
  failures.length === 0
    ? "None."
    : [
        "| Project | Test | First error | Guard findings | Screenshot |",
        "| --- | --- | --- | --- | --- |",
        ...failures.map(
          (t) =>
            `| ${t.project} | ${cell(`${t.file} › ${t.title}`)} | ${cell(t.error)} | ${cell(t.guard.map((g) => `[${g.check}] ${g.detail}`).join("; "))} | ${t.screenshot ?? ""} |`,
        ),
      ].join("\n"),
  "",
  "## Secret scan",
  "",
  ...secretHits.map(
    (h) =>
      `- ${h.allowed === undefined ? "**Unexpected**" : "Allowed"}: \`${h.file}\` (${h.pattern})`,
  ),
  `- Planted canary: ${canaryFound.length === 0 ? "**not detected**" : canaryFound.map((c) => `\`${c}\``).join(", ")}`,
  "",
  "## Bundle",
  "",
  ...bundle.map((b) => `- \`${b.file}\`: ${String(b.bytes)} bytes, ${String(b.gzip)} gzipped`),
  "",
  kept.trimEnd(),
  "",
].join("\n");
writeFileSync(auditMd, md);
// AUDIT.md is committed, and the next audit's lint step runs `prettier --check .`
// over it, so it is written in Prettier's format (prompt 18).
const formatted = run("npx prettier --write AUDIT.md");
if (formatted.code !== 0) console.log(`prettier could not format AUDIT.md:\n${formatted.output}`);

console.log("\nProject      Result  Passed  Failed  Skipped");
for (const p of perProject) {
  console.log(
    `${p.project.padEnd(12)} ${p.status.toUpperCase().padEnd(6)}  ${String(p.passed).padStart(6)}  ${String(p.failed).padStart(6)}  ${String(p.skipped).padStart(7)}`,
  );
}
console.log(`\nOverall: ${overall.toUpperCase()}  (audit/report.json, AUDIT.md)`);
console.log(`Allowed canaries: ${ALLOWED_CANARIES.map((c) => c.file).join(", ")}`);
process.exitCode = overall === "pass" ? 0 : 1;
