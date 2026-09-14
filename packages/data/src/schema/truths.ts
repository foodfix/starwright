import { z } from 'zod';
import { SourceSchema } from './common.js';
import { OracleRowSchema } from './oracles.js';

export const TruthSubTableSchema = z.looseObject({
  oracle_type: z.string(),
  dice: z.string(),
  rows: z.array(OracleRowSchema),
});
export type TruthSubTable = z.infer<typeof TruthSubTableSchema>;

export const TruthOptionSchema = z.looseObject({
  min: z.number(),
  max: z.number(),
  summary: z.string(),
  description: z.string(),
  quest_starter: z.string(),
  table: TruthSubTableSchema.optional(),
});
export type TruthOption = z.infer<typeof TruthOptionSchema>;

export const TruthSchema = z.looseObject({
  _id: z.string(),
  name: z.string(),
  icon: z.string().optional(),
  dice: z.string().optional(),
  options: z.array(TruthOptionSchema),
  your_character: z.string().optional(),
  _source: SourceSchema.optional(),
});
export type Truth = z.infer<typeof TruthSchema>;

export const TruthsSchema = z.record(z.string(), TruthSchema);
export type Truths = z.infer<typeof TruthsSchema>;
