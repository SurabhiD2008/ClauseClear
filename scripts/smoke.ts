// Smoke check of a running ClauseClear (prompt 20; A15, A181). Works against a
// local server and a deployed URL alike:
//   npm run smoke -- http://localhost:3000
//   npm run smoke -- https://clauseclear.onrender.com
//   npm run smoke -- <url> --analyze      also runs ONE real analysis
// Without a URL it uses SMOKE_URL, then http://localhost:3000.
// Without --analyze it makes no AI call: health, the landing page and one of its
// hashed scripts, a sample page, and GET /api/samples/rental. --analyze sends a
// short English lease (about 1 to 2 provider calls on a real deployment; free on
// the mock) and checks the result's quotes against its own segments.
// The first request gets 120 s, so a free host waking from sleep is not a failure;
// its time is printed. Exits 1 if any check fails.
import {
  analysisResultSchema,
  healthResponseSchema,
  sampleResponseSchema,
} from "@clauseclear/shared";

const args = process.argv.slice(2);
const analyze = args.includes("--analyze");
const base = (
  args.find((a) => !a.startsWith("--")) ??
  process.env.SMOKE_URL ??
  "http://localhost:3000"
).replace(/\/+$/, "");
const LEASE =
  "LEAVE AND LICENSE AGREEMENT FOR A FLAT IN PUNE\n\n" +
  "1. The licensee shall pay a monthly licence fee of Rs. 25,000 on the fifth day of each month.\n\n" +
  "2. The licensor may enter the premises at any time without notice to inspect them.\n\n" +
  "3. If the licensee leaves before the lock-in ends, the licensee shall forfeit the whole deposit.";

let failed = 0;
function report(ok: boolean, name: string, detail: string): void {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} ${detail}`);
}

async function get(path: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const started = performance.now();
  const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  return { response, body, ms: Math.round(performance.now() - started) };
}

async function check(name: string, run: () => Promise<[boolean, string]>): Promise<void> {
  try {
    const [ok, detail] = await run();
    report(ok, name, detail);
  } catch (error) {
    report(false, name, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  }
}

console.log(
  `Smoke check of ${base}${analyze ? " (with one analysis: real calls unless the host runs the mock)" : " (no AI calls)"}\n`,
);

await check("GET /api/health", async () => {
  const { response, body, ms } = await get("/api/health", {}, 120_000);
  const ok =
    response.status === 200 &&
    healthResponseSchema.safeParse(JSON.parse(body)).success &&
    (response.headers.get("cache-control") ?? "").includes("no-store");
  return [
    ok,
    `${String(response.status)} ${body} in ${String(ms)} ms, cache-control ${String(response.headers.get("cache-control"))}`,
  ];
});

let script: string | undefined;
await check("GET / (landing page)", async () => {
  const { response, body, ms } = await get("/", { headers: { "accept-encoding": "br, gzip" } });
  script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(body)?.[1];
  const csp = response.headers.get("content-security-policy") ?? "";
  const ok =
    response.status === 200 &&
    body.includes('id="root"') &&
    script !== undefined &&
    csp.includes("default-src 'self'");
  return [
    ok,
    `${String(response.status)} in ${String(ms)} ms, ${String(body.length)} chars, script ${String(script)}, CSP ${csp === "" ? "missing" : "set"}, encoding ${String(response.headers.get("content-encoding"))}`,
  ];
});

await check("GET hashed script", async () => {
  if (script === undefined) return [false, "no script found on the landing page"];
  const { response, ms } = await get(script, { headers: { "accept-encoding": "br, gzip" } });
  const cache = response.headers.get("cache-control") ?? "";
  const ok = response.status === 200 && cache.includes("immutable");
  return [
    ok,
    `${String(response.status)} in ${String(ms)} ms, encoding ${String(response.headers.get("content-encoding"))}, cache-control ${cache}`,
  ];
});

await check("GET /results/sample/rental", async () => {
  const { response, body, ms } = await get("/results/sample/rental");
  const ok = response.status === 200 && body.includes('id="root"');
  return [
    ok,
    `${String(response.status)} in ${String(ms)} ms (the app shell; the page renders the sample)`,
  ];
});

await check("GET /api/samples/rental", async () => {
  const { response, body, ms } = await get("/api/samples/rental");
  const parsed = sampleResponseSchema.safeParse(JSON.parse(body));
  if (!parsed.success)
    return [false, `${String(response.status)}, response does not match the schema`];
  const { en, hi } = parsed.data;
  return [
    response.status === 200,
    `${String(response.status)} in ${String(ms)} ms, ${en.docType}, score ${String(en.score.value)} ${en.score.band}, ${String(en.flags.length)} flags, ${String(Object.keys(hi).length)} Hindi strings`,
  ];
});

if (analyze) {
  await check("POST /api/analyze (one run)", async () => {
    const { response, body, ms } = await get(
      "/api/analyze?stream=0",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: LEASE }),
      },
      150_000,
    );
    if (response.status !== 200)
      return [false, `${String(response.status)} in ${String(ms)} ms: ${body.slice(0, 200)}`];
    const parsed = analysisResultSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return [false, "result does not match the schema"];
    const r = parsed.data;
    const segments = new Map(r.segments.map((s) => [s.id, s.text]));
    const present = r.flags.filter((f) => f.kind === "present");
    const verified = present.filter(
      (f) => segments.get(f.segmentId ?? "")?.includes(f.quote ?? "") === true,
    );
    return [
      verified.length === present.length,
      `200 in ${String(ms)} ms, ${r.docType}, score ${String(r.score.value)} ${r.score.band}, ${String(r.flags.length)} flags, ${String(verified.length)}/${String(present.length)} quotes found in their segments`,
    ];
  });
}

console.log(
  `\n${failed === 0 ? "Smoke check passed" : `Smoke check FAILED: ${String(failed)} check(s)`}`,
);
process.exitCode = failed === 0 ? 0 : 1;
