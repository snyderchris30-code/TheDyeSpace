"use client";
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const GlobalMusicPlayer = dynamic(() => import('./(main)/GlobalMusicPlayer'), { ssr: false });

export default function MusicPlayerMount() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(window.localStorage.getItem('dyespace.music_player_visible') !== 'false');
    } catch {
      setShow(false);
    }
  }, []);
  return show ? <GlobalMusicPlayer /> : null;
}
