"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Bell, User, Home, Compass, LogOut, HeartHandshake, Users, Settings, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { resolveProfileUsername } from "@/lib/profile-identity";

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

type DirectoryProfile = {
  id: string;
  username: string | null;
  display_name: string | null;
};

export default function MainNavbar() {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<any>(null);
  const [profileHref, setProfileHref] = useState("/login");
  const [userCount, setUserCount] = useState<number | null>(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersList, setUsersList] = useState<DirectoryProfile[]>([]);

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    const updateProfileHref = async (user: any | null) => {
      if (!active) return;
      if (!user) {
        setProfileHref("/login");
        return;
      }

      const fallbackUsername = resolveProfileUsername(user.user_metadata?.username, user.email, user.id);
      let nextHref = `/profile/${encodeURIComponent(fallbackUsername)}`;

      try {
        const { data: profileData, error } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .limit(1)
          .maybeSingle();

        if (!error && profileData?.username) {
          nextHref = `/profile/${encodeURIComponent(profileData.username)}`;
        }
      } catch {
        // Keep fallback route when profile lookup fails.
      }

      if (active) {
        setProfileHref(nextHref);
      }
    };

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void updateProfileHref(data.session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setProfileHref("/login");
        return;
      }

      if (nextSession) {
        setSession(nextSession);
        void updateProfileHref(nextSession.user ?? null);
      }
    });
    return () => { active = false; listener?.subscription.unsubscribe(); };
  }, []);

  const loadUsersList = async () => {
    setUsersLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("id,username,display_name")
        .not("username", "is", null)
        .order("display_name", { ascending: true })
        .limit(300);

      if (error) {
        setUsersList([]);
        return;
      }

      setUsersList((data || []) as DirectoryProfile[]);
    } finally {
      setUsersLoading(false);
    }
  };

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

    // Realtime subscription fires when replication is enabled on the table
    const channel = supabase
      .channel("public:profiles:navbar-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void fetchUserCount();
      })
      .subscribe();

    // Polling fallback: refresh every 30 s in case realtime is not enabled
    const interval = window.setInterval(() => {
      void fetchUserCount();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(interval);
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

  // PWA Install Button logic
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // Ignore clicks on explicit dropdown trigger buttons so toggle behavior remains predictable.
      if (target.closest("[data-dropdown-trigger='true']")) return;

      if (!target.closest("[data-dropdown-box='true']")) {
        setUsersOpen(false);
        setNotifDrop(false);
        setSettingsOpen(false);
      }
    };

    document.addEventListener("click", handleOutside);
    document.addEventListener("touchstart", handleOutside);

    return () => {
      document.removeEventListener("click", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);
  const [showInstall, setShowInstall] = useState(false);
  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShowInstall(false);
  };

  return (
    <nav className="navbar mt-2 mb-4 relative sm:mb-6 flex flex-wrap items-center justify-between">
      <div className="flex items-center gap-2">
        <Link href="/" className="navbar-logo text-2xl tracking-wide select-none sm:text-4xl sm:tracking-widest">
          TheDyeSpace
        </Link>
        {userCount !== null && (
          <div className="relative">
            <button
              data-dropdown-trigger="true"
              type="button"
              onClick={() => {
                setUsersOpen((open) => !open);
                if (!usersOpen) {
                  void loadUsersList();
                }
              }}
              aria-label="Open user list"
              title="Open user list"
              className="flex h-9 items-center gap-1.5 rounded-xl border border-cyan-200/25 bg-black/30 px-2 text-xs font-semibold text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.12)] transition hover:border-cyan-200/45 hover:bg-cyan-300/10 ml-2"
            >
              <Users size={14} className="text-cyan-300" />
              <span>{userCount}</span>
            </button>
            {usersOpen && (
              <div data-dropdown-box="true" className="absolute left-0 top-full z-[9999] mt-2 w-[min(92vw,380px)] rounded-xl border border-cyan-400/40 bg-black/90 p-3 shadow-2xl animate-fade-in">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-cyan-200">User Directory</span>
                  <button
                    type="button"
                    className="text-xs text-cyan-200 hover:text-white"
                    onClick={() => setUsersOpen(false)}
                  >
                    Close
                  </button>
                </div>
                <div className="max-h-[70vh] space-y-1 overflow-auto">
                  {usersLoading ? (
                    <p className="text-sm text-cyan-100/75">Loading users...</p>
                  ) : usersList.length === 0 ? (
                    <p className="text-sm text-cyan-100/75">No users found.</p>
                  ) : (
                    usersList.map((profile) => (
                      <Link
                        key={profile.id}
                        href={`/profile/${encodeURIComponent(profile.username || "")}`}
                        className="block rounded-lg border border-cyan-300/15 bg-slate-950/60 px-3 py-2 text-sm text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-900/20"
                        onClick={() => setUsersOpen(false)}
                      >
                        <span className="font-semibold">{profile.display_name || profile.username || "DyeSpace User"}</span>
                        <span className="ml-2 text-xs text-cyan-300/80">@{profile.username}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end sm:gap-2">
        {showInstall && (
          <button
            onClick={handleInstallClick}
            className="flex h-11 items-center gap-2 rounded-xl border border-cyan-300 bg-cyan-900/80 px-4 text-cyan-100 font-semibold shadow-md hover:bg-cyan-800/90 transition"
            aria-label="Install App"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="M12 16.5a1 1 0 0 1-.707-.293l-4-4a1 1 0 1 1 1.414-1.414L11 12.586V4a1 1 0 1 1 2 0v8.586l2.293-2.293a1 1 0 1 1 1.414 1.414l-4 4A1 1 0 0 1 12 16.5Z"/><path fill="currentColor" d="M4 20a1 1 0 0 1 0-2h16a1 1 0 1 1 0 2H4Z"/></svg>
            Install App
          </button>
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
          <div className="relative flex items-center gap-2">
            {/* Notifications Button */}
            <div className="relative">
              <button
                data-dropdown-trigger="true"
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
                <div data-dropdown-box="true" className="absolute right-0 top-full z-[9999] mt-2 w-[min(92vw,360px)] rounded-xl border border-sky-500 bg-black/90 p-3 shadow-2xl animate-fade-in">
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
            {/* Settings Dropdown Trigger */}
            <div className="relative">
              <button
                data-dropdown-trigger="true"
                aria-label="Settings"
                title="Settings"
                className="group relative flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-200/20 bg-black/30 text-cyan-100/90 transition-all duration-200 hover:border-cyan-200/45 hover:bg-cyan-300/10 hover:text-cyan-50 hover:shadow-[0_0_18px_rgba(34,211,238,0.2)]"
                onClick={() => setSettingsOpen((open) => !open)}
              >
                <Settings size={18} />
                <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border border-cyan-200/35 bg-slate-950/95 px-2 py-1 text-[11px] font-medium text-cyan-100 opacity-0 shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                  Settings
                </span>
              </button>
              {settingsOpen && (
                <div data-dropdown-box="true" className="absolute right-0 top-full z-[9999] mt-2 w-[min(92vw,320px)] rounded-xl border border-cyan-400/40 bg-black/95 p-2 shadow-2xl animate-fade-in">
                  <div className="flex justify-end mb-1">
                    <button data-dropdown-trigger="true" aria-label="Close" title="Close" className="text-cyan-400 hover:text-white p-1" onClick={() => setSettingsOpen(false)}>
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M6 6l8 8M6 14L14 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                  <Link href="/settings" className="flex items-center gap-2 px-4 py-2 text-cyan-200 hover:bg-cyan-900/40 rounded"><Settings size={16} /> Settings</Link>
                  <button className="flex items-center gap-2 w-full px-4 py-2 text-red-400 hover:bg-cyan-900/40 rounded" onClick={() => alert('Delete account logic here!')}><Trash2 size={16} /> Delete Account</button>
                  <Link href="/terms" className="block px-4 py-2 text-cyan-200 hover:bg-cyan-900/40 rounded">Terms of Service</Link>
                  <Link href="/privacy" className="block px-4 py-2 text-cyan-200 hover:bg-cyan-900/40 rounded">Privacy Policy</Link>
                  <Link href="/guidelines" className="block px-4 py-2 text-cyan-200 hover:bg-cyan-900/40 rounded">Community Guidelines</Link>
                  <Link href="/suggestions" className="block px-4 py-2 text-cyan-200 hover:bg-cyan-900/40 rounded">Suggestions & Support</Link>
                  {isLoggedIn ? (
                    <button onClick={handleSignOut} className="w-full text-left px-4 py-2 text-pink-300 hover:bg-cyan-900/40 rounded flex items-center gap-2">
                      <LogOut size={18} /> Logout
                    </button>
                  ) : (
                    <Link href="/login" className="w-full block px-4 py-2 text-green-300 hover:bg-cyan-900/40 rounded flex items-center gap-2">
                      <User size={18} /> Sign In
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <IconButton
          href="/suggestions"
          label="Suggestions & Support"
          icon={<HeartHandshake size={18} />}
          isActive={pathname?.startsWith("/suggestions")}
        />

        {isLoggedIn ? null : (
          <IconButton href="/login" label="Sign In" icon={<User size={18} />} isActive={pathname?.startsWith("/login")} />
        )}
      </div>
    </nav>
  );
}

