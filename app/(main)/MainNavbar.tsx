"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, User, Home, Compass, LogOut, HeartHandshake, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

async function fetchNotifications(): Promise<Array<{ id: string; actor_name: string; type: string; message: string; read: boolean; created_at: string }>> {
  const supabase = createClient();
  const { data: sessionData } = await supabase.auth.getSession();
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
export default function MainNavbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<any>(null);
  const [userCount, setUserCount] = useState<number | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
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

  const isLoggedIn = Boolean(session?.user);
  const profileHref = session?.user ? "/profile" : "/login";

  const IconButton = ({
    href,
    label,
    icon,
    isActive,
  }: {
    href: string;
    label: string;
    icon: React.ReactNode;
    isActive?: boolean;
  }) => (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={`group relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-200 ${
        isActive
          ? "border-cyan-300/75 bg-cyan-300/20 text-cyan-100 shadow-[0_0_20px_rgba(34,211,238,0.28)]"
          : "border-cyan-200/20 bg-black/30 text-cyan-100/90 hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-cyan-50 hover:shadow-[0_0_18px_rgba(34,211,238,0.2)]"
      }`}
    >
      {icon}
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-cyan-200/35 bg-slate-950/95 px-2 py-1 text-[11px] font-medium text-cyan-100 opacity-0 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
        {label}
      </span>
    </Link>
  );

  const IconActionButton = ({
    onClick,
    label,
    icon,
  }: {
    onClick: () => void;
    label: string;
    icon: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="group relative flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-200/20 bg-black/30 text-cyan-100/90 transition-all duration-200 hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-cyan-50 hover:shadow-[0_0_18px_rgba(34,211,238,0.2)]"
    >
      {icon}
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-cyan-200/35 bg-slate-950/95 px-2 py-1 text-[11px] font-medium text-cyan-100 opacity-0 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );

  return (
    <nav className="navbar mt-2 mb-4 relative sm:mb-6">
      <Link href="/" className="navbar-logo w-full text-center text-2xl tracking-wide select-none sm:w-auto sm:text-left sm:text-4xl sm:tracking-widest">
        TheDyeSpace
      </Link>
      <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:justify-end sm:gap-2">
        {userCount !== null && (
          <div className="flex h-11 items-center gap-1.5 rounded-xl border border-cyan-200/25 bg-black/30 px-3 text-xs font-semibold text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.12)]">
            <Users size={14} className="text-cyan-300" />
            <span>{userCount}</span>
          </div>
        )}
        <IconButton href="/" label="Home" icon={<Home size={18} />} isActive={pathname === "/"} />
        <IconButton href="/explore" label="Explore" icon={<Compass size={18} />} isActive={pathname?.startsWith("/explore")} />
        {isLoggedIn && (
          <IconButton
            href={profileHref}
            label="Profile"
            icon={<User size={18} />}
            isActive={pathname?.startsWith("/profile")}
          />
        )}

        {isLoggedIn && (
          <div className="relative">
            <button
              aria-label="Notifications"
              title="Notifications"
              className="group relative flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-200/20 bg-black/30 text-cyan-100/90 transition-all duration-200 hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-cyan-50 hover:shadow-[0_0_18px_rgba(34,211,238,0.2)]"
              onClick={() => {
                setNotifDrop((open) => !open);
                if (!notifDrop) refetch();
              }}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 rounded-full border border-cyan-200/60 bg-cyan-400 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.35)]">
                  {unreadCount}
                </span>
              )}
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-cyan-200/35 bg-slate-950/95 px-2 py-1 text-[11px] font-medium text-cyan-100 opacity-0 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                Notifications
              </span>
            </button>
            {notifDrop && (
              <div className="fixed left-1/2 top-24 z-50 w-[min(92vw,360px)] -translate-x-1/2 rounded-xl border border-sky-500 bg-black/90 p-3 shadow-2xl animate-fade-in sm:top-28">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-cyan-200">Notifications</span>
                  <button onClick={markAllRead} className="text-xs text-green-200 hover:text-white">Mark all read</button>
                </div>
                <div className="max-h-[70vh] space-y-2 overflow-auto">
                  {notifications.length === 0 ? (
                    <p className="text-sm text-slate-300">No new notifications yet.</p>
                  ) : (
                    notifications.map((note) => (
                      <button key={note.id} className={`w-full text-left p-2 rounded-lg transition ${note.read ? "bg-slate-900/40 text-slate-200" : "bg-sky-900/75 text-white"}`} onClick={() => setNotifDrop(false)}>
                        <div className="flex items-center justify-between text-xs text-slate-300">
                          <span>{note.type.toUpperCase()}</span>
                          <span>{new Date(note.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
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
        )}

        <IconButton
          href="/suggestions"
          label="Suggestions & Support"
          icon={<HeartHandshake size={18} />}
          isActive={pathname?.startsWith("/suggestions")}
        />

        {isLoggedIn ? (
          <IconActionButton onClick={handleSignOut} label="Logout" icon={<LogOut size={18} />} />
        ) : (
          <IconButton href="/login" label="Sign In" icon={<User size={18} />} isActive={pathname?.startsWith("/login")} />
        )}
      </div>
    </nav>
  );
}

