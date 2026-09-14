import { z } from 'zod';
import { SourceSchema } from './common.js';

export const MoveRollTypeSchema = z.enum(['action_roll', 'progress_roll', 'no_roll', 'special_track']);
export type MoveRollType = z.infer<typeof MoveRollTypeSchema>;

export const TriggerMethodSchema = z.enum(['player_choice', 'progress_roll', 'highest', 'lowest', 'all']);
export type TriggerMethod = z.infer<typeof TriggerMethodSchema>;

export const RollOptionUsingSchema = z.enum([
  'stat',
  'condition_meter',
  'progress_track',
  'custom',
  'asset_control',
  'attached_asset_control',
  'bonds_legacy',
  'quests_legacy',
  'discoveries_legacy',
]);
export type RollOptionUsing = z.infer<typeof RollOptionUsingSchema>;

export const RollOptionSchema = z.looseObject({
  using: RollOptionUsingSchema,
  stat: z.string().optional(),
  condition_meter: z.string().optional(),
  control: z.string().optional(),
  assets: z.array(z.string()).optional(),
  label: z.string().optional(),
  value: z.number().optional(),
});
export type RollOption = z.infer<typeof RollOptionSchema>;

export const TriggerConditionSchema = z.looseObject({
  method: TriggerMethodSchema.nullable().optional(),
  roll_options: z.array(RollOptionSchema).nullable().optional(),
  text: z.string().optional(),
});
export type TriggerCondition = z.infer<typeof TriggerConditionSchema>;

export const MoveTriggerSchema = z.looseObject({
  conditions: z.array(TriggerConditionSchema).nullable().optional(),
  text: z.string().optional(),
  options: z.record(z.string(), z.looseObject({ label: z.string() })).optional(),
});
export type MoveTrigger = z.infer<typeof MoveTriggerSchema>;

export const MoveOutcomeSchema = z.looseObject({ text: z.string() });
export type MoveOutcome = z.infer<typeof MoveOutcomeSchema>;

export const MoveOutcomesSchema = z.record(z.string(), MoveOutcomeSchema);

export const MoveSchema = z.looseObject({
  _id: z.string(),
  type: z.literal('move'),
  name: z.string(),
  roll_type: MoveRollTypeSchema,
  trigger: MoveTriggerSchema.nullable().optional(),
  text: z.string().optional(),
  outcomes: MoveOutcomesSchema.nullable().optional(),
  oracles: z.array(z.string()).optional(),
  _source: SourceSchema.optional(),
});
export type Move = z.infer<typeof MoveSchema>;

export const MoveCategorySchema = z.looseObject({
  _id: z.string(),
  type: z.literal('move_category'),
  name: z.string(),
  color: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  contents: z.record(z.string(), MoveSchema),
});
export type MoveCategory = z.infer<typeof MoveCategorySchema>;

export const MovesSchema = z.record(z.string(), MoveCategorySchema);
export type Moves = z.infer<typeof MovesSchema>;
