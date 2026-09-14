import { z } from 'zod';

export const StatIdSchema = z.enum(['edge', 'heart', 'iron', 'shadow', 'wits']);
export type StatId = z.infer<typeof StatIdSchema>;

export const ConditionMeterIdSchema = z.enum(['health', 'spirit', 'supply']);
export type ConditionMeterId = z.infer<typeof ConditionMeterIdSchema>;

export const LegacyTrackIdSchema = z.enum(['quests_legacy', 'bonds_legacy', 'discoveries_legacy']);
export type LegacyTrackId = z.infer<typeof LegacyTrackIdSchema>;

export const StatsSchema = z.record(
  z.string(),
  z.looseObject({ label: z.string(), description: z.string() }),
);
export type Stats = z.infer<typeof StatsSchema>;

export const ConditionMetersSchema = z.record(
  z.string(),
  z.looseObject({
    label: z.string(),
    rollable: z.boolean(),
    min: z.number(),
    max: z.number(),
    value: z.number(),
    shared: z.boolean(),
    description: z.string(),
  }),
);
export type ConditionMeters = z.infer<typeof ConditionMetersSchema>;

export const ImpactsSchema = z.record(
  z.string(),
  z.looseObject({
    label: z.string(),
    description: z.string(),
    contents: z.record(
      z.string(),
      z.looseObject({
        label: z.string(),
        prevents_recovery: z.array(z.string()).nullable(),
        permanent: z.boolean().optional(),
        shared: z.boolean(),
        description: z.string(),
      }),
    ),
  }),
);
export type Impacts = z.infer<typeof ImpactsSchema>;

export const SpecialTracksSchema = z.record(
  z.string(),
  z.looseObject({
    label: z.string(),
    optional: z.boolean(),
    shared: z.boolean(),
    description: z.string(),
  }),
);
export type SpecialTracks = z.infer<typeof SpecialTracksSchema>;

export const RulesSchema = z.looseObject({
  stats: StatsSchema,
  condition_meters: ConditionMetersSchema,
  impacts: ImpactsSchema,
  special_tracks: SpecialTracksSchema,
  tags: z.record(
    z.string(),
    z.looseObject({
      value_type: z.string().optional(),
      label: z.string().optional(),
      description: z.string().optional(),
      applies_to: z.array(z.string()).optional(),
      enum: z.array(z.string()).optional(),
    }),
  ),
});
export type Rules = z.infer<typeof RulesSchema>;
