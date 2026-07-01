import { z } from 'zod'

export const KSEF_SETTING_KEYS = [
  'ksef_enabled',
  'ksef_environment',
  'ksef_company_nip',
  'ksef_token',
  'ksef_sync_from',
] as const

export const KsefSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(['test', 'demo', 'production']),
  companyNip: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'NIP musi mieć 10 cyfr'),
  token: z.string().trim().optional(),
  syncFrom: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: 'Data musi mieć format YYYY-MM-DD',
    }),
})

export type KsefSettingsUpdateInput = z.infer<typeof KsefSettingsUpdateSchema>

export function maskSecret(secret: string | null | undefined) {
  if (!secret) return null
  if (secret.length < 8) return '***'
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`
}
