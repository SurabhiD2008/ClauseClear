// Placeholder for scripts that later prompts build. Exits non-zero so it is
// never mistaken for a passing check.
const name = process.argv[2] ?? "this script";
console.error(`${name}: not implemented yet`);
process.exit(1);
