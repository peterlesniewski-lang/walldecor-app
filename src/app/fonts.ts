import localFont from 'next/font/local'

// Self-hosted (latin + latin-ext subset of the Google Fonts originals, OFL) so
// the Docker build never depends on fetching fonts.googleapis.com.
export const jakarta = localFont({
  variable: '--font-jakarta',
  src: [{ path: './fonts/plus-jakarta-sans-variable.woff2', weight: '200 800', style: 'normal' }],
  display: 'swap',
})

export const mono = localFont({
  variable: '--font-mono',
  src: [
    { path: './fonts/dm-mono-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/dm-mono-500.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
})

export const clientDisplay = localFont({
  variable: '--font-client-display',
  src: [{ path: './fonts/bricolage-grotesque-variable.woff2', weight: '700 800', style: 'normal' }],
  display: 'swap',
})

export const clientSans = localFont({
  variable: '--font-client-sans',
  src: [{ path: './fonts/spline-sans-variable.woff2', weight: '300 700', style: 'normal' }],
  display: 'swap',
})
