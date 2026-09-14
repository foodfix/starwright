import { z } from 'zod';
import { SourceSchema } from './common.js';
import { MoveSchema } from './moves.js';

export const AssetOptionSchema = z.looseObject({
  label: z.string(),
  field_type: z.enum(['text', 'select_value']),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type AssetOption = z.infer<typeof AssetOptionSchema>;

export const EnhanceMoveSchema = z.looseObject({
  roll_type: z.string(),
  enhances: z.array(z.string()).nullable(),
  trigger: z
    .looseObject({
      conditions: z
        .array(
          z.looseObject({
            method: z.string().nullable().optional(),
            roll_options: z.array(z.looseObject({ using: z.string() })).nullable().optional(),
            text: z.string().optional(),
          }),
        )
        .nullable()
        .optional(),
    })
    .optional(),
});
export type EnhanceMove = z.infer<typeof EnhanceMoveSchema>;

export const AssetAbilitySchema = z.looseObject({
  _id: z.string(),
  enabled: z.boolean(),
  text: z.string(),
  enhance_moves: z.array(EnhanceMoveSchema).optional(),
  /** M5: embedded moves (e.g. Raise Shields), registered into the move catalog */
  moves: z.record(z.string(), MoveSchema).optional(),
});
export type AssetAbility = z.infer<typeof AssetAbilitySchema>;

export const AssetControlSchema: z.ZodType<AssetControl> = z.lazy(() =>
  z.looseObject({
    label: z.string(),
    field_type: z.enum(['condition_meter', 'checkbox', 'card_flip']),
    rollable: z.boolean().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    value: z.union([z.number(), z.boolean()]).optional(),
    controls: z.record(z.string(), AssetControlSchema).optional(),
    moves: z.record(z.string(), z.array(z.string())).optional(),
  }),
);
export type AssetControl = {
  label: string;
  field_type: 'condition_meter' | 'checkbox' | 'card_flip';
  rollable?: boolean;
  min?: number;
  max?: number;
  value?: number | boolean;
  controls?: Record<string, AssetControl>;
  moves?: Record<string, string[]>;
  [key: string]: unknown;
};

export const AssetSchema = z.looseObject({
  _id: z.string(),
  type: z.literal('asset'),
  name: z.string(),
  category: z.string(),
  color: z.string().optional(),
  options: z.record(z.string(), AssetOptionSchema).optional(),
  count_as_impact: z.boolean().optional(),
  shared: z.boolean().optional(),
  attachments: z.looseObject({ max: z.number().nullable().optional(), assets: z.array(z.string()) }).optional(),
  abilities: z.array(AssetAbilitySchema),
  controls: z.record(z.string(), AssetControlSchema).optional(),
  requirement: z.string().optional(),
  _source: SourceSchema.optional(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetCategorySchema = z.looseObject({
  _id: z.string(),
  type: z.literal('asset_collection'),
  name: z.string(),
  color: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  contents: z.record(z.string(), AssetSchema),
});
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetsSchema = z.record(z.string(), AssetCategorySchema);
export type Assets = z.infer<typeof AssetsSchema>;
