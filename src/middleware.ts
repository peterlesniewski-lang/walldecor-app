export { default } from 'next-auth/middleware'

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/finance/:path*',
    '/hr/:path*',
    '/settings/:path*',
    '/api/((?!auth).*)/:path*',
  ],
}
