import { z } from 'zod';

/** API 边界的输入校验 —— 所有外部输入必须先过这里 */

const domainPattern = /^(\*\.)?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export const DomainListSchema = z
  .array(z.string().trim().toLowerCase().regex(domainPattern, '域名格式不合法'))
  .max(20);

export const SearchModeSchema = z.enum(['flash', 'dive', 'panel', 'pulse']);
export const ProviderIdSchema = z.enum(['xai', 'openai', 'anthropic', 'mock']);

export const SearchOptionsSchema = z
  .object({
    maxSources: z.number().int().min(1).max(30).optional(),
    timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
    maxConcurrency: z.number().int().min(1).max(8).optional(),
    allowedDomains: DomainListSchema.optional(),
    blockedDomains: DomainListSchema.optional(),
    includeSocial: z.boolean().optional(),
    plannerProviderId: ProviderIdSchema.optional(),
    synthesizerProviderId: ProviderIdSchema.optional(),
    judgeProviderId: ProviderIdSchema.optional(),
    models: z.record(ProviderIdSchema, z.string().min(1).max(120)).optional(),
  })
  .strict();

export const SearchRequestSchema = z
  .object({
    question: z.string().trim().min(2, '问题太短').max(2_000, '问题过长'),
    mode: SearchModeSchema.default('flash'),
    providers: z.array(ProviderIdSchema).min(1).max(4).optional(),
    options: SearchOptionsSchema.optional(),
  })
  .strict();

export type SearchRequestInput = z.infer<typeof SearchRequestSchema>;

export const FollowUpSchema = z
  .object({
    question: z.string().trim().min(2).max(2_000),
  })
  .strict();
export type FollowUpInput = z.infer<typeof FollowUpSchema>;

export const ProviderSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultModel: z.string().trim().max(120).optional(),
    baseUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
    timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
  })
  .strict();
export type ProviderSettingsPatchInput = z.infer<typeof ProviderSettingsPatchSchema>;

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
});

export const RoleModelSchema = z.object({
  providerId: ProviderIdSchema,
  model: z.string().trim().max(120).optional(),
}).strict();

export const AppSettingsSchema = z.object({
  defaultMode: SearchModeSchema,
  roles: z.object({
    planner: RoleModelSchema.optional(),
    researcher: RoleModelSchema.optional(),
    synthesizer: RoleModelSchema.optional(),
    judge: RoleModelSchema.optional(),
  }).strict(),
}).strict();
