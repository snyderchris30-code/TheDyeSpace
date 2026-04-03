import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });

export const metadata: Metadata = {
  title: 'TheDyeSpace',
  description: 'A cosmic, psychedelic commune for tie-dye artists and creative souls.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/logo.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/logo.png', sizes: '180x180', type: 'image/png' }],
    shortcut: [{ url: '/logo.png', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'DyeSpace',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#00ffd0',
};

import { Providers } from './providers';
import PWARegister from './PWARegister';
import BackgroundParallax from './BackgroundParallax';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="DyeSpace" />
      </head>
      <body className={`flex flex-col min-h-screen text-white overflow-hidden ${inter.variable} ${spaceGrotesk.variable} font-sans`}>
        <Providers>
          <PWARegister />
          <BackgroundParallax />
          <div className="site-background" />
          <main className="site-shell relative z-10 flex flex-col flex-1 pt-16 overflow-y-auto overflow-x-hidden">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
