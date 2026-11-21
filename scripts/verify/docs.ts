// Docs consistency: README commands exist as scripts, the variable lists in the
// configuration schema, .env.example and the README agree, relative links
// resolve, and every number the README quotes is either produced from the code
// here or listed as an outside fact with its source.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_VARIABLES } from "../../server/src/configSchema.js";
import { readmeFacts, OUTSIDE_FACTS } from "./readmeFacts.js";
import { trackedFiles } from "./files.js";

function commandProblems(readme: string, scripts: Record<string, string>): string[] {
  const out: string[] = [];
  for (const m of readme.matchAll(/\bnpm (?:run ([a-z][\w:-]*)|(start|test)\b)/g)) {
    const name = m[1] ?? m[2] ?? "";
    if (scripts[name] === undefined)
      out.push(
        `README uses "npm ${m[1] === undefined ? "" : "run "}${name}", which is not a script`,
      );
  }
  return out;
}

/** Rows of the markdown table that follows a heading, as [name, default] pairs. */
function tableUnder(readme: string, heading: string): Map<string, string> {
  const start = readme.indexOf(`\n${heading}\n`);
  if (start < 0) return new Map();
  const rows = new Map<string, string>();
  const lines = readme.slice(start + heading.length + 2).split("\n");
  let inTable = false;
  for (const line of lines) {
    if (line.startsWith("#")) break;
    if (!line.startsWith("|")) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = line.split("|").map((c) => c.trim());
    const name = /^`([A-Z][A-Z0-9_]*)`$/.exec(cells[1] ?? "")?.[1];
    if (name !== undefined) rows.set(name, (cells[2] ?? "").replace(/^`|`$/g, ""));
  }
  return rows;
}

function envExample(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^(?:# )?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m?.[1] !== undefined) vars.set(m[1], m[2] ?? "");
  }
  return vars;
}

function variableProblems(readme: string, example: string): string[] {
  const out: string[] = [];
  const envVars = envExample(example);
  for (const scope of ["app", "tooling"] as const) {
    const heading = scope === "app" ? "## Environment variables" : "### Test and tooling variables";
    const table = tableUnder(readme, heading);
    const schema = CONFIG_VARIABLES.filter((v) => v.scope === scope);
    for (const v of schema) {
      if (!table.has(v.name))
        out.push(`${v.name} is in the schema but not in the README table "${heading}"`);
      else if (table.get(v.name) !== v.default)
        out.push(
          `${v.name}: README default "${table.get(v.name) ?? ""}" but the schema says "${v.default}"`,
        );
      if (!envVars.has(v.name)) out.push(`${v.name} is in the schema but not in .env.example`);
      else if (envVars.get(v.name) !== (v.example ?? v.default) && envVars.get(v.name) !== "")
        out.push(
          `${v.name}: .env.example has "${envVars.get(v.name) ?? ""}", expected "${v.example ?? v.default}"`,
        );
    }
    for (const name of table.keys())
      if (!schema.some((v) => v.name === name))
        out.push(`${name} is in the README table "${heading}" but not in the schema`);
  }
  for (const name of envVars.keys())
    if (!CONFIG_VARIABLES.some((v) => v.name === name))
      out.push(`${name} is in .env.example but not in the schema`);
  return out;
}

function linkProblems(root: string): string[] {
  const out: string[] = [];
  for (const file of trackedFiles(root).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(path.join(root, file), "utf8");
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = (m[1] ?? "").split("#")[0] ?? "";
      if (target === "" || /^[a-z]+:/.test(target)) continue;
      if (!existsSync(path.join(root, path.dirname(file), target)))
        out.push(`${file}: broken link ${target}`);
    }
  }
  return out;
}

/** Every digit left after removing checked facts, outside facts, code, links and the env tables. */
function numberProblems(root: string, readme: string): string[] {
  const out: string[] = [];
  let rest = readme
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\]\([^)]*\)/g, "]")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\d+\. /gm, "")
    // "e2e" and "i18n" are names, not numbers.
    .replace(/\b(e2e|i18n)\b/g, "");
  for (const heading of ["## Environment variables", "### Test and tooling variables"]) {
    for (const name of tableUnder(readme, heading).keys())
      rest = rest.replace(new RegExp(`^\\| \`${name}\`.*$`, "m"), "");
  }
  for (const fact of readmeFacts(root)) {
    if (!readme.includes(fact.text)) out.push(`README should say "${fact.text}" (${fact.source})`);
    rest = rest.split(fact.text).join("");
  }
  for (const fact of OUTSIDE_FACTS) {
    if (!readme.includes(fact.text))
      out.push(`outside fact "${fact.text}" is no longer in the README; remove it`);
    rest = rest.split(fact.text).join("");
  }
  for (const line of rest.split("\n")) {
    const m = /\d/.exec(line);
    if (m) out.push(`unchecked number in README: "${line.trim().slice(0, 120)}"`);
  }
  return out;
}

export function checkDocs(root: string): string[] {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  const example = readFileSync(path.join(root, ".env.example"), "utf8");
  const scripts = (
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;
  return [
    ...commandProblems(readme, scripts),
    ...variableProblems(readme, example),
    ...linkProblems(root),
    ...numberProblems(root, readme),
  ];
}
