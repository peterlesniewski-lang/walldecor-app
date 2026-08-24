import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  typescript: {
    // Docker runs this focused type check in a separate process before the
    // bundler so both phases do not hold their heaps at the same time.
    tsconfigPath: 'tsconfig.next.json',
    ignoreBuildErrors: process.env.WALLDECOR_DOCKER_BUILD === '1',
  },
  experimental: {
    webpackMemoryOptimizations: process.env.WALLDECOR_DOCKER_BUILD === '1',
  },
}

export default nextConfig
