"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AsyncStateCard from "@/app/AsyncStateCard";
import { createClient } from "@/lib/supabase/client";
import { dedupeFetchJson } from "@/lib/dedupe-fetch";
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

type PendingContactRequest = {
  id: string;
  status: "pending" | "approved" | "denied";
  created_at: string;
  requester: {
    id: string;
    username: string | null;
    display_name: string | null;
  };
};

export default function NotificationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const auth = useMemo(() => supabase.auth, [supabase]);
  const lastAuthUserIdRef = useRef<string | null>(null);
  const lastRealtimeSyncRef = useRef(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);

  const {
    data: notifications = [],
    refetch: refetchNotifications,
    isLoading: notificationsLoading,
  } = useQuery<Notification[]>({
    queryKey: ["notificationsPage", userId],
    queryFn: async () => {
      const body = await dedupeFetchJson<{ notifications?: Notification[] }>(
        "/api/notifications",
        { cache: "no-store" },
        { cacheTtlMs: 3000 }
      );
      return Array.isArray(body.notifications) ? body.notifications : [];
    },
    enabled: Boolean(userId),
    staleTime: 1000 * 30,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const {
    data: pendingContactRequests = [],
    refetch: refetchPendingContactRequests,
  } = useQuery<PendingContactRequest[]>({
    queryKey: ["pendingContactRequests", userId],
    queryFn: async () => {
      const body = await dedupeFetchJson<{ pendingRequests?: PendingContactRequest[] }>(
        "/api/profile/contact-requests",
        { cache: "no-store" },
        { cacheTtlMs: 3000 }
      );
      return Array.isArray(body.pendingRequests) ? body.pendingRequests : [];
    },
    enabled: Boolean(userId),
    staleTime: 1000 * 30,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const formatMessage = (notif: Notification) => {
    const actor = (notif.actor_name || "someone").replace(/^@+/, "");
    if (notif.message?.trim()) return notif.message;
    if (notif.type === "like") return `@${actor} liked your post`;
    if (notif.type === "comment") return `@${actor} commented on your post`;
    if (notif.type === "follow") return `@${actor} started following you`;
    return `@${actor} interacted with your account`;
  };

  const queryClient = useQueryClient();

  const markAllAsRead = useCallback(async () => {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAll: true }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error || "Failed to mark notifications as read.");
      return;
    }

    if (userId) {
      queryClient.setQueryData<Notification[]>(["notificationsPage", userId], (current) =>
        (current || []).map((item) => ({ ...item, read: true }))
      );
    }
  }, [queryClient, userId]);

  const loadNotificationStateThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastRealtimeSyncRef.current < 15000) {
      return;
    }
    lastRealtimeSyncRef.current = now;
    void Promise.all([refetchNotifications(), refetchPendingContactRequests()]);
  }, [refetchNotifications, refetchPendingContactRequests]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      loadNotificationStateThrottled();
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadNotificationStateThrottled, userId]);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
        const { data: userData, error: userError } = await auth.getUser();
        const currentUserId = userData?.user?.id || null;

        if (!isMounted) return;

        if (userError) {
          setError(userError.message || "Failed to load your session.");
          return;
        }

        if (!currentUserId) {
          lastAuthUserIdRef.current = null;
          setUserId(null);
          setError(null);
          return;
        }

        lastAuthUserIdRef.current = currentUserId;
        setUserId(currentUserId);
        void Promise.all([refetchNotifications(), refetchPendingContactRequests()]);
      };
      void load();

      const {
        data: { subscription },
      } = auth.onAuthStateChange((_event, session) => {
        const nextUserId = session?.user?.id || null;

        if ((_event === "TOKEN_REFRESHED" || _event === "INITIAL_SESSION") && nextUserId === lastAuthUserIdRef.current) {
          return;
        }

        lastAuthUserIdRef.current = nextUserId;
        setUserId(nextUserId);

        if (!nextUserId) {
          setError(null);
          return;
        }

        void Promise.all([refetchNotifications(), refetchPendingContactRequests()]);
      });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [auth, refetchNotifications, refetchPendingContactRequests]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const channel = supabase
      .channel(`public:notifications-page:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        loadNotificationStateThrottled();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "verified_seller_contact_requests", filter: `seller_user_id=eq.${userId}` },
        () => {
          loadNotificationStateThrottled();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "verified_seller_contact_requests", filter: `requester_user_id=eq.${userId}` },
        () => {
          loadNotificationStateThrottled();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadNotificationStateThrottled, supabase, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    if (!notifications.some((item) => !item.read)) {
      return;
    }

    void markAllAsRead();
  }, [markAllAsRead, notifications, userId]);

  const markAsRead = async (notifId: string) => {
    if (!userId) return;

    queryClient.setQueryData<Notification[]>(["notificationsPage", userId], (current) =>
      (current || []).map((item) => (item.id === notifId ? { ...item, read: true } : item))
    );

    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notificationId: notifId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body?.error || "Failed to mark notification as read.");
      void refetchNotifications();
    }
  };

  const handleContactRequestAction = async (requestId: string, action: "approve" | "deny") => {
    setRequestActionId(requestId);
    try {
      const response = await fetch("/api/profile/contact-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(body?.error || "Failed to update contact request.");
      }

      setError(null);
      void refetchPendingContactRequests();
      if (userId) {
        void refetchNotifications();
      }
    } catch (actionError: any) {
      setError(typeof actionError?.message === "string" ? actionError.message : "Failed to update contact request.");
    } finally {
      setRequestActionId(null);
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

        {pendingContactRequests.length > 0 ? (
          <div className="mb-6 rounded-2xl border border-amber-300/20 bg-amber-500/5 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-200/80">Verified Seller</p>
                <h2 className="mt-1 text-xl font-semibold text-amber-50">Contact Info Requests</h2>
              </div>
              <span className="rounded-full border border-amber-300/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-100/80">
                {pendingContactRequests.length} pending
              </span>
            </div>

            <div className="space-y-3">
              {pendingContactRequests.map((request) => {
                const requesterName = request.requester.display_name || request.requester.username || "Buyer";

                return (
                  <div
                    key={request.id}
                    className="flex flex-col gap-3 rounded-2xl border border-amber-300/15 bg-black/20 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold text-amber-50">{requesterName}</p>
                      <p className="mt-1 text-xs text-amber-100/70">
                        Requested {new Date(request.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-emerald-300/45 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handleContactRequestAction(request.id, "approve")}
                        disabled={requestActionId === request.id}
                      >
                        {requestActionId === request.id ? "Working..." : "Accept"}
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-rose-300/45 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => void handleContactRequestAction(request.id, "deny")}
                        disabled={requestActionId === request.id}
                      >
                        {requestActionId === request.id ? "Working..." : "Deny"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {notificationsLoading ? (
          <AsyncStateCard
            loading
            title="Loading notifications"
            message="Checking for likes, comments, and follows on your account."
          />
        ) : error ? (
          <AsyncStateCard
            tone="error"
            title="Couldn\'t load notifications"
            message={error}
            actionLabel="Retry notifications"
            onAction={() => {
              setError(null);
              if (userId) {
                void Promise.all([refetchNotifications(), refetchPendingContactRequests()]);
              } else {
                window.location.reload();
              }
            }}
          />
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
                        href="/explore"
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
