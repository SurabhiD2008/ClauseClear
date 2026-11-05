import type { StatusEvent } from "@clauseclear/shared";
import { describe, expect, it } from "vitest";
import { checklistFor } from "../checklists/index.js";
import { analyzeDocument } from "./analyze.js";
import { PipelineError } from "./errors.js";
import { fixtureSegments, recordingRouter } from "./testing/harness.js";

const rental = checklistFor("rental");
/** Low enough that the rental fixture (about 1,400 tokens of segments) must be chunked. */
const SMALL_INPUT = 2_400;
const SMALL_CHUNK = 450;

describe("single-call path", () => {
  it("analyses the rental fixture in one call through the router", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter();
    const events: StatusEvent[] = [];
    const { draft, detection } = await analyzeDocument({
      router,
      segments,
      pages,
      maxInputTokens: 24_000,
      onProgress: (event) => events.push(event),
    });

    expect(detection).toMatchObject({ docType: "rental", method: "keywords" });
    expect(requests.map((r) => r.schemaName)).toEqual(["analysis"]);
    expect(draft).toMatchObject({
      path: "single",
      calls: 1,
      docType: "rental",
      docTypeLabel: "Rental agreement",
    });
    expect(events.map((e) => e.step)).toEqual(["detecting", "analyzing"]);

    // Every flag has a final id, a checklist category and, when present, a real segment.
    const ids = new Set(segments.map((s) => s.id));
    expect(draft.flags.map((f) => f.id)).toEqual(draft.flags.map((_, i) => `f${String(i + 1)}`));
    for (const flag of draft.flags) {
      expect(rental.categories.map((c) => c.id)).toContain(flag.categoryId);
      if (flag.kind === "present") expect(ids.has(flag.segmentId ?? "")).toBe(true);
    }
    expect(draft.flags.filter((f) => f.kind === "present").length).toBeGreaterThan(3);
    // The rental fixture leaves out stamp duty on purpose.
    expect(draft.flags.find((f) => f.kind === "missing")?.categoryId).toBe("stamp-duty");
    expect(Object.keys(draft.coverage).sort()).toEqual(rental.categories.map((c) => c.id).sort());

    const flagIds = new Set(draft.flags.map((f) => f.id));
    for (const q of draft.questions) for (const id of q.flagIds) expect(flagIds.has(id)).toBe(true);
    for (const c of draft.clauses)
      if (c.flagId !== undefined) expect(flagIds.has(c.flagId)).toBe(true);
  });

  it("returns NOT_LEGAL when the model says the text is not a legal document", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router } = recordingRouter({ scenario: "not_legal" });
    const error = await analyzeDocument({ router, segments, pages, maxInputTokens: 24_000 }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe("NOT_LEGAL");
  });
});

