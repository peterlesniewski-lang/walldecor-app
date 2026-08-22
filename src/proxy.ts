import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import type { JWT } from 'next-auth/jwt'

type Role = 'ADMIN' | 'MANAGER' | 'EMPLOYEE'

/** Routes that require specific roles (checked in order — first match wins). */
const ROLE_RULES: { pattern: RegExp; roles: Role[] }[] = [
  // ADMIN only
  { pattern: /^\/hr\/employees\/new(\/|$)/, roles: ['ADMIN'] },
  { pattern: /^\/hr\/leave\/types(\/|$)/, roles: ['ADMIN'] },

  // ADMIN | MANAGER
  { pattern: /^\/hr\/time-tracking\/periods(\/|$)/, roles: ['ADMIN', 'MANAGER'] },
  { pattern: /^\/hr\/leave\/approval(\/|$)/, roles: ['ADMIN', 'MANAGER'] },
]

function getRequiredRoles(pathname: string): Role[] | null {
  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(pathname)) return rule.roles
  }
  return null
}

export default withAuth(
  function middleware(req: NextRequest & { nextauth: { token: JWT | null } }) {
    const { pathname } = req.nextUrl
    const token = req.nextauth.token

    if (
      token?.mustChangePassword &&
      pathname !== '/change-password' &&
      pathname !== '/api/account/change-password'
    ) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Password change required' },
          { status: 403 }
        )
      }

      const url = req.nextUrl.clone()
      url.pathname = '/change-password'
      return NextResponse.redirect(url)
    }

    // All /hr/* routes require authentication (handled by withAuth authorizeCallback below).
    // Here we only enforce role-level restrictions on top.
    const requiredRoles = getRequiredRoles(pathname)
    if (requiredRoles && token) {
      const userRole = token.role as Role | undefined
      if (!userRole || !requiredRoles.includes(userRole)) {
        // Redirect unauthorised users back to HR root
        const url = req.nextUrl.clone()
        url.pathname = '/hr'
        return NextResponse.redirect(url)
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      // Require a valid JWT for all matched routes
      authorized: ({ token }) => !!token,
    },
    pages: {
      signIn: '/login',
    },
  }
)

export const config = {
  matcher: [
    '/((?!login|forgot-password|change-password|m(?:/|$)|api/auth|api/account/request-password-reset|api/public/installations(?:/|$)|api/health|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
