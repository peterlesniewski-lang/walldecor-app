import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  typescript: {
    // Keep Next's production type check focused on application code. The root
    // config intentionally also covers tests and scripts, which is too large
    // for the VPS-hosted Docker build.
    tsconfigPath: 'tsconfig.next.json',
  },
}

export default nextConfig
