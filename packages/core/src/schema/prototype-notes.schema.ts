import { z } from "zod";

const nonEmptyStringSchema = z.string().min(1);

const leftoverFabricSchema = z
  .object({
    reusable_for: z.array(nonEmptyStringSchema).optional(),
    remaining_size: nonEmptyStringSchema.optional()
  })
  .strict()
  .refine(
    (leftoverFabric) =>
      leftoverFabric.reusable_for !== undefined || leftoverFabric.remaining_size !== undefined,
    {
      message: "leftover_fabric must describe reusable_for or remaining_size"
    }
  );

const prototypeNoteSchema = z
  .object({
    id: nonEmptyStringSchema,
    date: nonEmptyStringSchema,
    result: nonEmptyStringSchema,
    issue: nonEmptyStringSchema,
    observation: z.array(nonEmptyStringSchema).optional(),
    suggested_change: z.array(nonEmptyStringSchema).optional(),
    creates_test_case: nonEmptyStringSchema.optional(),
    applies_to: z.array(nonEmptyStringSchema).min(1).optional(),
    leftover_fabric: leftoverFabricSchema.optional()
  })
  .strict()
  .refine(
    (note) =>
      (note.creates_test_case === undefined && note.applies_to === undefined) ||
      (note.creates_test_case !== undefined && note.applies_to !== undefined),
    {
      message: "creates_test_case and applies_to must be provided together"
    }
  );

export const prototypeNotesSchema = z
  .object({
    schema: z.literal("loomit.prototype_notes.v0"),
    notes: z.array(prototypeNoteSchema)
  })
  .strict();

export type PrototypeNote = z.infer<typeof prototypeNoteSchema>;
export type PrototypeNotes = z.infer<typeof prototypeNotesSchema>;
