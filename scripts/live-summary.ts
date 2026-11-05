// npm run live:summary -- [log file]: recomputes the results table and the
// percentage of flags kept per document from a live run log (default: the
// newest docs/evidence/live-run-*.json).
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatTable, keptPercent, summarize, type LiveLog } from "./live-log.js";

const dir = join("docs", "evidence");
const file =
  process.argv[2] ??
  join(
    dir,
    (await readdir(dir))
      .filter((n) => /^live-run-.*\.json$/.test(n))
      .sort()
      .pop() ?? "",
  );
const log = JSON.parse(await readFile(file, "utf8")) as LiveLog;

console.log(`${file} (prompt ${log.promptVersion}, order ${log.providerOrder.join(" > ")})`);
console.log(formatTable(summarize(log)));
for (const doc of log.documents) {
  const attempts = doc.attempts ?? [];
  const pcts = attempts.map(
    (a, i) => `attempt ${String(i + 1)}: ${keptPercent(a.stats).toFixed(1)}%`,
  );
  console.log(`${doc.fixture}: kept ${pcts.length === 0 ? "n/a (no result)" : pcts.join(", ")}`);
}
console.log(`calls made ${String(log.callsMade)} of ${String(log.callBudget)}`);
