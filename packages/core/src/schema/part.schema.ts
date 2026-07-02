import { z } from "zod";

export const partStatusSchema = z.enum(["active", "deprecated"]);

const finishedMeasurementSchema = z.number().finite().nonnegative();

const connectorRangeSchema = z
  .object({
    id: z.string().min(1),
    from: z.number().finite().min(0).max(1),
    to: z.number().finite().min(0).max(1),
    behavior: z.string().min(1),
    allowance_mm: z.number().finite().nonnegative().optional()
  })
  .strict()
  .refine((range) => range.from <= range.to, {
    message: "connector range start must be less than or equal to end"
  });

export const connectorSchema = z
  .object({
    type: z.string().min(1),
    // Design decision: length_mm is the finished seam-line length, not a cutting length with seam allowance.
    length_mm: z.number().finite().nonnegative(),
    tolerance_mm: z.number().finite().nonnegative().optional(),
    path_ref: z.string().min(1).optional(),
    ranges: z.array(connectorRangeSchema).optional()
  })
  .strict();

const scalarRequirementValueSchema = z.union([z.string().min(1), z.number().finite(), z.boolean()]);

export const requirementSchema = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    equals: scalarRequirementValueSchema.optional(),
    includes: z.array(z.string().min(1)).optional()
  })
  .strict()
  .refine(
    (requirement) =>
      requirement.min !== undefined ||
      requirement.max !== undefined ||
      requirement.equals !== undefined ||
      requirement.includes !== undefined,
    {
      message: "requirement must define at least one direct constraint"
    }
  );

export const partSchema = z
  .object({
    schema: z.literal("loomit.part.v0"),
    name: z.string().min(1),
    // Design decision: variant is an identifier, not an ordered software version.
    variant: z.string().min(1),
    type: z.string().min(1),
    status: partStatusSchema.optional(),
    files: z
      .object({
        source: z.string().min(1).optional(),
        preview: z.string().min(1).optional(),
        print: z.string().min(1).optional()
      })
      .strict()
      .optional(),
    measurements: z
      .object({
        finished: z.record(z.string().min(1), finishedMeasurementSchema).optional()
      })
      .strict()
      .optional(),
    connectors: z.record(z.string().min(1), connectorSchema).optional(),
    // Design decision: requires expresses direct measurement/tag/material constraints, not version ranges.
    requires: z.record(z.string().min(1), requirementSchema).optional(),
    tags: z.array(z.string().min(1)).optional()
  })
  .strict();

export type Connector = z.infer<typeof connectorSchema>;
export type Part = z.infer<typeof partSchema>;
export type PartStatus = z.infer<typeof partStatusSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
