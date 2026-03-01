import { z } from 'zod'

export const LoginSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
  password: z.string().min(1, 'Hasło jest wymagane'),
})

export type LoginInput = z.infer<typeof LoginSchema>