describe("chunked path", () => {
  it("splits at segment boundaries, runs two chunks in parallel, then one synthesis call", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests, peakInFlight } = recordingRouter({ delayMs: 30 });
    const events: StatusEvent[] = [];
    const { draft } = await analyzeDocument({
      router,
      segments,
      pages,
      maxInputTokens: SMALL_INPUT,
      chunkTargetTokens: SMALL_CHUNK,
      onProgress: (event) => events.push(event),
    });

    const chunkCalls = requests.filter((r) => r.schemaName === "chunk");
    expect(chunkCalls.length).toBeGreaterThanOrEqual(3);
    expect(requests.at(-1)?.schemaName).toBe("synthesis");
    expect(requests).toHaveLength(chunkCalls.length + 1);
    expect(peakInFlight()).toBe(2);
    expect(draft).toMatchObject({ path: "chunked", calls: chunkCalls.length + 1 });

    // Every segment went to exactly one chunk, in order.
    const sent = chunkCalls.flatMap((r) => [...r.user.matchAll(/^\[(s\d+)\] /gm)].map((m) => m[1]));
    expect([...sent].sort((a, b) => Number(a?.slice(1)) - Number(b?.slice(1)))).toEqual(
      segments.map((s) => s.id),
    );

    // No segment and category pair is flagged twice.
    const keys = draft.flags
      .filter((f) => f.kind === "present")
      .map((f) => `${String(f.segmentId)}|${f.categoryId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(draft.flags.find((f) => f.kind === "missing")?.categoryId).toBe("stamp-duty");

    const details = events.map((e) => e.detail ?? "");
    expect(details).toContain(
      `read part ${String(chunkCalls.length)} of ${String(chunkCalls.length)}`,
    );
    expect(details.at(-1)).toBe("writing the summary");
  });

  it("finds the same risky terms as the single-call path", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const single = await analyzeDocument({
      router: recordingRouter().router,
      segments,
      pages,
      maxInputTokens: 24_000,
    });
    const chunked = await analyzeDocument({
      router: recordingRouter().router,
      segments,
      pages,
      maxInputTokens: SMALL_INPUT,
      chunkTargetTokens: SMALL_CHUNK,
    });
    const present = (d: typeof single.draft) =>
      d.flags.filter((f) => f.kind === "present").map((f) => [f.segmentId, f.categoryId, f.quote]);
    expect(present(chunked.draft)).toEqual(present(single.draft));
  });

  it("the synthesis call receives only the flags, key-fact candidates and uncovered categories", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter();
    const { draft } = await analyzeDocument({
      router,
      segments,
      pages,
      maxInputTokens: SMALL_INPUT,
      chunkTargetTokens: SMALL_CHUNK,
    });
    const synthesis = requests.find((r) => r.schemaName === "synthesis");
    if (synthesis === undefined) throw new Error("no synthesis call");

    // No document block and no segment lines.
    expect(synthesis.user).not.toContain("BEGIN DOCUMENT");
    expect(synthesis.user).not.toMatch(/^\[s\d+\] /m);
    expect(synthesis.system).not.toContain("BEGIN DOCUMENT");
    // Text that is in the document but in no flag never reaches it.
    expect(synthesis.user).not.toContain("Two ceiling fans");
    expect(synthesis.user).not.toContain("Arvind Kelkar");

    const block = (name: string): unknown => {
      const match = new RegExp(
        `=====BEGIN ${name} ([0-9a-f]{8})=====\\n(.*)\\n=====END ${name} \\1=====`,
      ).exec(synthesis.user);
      return JSON.parse(match?.[2] ?? "null");
    };
    const flags = block("FLAGS") as { id: string; quote: string }[];
    const present = draft.flags.filter((f) => f.kind === "present");
    expect(flags.map((f) => f.id)).toEqual(present.map((f) => f.id));
    expect(flags.map((f) => Object.keys(f).sort())).toEqual(
      flags.map(() => ["category", "id", "plain", "quote", "severity", "title"]),
    );
    const uncovered = block("UNCOVERED CATEGORIES") as { categoryId: string }[];
    const expectedUncovered = rental.categories
      .filter((c) => draft.coverage[c.id] === "absent")
      .map((c) => c.id);
    expect(uncovered.map((u) => u.categoryId)).toEqual(expectedUncovered);
    expect(uncovered.map((u) => u.categoryId)).toContain("stamp-duty");
    expect(block("MISSING BASICS TO CHECK")).toEqual([
      { basicId: "stamp-duty-registration", name: "Stamp duty and registration" },
    ]);
    expect(Array.isArray(block("KEY FACT CANDIDATES"))).toBe(true);
  });

  it("returns NOT_LEGAL only when every part says so", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router } = recordingRouter({ scenario: "not_legal" });
    const error = await analyzeDocument({
      router,
      segments,
      pages,
      docType: "rental",
      maxInputTokens: SMALL_INPUT,
      chunkTargetTokens: SMALL_CHUNK,
    }).catch((e: unknown) => e);
    expect((error as PipelineError).code).toBe("NOT_LEGAL");

    let first = true;
    const partial = recordingRouter({
      override: (request) => {
        if (request.schemaName !== "chunk" || !first) return undefined;
        first = false;
        return JSON.stringify({ notLegal: true });
      },
    });
    const { draft } = await analyzeDocument({
      router: partial.router,
      segments,
      pages,
      maxInputTokens: SMALL_INPUT,
      chunkTargetTokens: SMALL_CHUNK,
    });
    expect(draft.path).toBe("chunked");
  });
});

describe("small parts for a capped provider (A95)", () => {
  const CAP = 3_072;

  it("reads again in parts whose calls all fit the cap when the uncapped provider fails", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter({ cappedFallback: CAP });
    const events: StatusEvent[] = [];
    const { draft } = await analyzeDocument({
      router,
      segments,
      pages,
      maxInputTokens: 24_000,
      onProgress: (event) => events.push(event),
    });

    // The mock never sees the single 16,384-token call; only the small parts and synthesis.
    expect(requests.map((r) => r.schemaName)).not.toContain("analysis");
    expect(requests.every((r) => r.maxOutputTokens <= CAP)).toBe(true);
    const chunkCalls = requests.filter((r) => r.schemaName === "chunk");
    expect(chunkCalls.length).toBeGreaterThanOrEqual(2);
    expect(requests.filter((r) => r.schemaName === "synthesis")).toHaveLength(1);
    expect(draft).toMatchObject({ path: "small-chunks", calls: chunkCalls.length + 1 });
    expect(draft.flags.filter((f) => f.kind === "present").length).toBeGreaterThan(3);
    expect(events.map((e) => e.detail)).toContain("reading again in smaller parts");
  });

  it("does not retry when no provider is capped", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter({
      override: (r) => (r.schemaName === "analysis" ? "not json" : undefined),
    });
    await expect(
      analyzeDocument({ router, segments, pages, maxInputTokens: 24_000 }),
    ).rejects.toMatchObject({ code: "ANALYSIS_FAILED" });
    expect(requests.every((r) => r.schemaName !== "chunk")).toBe(true);
  });
});

describe("abort", () => {
  it("stops the single-call path mid-run", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter({ scenario: "slow", slowMs: 5_000 });
    const controller = new AbortController();
    const pending = analyzeDocument({
      router,
      segments,
      pages,
      maxInputTokens: 24_000,
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort(new Error("client went away"));
    }, 50);
    const started = Date.now();
    await expect(pending).rejects.toThrow("client went away");
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(requests).toHaveLength(1);
  });

  it("stops both chunk lanes and starts no further calls", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter({ scenario: "slow", slowMs: 5_000 });
    const controller = new AbortController();
    const pending = analyzeDocument({
      router,
      segments,
      pages,
      maxInputTokens: SMALL_INPUT,
      chunkTargetTokens: SMALL_CHUNK,
      signal: controller.signal,
    });
    setTimeout(() => {
      controller.abort(new Error("client went away"));
    }, 50);
    await expect(pending).rejects.toThrow("client went away");
    // Two lanes were in flight; nothing else started, and no synthesis call.
    expect(requests.map((r) => r.schemaName)).toEqual(["chunk", "chunk"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toHaveLength(2);
  });

  it("does nothing when already aborted", async () => {
    const { segments, pages } = await fixtureSegments("rental.pdf");
    const { router, requests } = recordingRouter();
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await expect(
      analyzeDocument({
        router,
        segments,
        pages,
        maxInputTokens: 24_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("gone");
    expect(requests).toHaveLength(0);
  });
});
