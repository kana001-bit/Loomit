import { z } from "zod";

const relativePathSchema = z.string().min(1);
const projectPartRoleSchema = z.string().min(1);

export const projectSchema = z
  .object({
    schema: z.literal("loomit.project.v0"),
    name: z.string().min(1),
    garment: z.string().min(1),
    parts: z.record(projectPartRoleSchema, relativePathSchema),
    profiles: z.record(z.string().min(1), relativePathSchema).optional(),
    test_suite: z
      .object({
        required: z.array(z.string().min(1)).optional(),
        ignored: z
          .record(
            z.string().min(1),
            z.object({
              reason: z.string().min(1)
            })
          )
          .optional()
      })
      .strict()
      .optional(),
    outputs: z
      .object({
        dir: relativePathSchema
      })
      .strict()
      .optional()
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
