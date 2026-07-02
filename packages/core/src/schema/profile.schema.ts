import { z } from "zod";

const profileMeasurementSchema = z.number().finite().nonnegative();

export const profileMeasurementsSchema = z
  .object({
    height_cm: profileMeasurementSchema.optional(),
    bust_cm: profileMeasurementSchema.optional(),
    waist_cm: profileMeasurementSchema.optional(),
    hip_cm: profileMeasurementSchema.optional(),
    shoulder_width_cm: profileMeasurementSchema.optional(),
    arm_length_cm: profileMeasurementSchema.optional(),
    upper_arm_cm: profileMeasurementSchema.optional()
  })
  .strict()
  .refine((measurements) => Object.values(measurements).some((value) => value !== undefined), {
    message: "profile measurements must include at least one value"
  });

export const profileSchema = z
  .object({
    schema: z.literal("loomit.profile.v0"),
    name: z.string().min(1),
    base_size: z.string().min(1).optional(),
    measurements: profileMeasurementsSchema
  })
  .strict();

export type Profile = z.infer<typeof profileSchema>;
export type ProfileMeasurements = z.infer<typeof profileMeasurementsSchema>;
