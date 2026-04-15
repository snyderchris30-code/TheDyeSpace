"use client";
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useMusicPlayerContext } from './MusicPlayerContext';

const GlobalMusicPlayer = dynamic(() => import('./(main)/GlobalMusicPlayer'), { ssr: false });

const AUTH_PATHS_RE = /^(?:\/login|\/signup|\/forgot-password|\/reset-password|\/confirm)(?:$|\/)/;

export default function MusicPlayerMount() {
  const pathname = usePathname() || '';
  const { isVisible } = useMusicPlayerContext();

  if (AUTH_PATHS_RE.test(pathname) || !isVisible) {
    return null;
  }

  return <GlobalMusicPlayer />;
}
