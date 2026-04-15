import type { Metadata } from 'next';
import { IBM_Plex_Mono, Manrope } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

const manrope = Manrope({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
});

export const metadata: Metadata = {
  title: 'Nova - Local-First Agent Chat Alpha',
  description: 'A local-first agent chat workspace for technical users, with optional build tools and guarded automation.',
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${manrope.variable} ${ibmPlexMono.variable} antialiased`}>
        {children}
        <Toaster
          position="top-right"
          richColors
          theme="dark"
          toastOptions={{
            style: {
              background: 'rgba(15, 23, 42, 0.96)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'oklch(0.96 0.004 255)',
              boxShadow: '0 24px 80px rgba(2, 6, 23, 0.45)',
            },
          }}
        />
      </body>
    </html>
  );
}
