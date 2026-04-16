import type { Metadata } from 'next';
import { Audiowide, Bebas_Neue, Cormorant_Garamond, DM_Serif_Display, Inter, JetBrains_Mono, Orbitron, Playfair_Display, Space_Grotesk, Syne } from 'next/font/google';
import MainLayoutClient from './MainLayoutClient';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', preload: false, display: 'swap' });
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', preload: false, display: 'swap' });
const bebasNeue = Bebas_Neue({ subsets: ['latin'], variable: '--font-bebas-neue', weight: '400', preload: false, display: 'swap' });
const cormorantGaramond = Cormorant_Garamond({ subsets: ['latin'], variable: '--font-cormorant-garamond', preload: false, display: 'swap' });
const dmSerifDisplay = DM_Serif_Display({ subsets: ['latin'], variable: '--font-dm-serif-display', weight: '400', preload: false, display: 'swap' });
const orbitron = Orbitron({ subsets: ['latin'], variable: '--font-orbitron', preload: false, display: 'swap' });
const playfairDisplay = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair-display', preload: false, display: 'swap' });
const syne = Syne({ subsets: ['latin'], variable: '--font-syne', preload: false, display: 'swap' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', preload: false, display: 'swap' });
const audiowide = Audiowide({ subsets: ['latin'], variable: '--font-audiowide', weight: '400', preload: false, display: 'swap' });

export const metadata: Metadata = {
  title: 'TheDyeSpace',
  description: 'A community platform for tie-dye artists and creative sellers.',
};

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <MainLayoutClient>
      <div className={`flex-1 text-cyan-100 ${inter.variable} ${spaceGrotesk.variable} ${bebasNeue.variable} ${cormorantGaramond.variable} ${dmSerifDisplay.variable} ${orbitron.variable} ${playfairDisplay.variable} ${syne.variable} ${jetbrainsMono.variable} ${audiowide.variable}`}>
        <div className="pt-8 px-4 pb-10 sm:px-8 sm:pt-10 min-h-full">{children}</div>
      </div>
    </MainLayoutClient>
  );
}
