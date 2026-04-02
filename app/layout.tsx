import './globals.css';
import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk' });

export const metadata: Metadata = {
  title: 'TheDyeSpace',
  description: 'A cosmic, psychedelic commune for tie-dye artists and creative souls.',
};

import { Providers } from './providers';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`min-h-screen text-white ${inter.variable} ${spaceGrotesk.variable} font-sans`}>
        <Providers>
          <div className="site-background" />
          <main className="site-shell relative z-10 flex flex-col min-h-screen pt-20">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
