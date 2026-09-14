import { z } from 'zod';

export const SourceSchema = z.looseObject({
  title: z.string().optional(),
  page: z.number().optional(),
  authors: z.array(z.looseObject({ name: z.string() })).optional(),
  date: z.string().optional(),
  url: z.string().optional(),
  license: z.string().optional(),
});
export type Source = z.infer<typeof SourceSchema>;
