"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Bell } from "lucide-react";
import Link from "next/link";

type Notification = {
  id: string;
  actor_name: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
  post_id?: string | null;
};

export default function NotificationsPage() {
  const supabase = createClient();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatMessage = (notif: Notification) => {
    const actor = (notif.actor_name || "someone").replace(/^@+/, "");
    if (notif.type === "like") return `@${actor} liked your post`;
    if (notif.type === "comment") return `@${actor} commented on your post`;
    if (notif.type === "follow") return `@${actor} followed you`;
    if (notif.message?.trim()) return notif.message;
    return `@${actor} interacted with your account`;
  };

  const fetchNotifications = async (targetUserId: string) => {
    const { data, error: fetchError } = await supabase
      .from("notifications")
      .select("id, actor_name, type, message, read, created_at, post_id")
      .eq("user_id", targetUserId)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message || "Failed to load notifications.");
      setNotifications([]);
      return;
    }

    setError(null);
    setNotifications((data || []) as Notification[]);
  };

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      const currentUserId = userData?.user?.id || null;

      if (!isMounted) return;

      if (userError) {
        setError(userError.message || "Failed to load your session.");
        setLoading(false);
        return;
      }

      if (!currentUserId) {
        setUserId(null);
        setNotifications([]);
        setLoading(false);
        return;
      }

      setUserId(currentUserId);
      await fetchNotifications(currentUserId);
      if (!isMounted) return;
      setLoading(false);
    };

    void load();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id || null;
      setUserId(nextUserId);

      if (!nextUserId) {
        setNotifications([]);
        return;
      }

      void fetchNotifications(nextUserId);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const markAsRead = async (notifId: string) => {
    if (!userId) return;

    setNotifications((prev) => prev.map((item) => (item.id === notifId ? { ...item, read: true } : item)));

    const { error: updateError } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notifId)
      .eq("user_id", userId);

    if (updateError) {
      setError(updateError.message || "Failed to mark notification as read.");
      await fetchNotifications(userId);
    }
  };

  return (
    <div className="min-h-screen text-cyan-100">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-cyan-50 mb-2 flex items-center gap-3">
            <Bell className="text-cyan-300" size={32} />
            Notifications
          </h1>
          <p className="text-cyan-100/70">Stay updated with the latest activity in TheDyeSpace.</p>
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-400/40 bg-rose-900/30 p-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="text-center text-cyan-300">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="rounded-2xl border border-cyan-300/20 bg-slate-950/55 p-8 text-center">
            <p className="text-cyan-100/70">No notifications yet. Explore the community to start connecting!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications.map((notif) => (
              <div
                key={notif.id}
                onClick={() => void markAsRead(notif.id)}
                className={`rounded-2xl border p-4 transition ${
                  notif.read
                    ? "w-full cursor-pointer border-cyan-300/20 bg-slate-950/55 text-cyan-100/75"
                    : "w-full cursor-pointer border-cyan-300/45 bg-cyan-950/45 text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-xs tracking-[0.2em] text-cyan-200/85 uppercase">{notif.type}</div>
                    <p className="text-base leading-relaxed mt-2 font-medium">{formatMessage(notif)}</p>
                    {notif.post_id ? (
                      <Link
                        href="/"
                        className="mt-2 inline-block text-xs text-cyan-300 underline underline-offset-2 hover:text-cyan-200"
                        onClick={(event) => {
                          event.stopPropagation();
                          void markAsRead(notif.id);
                        }}
                      >
                        Open post
                      </Link>
                    ) : null}
                  </div>
                  <div className="text-xs text-cyan-100/50 whitespace-nowrap ml-4">
                    {new Date(notif.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
