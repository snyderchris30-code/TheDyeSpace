"use client";

import MainNavbar from "./MainNavbar";
import GlobalMusicPlayer from "./GlobalMusicPlayer";

export default function MainLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1 text-cyan-100">
      <MainNavbar />
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-40">
        {children}
      </div>
      <GlobalMusicPlayer />
    </div>
  );
}
