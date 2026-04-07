"use client";

import MainNavbar from "./MainNavbar";

export default function MainLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-0 flex flex-col flex-1 overflow-visible text-cyan-100">
      <MainNavbar />
      <div className="relative z-0 flex-1 overflow-y-auto overflow-x-hidden pb-40">
        {children}
      </div>
    </div>
  );
}
