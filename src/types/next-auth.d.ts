import type { DefaultSession, DefaultUser } from 'next-auth'
import type { JWT as DefaultJWT } from 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
      employeeId?: string | null
    } & DefaultSession['user']
  }

  interface User extends DefaultUser {
    role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
    employeeId?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string
    role: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'
    employeeId?: string | null
  }
}
