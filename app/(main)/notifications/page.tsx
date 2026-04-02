"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Bell } from "lucide-react";

type Notification = {
  id: string;
  actor_name: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNotifications = async () => {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;

      if (!userId) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("notifications")
        .select("id,actor_name,type,message,read,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      setNotifications(data || []);
      setLoading(false);
    };

    void fetchNotifications();
  }, []);

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-cyan-50 mb-2 flex items-center gap-3">
            <Bell className="text-cyan-300" size={32} />
            Notifications
          </h1>
          <p className="text-cyan-100/70">Stay updated with the latest activity in TheDyeSpace.</p>
        </div>

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
                className={`rounded-2xl border p-4 transition ${
                  notif.read
                    ? "border-cyan-300/10 bg-slate-950/30 text-cyan-100/70"
                    : "border-cyan-300/30 bg-sky-900/30 text-cyan-100"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-sm text-cyan-200/90 uppercase">{notif.type}</div>
                    <div className="font-bold text-lg mt-1">{notif.actor_name}</div>
                    <p className="text-sm leading-relaxed mt-2">{notif.message}</p>
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
