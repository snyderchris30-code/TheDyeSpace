"use client";

import MainNavbar from "./MainNavbar";

export default function MainLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-cyan-100">
      <MainNavbar />
      <main className="pt-24 px-4 pb-10 sm:px-8">{children}</main>
    </div>
  );
}
