import type { Metadata } from 'next'
import { jakarta, mono } from './fonts'
import './globals.css'
import { SessionProvider } from '@/components/shared/session-provider'

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
      <body className={`${jakarta.variable} ${mono.variable} antialiased`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
