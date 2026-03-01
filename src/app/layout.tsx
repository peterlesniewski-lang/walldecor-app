import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from '@/components/shared/session-provider'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'latin-ext'],
})

export const metadata: Metadata = {
  title: 'WallDecor — Panel zarządzania',
  description: 'System budżetowo-HR WallDecor',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pl">
      <body className={`${inter.variable} antialiased`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
