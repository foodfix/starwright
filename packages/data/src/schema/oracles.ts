import { z } from 'zod';
import { SourceSchema } from './common.js';

export const OracleRowSchema = z.looseObject({
  min: z.number(),
  max: z.number(),
  text: z.string(),
  suggestion: z.looseObject({ text: z.string() }).optional(),
  _i18n: z.unknown().optional(),
});
export type OracleRow = z.infer<typeof OracleRowSchema>;

export const OracleRollableSchema = z.looseObject({
  _id: z.string(),
  type: z.literal('oracle_rollable'),
  name: z.string(),
  oracle_type: z.string(),
  dice: z.string(),
  summary: z.string().optional(),
  column_labels: z.record(z.string(), z.string()).optional(),
  suggestions: z.looseObject({ oracles: z.array(z.string()).optional() }).optional(),
  rows: z.array(OracleRowSchema),
  _source: SourceSchema.optional(),
});
export type OracleRollable = z.infer<typeof OracleRollableSchema>;

export interface OracleCollectionNode {
  _id: string;
  type: 'oracle_collection';
  name: string;
  oracle_type: string;
  contents: Record<string, OracleCollectionNode | OracleRollable>;
}

export const OracleCollectionSchema: z.ZodType<OracleCollectionNode> = z.looseObject({
  _id: z.string(),
  type: z.literal('oracle_collection'),
  name: z.string(),
  oracle_type: z.string(),
  contents: z.record(z.string(), z.lazy(() => z.union([OracleCollectionSchema, OracleRollableSchema]))),
});

export const OraclesSchema = z.record(z.string(), OracleCollectionSchema);
export type Oracles = z.infer<typeof OraclesSchema>;
