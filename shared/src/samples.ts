// The bundled sample file (SPEC section 7, F14; A98). One file per sample in
// fixtures/samples/: the English result, its precomputed Hindi, and whether a
// native speaker has reviewed that Hindi. The server refuses to start if any
// file fails this schema.
import { z } from "zod";
import { analysisResultSchema, sampleSummarySchema, translationMapSchema } from "./schemas.js";
import { extractTranslatable } from "./translatable.js";

export const sampleFileSchema = z
  .strictObject({
    ...sampleSummarySchema.shape,
    /** False until a native speaker has checked the Hindi (docs/ASSUMPTIONS.md, Hindi review). */
    hiReviewed: z.boolean(),
    en: analysisResultSchema,
    hi: translationMapSchema,
  })
  .superRefine((file, ctx) => {
    // hi has exactly the translatable keys of en: none missing, none extra.
    const want = Object.keys(extractTranslatable(file.en));
    const have = new Set(Object.keys(file.hi));
    for (const key of want) {
      if (!have.has(key)) ctx.addIssue({ code: "custom", path: ["hi", key], message: "missing" });
      have.delete(key);
    }
    for (const key of have) {
      ctx.addIssue({ code: "custom", path: ["hi", key], message: "not a key of en" });
    }
    if (file.title !== file.en.title) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "differs from en.title" });
    }
    if (file.docType !== file.en.docType) {
      ctx.addIssue({ code: "custom", path: ["docType"], message: "differs from en.docType" });
    }
  });
export type SampleFile = z.infer<typeof sampleFileSchema>;
