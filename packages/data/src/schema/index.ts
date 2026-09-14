import { z } from 'zod';
import { RulesSchema } from './rules.js';
import { MovesSchema } from './moves.js';
import { OraclesSchema } from './oracles.js';
import { AssetsSchema } from './assets.js';
import { TruthsSchema } from './truths.js';

export const StarforgedSchema = z.looseObject({
  _id: z.string(),
  datasworn_version: z.string(),
  type: z.literal('ruleset'),
  title: z.string(),
  rules: RulesSchema,
  moves: MovesSchema,
  oracles: OraclesSchema,
  assets: AssetsSchema,
  truths: TruthsSchema,
});
export type Starforged = z.infer<typeof StarforgedSchema>;

export const EMPTY_DOMAINS = ['atlas', 'rarities', 'delve_sites', 'site_domains', 'site_themes', 'npcs'] as const;
