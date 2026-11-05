// Turns raw model text into a validated value (SPEC section 5 rule 6). Provider
// JSON mode is never trusted on its own: text is fence-stripped, parsed and
// checked with zod. Malformed or truncated JSON is a plain BadOutputError (the
// router moves to the next provider). JSON that parses but fails the schema
// carries a repairHint, and the router asks the same provider once more.
import { SCHEMA_REPAIR_RETRIES } from "@clauseclear/shared";
import type { z } from "zod";
import { BadOutputError, type GenerateJsonRequest } from "./provider.js";

/** How the router turns text into a value. parse throws BadOutputError on failure. */
export interface OutputSpec<T> {
  parse(provider: string, text: string): T;
  /** How many repair calls a schema failure may trigger on the same provider. */
  repairRetries: number;
}

const MAX_HINT_ISSUES = 10;

/** Strips ``` fences and surrounding prose, then parses. */
export function extractJson(provider: string, text: string): unknown {
  let body = text.trim();
  const fenced = /^```[a-zA-Z0-9]*\s*\n?([\s\S]*?)\n?```\s*$/.exec(body);
  if (fenced?.[1] !== undefined) body = fenced[1].trim();

  // Models sometimes add a sentence before or after the JSON. Take the span from
  // the first opening bracket to the last matching closing one.
  const first = body.search(/[[{]/);
  if (first === -1) throw new BadOutputError(provider, "malformed");
  const close = body[first] === "{" ? "}" : "]";
  const last = body.lastIndexOf(close);
  if (last < first) throw new BadOutputError(provider, "malformed");

  try {
    return JSON.parse(body.slice(first, last + 1)) as unknown;
  } catch {
    throw new BadOutputError(provider, "malformed");
  }
}

/** Schema issues as "path: message" lines. zod messages name rules, not input values. */
export function summarizeIssues(error: z.ZodError): string {
  const lines = error.issues.slice(0, MAX_HINT_ISSUES).map((issue) => {
    const path = issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
    return `- ${path}: ${issue.message}`;
  });
  const more = error.issues.length - MAX_HINT_ISSUES;
  if (more > 0) lines.push(`- and ${String(more)} more`);
  return lines.join("\n");
}

export function zodOutput<T>(schema: z.ZodType<T>): OutputSpec<T> {
  return {
    repairRetries: SCHEMA_REPAIR_RETRIES,
    parse(provider, text) {
      const data = extractJson(provider, text);
      const result = schema.safeParse(data);
      if (result.success) return result.data;
      throw new BadOutputError(provider, "schema", summarizeIssues(result.error));
    },
  };
}

/** The repair call: the original request plus the validation errors. */
export function repairRequest(
  request: Omit<GenerateJsonRequest, "signal">,
  hint: string,
): Omit<GenerateJsonRequest, "signal"> {
  return {
    ...request,
    user: `${request.user}\n\nYour previous reply was JSON but did not match the required schema:\n${hint}\nReply again with only the corrected JSON.`,
  };
}
