"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, User, Home, PlusSquare, Compass, LogOut, Users } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

const navLinks = [
  { href: "/", label: "Home", icon: <Home size={20} /> },
  { href: "/explore", label: "Explore", icon: <Compass size={20} /> },
  { href: "/create", label: "Create Post", icon: <PlusSquare size={20} /> },
];

async function fetchNotifications(): Promise<Array<{ id: string; actor_name: string; type: string; message: string; read: boolean; created_at: string }>> {
  const supabase = createClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    return [];
  }

  const { data, error } = await supabase
    .from("notifications")
    .select("id,actor_name,type,message,read,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    // Suppress noisy error log for notification fetch failures
    return [];
  }

  return data || [];
}
export default function MainNavbar({ user }: { user?: { avatar_url?: string; display_name?: string } }) {
  const router = useRouter();
  const [session, setSession] = useState<any>(null);
  const [profileUser, setProfileUser] = useState<{ avatar_url?: string | null; display_name?: string | null }>({});
  const [userCount, setUserCount] = useState<number | null>(null);

  const loadProfileUser = async (userId?: string) => {
    if (!userId) {
      setProfileUser({});
      return;
    }
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("avatar_url, display_name")
      .eq("id", userId)
      .limit(1)
      .maybeSingle();
    if (data) {
      setProfileUser({ avatar_url: data.avatar_url, display_name: data.display_name });
    }
  };

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void loadProfileUser(data.session?.user?.id);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      void loadProfileUser(session?.user?.id);
    });
    return () => { listener?.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const fetchUserCount = async () => {
      const { count } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });

      if (active) {
        setUserCount(count ?? null);
      }
    };

    void fetchUserCount();

    const channel = supabase
      .channel("public:profiles:navbar-count")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profiles" }, () => {
        void fetchUserCount();
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      queryClient.clear();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };
  // Theme system removed
  const [dropdown, setDropdown] = useState(false);
  const [notifDrop, setNotifDrop] = useState(false);
  const queryClient = useQueryClient();

  // Theme system removed

  const { data: notifications = [], refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    staleTime: 1000 * 30,
    refetchInterval: 1000 * 30,
  });

  const unreadCount = notifications.filter((item) => !item.read).length;

  const markAllRead = async () => {
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) return;

    await supabase.from("notifications").update({ read: true }).eq("user_id", userId);
    refetch();
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  return (
    <nav className="navbar mt-2 mb-4 relative sm:mb-6">
      <Link href="/" className="navbar-logo w-full text-center text-2xl tracking-wide select-none sm:w-auto sm:text-left sm:text-4xl sm:tracking-widest">
        TheDyeSpace
      </Link>
      <div className="flex w-full flex-wrap items-center justify-center gap-1 sm:w-auto sm:justify-end sm:gap-2">
        {userCount !== null && (
          <div className="hidden items-center gap-2 rounded-full border border-cyan-300/30 bg-black/35 px-3 py-1 text-sm font-semibold text-cyan-100 shadow-[0_0_18px_rgba(22,255,220,0.16)] sm:flex">
            <Users size={16} className="text-cyan-300" />
            <span>{userCount}</span>
          </div>
        )}


        {/* Home and Explore always visible */}
        <Link href="/" className="nav-link flex items-center gap-1 cosmic-headline"><Home size={18} /><span className="text-xs sm:text-base">Home</span></Link>
        <Link href="/explore" className="nav-link flex items-center gap-1 cosmic-headline"><Compass size={18} /><span className="text-xs sm:text-base">Explore</span></Link>
        {/* Create Post only if signed in */}
        {session && session.user && (
          <Link href="/create" className="nav-link flex items-center gap-1 cosmic-headline"><PlusSquare size={18} /><span className="text-xs sm:text-base">Create</span></Link>
        )}

        {/* Profile/Sign In button logic */}
        {/* Profile button only if signed in */}
        {session && session.user && (
          <Link
            href={`/profile/${session.user.user_metadata?.username || session.user.email}`}
            className="nav-link flex items-center gap-1 cosmic-headline px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-700 via-teal-700 to-green-700 hover:from-cyan-500 hover:to-green-500 border border-sky-400 shadow-md"
          >
            <User size={18} /><span className="text-xs sm:text-base">Profile</span>
          </Link>
        )}

        <div className="relative">
          <button
            aria-label="Notifications"
            className="nav-link flex items-center gap-1 relative"
            onClick={() => {
              setNotifDrop((open) => !open);
              if (!notifDrop) refetch();
            }}
          >
            <Bell size={18} />
            <span className="hidden sm:inline">Notifications</span>
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 shadow-lg animate-pulse border border-sky-400">
                {unreadCount}
              </span>
            )}
          </button>
          {notifDrop && (
            <div className="absolute right-0 mt-2 w-[min(92vw,320px)] bg-black/80 border border-sky-500 rounded-xl shadow-2xl z-50 p-3 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <span className="text-cyan-200 font-semibold">Notifications</span>
                <button onClick={markAllRead} className="text-xs text-green-200 hover:text-white">Mark all read</button>
              </div>
              <div className="space-y-2 max-h-64 overflow-auto">
                {notifications.length === 0 ? (
                  <p className="text-sm text-slate-300">No new notifications yet.</p>
                ) : (
                  notifications.map((note) => (
                    <button key={note.id} className={`w-full text-left p-2 rounded-lg transition ${note.read ? 'bg-slate-900/40 text-slate-200' : 'bg-sky-900/75 text-white'}`} onClick={() => setNotifDrop(false)}>
                      <div className="flex justify-between items-center text-xs text-slate-300">
                        <span>{note.type.toUpperCase()}</span>
                        <span>{new Date(note.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                      </div>
                      <div className="text-sm font-semibold">{note.actor_name}</div>
                      <div className="text-xs leading-snug text-sky-100">{note.message}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dynamic Sign In/Sign Out button */}
        {session ? (
          <button
            className="nav-link flex items-center gap-1 cosmic-headline px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-700 via-teal-700 to-green-700 hover:from-cyan-500 hover:to-green-500 border border-sky-400 shadow-md"
            onClick={handleSignOut}
          >
            <LogOut size={18} /> <span className="hidden sm:inline">Sign Out</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="nav-link flex items-center gap-1 cosmic-headline px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-700 via-teal-700 to-green-700 hover:from-cyan-500 hover:to-green-500 border border-sky-400 shadow-md"
          >
            <User size={18} /> <span className="hidden sm:inline">Sign In</span>
          </Link>
        )}

        {/* Theme toggle removed */}
        <div className="relative">
          {(profileUser.avatar_url || user?.avatar_url) ? (
            <Image
              src={(profileUser.avatar_url || user?.avatar_url) as string}
              alt="User Avatar"
              width={36}
              height={36}
              className="avatar cursor-pointer"
              style={{ width: "36px", height: "36px" }}
              onClick={() => setDropdown((d) => !d)}
            />
          ) : (
            <div
              className="avatar h-9 w-9 bg-gradient-to-tr from-teal-600 via-blue-500 to-cyan-400 flex items-center justify-center cursor-pointer"
              onClick={() => setDropdown((d) => !d)}
            >
              <User size={20} className="text-white" />
            </div>
          )}
          {dropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-black/80 border border-sky-500 rounded-xl shadow-xl z-50 p-2 animate-fade-in">
              <div className="flex items-center gap-2 mb-2">
                {(profileUser.avatar_url || user?.avatar_url) ? (
                  <Image src={(profileUser.avatar_url || user?.avatar_url) as string} alt="User Avatar" width={28} height={28} className="rounded-full" style={{ width: "28px", height: "28px" }} />
                ) : (
                  <User size={18} className="text-white" />
                )}
                <span className="text-white font-semibold text-sm truncate">{profileUser.display_name || user?.display_name || "Cosmic Soul"}</span>
              </div>
              <a href="/terms" className="block px-3 py-2 rounded hover:bg-teal-800/40 text-cyan-200 font-semibold transition-colors">Terms of Service</a>
              <a href="/privacy" className="block px-3 py-2 rounded hover:bg-teal-800/40 text-cyan-200 font-semibold transition-colors">Privacy Policy</a>
              <a href="/guidelines" className="block px-3 py-2 rounded hover:bg-teal-800/40 text-cyan-200 font-semibold transition-colors">Community Guidelines</a>
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-teal-800/40 text-teal-100 font-semibold transition-colors mt-2"
                onClick={handleSignOut}
              >
                <LogOut size={16} /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

