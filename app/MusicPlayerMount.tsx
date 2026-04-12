"use client";
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const GlobalMusicPlayer = dynamic(() => import('./(main)/GlobalMusicPlayer'), { ssr: false });

export default function MusicPlayerMount() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const pathname = window.location.pathname || "";
      const hideOnAuthPage = /^(?:\/login|\/signup|\/forgot-password|\/reset-password|\/confirm)(?:$|\/)/.test(pathname);
      if (hideOnAuthPage) {
        setShow(false);
        return;
      }
      setShow(window.localStorage.getItem('dyespace.music_player_visible') !== 'false');
    } catch {
      setShow(false);
    }
  }, []);
  return show ? <GlobalMusicPlayer /> : null;
}
