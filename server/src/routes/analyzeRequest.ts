// Reads and validates the body of POST /api/analyze: a multipart PDF or JSON
// text. Every refusal is a PipelineError with the code to answer.
import {
  MAX_FILE_BYTES,
  analyzeTextRequestSchema,
  docTypeSchema,
  type DocType,
} from "@clauseclear/shared";
import express, { type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { PipelineError } from "../pipeline/errors.js";
import { checkPdfBytes, readPastedText } from "../pipeline/extract.js";
import type { AnalysisInput } from "../pipeline/run.js";

/**
 * Largest JSON body read. 60,000 characters of text, even fully escaped, fit;
 * a bigger body is TEXT_TOO_LONG without being parsed.
 */
export const JSON_BODY_LIMIT = "512kb";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 1, fieldSize: 64, parts: 2 },
}).single("file");
const json = express.json({ limit: JSON_BODY_LIMIT, strict: true });

/** Runs one Express middleware as a promise. */
function apply(handler: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    void handler(req, res, (error?: unknown) => {
      if (error === undefined) resolve();
      else
        reject(error instanceof Error ? error : new Error("middleware failed", { cause: error }));
    });
  });
}

function parseDocType(value: unknown): DocType | undefined {
  if (value === undefined) return undefined;
  const parsed = docTypeSchema.safeParse(value);
  if (!parsed.success) throw new PipelineError("BAD_REQUEST", "unknown docType");
  return parsed.data;
}

export interface ParsedRequest {
  input: AnalysisInput;
  docType: DocType | undefined;
}

/** Reads and validates the body. Throws PipelineError with the code to answer. */
export async function parseRequest(req: Request, res: Response): Promise<ParsedRequest> {
  if (typeof req.is("multipart/form-data") === "string") {
    try {
      await apply(upload, req, res);
    } catch (error) {
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        throw new PipelineError("FILE_TOO_LARGE");
      }
      throw new PipelineError("BAD_REQUEST", "unreadable multipart body");
    }
    const file = (req as Request & { file?: multer.File }).file;
    if (file?.buffer === undefined) throw new PipelineError("BAD_REQUEST", "no file field");
    const fields = (req.body ?? {}) as Record<string, unknown>;
    const docType = parseDocType(fields.docType);
    const bytes = new Uint8Array(
      file.buffer.buffer,
      file.buffer.byteOffset,
      file.buffer.byteLength,
    );
    checkPdfBytes(bytes);
    return { input: { kind: "pdf", bytes }, docType };
  }

  if (typeof req.is("application/json") === "string") {
    try {
      await apply(json, req, res);
    } catch (error) {
      const type = (error as { type?: unknown }).type;
      if (type === "entity.too.large") throw new PipelineError("TEXT_TOO_LONG");
      throw new PipelineError("BAD_REQUEST", "unreadable JSON body");
    }
    const parsed = analyzeTextRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new PipelineError("BAD_REQUEST", "body is not { text, docType? }");
    // The length, script and emptiness checks, before any stream starts.
    readPastedText(parsed.data.text);
    return { input: { kind: "text", text: parsed.data.text }, docType: parsed.data.docType };
  }

  throw new PipelineError(
    "BAD_REQUEST",
    "content type must be multipart/form-data or application/json",
  );
}
