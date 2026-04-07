"use client";


import Link from "next/link";
import { Bell, User, Home, PlusSquare, Compass, Users } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function Navbar({ user }: { user?: { avatar_url?: string } }) {
  const [userCount, setUserCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let subscription: any;

    async function fetchUserCount() {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      setUserCount(count ?? null);
    }

    fetchUserCount();

    // Realtime subscription fires when replication is enabled on the table
    subscription = supabase
      .channel('public:profiles')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, () => {
        fetchUserCount();
      })
      .subscribe();

    // Polling fallback: refresh every 30 s in case realtime is not enabled
    const interval = window.setInterval(fetchUserCount, 30_000);

    return () => {
      window.clearInterval(interval);
      supabase.removeChannel(subscription);
    };
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <nav className="navbar mt-2 mb-6 relative isolate overflow-visible z-[2147483000]">
      <Link href="/" className="text-4xl tracking-widest select-none cosmic-headline">
        TheDyeSpace
      </Link>
      <div className="flex gap-2 items-center">
        {userCount !== null && (
          <span className="flex items-center gap-1 px-3 py-1 rounded-lg bg-cyan-900/60 text-cyan-200 font-bold text-sm">
            <Users size={18} />
            {userCount} users
          </span>
        )}
        <Link href="/" className="nav-link flex items-center gap-1 cosmic-headline"><Home size={20} />Home</Link>
        <Link href="/explore" className="nav-link flex items-center gap-1 cosmic-headline"><Compass size={20} />Explore</Link>
        <Link href="/create" className="nav-link flex items-center gap-1 cosmic-headline"><PlusSquare size={20} />Create</Link>
        <Link href="/notifications" className="nav-link flex items-center gap-1 cosmic-headline"><Bell size={20} />Notifications</Link>
        <Link href="/profile" className="nav-link flex items-center gap-1 cosmic-headline"><User size={20} />Profile</Link>
        {user?.avatar_url ? (
          <Image
            src={user.avatar_url}
            alt="User Avatar"
            width={36}
            height={36}
            className="avatar"
            style={{ width: "36px", height: "36px" }}
          />
        ) : (
          <User size={20} className="text-white" />
        )}
        <button
          className="ml-3 px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-bold"
          onClick={handleSignOut}
        >
          Sign Out (Clear Session)
        </button>
        {/* Theme toggle removed */}
      </div>
    </nav>
  );
}
