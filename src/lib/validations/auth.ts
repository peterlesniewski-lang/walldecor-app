import { z } from 'zod'
import { isStrongPassword, normalizeUsername } from '@/lib/accounts/policy'

export const LoginSchema = z.object({
  username: z
    .string()
    .min(2, 'Login jest wymagany')
    .transform(normalizeUsername)
    .refine((value) => value.length >= 2, 'Login jest wymagany'),
  password: z.string().min(1, 'Hasło jest wymagane'),
})

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Aktualne hasło jest wymagane'),
    newPassword: z.string().refine(isStrongPassword, {
      message: 'Hasło musi mieć min. 10 znaków, małą i wielką literę, cyfrę oraz znak specjalny',
    }),
    confirmPassword: z.string().min(1, 'Powtórz nowe hasło'),
  })
  .superRefine((data, ctx) => {
    if (data.newPassword !== data.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Hasła nie są takie same',
        path: ['confirmPassword'],
      })
    }
  })

export type LoginInput = z.infer<typeof LoginSchema>
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>
