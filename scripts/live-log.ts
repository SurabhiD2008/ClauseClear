// The live run log (prompt 8, A91): its shape, and the summary table computed
// from it. Holds ids, categories, numbers and provider names, never text.
import type { Confidence, DocType, ScoreBand, Warning } from "@clauseclear/shared";
import type { LlmLogEntry } from "../server/src/llm/router.js";
import type { FlagOutcome, VerificationStats } from "../server/src/pipeline/verify.js";

export type CallEntry = Extract<LlmLogEntry, { event: "llm_call" }>;

export interface LiveDocument {
  fixture: string;
  ok: boolean;
  /** The ErrorCode when the run failed. */
  error?: string;
  docType?: DocType;
  docTypeConfidence?: Confidence;
  path?: "single" | "chunked" | "small-chunks";
  pages?: number;
  segments?: number;
  ms: number;
  calls: CallEntry[];
  exhausted: Extract<LlmLogEntry, { event: "llm_exhausted" }>[];
  attempts?: { stats: VerificationStats; outcomes: FlagOutcome[] }[];
  score?: { value: number; band: ScoreBand; high: number; medium: number; missing: number };
  warnings?: Warning[];
  keyFacts?: number;
  questions?: number;
  glossary?: number;
}

export interface LiveLog {
  startedAt: string;
  promptVersion: string;
  providerOrder: string[];
  models: Record<string, string>;
  /** In-memory key overrides for the fallback test (names only). */
  invalidKeys: string[];
  callBudget: number;
  callsMade: number;
  callsBlockedByBudget: number;
  documents: LiveDocument[];
}

export interface SummaryRow {
  fixture: string;
  result: string;
  providers: string;
  calls: number;
  proposed: number;
  kept: number;
  repaired: number;
  dropped: number;
  keptPct: string;
  retried: string;
  score: string;
}

/** Share of proposed present flags that survived verification, in the final attempt. */
export function keptPercent(stats: VerificationStats): number {
  if (stats.checked === 0) return 0;
  return (100 * (stats.exact + stats.repaired)) / stats.checked;
}

export function summarize(log: LiveLog): SummaryRow[] {
  return log.documents.map((doc) => {
    const final = doc.attempts?.[doc.attempts.length - 1]?.stats;
    const used = [
      ...new Set(
        doc.calls.filter((c) => c.outcome === "ok").map((c) => `${c.provider}/${c.model}`),
      ),
    ];
    return {
      fixture: doc.fixture,
      result: doc.ok ? "verified" : `FAILED ${doc.error ?? ""}`.trim(),
      providers: used.join(", ") || "-",
      calls: doc.calls.length,
      proposed: final?.checked ?? 0,
      kept: final?.exact ?? 0,
      repaired: final?.repaired ?? 0,
      dropped: final?.dropped ?? 0,
      keptPct: final === undefined ? "-" : `${keptPercent(final).toFixed(1)}%`,
      retried: (doc.attempts?.length ?? 0) > 1 ? "yes" : "no",
      score: doc.score === undefined ? "-" : `${String(doc.score.value)} ${doc.score.band}`,
    };
  });
}

export function formatTable(rows: SummaryRow[]): string {
  const headers: [keyof SummaryRow, string][] = [
    ["fixture", "Document"],
    ["result", "Result"],
    ["providers", "Provider/model"],
    ["calls", "Calls"],
    ["proposed", "Flags proposed"],
    ["kept", "Kept exact"],
    ["repaired", "Repaired"],
    ["dropped", "Dropped"],
    ["keptPct", "Kept %"],
    ["retried", "Retry"],
    ["score", "Score"],
  ];
  const lines = [
    `| ${headers.map(([, h]) => h).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${headers.map(([k]) => String(r[k])).join(" | ")} |`),
  ];
  return lines.join("\n");
}
