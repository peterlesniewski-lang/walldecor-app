import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'

export default withAuth(
  function middleware(req) {
    return NextResponse.next()
  },
  {
    pages: {
      signIn: '/login',
    },
  }
)

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/finance/:path*',
    '/hr/:path*',
    '/settings/:path*',
    // Protect all /api/* except /auth/* and /health
    '/api/((?!auth|health).+)',
  ],
}
