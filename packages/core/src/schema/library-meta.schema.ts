import { z } from "zod";

export const libraryPartStatusSchema = z.enum(["published"]);

export const libraryMetaSchema = z
  .object({
    schema: z.literal("loomit.library_meta.v0"),
    name: z.string().min(1),
    type: z.string().min(1),
    source_project: z.string().min(1).optional(),
    source_part: z.string().min(1).optional(),
    published_at: z.string().min(1),
    status: libraryPartStatusSchema
  })
  .strict();

export type LibraryMeta = z.infer<typeof libraryMetaSchema>;
export type LibraryPartStatus = z.infer<typeof libraryPartStatusSchema>;
