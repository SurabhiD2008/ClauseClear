// The shape of a risk checklist (SPEC section 8). The lists themselves are data
// in server/src/checklists/, one file per document type; this schema is the
// contract each file is tested against.
import { z } from "zod";
import { EXPLANATION_MAX_CHARS, TITLE_MAX_CHARS } from "./constants.js";
import { docTypeSchema, severitySchema } from "./schemas.js";

/** Category and basic ids are kebab-case and stable: prompts, merges and tests key on them. */
const checklistIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);

export const checklistCategorySchema = z.strictObject({
  id: checklistIdSchema,
  /** The category name from SPEC section 8; it becomes `flag.category` in the result. */
  name: z.string().min(1).max(TITLE_MAX_CHARS),
  /** When the model should raise a flag in this category. */
  flagWhen: z.string().min(1).max(EXPLANATION_MAX_CHARS),
  /** Default severity; the model may move it one level with a stated reason. */
  severity: severitySchema,
});

/** Something the document should state. When absent it becomes a "missing" flag. */
export const missingBasicSchema = z.strictObject({
  id: checklistIdSchema,
  name: z.string().min(1).max(TITLE_MAX_CHARS),
  severity: severitySchema,
  /** The category the missing flag is filed under. */
  categoryId: checklistIdSchema,
});

export const checklistSchema = z
  .strictObject({
    docType: docTypeSchema,
    /** Shown as docTypeLabel, e.g. "Rental agreement". */
    label: z.string().min(1).max(TITLE_MAX_CHARS),
    categories: z.array(checklistCategorySchema).min(1),
    missingBasics: z.array(missingBasicSchema).min(1),
  })
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    list.categories.forEach((category, i) => {
      if (ids.has(category.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate category id "${category.id}"`,
          path: ["categories", i, "id"],
        });
      }
      if (names.has(category.name)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate category name`,
          path: ["categories", i, "name"],
        });
      }
      ids.add(category.id);
      names.add(category.name);
    });
    const basics = new Set<string>();
    list.missingBasics.forEach((basic, i) => {
      if (basics.has(basic.id) || ids.has(basic.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate id "${basic.id}"`,
          path: ["missingBasics", i, "id"],
        });
      }
      basics.add(basic.id);
      if (!ids.has(basic.categoryId)) {
        ctx.addIssue({
          code: "custom",
          message: `unknown categoryId "${basic.categoryId}"`,
          path: ["missingBasics", i, "categoryId"],
        });
      }
    });
  });

export type ChecklistCategory = z.infer<typeof checklistCategorySchema>;
export type MissingBasic = z.infer<typeof missingBasicSchema>;
export type Checklist = z.infer<typeof checklistSchema>;
