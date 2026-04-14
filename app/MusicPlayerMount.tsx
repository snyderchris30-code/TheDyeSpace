"use client";
import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import { usePathname } from 'next/navigation';

const GlobalMusicPlayer = dynamic(() => import('./(main)/GlobalMusicPlayer'), { ssr: false });

export default function MusicPlayerMount() {
  const pathname = usePathname() || '';

  const show = useMemo(() => {
    const hideOnAuthPage = /^(?:\/login|\/signup|\/forgot-password|\/reset-password|\/confirm)(?:$|\/)/.test(pathname);
    if (hideOnAuthPage) {
      return false;
    }

    try {
      return window.localStorage.getItem('dyespace.music_player_visible') !== 'false';
    } catch {
      return false;
    }
  }, [pathname]);

  return show ? <GlobalMusicPlayer /> : null;
}
