// Dependency check: every package a workspace imports is declared, and every
// declared package is used. Packages that are only run as command-line tools
// count as used when a package.json script or config file names them.
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { trackedFiles } from "./files.js";

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[];
}

/** Command-line tools and type packages, with the text that proves each is used. */
const TOOL_EVIDENCE: Record<string, RegExp> = {
  typescript: /\btsc\b/,
  prettier: /\bprettier\b/,
  eslint: /\beslint\b/,
  tsx: /\btsx\b/,
  concurrently: /\bconcurrently\b/,
  vite: /\bvite\b/,
  vitest: /\bvitest\b/,
  "@playwright/test": /\bplaywright\b/,
  "@vitest/coverage-v8": /coverage/,
  supertest: /supertest/,
};

// Import, re-export, dynamic import, require and require.resolve, at the start of
// a statement so prose in comments is not mistaken for an import.
const IMPORT =
  /(?:^\s*(?:import|export)\b[^'"\n]*?\bfrom\s+|^\s*\}\s*from\s+|^\s*import\s+|\bimport\s*\(\s*|\brequire\(\s*|\.resolve\(\s*)["']([^"'./][^"']*)["']/gm;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0] ?? ""}/${parts[1] ?? ""}` : (parts[0] ?? "");
}

function readManifest(root: string, dir: string): Manifest {
  return JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")) as Manifest;
}

export interface DepsResult {
  missing: string[];
  unused: string[];
}

export function checkDependencies(root: string): DepsResult {
  const rootManifest = readManifest(root, ".");
  const workspaces = rootManifest.workspaces ?? [];
  const files = trackedFiles(root).filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f));
  const owner = (file: string) => workspaces.find((w) => file.startsWith(`${w}/`)) ?? ".";
  // Workspace packages are part of this repository and resolve from anywhere in it.
  const workspaceNames = workspaces.map(
    (w) =>
      (JSON.parse(readFileSync(path.join(root, w, "package.json"), "utf8")) as { name: string })
        .name,
  );
  const rootDeclared = new Set([
    ...Object.keys({ ...rootManifest.dependencies, ...rootManifest.devDependencies }),
    ...workspaceNames,
  ]);
  const used = new Map<string, Set<string>>();
  const missing: string[] = [];

  for (const file of files) {
    const ws = owner(file);
    const manifest = ws === "." ? rootManifest : readManifest(root, ws);
    const declared = new Set(
      Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
    );
    const text = readFileSync(path.join(root, file), "utf8");
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] ?? "";
      if (BUILTINS.has(spec) || BUILTINS.has(spec.split("/")[0] ?? "")) continue;
      const name = packageName(spec);
      if (name.startsWith("virtual:")) continue;
      if (!declared.has(name) && !rootDeclared.has(name)) missing.push(`${file}: ${name}`);
      const key = declared.has(name) ? ws : ".";
      if (!used.has(key)) used.set(key, new Set());
      used.get(key)?.add(name);
    }
  }

  const evidence = [
    JSON.stringify(rootManifest.scripts ?? {}),
    ...workspaces.map((w) => JSON.stringify(readManifest(root, w).scripts ?? {})),
    ...files
      .filter((f) => /config\.(ts|js|mjs)$/.test(f))
      .map((f) => readFileSync(path.join(root, f), "utf8")),
  ].join("\n");

  const unused: string[] = [];
  for (const ws of [".", ...workspaces]) {
    const manifest = ws === "." ? rootManifest : readManifest(root, ws);
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (used.get(ws)?.has(name)) continue;
      if (name.startsWith("@types/")) continue;
      const tool = TOOL_EVIDENCE[name];
      if (tool?.test(evidence) === true) continue;
      unused.push(`${ws === "." ? "root" : ws}: ${name}`);
    }
  }
  return { missing: [...new Set(missing)], unused };
}
